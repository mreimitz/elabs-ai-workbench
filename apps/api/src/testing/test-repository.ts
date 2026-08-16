import { nanoid } from "nanoid";
import type {
  Difficulty,
  Test,
  TestAssertions,
  TestAttachment,
  TestExpectations,
  TestInput,
  TokenProfileRef,
} from "@mcp-token-footprint/shared";
import { testInputSchema } from "@mcp-token-footprint/shared";
import type { AppDatabase } from "../db/database.js";
import type { TestAttachmentRow, TestRow } from "../db/rows.js";
import { httpError } from "../utils/errors.js";
import { parseJsonObject, stableStringify } from "../utils/json.js";

export type AttachmentRecord = {
  id: string;
  testId: string;
  kind: TestAttachment["kind"];
  name: string;
  path: string;
  bytes: number;
};

export class TestRepository {
  constructor(private readonly db: AppDatabase) {}

  list(): Test[] {
    const rows = this.db.prepare("SELECT * FROM tests ORDER BY updated_at DESC").all() as TestRow[];
    return rows.map((row) => this.hydrate(row));
  }

  get(id: string): Test {
    return this.hydrate(this.getRow(id));
  }

  create(input: TestInput): Test {
    const parsed = testInputSchema.parse(input);
    const now = new Date().toISOString();
    const id = nanoid();
    // Testing IA (WP 2.3) — collection membership at create time: a provided `collectionId` is
    // validated (404 if unknown) and set; an absent one resolves to the default "Local" collection so
    // a new test is never collection-less (falls back to NULL/local-only only in a bare harness with
    // no seeded Local). `external_key` stays membership-managed (NULL here; stamped by the git engine).
    const collectionId = this.resolveCollectionIdForCreate(parsed.collectionId);

    this.db
      .prepare(
        `INSERT INTO tests (
          id, name, user_prompt, system_prompt_override, added_profiles_json, assertions_json,
          expectations_json, category, difficulty, tags_json, collection_id, draft,
          created_at, updated_at
        ) VALUES (
          @id, @name, @userPrompt, @systemPromptOverride, @addedProfilesJson, @assertionsJson,
          @expectationsJson, @category, @difficulty, @tagsJson, @collectionId, @draft,
          @createdAt, @updatedAt
        )`,
      )
      .run({
        id,
        name: parsed.name,
        userPrompt: parsed.userPrompt,
        systemPromptOverride: parsed.systemPromptOverride ?? null,
        addedProfilesJson: stableStringify(parsed.addedProfiles),
        assertionsJson: parsed.assertions === undefined ? null : stableStringify(parsed.assertions),
        expectationsJson:
          parsed.expectations === undefined ? null : stableStringify(parsed.expectations),
        category: parsed.category ?? null,
        difficulty: parsed.difficulty ?? null,
        tagsJson: stableStringify(parsed.tags ?? []),
        collectionId,
        // Observability (WP4.1) — draft flag (promote_to_test). Absent → 0 (a normal test).
        draft: parsed.draft ? 1 : 0,
        createdAt: now,
        updatedAt: now,
      });

    return this.get(id);
  }

  update(id: string, input: TestInput): Test {
    const parsed = testInputSchema.parse(input);
    const now = new Date().toISOString();
    // Testing IA (WP 2.3) — a provided `collectionId` is validated (404 if unknown) and set (the
    // "move"); an absent one preserves the current membership. `@setCollection` gates the CASE so the
    // stored `collection_id` is only overwritten when the caller supplied one.
    const setCollection = parsed.collectionId !== undefined;
    if (setCollection) {
      this.assertCollectionExists(parsed.collectionId as string);
    }

    const result = this.db
      .prepare(
        `UPDATE tests
          SET name = @name,
              user_prompt = @userPrompt,
              system_prompt_override = @systemPromptOverride,
              added_profiles_json = @addedProfilesJson,
              assertions_json = @assertionsJson,
              expectations_json = @expectationsJson,
              category = @category,
              difficulty = @difficulty,
              tags_json = @tagsJson,
              collection_id = CASE WHEN @setCollection = 1 THEN @collectionId ELSE collection_id END,
              updated_at = @updatedAt
        WHERE id = @id`,
      )
      .run({
        id,
        name: parsed.name,
        userPrompt: parsed.userPrompt,
        systemPromptOverride: parsed.systemPromptOverride ?? null,
        addedProfilesJson: stableStringify(parsed.addedProfiles),
        assertionsJson: parsed.assertions === undefined ? null : stableStringify(parsed.assertions),
        expectationsJson:
          parsed.expectations === undefined ? null : stableStringify(parsed.expectations),
        category: parsed.category ?? null,
        difficulty: parsed.difficulty ?? null,
        tagsJson: stableStringify(parsed.tags ?? []),
        setCollection: setCollection ? 1 : 0,
        collectionId: parsed.collectionId ?? null,
        updatedAt: now,
      });

    if (result.changes === 0) {
      throw httpError(404, "Test not found");
    }

    return this.get(id);
  }

  /**
   * Testing IA (WP 2.3) — resolve the `collection_id` a NEW test lands in: a provided id is validated
   * (404 if unknown) and used; an absent id resolves to the reserved default "Local" collection so a
   * new test is never collection-less. Falls back to NULL only when no default row exists (a bare test
   * harness that skips {@link ensureLocalCollection}) — the same local-only end state as before.
   */
  private resolveCollectionIdForCreate(collectionId: string | undefined): string | null {
    if (collectionId !== undefined) {
      this.assertCollectionExists(collectionId);
      return collectionId;
    }
    return this.defaultLocalCollectionId();
  }

  private assertCollectionExists(collectionId: string): void {
    const row = this.db.prepare("SELECT 1 FROM collections WHERE id = ?").get(collectionId);
    if (row === undefined) {
      throw httpError(404, "Collection not found");
    }
  }

  private defaultLocalCollectionId(): string | null {
    const row = this.db.prepare("SELECT id FROM collections WHERE is_default = 1 LIMIT 1").get() as
      | { id: string }
      | undefined;
    return row?.id ?? null;
  }

  delete(id: string): void {
    // test_attachments rows cascade via the FK (ON DELETE CASCADE). The blob files on disk are
    // removed by the service, which knows their paths.
    const result = this.db.prepare("DELETE FROM tests WHERE id = ?").run(id);
    if (result.changes === 0) {
      throw httpError(404, "Test not found");
    }
  }

  exists(id: string): boolean {
    return this.db.prepare("SELECT 1 FROM tests WHERE id = ?").get(id) !== undefined;
  }

  /**
   * Testing IA (WP 2.2) — the ids of every test CURRENTLY a member of `collectionId`, in a stable order
   * (creation order, id as a tiebreak). The run-plan launcher uses this to resolve a `source:'collection'`
   * plan to "all tests in the collection AT LAUNCH TIME" — a test added/removed between launches changes
   * the matrix, by design. Empty when the collection has no members (or is unknown; existence is validated
   * by the caller before launch).
   */
  listIdsByCollection(collectionId: string): string[] {
    const rows = this.db
      .prepare("SELECT id FROM tests WHERE collection_id = ? ORDER BY created_at ASC, id ASC")
      .all(collectionId) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  listAttachmentRecords(testId: string): AttachmentRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM test_attachments WHERE test_id = ? ORDER BY created_at ASC")
      .all(testId) as TestAttachmentRow[];
    return rows.map(toAttachmentRecord);
  }

  insertAttachment(record: AttachmentRecord): TestAttachment {
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO test_attachments (id, test_id, kind, name, path, bytes, created_at)
          VALUES (@id, @testId, @kind, @name, @path, @bytes, @createdAt)`,
      )
      .run({
        id: record.id,
        testId: record.testId,
        kind: record.kind,
        name: record.name,
        path: record.path,
        bytes: record.bytes,
        createdAt,
      });

    return { id: record.id, kind: record.kind, name: record.name, bytes: record.bytes, createdAt };
  }

  private hydrate(row: TestRow): Test {
    const attachments = this.listAttachments(row.id);
    return {
      id: row.id,
      name: row.name,
      userPrompt: row.user_prompt,
      systemPromptOverride: row.system_prompt_override ?? undefined,
      addedProfiles: parseJsonObject<TokenProfileRef[]>(row.added_profiles_json, []),
      attachments,
      assertions: parseJsonObject<TestAssertions | undefined>(row.assertions_json, undefined),
      expectations: parseJsonObject<TestExpectations | undefined>(row.expectations_json, undefined),
      category: row.category ?? undefined,
      difficulty: (row.difficulty ?? undefined) as Difficulty | undefined,
      tags: parseJsonObject<string[]>(row.tags_json, []),
      // Testing IA (WP 2.3) — expose collection membership on read so the web can filter the Tests tab
      // to a collection and show current membership in the move control (WP 3.1). Read-only projection
      // of the `collection_id` column; NULL = local-only. `external_key` stays git-engine-internal.
      collectionId: row.collection_id ?? null,
      // Observability (WP4.1) — draft flag. Serialized ONLY when true so an ordinary test's shape is
      // byte-identical to before (the omit-when-false discipline; existing snapshots stay green).
      ...(row.draft === 1 ? { draft: true } : {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private listAttachments(testId: string): TestAttachment[] {
    const rows = this.db
      .prepare("SELECT * FROM test_attachments WHERE test_id = ? ORDER BY created_at ASC")
      .all(testId) as TestAttachmentRow[];
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      name: row.name,
      bytes: row.bytes,
      createdAt: row.created_at,
    }));
  }

  private getRow(id: string): TestRow {
    const row = this.db.prepare("SELECT * FROM tests WHERE id = ?").get(id) as TestRow | undefined;
    if (!row) {
      throw httpError(404, "Test not found");
    }
    return row;
  }
}

function toAttachmentRecord(row: TestAttachmentRow): AttachmentRecord {
  return {
    id: row.id,
    testId: row.test_id,
    kind: row.kind,
    name: row.name,
    path: row.path,
    bytes: row.bytes,
  };
}
