import { nanoid } from "nanoid";
import type {
  RatingState,
  RunPlanSource,
  SuiteAggregates,
  SuiteConfig,
  SuiteRun,
  SuiteRunStatus,
} from "@mcp-token-footprint/shared";
import type { AppDatabase } from "../db/database.js";
import type { SuiteRunRow } from "../db/rows.js";
import { httpError } from "../utils/errors.js";
import { parseJsonObject, stableStringify } from "../utils/json.js";

/**
 * Benchmarks (WP 3.2, B8) — persistence for suite RUNS (the executed matrix instances). Owns all SQL on
 * `suite_runs`, plus the child-run linkage reads/writes on `runs` that a suite run is responsible for
 * (enumerating its children for a recompute, and — on delete — CLEARING their `suite_run_id` so run
 * history survives, LOCKED decision). WP 3.1 left a minimal `suite_runs` insert/get/list skeleton inside
 * {@link import("./repository.js").SuiteRepository}; that skeleton has been MOVED here so suite-CRUD and
 * suite-RUN persistence are cleanly separated (mirroring the testing split of scenario/test CRUD vs
 * run persistence). `config`/`aggregates` ⇄ their `*_json` columns via the shared stable-JSON helpers.
 *
 * `aggregates_json` is DERIVED data (recomputable from the child runs + their grades); it is cached here
 * on completion/cap/stop so a past suite run reads back its rolled-up numbers without re-deriving.
 */
export class SuiteRunRepository {
  constructor(private readonly db: AppDatabase) {}

  /**
   * Create a suite run in `pending`, freezing a SNAPSHOT of the suite's config onto
   * `config_snapshot_json` so a past run replays its exact definition even if the suite is later edited.
   *
   * Testing IA (WP 2.2, D-T5) — every multi-test execution is a suite-run over a PLAN. `suiteId` is NULL
   * for a `collection`/`adhoc` plan (no owning Suite row is created); `source` records which of the three
   * plan sources launched it; `planJson` is the serialized inline plan for a `collection`/`adhoc` source
   * (NULL for a plain `suite` run, whose definition is the saved suite + its config snapshot).
   */
  create(
    suiteId: string | null,
    configSnapshot: SuiteConfig,
    source: RunPlanSource,
    planJson: string | null = null,
  ): SuiteRun {
    const id = nanoid();
    const startedAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO suite_runs (id, suite_id, status, config_snapshot_json, started_at, source, plan_json)
           VALUES (@id, @suiteId, 'pending', @configJson, @startedAt, @source, @planJson)`,
      )
      .run({
        id,
        suiteId,
        configJson: stableStringify(configSnapshot),
        startedAt,
        source,
        planJson,
      });
    return this.getRun(id);
  }

  /** One suite run (404 if unknown). */
  getRun(id: string): SuiteRun {
    const row = this.db.prepare("SELECT * FROM suite_runs WHERE id = ?").get(id) as
      | SuiteRunRow
      | undefined;
    if (!row) {
      throw httpError(404, "Suite run not found");
    }
    return toSuiteRun(row);
  }

  /** All suite runs (newest first), optionally scoped to one suite. */
  listRuns(suiteId?: string): SuiteRun[] {
    const rows = (
      suiteId
        ? this.db
            .prepare("SELECT * FROM suite_runs WHERE suite_id = ? ORDER BY started_at DESC")
            .all(suiteId)
        : this.db.prepare("SELECT * FROM suite_runs ORDER BY started_at DESC").all()
    ) as SuiteRunRow[];
    return rows.map((row) => toSuiteRun(row));
  }

  /** Transition a suite run's lifecycle status (e.g. pending → running). No-op if the row is gone. */
  updateStatus(id: string, status: SuiteRunStatus): void {
    this.db.prepare("UPDATE suite_runs SET status = @status WHERE id = @id").run({ id, status });
  }

  /**
   * Auto-Rating (AR11) — transition the suite run's REVIEW axis (`rating_state`), the suite-level
   * mirror of {@link import("../testing/run-repository.js").RunRepository.setRatingState}. A standalone
   * additive UPDATE ONLY (status/ended_at/aggregates untouched — owned by {@link finalize}); a no-op
   * (0 rows) for a suite run deleted mid-review.
   */
  setRatingState(id: string, state: RatingState): void {
    this.db
      .prepare("UPDATE suite_runs SET rating_state = @state WHERE id = @id")
      .run({ id, state });
  }

  /**
   * Finalize a suite run: set its terminal status, stamp `ended_at`, and CACHE the derived aggregates
   * onto `aggregates_json`. No-op if the row was deleted mid-flight (a raced delete), so finalize can
   * never resurrect a removed suite run.
   */
  finalize(id: string, status: SuiteRunStatus, aggregates: SuiteAggregates): void {
    this.db
      .prepare(
        `UPDATE suite_runs
            SET status = @status,
                ended_at = @endedAt,
                aggregates_json = @aggregatesJson
          WHERE id = @id`,
      )
      .run({
        id,
        status,
        endedAt: new Date().toISOString(),
        aggregatesJson: stableStringify(aggregates),
      });
  }

  /**
   * Overwrite a suite run's cached DERIVED aggregates (`aggregates_json` ONLY — status/ended_at untouched).
   * Used by WP 3.5 (B9.4) to persist the recomputed aggregates carrying the opt-in `failureBuckets`
   * taxonomy: the clusters are derived data, so this never becomes a source of truth and a re-trigger just
   * overwrites. 404 if the suite run is unknown; returns the refreshed {@link SuiteRun}.
   */
  saveAggregates(id: string, aggregates: SuiteAggregates): SuiteRun {
    const exists = this.db.prepare("SELECT 1 FROM suite_runs WHERE id = ?").get(id);
    if (!exists) throw httpError(404, "Suite run not found");
    this.db
      .prepare("UPDATE suite_runs SET aggregates_json = @aggregatesJson WHERE id = @id")
      .run({ id, aggregatesJson: stableStringify(aggregates) });
    return this.getRun(id);
  }

  /**
   * Suite runs that STARTED strictly before the given ISO timestamp (newest first), excluding
   * `excludeId`. Powers the suite-report baseline lookup (the most recent EARLIER comparable run);
   * comparability + "has a persisted report" are the caller's checks, not SQL's.
   */
  listRunsStartedBefore(startedAt: string, excludeId: string): SuiteRun[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM suite_runs WHERE started_at < @startedAt AND id != @excludeId ORDER BY started_at DESC, rowid DESC",
      )
      .all({ startedAt, excludeId }) as SuiteRunRow[];
    return rows.map((row) => toSuiteRun(row));
  }

  /** The run ids linked to this suite run (its started matrix cells). Empty if none / unknown. */
  listChildRunIds(suiteRunId: string): string[] {
    const rows = this.db
      .prepare("SELECT id FROM runs WHERE suite_run_id = ? ORDER BY started_at ASC")
      .all(suiteRunId) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  /**
   * Delete a suite run (LOCKED decision: KEEP its child runs). In one transaction, CLEAR the
   * denormalized linkage on every child run (`suite_run_id`/`repetition` → NULL, making them standalone
   * history) and then delete only the `suite_runs` row. 404s if the suite run doesn't exist. Returns the
   * number of child runs that were unlinked.
   */
  delete(id: string): { unlinkedRuns: number } {
    const remove = this.db.transaction((): { unlinkedRuns: number } => {
      const exists = this.db.prepare("SELECT 1 FROM suite_runs WHERE id = ?").get(id);
      if (!exists) throw httpError(404, "Suite run not found");
      const unlinked = this.db
        .prepare("UPDATE runs SET suite_run_id = NULL, repetition = NULL WHERE suite_run_id = ?")
        .run(id);
      this.db.prepare("DELETE FROM suite_runs WHERE id = ?").run(id);
      return { unlinkedRuns: unlinked.changes };
    });
    return remove();
  }

  /**
   * On API restart, any suite run left non-terminal (`pending`/`running`) has lost its in-memory
   * orchestrator (the process is gone), so mark it `error`. The child runs are separately reconciled to
   * `aborted` by {@link RunRepository.abortOrphanedRuns}. Returns the number of rows reconciled. Wired in
   * `index.ts` next to the orphaned-run reconciliation.
   *
   * AR11 — the same reconciliation settles an ORPHANED review to `skipped` (both for the rows being
   * reconciled and for any terminal row that crashed mid-review), keeping the invariant "a terminal
   * row always converges on a settled rating_state" that the suite SSE close semantics rely on.
   */
  reconcileOrphans(): number {
    const result = this.db
      .prepare(
        "UPDATE suite_runs SET status = 'error', rating_state = 'skipped', ended_at = COALESCE(ended_at, @now) WHERE status IN ('pending','running')",
      )
      .run({ now: new Date().toISOString() });
    // A suite run that reached its terminal status but crashed before its review settled.
    this.db
      .prepare(
        `UPDATE suite_runs SET rating_state = 'skipped'
          WHERE rating_state IN ('pending','rating')
            AND status IN ('completed','capped','stopped','error')`,
      )
      .run();
    return result.changes;
  }
}

function toSuiteRun(row: SuiteRunRow): SuiteRun {
  const suiteRun: SuiteRun = {
    id: row.id,
    status: row.status,
    configSnapshot: parseJsonObject<SuiteConfig>(row.config_snapshot_json, {
      repetitions: 1,
      maxConcurrency: 3,
    }),
    startedAt: row.started_at,
    // AR11 — the suite-level review axis (NOT NULL, default 'pending'; v27 backfills). Always sent.
    ratingState: row.rating_state as RatingState,
  };
  // WP 2.2 — suite_id is present only for a `source:'suite'` run (collection/adhoc plans have none).
  if (row.suite_id !== null) {
    suiteRun.suiteId = row.suite_id;
  }
  // `source` is NULL only on a pre-WP-2.2 row; surface it additively when the row carries one.
  if (row.source !== null) {
    suiteRun.source = row.source as RunPlanSource;
  }
  if (row.ended_at !== null) {
    suiteRun.endedAt = row.ended_at;
  }
  if (row.aggregates_json !== null) {
    const aggregates = parseJsonObject<SuiteAggregates | null>(row.aggregates_json, null);
    if (aggregates !== null) {
      suiteRun.aggregates = aggregates;
    }
  }
  return suiteRun;
}
