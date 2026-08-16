/**
 * Qlik Answers **reasoning** structuring (roadmap/qlik-answers/, Phase 5, D-QA11). PURE + unit-tested,
 * NO network, NO tenant, NO node-specific deps — it lives in `packages/shared` (WP 6.2) so BOTH the
 * API (emit-time derivation) and the web (LIVE, client-side parse while a run streams) call the SAME
 * function. The API module `apps/api/src/testing/qlik-answers-reasoning.ts` is now a thin re-export of
 * this; the web imports it from `@mcp-token-footprint/shared`.
 *
 * A `qlik_answers` run's reasoning stream (persisted as `AnswersStepPayload.reasoning`) is a rich but
 * flat markdown blob: a numbered pipeline (Understanding · Current Primary Subject · Rewritten Question),
 * a "Search Findings" block (keywords + master-measure / master-dimension / field lists, each entry
 * carrying a similarity score and an optional glossary match), a classification line, and one or more
 * full "## …" answer DRAFTS that substantially restate the final answer. Rendered verbatim it reads as
 * one opaque disclosure whose drafts duplicate the answer. {@link parseReasoningSections} splits it into
 * typed {@link ReasoningSection}s so the web (WP 5.4 settled; WP 6.2 live) can render recognized phases
 * structurally (asset lists as tables, drafts as collapsed disclosures) while the reasoning STRING
 * itself stays byte-identical (graders + existing tests read that unchanged).
 *
 * Invariants:
 *   - **Never drop text on a parse miss.** Unrecognized narrative becomes a verbatim `prose` section;
 *     a reasoning with NO recognized phase at all returns a single verbatim `raw` section. This is what
 *     makes the WP 6.2 LIVE parse partial/mid-token tolerant — a half-formed tail flows as `prose`/`raw`.
 *   - **Additive & deterministic.** Same input → same sections; the parser only READS the string.
 */

import type { ReasoningAssetRow, ReasoningSection } from "./types.js";

/**
 * Fraction of the final answer's vocabulary that a "## …" draft must cover to be flagged
 * `duplicatesAnswer`. Empirically (run `hHGgqkU…`) the two real drafts cover 0.43 / 0.54 of the
 * answer's words while non-draft phases (Understanding 0.14, keyword line 0.02) sit far below — 0.30
 * separates them with clear margin. A draft below the threshold is a genuinely different draft and is
 * left expanded (the honest behavior). When no answer text is supplied, drafts default to duplicative
 * (a "## …" block in the reasoning IS the assistant's answer draft by construction).
 */
const DRAFT_DUPLICATE_THRESHOLD = 0.3;

/**
 * Parse a `qlik_answers` reasoning stream into typed sections (D-QA11). `answerText` (the step's
 * `assistantText`) is optional; when present it is used to flag whether each "## …" draft substantially
 * duplicates the final answer (the web collapses those). Returns `[]` for empty input; returns a single
 * `raw` section when nothing structured is recognized (never drops text).
 */
export function parseReasoningSections(reasoning: string, answerText?: string): ReasoningSection[] {
  if (!reasoning.trim()) return [];

  const sections: ReasoningSection[] = [];
  const proseBuffer: string[] = [];
  // The one multi-line section currently being accumulated (asset list / classification / draft), if any.
  let current: Current | null = null;

  const flushProse = (): void => {
    const markdown = proseBuffer.join("\n").trim();
    proseBuffer.length = 0;
    if (markdown) sections.push({ kind: "prose", markdown });
  };
  const flushCurrent = (): void => {
    if (!current) return;
    if (current.kind === "assets") {
      if (current.rows.length > 0) sections.push({ kind: "assets", title: current.title, rows: current.rows });
    } else if (current.kind === "classification") {
      const markdown = current.lines.join("\n").trim();
      if (markdown) sections.push({ kind: "classification", title: "Classification", markdown });
    } else {
      const markdown = current.lines.join("\n").trim();
      if (markdown) {
        sections.push({
          kind: "draft",
          ...(current.title ? { title: current.title } : {}),
          markdown,
          duplicatesAnswer: isDuplicateDraft(markdown, answerText),
        });
      }
    }
    current = null;
  };
  // A boundary header ends whatever is open and any pending prose, in that order.
  const boundary = (): void => {
    flushCurrent();
    flushProse();
  };

  for (const line of reasoning.split(/\r?\n/)) {
    const numbered = line.match(
      /^\s*\d+\.\s+\*\*(Understanding|Current Primary Subject|Rewritten Question)\*\*\s*:?\s*(.*)$/,
    );
    if (numbered) {
      boundary();
      const label = numbered[1] as PipelineLabel;
      sections.push({ kind: pipelineKind(label), title: label, markdown: (numbered[2] ?? "").trim() });
      continue;
    }

    const assetHeader = line.match(/^\s*\*\*(Master Measures|Master Dimensions|Fields)\s*:?\*\*\s*$/);
    if (assetHeader) {
      boundary();
      current = { kind: "assets", title: assetHeader[1] as string, rows: [] };
      continue;
    }

    if (/^\s*\*\*Classification\s*:/i.test(line)) {
      boundary();
      current = { kind: "classification", lines: [line] };
      continue;
    }

    const draftHeader = line.match(/^##\s+(.+)$/); // a level-2 heading — a full answer draft
    if (draftHeader) {
      boundary();
      current = { kind: "draft", title: (draftHeader[1] ?? "").trim(), lines: [line] };
      continue;
    }

    // A content line inside an open multi-line section, or narrative prose.
    if (current?.kind === "assets") {
      const row = parseAssetRow(line);
      if (row) {
        current.rows.push(row);
        continue;
      }
      // A non-row line ends the asset list; fall through to treat this line as prose.
      flushCurrent();
    } else if (current) {
      current.lines.push(line); // draft / classification body
      continue;
    }
    proseBuffer.push(line);
  }
  flushCurrent();
  flushProse();

  // Never drop text on a total parse miss: if nothing structured was recognized, return the whole
  // reasoning verbatim as one `raw` section rather than a single prose blob.
  const structured = sections.some((section) => section.kind !== "prose" && section.kind !== "raw");
  if (!structured) return [{ kind: "raw", markdown: reasoning.trim() }];
  return sections;
}

// ── internals ─────────────────────────────────────────────────────────────────────────────────────

type PipelineLabel = "Understanding" | "Current Primary Subject" | "Rewritten Question";

type Current =
  | { kind: "assets"; title: string; rows: ReasoningAssetRow[] }
  | { kind: "classification"; lines: string[] }
  | { kind: "draft"; title: string; lines: string[] };

function pipelineKind(label: PipelineLabel): "understanding" | "rewritten" | "prose" {
  if (label === "Understanding") return "understanding";
  if (label === "Rewritten Question") return "rewritten";
  return "prose"; // "Current Primary Subject" has no dedicated kind
}

/**
 * Parse one "Search Findings" asset line into a row:
 *   `- [Carrier.airline_name] - dimension, similarity: 0.876, hybrid: N/A [GLOSSARY MATCH: airline, carrier]`
 * → `{ asset: "Carrier.airline_name", type: "dimension", similarity: 0.876, glossary: "airline, carrier" }`.
 * Returns `undefined` for any line that is not an asset row (so it can end the list as prose).
 */
function parseAssetRow(line: string): ReasoningAssetRow | undefined {
  const match = line.match(/^\s*-\s*\[(.+?)\]\s*-\s*(.*)$/);
  if (!match) return undefined;
  const asset = (match[1] ?? "").trim();
  if (!asset) return undefined;
  let rest = match[2] ?? "";

  let glossary: string | undefined;
  const glossaryMatch = rest.match(/\[GLOSSARY MATCH:\s*([^\]]+)\]/i);
  if (glossaryMatch) {
    glossary = (glossaryMatch[1] ?? "").trim();
    rest = rest.replace(glossaryMatch[0], "").trim();
  }

  let similarity: number | undefined;
  const similarityMatch = rest.match(/similarity:\s*([\d.]+)/i);
  if (similarityMatch) {
    const value = Number.parseFloat(similarityMatch[1] ?? "");
    if (Number.isFinite(value)) similarity = value;
  }

  const type = (rest.split(",")[0] ?? "").trim();

  return {
    asset,
    ...(type ? { type } : {}),
    ...(similarity !== undefined ? { similarity } : {}),
    ...(glossary ? { glossary } : {}),
  };
}

/** Whether a "## …" draft substantially restates the final answer (D-QA11) — overlap ≥ threshold. */
function isDuplicateDraft(draft: string, answerText?: string): boolean {
  const answer = answerText?.trim();
  if (!answer) return true; // no answer to compare against → a draft is duplicative by construction
  const answerTokens = tokenize(answer);
  if (answerTokens.size === 0) return true;
  const draftTokens = tokenize(draft);
  let shared = 0;
  for (const token of answerTokens) if (draftTokens.has(token)) shared += 1;
  return shared / answerTokens.size >= DRAFT_DUPLICATE_THRESHOLD;
}

/** Lowercase word/number tokens (keeps `%` and `.` so figures like `13.49%` / `101m` stay distinctive). */
function tokenize(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z0-9%.]+/g) ?? []);
}
