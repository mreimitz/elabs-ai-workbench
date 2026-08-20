// Assistant Hub (planning/Roadmap/RM-03-assistant-hub/, WP1.4, §1.7 / D-AH10) — the first-class citation pipeline.
//
// The contract (§1.7, reviewed adversarially — R-UX5): EVERY rendered `[n]` resolves to a real source,
// and a source keeps its number for the whole session (no drift across turns). This module is the ONE
// place numbering happens, so the number the model SEES and the number the post-pass RESOLVES can never
// diverge:
//
//   1. `extractCitationSources` pulls candidate sources out of a tool result (structured content first,
//      then url/title heuristics over text; per-server extensibility left as a seam).
//   2. A per-DISPATCH `HubCitationLedger` numbers them STABLY per session — seeded from the session's
//      prior `assistant_message.citations[]` (so turn 2 continues turn 1's numbering, and a re-fetched
//      URL reuses its number). A shared mutable ledger is REQUIRED because several tools in one turn each
//      contribute sources and must not collide on `[1]` — a stateless per-call numberer can't do that.
//   3. `wrapToolsetWithCitations` wraps each MCP tool's `execute` so the numbered source list is injected
//      into the model-visible result envelope (`availableCitations`) — the numbers the model is told to
//      cite (`hub/prompting/layers/citations.ts`).
//   4. The post-pass (built from the SAME ledger) maps the `[n]` markers the model wrote onto the settled
//      `assistant_message.citations[]` and tags each tool part with the citation ids it produced — read
//      from the ledger, NOT re-derived, so there is nothing to drift.
//
// Tool output is UNTRUSTED (`.claude/rules/mcp-and-security.md`): extraction only READS the result (never
// executes it), keeps http(s) URLs only, and truncates snippets — no secret ever enters a citation.
// Error results (`isError:true`, R-MCP6) are never mined for sources (an error is data, not evidence).

import type { HubCitation, HubEvent, HubMessagePart } from "@mcp-token-footprint/shared";
import type { Tool, ToolSet } from "ai";
import type { HubAssistantDraft, HubCitationPostPass, HubResolvedToolset } from "./turn-engine.js";

// ── Source extraction (§1.7) ────────────────────────────────────────────────────────────────────────

/** A candidate source lifted out of a tool result, before it is numbered into a {@link HubCitation}. */
export type RawCitationSource = { title: string; url?: string; snippet?: string };

const MAX_SOURCES_PER_RESULT = 25;
const MAX_WALK_DEPTH = 6;
const SNIPPET_MAX_CHARS = 300;
/** Bare-URL scan (whitespace/paren/quote/angle terminated). */
const URL_RE = /\bhttps?:\/\/[^\s<>()"'`\]]+/gi;
/** Markdown link `[title](url)`. */
const MD_LINK_RE = /\[([^\]]{1,200})\]\((https?:\/\/[^\s)]+)\)/gi;
/** Keys that name a source object's URL, title and snippet — the common web-search / fetch shapes. */
const URL_KEYS = ["url", "link", "href", "uri", "source", "sourceUrl", "web_url"] as const;
const TITLE_KEYS = ["title", "name", "heading", "label", "displayName", "site_name"] as const;
const SNIPPET_KEYS = [
  "snippet",
  "description",
  "summary",
  "excerpt",
  "text",
  "content",
  "abstract",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Normalize + validate a candidate URL for a citation (display only): http(s) scheme, trimmed of
 *  trailing sentence punctuation. Returns undefined for anything that isn't a usable http(s) URL. */
function cleanUrl(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim().replace(/[.,;:!?)"'\]]+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) return undefined;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

function clip(text: string, max = SNIPPET_MAX_CHARS): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * Extract candidate sources from ONE tool result (§1.7). Prefers `structuredContent` over `content`
 * (an MCP envelope), then deep-walks for source-shaped objects (a `url`/`link`/`href` + optional
 * title/snippet), and finally mines any text for markdown links + bare URLs. Deduplicated by URL (or
 * title when URL-less) and capped, so a huge result can't mint hundreds of citations.
 */
export function extractCitationSources(output: unknown): RawCitationSource[] {
  const found: RawCitationSource[] = [];
  const seen = new Set<string>();
  const push = (source: RawCitationSource): void => {
    const key = rawSourceKey(source);
    if (!key || seen.has(key) || found.length >= MAX_SOURCES_PER_RESULT) return;
    seen.add(key);
    found.push(source);
  };

  // Prefer the typed channel of an MCP envelope; fall back to `content`, then the raw value.
  const root =
    isRecord(output) && output.structuredContent !== undefined && output.structuredContent !== null
      ? output.structuredContent
      : isRecord(output) && output.content !== undefined
        ? output.content
        : output;

  walk(root, push, 0);
  return found;
}

function walk(value: unknown, push: (s: RawCitationSource) => void, depth: number): void {
  if (depth > MAX_WALK_DEPTH || value === null || value === undefined) return;

  if (typeof value === "string") {
    mineText(value, push);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walk(item, push, depth + 1);
    return;
  }
  if (!isRecord(value)) return;

  // A source-shaped object: an http(s) URL plus optional title/snippet.
  const url = cleanUrl(firstString(value, URL_KEYS));
  if (url) {
    const title = firstString(value, TITLE_KEYS) ?? hostOf(url);
    const rawSnippet = firstString(value, SNIPPET_KEYS);
    push({ title: clip(title, 200), url, ...(rawSnippet ? { snippet: clip(rawSnippet) } : {}) });
  }

  // Recurse regardless (a result nests its sources under `results`/`documents`/`content`/… and also
  // carries text blocks worth mining for links).
  for (const child of Object.values(value)) walk(child, push, depth + 1);
}

function mineText(text: string, push: (s: RawCitationSource) => void): void {
  for (const match of text.matchAll(MD_LINK_RE)) {
    const url = cleanUrl(match[2]);
    if (url) push({ title: clip(match[1] ?? hostOf(url), 200), url });
  }
  // Strip markdown-link URLs already handled, then scan bare URLs.
  const withoutMd = text.replace(MD_LINK_RE, " ");
  for (const match of withoutMd.matchAll(URL_RE)) {
    const url = cleanUrl(match[0]);
    if (url) push({ title: hostOf(url), url });
  }
}

// ── Stable per-session numbering (the ledger) ─────────────────────────────────────────────────────────

/** Dedup key for a numbered citation — its URL if it has one, else its (lowercased) title. Both
 *  {@link rawSourceKey} and this use the SAME logic so a baseline citation and a freshly-extracted
 *  source collapse to one number when they name the same thing. */
function citationKey(citation: HubCitation): string {
  return citation.url ? normalizeKeyUrl(citation.url) : `t:${citation.title.trim().toLowerCase()}`;
}
function rawSourceKey(source: RawCitationSource): string {
  return source.url ? normalizeKeyUrl(source.url) : `t:${source.title.trim().toLowerCase()}`;
}
function normalizeKeyUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return `u:${parsed.host.toLowerCase()}${parsed.pathname}${parsed.search}`;
  } catch {
    return `u:${url.trim().toLowerCase()}`;
  }
}

/**
 * The per-DISPATCH source numberer (§1.7). Seeded from the session's prior citations so numbering
 * CONTINUES across turns (turn 2's new source is `[max+1]`, a re-seen URL reuses its number). Shared by
 * the toolset wrapper (assigns numbers at tool-execution time — the numbers the model sees) and the
 * post-pass (reads the assignments back — never re-numbers), so the two can't diverge.
 */
export class HubCitationLedger {
  private readonly byKey = new Map<string, HubCitation>();
  private readonly byNumber = new Map<number, HubCitation>();
  private readonly byCall = new Map<string, HubCitation[]>();
  private nextNumber = 1;

  constructor(baseline: readonly HubCitation[] = []) {
    for (const citation of baseline) {
      const key = citationKey(citation);
      if (!this.byKey.has(key)) this.byKey.set(key, citation);
      const n = Number(citation.id);
      if (Number.isInteger(n) && n > 0) {
        if (!this.byNumber.has(n)) this.byNumber.set(n, citation);
        if (n >= this.nextNumber) this.nextNumber = n + 1;
      }
    }
  }

  /** Number a tool call's extracted sources (dedup against the whole session), tag them with the
   *  originating `toolCallId`, and return them in extraction order. Idempotent for a repeated source. */
  record(toolCallId: string, sources: readonly RawCitationSource[]): HubCitation[] {
    const assigned: HubCitation[] = [];
    for (const source of sources) {
      const key = rawSourceKey(source);
      let citation = this.byKey.get(key);
      if (!citation) {
        const id = String(this.nextNumber++);
        citation = {
          id,
          title: source.title,
          ...(source.url ? { url: source.url } : {}),
          ...(source.snippet ? { snippet: source.snippet } : {}),
          ...(toolCallId ? { toolCallRef: toolCallId } : {}),
        };
        this.byKey.set(key, citation);
        this.byNumber.set(Number(id), citation);
      }
      assigned.push(citation);
    }
    if (toolCallId && assigned.length > 0) {
      const list = this.byCall.get(toolCallId) ?? [];
      for (const citation of assigned) if (!list.includes(citation)) list.push(citation);
      this.byCall.set(toolCallId, list);
    }
    return assigned;
  }

  /** The citations a given tool call produced this session (for tagging its tool part). */
  citationsForCall(toolCallId: string): HubCitation[] {
    return this.byCall.get(toolCallId) ?? [];
  }

  /** Resolve a bare `[n]` marker to its citation, or undefined when `n` names no known source. */
  resolve(n: number): HubCitation | undefined {
    return this.byNumber.get(n);
  }

  /** Every citation assigned this session so far, in number order. */
  all(): HubCitation[] {
    return [...this.byNumber.values()].sort((a, b) => Number(a.id) - Number(b.id));
  }
}

/** Seed a ledger from a session's persisted event log (R-SES1): every prior `assistant_message`'s
 *  `citations[]`, first occurrence per id wins (numbering is already stable in the log). */
export function reconstructCitationBaseline(events: readonly HubEvent[]): HubCitation[] {
  const byId = new Map<string, HubCitation>();
  for (const event of events) {
    if (event.type !== "assistant_message") continue;
    for (const citation of event.citations)
      if (!byId.has(citation.id)) byId.set(citation.id, citation);
  }
  return [...byId.values()];
}

// ── Envelope injection (the numbers the model is told to cite) ─────────────────────────────────────────

/** The compact per-source entry appended to a tool result the model sees. `cite` is the literal marker
 *  the model should reproduce (`[3]`), so the prompt's "cite as `[n]`" rule has an unambiguous target. */
export type EnvelopeCitation = {
  n: number;
  cite: string;
  title: string;
  url?: string;
  snippet?: string;
};

/**
 * Inject the numbered source list into a tool result's MODEL-VISIBLE envelope (§1.7). Additive: the
 * original result is preserved verbatim under `availableCitations` alongside it (an object gains the
 * field; a non-object is wrapped as `{ result, availableCitations }`), so structured-output rendering
 * (R-MCP6) and `isError` detection still find the original shape. A no-op when nothing was assigned.
 */
export function injectCitationEnvelope(output: unknown, assigned: readonly HubCitation[]): unknown {
  if (assigned.length === 0) return output;
  const availableCitations: EnvelopeCitation[] = assigned.map((c) => ({
    n: Number(c.id),
    cite: `[${c.id}]`,
    title: c.title,
    ...(c.url ? { url: c.url } : {}),
    ...(c.snippet ? { snippet: c.snippet } : {}),
  }));
  if (isRecord(output)) return { ...output, availableCitations };
  return { result: output, availableCitations };
}

// ── Marker parsing ────────────────────────────────────────────────────────────────────────────────────

/** The distinct `[n]` numbers a settled answer cites (`[2][5]` → `[2, 5]`). Kept API-side so the
 *  post-pass and any server consumer agree on the marker grammar with the UI's inline renderer. */
export function findCitationMarkers(text: string): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const match of text.matchAll(/\[(\d{1,4})\]/g)) {
    const n = Number(match[1]);
    if (n > 0 && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

// ── The per-turn factory (index.ts wires this into the session-service) ────────────────────────────────

/** A dispatch's citation apparatus: the toolset wrapper (execution-time numbering) + the post-pass
 *  (settle-time resolution), both bound to ONE {@link HubCitationLedger}. */
export type HubCitationTurn = {
  ledger: HubCitationLedger;
  wrapToolset: (toolset: HubResolvedToolset) => HubResolvedToolset;
  postPass: HubCitationPostPass;
};

/** Build a dispatch's citation apparatus, seeded from the session's prior events (stable numbering). */
export type HubCitationTurnFactory = (priorEvents: readonly HubEvent[]) => HubCitationTurn;

export const beginHubCitationTurn: HubCitationTurnFactory = (priorEvents) => {
  const ledger = new HubCitationLedger(reconstructCitationBaseline(priorEvents));
  return {
    ledger,
    wrapToolset: (toolset) => wrapToolsetWithCitations(toolset, ledger),
    postPass: makeLedgerPostPass(ledger),
  };
};

/** True when a tool result is an MCP `{ isError: true }` (a tool-level failure — R-MCP6). Errors are
 *  data, never citation evidence, so the wrapper skips extraction for them. */
function isMcpErrorResult(output: unknown): boolean {
  return isRecord(output) && output.isError === true;
}

/**
 * Wrap the `mcp`-source tools of a resolved toolset so each call's result is numbered + injected with its
 * source list (built-ins/genui/skills are left untouched — their outputs aren't external evidence).
 * Routing/metering is unchanged: only the returned value is augmented.
 */
export function wrapToolsetWithCitations(
  toolset: HubResolvedToolset,
  ledger: HubCitationLedger,
): HubResolvedToolset {
  const sources = toolset.sources ?? {};
  const wrapped: ToolSet = {};
  for (const [name, entry] of Object.entries(toolset.tools)) {
    wrapped[name] = sources[name] === "mcp" ? wrapMcpTool(entry, ledger) : entry;
  }
  return { ...toolset, tools: wrapped };
}

function wrapMcpTool(entry: Tool, ledger: HubCitationLedger): Tool {
  const original = (entry as { execute?: (input: unknown, options: unknown) => unknown }).execute;
  if (typeof original !== "function") return entry;
  const execute = async (input: unknown, options: unknown): Promise<unknown> => {
    const output = await original(input, options);
    if (isMcpErrorResult(output)) return output;
    const extracted = extractCitationSources(output);
    if (extracted.length === 0) return output;
    const toolCallId = (options as { toolCallId?: string } | undefined)?.toolCallId ?? "";
    const assigned = ledger.record(toolCallId, extracted);
    return injectCitationEnvelope(output, assigned);
  };
  return { ...entry, execute } as Tool;
}

/**
 * The deterministic post-pass (§1.7): resolve the answer's `[n]` markers + this pass's tool-produced
 * sources into the settled message's `citations[]`, and tag each tool part with the citation ids it
 * produced. Numbers are READ from the ledger the wrapper populated — never re-derived — so a rendered
 * `[n]` can never point at a source that doesn't exist (the resolve-test / R-UX5).
 */
export function makeLedgerPostPass(ledger: HubCitationLedger): HubCitationPostPass {
  return (draft: HubAssistantDraft) => {
    const cited = findCitationMarkers(draft.text);
    const produced: HubCitation[] = [];

    const parts: HubMessagePart[] = draft.parts.map((part) => {
      if (part.type !== "tool_call") return part;
      const forCall = ledger.citationsForCall(part.toolCallId);
      if (forCall.length === 0) return part;
      for (const citation of forCall) produced.push(citation);
      return { ...part, citationIds: forCall.map((c) => c.id) };
    });

    // The message's citations[] = the sources it PRODUCED this pass ∪ every prior-turn source it CITED
    // (so a `[n]` referring back to an earlier turn still resolves). Deduped by id, in number order.
    const byId = new Map<string, HubCitation>();
    for (const citation of produced) byId.set(citation.id, citation);
    for (const n of cited) {
      const citation = ledger.resolve(n);
      if (citation) byId.set(citation.id, citation);
    }
    const citations = [...byId.values()].sort((a, b) => Number(a.id) - Number(b.id));

    return { parts, citations };
  };
}
