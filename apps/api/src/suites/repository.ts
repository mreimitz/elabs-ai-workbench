import { nanoid } from "nanoid";
import type { Suite, SuiteConfig, SuiteInput } from "@mcp-token-footprint/shared";
import { suiteInputSchema } from "@mcp-token-footprint/shared";
import type { AppDatabase } from "../db/database.js";
import type { SuiteRow, SuiteScenarioRow, SuiteTestRow } from "../db/rows.js";
import { httpError } from "../utils/errors.js";
import { parseJsonObject, stableStringify } from "../utils/json.js";

/**
 * Persistence for Benchmarks suites (WP 3.1, B7). Mirrors {@link ScenarioRepository}: the suite row
 * plus two join tables — `suite_tests` (ORDERED via `position`, hydrated back in order) and
 * `suite_scenarios` — are written in one transaction. `config` ⇄ `config_json` via the shared
 * stable-JSON helpers. Suite RUN persistence (the executed matrix + cached aggregates) lives in the
 * separate {@link import("./suite-run-repository.js").SuiteRunRepository} (WP 3.2).
 */
export class SuiteRepository {
  constructor(private readonly db: AppDatabase) {}

  list(): Suite[] {
    const rows = this.db
      .prepare("SELECT * FROM suites ORDER BY updated_at DESC")
      .all() as SuiteRow[];
    return rows.map((row) => this.hydrate(row));
  }

  get(id: string): Suite {
    return this.hydrate(this.getRow(id));
  }

  create(input: SuiteInput): Suite {
    const parsed = suiteInputSchema.parse(input);
    const now = new Date().toISOString();
    const id = nanoid();
    // Testing IA (WP 2.3) — collection membership at create time (same semantics as a test): a provided
    // `collectionId` is validated (404 if unknown) + set; an absent one resolves to the default "Local"
    // collection so a new suite is never collection-less (NULL only in a bare harness with no Local).
    const collectionId = this.resolveCollectionIdForCreate(parsed.collectionId);

    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO suites (id, name, description, config_json, collection_id, created_at, updated_at)
            VALUES (@id, @name, @description, @configJson, @collectionId, @createdAt, @updatedAt)`,
        )
        .run({
          id,
          name: parsed.name,
          description: parsed.description ?? null,
          configJson: stableStringify(parsed.config),
          collectionId,
          createdAt: now,
          updatedAt: now,
        });
      this.replaceTests(id, parsed.testIds);
      this.replaceScenarios(id, parsed.scenarioIds);
    });
    transaction();

    return this.get(id);
  }

  update(id: string, input: SuiteInput): Suite {
    const parsed = suiteInputSchema.parse(input);
    const now = new Date().toISOString();
    // Testing IA (WP 2.3) — a provided `collectionId` is validated (404 if unknown) + set (the "move");
    // an absent one preserves the current membership (the CASE, gated by `@setCollection`).
    const setCollection = parsed.collectionId !== undefined;
    if (setCollection) {
      this.assertCollectionExists(parsed.collectionId as string);
    }

    const transaction = this.db.transaction(() => {
      const result = this.db
        .prepare(
          `UPDATE suites
            SET name = @name,
                description = @description,
                config_json = @configJson,
                collection_id = CASE WHEN @setCollection = 1 THEN @collectionId ELSE collection_id END,
                updated_at = @updatedAt
          WHERE id = @id`,
        )
        .run({
          id,
          name: parsed.name,
          description: parsed.description ?? null,
          configJson: stableStringify(parsed.config),
          setCollection: setCollection ? 1 : 0,
          collectionId: parsed.collectionId ?? null,
          updatedAt: now,
        });
      if (result.changes === 0) {
        throw httpError(404, "Suite not found");
      }
      this.replaceTests(id, parsed.testIds);
      this.replaceScenarios(id, parsed.scenarioIds);
    });
    transaction();

    return this.get(id);
  }

  /**
   * Testing IA (WP 2.3) — resolve the `collection_id` a NEW suite lands in: a provided id is validated
   * (404 if unknown) and used; an absent id resolves to the reserved default "Local" collection so a
   * new suite is never collection-less. Falls back to NULL only when no default row exists (a bare test
   * harness that skips `ensureLocalCollection`) — the same local-only end state as before.
   */
  private resolveCollectionIdForCreate(collectionId: string | undefined): string | null {
    if (collectionId !== undefined) {
      this.assertCollectionExists(collectionId);
      return collectionId;
    }
    const row = this.db.prepare("SELECT id FROM collections WHERE is_default = 1 LIMIT 1").get() as
      | { id: string }
      | undefined;
    return row?.id ?? null;
  }

  private assertCollectionExists(collectionId: string): void {
    const row = this.db.prepare("SELECT 1 FROM collections WHERE id = ?").get(collectionId);
    if (row === undefined) {
      throw httpError(404, "Collection not found");
    }
  }

  delete(id: string): void {
    // suite_tests / suite_scenarios / suite_runs cascade via the FK (ON DELETE CASCADE). Child `runs`
    // are deliberately NOT cascaded — runs.suite_run_id is not an FK, so run history survives (B7).
    const result = this.db.prepare("DELETE FROM suites WHERE id = ?").run(id);
    if (result.changes === 0) {
      throw httpError(404, "Suite not found");
    }
  }

  // --- ordered test membership (suite_tests.position) -----------------------------------------

  listTestIds(suiteId: string): string[] {
    const rows = this.db
      .prepare("SELECT * FROM suite_tests WHERE suite_id = ? ORDER BY position ASC")
      .all(suiteId) as SuiteTestRow[];
    return rows.map((row) => row.test_id);
  }

  // Clear then re-insert the ordered test membership, persisting each test's index as `position`.
  private replaceTests(suiteId: string, testIds: string[]): void {
    this.db.prepare("DELETE FROM suite_tests WHERE suite_id = ?").run(suiteId);
    const insert = this.db.prepare(
      "INSERT INTO suite_tests (suite_id, test_id, position) VALUES (@suiteId, @testId, @position)",
    );
    testIds.forEach((testId, position) => {
      insert.run({ suiteId, testId, position });
    });
  }

  // --- default scenario set (suite_scenarios) --------------------------------------------------

  listScenarioIds(suiteId: string): string[] {
    const rows = this.db
      .prepare("SELECT * FROM suite_scenarios WHERE suite_id = ? ORDER BY scenario_id ASC")
      .all(suiteId) as SuiteScenarioRow[];
    return rows.map((row) => row.scenario_id);
  }

  // Clear then re-insert the default scenario set (dedup, order-insensitive).
  private replaceScenarios(suiteId: string, scenarioIds: string[]): void {
    this.db.prepare("DELETE FROM suite_scenarios WHERE suite_id = ?").run(suiteId);
    const insert = this.db.prepare(
      "INSERT OR IGNORE INTO suite_scenarios (suite_id, scenario_id) VALUES (@suiteId, @scenarioId)",
    );
    for (const scenarioId of scenarioIds) {
      insert.run({ suiteId, scenarioId });
    }
  }

  private hydrate(row: SuiteRow): Suite {
    const suite: Suite = {
      id: row.id,
      name: row.name,
      config: parseJsonObject<SuiteConfig>(row.config_json, { repetitions: 1, maxConcurrency: 3 }),
      testIds: this.listTestIds(row.id),
      scenarioIds: this.listScenarioIds(row.id),
      // Testing IA (WP 2.3) — expose collection membership on read (same semantics as Test's) so the
      // web can filter to a collection + show current membership in the move control (WP 3.1). Read-only
      // projection of `collection_id`; NULL = local-only. `external_key` stays git-engine-internal.
      collectionId: row.collection_id ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
    if (row.description !== null) {
      suite.description = row.description;
    }
    return suite;
  }

  private getRow(id: string): SuiteRow {
    const row = this.db.prepare("SELECT * FROM suites WHERE id = ?").get(id) as
      | SuiteRow
      | undefined;
    if (!row) {
      throw httpError(404, "Suite not found");
    }
    return row;
  }
}
