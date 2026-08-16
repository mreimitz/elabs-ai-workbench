import type { RunSummary, SearchContentClass } from "@mcp-token-footprint/shared";
import { safeJson } from "../../lib/format";
import type { TimelineAssistantTurn, TimelineItem } from "./use-run-stream";

/**
 * Observability (WP3.4) — the run console's in-run search: ONE match/snippet primitive
 * ({@link findMatch}) reused by BOTH data sources the search box draws from:
 *   - the LIVE in-memory accumulator ({@link collectLiveSearchHits}, over the same
 *     `stream.timeline`/`stream.error` every other pane reads — prompts, assistant replies +
 *     reasoning, tool call/result text, and errors);
 *   - the REPLAY-only FTS supplement ({@link hitFromFtsSummary}, wrapping the ONE best-match hit the
 *     WP1.3 full-text index returns for this run via `lib/api.ts#searchRunScoped`) — it fills in
 *     content a client's own (possibly truncation-capped) step payloads don't carry, so it always
 *     runs IN ADDITION TO the local scan on a replayed run, never instead of it.
 *
 * Both paths render through the SAME bracket-delimited snippet convention (`…before[match]after…`,
 * mirroring the shape the API's own FTS5 `snippet()` already returns — see
 * `RunSummary.searchSnippet`), so `SearchHighlight.tsx` has exactly one format to parse regardless of
 * which source a hit came from.
 */

export type SearchHit = {
  /** Stable React key + de-dupe key. */
  id: string;
  source: "live" | "fts";
  /** Which indexed content class the match belongs to (mirrors the shared FTS vocabulary). */
  kind: SearchContentClass;
  /** 0-based assistant-turn ordinal, when the match belongs to one; else null. */
  turnIndex: number | null;
  /** The `RunStep.id` this match resolves to (drives cross-highlight + StepLog selection); else null. */
  stepId: string | null;
  /** The provider tool-call id, when the match is a tool call/result; else null. */
  toolCallId: string | null;
  /** Short human label shown in the match list (e.g. "Turn 2 · reply", "search_docs · result"). */
  label: string;
  /** Bracket-delimited snippet: `…before[match]after…`. */
  snippet: string;
};

const SNIPPET_CONTEXT_CHARS = 48;

/**
 * Case-insensitive substring match → a bracket-delimited context snippet, or `null` when the query is
 * empty or doesn't occur. THE one place "does this text match this query" is decided for the LIVE
 * path — every live hit is built by calling this on one candidate field. An FTS hit's snippet already
 * arrives pre-built (by the server, in the same bracket convention) and is wrapped as-is by
 * {@link hitFromFtsSummary} rather than re-matched here.
 */
export function findMatch(
  text: string,
  query: string,
  contextChars = SNIPPET_CONTEXT_CHARS,
): { snippet: string } | null {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0 || !text) return null;
  const idx = text.toLowerCase().indexOf(needle);
  if (idx === -1) return null;
  const start = Math.max(0, idx - contextChars);
  const end = Math.min(text.length, idx + needle.length + contextChars);
  const before = text.slice(start, idx);
  const match = text.slice(idx, idx + needle.length);
  const after = text.slice(idx + needle.length, end);
  return {
    snippet: `${start > 0 ? "…" : ""}${before}[${match}]${after}${end < text.length ? "…" : ""}`,
  };
}

/** Push a hit onto `hits` iff `findMatch(text, query)` finds one — the single call site every
 *  candidate field in {@link collectLiveSearchHits} routes through. */
function pushHit(
  hits: SearchHit[],
  base: Omit<SearchHit, "snippet">,
  text: string,
  query: string,
): void {
  const m = findMatch(text, query);
  if (m) hits.push({ ...base, snippet: m.snippet });
}

/**
 * The LIVE in-memory search: every candidate text field across the run's reconstructed
 * `TimelineItem[]` (prompts, assistant replies/reasoning, tool call args, tool results/errors) plus
 * the run-level terminal error. Loading-states-safe: it only ever reads SETTLED text (a still-
 * streaming turn's in-flight prose is included via `timeline`'s own live synthesis, which is the same
 * text the conversation already renders — never a half-parsed fragment invented here).
 */
export function collectLiveSearchHits(params: {
  timeline: TimelineItem[];
  runError: string | null;
  query: string;
}): SearchHit[] {
  const hits: SearchHit[] = [];
  const query = params.query.trim();
  if (query.length === 0) return hits;

  for (const item of params.timeline) {
    if (item.kind === "user") {
      pushHit(
        hits,
        {
          id: `prompt:${item.id}`,
          source: "live",
          kind: "prompt",
          turnIndex: null,
          stepId: item.id,
          toolCallId: null,
          label: "Your prompt",
        },
        item.text,
        query,
      );
      continue;
    }
    collectTurnHits(hits, item, query);
  }

  if (params.runError) {
    pushHit(
      hits,
      {
        id: "error:run",
        source: "live",
        kind: "error",
        turnIndex: null,
        stepId: null,
        toolCallId: null,
        label: "Run error",
      },
      params.runError,
      query,
    );
  }

  return hits;
}

function collectTurnHits(hits: SearchHit[], turn: TimelineAssistantTurn, query: string): void {
  const turnLabel = `Turn ${turn.turnIndex + 1}`;
  if (turn.assistantText) {
    pushHit(
      hits,
      {
        id: `assistant:${turn.id}`,
        source: "live",
        kind: "assistant",
        turnIndex: turn.turnIndex,
        stepId: turn.stepId ?? null,
        toolCallId: null,
        label: `${turnLabel} · reply`,
      },
      turn.assistantText,
      query,
    );
  }
  if (turn.reasoningText) {
    pushHit(
      hits,
      {
        id: `reasoning:${turn.id}`,
        source: "live",
        kind: "assistant",
        turnIndex: turn.turnIndex,
        stepId: turn.stepId ?? null,
        toolCallId: null,
        label: `${turnLabel} · reasoning`,
      },
      turn.reasoningText,
      query,
    );
  }
  for (const call of turn.toolCalls) {
    const callText = `${call.toolName} ${safeJson(call.call.payload)}`;
    pushHit(
      hits,
      {
        id: `tool:${call.id}`,
        source: "live",
        kind: "tool",
        turnIndex: turn.turnIndex,
        stepId: call.call.id,
        toolCallId: call.id,
        label: `${call.toolName} · call`,
      },
      callText,
      query,
    );
    if (call.result) {
      const isError = call.result.status === "error";
      const resultText = safeJson(call.result.payload);
      pushHit(
        hits,
        {
          id: `result:${call.id}`,
          source: "live",
          kind: isError ? "error" : "tool_result",
          turnIndex: turn.turnIndex,
          stepId: call.result.id,
          toolCallId: call.id,
          label: `${call.toolName} · ${isError ? "error" : "result"}`,
        },
        resultText,
        query,
      );
    }
  }
}

/** Human label for the ONE supplemental FTS hit, by its `RunSummary.searchMatchKind`. */
function ftsLabel(kind: SearchContentClass | undefined): string {
  switch (kind) {
    case "prompt":
      return "Full-text index · prompt";
    case "assistant":
      return "Full-text index · reply";
    case "tool":
      return "Full-text index · tool call";
    case "tool_result":
      return "Full-text index · tool result";
    case "error":
      return "Full-text index · error";
    case "rating":
      return "Full-text index · rating";
    default:
      return "Full-text index";
  }
}

/**
 * Wrap the run's ONE best-match FTS hit (from `GET /api/runs?filter=…` scoped to this run's owning
 * test — see `lib/api.ts#searchRunScoped`) into a {@link SearchHit}, so it can be merged into the
 * SAME hit list the live scan produces. The server already built the snippet in the SAME bracket
 * convention {@link findMatch} produces, so it is used AS-IS — never re-matched. Returns `null` when
 * the run isn't in the result set, or carries no snippet (no FTS match for this query).
 *
 * This hit carries no `stepId`/`turnIndex`/`toolCallId` — the WP1.3 index is RUN-scoped (one best
 * snippet per run, not per step), so it has no exact in-console location to jump to; it exists purely
 * to prove "this run's full-text index also matches" and show WHERE (which content class + snippet)
 * for content the client's own (possibly truncated) steps don't carry.
 */
export function hitFromFtsSummary(runId: string, runs: RunSummary[]): SearchHit | null {
  const run = runs.find((r) => r.id === runId);
  if (!run || !run.searchSnippet) return null;
  return {
    id: `fts:${runId}`,
    source: "fts",
    kind: run.searchMatchKind ?? "meta",
    turnIndex: null,
    stepId: null,
    toolCallId: null,
    label: ftsLabel(run.searchMatchKind),
    snippet: run.searchSnippet,
  };
}
