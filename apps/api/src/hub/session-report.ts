// Assistant Hub — full session-log export (JSON + Markdown). Mirrors the STYLE of the Testing run
// report (`apps/api/src/reports/reports.ts`'s `createRun{Json,Markdown}Report`) but over the hub's
// append-only `hub_events` log, which IS the session's source of truth ("a session's full state is
// reconstructible from its event log alone", R-SES1). The export is therefore a faithful render of
// every event in `seq` order — every input and output, in sequence — never a lossy summary:
//   • JSON  → the session metadata + the complete ordered event log (nothing dropped).
//   • Markdown → a human-readable transcript: the conversational spine (user · assistant · reasoning ·
//     tool call/result · question/answer · phase) rendered richly, and every other structural event
//     (plan · mission · artifact · memory · file · review · approval · elicitation · compaction · errors)
//     rendered as a labeled block with its payload, so nothing is silently omitted.

import type { HubEvent, HubMessagePart, HubSession, HubUsage } from "@mcp-token-footprint/shared";
import { buildMissionTraceForest, type HubMissionTraceNode } from "./mission-trace.js";

/** The JSON export shape (additive/new). Self-describing so a downstream reader knows what it holds. */
export type HubSessionReport = {
  kind: "hub_session_report";
  version: 1;
  generatedAt: string;
  session: HubSession;
  eventCount: number;
  events: HubEvent[];
  /** Crew nesting (WP3.2 · D-CN7) — the session's hierarchical mission execution trace (parent crew ->
   *  child crew -> agents, per-level cost/token/timing rollup), additive. Absent when the session has no
   *  mission at all — `version` stays `1`, this is a new optional field, not a breaking shape change. */
  missionTraces?: HubMissionTraceNode[];
};

export function buildHubSessionJsonReport(
  session: HubSession,
  events: HubEvent[],
  now: string,
): HubSessionReport {
  const missionTraces = buildMissionTraceForest(events);
  return {
    kind: "hub_session_report",
    version: 1,
    generatedAt: now,
    session,
    eventCount: events.length,
    events,
    ...(missionTraces.length > 0 ? { missionTraces } : {}),
  };
}

// ── Markdown ────────────────────────────────────────────────────────────────────────────────────────

function fence(body: string, lang = ""): string {
  const text = body.length > 0 ? body : "(empty)";
  return `\`\`\`${lang}\n${text}\n\`\`\``;
}

/** Stable, human-readable rendering of an arbitrary payload — a string as-is, anything else pretty JSON. */
function renderValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function usageLine(usage: HubUsage | undefined): string | null {
  if (!usage) return null;
  const parts: string[] = [];
  if (typeof usage.tokensIn === "number") parts.push(`${usage.tokensIn} in`);
  if (typeof usage.tokensOut === "number") parts.push(`${usage.tokensOut} out`);
  return parts.length > 0 ? parts.join(" / ") : null;
}

/** Crew nesting (WP3.2) — the shared `$X.XXXXXX` cost rendering, factored so the header cost line, the
 *  assistant-message meta line, and the new mission-trace rollup line can't drift apart. */
function formatCostUsd(costUsd: number): string {
  return `$${costUsd.toFixed(6)}`;
}

/** Crew nesting (WP3.2) — the shared "N in / M out" token-count rendering (both counts always known,
 *  unlike {@link usageLine}'s independently-optional pair), factored for the same reason. */
function formatTokens(tokensIn: number, tokensOut: number): string {
  return `${tokensIn} in / ${tokensOut} out`;
}

/** Render one assistant message part to markdown (text, reasoning, tool ref, citation, artifact, genui). */
function renderPart(part: HubMessagePart): string {
  switch (part.type) {
    case "text":
      return part.text.trim();
    case "reasoning":
      return part.text
        .trim()
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    case "tool_call":
      return `_Tool: \`${part.toolName}\` (${part.source})_`;
    default:
      // citation / artifact_ref / genui — compact labeled dump so nothing is lost.
      return `_[${part.type}]_\n${fence(renderValue(part), "json")}`;
  }
}

/** Render one event to a markdown block (heading + body). `seq` prefixes the heading for cross-reference. */
function renderEvent(event: HubEvent): string {
  const seq = event.seq !== undefined ? `${event.seq} · ` : "";
  switch (event.type) {
    case "user_message":
      return `### ${seq}User\n\n${event.text.trim() || "(empty)"}`;
    case "assistant_message": {
      const body = event.parts.map(renderPart).filter(Boolean).join("\n\n");
      const meta: string[] = [`model: ${event.model}`];
      const u = usageLine(event.usage);
      if (u) meta.push(`tokens: ${u}`);
      if (typeof event.costUsd === "number") meta.push(`cost: ${formatCostUsd(event.costUsd)}`);
      return `### ${seq}Assistant\n\n_${meta.join(" · ")}_\n\n${body || "(no content)"}`;
    }
    case "reasoning":
      return `### ${seq}Reasoning\n\n${renderPart({ type: "reasoning", text: event.text })}`;
    case "tool_call": {
      const part = event.part;
      const head = `### ${seq}Tool call — \`${part.toolName}\` (${part.source})`;
      const args = part.args !== undefined ? part.args : part.argsText;
      return args !== undefined ? `${head}\n\n${fence(renderValue(args), "json")}` : head;
    }
    case "tool_result": {
      const head = `### ${seq}Tool result — ${event.state}`;
      const body = event.isError
        ? renderValue(event.errorText ?? event.modelContent)
        : renderValue(event.modelContent);
      return body ? `${head}\n\n${fence(body, "json")}` : head;
    }
    case "question": {
      const opts = (event.options ?? [])
        .map((o) => `- ${o.label}${o.description ? ` — ${o.description}` : ""}`)
        .join("\n");
      return `### ${seq}Question\n\n${event.prompt}${opts ? `\n\n${opts}` : ""}`;
    }
    case "question_resolved":
      return `### ${seq}Answer\n\n${event.answer ?? "_(stopped without answering)_"}`;
    case "phase":
      return `### ${seq}Phase → ${event.phase ?? "none"}${
        event.detail?.reason ? ` (${event.detail.reason})` : ""
      }`;
    case "turn_done": {
      const u = usageLine(event.usage);
      return `### ${seq}Turn complete${u ? ` — ${u}` : ""}`;
    }
    case "error":
    case "limit_error":
      return `### ${seq}${event.type === "limit_error" ? "Limit error" : "Error"}\n\n${event.message}`;
    default:
      // Every structural event (plan · mission · agent · artifact · memory · file · review · approval ·
      // elicitation · compaction · branch · resource · mcp_server_status · ui_state) — labeled + dumped
      // so the transcript is genuinely complete, never silently lossy.
      return `### ${seq}${event.type}\n\n${fence(renderValue(stripEnvelope(event)), "json")}`;
  }
}

/** Drop the wire envelope (`type`/`seq`/`at`) from an event for the generic payload dump. */
function stripEnvelope(event: HubEvent): Record<string, unknown> {
  const { type: _type, seq: _seq, at: _at, ...rest } = event as Record<string, unknown> & {
    type: string;
  };
  return rest;
}

// ── Mission trace (crew nesting WP3.2, D-CN7) ──────────────────────────────────────────────────────────

/** The rollup line reused at every depth: `$X.XXXXXX · N in / M out[ · <duration>ms]`. */
function renderMissionTraceRollupLine(rollup: HubMissionTraceNode["rollup"]): string {
  const parts = [formatCostUsd(rollup.costUsd), formatTokens(rollup.tokensIn, rollup.tokensOut)];
  if (rollup.durationMs !== undefined) parts.push(`${rollup.durationMs}ms`);
  return parts.join(" · ");
}

/**
 * Render one `HubMissionTraceNode` as a BULLET-LIST block (never a markdown heading — a nested tree can
 * exceed Markdown's H1–H6 ceiling), indented 2 spaces per `depth`: a heading-style bullet line (missionId /
 * topology / phase / depth / role-in-parent), the rollup line, this level's own leaf agents, the
 * synthesis/partial line, then recurses into `children` one indent level deeper.
 */
function renderMissionTraceNode(node: HubMissionTraceNode, depth: number): string {
  const indent = "  ".repeat(depth);
  const lines: string[] = [];
  const role = node.roleName ? ` (role: ${node.roleName})` : "";
  const autonomy = node.autonomy ? ` · autonomy: ${node.autonomy}` : "";
  lines.push(
    `${indent}- **Mission \`${node.missionId}\`**${role} — topology: ${node.topology} · phase: ${node.phase} · depth: ${node.depth}${autonomy}`,
  );
  lines.push(`${indent}  - Rollup: ${renderMissionTraceRollupLine(node.rollup)}`);
  if (node.agents.length > 0) {
    lines.push(`${indent}  - Agents:`);
    for (const agent of node.agents) {
      const cost = agent.costUsd !== undefined ? ` — cost: ${formatCostUsd(agent.costUsd)}` : "";
      lines.push(
        `${indent}    - \`${agent.key}\` (${agent.roleName}, ${agent.model}) — ${
          agent.reported ? "reported" : "running"
        }${cost}`,
      );
    }
  }
  if (node.synthesis) {
    const messageId = node.synthesis.messageId ? ` (message: \`${node.synthesis.messageId}\`)` : "";
    lines.push(`${indent}  - Synthesis: partial=${node.synthesis.partial}${messageId}`);
  }
  if (node.children.length > 0) {
    lines.push(`${indent}  - Children:`);
    for (const child of node.children) lines.push(renderMissionTraceNode(child, depth + 1));
  }
  return lines.join("\n");
}

/** The `## Mission trace` section — rendered ONLY when the forest is non-empty (a session with no
 *  mission carries no such heading at all, regression-guarded in `hub-session-report.test.ts`). */
function renderMissionTraceSection(missionTraces: HubMissionTraceNode[]): string[] {
  if (missionTraces.length === 0) return [];
  return [
    `## Mission trace`,
    `_${missionTraces.length} mission tree${missionTraces.length === 1 ? "" : "s"}._`,
    "",
    missionTraces.map((node) => renderMissionTraceNode(node, 0)).join("\n"),
    "",
    "---",
    "",
  ];
}

export function buildHubSessionMarkdownReport(
  session: HubSession,
  events: HubEvent[],
  now: string,
): string {
  const header: string[] = [
    `# Assistant session transcript`,
    "",
    `**Title:** ${session.title || "(untitled)"}`,
    `**Session:** \`${session.id}\``,
    `**Model:** ${session.model} · **Mode:** ${session.mode} · **Kind:** ${session.kind}`,
    `**Status:** ${session.status}${session.stopReasonCode ? ` (${session.stopReasonCode})` : ""}`,
    `**Created:** ${session.createdAt} · **Updated:** ${session.updatedAt}`,
    `**Cost:** ${formatCostUsd(session.costUsd ?? 0)} · **Tokens:** ${formatTokens(
      session.tokensIn ?? 0,
      session.tokensOut ?? 0,
    )}`,
    `**Exported:** ${now}`,
    "",
    "---",
    "",
  ];
  // Crew nesting (WP3.2) — inserted BETWEEN the header block and `## Transcript`; empty when the session
  // has no mission, so the concatenation below is byte-identical to the pre-WP3.2 output in that case.
  const missionSection = renderMissionTraceSection(buildMissionTraceForest(events));
  const transcriptHeader = [
    `## Transcript`,
    `_${events.length} event${events.length === 1 ? "" : "s"}, in order._`,
    "",
  ];
  const body = events.map(renderEvent).join("\n\n");
  return `${[...header, ...missionSection, ...transcriptHeader].join("\n")}\n${body}\n`;
}
