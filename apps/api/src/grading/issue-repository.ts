import { nanoid } from "nanoid";
import {
  CLUSTER_KEY_VERSION,
  type FixTarget,
  ISSUE_SWEEP_WATERMARK_KEY,
  type RatingIssue,
  type RatingIssueAffected,
  type RatingIssueFleet,
  type RatingIssueLifecycle,
  type RatingIssueOccurrence,
  type RatingIssueOccurrenceCategory,
  type RatingIssueSeverity,
  type RatingIssueStatus,
  type RatingIssueTargetKind,
  type RatingIssueTrendPoint,
  type RootCauseBucket,
} from "@mcp-token-footprint/shared";
import type { AppDatabase } from "../db/database.js";
import type { RatingIssueOccurrenceRow, RatingIssueRow } from "../db/rows.js";
import { httpError } from "../utils/errors.js";

/**
 * Rating Issues registry (Auto-Rating follow-on) — persistence over `rating_issues` +
 * `rating_issue_occurrences` (migration v26). The repository owns ALL SQL; the dedup/judge logic lives
 * in {@link import("./issue-service.js").RatingIssueService}. Key invariants enforced HERE:
 *
 *   - **One occurrence per (issue, run, finding digest)** — {@link addOccurrence} is an
 *     `INSERT OR IGNORE` against the table's UNIQUE key, so reprocessing a run never duplicates.
 *   - **Lifecycle stamps** — {@link setStatus} `resolved` stamps `resolved_at`; re-opening clears it.
 *   - **`touch` = one more sighting** — increments `times_seen`, bumps `last_seen_at`, and optionally
 *     carries the judge's improved summary/draftFix/severity + provenance.
 *
 * `target_*` and occurrence `run_id`/`suite_run_id` are DENORMALIZED (never FK'd to
 * skills/mcp_servers/runs) so the issue history survives target and run deletion.
 */
export class RatingIssueRepository {
  constructor(private readonly db: AppDatabase) {}

  /** Insert a NEW issue together with its first occurrence (one transaction). Returns the full issue. */
  insert(input: RatingIssueInsert): RatingIssue {
    const id = nanoid();
    const now = new Date().toISOString();
    const create = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO rating_issues (
             id, target_kind, target_id, target_name, skill_version_id, title, summary,
             bucket, fix_target, draft_fix, severity, status, times_seen,
             first_seen_at, last_seen_at, resolved_at, rating_version, judge_provider_id, judge_model
           ) VALUES (
             @id, @targetKind, @targetId, @targetName, @skillVersionId, @title, @summary,
             @bucket, @fixTarget, @draftFix, @severity, 'open', 1,
             @now, @now, NULL, @ratingVersion, @judgeProviderId, @judgeModel
           )`,
        )
        .run({
          id,
          targetKind: input.targetKind,
          targetId: input.targetId,
          targetName: input.targetName,
          skillVersionId: input.skillVersionId ?? null,
          title: input.title,
          summary: input.summary,
          bucket: input.bucket,
          fixTarget: input.fixTarget,
          draftFix: input.draftFix,
          severity: input.severity,
          now,
          ratingVersion: input.ratingVersion,
          judgeProviderId: input.judgeProviderId ?? null,
          judgeModel: input.judgeModel ?? null,
        });
      this.insertOccurrenceRow(id, input.occurrence, now);
    });
    create();
    return this.get(id);
  }

  /** One issue + its occurrences. Throws a typed 404 on an unknown id (the central handler formats it). */
  get(id: string): RatingIssue {
    const row = this.db.prepare("SELECT * FROM rating_issues WHERE id = ?").get(id) as
      | RatingIssueRow
      | undefined;
    if (!row) throw httpError(404, "Rating issue not found");
    return this.toIssue(row);
  }

  /**
   * Every issue for one target (open first, then most-recently-seen first), occurrences included.
   * `limit` bounds the result (the service's judge context is bounded to ~20 issues).
   */
  listByTarget(
    targetKind: RatingIssueTargetKind,
    targetId: string,
    status?: RatingIssueStatus,
    limit?: number,
  ): RatingIssue[] {
    return this.listAll({
      targetKind,
      targetId,
      ...(status ? { status } : {}),
      ...(limit ? { limit } : {}),
    });
  }

  /** Filtered list over the whole registry (open first, then most-recently-seen first), occurrences included. */
  listAll(filter: RatingIssueFilter = {}): RatingIssue[] {
    const where: string[] = [];
    const params: Record<string, string | number> = {};
    if (filter.targetKind) {
      where.push("target_kind = @targetKind");
      params.targetKind = filter.targetKind;
    }
    if (filter.targetId) {
      where.push("target_id = @targetId");
      params.targetId = filter.targetId;
    }
    if (filter.status) {
      where.push("status = @status");
      params.status = filter.status;
    }
    if (filter.runId) {
      // Issues this run contributed at least one occurrence to (the run Report tab's "issues filed" link-up).
      where.push(
        "id IN (SELECT issue_id FROM rating_issue_occurrences WHERE run_id = @runId)",
      );
      params.runId = filter.runId;
    }
    // Fleet filters (WP5.1) — `lifecycle` narrows to CLUSTERED fleet issues (only they carry a
    // non-NULL lifecycle); the date bounds constrain `last_seen_at`. All optional + ANDed.
    if (filter.lifecycle) {
      where.push("lifecycle = @lifecycle");
      params.lifecycle = filter.lifecycle;
    }
    if (filter.lastSeenFrom) {
      where.push("last_seen_at >= @lastSeenFrom");
      params.lastSeenFrom = filter.lastSeenFrom;
    }
    if (filter.lastSeenTo) {
      where.push("last_seen_at <= @lastSeenTo");
      params.lastSeenTo = filter.lastSeenTo;
    }
    // Observability WP5.5 (D-OB22) — the scheduled digest's window-over-window "new"/"resolved" issue
    // sections need first_seen_at/resolved_at bounds (last_seen_at above already covers "regressed" —
    // a regressed cluster's most recent sighting IS its last_seen_at). Additive; unused by any existing
    // caller (the WP5.1/5.2/5.3 routes never pass these).
    if (filter.firstSeenFrom) {
      where.push("first_seen_at >= @firstSeenFrom");
      params.firstSeenFrom = filter.firstSeenFrom;
    }
    if (filter.firstSeenTo) {
      where.push("first_seen_at <= @firstSeenTo");
      params.firstSeenTo = filter.firstSeenTo;
    }
    if (filter.resolvedFrom) {
      where.push("resolved_at >= @resolvedFrom");
      params.resolvedFrom = filter.resolvedFrom;
    }
    if (filter.resolvedTo) {
      where.push("resolved_at <= @resolvedTo");
      params.resolvedTo = filter.resolvedTo;
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const limitSql =
      typeof filter.limit === "number" && Number.isInteger(filter.limit) && filter.limit > 0
        ? "LIMIT @limit"
        : "";
    if (limitSql) params.limit = filter.limit as number;
    const rows = this.db
      .prepare(
        `SELECT * FROM rating_issues ${whereSql}
         ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END ASC, last_seen_at DESC, rowid DESC ${limitSql}`,
      )
      .all(params) as RatingIssueRow[];
    return rows.map((row) => this.toIssue(row));
  }

  /**
   * One more sighting of an existing issue: `times_seen + 1`, `last_seen_at = now`, plus the judge's
   * improved summary/draftFix/severity and provenance when provided (absent fields keep their value).
   */
  touch(id: string, patch: RatingIssueTouch = {}): RatingIssue {
    this.get(id); // typed 404 on an unknown id
    this.db
      .prepare(
        `UPDATE rating_issues SET
           times_seen = times_seen + 1,
           last_seen_at = @now,
           summary = COALESCE(@summary, summary),
           draft_fix = COALESCE(@draftFix, draft_fix),
           severity = COALESCE(@severity, severity),
           judge_provider_id = COALESCE(@judgeProviderId, judge_provider_id),
           judge_model = COALESCE(@judgeModel, judge_model)
         WHERE id = @id`,
      )
      .run({
        id,
        now: new Date().toISOString(),
        summary: patch.summary ?? null,
        draftFix: patch.draftFix ?? null,
        severity: patch.severity ?? null,
        judgeProviderId: patch.judgeProviderId ?? null,
        judgeModel: patch.judgeModel ?? null,
      });
    return this.get(id);
  }

  /** Resolve / re-open. `resolved` stamps `resolved_at`; `open` (automatic OR manual re-open) clears it. */
  setStatus(id: string, status: RatingIssueStatus): RatingIssue {
    this.get(id); // typed 404 on an unknown id
    this.db
      .prepare(
        "UPDATE rating_issues SET status = @status, resolved_at = @resolvedAt WHERE id = @id",
      )
      .run({
        id,
        status,
        resolvedAt: status === "resolved" ? new Date().toISOString() : null,
      });
    return this.get(id);
  }

  /**
   * Link one contributing run (idempotent): `INSERT OR IGNORE` against the UNIQUE
   * (issue_id, run_id, finding_digest) key. Returns `true` when a NEW occurrence row was written,
   * `false` when this exact sighting was already recorded (reprocessing a run is a strict no-op).
   */
  addOccurrence(issueId: string, occurrence: RatingIssueOccurrenceInsert): boolean {
    return this.insertOccurrenceRow(issueId, occurrence, new Date().toISOString());
  }

  /** All occurrences of one issue, oldest first. */
  listOccurrences(issueId: string): RatingIssueOccurrence[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM rating_issue_occurrences WHERE issue_id = ? ORDER BY created_at ASC, rowid ASC",
      )
      .all(issueId) as RatingIssueOccurrenceRow[];
    return rows.map(toOccurrence);
  }

  /**
   * Has this exact sighting (target + run + finding digest) already been folded into ANY issue?
   * The service's idempotency short-circuit: a reprocessed run skips the judge entirely.
   */
  hasOccurrence(
    targetKind: RatingIssueTargetKind,
    targetId: string,
    runId: string,
    findingDigest: string,
  ): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 FROM rating_issue_occurrences o
         JOIN rating_issues i ON i.id = o.issue_id
         WHERE i.target_kind = @targetKind AND i.target_id = @targetId
           AND o.run_id = @runId AND o.finding_digest = @findingDigest
         LIMIT 1`,
      )
      .get({ targetKind, targetId, runId, findingDigest });
    return row !== undefined;
  }

  // ── internals ─────────────────────────────────────────────────────────────────────────────────

  private insertOccurrenceRow(
    issueId: string,
    occurrence: RatingIssueOccurrenceInsert,
    createdAt: string,
    observedAt: string | null = null,
  ): boolean {
    const info = this.db
      .prepare(
        `INSERT OR IGNORE INTO rating_issue_occurrences (
           id, issue_id, run_id, suite_run_id, finding_digest, category, message,
           tool_name, sent_arguments, error_message, created_at, observed_at
         ) VALUES (@id, @issueId, @runId, @suiteRunId, @findingDigest, @category, @message,
           @toolName, @sentArguments, @errorMessage, @createdAt, @observedAt)`,
      )
      .run({
        id: nanoid(),
        issueId,
        runId: occurrence.runId,
        suiteRunId: occurrence.suiteRunId ?? null,
        findingDigest: occurrence.findingDigest,
        category: occurrence.category,
        message: occurrence.message,
        toolName: occurrence.toolName ?? null,
        sentArguments: occurrence.sentArguments ?? null,
        errorMessage: occurrence.errorMessage ?? null,
        createdAt,
        observedAt,
      });
    return info.changes > 0;
  }

  private toIssue(row: RatingIssueRow): RatingIssue {
    return {
      id: row.id,
      targetKind: row.target_kind,
      targetId: row.target_id,
      targetName: row.target_name,
      ...(row.skill_version_id ? { skillVersionId: row.skill_version_id } : {}),
      title: row.title,
      summary: row.summary,
      bucket: row.bucket as RootCauseBucket,
      fixTarget: row.fix_target as FixTarget,
      draftFix: row.draft_fix,
      severity: row.severity,
      status: row.status,
      timesSeen: row.times_seen,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      ...(row.resolved_at ? { resolvedAt: row.resolved_at } : {}),
      ratingVersion: row.rating_version,
      judgeProviderId: row.judge_provider_id,
      judgeModel: row.judge_model,
      occurrences: this.listOccurrences(row.id),
      ...(row.cluster_key !== null ? { fleet: toFleet(row) } : {}),
    };
  }

  // ── Fleet issue aggregation (Observability WP5.1, D-OB20) ─────────────────────────────────────
  // A FLEET issue is a `rating_issues` row that ALSO carries a `cluster_key` (+ the additive fleet
  // columns). Created/mutated ONLY by the sweep ({@link import("./issue-clustering.js").IssueSweepService})
  // + the lifecycle routes — NEVER by the per-run auto-rating pipeline (its rows keep `cluster_key`
  // NULL and are untouched here). occurrences/first-last-seen/trend are DERIVED from the link rows;
  // `affected_json` is merged at sweep time. Every derived field is reproducible by re-sweeping runs.

  /** The fleet issue for a cluster identity, or undefined. Cluster keys are namespaced by version. */
  findFleetIssueByClusterKey(clusterKey: string, clusterKeyVersion: number): RatingIssue | undefined {
    const row = this.db
      .prepare(
        "SELECT * FROM rating_issues WHERE cluster_key = @clusterKey AND cluster_key_version = @version",
      )
      .get({ clusterKey, version: clusterKeyVersion }) as RatingIssueRow | undefined;
    return row ? this.toIssue(row) : undefined;
  }

  /**
   * Open a NEW fleet issue for a cluster, together with its first contributing-run occurrence (one
   * transaction), then derive its cached aggregates from the link row. Lifecycle starts `open`.
   */
  insertFleetIssue(input: FleetIssueInsert): RatingIssue {
    const id = nanoid();
    const now = new Date().toISOString();
    const create = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO rating_issues (
             id, target_kind, target_id, target_name, skill_version_id, title, summary,
             bucket, fix_target, draft_fix, severity, status, times_seen,
             first_seen_at, last_seen_at, resolved_at, rating_version, judge_provider_id, judge_model,
             cluster_key, cluster_key_version, occurrences, affected_json, lifecycle, resolution_note, trend_json
           ) VALUES (
             @id, @targetKind, @targetId, @targetName, @skillVersionId, @title, @summary,
             @bucket, @fixTarget, @draftFix, @severity, 'open', 1,
             @observedAt, @observedAt, NULL, @ratingVersion, NULL, NULL,
             @clusterKey, @clusterKeyVersion, 1, @affectedJson, 'open', NULL, '[]'
           )`,
        )
        .run({
          id,
          targetKind: input.targetKind,
          targetId: input.targetId,
          targetName: input.targetName,
          skillVersionId: input.skillVersionId ?? null,
          title: input.title,
          summary: input.summary,
          bucket: input.bucket,
          fixTarget: input.fixTarget,
          draftFix: input.draftFix,
          severity: input.severity,
          observedAt: input.observedAt,
          ratingVersion: input.ratingVersion,
          clusterKey: input.clusterKey,
          clusterKeyVersion: input.clusterKeyVersion,
          affectedJson: JSON.stringify(normalizeAffected(input.affected)),
        });
      this.insertOccurrenceRow(id, input.occurrence, now, input.observedAt);
      this.recomputeFleetDerived(id);
    });
    create();
    return this.get(id);
  }

  /**
   * Link one contributing run to a fleet issue (idempotent — `INSERT OR IGNORE` on the UNIQUE
   * (issue_id, run_id, finding_digest) key). Returns `true` only when a NEW occurrence row was written
   * (a genuinely new sighting) so the caller updates the derived caches; `false` on a re-sweep no-op.
   */
  addFleetOccurrence(
    issueId: string,
    occurrence: RatingIssueOccurrenceInsert,
    observedAt: string,
  ): boolean {
    return this.insertOccurrenceRow(issueId, occurrence, new Date().toISOString(), observedAt);
  }

  /** Merge one run's affected entities into a fleet issue's `affected_json` (set-union, sorted). */
  mergeAffected(issueId: string, affected: RatingIssueAffected): void {
    const row = this.db
      .prepare("SELECT affected_json FROM rating_issues WHERE id = ?")
      .get(issueId) as { affected_json: string | null } | undefined;
    const current = parseAffected(row?.affected_json ?? null);
    const merged = normalizeAffected({
      servers: [...current.servers, ...affected.servers],
      skills: [...current.skills, ...affected.skills],
      tests: [...current.tests, ...affected.tests],
      models: [...current.models, ...affected.models],
    });
    this.db
      .prepare("UPDATE rating_issues SET affected_json = @affectedJson WHERE id = @id")
      .run({ id: issueId, affectedJson: JSON.stringify(merged) });
  }

  /**
   * Recompute a fleet issue's DERIVED caches (`occurrences`, `first_seen_at`, `last_seen_at`,
   * `trend_json`, and the mirrored `times_seen`) purely from its contributing-run link rows — so the
   * caches are always a pure function of the sightings and a re-sweep / rebuild reproduces them exactly.
   */
  recomputeFleetDerived(issueId: string): void {
    const rows = this.db
      .prepare(
        "SELECT observed_at, created_at FROM rating_issue_occurrences WHERE issue_id = ?",
      )
      .all(issueId) as Array<{ observed_at: string | null; created_at: string }>;
    const times = rows.map((r) => r.observed_at ?? r.created_at).sort();
    const count = times.length;
    const firstSeen = times[0] ?? new Date().toISOString();
    const lastSeen = times[count - 1] ?? firstSeen;
    const trendByDay = new Map<string, number>();
    for (const iso of times) {
      const day = iso.slice(0, 10); // UTC YYYY-MM-DD
      trendByDay.set(day, (trendByDay.get(day) ?? 0) + 1);
    }
    const trend: RatingIssueTrendPoint[] = [...trendByDay.entries()]
      .map(([day, dayCount]) => ({ day, count: dayCount }))
      .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
    this.db
      .prepare(
        `UPDATE rating_issues SET
           occurrences = @count,
           times_seen = @timesSeen,
           first_seen_at = @firstSeen,
           last_seen_at = @lastSeen,
           trend_json = @trendJson
         WHERE id = @id`,
      )
      .run({
        id: issueId,
        count,
        timesSeen: Math.max(1, count),
        firstSeen,
        lastSeen,
        trendJson: JSON.stringify(trend),
      });
  }

  /**
   * Set a fleet issue's lifecycle. `resolved` stamps `resolved_at` NOW + records the `note`; `open`
   * (manual reopen) and `regressed` (auto-reopen on reappearance) CLEAR `resolved_at` + the note. The
   * legacy `status` column is kept consistent (`resolved` → 'resolved', else 'open') so the existing
   * status-based reads/exports still work. 404 on an unknown id (mirrors {@link setStatus}).
   */
  setLifecycle(
    issueId: string,
    lifecycle: RatingIssueLifecycle,
    note?: string | null,
  ): RatingIssue {
    this.get(issueId); // typed 404 on an unknown id
    const resolved = lifecycle === "resolved";
    this.db
      .prepare(
        `UPDATE rating_issues SET
           lifecycle = @lifecycle,
           status = @status,
           resolved_at = @resolvedAt,
           resolution_note = @note
         WHERE id = @id`,
      )
      .run({
        id: issueId,
        lifecycle,
        status: resolved ? "resolved" : "open",
        resolvedAt: resolved ? new Date().toISOString() : null,
        note: resolved ? (note ?? null) : null,
      });
    return this.get(issueId);
  }

  /** Delete every fleet issue (`cluster_key NOT NULL`) + its occurrences (FK cascade). For `rebuild`. */
  deleteAllFleetIssues(): number {
    const info = this.db.prepare("DELETE FROM rating_issues WHERE cluster_key IS NOT NULL").run();
    return info.changes;
  }

  // ── sweep inputs: terminal-run listing + watermark (over app_settings) ────────────────────────

  /**
   * Terminal runs (a finished disposition) whose terminal time falls in `(since, until]`, oldest
   * first — the folding order for a sweep. `since === null` returns ALL terminal runs (a full
   * history scan, used by `rebuild` + a first sweep). The terminal time is `ended_at` when set (every
   * terminal disposition stamps it, WP1.6), else `started_at` (older rows). Bound params only.
   */
  listTerminalRunsForSweep(
    since: string | null,
    until: string,
  ): Array<{ id: string; terminalAt: string }> {
    const clauses = [
      "status IN ('completed','stopped','error','aborted','ended')",
      "COALESCE(ended_at, started_at) <= @until",
    ];
    const params: Record<string, string> = { until };
    if (since !== null) {
      clauses.push("COALESCE(ended_at, started_at) > @since");
      params.since = since;
    }
    const rows = this.db
      .prepare(
        `SELECT id, COALESCE(ended_at, started_at) AS terminalAt FROM runs
         WHERE ${clauses.join(" AND ")}
         ORDER BY COALESCE(ended_at, started_at) ASC, id ASC`,
      )
      .all(params) as Array<{ id: string; terminalAt: string }>;
    return rows;
  }

  /** The persisted sweep watermark (the last swept window's upper bound), or null when never swept. */
  getSweepWatermark(): string | null {
    const row = this.db
      .prepare("SELECT value_json FROM app_settings WHERE key = ?")
      .get(ISSUE_SWEEP_WATERMARK_KEY) as { value_json: string } | undefined;
    if (!row) return null;
    try {
      const parsed: unknown = JSON.parse(row.value_json);
      return typeof parsed === "string" ? parsed : null;
    } catch {
      return null;
    }
  }

  /** Advance the sweep watermark (idempotent upsert over `app_settings`). */
  setSweepWatermark(iso: string): void {
    this.db
      .prepare(
        `INSERT INTO app_settings (key, value_json, updated_at)
         VALUES (@key, @value, @now)
         ON CONFLICT(key) DO UPDATE SET value_json = @value, updated_at = @now`,
      )
      .run({ key: ISSUE_SWEEP_WATERMARK_KEY, value: JSON.stringify(iso), now: new Date().toISOString() });
  }

  /** Fleet issue + contributing-occurrence totals (for the `rebuild` result / derived-once proof). */
  countFleet(): { issues: number; occurrences: number } {
    const issues = (
      this.db.prepare("SELECT COUNT(*) AS n FROM rating_issues WHERE cluster_key IS NOT NULL").get() as {
        n: number;
      }
    ).n;
    const occurrences = (
      this.db
        .prepare(
          `SELECT COUNT(*) AS n FROM rating_issue_occurrences o
           JOIN rating_issues i ON i.id = o.issue_id WHERE i.cluster_key IS NOT NULL`,
        )
        .get() as { n: number }
    ).n;
    return { issues, occurrences };
  }
}

/** The input to {@link RatingIssueRepository.insert} — a new issue is always born WITH its first occurrence. */
export type RatingIssueInsert = {
  targetKind: RatingIssueTargetKind;
  targetId: string;
  targetName: string;
  skillVersionId?: string | null;
  title: string;
  summary: string;
  bucket: RootCauseBucket;
  fixTarget: FixTarget;
  draftFix: string;
  severity: RatingIssueSeverity;
  ratingVersion: number;
  judgeProviderId?: string | null;
  judgeModel?: string | null;
  occurrence: RatingIssueOccurrenceInsert;
};

/** One contributing-run link. `findingDigest` is the service's deterministic per-finding hash. */
export type RatingIssueOccurrenceInsert = {
  runId: string;
  suiteRunId?: string | null;
  findingDigest: string;
  category: RatingIssueOccurrenceCategory;
  message: string;
  /** Concrete failure evidence carried from the finding (all optional, redacted + bounded upstream). */
  toolName?: string;
  sentArguments?: string;
  errorMessage?: string;
};

/** {@link RatingIssueRepository.touch}'s optional judge-enhancement patch (absent fields keep their value). */
export type RatingIssueTouch = {
  summary?: string;
  draftFix?: string;
  severity?: RatingIssueSeverity;
  judgeProviderId?: string | null;
  judgeModel?: string | null;
};

/** {@link RatingIssueRepository.listAll} filters — all optional. `runId` = issues the run contributed ≥1 occurrence to. */
export type RatingIssueFilter = {
  targetKind?: RatingIssueTargetKind;
  targetId?: string;
  status?: RatingIssueStatus;
  runId?: string;
  limit?: number;
  // Fleet filters (WP5.1) — `lifecycle` narrows to clustered fleet issues; the date bounds hit `last_seen_at`.
  lifecycle?: RatingIssueLifecycle;
  lastSeenFrom?: string;
  lastSeenTo?: string;
  // Digest window filters (WP5.5, D-OB22) — additive; see `listAll`'s doc comment above.
  firstSeenFrom?: string;
  firstSeenTo?: string;
  resolvedFrom?: string;
  resolvedTo?: string;
};

/**
 * Input to {@link RatingIssueRepository.insertFleetIssue} — a NEW deterministically-clustered fleet
 * issue (Observability WP5.1) is always born WITH its first contributing-run occurrence + the run's
 * affected entities. `observedAt` is the contributing run's terminal time (the sighting time).
 */
export type FleetIssueInsert = {
  clusterKey: string;
  clusterKeyVersion: number;
  targetKind: RatingIssueTargetKind;
  targetId: string;
  targetName: string;
  skillVersionId?: string | null;
  title: string;
  summary: string;
  bucket: RootCauseBucket;
  fixTarget: FixTarget;
  draftFix: string;
  severity: RatingIssueSeverity;
  ratingVersion: number;
  affected: RatingIssueAffected;
  occurrence: RatingIssueOccurrenceInsert;
  observedAt: string;
};

function toOccurrence(row: RatingIssueOccurrenceRow): RatingIssueOccurrence {
  return {
    runId: row.run_id,
    ...(row.suite_run_id ? { suiteRunId: row.suite_run_id } : {}),
    category: row.category as RatingIssueOccurrenceCategory,
    message: row.message,
    ...(row.tool_name ? { toolName: row.tool_name } : {}),
    ...(row.sent_arguments ? { sentArguments: row.sent_arguments } : {}),
    ...(row.error_message ? { errorMessage: row.error_message } : {}),
    createdAt: row.created_at,
  };
}

/** Project the fleet columns of a clustered `rating_issues` row into the {@link RatingIssueFleet} block. */
function toFleet(row: RatingIssueRow): RatingIssueFleet {
  return {
    clusterKey: row.cluster_key ?? "",
    clusterKeyVersion: row.cluster_key_version ?? CLUSTER_KEY_VERSION,
    lifecycle: (row.lifecycle ?? "open") as RatingIssueLifecycle,
    occurrenceCount: row.occurrences ?? 0,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    affected: parseAffected(row.affected_json),
    trend: parseTrend(row.trend_json),
    ...(row.resolution_note ? { resolutionNote: row.resolution_note } : {}),
    ...(row.resolved_at ? { resolvedAt: row.resolved_at } : {}),
  };
}

/** Deduplicate + sort each dimension of an affected set (stable, so the JSON cache is canonical). */
function normalizeAffected(affected: RatingIssueAffected): RatingIssueAffected {
  const uniqSort = (values: string[]): string[] =>
    [...new Set(values.filter((v) => typeof v === "string" && v.length > 0))].sort();
  return {
    servers: uniqSort(affected.servers),
    skills: uniqSort(affected.skills),
    tests: uniqSort(affected.tests),
    models: uniqSort(affected.models),
  };
}

/** Parse a stored `affected_json` blob into a normalized {@link RatingIssueAffected} (empty on any miss). */
function parseAffected(json: string | null): RatingIssueAffected {
  const empty: RatingIssueAffected = { servers: [], skills: [], tests: [], models: [] };
  if (!json) return empty;
  try {
    const parsed = JSON.parse(json) as Partial<RatingIssueAffected>;
    return normalizeAffected({
      servers: Array.isArray(parsed.servers) ? parsed.servers : [],
      skills: Array.isArray(parsed.skills) ? parsed.skills : [],
      tests: Array.isArray(parsed.tests) ? parsed.tests : [],
      models: Array.isArray(parsed.models) ? parsed.models : [],
    });
  } catch {
    return empty;
  }
}

/** Parse a stored `trend_json` blob into the ascending per-day series (empty on any miss). */
function parseTrend(json: string | null): RatingIssueTrendPoint[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (p): p is RatingIssueTrendPoint =>
          typeof p === "object" &&
          p !== null &&
          typeof (p as RatingIssueTrendPoint).day === "string" &&
          typeof (p as RatingIssueTrendPoint).count === "number",
      )
      .map((p) => ({ day: p.day, count: p.count }));
  } catch {
    return [];
  }
}
