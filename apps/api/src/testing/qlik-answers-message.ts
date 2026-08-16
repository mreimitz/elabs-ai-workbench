/**
 * Qlik Answers **cloud-assistants** message extraction (roadmap/qlik-answers/, Phase 4 rework).
 *
 * A Qlik Sense **app**-backed assistant does NOT return its answer inline in the prompt call. The
 * `actions/stream` call only settles a `messageId`; the answer itself is fetched afterwards from
 * `GET …/cloud-assistants/threads/{tid}/messages` and lives inside an **Adaptive-Card**-shaped message:
 *
 *   message.content[0].card.body[] = [ …TextBlocks…, {type:"TextBlock", text:"Conclusion"},
 *                                      {type:"TextBlock", text:"<the answer, with <citation> tags>"}, … ]
 *
 * and the analytical evidence is a set of hypercube measure definitions (`qMeasures[].qDef.qDef`) buried
 * anywhere in the message tree. This module ports the customer's proven `call_answers.py` extractors
 * (`extract_responses_from_message` + the `_find_last_ai_message`/`_last_text`/hypercube fallbacks) as
 * pure, unit-testable functions — NO network, NO tenant. The executor calls {@link extractAnswerMessage}.
 */

import type {
  AnswersAnswerBlock,
  AnswersSnapshot,
  AnswersSnapshotField,
  AnswersStepPayload,
  RunStep,
} from "@mcp-token-footprint/shared";
import { parseReasoningSections } from "./qlik-answers-reasoning.js";

/** The message-tree fields we pull out of one cloud-assistants message for a Qlik Answers answer step. */
export type ExtractedAnswer = {
  /** The FULL answer narrative — every non-empty TextBlock after the "Conclusion" block, citations stripped, joined. */
  answer: string;
  /** The data expressions the assistant computed — every `qMeasures[].qDef.qDef` string, in tree order. */
  expressions: string[];
  /** The assistant's shown reasoning — the non-empty TextBlocks BEFORE "Conclusion", joined; omitted if none. */
  reasoning?: string;
  /** The `Qlik.Snapshot` insights (supporting charts + their reason/measures/dimensions), in tree order. */
  snapshots: AnswersSnapshot[];
  /**
   * The ordered card-body answer sequence (Phase 5, D-QA8) — text blocks interleaved with snapshot
   * references (`index` into {@link snapshots}) in the card's own render order. Omitted (not `[]`) when
   * the card yields no answer blocks, so a plain/empty message extracts EXACTLY as before this WP.
   */
  blocks?: AnswersAnswerBlock[];
};

/** Row cap for a snapshot's surfaced hypercube data (D-QA10): show at most this many, honest `totalRows`. */
const SNAPSHOT_ROW_CAP = 50;

/**
 * `GET …/cloud-assistants/threads/{tid}/messages` returns the thread's messages; the shape varies
 * (`Message[]`, `{data:[…]}`, `{items:[…]}`, `{messages:[…]}`, or a bare object). Normalize to a flat
 * list, then return the message whose `id === messageId`. Falls back to the LAST message when the id is
 * absent (mirrors the customer script — sometimes only the final message is the answer). Returns
 * `undefined` only when there are no messages at all.
 */
export function findMessageById(payload: unknown, messageId: string | undefined): unknown {
  const messages = normalizeMessages(payload);
  if (messages.length === 0) return undefined;
  if (messageId) {
    const exact = messages.find((m) => asRecord(m)?.id === messageId);
    if (exact) return exact;
  }
  return messages[messages.length - 1];
}

function normalizeMessages(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const record = asRecord(payload);
  if (!record) return [];
  for (const key of ["data", "items", "messages"] as const) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return [record]; // a bare single-message object
}

/**
 * Extract the answer + expressions + reasoning from ONE cloud-assistants message. Tries the primary
 * Adaptive-Card path first (`content[0].card.body[]`), then the tree-walk fallback the script keeps for
 * messages whose answer isn't card-shaped. `expressions` and `reasoning` come from the whole message.
 */
export function extractAnswerMessage(message: unknown): ExtractedAnswer {
  const card = cardAnswer(message);
  const answer = card.answer || lastAiText(message) || "";
  const expressions = collectQDefExpressions(message);
  const snapshots = collectSnapshots(message);
  const blocks = cardBlocks(message);
  const reasoning = card.reasoning;
  return {
    answer,
    expressions,
    snapshots,
    ...(blocks.length > 0 ? { blocks } : {}),
    ...(reasoning ? { reasoning } : {}),
  };
}

/**
 * Walk `content[0].card.body[]` in ORDER (Phase 5, D-QA8) into the answer's rendered sequence: every
 * post-"Conclusion" `TextBlock` becomes a `{kind:"text"}` block (citation markers stripped for display,
 * their `data-index` values captured as `citations` per D-QA9), and every `Qlik.Snapshot` becomes a
 * `{kind:"snapshot", index}` reference into the {@link collectSnapshots} array. The "Conclusion" marker,
 * blank spacers, the "View source" `ActionSet`, and the hidden details `Container` are skipped.
 *
 * Index alignment: {@link collectSnapshots} is a tree walk, but every `Qlik.Snapshot` in a
 * cloud-assistants card lives directly in `card.body` in that same order, so a running counter over the
 * body's VALID snapshots (those {@link snapshotFrom} keeps — the same ones {@link collectSnapshots}
 * emits) stays aligned with the array positions the snapshot blocks reference. The counter advances for
 * every valid snapshot, including any before "Conclusion", so a post-"Conclusion" reference is correct
 * even in the (unseen) case of a pre-"Conclusion" snapshot.
 */
function cardBlocks(message: unknown): AnswersAnswerBlock[] {
  const content = asArray(asRecord(message)?.content);
  const card = asRecord(asRecord(content[0])?.card);
  const body = asArray(card?.body);

  const blocks: AnswersAnswerBlock[] = [];
  let foundConclusion = false;
  let snapshotIndex = 0;
  for (const item of body) {
    const record = asRecord(item);
    const type = record?.type;
    if (type === "TextBlock") {
      const text = typeof record?.text === "string" ? record.text.trim() : "";
      if (text === "Conclusion") {
        foundConclusion = true;
        continue;
      }
      if (!foundConclusion) continue; // pre-"Conclusion" text is reasoning, not an answer block
      if (!text || text === "..." || text === "…") continue; // spacers/placeholders
      const markdown = stripCitations(text);
      if (!markdown) continue;
      const citations = citationIndices(text);
      blocks.push({ kind: "text", markdown, ...(citations.length > 0 ? { citations } : {}) });
    } else if (type === "Qlik.Snapshot") {
      if (!record || !snapshotFrom(record)) continue; // collectSnapshots skips these too — no index consumed
      const index = snapshotIndex;
      snapshotIndex += 1;
      if (foundConclusion) blocks.push({ kind: "snapshot", index });
    }
    // ActionSet / Container / ColumnSet / … are not part of the answer sequence — skipped.
  }
  return blocks;
}

/**
 * The snapshot indices a text block cited (Phase 5, D-QA9) — the `N` in each `<citation data-index="N">`
 * marker, de-duplicated in first-seen order. `N` is the snapshot's position in {@link AnswersStepPayload}
 * `.snapshots` (same order as {@link collectSnapshots}). A citation without `data-index` (older shape)
 * contributes nothing (it is still stripped from the display text by {@link stripCitations}).
 */
function citationIndices(text: string): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const match of text.matchAll(/<citation\b[^>]*?\bdata-index="(\d+)"[^>]*>/g)) {
    const index = Number(match[1]);
    if (Number.isInteger(index) && index >= 0 && !seen.has(index)) {
      seen.add(index);
      out.push(index);
    }
  }
  return out;
}

// ── Primary path: the Adaptive Card body ─────────────────────────────────────────────────────────

/**
 * Walk `content[0].card.body[]`: the answer is EVERY non-empty TextBlock AFTER a "Conclusion" TextBlock
 * (citations stripped, joined into a full multi-paragraph narrative — a Qlik Answers report is several
 * insight paragraphs, not one sentence); the reasoning is every non-empty TextBlock BEFORE "Conclusion".
 * If there is no "Conclusion" marker, `answer` is left empty (the caller falls back to {@link lastAiText}).
 */
function cardAnswer(message: unknown): { answer: string; reasoning?: string } {
  const content = asArray(asRecord(message)?.content);
  const card = asRecord(asRecord(content[0])?.card);
  const body = asArray(card?.body);

  let foundConclusion = false;
  const answerParts: string[] = [];
  const reasoningParts: string[] = [];
  for (const item of body) {
    const record = asRecord(item);
    if (record?.type !== "TextBlock") continue;
    const text = typeof record.text === "string" ? record.text.trim() : "";
    if (text === "Conclusion") {
      foundConclusion = true;
      continue;
    }
    if (!text || text === "..." || text === "…") continue; // skip spacers/placeholders
    if (foundConclusion) {
      const stripped = stripCitations(text);
      if (stripped) answerParts.push(stripped);
    } else {
      reasoningParts.push(text);
    }
  }
  const answer = answerParts.join("\n\n").trim();
  const reasoning = reasoningParts.join("\n\n").trim();
  return { answer, ...(reasoning ? { reasoning } : {}) };
}

/**
 * Collect the `Qlik.Snapshot` insight blocks anywhere in the message tree (Phase 4b). Each is a chart
 * the assistant computed to back a claim; its `source` carries the `measures`/`dimensions` (Qlik
 * expressions + labels) and a `reason` (why the assistant chose that analysis). This is the app-assistant
 * "insights + reasonings + sources" surface — the same data the native Qlik Answers UI renders.
 */
export function collectSnapshots(message: unknown): AnswersSnapshot[] {
  const out: AnswersSnapshot[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    const record = asRecord(node);
    if (!record) return;
    if (record.type === "Qlik.Snapshot") {
      const snap = snapshotFrom(record);
      if (snap) out.push(snap);
    }
    for (const value of Object.values(record)) walk(value);
  };
  walk(message);
  return out;
}

/**
 * Normalize ONE `Qlik.Snapshot` node into an {@link AnswersSnapshot}. `source` carries the chart's
 * measures/dimensions/reason (unchanged from Phase 4b); Phase 5 (D-QA10) additionally surfaces the
 * chart's actual hypercube matrix from `snapshot.data.qHyperCube` as {@link AnswersSnapshot.data}.
 * Returns `undefined` only when the node yields nothing usable at all (kept out of the array).
 */
function snapshotFrom(record: Record<string, unknown> | undefined): AnswersSnapshot | undefined {
  if (!record) return undefined;
  const source = asRecord(record.source);
  const measures = snapshotFields(source?.measures);
  const dimensions = snapshotFields(source?.dimensions);
  const reason = typeof source?.reason === "string" && source.reason ? source.reason : undefined;
  const title = measures[0]?.label ?? measures[0]?.expression;
  const data = snapshotData(record);
  const snap: AnswersSnapshot = {
    ...(title ? { title } : {}),
    ...(reason ? { reason } : {}),
    ...(measures.length > 0 ? { measures } : {}),
    ...(dimensions.length > 0 ? { dimensions } : {}),
    ...(data ? { data } : {}),
  };
  return Object.keys(snap).length > 0 ? snap : undefined;
}

/**
 * The hypercube matrix behind a snapshot chart (Phase 5, D-QA10) — `snapshot.data.qHyperCube` →
 * `{ columns, rows, totalRows? }`. `columns` are the dimension `qFallbackTitle`s then the measure
 * `qFallbackTitle`s; `rows` are the first data page's `qMatrix` cells (each cell prefers a finite
 * numeric `qNum`, else falls back to `qText`); rows are capped at {@link SNAPSHOT_ROW_CAP}, with
 * `totalRows` set to the true count only when the cap actually trims. Absent when there is no
 * hypercube, no columns, or no rows.
 */
function snapshotData(record: Record<string, unknown>): AnswersSnapshot["data"] | undefined {
  const hyperCube = asRecord(asRecord(asRecord(record.snapshot)?.data)?.qHyperCube);
  if (!hyperCube) return undefined;
  const columns = hyperCubeColumns(hyperCube);
  const allRows = hyperCubeRows(hyperCube);
  if (columns.length === 0 || allRows.length === 0) return undefined;
  const trimmed = allRows.length > SNAPSHOT_ROW_CAP;
  return {
    columns,
    rows: trimmed ? allRows.slice(0, SNAPSHOT_ROW_CAP) : allRows,
    ...(trimmed ? { totalRows: allRows.length } : {}),
  };
}

/** Column labels for a hypercube: the dimension titles followed by the measure titles (D-QA10 order). */
function hyperCubeColumns(hyperCube: Record<string, unknown>): string[] {
  const columns: string[] = [];
  for (const info of asArray(hyperCube.qDimensionInfo)) columns.push(fallbackTitle(info, columns.length));
  for (const info of asArray(hyperCube.qMeasureInfo)) columns.push(fallbackTitle(info, columns.length));
  return columns;
}

function fallbackTitle(info: unknown, ordinal: number): string {
  const title = asRecord(info)?.qFallbackTitle;
  return typeof title === "string" && title.length > 0 ? title : `Column ${ordinal + 1}`;
}

/** The first data page's rows as cell values (finite `qNum` preferred, else `qText`, else ""). */
function hyperCubeRows(hyperCube: Record<string, unknown>): (string | number)[][] {
  const firstPage = asRecord(asArray(hyperCube.qDataPages)[0]);
  const rows: (string | number)[][] = [];
  for (const rawRow of asArray(firstPage?.qMatrix)) rows.push(asArray(rawRow).map(cellValue));
  return rows;
}

/** One `qMatrix` cell → a value: a finite numeric `qNum` (e.g. measures), else `qText` (e.g. dimensions). */
function cellValue(cell: unknown): string | number {
  const record = asRecord(cell);
  const num = record?.qNum;
  if (typeof num === "number" && Number.isFinite(num)) return num;
  const text = record?.qText;
  return typeof text === "string" ? text : "";
}

function snapshotFields(value: unknown): AnswersSnapshotField[] {
  const out: AnswersSnapshotField[] = [];
  for (const entry of asArray(value)) {
    const record = asRecord(entry);
    const expression =
      record && typeof record.expression === "string" && record.expression ? record.expression : undefined;
    if (!expression) continue;
    const label = record && typeof record.label === "string" && record.label ? record.label : undefined;
    out.push({ expression, ...(label ? { label } : {}) });
  }
  return out;
}

/** Remove `<citation …>…</citation>` markers Qlik embeds in the answer text. */
function stripCitations(text: string): string {
  return text.replace(/<citation[^>]*>.*?<\/citation>/gs, "").trim();
}

// ── Fallback path: the last "ai" message's last text ─────────────────────────────────────────────

/** `_find_last_ai_message` + `_last_text`: the last non-empty `text` under the last `type:"ai"` node. */
function lastAiText(message: unknown): string {
  const ai = findLastAiMessage(message) ?? message;
  return lastText(ai) ?? "";
}

function findLastAiMessage(obj: unknown): unknown {
  let found: unknown;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const candidate = findLastAiMessage(item);
      if (candidate !== undefined) found = candidate;
    }
  } else {
    const record = asRecord(obj);
    if (record) {
      if (record.type === "ai") found = record;
      for (const value of Object.values(record)) {
        const candidate = findLastAiMessage(value);
        if (candidate !== undefined) found = candidate;
      }
    }
  }
  return found;
}

function lastText(obj: unknown): string | undefined {
  let found: string | undefined;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const candidate = lastText(item);
      if (candidate) found = candidate;
    }
  } else {
    const record = asRecord(obj);
    if (record) {
      if (typeof record.text === "string" && record.text.trim()) found = record.text;
      for (const value of Object.values(record)) {
        const candidate = lastText(value);
        if (candidate) found = candidate;
      }
    }
  }
  return found;
}

// ── Expressions: every qMeasures[].qDef.qDef string, in tree order ───────────────────────────────

/**
 * Depth-first collect of every `qMeasures[].qDef.qDef` expression anywhere in the message tree (the
 * Qlik engine measure definitions the assistant used — the app-assistant "reasoning"/evidence). Mirrors
 * the script's `find_qdefs` recursion; de-duplicates while preserving first-seen order.
 */
export function collectQDefExpressions(obj: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    const record = asRecord(node);
    if (!record) return;
    if (Array.isArray(record.qMeasures)) {
      for (const measure of record.qMeasures) {
        const inner = asRecord(asRecord(measure)?.qDef)?.qDef;
        if (typeof inner === "string" && inner.length > 0 && !seen.has(inner)) {
          seen.add(inner);
          out.push(inner);
        }
      }
    }
    for (const value of Object.values(record)) walk(value);
  };
  walk(obj);
  return out;
}

// ── Replay-read derivation (Phase 5, D-QA8) ──────────────────────────────────────────────────────

/**
 * READ-TIME projection for a persisted `qlik_answers` answer step (D-QA8): a LEGACY step captured the
 * lossless `rawResponse` + `reasoning` but not the rendering fields (`blocks`, snapshot `data`,
 * `reasoningSections`). Derive those from the ALREADY-PERSISTED data and return a NEW step with the
 * payload augmented — WITHOUT rewriting the stored row (no migration, no persistence change). Called
 * from `GET /api/runs/:id` over every step; a non-answer step, a non-qlik step (no `rawResponse`), or a
 * step already carrying `blocks` (a live/post-5.2 run) is returned unchanged, so non-qlik runs replay
 * byte-identically. `assistantText`/`reasoning` are never touched — these are additive projections.
 */
export function deriveLegacyAnswerStep(step: RunStep): RunStep {
  if (step.type !== "llm_response") return step;
  const payload = step.payload as AnswersStepPayload | null | undefined;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return step;
  if (payload.rawResponse == null || payload.blocks != null) return step;

  const extracted = extractAnswerMessage(payload.rawResponse);
  const reasoningSections =
    typeof payload.reasoning === "string" && payload.reasoning
      ? parseReasoningSections(payload.reasoning, step.assistantText)
      : [];
  const additions: Partial<AnswersStepPayload> = {
    ...(extracted.blocks && extracted.blocks.length > 0 ? { blocks: extracted.blocks } : {}),
    // Re-derive snapshots from the same rawResponse so they carry the hypercube `data` the legacy
    // capture lacked; same tree order, so block snapshot references stay valid.
    ...(extracted.snapshots.length > 0 ? { snapshots: extracted.snapshots } : {}),
    ...(reasoningSections.length > 0 ? { reasoningSections } : {}),
  };
  if (Object.keys(additions).length === 0) return step;
  return { ...step, payload: { ...payload, ...additions } };
}

// ── local helpers ────────────────────────────────────────────────────────────────────────────────

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
