// Observability — full-text search over run content (roadmap/observability/, WP1.3, D-OB16).
//
// An SQLite FTS5 index (`run_search`) over the seven content classes a run produces, populated at
// PERSISTENCE time (the run-repository step/terminal write path + the grade-repository rating write),
// backfilled ONCE on startup, queried through the RunFilter `q` field, and rebuilt on demand via
// `POST /api/maintenance/reindex-search`.
//
// DERIVED STATE (conventions §1): every indexed document is reconstructable from
// `runs`/`run_steps`/`run_grades`, so losing the index never loses truth — `reindexSearch` restores it
// fully. Nothing is stored here that isn't already in those authoritative tables.
//
// Tokenizer: `unicode61` (the FTS5 default) — Unicode-aware word splitting + diacritic folding + case
// folding, so `café`/`CAFE` and prefix queries behave predictably across scripts. Prefix matching is on
// (each query term becomes a quoted prefix phrase `"term"*`), which is also injection-safe: a raw user
// string is tokenized to letter/number runs and each is quoted, so no FTS5 operator/keyword leaks in.

import {
  SEARCH_CONTENT_LIMITS,
  SEARCH_INDEX_VERSION,
  type SearchContentClass,
} from "@mcp-token-footprint/shared";
import type { AppDatabase } from "../db/database.js";
import { parseJsonObject } from "../utils/json.js";

/**
 * The full-text index DDL — the SINGLE source of truth, used by three places so the fresh-DB baseline
 * and the upgrade path can never drift (the WP1.3 migration footgun):
 *   1. `schema.ts` baseline (fresh DBs / any `db.exec(schemaSql)` test — which never call `applyMigrations`),
 *   2. the v33 migration `up` (an existing on-disk DB stamped < 33), and
 *   3. `reindexSearch` (drop + recreate).
 * Every statement is `IF NOT EXISTS`, so it is a correct no-op when more than one path runs it.
 *
 * `run_search` is a regular (self-contained) FTS5 table — it stores the truncated content so `snippet()`
 * works and rows can be deleted by rowid. `run_search_map` is the small docmap giving each logical
 * document `(run_id, step_id, kind)` a stable, indexed handle to its FTS `rowid`, so writes are an O(1)
 * idempotent upsert and a run's rows purge in O(its docs) (never a full-table scan of the FTS content).
 * The map's `ON DELETE CASCADE` keeps it consistent when a run is removed via a parent (test/scenario)
 * cascade — the FTS rows orphaned by that path are inert (the read path INNER-JOINs matches back to
 * `runs`, so an orphan whose run is gone never surfaces) and are reclaimed by the next reindex; the
 * DIRECT run-delete path purges both explicitly (see {@link RunSearchIndex.purgeRun}).
 */
export const RUN_SEARCH_DDL = `
CREATE VIRTUAL TABLE IF NOT EXISTS run_search USING fts5(
  run_id UNINDEXED,
  step_id UNINDEXED,
  kind UNINDEXED,
  content,
  tokenize = 'unicode61'
);
CREATE TABLE IF NOT EXISTS run_search_map (
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  step_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  doc_rowid INTEGER NOT NULL,
  PRIMARY KEY (run_id, step_id, kind)
);
`;

// Synthetic step-id slots for the run-level (non per-step) documents, so each has a stable idempotency key.
const META_STEP_ID = "__meta__";
const OPENER_STEP_ID = "__opener__";
const TERMINAL_STEP_ID = "__terminal__";

// ── FTS query builder ────────────────────────────────────────────────────────────────────────────

/**
 * Turn a raw user query into a safe FTS5 MATCH expression, or `null` when it carries no searchable
 * token (e.g. only punctuation) — the caller then returns no matches. Each Unicode letter/number run
 * becomes a case-folded, quoted PREFIX phrase (`"term"*`), joined by spaces (FTS5's implicit AND). The
 * quoting makes the expression immune to FTS5 operator/keyword injection (`AND`, `OR`, `NEAR`, `*`,
 * `"`, `(`…): the user string can never break out of a phrase literal.
 */
export function buildFtsMatch(q: string): string | null {
  const terms = q
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (terms.length === 0) return null;
  return terms.map((t) => `"${t.replace(/"/g, '""')}"*`).join(" ");
}

/** One best-match preview for a run: the content class + the FTS `snippet()` highlight. */
export type RunSearchHit = { kind: SearchContentClass; snippet: string };

/**
 * The best FTS snippet per run for a given MATCH expression, over a bounded set of run ids (the feed's
 * current page). Runs a DIRECT `run_search MATCH` query (snippet()/rank are only usable in that context,
 * never inside a join/group), ordered by `rank` so the FIRST row seen per run is its best match. Keeps
 * the snippet cost proportional to the page size, not the whole match set.
 */
export function fetchSnippets(
  db: AppDatabase,
  match: string,
  runIds: readonly string[],
): Map<string, RunSearchHit> {
  const best = new Map<string, RunSearchHit>();
  if (runIds.length === 0) return best;
  const placeholders = runIds.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT run_id AS runId, kind, snippet(run_search, 3, '[', ']', '…', 12) AS snippet
         FROM run_search
        WHERE run_search MATCH ? AND run_id IN (${placeholders})
        ORDER BY rank`,
    )
    .all(match, ...runIds) as Array<{ runId: string; kind: string; snippet: string }>;
  for (const row of rows) {
    // First row per run (rank ASC ⇒ best match) wins.
    if (!best.has(row.runId)) {
      best.set(row.runId, { kind: row.kind as SearchContentClass, snippet: row.snippet });
    }
  }
  return best;
}

// ── Content extraction (shared by the live write path AND backfill — identical inputs, identical docs) ──

// Object keys whose VALUES are (or commonly carry) encoded binary — never a source of searchable prose.
const BINARY_KEY = /^(data|blob|bytes|base64|b64|image|buffer|content_base64)$/i;

/**
 * A string that is (almost certainly) an encoded binary payload rather than prose, so it must be SKIPPED
 * (D-OB16 — "SKIP non-text and base64-looking payloads"). Catches `data:` URIs and long, whitespace-free
 * runs of the base64 alphabet. Prose always has spaces, so a real sentence is never mistaken for base64.
 */
function looksBase64(value: string): boolean {
  const t = value.trim();
  if (/^data:[^;,]{0,80};base64,/i.test(t)) return true;
  if (t.length < 64) return false;
  if (/\s/.test(t)) return false; // base64 blobs have no interior whitespace
  return /^[A-Za-z0-9+/]+={0,2}$/.test(t);
}

/** A string with a high proportion of control / non-text bytes — a binary payload; SKIP it. */
function looksBinary(value: string): boolean {
  if (value.length === 0) return false;
  const sample = Math.min(value.length, 4096);
  let ctrl = 0;
  for (let i = 0; i < sample; i++) {
    const c = value.charCodeAt(i);
    if (c === 0 || c === 0xfffd || (c < 32 && c !== 9 && c !== 10 && c !== 13)) ctrl++;
  }
  return ctrl / sample > 0.1;
}

/** True when a string is worth indexing (real text, not an encoded/binary payload). */
function isIndexableText(value: string): boolean {
  return value.length > 0 && !looksBase64(value) && !looksBinary(value);
}

/**
 * Collect the indexable prose from an arbitrary (already-redacted) value: every string leaf that is real
 * text, skipping binary-shaped strings + binary-named object keys. Cycle-safe and length-bounded (it
 * stops collecting once well past the largest class cap, so a huge structure can't blow up here).
 */
function collectText(value: unknown, budget = 8192): string {
  const parts: string[] = [];
  let used = 0;
  const seen = new WeakSet<object>();
  const walk = (node: unknown): void => {
    if (used >= budget) return;
    if (typeof node === "string") {
      if (isIndexableText(node)) {
        parts.push(node);
        used += node.length + 1;
      }
      return;
    }
    if (typeof node === "number" || typeof node === "boolean") {
      const s = String(node);
      parts.push(s);
      used += s.length + 1;
      return;
    }
    if (node === null || typeof node !== "object") return;
    if (seen.has(node as object)) return;
    seen.add(node as object);
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    for (const [key, item] of Object.entries(node as Record<string, unknown>)) {
      if (BINARY_KEY.test(key)) continue; // an image/blob field — never index its value
      walk(item);
    }
  };
  walk(value);
  return parts.join(" ");
}

/** Collapse whitespace + truncate to a class cap (CHARACTERS) — the exact bytes stored in the index. */
function normalizeForClass(raw: string, kind: SearchContentClass): string {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  const cap = SEARCH_CONTENT_LIMITS[kind];
  return collapsed.length > cap ? collapsed.slice(0, cap) : collapsed;
}

/**
 * The searchable TEXT of a tool result. An MCP tool result is `{ content: [{type, text|data}], … }` —
 * only `type:"text"` parts carry prose; `image`/`audio`/`resource` (base64) parts are SKIPPED entirely
 * (D-OB16), so an image-only result yields no document. Any non-MCP-shaped result falls back to the
 * generic collector (which still drops base64/binary strings).
 */
function extractToolResultText(result: unknown): string {
  if (result !== null && typeof result === "object" && !Array.isArray(result)) {
    const content = (result as Record<string, unknown>).content;
    if (Array.isArray(content)) {
      const parts: string[] = [];
      for (const item of content) {
        if (item !== null && typeof item === "object" && (item as Record<string, unknown>).type === "text") {
          const text = (item as Record<string, unknown>).text;
          if (typeof text === "string" && isIndexableText(text)) parts.push(text);
        }
        // image / audio / resource (base64) parts carry no prose — skip them.
      }
      return parts.join(" ");
    }
  }
  return collectText(result);
}

/** Read one property off an (already-redacted) step payload object; `undefined` for a non-object. */
function payloadField(payload: unknown, key: string): unknown {
  return payload !== null && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)[key]
    : undefined;
}

/** The already-persisted (redacted) shape a step contributes to the index — identical for live + backfill. */
export type IndexableStep = {
  type: string;
  toolName?: string;
  label?: string;
  assistantText?: string | null;
  /** The REDACTED payload (what `run_steps.payload_json` stores), so the index never carries a secret. */
  payload: unknown;
};

/** The already-persisted rating fields a grade contributes to the index. */
export type IndexableGrade = {
  reasoning?: string | null;
  method?: string | null;
  evidence?: unknown;
};

// ── The index writer ──────────────────────────────────────────────────────────────────────────────

type MapRow = { doc_rowid: number };

/**
 * Idempotent writer over `run_search` + `run_search_map`. Every public method is a no-op when the DB
 * lacks the index tables (a minimal fixture), so constructing this against any DB is safe. Callers on
 * the persistence hot path wrap invocations in try/catch — a search-index failure must NEVER break the
 * authoritative run write (derived state, conventions §1).
 */
export class RunSearchIndex {
  readonly enabled: boolean;
  private readonly selMap;
  private readonly selMapByRun;
  private readonly insFts;
  private readonly delFts;
  private readonly upsertMap;
  private readonly delMap;
  private readonly delMapByRun;

  constructor(private readonly db: AppDatabase) {
    this.enabled = Boolean(
      db
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'run_search'")
        .get() &&
        db
          .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'run_search_map'")
          .get(),
    );
    if (!this.enabled) {
      // Leave the statement handles unassigned; every method guards on `enabled`.
      this.selMap = this.selMapByRun = this.insFts = this.delFts = this.upsertMap = this.delMap =
        this.delMapByRun = undefined as never;
      return;
    }
    this.selMap = db.prepare(
      "SELECT doc_rowid FROM run_search_map WHERE run_id = @runId AND step_id = @stepId AND kind = @kind",
    );
    this.selMapByRun = db.prepare("SELECT doc_rowid FROM run_search_map WHERE run_id = ?");
    this.insFts = db.prepare(
      "INSERT INTO run_search (run_id, step_id, kind, content) VALUES (@runId, @stepId, @kind, @content)",
    );
    this.delFts = db.prepare("DELETE FROM run_search WHERE rowid = ?");
    this.upsertMap = db.prepare(
      `INSERT INTO run_search_map (run_id, step_id, kind, doc_rowid) VALUES (@runId, @stepId, @kind, @docRowid)
       ON CONFLICT(run_id, step_id, kind) DO UPDATE SET doc_rowid = excluded.doc_rowid`,
    );
    this.delMap = db.prepare(
      "DELETE FROM run_search_map WHERE run_id = @runId AND step_id = @stepId AND kind = @kind",
    );
    this.delMapByRun = db.prepare("DELETE FROM run_search_map WHERE run_id = ?");
  }

  /** Upsert one logical document `(runId, stepId, kind)` with normalized/truncated content. Empty content
   *  removes any prior document for that key (so re-indexing content that became empty is consistent). */
  private putDoc(runId: string, stepId: string, kind: SearchContentClass, rawContent: string): void {
    if (!this.enabled) return;
    const content = normalizeForClass(rawContent, kind);
    if (content.length === 0) {
      this.removeDoc(runId, stepId, kind);
      return;
    }
    const existing = this.selMap.get({ runId, stepId, kind }) as MapRow | undefined;
    if (existing) this.delFts.run(existing.doc_rowid);
    const info = this.insFts.run({ runId, stepId, kind, content });
    this.upsertMap.run({ runId, stepId, kind, docRowid: Number(info.lastInsertRowid) });
  }

  private removeDoc(runId: string, stepId: string, kind: SearchContentClass): void {
    if (!this.enabled) return;
    const existing = this.selMap.get({ runId, stepId, kind }) as MapRow | undefined;
    if (!existing) return;
    this.delFts.run(existing.doc_rowid);
    this.delMap.run({ runId, stepId, kind });
  }

  /** Run-level meta + opener prompt (test title / environment / model + the test's user prompt). Looked
   *  up from the authoritative rows, so live (at `createRun`) and backfill produce identical documents. */
  indexRunMeta(runId: string): void {
    if (!this.enabled) return;
    const row = this.db
      .prepare(
        `SELECT t.name AS testName, s.name AS scenarioName, s.model AS model, t.user_prompt AS userPrompt
           FROM runs r
           JOIN tests t ON t.id = r.test_id
           JOIN scenarios s ON s.id = r.scenario_id
          WHERE r.id = ?`,
      )
      .get(runId) as
      | { testName: string; scenarioName: string; model: string; userPrompt: string }
      | undefined;
    if (!row) return;
    this.putDoc(
      runId,
      META_STEP_ID,
      "meta",
      [row.testName, row.scenarioName, row.model].filter(Boolean).join(" "),
    );
    if (row.userPrompt) this.putDoc(runId, OPENER_STEP_ID, "prompt", row.userPrompt);
  }

  /** Index one persisted step by class. `stepIdx` is the per-run monotonic `run_steps.idx` (the doc key). */
  indexStep(runId: string, stepIdx: number, step: IndexableStep): void {
    if (!this.enabled) return;
    const stepId = String(stepIdx);
    if (step.type === "user_message") {
      this.putDoc(runId, stepId, "prompt", collectText(step.payload));
    } else if (step.type === "tool_call") {
      const name = step.toolName ?? step.label ?? "";
      const args = collectText(payloadField(step.payload, "args"));
      this.putDoc(runId, stepId, "tool", `${name} ${args}`.trim());
    } else if (step.type === "tool_result") {
      const result = payloadField(step.payload, "result");
      if (result !== undefined) {
        this.putDoc(runId, stepId, "tool_result", extractToolResultText(result));
      }
      // A tool that failed carries an error STRING (not a result) — that's an error-class document.
      const errStr = payloadField(step.payload, "error");
      if (typeof errStr === "string") this.putDoc(runId, stepId, "error", errStr);
    }
    // Any step carrying assistant prose (an `llm_response`) → assistant class.
    if (typeof step.assistantText === "string" && step.assistantText.length > 0) {
      this.putDoc(runId, stepId, "assistant", step.assistantText);
    }
  }

  /** The run-level error document: the human `stopReason` on the terminal disposition. */
  indexTerminal(runId: string, stopReason: string | null | undefined): void {
    if (!this.enabled) return;
    if (stopReason && stopReason.length > 0) {
      this.putDoc(runId, TERMINAL_STEP_ID, "error", stopReason);
    } else {
      this.removeDoc(runId, TERMINAL_STEP_ID, "error");
    }
  }

  /** One judge grade → the rating document (verdict text + flattened forensics summaries / fix targets). */
  indexRating(runId: string, gradeId: string, grade: IndexableGrade): void {
    if (!this.enabled) return;
    const content = [grade.reasoning ?? "", grade.method ?? "", collectText(grade.evidence)]
      .filter((s) => s.length > 0)
      .join(" ");
    this.putDoc(runId, gradeId, "rating", content);
  }

  /** Purge every document of a run (the DIRECT run-delete path). Removes the FTS rows by rowid, then the
   *  map rows. Idempotent — a run with no documents is a no-op. */
  purgeRun(runId: string): void {
    if (!this.enabled) return;
    const rows = this.selMapByRun.all(runId) as MapRow[];
    for (const row of rows) this.delFts.run(row.doc_rowid);
    this.delMapByRun.run(runId);
  }

  /** Total document count (for the reindex result / diagnostics). */
  count(): number {
    if (!this.enabled) return 0;
    return (this.db.prepare("SELECT COUNT(*) AS n FROM run_search").get() as { n: number }).n;
  }
}

// ── Backfill / reindex (one-shot + on-demand rebuild) ──────────────────────────────────────────────

/** Index every document of a single run from its authoritative rows. Idempotent (safe to re-run). */
export function backfillRun(index: RunSearchIndex, db: AppDatabase, runId: string): void {
  index.indexRunMeta(runId);
  const run = db.prepare("SELECT stop_reason FROM runs WHERE id = ?").get(runId) as
    | { stop_reason: string | null }
    | undefined;
  index.indexTerminal(runId, run?.stop_reason);
  const steps = db
    .prepare(
      `SELECT idx, type, label, tool_name AS toolName, assistant_text AS assistantText, payload_json AS payloadJson
         FROM run_steps WHERE run_id = ? ORDER BY idx ASC`,
    )
    .all(runId) as Array<{
    idx: number;
    type: string;
    label: string;
    toolName: string | null;
    assistantText: string | null;
    payloadJson: string;
  }>;
  for (const s of steps) {
    index.indexStep(runId, s.idx, {
      type: s.type,
      toolName: s.toolName ?? undefined,
      label: s.label,
      assistantText: s.assistantText,
      payload: parseJsonObject<unknown>(s.payloadJson, null),
    });
  }
  const grades = db
    .prepare(
      "SELECT id, reasoning, method, evidence_json AS evidenceJson FROM run_grades WHERE run_id = ?",
    )
    .all(runId) as Array<{
    id: string;
    reasoning: string | null;
    method: string | null;
    evidenceJson: string | null;
  }>;
  for (const g of grades) {
    index.indexRating(runId, g.id, {
      reasoning: g.reasoning,
      method: g.method,
      evidence: g.evidenceJson ? parseJsonObject<unknown>(g.evidenceJson, null) : null,
    });
  }
}

/** Progress callback: `(processed, total)`. */
export type BackfillProgress = (processed: number, total: number) => void;

/**
 * Backfill the whole index over every existing run, batched inside per-batch transactions (each batch is
 * one transaction so the FTS writes are fast). Resumable: `putDoc` is idempotent, so a re-run simply
 * re-writes the same documents. Returns `{ runs, documents }`.
 */
export function backfillSearch(
  db: AppDatabase,
  opts: { batchSize?: number; onProgress?: BackfillProgress } = {},
): { runs: number; documents: number } {
  const index = new RunSearchIndex(db);
  if (!index.enabled) return { runs: 0, documents: 0 };
  const batchSize = opts.batchSize && opts.batchSize > 0 ? opts.batchSize : 500;
  const ids = (
    db.prepare("SELECT id FROM runs ORDER BY started_at ASC, id ASC").all() as Array<{ id: string }>
  ).map((r) => r.id);
  const runBatch = db.transaction((batch: string[]) => {
    for (const id of batch) backfillRun(index, db, id);
  });
  let processed = 0;
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    runBatch(batch);
    processed += batch.length;
    opts.onProgress?.(processed, ids.length);
  }
  return { runs: ids.length, documents: index.count() };
}

/**
 * Drop the derived index tables and rebuild them from scratch (`POST /api/maintenance/reindex-search`).
 * DERIVED state — this restores the index FULLY from `runs`/`run_steps`/`run_grades`; a rebuilt index is
 * byte-for-byte identical to what live writes would have produced.
 */
export function reindexSearch(db: AppDatabase): {
  operation: "reindex-search";
  ok: boolean;
  message: string;
  runs: number;
  documents: number;
} {
  const rebuild = db.transaction(() => {
    db.exec("DROP TABLE IF EXISTS run_search_map; DROP TABLE IF EXISTS run_search;");
    db.exec(RUN_SEARCH_DDL);
  });
  rebuild();
  const { runs, documents } = backfillSearch(db);
  return {
    operation: "reindex-search",
    ok: true,
    message: `Rebuilt the full-text index over ${runs} run(s) → ${documents} document(s).`,
    runs,
    documents,
  };
}

/**
 * One-shot startup backfill (migration-adjacent): if the persisted marker is older than
 * {@link SEARCH_INDEX_VERSION}, backfill every existing run once, then stamp the marker. A fresh DB has
 * no runs (no-op) and stamps immediately; an existing DB upgrading to v33 backfills its history once.
 * Idempotent across restarts (the marker gate) and resumable (backfill is idempotent). No-op when the
 * index tables are absent (a minimal fixture).
 */
export function ensureSearchBackfill(
  db: AppDatabase,
  log: (message: string) => void = (m) => console.log(m),
): void {
  const index = new RunSearchIndex(db);
  if (!index.enabled) return;
  const row = db.prepare("SELECT value_json FROM app_settings WHERE key = 'search_index'").get() as
    | { value_json: string }
    | undefined;
  const current = row ? (parseJsonObject<{ version?: number }>(row.value_json, {}).version ?? 0) : 0;
  if (current >= SEARCH_INDEX_VERSION) return;

  const started = Date.now();
  const { runs, documents } = backfillSearch(db, {
    onProgress: (processed, total) => {
      if (total > 0 && (processed % 5000 === 0 || processed === total)) {
        log(`[search] backfill ${processed}/${total} runs indexed`);
      }
    },
  });
  db.prepare(
    `INSERT INTO app_settings (key, value_json, updated_at) VALUES ('search_index', @value, @now)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
  ).run({
    value: JSON.stringify({ version: SEARCH_INDEX_VERSION, runs, documents }),
    now: new Date().toISOString(),
  });
  if (runs > 0) {
    log(
      `[search] backfill complete — ${documents} documents across ${runs} runs in ${Date.now() - started}ms`,
    );
  }
}
