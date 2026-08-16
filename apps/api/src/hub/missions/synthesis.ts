// Assistant Hub (roadmap/assistant-hub/, WP1.7, §1.7 · D-AH6/D-AH9/D-AH10) — mission SYNTHESIS.
//
// Once the agents have reported, the synthesizer composes the final answer FROM their structured
// reports and CITES them — carrying every agent's citations forward so every rendered `[n]` still
// resolves (§1.7, reviewed adversarially). This is the citation-preservation core:
//
//   1. `mergeAgentCitations` collects every report's `citations[]` (each already stamped with its
//      `agentRef` by the orchestrator), de-dupes by URL|title, and RE-NUMBERS them into one stable
//      session-level sequence — preserving `agentRef` so the provenance of each source survives. It
//      returns a per-agent OLD→NEW id remap so each finding's `[n]` markers can be rewritten.
//   2. `buildReportsDigest` renders the reports (with remapped markers) as the synthesizer's evidence.
//   3. `synthesizeMission` runs the synthesizer turn (mode `synthesizer` — its addendum demands
//      attribution + carried citations + a PARTIAL mark when a budget tripped / the mission stopped),
//      persists the settled synthesis `assistant_message` (its `citations[]` = the full merged set, so
//      every `[n]` resolves) into the PARENT session log, then the `mission_synthesis` event.
//
// If the synthesizer model call fails, a DETERMINISTIC fallback answer (the reports' own summaries) is
// composed instead — a mission always yields SOME honest answer, marked partial. No model call ever
// crashes a mission.

import type {
  HubAgentReport,
  HubCitation,
  HubMission,
  HubUsage,
} from "@mcp-token-footprint/shared";
import { generateText, type LanguageModel } from "ai";
import { nanoid } from "nanoid";
import { compileGenuiCatalogPrompt } from "../genui/index.js";
import { assembleSessionPrompt } from "../prompting/index.js";
import type { HubRepository } from "../repository.js";
import type { HubSynthesisTurnInput, HubSynthesisTurnResult } from "../session-service.js";
import type { HubTurnSink } from "../turn-engine.js";
import { renderReportText, summarizeCapabilitiesLine } from "./shared.js";

/** The synthesizer DI seam: compose the final answer text from the assembled prompt + reports digest.
 *  Production wraps AI-SDK `generateText`; tests inject a deterministic stub. A throw is tolerated —
 *  {@link synthesizeMission} falls back to a deterministic answer. */
export type HubSynthesizerInput = {
  systemPrompt: string;
  userPrompt: string;
  model: string;
  /** model-identity WP4.2 (D-MI1) — the credential that owns `model`, so the production seam resolves
   *  on the provider the mission chose rather than re-guessing from the model name. Absent ⇒ the
   *  unchanged heuristic (an existing stub/caller behaves byte-identically). */
  providerCredentialId?: string;
};
export type HubSynthesizerResult = { text: string; usage?: HubUsage; costUsd?: number };
export type HubSynthesizer = (input: HubSynthesizerInput) => Promise<HubSynthesizerResult>;

/** hub-fixes WP3.2 (RC4, D-HF4) — the synthesis-TURN seam: run the mission's final answer as a REAL turn
 *  of the PARENT session through the turn engine, with the GenUI `present` tools available so the answer
 *  can render widgets plus prose. Implemented by `HubSessionService.runSynthesisTurn`; a stub in tests.
 *  {@link synthesizeMission} tries it first (unless `synthesisMode` is `"text"`) and, on ANY throw, falls
 *  back to the byte-compatible {@link HubSynthesizer} text path. */
export type HubSynthesisTurn = (input: HubSynthesisTurnInput) => Promise<HubSynthesisTurnResult>;

/** hub-fixes WP3.2 (D-HF4) — the LAYER-appended nudge for the synthesis TURN: the GenUI catalog layer
 *  already teaches the components; this steers WHEN to reach for them vs prose. */
const SYNTHESIS_GENUI_NUDGE =
  "Presentation: prefer a compact GenUI presentation via `present` — a Table or StatGroup for rankings and comparisons, a Chart for a trend — and keep prose (with the `[n]` citations) for the reasoning that ties them together. Never mention the widget or the tool call itself.";

/** The re-numbered, provenance-preserving merged citation set + the per-agent OLD→NEW id remap. */
export type MergedCitations = {
  citations: HubCitation[];
  /** agentSessionId → (report-local citation id → merged citation id). */
  remaps: Map<string, Map<string, string>>;
};

function normalizeKey(citation: HubCitation): string {
  if (citation.url) {
    try {
      const parsed = new URL(citation.url);
      parsed.hash = "";
      return `u:${parsed.host.toLowerCase()}${parsed.pathname}${parsed.search}`;
    } catch {
      return `u:${citation.url.trim().toLowerCase()}`;
    }
  }
  return `t:${citation.title.trim().toLowerCase()}`;
}

/**
 * Merge every report's citations into ONE stably-numbered session-level set (§1.7). De-dupes by
 * URL|title (first occurrence wins its number + keeps its `agentRef`), re-numbers 1..N, and records a
 * per-agent OLD→NEW remap so finding markers can be rewritten. Preserves `agentRef` on each merged
 * citation — the provenance that survives synthesis (D-AH10).
 */
export function mergeAgentCitations(reports: readonly HubAgentReport[]): MergedCitations {
  const byKey = new Map<string, HubCitation>();
  const remaps = new Map<string, Map<string, string>>();
  let next = 1;

  for (const report of reports) {
    const agentRef = report.agentSessionId ?? "";
    const remap = remaps.get(agentRef) ?? new Map<string, string>();
    for (const citation of report.citations) {
      const key = normalizeKey(citation);
      let merged = byKey.get(key);
      if (!merged) {
        const id = String(next++);
        merged = {
          id,
          title: citation.title,
          ...(citation.url ? { url: citation.url } : {}),
          ...(citation.snippet ? { snippet: citation.snippet } : {}),
          ...(agentRef ? { agentRef } : citation.agentRef ? { agentRef: citation.agentRef } : {}),
          ...(citation.toolCallRef ? { toolCallRef: citation.toolCallRef } : {}),
          ...(citation.fileRef ? { fileRef: citation.fileRef } : {}),
        };
        byKey.set(key, merged);
      }
      remap.set(citation.id, merged.id);
    }
    if (agentRef) remaps.set(agentRef, remap);
  }

  const citations = [...byKey.values()].sort((a, b) => Number(a.id) - Number(b.id));
  return { citations, remaps };
}

/**
 * Rewrite raw `[n]` markers in already-rendered text against an agent-scoped remap (report-local
 * citation id -> merged citation id). A marker whose number the agent does NOT own — absent from its
 * own `remap`, e.g. a stray/typo'd raw `[n]` in the finding text that isn't backed by that agent's
 * `citations[]` — is DROPPED (bracket, digit, and its one adjacent space) rather than left as a literal
 * `[n]`. Left un-remapped, that stray marker can coincidentally collide with a DIFFERENT agent's merged
 * citation number and mis-attribute a claim to the wrong source (WP1.R INV2) — dropping it instead means
 * every rendered `[n]` either resolves to the agent's own correct source or doesn't render as a citation
 * chip at all (the UI/`findCitationMarkers` both match on `\[\d+\]`, so a dropped marker is inert). No
 * `remap` (nothing to rewrite against) leaves the text untouched.
 */
function remapOrDropMarkers(text: string, remap: Map<string, string> | undefined): string {
  if (!remap) return text;
  return text.replace(/( ?)\[(\d{1,4})\]/g, (_match, leadingSpace: string, n: string) => {
    const mapped = remap.get(n);
    return mapped ? `${leadingSpace}[${mapped}]` : "";
  });
}

/** Rewrite a report's finding markers from report-local ids to their merged ids. A finding's text may
 *  carry raw `[n]` markers AND/OR `citationIds`; both are remapped so every marker points at a merged
 *  source (an unowned raw marker is dropped — see {@link remapOrDropMarkers}). */
function remapFindingText(
  text: string,
  citationIds: readonly string[] | undefined,
  remap: Map<string, string> | undefined,
): string {
  let out = remapOrDropMarkers(text, remap);
  // Append any structured citationIds not already present inline, remapped.
  if (citationIds && citationIds.length > 0 && remap) {
    const mapped = citationIds.map((id) => remap.get(id)).filter((v): v is string => !!v);
    const markers = mapped.map((id) => `[${id}]`).filter((mk) => !out.includes(mk));
    if (markers.length > 0) out = `${out} ${markers.join("")}`;
  }
  return out;
}

/** Build the synthesizer's evidence digest: one section per agent report, findings carrying REMAPPED
 *  `[n]` markers, plus each agent's confidence + open questions (R-UX9 render inputs). */
export function buildReportsDigest(reports: readonly HubAgentReport[], merged: MergedCitations): string {
  const sections: string[] = [];
  for (const report of reports) {
    const agentRef = report.agentSessionId ?? "";
    const remap = merged.remaps.get(agentRef);
    const heading = report.roleName?.trim() || agentRef || "Agent";
    const lines: string[] = [`### ${heading}  (confidence: ${report.confidence})`];
    if (report.summary?.trim()) lines.push(report.summary.trim());
    if (report.findings.length > 0) {
      lines.push("Findings:");
      for (const finding of report.findings) {
        lines.push(`- ${remapFindingText(finding.summary, finding.citationIds, remap)}`);
      }
    }
    if (report.openQuestions.length > 0) {
      lines.push("Open questions:");
      for (const q of report.openQuestions) lines.push(`- ${q}`);
    }
    sections.push(lines.join("\n"));
  }
  return sections.join("\n\n");
}

// ── assistant-hub v1-fixes (F2/F7) — the mission's model-visible memory ───────────────────────────

const DIGEST_MAX_FINDINGS_PER_AGENT = 6;
const DIGEST_ITEM_MAX_CHARS = 300;
const DIGEST_MAX_CHARS = 6_000;
const FOLLOWUPS_MAX = 24;

function clipLine(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/**
 * Build the compact `mission_digest` text (F2): per-agent finding summaries + ALL open questions,
 * agent-attributed. History reconstruction folds this into every LATER parent turn, so the session can
 * always quote what its agents found ("model context = UI context" — the analysis doc's principle 1);
 * the full structured reports stay readable on demand via the `mission.report` builtin (F3). Pure +
 * hard-capped so a large mission can never blow the context budget.
 */
export function buildMissionDigest(
  reports: readonly HubAgentReport[],
  opts?: { partial?: boolean },
): string {
  if (reports.length === 0) return "";
  const lines: string[] = [
    `Mission results digest (${reports.length} agent report${reports.length === 1 ? "" : "s"}${
      opts?.partial ? ", partial mission" : ""
    }) — per-agent findings and open questions. Full reports: \`mission.report\`.`,
  ];
  for (const report of reports) {
    const name = report.roleName?.trim() || report.agentSessionId || "Agent";
    lines.push(`\n### ${name} — confidence ${report.confidence}`);
    for (const finding of report.findings.slice(0, DIGEST_MAX_FINDINGS_PER_AGENT)) {
      lines.push(`- ${clipLine(finding.summary, DIGEST_ITEM_MAX_CHARS)}`);
    }
    if (report.findings.length > DIGEST_MAX_FINDINGS_PER_AGENT) {
      lines.push(
        `- (+${report.findings.length - DIGEST_MAX_FINDINGS_PER_AGENT} more findings — see \`mission.report\`)`,
      );
    }
    if (report.openQuestions.length > 0) {
      lines.push("Open questions:");
      for (const q of report.openQuestions) lines.push(`- ${clipLine(q, DIGEST_ITEM_MAX_CHARS)}`);
    }
  }
  const text = lines.join("\n");
  return text.length > DIGEST_MAX_CHARS
    ? `${text.slice(0, DIGEST_MAX_CHARS)}\n… (digest truncated — full reports via \`mission.report\`)`
    : text;
}

/** Collect the mission's deduped open questions (F7), agent-attributed, in report order — the payload
 *  of the `mission_followups` event (the UI's one-click follow-up seed + the planner's context). */
export function collectMissionFollowups(
  reports: readonly HubAgentReport[],
): Array<{ question: string; agentSessionId?: string; roleName?: string }> {
  const seen = new Set<string>();
  const out: Array<{ question: string; agentSessionId?: string; roleName?: string }> = [];
  for (const report of reports) {
    for (const raw of report.openQuestions) {
      const question = raw.trim();
      const key = question.toLowerCase().replace(/\s+/g, " ");
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({
        question,
        ...(report.agentSessionId ? { agentSessionId: report.agentSessionId } : {}),
        ...(report.roleName ? { roleName: report.roleName } : {}),
      });
      if (out.length >= FOLLOWUPS_MAX) return out;
    }
  }
  return out;
}

/** The numbered source list the synthesizer is told to cite by (`[n]` → title/url). */
function buildSourceList(citations: readonly HubCitation[]): string {
  if (citations.length === 0) return "(no sources — the agents cited none)";
  return citations
    .map((c) => `[${c.id}] ${c.title}${c.url ? ` — ${c.url}` : ""}`)
    .join("\n");
}

/** A deterministic, model-free synthesis (the fallback when the synthesizer call fails, and the base
 *  for a stopped/empty mission): the reports' own summaries, honestly framed. Remaps each agent's own
 *  `[n]` markers to the merged numbering; a marker the agent doesn't own is dropped, never left raw. */
function deterministicSynthesis(reports: readonly HubAgentReport[], merged: MergedCitations): string {
  if (reports.length === 0) return "No agent completed before the mission ended, so there is nothing to synthesize.";
  const parts = reports.map((report) => {
    const remap = merged.remaps.get(report.agentSessionId ?? "");
    const heading = report.roleName?.trim() || report.agentSessionId || "Agent";
    const body = renderReportText(report, { heading });
    // Remap the deterministic body's markers too (an unowned raw marker is dropped, never left to
    // coincidentally collide with a different agent's merged number — WP1.R INV2).
    return remapOrDropMarkers(body, remap);
  });
  return parts.join("\n\n");
}

const PARTIAL_PREFIX =
  "_This synthesis is PARTIAL — the mission did not run every planned agent to completion. What follows draws only on the agents that reported._\n\n";

/**
 * Run the mission synthesis turn (§1.7): merge + re-number citations, build the digest, and produce the
 * final answer. hub-fixes WP3.2 (RC4, D-HF4): unless `synthesisMode` is `"text"` and a `runSynthesisTurn`
 * seam is wired, the synthesis runs as a REAL turn of the PARENT session through the turn engine WITH the
 * GenUI `present` tools available (so the answer can use Table/StatGroup/Chart widgets plus prose) — the
 * turn engine persists the settled `assistant_message` (its parts may carry GenUI widgets) + `turn_done`,
 * and this function then appends the `mission_synthesis` marker linked to that message. On ANY failure of
 * the turn path — or when `synthesisMode` is `"text"` / no turn seam is wired — it falls back to the
 * pre-fix, byte-compatible tool-less `generateText` synthesizer path below (which itself persists the
 * settled `assistant_message` [`citations[]` = full merged set so every `[n]` resolves] + `mission_synthesis`
 * + `turn_done`, forwarding all live; a deterministic fallback on model failure). Returns the ids/citations
 * for the orchestrator to fold into the mission terminal.
 */
export async function synthesizeMission(
  deps: {
    repository: HubRepository;
    synthesizer: HubSynthesizer;
    /** hub-fixes WP3.2 (D-HF4) — the synthesis-TURN seam. Absent ⇒ the text path (pre-WP3.2 behavior). */
    runSynthesisTurn?: HubSynthesisTurn;
    /** hub-fixes WP3.2 (D-HF4, `HUB_SYNTHESIS_MODE`) — `"text"` forces the fallback path even when a turn
     *  seam is wired; anything else (default) prefers the turn path when the seam is present. */
    synthesisMode?: "turn" | "text";
    logger?: { warn?: (m: string) => void };
  },
  args: {
    mission: HubMission;
    sessionId: string;
    userText: string;
    model: string;
    /** model-identity WP4.2 (D-MI1) — the credential that owns {@link model} (the orchestrator's
     *  `pickSynthesisModel` winner may be a PLAN agent's model, whose pin must travel with it). Absent ⇒
     *  `runSynthesisTurn` falls back to the parent session's own pin, then the unchanged heuristic. */
    providerCredentialId?: string;
    reports: HubAgentReport[];
    partial: boolean;
    sink: HubTurnSink;
    /** model-identity WP4.2 (D-MI4) — a caller-known reason the model-backed synthesis CANNOT run at
     *  all (e.g. every model in the mission is subscription-backed, and the Agent-SDK path is not wired
     *  into the synthesis turn). When set, the deterministic fallback is used deliberately and the note
     *  is PREPENDED to the answer, so a mechanical synthesis is never mistaken for a model-written one.
     *  Absent ⇒ the model path is attempted exactly as before. */
    degradedNote?: string;
    /** hub-fixes WP3.2 — abort the synthesis TURN (the mission's own abort); ignored by the text path. */
    abortSignal?: AbortSignal;
    now?: string;
  },
): Promise<{ messageId: string; citations: HubCitation[]; costUsd: number }> {
  const { repository, synthesizer } = deps;
  const { mission, sessionId, reports, partial, sink } = args;

  const merged = mergeAgentCitations(reports);
  const digest = buildReportsDigest(reports, merged);
  const sourceList = buildSourceList(merged.citations);

  const promptSession = {
    sessionTitle: mission.plan.rationale ? `Mission: ${mission.plan.rationale}` : "Mission synthesis",
    mode: "mission" as const,
    modelId: args.model,
    capabilities: summarizeCapabilitiesLine(),
    date: args.now ?? new Date().toISOString().slice(0, 10),
  };
  const assembled = assembleSessionPrompt({ mode: "synthesizer", session: promptSession });

  const partialNote = partial
    ? "\n\nNOTE: at least one planned agent did not complete (a budget tripped or the mission was stopped). Mark the synthesis PARTIAL and name what is missing."
    : "";
  const userPrompt = [
    `The user's request:\n${args.userText}`,
    `\nAgent reports:\n${digest}`,
    `\nNumbered sources (cite these as [n]):\n${sourceList}`,
    `\nCompose the final answer. Attribute claims to the agent that produced them and carry citations forward so every [n] resolves.${partialNote}`,
  ].join("\n");

  // ── hub-fixes WP3.2 (RC4, D-HF4) — the TURN path: run the synthesis as a real turn of the PARENT
  //    session with GenUI tools available. The turn engine persists the settled `assistant_message`
  //    (parts may include GenUI widgets) + `turn_done`; we then link the `mission_synthesis` marker to it
  //    (same messageId linkage; replay-compatible). ANY failure falls through to the byte-compatible text
  //    path below — never a double-persist (`runSynthesisTurn` throws when it persisted no message).
  if (deps.synthesisMode !== "text" && deps.runSynthesisTurn && !args.degradedNote) {
    try {
      const genui = compileGenuiCatalogPrompt();
      const assembledWithGenui = assembleSessionPrompt({
        mode: "synthesizer",
        session: promptSession,
        genuiCatalog: { catalogText: genui.catalogText, specVersion: genui.specVersion },
      });
      // The whole synthesizer instruction rides in the system override (the reconstructed history's last
      // user turn is the mission ask): synthesizer layers + GenUI catalog + reports digest + numbered
      // sources + compose instructions + the presentation nudge.
      const systemPromptOverride = [assembledWithGenui.text, userPrompt, SYNTHESIS_GENUI_NUDGE].join(
        "\n\n",
      );
      const turn = await deps.runSynthesisTurn({
        sessionId,
        model: args.model,
        ...(args.providerCredentialId
          ? { providerCredentialId: args.providerCredentialId }
          : {}),
        systemPromptOverride,
        citations: merged.citations,
        ...(partial ? { partialPrefix: PARTIAL_PREFIX } : {}),
        ...(args.abortSignal ? { abortSignal: args.abortSignal } : {}),
        sink,
      });
      const synthesisEvent = repository.appendEvent(sessionId, {
        type: "mission_synthesis",
        missionId: mission.id,
        messageId: turn.messageId,
        partial,
        agentReportRefs: reports
          .map((r) => r.agentSessionId)
          .filter((id): id is string => !!id),
      });
      sink.onEvent(synthesisEvent);
      return { messageId: turn.messageId, citations: merged.citations, costUsd: turn.costUsd };
    } catch (error) {
      deps.logger?.warn?.(
        `[hub mission ${mission.id}] synthesis turn failed; using the text synthesizer: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      // fall through to the byte-compatible text path
    }
  }

  let text: string;
  let usage: HubUsage | undefined;
  let costUsd = 0;
  if (args.degradedNote) {
    // model-identity WP4.2 (D-MI4) — the caller already knows no model can run this synthesis. Skip the
    // guaranteed-to-fail (and, on a priced model, billable) call and compose deterministically — but say
    // so in the answer via `degradedPrefix` below, never silently.
    deps.logger?.warn?.(
      `[hub mission ${mission.id}] no synthesis-capable model; composing the answer deterministically.`,
    );
    text = deterministicSynthesis(reports, merged);
  } else {
    try {
      const result = await synthesizer({
        systemPrompt: assembled.text,
        userPrompt,
        model: args.model,
        ...(args.providerCredentialId
          ? { providerCredentialId: args.providerCredentialId }
          : {}),
      });
      text = result.text?.trim()
        ? result.text.trim()
        : deterministicSynthesis(reports, merged);
      usage = result.usage;
      costUsd = result.costUsd ?? 0;
    } catch (error) {
      deps.logger?.warn?.(
        `[hub mission ${mission.id}] synthesizer failed; using a deterministic synthesis: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      text = deterministicSynthesis(reports, merged);
    }
  }

  const degradedPrefix = args.degradedNote ? `_${args.degradedNote}_\n\n` : "";
  const body = `${partial ? PARTIAL_PREFIX : ""}${degradedPrefix}${text}`;
  const messageId = nanoid();

  // The message carries the FULL merged citation set — the Sources panel is complete AND every `[n]`
  // the synthesizer wrote resolves against it (the §1.7 resolve invariant the tests assert via
  // `findCitationMarkers`).
  const assistant = repository.appendEvent(sessionId, {
    type: "assistant_message",
    messageId,
    model: args.model,
    parts: [{ type: "text", text: body }],
    ...(usage ? { usage } : {}),
    citations: merged.citations,
    artifactsTouched: [],
    ...(assembled.promptVersion ? { promptVersion: assembled.promptVersion } : {}),
    costUsd,
    costBasis: "api_exact",
    finishReason: "stop",
  });
  sink.onEvent(assistant);

  const synthesisEvent = repository.appendEvent(sessionId, {
    type: "mission_synthesis",
    missionId: mission.id,
    messageId,
    partial,
    agentReportRefs: reports
      .map((r) => r.agentSessionId)
      .filter((id): id is string => !!id),
  });
  sink.onEvent(synthesisEvent);

  // Settle the planning/synthesis "turn" so the stream's `turnRunning` flips false + the composer frees.
  const turnDone = repository.appendEvent(sessionId, {
    type: "turn_done",
    messageId,
    ...(usage ? { usage } : {}),
    costUsd,
    costBasis: "api_exact",
  });
  sink.onEvent(turnDone);

  return { messageId, citations: merged.citations, costUsd };
}

/**
 * Production synthesizer (NOT gate-verified — no live provider): a `generateText` call over the
 * assembled synthesizer prompt. A throw is tolerated by {@link synthesizeMission} (deterministic
 * fallback), so a synthesis always produces some honest answer.
 */
export function createTextSynthesizer(deps: {
  /** model-identity WP4.2 — widened to take the credential that owns the model (D-MI1). Additive: a
   *  one-argument stub still satisfies this type, so every existing construction compiles unchanged. */
  buildModel: (modelId: string, providerCredentialId?: string) => LanguageModel;
}): HubSynthesizer {
  return async ({ systemPrompt, userPrompt, model, providerCredentialId }) => {
    const result = await generateText({
      model: deps.buildModel(model, providerCredentialId),
      system: systemPrompt,
      prompt: userPrompt,
    });
    return {
      text: result.text,
      usage: {
        tokensIn: result.usage?.inputTokens ?? 0,
        tokensOut: result.usage?.outputTokens ?? 0,
      },
    };
  };
}
