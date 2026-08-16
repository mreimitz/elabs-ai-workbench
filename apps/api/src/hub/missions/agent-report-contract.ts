// Assistant Hub — the PROMPT-ENFORCED mission-agent report contract
// (roadmap/model-identity/, WP4.2, locked decision **D-MI4**).
//
// ## Why this module exists
//
// Every other mission-agent path gets its {@link HubAgentReport} from a `generateObject` call over
// `hubAgentReportSchema` — a schema-guaranteed structured-output call. The `claude_subscription`
// executor (`hub/subscription-adapter.ts`) drives the Agent SDK, which has **no structured-output
// mode at all**: there is no `generateObject`, no JSON-schema response format, nothing to guarantee
// a shape. Before WP2.1 taught the resolver to honour an explicit `providerCredentialId`, that gap
// was invisible because a subscription-pinned agent could never actually be routed to the
// subscription (README §1) — the child simply threw and the mission settled it as the generic
// *"The agent failed to produce a report."*
//
// The owner decided (D-MI4) to make a subscription-pinned agent WORK in a mission rather than refuse
// it at save/plan time. Since the guarantee cannot come from the transport, it comes from the
// PROMPT: the child is told, in its role prompt, to end its final message with one fenced
// `hub-agent-report` JSON block. This module owns both halves of that contract —
// {@link buildAgentReportContractInstruction} (what the child is told) and
// {@link parseAgentReportContract} (what we accept back) — so the two can never drift.
//
// ## The three outcomes, and why there is no fourth
//
// A prompt contract is not a schema, so the parse must be honest about what it got:
//
//   • `parsed`   — a block was found and (possibly after repair) validates. Repair is deliberately
//                  narrow and LOSSLESS-in-intent: strip the fence, take the balanced JSON object,
//                  drop trailing commas, coerce the shapes an LLM actually gets wrong (a bare string
//                  finding, a missing `citations`/`artifacts`/`openQuestions` array, `"High"` for
//                  confidence, a numeric citation id). It NEVER invents substance: if the block
//                  carries no summary and no finding text, it is not repairable.
//   • `absent`   — the child produced work but no report block at all. The caller falls back to the
//                  SAME deterministic prose projection every structured-incapable model already uses
//                  (`projectTranscriptToReport`) and marks it visibly on the report. That is the
//                  agent's own prose, not a fabrication.
//   • `unusable` — a block WAS emitted and cannot be trusted (unparseable, or parseable but empty of
//                  substance). This is the case D-MI4 says must fail **honestly and by name**: the
//                  agent answered in-contract and produced garbage, and silently projecting its prose
//                  would hide that its structured claims were unreadable.
//
// There is deliberately no "synthesize a plausible report" path. `hubAgentReportSchema` is the only
// arbiter of a `parsed` outcome, so nothing that reaches synthesis is shaped by guesswork here.

import type { HubAgentReport, HubConfidence } from "@mcp-token-footprint/shared";
import { hubAgentReportSchema } from "@mcp-token-footprint/shared";

/** The fence language tag the contract asks for — also the marker the parser prefers when several
 *  fenced blocks are present. Kept as one exported literal so the instruction and the parser cannot
 *  drift (the same discipline `HUB_AGENT_REPORT_EXTRACTION_MARKER` uses for the structured path). */
export const HUB_AGENT_REPORT_FENCE = "hub-agent-report";

/** Bound the slice of a transcript the parser will scan for a report block — a runaway transcript must
 *  not turn a cheap parse into a pathological regex/brace walk. The block is at the END by contract. */
const MAX_SCAN_CHARS = 200_000;

/** How a {@link parseAgentReportContract} attempt turned out. See the module header for why there are
 *  exactly three and no "fabricate one" fourth. */
export type HubAgentReportParse =
  | { outcome: "parsed"; report: HubAgentReport; repaired: boolean }
  | { outcome: "absent" }
  | { outcome: "unusable"; reason: string };

/**
 * The report-contract instruction appended to a subscription-backed mission agent's ROLE prompt.
 *
 * Written to be transport-agnostic prose (the Agent SDK gets a plain system prompt) and to name the
 * exact field set of `hubAgentReportSchema`, because the parser validates against that schema and
 * nothing else. `expectedOutcome` is folded in so the block's `summary` answers the actual brief
 * rather than restating the role.
 */
export function buildAgentReportContractInstruction(opts?: { expectedOutcome?: string }): string {
  const expected = opts?.expectedOutcome?.trim();
  return [
    "## Mission report contract (REQUIRED)",
    "",
    "You are running as one agent of a larger mission. Your prose answer is read by a human, but the",
    "mission itself consumes a STRUCTURED report. When your work is done, end your FINAL message with",
    "exactly one fenced JSON block — nothing after it:",
    "",
    "```" + HUB_AGENT_REPORT_FENCE,
    "{",
    '  "summary": "One or two sentences answering the brief.",',
    '  "findings": [',
    '    { "summary": "A concrete claim.", "detail": "Optional supporting detail.", "citationIds": ["1"], "confidence": "high" }',
    "  ],",
    '  "citations": [{ "id": "1", "title": "Where this came from", "url": "https://… (omit if none)" }],',
    '  "artifacts": [],',
    '  "confidence": "medium",',
    '  "openQuestions": ["Anything you could not resolve."]',
    "}",
    "```",
    "",
    "Rules:",
    "- `confidence` is exactly one of `high`, `medium`, `low` (on the report and on each finding).",
    "- `findings`, `citations`, `artifacts` and `openQuestions` are ALWAYS arrays — use `[]`, never null.",
    "- A finding's `citationIds` reference `citations[].id` values you listed in the SAME block.",
    "- Report ONLY what your own work supports. Never invent a source, a tool result, or a number.",
    "- Write your normal prose answer first; the block is the last thing in the message.",
    ...(expected ? ["", `The mission expects: ${expected}`] : []),
  ].join("\n");
}

/**
 * Parse a mission agent's own report block out of its settled prose — the subscription path's
 * replacement for `generateObject`.
 *
 * Recognition order (most explicit first): the ```hub-agent-report fence → any ```json / bare fence
 * whose body looks like a report → the LAST balanced `{…}` in the text that mentions `"findings"`.
 * Only the LAST match of each kind is considered: the contract puts the block at the end, and an
 * agent that reasons out loud about the format earlier in its answer must not shadow the real one.
 */
export function parseAgentReportContract(text: string): HubAgentReportParse {
  const body = text.length > MAX_SCAN_CHARS ? text.slice(text.length - MAX_SCAN_CHARS) : text;
  const candidate = findReportCandidate(body);
  if (candidate === undefined) return { outcome: "absent" };

  const direct = tryParseJson(candidate);
  const repairedText = direct === undefined ? repairJsonText(candidate) : undefined;
  const value = direct ?? (repairedText === undefined ? undefined : tryParseJson(repairedText));
  if (value === undefined) {
    return {
      outcome: "unusable",
      reason: "it emitted a report block that is not valid JSON and could not be repaired",
    };
  }

  const strict = hubAgentReportSchema.safeParse(value);
  if (strict.success && hasSubstance(strict.data)) {
    return { outcome: "parsed", report: strict.data, repaired: repairedText !== undefined };
  }

  const coerced = coerceReport(value);
  if (coerced === undefined) {
    return {
      outcome: "unusable",
      reason: "it emitted a report block with no summary and no readable finding",
    };
  }
  const reparsed = hubAgentReportSchema.safeParse(coerced);
  if (!reparsed.success) {
    return {
      outcome: "unusable",
      reason: `it emitted a report block that does not match the report contract (${firstIssue(reparsed.error)})`,
    };
  }
  return { outcome: "parsed", report: reparsed.data, repaired: true };
}

/** The visible note stamped on a report that came from the deterministic prose projection because the
 *  agent never emitted its contract block — so an operator can see WHY a report reads thin, instead of
 *  it silently looking like a low-confidence answer. */
export const AGENT_REPORT_PROJECTED_NOTE =
  "This agent did not emit the structured mission report block, so its report was projected from its prose — treat the structure (not the prose) as approximate.";

/** Append {@link AGENT_REPORT_PROJECTED_NOTE} to a projected report's open questions (idempotent). */
export function noteProjectedReport(report: HubAgentReport): HubAgentReport {
  if (report.openQuestions.includes(AGENT_REPORT_PROJECTED_NOTE)) return report;
  return { ...report, openQuestions: [...report.openQuestions, AGENT_REPORT_PROJECTED_NOTE] };
}

// ── Candidate extraction ──────────────────────────────────────────────────────────────────────────

/** The LAST fenced block carrying `tag` (or any fence when `tag` is undefined), body only. */
function lastFencedBlock(text: string, tag?: string): string | undefined {
  const fence = tag
    ? new RegExp("```[ \\t]*" + tag + "[ \\t]*\\r?\\n([\\s\\S]*?)```", "gi")
    : /```[ \t]*[A-Za-z0-9_-]*[ \t]*\r?\n([\s\S]*?)```/g;
  let found: string | undefined;
  for (const match of text.matchAll(fence)) {
    const captured = match[1];
    if (captured !== undefined) found = captured;
  }
  return found;
}

/** The best report-block candidate in `text`, or undefined when the agent emitted none. */
function findReportCandidate(text: string): string | undefined {
  const tagged = lastFencedBlock(text, HUB_AGENT_REPORT_FENCE);
  if (tagged !== undefined) return tagged.trim();

  // An untagged / ```json fence is the common near-miss: accept it only when it actually looks like a
  // report, so a fenced tool payload elsewhere in the transcript is never mistaken for one.
  const fenced = lastFencedBlock(text);
  if (fenced !== undefined && looksLikeReport(fenced)) return fenced.trim();

  // No fence at all: the last balanced `{…}` that mentions the report's discriminating key.
  const bare = lastBalancedObject(text);
  if (bare !== undefined && looksLikeReport(bare)) return bare.trim();
  return undefined;
}

/** `"findings"` is the one required key no other block in a hub transcript carries. */
function looksLikeReport(text: string): boolean {
  return /"findings"\s*:/.test(text);
}

/**
 * The LAST balanced top-level `{…}` object in `text`. A single FORWARD, string-aware pass (a brace or
 * quote inside a JSON string never counts, and `\"` never closes one) — the naive backward scan is
 * unsound because you cannot tell a string's opening quote from its closing one walking right-to-left.
 * Bounded by the enclosing scan window.
 */
function lastBalancedObject(text: string): string | undefined {
  let found: string | undefined;
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) found = text.slice(start, i + 1);
    }
  }
  return found;
}

// ── Repair ────────────────────────────────────────────────────────────────────────────────────────

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * The narrow JSON-text repairs an LLM's hand-written block actually needs: a leading/trailing fence or
 * prose line the extractor did not strip, a trailing comma before `}`/`]`, and smart quotes around
 * keys. Deliberately does NOT attempt to close unbalanced braces or guess missing values — a truncated
 * block is `unusable`, not silently completed.
 */
function repairJsonText(text: string): string | undefined {
  let out = text.trim();
  // Strip a stray opening/closing fence the extractor already handled in the common case.
  out = out.replace(/^```[A-Za-z0-9_-]*[ \t]*\r?\n?/, "").replace(/\r?\n?```$/, "");
  // Drop anything before the first `{` / after the last `}` (a "Here is my report:" preamble).
  const first = out.indexOf("{");
  const last = out.lastIndexOf("}");
  if (first < 0 || last <= first) return undefined;
  out = out.slice(first, last + 1);
  // Curly quotes an editor/model substituted for the JSON ones.
  out = out.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  // Trailing commas before a close.
  out = out.replace(/,(\s*[}\]])/g, "$1");
  return out === text.trim() ? undefined : out;
}

// ── Shape coercion ────────────────────────────────────────────────────────────────────────────────

/** A report is substantive when it says SOMETHING — a summary, or at least one readable finding. An
 *  empty-but-schema-valid husk is `unusable`, not a report. */
function hasSubstance(report: HubAgentReport): boolean {
  if (report.summary?.trim()) return true;
  return report.findings.some((f) => f.summary?.trim());
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asText(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

const CONFIDENCES: readonly HubConfidence[] = ["high", "medium", "low"];

function asConfidence(value: unknown): HubConfidence | undefined {
  const text = typeof value === "string" ? value.trim().toLowerCase() : undefined;
  return CONFIDENCES.find((c) => c === text);
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

/**
 * Coerce a loosely-shaped block into the report contract. Every rule here fixes a mistake an LLM
 * actually makes — a bare string finding, a null array, `"High"`, a numeric citation id, a report
 * nested under a `report` key. Nothing here invents content: a field with no source in the block is
 * left at its empty/`low` default, and a block with nothing to say returns undefined.
 */
function coerceReport(value: unknown): Record<string, unknown> | undefined {
  const root = asRecord(value);
  if (!root) return undefined;
  // Some models wrap the block: `{ "report": { … } }`.
  const source = asRecord(root.report) ?? root;

  const findings = asArray(source.findings)
    .map((raw) => {
      const text = asText(raw);
      if (text) return { summary: text, confidence: "low" as HubConfidence };
      const record = asRecord(raw);
      if (!record) return undefined;
      const summary =
        asText(record.summary) ?? asText(record.finding) ?? asText(record.text) ?? asText(record.title);
      if (!summary) return undefined;
      const detail = asText(record.detail) ?? asText(record.details);
      const citationIds = asArray(record.citationIds)
        .map((id) => asText(id))
        .filter((id): id is string => id !== undefined);
      return {
        summary,
        ...(detail ? { detail } : {}),
        ...(citationIds.length > 0 ? { citationIds } : {}),
        confidence: asConfidence(record.confidence) ?? ("low" as HubConfidence),
      };
    })
    .filter((f): f is NonNullable<typeof f> => f !== undefined);

  const citations = asArray(source.citations)
    .map((raw, index) => {
      const text = asText(raw);
      if (text) return { id: String(index + 1), title: text };
      const record = asRecord(raw);
      if (!record) return undefined;
      const title = asText(record.title) ?? asText(record.name) ?? asText(record.source);
      if (!title) return undefined;
      const url = asText(record.url);
      const snippet = asText(record.snippet);
      return {
        id: asText(record.id) ?? String(index + 1),
        title,
        ...(url ? { url } : {}),
        ...(snippet ? { snippet } : {}),
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== undefined);

  const artifacts = asArray(source.artifacts)
    .map((raw) => {
      const record = asRecord(raw);
      const artifactId = record ? asText(record.artifactId) ?? asText(record.id) : undefined;
      if (!artifactId) return undefined;
      const title = record ? asText(record.title) : undefined;
      return { artifactId, ...(title ? { title } : {}) };
    })
    .filter((a): a is NonNullable<typeof a> => a !== undefined);

  const openQuestions = asArray(source.openQuestions)
    .map((raw) => asText(raw) ?? asText(asRecord(raw)?.question))
    .filter((q): q is string => q !== undefined);

  const summary = asText(source.summary) ?? asText(source.answer) ?? asText(source.conclusion);
  if (!summary && findings.length === 0) return undefined;

  return {
    ...(summary ? { summary } : {}),
    findings,
    citations,
    artifacts,
    confidence: asConfidence(source.confidence) ?? "low",
    openQuestions,
  };
}

/** The first zod issue rendered as one short clause — enough to diagnose, short enough for an error
 *  event's message. Never carries a value from the block (only the path + the rule that failed). */
function firstIssue(error: { issues: readonly { path: PropertyKey[]; message: string }[] }): string {
  const issue = error.issues[0];
  if (!issue) return "unknown validation failure";
  const path = issue.path.map(String).join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}
