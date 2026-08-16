// Assistant Hub (roadmap/assistant-hub/, WP3.3, §1.3 / R-SES8 · R-SK2) — context-window management:
// summaries & compaction for the AI-SDK chat turn engine.
//
// Compaction shrinks what the MODEL sees when a session's reconstructed history approaches the model's
// context window, WITHOUT deleting anything (the human transcript stays whole — R-SES1; only the
// model-visible context is compacted). Order of operations per the reference harness (R-SES8):
//
//   1. CLEAR OLD TOOL OUTPUTS FIRST (hot/cold split). The last `keepRecentTurns` user turns stay HOT
//      (verbatim); older turns are COLD. Cold tool-result bodies are cleared to a short placeholder —
//      tool outputs are the biggest context consumers, and clearing them alone often frees enough.
//   2. SUMMARIZE ONLY AFTER. If clearing isn't enough, the cold region's assistant/tool activity is
//      summarized (an injected summarizer; a deterministic default when none is wired) and persisted as
//      a rolling `hub_session_summaries` row + a `compaction` event.
//
// Fidelity guarantees (R-SES8 — compaction never silently drops user constraints):
//   • EVERY user message up to the compaction boundary is preserved VERBATIM in the summary, in a
//     dedicated "preserved" block, INDEPENDENT of the summarizer. A constraint a user stated early
//     therefore survives every compaction regardless of what the (LLM) summarizer does with the
//     assistant narrative. This is what the constraint-recall probe checks.
//   • INVOKED SKILL BODIES re-attach within the R-SK2 budget (5K/skill, 25K combined) — a skill the
//     model loaded is not thrown away by compaction; it is carried forward (compaction-protected).
//   • The summary is USER-AIMABLE: a `userAim` directive is forwarded to the summarizer and recorded on
//     the `compaction` event.
//
// Anti-thrash (R-SES8 — repeated refill → an honest thrash error, never a loop): compaction runs at most
// ONCE per turn (clear, then at most one summarize pass — no internal retry loop). If even after
// summarizing the entire cold region the hot region + summary + system prompt still exceed the model's
// HARD context window, that is a thrash: nothing compaction can do makes progress (e.g. the latest turn
// alone is larger than the window). We return `{ kind: "thrash" }` and persist NOTHING — the turn engine
// stops the turn honestly rather than re-summarizing in a loop.

import type {
  HubEvent,
  HubSessionSummary,
  HubTextPart,
} from "@mcp-token-footprint/shared";
import type { ModelMessage } from "ai";
import type { TokenCounter } from "../token-counting/types.js";
import type { HubRepository, HubEventInput } from "./repository.js";
import type { HubCompactionPrepared, HubTurnCompactor } from "./turn-engine.js";
import { reconstructMessages } from "./turn-engine.js";
import { SKILLS_LOAD_TOOL_NAME } from "./skill-attachments.js";

// ── Defaults + knobs ────────────────────────────────────────────────────────────────────────────────

/** Compact when the reconstructed history reaches this fraction of the model's context window
 *  (`HUB_COMPACTION_THRESHOLD_FRACTION`). Deliberately below 1.0 so compaction runs BEFORE the provider
 *  itself would reject an over-window request. */
export const DEFAULT_COMPACTION_THRESHOLD_FRACTION = 0.75;

/** How many of the most-recent user turns stay HOT — verbatim, never cleared or summarized
 *  (`HUB_COMPACTION_KEEP_RECENT_TURNS`). The hot region preserves the immediate working context. */
export const DEFAULT_COMPACTION_KEEP_RECENT_TURNS = 4;

/** The per-skill / combined token budgets a compaction re-attaches loaded skill bodies within (R-SK2 —
 *  first 5K/skill, 25K combined). The SAME shape `tools/skills-load.ts` enforces at load time. */
export type HubCompactionSkillBudgets = { perSkillTokens: number; totalTokens: number };

const DEFAULT_SKILL_BUDGETS: HubCompactionSkillBudgets = { perSkillTokens: 5_000, totalTokens: 25_000 };

// ── Summarizer seam ──────────────────────────────────────────────────────────────────────────────────

/** What the summarizer receives: the cleared cold assistant/tool transcript to compress, the preserved
 *  user messages (context, never to be dropped), the optional user aim, and a rough token target. */
export type HubSummarizerInput = {
  sessionId: string;
  /** The cold region's assistant/tool activity with tool outputs already CLEARED — the text to compress. */
  coldTranscript: string;
  /** Every preserved user message (verbatim) up to the compaction boundary — context for the summary. */
  userMessages: string[];
  /** R-SES8 — the user's directive aiming what the summary should preserve/emphasize, when supplied. */
  userAim?: string;
  /** A rough token budget the summary should aim to fit under. */
  targetTokens: number;
};

/** Compress the cold region's assistant/tool narrative. Injected in production (an LLM one-shot); a
 *  deterministic default ({@link deterministicHubSummarizer}) is used when none is wired + in tests. */
export type HubSummarizer = (input: HubSummarizerInput) => Promise<string>;

/**
 * The deterministic fallback summarizer — no model required, so compaction ALWAYS works (gate-green,
 * offline). It mechanically compresses the cold transcript: keeps the first sentence/line of each entry,
 * caps the whole thing at `targetTokens`-worth of characters, and honors a `userAim` by keeping lines
 * that mention the aim's keywords. It is deliberately lossy on the assistant NARRATIVE only — user
 * constraints live in the separate preserved block, never here, so this can never drop a constraint.
 */
export const deterministicHubSummarizer: HubSummarizer = async (input) => {
  const lines = input.coldTranscript
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const aimTerms = (input.userAim ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length >= 4);
  const isAimRelevant = (line: string): boolean =>
    aimTerms.length > 0 && aimTerms.some((t) => line.toLowerCase().includes(t));

  // Aim-relevant lines are PRIORITIZED (emitted first, whole) so the user's aim genuinely steers what
  // survives; the rest are appended clause-compressed until the token budget is spent.
  const aimLines = lines.filter(isAimRelevant);
  const otherLines = lines.filter((line) => !isAimRelevant(line)).map(firstClause).filter(Boolean);
  const kept = [...aimLines, ...otherLines];

  const budgetChars = Math.max(200, input.targetTokens * 4);
  let text = kept.join("\n");
  if (text.length > budgetChars) text = `${text.slice(0, budgetChars).trimEnd()}…`;
  return text.length > 0 ? text : "(no earlier assistant activity to summarize)";
};

function firstClause(line: string): string {
  const match = line.match(/^(.{0,200}?[.!?])(?:\s|$)/);
  return match?.[1] ?? line.slice(0, 200);
}

// ── The compactor factory (the turn-engine seam) ─────────────────────────────────────────────────────

export type HubCompactorConfig = {
  /** The session whose summaries this compactor persists (bound per-dispatch by the session-service). */
  sessionId: string;
  /** `MODEL_CONTEXT_LIMITS[modelId]` for the turn's model — the window compaction measures against. 0 or
   *  a non-positive value DISABLES compaction (an unknown-window model is never compacted). */
  contextWindow: number;
  /** Compact when the window reaches this fraction of `contextWindow` (default 0.75). */
  thresholdFraction?: number;
  /** How many recent user turns stay hot (default 4). */
  keepRecentTurns?: number;
  /** The R-SK2 skill re-attach budgets (default 5K/25K). */
  skillBudgets?: HubCompactionSkillBudgets;
  /** R-SES8 — the user's aim for this turn's compaction, if any. */
  userAim?: string;
};

export type HubCompactorDeps = {
  repository: HubRepository;
  tokenCounter: TokenCounter;
  /** The summarizer (default: {@link deterministicHubSummarizer}). */
  summarizer?: HubSummarizer;
  config: HubCompactorConfig;
};

/**
 * Build the {@link HubTurnCompactor} the turn engine consumes. Built PER DISPATCH by the session-service
 * (bound to the resolved model's context window + the turn's optional `userAim`), mirroring how the
 * HITL/citation seams are built per dispatch.
 */
export function createHubCompactor(deps: HubCompactorDeps): HubTurnCompactor {
  const summarizer = deps.summarizer ?? deterministicHubSummarizer;
  const thresholdFraction = deps.config.thresholdFraction ?? DEFAULT_COMPACTION_THRESHOLD_FRACTION;
  const keepRecentTurns = Math.max(1, deps.config.keepRecentTurns ?? DEFAULT_COMPACTION_KEEP_RECENT_TURNS);
  const skillBudgets = deps.config.skillBudgets ?? DEFAULT_SKILL_BUDGETS;
  const contextWindow = deps.config.contextWindow;
  const sessionId = deps.config.sessionId;
  const userAim = deps.config.userAim?.trim() || undefined;

  return {
    async prepareTurn({ events, systemText, persist }): Promise<HubCompactionPrepared> {
      // An unknown/zero context window can't be measured against — never compact (byte-identical to the
      // no-compactor path). This also keeps a stub-window model from tripping compaction in tests.
      if (!Number.isFinite(contextWindow) || contextWindow <= 0) {
        return { kind: "ready", messages: reconstructMessages(events) };
      }

      const latest = latestCompactionSummary(events);
      const priorUpto = latest?.uptoSeq ?? 0;

      // Reconstruct the CURRENT model history honoring any prior summary (older turns → the systemSuffix).
      const base = reconstructCompactedHistory(events, latest);
      const systemTokens = await deps.tokenCounter.countText(systemText);
      const suffixTokens = base.systemSuffix
        ? await deps.tokenCounter.countText(base.systemSuffix)
        : 0;
      const historyTokens = await countMessagesTokens(deps.tokenCounter, base.messages);
      const windowTokens = systemTokens + suffixTokens + historyTokens;

      const threshold = Math.floor(contextWindow * thresholdFraction);
      const ready = (): HubCompactionPrepared =>
        base.systemSuffix
          ? { kind: "ready", messages: base.messages, systemSuffix: base.systemSuffix }
          : { kind: "ready", messages: base.messages };

      // Under the soft threshold — nothing to do (the common path).
      if (windowTokens <= threshold) return ready();

      // Over threshold → attempt compaction. Carve the hot boundary among events AFTER the prior summary.
      const hotStart = hotBoundarySeq(events, keepRecentTurns, priorUpto);
      if (hotStart === null) {
        // Not enough turns to carve a NEW cold region (everything is already hot / summarized). If the
        // window still exceeds the HARD limit, compaction cannot help → honest thrash (never a loop).
        if (windowTokens > contextWindow) {
          return { kind: "thrash", message: THRASH_HOT_MESSAGE };
        }
        // Over soft threshold but under the hard limit — run as-is; a later turn with more history will
        // have a cold region to compact. This is forward progress, not a loop.
        return ready();
      }

      const coldEvents = events.filter((e) => seqOf(e) > priorUpto && seqOf(e) < hotStart);
      const hotEvents = events.filter((e) => seqOf(e) >= hotStart);
      const newUpto = maxSeq(coldEvents);

      const hotMessages = reconstructMessages(hotEvents);
      const hotTokens = await countMessagesTokens(deps.tokenCounter, hotMessages);

      // ── STEP 1 — CLEAR OLD TOOL OUTPUTS FIRST (hot/cold split, R-SES8). Render the cold region as a
      //    compact transcript with tool-result BODIES cleared to placeholders (they are the bulk of the
      //    material — leaving them in would bloat the rolling summary that rides in the system prompt on
      //    every future turn). `skills.load` bodies are NOT cleared here — they are re-attached within the
      //    R-SK2 budget below. User messages are preserved VERBATIM (the constraint-recall guarantee).
      const preservedUserMessages = coldUserMessages(events, newUpto);
      const reattach = collectReattachableSkills(events, newUpto, skillBudgets);
      const cleared = renderClearedColdTranscript(events, priorUpto, newUpto, latest);
      const clearedToolOutputTokens = await countClearedToolOutputTokens(
        deps.tokenCounter,
        events,
        priorUpto,
        newUpto,
      );

      // ── STEP 2 — SUMMARIZE ONLY AFTER. The summarizer compresses the ALREADY-CLEARED cold narrative
      //    (injected/LLM or the deterministic offline default). User messages + skill bodies are NOT sent
      //    through the summarizer — they are re-attached deterministically, so a user constraint can never
      //    be silently dropped no matter what the summarizer does (R-SES8 fidelity / the recall probe).
      const narrative = await summarizer({
        sessionId,
        coldTranscript: cleared.transcript,
        userMessages: preservedUserMessages,
        ...(userAim ? { userAim } : {}),
        targetTokens: Math.max(256, Math.floor(threshold * 0.25)),
      });
      const summaryContent = assembleSummaryContent({
        narrative,
        preservedUserMessages,
        reattach: reattach.blocks,
        userAim,
      });
      const summarySuffix = summaryToSystemSuffix(summaryContent);
      const summaryTokens = await deps.tokenCounter.countText(summarySuffix);
      const windowAfter = systemTokens + summaryTokens + hotTokens;

      // ── THRASH (R-SES8): even after clearing + summarizing the ENTIRE cold region, the hot region +
      //    summary + system prompt still exceed the model's HARD context window. Compaction cannot make
      //    progress (e.g. the recent turns alone are larger than the window). Stop HONESTLY, persist
      //    NOTHING, and NEVER re-summarize in a loop — the summarizer ran exactly once this turn.
      if (windowAfter > contextWindow) {
        return { kind: "thrash", message: THRASH_SUMMARY_MESSAGE };
      }

      const summaryId = persistSummary(deps.repository, {
        sessionId,
        uptoSeq: newUpto,
        content: summaryContent,
        tokens: summaryTokens,
      });
      persist(
        compactionEvent({
          summaryId,
          uptoSeq: newUpto,
          summary: summaryContent,
          summaryTokens,
          clearedToolOutputs: cleared.clearedToolOutputs,
          clearedToolOutputTokens,
          windowBefore: windowTokens,
          windowAfter,
          reattachedSkillIds: reattach.skillIds,
          userAim,
        }),
      );
      return suffixReady(hotMessages, summarySuffix);
    },
  };
}

/** The honest, human-readable thrash messages the engine surfaces (R-SES8). */
export const THRASH_HOT_MESSAGE =
  "Compaction could not free enough context: the recent turns alone exceed the model's context window. Start a new session or shorten your last message.";
export const THRASH_SUMMARY_MESSAGE =
  "Compaction could not free enough context: even after summarizing the earlier turns, the conversation exceeds the model's context window. Start a new session, switch to a larger-context model, or shorten your last message.";

// ── History reconstruction (compaction-aware) ─────────────────────────────────────────────────────────

/**
 * Reconstruct the model history honoring the latest persisted compaction summary. TEXT turns only (the
 * SAME projection {@link reconstructMessages} produces — no behavior change for a non-compacted session):
 * events at/below the summary boundary collapse into the returned `systemSuffix` (the summary, framed as
 * prior context); events after the boundary reconstruct verbatim as `messages`. With no prior summary this
 * returns exactly `{ messages: reconstructMessages(events) }`, byte-identical to the pre-WP3.3 path.
 */
export function reconstructCompactedHistory(
  events: readonly HubEvent[],
  latest: LatestSummary | undefined,
): { messages: ModelMessage[]; systemSuffix?: string } {
  if (!latest) return { messages: reconstructMessages([...events]) };
  const post = events.filter((e) => seqOf(e) > latest.uptoSeq);
  return {
    messages: reconstructMessages(post),
    systemSuffix: summaryToSystemSuffix(latest.summary),
  };
}

/** The compaction summary as a system-prompt suffix (prior-context framing). */
export function summaryToSystemSuffix(summary: string): string {
  return `\n\n# Earlier conversation (compacted)\nThe earlier turns of this conversation were compacted to fit the context window. They are represented by the summary below. Everything the user required earlier still applies — treat the preserved user messages as binding constraints.\n\n${summary}\n`;
}

// ── The cleared cold transcript (step 1: clear tool outputs first) ────────────────────────────────────

/**
 * Render the cold region (events with `priorUpto < seq <= newUpto`) as a compact assistant/tool
 * transcript with TOOL OUTPUTS CLEARED — each cold `tool_result` body becomes a short placeholder (the
 * bulk of the token saving), EXCEPT `skills.load` results (protected — re-attached separately, R-SK2).
 * User messages are NOT included here (they are preserved verbatim in their own block). A prior summary
 * is prepended so its assistant narrative carries forward across successive compactions.
 */
export function renderClearedColdTranscript(
  events: readonly HubEvent[],
  priorUpto: number,
  newUpto: number,
  latest: LatestSummary | undefined,
): { transcript: string; clearedToolOutputs: number } {
  const toolNameByCallId = new Map<string, string>();
  const parts: string[] = [];
  let clearedToolOutputs = 0;

  for (const event of events) {
    const seq = seqOf(event);
    if (event.type === "tool_call") toolNameByCallId.set(event.part.toolCallId, event.part.toolName);
    if (seq <= priorUpto || seq > newUpto) continue;
    switch (event.type) {
      case "assistant_message": {
        const text = textOfParts(event.parts);
        if (text.trim()) parts.push(`Assistant: ${text.trim()}`);
        break;
      }
      case "tool_call": {
        parts.push(`[called tool \`${event.part.toolName}\`]`);
        break;
      }
      case "tool_result": {
        const toolName = toolNameByCallId.get(event.toolCallId) ?? "tool";
        if (toolName === SKILLS_LOAD_TOOL_NAME) {
          parts.push(`[loaded skill via \`${toolName}\` — re-attached below]`);
        } else {
          parts.push(`[tool \`${toolName}\` output cleared during compaction]`);
          clearedToolOutputs += 1;
        }
        break;
      }
      case "mission_digest": {
        // assistant-hub v1-fixes (F2) — the mission digest IS the compact memory of a mission; unlike
        // tool output it survives compaction verbatim (it is already hard-capped at authoring time).
        if (event.text.trim()) parts.push(event.text.trim());
        break;
      }
      default:
        break;
    }
  }

  const prefix = latest ? `${latest.summary}\n\n` : "";
  return { transcript: `${prefix}${parts.join("\n")}`.trim(), clearedToolOutputs };
}

/** The measured tokens the cleared cold tool-result bodies had occupied (informational, honest saving). */
async function countClearedToolOutputTokens(
  counter: TokenCounter,
  events: readonly HubEvent[],
  priorUpto: number,
  newUpto: number,
): Promise<number> {
  const toolNameByCallId = new Map<string, string>();
  let total = 0;
  for (const event of events) {
    if (event.type === "tool_call") toolNameByCallId.set(event.part.toolCallId, event.part.toolName);
    const seq = seqOf(event);
    if (seq <= priorUpto || seq > newUpto) continue;
    if (event.type !== "tool_result") continue;
    if (toolNameByCallId.get(event.toolCallId) === SKILLS_LOAD_TOOL_NAME) continue;
    if (event.modelContent !== undefined) total += await counter.countJson(event.modelContent);
  }
  return total;
}

// ── Preserved user messages (verbatim — the fidelity guarantee) ───────────────────────────────────────

/** Every user message up to (and including) `uptoSeq`, verbatim, in order — the constraint-recall
 *  guarantee. Independent of the summarizer, so a user constraint can never be silently dropped. */
export function coldUserMessages(events: readonly HubEvent[], uptoSeq: number): string[] {
  return events
    .filter(
      (e): e is Extract<HubEvent, { type: "user_message" }> =>
        e.type === "user_message" && seqOf(e) <= uptoSeq,
    )
    .map((e) => e.text)
    .filter((text) => text.trim().length > 0);
}

// ── Re-attached skill bodies (R-SK2, compaction-protected within budget) ──────────────────────────────

/** One `skills.load` result's model content (the shape `tools/skills-load.ts` emits — content included). */
type LoadedSkillContent = { skillId: string; skillName: string; path: string; tokens: number; content?: string };

/**
 * Collect the loaded skill bodies (from cold `skills.load` results, seq <= uptoSeq) to re-attach, within
 * the R-SK2 budget — first `perSkillTokens` per skill, `totalTokens` combined. A skill loaded more than
 * once keeps its LAST load's content. Returns rendered blocks + the ids re-attached (for the event).
 */
export function collectReattachableSkills(
  events: readonly HubEvent[],
  uptoSeq: number,
  budgets: HubCompactionSkillBudgets,
): { blocks: string[]; skillIds: string[] } {
  const toolNameByCallId = new Map<string, string>();
  const bySkill = new Map<string, LoadedSkillContent>();
  for (const event of events) {
    if (event.type === "tool_call") {
      toolNameByCallId.set(event.part.toolCallId, event.part.toolName);
      continue;
    }
    if (event.type !== "tool_result" || event.state !== "output-available") continue;
    if (seqOf(event) > uptoSeq) continue;
    if (toolNameByCallId.get(event.toolCallId) !== SKILLS_LOAD_TOOL_NAME) continue;
    const parsed = parseLoadedSkillContent(event.modelContent);
    if (parsed) bySkill.set(`${parsed.skillId}:${parsed.path}`, parsed);
  }

  const blocks: string[] = [];
  const skillIds: string[] = [];
  let totalBudget = 0;
  for (const loaded of bySkill.values()) {
    if (!loaded.content || loaded.content.trim().length === 0) continue;
    if (totalBudget >= budgets.totalTokens) break;
    const perSkillCap = Math.min(budgets.perSkillTokens, budgets.totalTokens - totalBudget);
    const { content, tokens } = truncateToTokenBudget(loaded.content, loaded.tokens, perSkillCap);
    if (tokens <= 0) continue;
    const label = loaded.path && loaded.path !== "" ? loaded.path : "SKILL.md";
    blocks.push(`### ${loaded.skillName} — ${label}\n${content}`);
    if (!skillIds.includes(loaded.skillId)) skillIds.push(loaded.skillId);
    totalBudget += tokens;
  }
  return { blocks, skillIds };
}

/** Truncate a skill body to at most `capTokens` (approx 4 chars/token), returning the (possibly clipped)
 *  content + its budgeted token count. `recordedTokens` is the load-time count; a whole body under cap is
 *  kept intact. */
function truncateToTokenBudget(
  content: string,
  recordedTokens: number,
  capTokens: number,
): { content: string; tokens: number } {
  if (capTokens <= 0) return { content: "", tokens: 0 };
  if (recordedTokens <= capTokens) return { content, tokens: recordedTokens };
  const capChars = Math.max(0, capTokens * 4);
  return { content: `${content.slice(0, capChars).trimEnd()}\n…[truncated at compaction budget]`, tokens: capTokens };
}

function parseLoadedSkillContent(value: unknown): LoadedSkillContent | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.skillId !== "string" || typeof v.path !== "string" || typeof v.tokens !== "number") {
    return null;
  }
  return {
    skillId: v.skillId,
    skillName: typeof v.skillName === "string" ? v.skillName : v.skillId,
    path: v.path,
    tokens: v.tokens,
    ...(typeof v.content === "string" ? { content: v.content } : {}),
  };
}

// ── Summary assembly ─────────────────────────────────────────────────────────────────────────────────

/**
 * Assemble the persisted summary content from its deterministic parts: the (possibly LLM-compressed)
 * assistant narrative, the VERBATIM preserved user messages (the fidelity block), and the re-attached
 * skill bodies. The preserved block is ALWAYS present when there are user messages — that is what makes a
 * user constraint survive compaction regardless of the summarizer.
 */
export function assembleSummaryContent(input: {
  narrative: string;
  preservedUserMessages: string[];
  reattach: string[];
  userAim?: string;
}): string {
  const sections: string[] = [];
  if (input.userAim) sections.push(`_Compaction aim: ${input.userAim}_`);
  sections.push(`## Summary of earlier assistant activity\n${input.narrative || "(none)"}`);
  if (input.preservedUserMessages.length > 0) {
    const list = input.preservedUserMessages.map((m, i) => `${i + 1}. ${m}`).join("\n");
    sections.push(
      `## User messages & constraints (preserved verbatim — still binding)\n${list}`,
    );
  }
  if (input.reattach.length > 0) {
    sections.push(`## Re-attached skill references (within budget)\n${input.reattach.join("\n\n")}`);
  }
  return sections.join("\n\n");
}

// ── Hot/cold boundary + small helpers ─────────────────────────────────────────────────────────────────

/**
 * The smallest `seq` that belongs to the HOT region: keep the last `keepRecentTurns` user turns (all
 * events from the start of the (keepRecentTurns-th-from-last) user message onward). Only user messages
 * AFTER `afterSeq` (the prior summary boundary) count. Returns `null` when there is no NEW cold region —
 * i.e. there are `<= keepRecentTurns` user turns after `afterSeq`, so nothing older to compact.
 */
export function hotBoundarySeq(
  events: readonly HubEvent[],
  keepRecentTurns: number,
  afterSeq: number,
): number | null {
  const userSeqs = events
    .filter((e) => e.type === "user_message" && seqOf(e) > afterSeq)
    .map((e) => seqOf(e))
    .sort((a, b) => a - b);
  if (userSeqs.length <= keepRecentTurns) return null;
  // The hot region starts at the (keepRecentTurns-th from the end) user message.
  return userSeqs[userSeqs.length - keepRecentTurns] ?? null;
}

/** The latest persisted compaction summary derivable from the event log (max `uptoSeq`). */
export type LatestSummary = { uptoSeq: number; summary: string; summaryId: string };

export function latestCompactionSummary(events: readonly HubEvent[]): LatestSummary | undefined {
  let best: LatestSummary | undefined;
  for (const event of events) {
    if (event.type !== "compaction") continue;
    if (!best || event.uptoSeq > best.uptoSeq) {
      best = { uptoSeq: event.uptoSeq, summary: event.summary, summaryId: event.summaryId };
    }
  }
  return best;
}

/** Sum `countText` over each message's string content (the reconstructed history is all-string). */
export async function countMessagesTokens(
  counter: TokenCounter,
  messages: readonly ModelMessage[],
): Promise<number> {
  let total = 0;
  for (const message of messages) {
    total +=
      typeof message.content === "string"
        ? await counter.countText(message.content)
        : await counter.countJson(message.content);
  }
  return total;
}

function textOfParts(parts: readonly { type: string }[]): string {
  return parts
    .filter((p): p is HubTextPart => p.type === "text")
    .map((p) => p.text)
    .join("");
}

function compactionEvent(input: {
  summaryId: string;
  uptoSeq: number;
  summary: string;
  summaryTokens: number;
  clearedToolOutputs: number;
  clearedToolOutputTokens: number;
  windowBefore: number;
  windowAfter: number;
  reattachedSkillIds: string[];
  userAim?: string;
}): HubEventInput {
  return {
    type: "compaction",
    summaryId: input.summaryId,
    uptoSeq: input.uptoSeq,
    summary: input.summary,
    summaryTokens: input.summaryTokens,
    clearedToolOutputs: input.clearedToolOutputs,
    ...(input.clearedToolOutputTokens > 0
      ? { clearedToolOutputTokens: input.clearedToolOutputTokens }
      : {}),
    windowBefore: input.windowBefore,
    windowAfter: input.windowAfter,
    ...(input.reattachedSkillIds.length > 0 ? { reattachedSkillIds: input.reattachedSkillIds } : {}),
    ...(input.userAim ? { userAim: input.userAim } : {}),
  };
}

function persistSummary(
  repository: HubRepository,
  input: { sessionId: string; uptoSeq: number; content: string; tokens: number },
): string {
  const summary: HubSessionSummary = repository.createSessionSummary(input);
  return summary.id;
}

function suffixReady(messages: ModelMessage[], systemSuffix: string): HubCompactionPrepared {
  return { kind: "ready", messages, systemSuffix };
}

function seqOf(event: HubEvent): number {
  return event.seq ?? 0;
}

function maxSeq(events: readonly HubEvent[]): number {
  let max = 0;
  for (const event of events) max = Math.max(max, seqOf(event));
  return max;
}
