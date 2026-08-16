import { nanoid } from "nanoid";
import type { Collection, CollectionInput } from "@mcp-token-footprint/shared";
import { collectionInputSchema, DEFAULT_COLLECTION_NAME } from "@mcp-token-footprint/shared";
import type { AppDatabase } from "../db/database.js";
import type { CollectionRow } from "../db/rows.js";
import type { SecretStore } from "../secrets/secret-store.js";
import { httpError } from "../utils/errors.js";

/**
 * Persistence for Benchmarks collections (WP 4.1, B10). PAT discipline mirrors
 * {@link ProviderRepository} EXACTLY: the PAT is encrypted before persistence, kept on an update that
 * omits it, and NEVER returned — {@link redact} exposes only a `hasPat` boolean. `decryptPat` is
 * INTERNAL (for the WP 4.2 git engine); no route ever calls it.
 *
 * Membership: assigning a test/suite stamps a fresh `external_key` (cross-system identity) and points
 * its `collection_id` here; moving it to a different collection re-keys (a fresh key, no unique-index
 * collision); removing (or deleting the collection) clears both, so the member becomes local-only. All
 * membership writes are direct UPDATEs on `tests`/`suites` from HERE — the tests/suites modules are
 * untouched.
 */
export class CollectionRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly secrets: SecretStore,
  ) {}

  list(): Collection[] {
    const rows = this.db
      .prepare("SELECT * FROM collections ORDER BY updated_at DESC")
      .all() as CollectionRow[];
    return rows.map(redact);
  }

  get(id: string): Collection {
    return redact(this.getRow(id));
  }

  create(input: CollectionInput): Collection {
    const parsed = collectionInputSchema.parse(input);

    // Local guarantee (D-T4): the reserved default name is genuinely reserved — no other collection may
    // claim it (case-insensitive). The one real default row is seeded by ensureLocalCollection(), never
    // by CRUD.
    if (isReservedDefaultName(parsed.name)) {
      throw httpError(
        409,
        `The name "${DEFAULT_COLLECTION_NAME}" is reserved for the default collection.`,
      );
    }

    const now = new Date().toISOString();
    const id = nanoid();
    const patEncrypted = parsed.pat?.trim() ? this.secrets.encryptText(parsed.pat.trim()) : null;

    // Testing IA (WP 2.1) — a collection may be LOCAL (no binding): the repo group is all-present or
    // all-absent (enforced by `collectionInputSchema`). Coerce an omitted field to NULL (better-sqlite3
    // rejects `undefined`). CRUD never creates the reserved default row (is_default defaults to 0).
    this.db
      .prepare(
        `INSERT INTO collections (
          id, name, repo_url, repo_path, branch, pat_encrypted, last_synced_sha, created_at, updated_at
        ) VALUES (
          @id, @name, @repoUrl, @repoPath, @branch, @patEncrypted, NULL, @createdAt, @updatedAt
        )`,
      )
      .run({
        id,
        name: parsed.name,
        repoUrl: parsed.repoUrl ?? null,
        repoPath: parsed.repoPath ?? null,
        branch: parsed.branch ?? null,
        patEncrypted,
        createdAt: now,
        updatedAt: now,
      });

    return this.get(id);
  }

  update(id: string, input: CollectionInput): Collection {
    const current = this.getRow(id);
    const parsed = collectionInputSchema.parse(input);
    const now = new Date().toISOString();

    // `collectionInputSchema` guarantees the repo group is all-present or all-absent, so `repoUrl`
    // presence stands in for the whole binding.
    const inputHasBinding = parsed.repoUrl !== undefined;

    // Local guarantee (D-T4): the reserved default collection is NEVER repo-bindable and its reserved
    // name is immutable (a no-op update to the same name still succeeds); no OTHER collection may claim
    // the reserved default name (case-insensitive).
    if (current.is_default === 1) {
      if (inputHasBinding) {
        throw httpError(
          409,
          `The default "${current.name}" collection cannot be bound to a repository.`,
        );
      }
      if (parsed.name !== current.name) {
        throw httpError(
          409,
          `The default "${current.name}" collection cannot be renamed (its name is reserved).`,
        );
      }
    } else if (isReservedDefaultName(parsed.name)) {
      throw httpError(
        409,
        `The name "${DEFAULT_COLLECTION_NAME}" is reserved for the default collection.`,
      );
    }

    // Bind-later / re-bind uses the supplied group; OMITTING the group preserves the current binding
    // (unbinding is out of scope, WP 2.1 — an owner call later), so a bound collection can be renamed
    // without re-sending its binding and can never be silently unbound.
    const repoUrl = inputHasBinding ? (parsed.repoUrl ?? null) : current.repo_url;
    const repoPath = inputHasBinding ? (parsed.repoPath ?? null) : current.repo_path;
    const branch = inputHasBinding ? (parsed.branch ?? null) : current.branch;

    // pat is write-only: a provided value rotates (or clears) the PAT; omitting it keeps the stored one.
    const patEncrypted =
      parsed.pat === undefined
        ? current.pat_encrypted
        : parsed.pat.trim()
          ? this.secrets.encryptText(parsed.pat.trim())
          : null;

    this.db
      .prepare(
        `UPDATE collections
          SET name = @name,
              repo_url = @repoUrl,
              repo_path = @repoPath,
              branch = @branch,
              pat_encrypted = @patEncrypted,
              updated_at = @updatedAt
        WHERE id = @id`,
      )
      .run({
        id,
        name: parsed.name,
        repoUrl,
        repoPath,
        branch,
        patEncrypted,
        updatedAt: now,
      });

    return this.get(id);
  }

  delete(id: string): void {
    const row = this.getRow(id); // 404 if unknown

    // Local guarantee (D-T4): the reserved default collection is undeletable.
    if (row.is_default === 1) {
      throw httpError(409, `The default "${row.name}" collection cannot be deleted.`);
    }

    // Reassign (never orphan) members: point them at the reserved "Local" collection so nothing is ever
    // collection-less (D-T4), clearing external_key (that git identity belonged to the deleted binding).
    // If no Local row exists (a bare test harness that skips ensureLocalCollection), fall back to
    // local-only (collection_id NULL) — the same end state as before, and re-homed on the next startup.
    const transaction = this.db.transaction(() => {
      const local = this.db
        .prepare("SELECT id FROM collections WHERE is_default = 1 LIMIT 1")
        .get() as { id: string } | undefined;
      const targetId = local && local.id !== id ? local.id : null;

      this.db
        .prepare(
          "UPDATE tests SET collection_id = @target, external_key = NULL WHERE collection_id = @id",
        )
        .run({ target: targetId, id });
      this.db
        .prepare(
          "UPDATE suites SET collection_id = @target, external_key = NULL WHERE collection_id = @id",
        )
        .run({ target: targetId, id });
      const result = this.db.prepare("DELETE FROM collections WHERE id = ?").run(id);
      if (result.changes === 0) {
        throw httpError(404, "Collection not found");
      }
    });
    transaction();
  }

  // INTERNAL ONLY (WP 4.2 git engine) — never leaves the API process; never exposed by a route.
  decryptPat(id: string): string | undefined {
    const row = this.getRow(id);
    return row.pat_encrypted ? this.secrets.decryptText(row.pat_encrypted) : undefined;
  }

  // --- membership -------------------------------------------------------------------------------

  /** Attach a test to a collection, stamping a fresh cross-system `external_key` (re-keys on a move). */
  assignTest(collectionId: string, testId: string): void {
    this.getRow(collectionId); // 404 if the collection is unknown
    const result = this.db
      .prepare(
        "UPDATE tests SET collection_id = @collectionId, external_key = @externalKey WHERE id = @testId",
      )
      .run({ collectionId, externalKey: nanoid(), testId });
    if (result.changes === 0) {
      throw httpError(404, "Test not found");
    }
  }

  /** Detach a test from any collection (clears both membership columns → local-only). */
  removeTest(testId: string): void {
    const result = this.db
      .prepare("UPDATE tests SET collection_id = NULL, external_key = NULL WHERE id = ?")
      .run(testId);
    if (result.changes === 0) {
      throw httpError(404, "Test not found");
    }
  }

  /** Attach a suite to a collection, stamping a fresh cross-system `external_key` (re-keys on a move). */
  assignSuite(collectionId: string, suiteId: string): void {
    this.getRow(collectionId);
    const result = this.db
      .prepare(
        "UPDATE suites SET collection_id = @collectionId, external_key = @externalKey WHERE id = @suiteId",
      )
      .run({ collectionId, externalKey: nanoid(), suiteId });
    if (result.changes === 0) {
      throw httpError(404, "Suite not found");
    }
  }

  /** Detach a suite from any collection (clears both membership columns → local-only). */
  removeSuite(suiteId: string): void {
    const result = this.db
      .prepare("UPDATE suites SET collection_id = NULL, external_key = NULL WHERE id = ?")
      .run(suiteId);
    if (result.changes === 0) {
      throw httpError(404, "Suite not found");
    }
  }

  private getRow(id: string): CollectionRow {
    const row = this.db.prepare("SELECT * FROM collections WHERE id = ?").get(id) as
      | CollectionRow
      | undefined;
    if (!row) {
      throw httpError(404, "Collection not found");
    }
    return row;
  }
}

/** True when `name` (trimmed, case-insensitive) claims the reserved default collection name ("Local"). */
function isReservedDefaultName(name: string): boolean {
  return name.trim().toLowerCase() === DEFAULT_COLLECTION_NAME.toLowerCase();
}

// redact() → Collection with hasPat = Boolean(pat_encrypted); NEVER the PAT value. `isDefault` reflects
// the reserved "Local" collection; the repo fields are NULL for a local/unbound collection (WP 2.1).
function redact(row: CollectionRow): Collection {
  return {
    id: row.id,
    name: row.name,
    isDefault: row.is_default === 1,
    repoUrl: row.repo_url,
    repoPath: row.repo_path,
    branch: row.branch,
    hasPat: Boolean(row.pat_encrypted),
    lastSyncedSha: row.last_synced_sha,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
