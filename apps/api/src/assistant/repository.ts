// Assistant (WP 0.1) — persistence for the embedded Claude agent chat feature
// (planning/Roadmap/RM-02-assistant/00-plan.md §4, decisions D-AS1…D-AS18). This repository owns the three
// migration-v20 tables (`assistant_credentials`, `assistant_threads`, `assistant_events`) and is the
// ONLY code in the app that touches them directly — later WPs (session engine WP 1.1, auth routes
// WP 0.2, permission protocol WP 2.1) build on top of it rather than querying SQLite themselves.
//
// Secrets discipline (mirrors `providers/repository.ts`): `token_encrypted` is encrypted via
// `SecretStore` on write and is NEVER returned by a public read (`getCredential`/`listCredentials`
// return the redacted `AssistantCredentialSummary`, which carries no token field at all). Only
// `getDecrypted()` — marked INTERNAL ONLY below, mirroring `providers/repository.ts:106` — returns
// the plaintext token, and only for the session engine's spawn-env builder to inject into the SDK
// child's environment. No route may call it.
import { nanoid } from "nanoid";
import {
  ASSISTANT_DEFAULT_THREAD_TITLE,
  type AssistantAuthSource,
  type AssistantCredentialKind,
  type AssistantEvent,
  type AssistantEventInput,
  type AssistantThread,
  type AssistantThreadCreateInput,
  type AssistantThreadUpdateInput,
} from "@mcp-token-footprint/shared";
import type { AppDatabase } from "../db/database.js";
import type { AssistantCredentialRow, AssistantEventRow, AssistantThreadRow } from "../db/rows.js";
import type { SecretStore } from "../secrets/secret-store.js";
import { httpError } from "../utils/errors.js";
import { parseJsonObject, stableStringify } from "../utils/json.js";

/**
 * A stored credential's REDACTED shape — never carries the token. Repository-local (not in
 * `packages/shared`): no route in this WP returns it yet — WP 0.2 builds the
 * `GET /api/assistant/auth/status` response on top of this repository and defines its own wire
 * shape (`AssistantAuthStatus`) there.
 */
export type AssistantCredentialSummary = {
  id: string;
  kind: AssistantCredentialKind;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
};

/**
 * INTERNAL ONLY — the decrypted credential, for the session engine's spawn-env builder
 * (`apps/api/src/assistant/spawn-env.ts`, WP 0.3) to inject as the single `CLAUDE_CODE_OAUTH_TOKEN`
 * env var. Never leaves the API process; never exposed by any route.
 */
export type DecryptedAssistantCredential = {
  id: string;
  kind: AssistantCredentialKind;
  token: string;
};

export type AssistantThreadFilter = {
  entityKind?: string;
  entityId?: string;
};

// WP 1.2 replaces this with the live roster the SDK/plan reports (D-AS10: "always read the roster
// from the SDK/CLI rather than hardcoding" — this default only covers thread creation before that
// roster exists).
const DEFAULT_MODEL = "claude-sonnet-4-5";

export class AssistantRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly secrets: SecretStore,
  ) {}

  // ── Threads ──────────────────────────────────────────────────────────────────────────────────

  createThread(input: AssistantThreadCreateInput): AssistantThread {
    const now = new Date().toISOString();
    const id = nanoid();
    this.db
      .prepare(
        `INSERT INTO assistant_threads (
           id, title, entity_kind, entity_id, model, auth_source, sdk_session_id, status, auto_accept, created_at, updated_at
         ) VALUES (
           @id, @title, @entityKind, @entityId, @model, @authSource, NULL, 'idle', @autoAccept, @createdAt, @updatedAt
         )`,
      )
      .run({
        id,
        title: input.title?.trim() || ASSISTANT_DEFAULT_THREAD_TITLE,
        entityKind: input.entityKind ?? null,
        entityId: input.entityId ?? null,
        model: input.model?.trim() || DEFAULT_MODEL,
        authSource: input.authSource ?? "subscription",
        // Honor the wire's optional `autoAccept` (the create schema accepts it) — a thread can be born
        // with auto-accept ON, so the dock can (re)create a thread carrying the owner's chosen write
        // mode when the active one 404s (mirrors the model-on-create path). Defaults OFF.
        autoAccept: boolToInt(input.autoAccept ?? false),
        createdAt: now,
        updatedAt: now,
      });
    return this.getThread(id);
  }

  getThread(id: string): AssistantThread {
    return toThread(this.getThreadRow(id));
  }

  listThreads(filter: AssistantThreadFilter = {}): AssistantThread[] {
    const where: string[] = [];
    const params: Record<string, string> = {};
    if (filter.entityKind) {
      where.push("entity_kind = @entityKind");
      params.entityKind = filter.entityKind;
    }
    if (filter.entityId) {
      where.push("entity_id = @entityId");
      params.entityId = filter.entityId;
    }
    const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    // Secondary tiebreak on `rowid` (SQLite's implicit insertion-order key — this table has no
    // `WITHOUT ROWID` clause) so two threads created within the same millisecond still sort
    // deterministically (most-recently-created first), instead of falling back to storage order.
    const rows = this.db
      .prepare(`SELECT * FROM assistant_threads ${clause} ORDER BY updated_at DESC, rowid DESC`)
      .all(params) as AssistantThreadRow[];
    return rows.map(toThread);
  }

  /**
   * Threads pinned to one specific app entity (D-AS15 — the dock switcher's "threads pinned to the
   * current entity" section). A thin, named wrapper over {@link listThreads} so callers don't have
   * to remember the filter shape.
   */
  listByEntity(entityKind: string, entityId: string): AssistantThread[] {
    return this.listThreads({ entityKind, entityId });
  }

  /** Client-writable fields only (title/model/auto-accept — see `assistantThreadUpdateSchema`). */
  updateThread(id: string, update: AssistantThreadUpdateInput): AssistantThread {
    const current = this.getThreadRow(id);
    this.db
      .prepare(
        `UPDATE assistant_threads
           SET title = @title, model = @model, auto_accept = @autoAccept, updated_at = @updatedAt
         WHERE id = @id`,
      )
      .run({
        id,
        title: update.title !== undefined ? update.title : current.title,
        model: update.model !== undefined ? update.model : current.model,
        autoAccept:
          update.autoAccept !== undefined ? boolToInt(update.autoAccept) : current.auto_accept,
        updatedAt: new Date().toISOString(),
      });
    return this.getThread(id);
  }

  /**
   * Session-manager-owned status/session-id transition (WP 1.1 — running/idle-park/resume/error).
   * Deliberately a SEPARATE method from {@link updateThread}: the wire `PATCH` schema
   * (`assistantThreadUpdateSchema`) has no `status`/`sdkSessionId` fields, so this is the only path
   * that can change them — a client request can never smuggle a session-state change through.
   */
  setSessionState(
    id: string,
    patch: { status?: AssistantThread["status"]; sdkSessionId?: string | null },
  ): AssistantThread {
    const current = this.getThreadRow(id);
    this.db
      .prepare(
        `UPDATE assistant_threads
           SET status = @status, sdk_session_id = @sdkSessionId, updated_at = @updatedAt
         WHERE id = @id`,
      )
      .run({
        id,
        status: patch.status ?? current.status,
        sdkSessionId:
          patch.sdkSessionId !== undefined ? patch.sdkSessionId : current.sdk_session_id,
        updatedAt: new Date().toISOString(),
      });
    return this.getThread(id);
  }

  /**
   * WP 3.3 (D-AS14) — the ONLY path that changes a thread's `authSource`. Deliberately SEPARATE from
   * {@link updateThread}: the wire `PATCH` schema has no `authSource` field, so an ordinary thread
   * update (or any other client request) can never smuggle a source change through — only the
   * explicit `POST .../retry-source` route (`AssistantSessionManager.retrySource`) calls this.
   */
  setAuthSource(id: string, source: AssistantAuthSource): AssistantThread {
    this.getThreadRow(id); // 404 if unknown
    this.db
      .prepare(
        `UPDATE assistant_threads
           SET auth_source = @source, updated_at = @updatedAt
         WHERE id = @id`,
      )
      .run({ id, source, updatedAt: new Date().toISOString() });
    return this.getThread(id);
  }

  /** Thread ids whose `updated_at` is strictly before `cutoffIso` — WP 3.3's day-based retention
   *  prune (`retention.ts`'s `pruneAssistantData`). */
  listThreadIdsUpdatedBefore(cutoffIso: string): string[] {
    const rows = this.db
      .prepare("SELECT id FROM assistant_threads WHERE updated_at < ?")
      .all(cutoffIso) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  /**
   * On API restart, any thread still marked `running` lost its in-memory SDK child (the process is
   * gone). Reconcile each to `idle` AND append a synthesized settled `error` event so the interrupted
   * turn is visible on replay (mirrors `RunRepository.abortOrphanedRuns` — but the parked SDK session
   * id is kept, so the NEXT message resumes the conversation rather than starting cold). Returns the
   * number of threads reconciled. Wired in `index.ts` next to the repo construction, before routes.
   */
  reconcileOrphanThreads(): number {
    const orphans = this.db
      .prepare("SELECT id FROM assistant_threads WHERE status = 'running'")
      .all() as Array<{ id: string }>;
    for (const { id } of orphans) {
      this.appendEvent(id, {
        type: "error",
        message: "The Assistant session was interrupted by a server restart.",
      });
      this.setSessionState(id, { status: "idle" });
    }
    return orphans.length;
  }

  /** Cascades to the thread's `assistant_events` rows (FK `ON DELETE CASCADE`). */
  deleteThread(id: string): void {
    const result = this.db.prepare("DELETE FROM assistant_threads WHERE id = ?").run(id);
    if (result.changes === 0) throw httpError(404, "Assistant thread not found");
  }

  // ── Events (append-only, per-thread monotonic seq) ──────────────────────────────────────────

  /**
   * Append one settled event to a thread's replayable log. Stamps a PER-THREAD monotonic `seq`
   * (1, 2, 3…, derived from the current max — the caller never supplies one, so two concurrent
   * appends for different threads never collide) and `createdAt`. There is no update/delete for a
   * single event — the log is append-only; only {@link deleteThread} removes events (cascade).
   */
  appendEvent(threadId: string, event: AssistantEventInput): AssistantEvent {
    this.getThreadRow(threadId); // 404s with a clean message if the thread doesn't exist
    const seq = this.nextSeq(threadId);
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO assistant_events (id, thread_id, seq, type, payload_json, created_at)
         VALUES (@id, @threadId, @seq, @type, @payloadJson, @createdAt)`,
      )
      .run({
        id: nanoid(),
        threadId,
        seq,
        type: event.type,
        payloadJson: stableStringify(event),
        createdAt,
      });
    return { ...event, seq, createdAt } as AssistantEvent;
  }

  /** Every settled event for a thread, ordered by `seq` ascending (the full replay log). */
  listEvents(threadId: string): AssistantEvent[] {
    const rows = this.db
      .prepare("SELECT * FROM assistant_events WHERE thread_id = ? ORDER BY seq ASC")
      .all(threadId) as AssistantEventRow[];
    return rows.map(toEvent);
  }

  private nextSeq(threadId: string): number {
    const row = this.db
      .prepare("SELECT COALESCE(MAX(seq), 0) AS maxSeq FROM assistant_events WHERE thread_id = ?")
      .get(threadId) as { maxSeq: number };
    return row.maxSeq + 1;
  }

  // ── Credentials ──────────────────────────────────────────────────────────────────────────────

  createCredential(input: {
    kind: AssistantCredentialKind;
    token: string;
    label?: string;
  }): AssistantCredentialSummary {
    const now = new Date().toISOString();
    const id = nanoid();
    this.db
      .prepare(
        `INSERT INTO assistant_credentials (id, kind, token_encrypted, label, created_at, last_used_at)
         VALUES (@id, @kind, @tokenEncrypted, @label, @createdAt, NULL)`,
      )
      .run({
        id,
        kind: input.kind,
        tokenEncrypted: this.secrets.encryptText(input.token),
        label: input.label ?? null,
        createdAt: now,
      });
    return this.getCredential(id);
  }

  getCredential(id: string): AssistantCredentialSummary {
    return redactCredential(this.getCredentialRow(id));
  }

  listCredentials(): AssistantCredentialSummary[] {
    const rows = this.db
      .prepare("SELECT * FROM assistant_credentials ORDER BY created_at DESC")
      .all() as AssistantCredentialRow[];
    return rows.map(redactCredential);
  }

  deleteCredential(id: string): void {
    const result = this.db.prepare("DELETE FROM assistant_credentials WHERE id = ?").run(id);
    if (result.changes === 0) throw httpError(404, "Assistant credential not found");
  }

  touchCredentialLastUsed(id: string): void {
    const result = this.db
      .prepare("UPDATE assistant_credentials SET last_used_at = @now WHERE id = @id")
      .run({ id, now: new Date().toISOString() });
    if (result.changes === 0) throw httpError(404, "Assistant credential not found");
  }

  /**
   * INTERNAL ONLY — never leaves the API process; never exposed by any route. Mirrors the marking
   * at `providers/repository.ts:106`. The session engine's spawn-env builder (WP 0.3) is the only
   * intended caller: it reads the plaintext token here and injects it as the SDK child's single
   * `CLAUDE_CODE_OAUTH_TOKEN` env var — never logged, never persisted anywhere else.
   */
  getDecrypted(id: string): DecryptedAssistantCredential {
    const row = this.getCredentialRow(id);
    return { id: row.id, kind: row.kind, token: this.secrets.decryptText(row.token_encrypted) };
  }

  // ── Settings (WP 0.2) — single-row (id = 1) config: the API-key fallback pointer (D-AS14) ────────

  /**
   * The currently-configured API-key fallback's `provider_credentials` id, or `null` when none is set
   * (D-AS14). Only a REFERENCE is stored — the key itself is never duplicated into the assistant
   * tables. The FK's `ON DELETE SET NULL` guarantees this never points at a deleted credential.
   */
  getFallbackProviderCredentialId(): string | null {
    const row = this.db
      .prepare("SELECT fallback_provider_credential_id AS ref FROM assistant_settings WHERE id = 1")
      .get() as { ref: string | null } | undefined;
    return row?.ref ?? null;
  }

  /**
   * Set (or, with `null`, clear) the API-key fallback pointer. Upserts the single `id = 1` row. The
   * caller (auth service) MUST have already validated that `providerCredentialId` references an
   * existing anthropic-kind credential — this method only persists the reference.
   */
  setFallbackProviderCredentialId(providerCredentialId: string | null): void {
    this.db
      .prepare(
        `INSERT INTO assistant_settings (id, fallback_provider_credential_id, updated_at)
         VALUES (1, @ref, @updatedAt)
         ON CONFLICT(id) DO UPDATE SET
           fallback_provider_credential_id = excluded.fallback_provider_credential_id,
           updated_at = excluded.updated_at`,
      )
      .run({ ref: providerCredentialId, updatedAt: new Date().toISOString() });
  }

  private getThreadRow(id: string): AssistantThreadRow {
    const row = this.db.prepare("SELECT * FROM assistant_threads WHERE id = ?").get(id) as
      | AssistantThreadRow
      | undefined;
    if (!row) throw httpError(404, "Assistant thread not found");
    return row;
  }

  private getCredentialRow(id: string): AssistantCredentialRow {
    const row = this.db.prepare("SELECT * FROM assistant_credentials WHERE id = ?").get(id) as
      | AssistantCredentialRow
      | undefined;
    if (!row) throw httpError(404, "Assistant credential not found");
    return row;
  }
}

function toThread(row: AssistantThreadRow): AssistantThread {
  return {
    id: row.id,
    title: row.title,
    entityKind: (row.entity_kind ?? undefined) as AssistantThread["entityKind"],
    entityId: row.entity_id ?? undefined,
    model: row.model,
    authSource: row.auth_source,
    sdkSessionId: row.sdk_session_id ?? undefined,
    status: row.status,
    autoAccept: row.auto_accept === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * The stored payload is the redacted event itself (minus `seq`/`createdAt`, which live in their own
 * columns) — reconstruct it as-is and overlay the row's `seq`/`createdAt`. Mirrors
 * `testing/run-repository.ts`'s `toRunEvent`.
 */
function toEvent(row: AssistantEventRow): AssistantEvent {
  const parsed = parseJsonObject<Record<string, unknown>>(row.payload_json, { type: row.type });
  return { ...parsed, seq: row.seq, createdAt: row.created_at } as AssistantEvent;
}

function redactCredential(row: AssistantCredentialRow): AssistantCredentialSummary {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

function boolToInt(value: boolean): number {
  return value ? 1 : 0;
}
