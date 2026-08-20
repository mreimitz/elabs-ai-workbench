// Assistant Hub (planning/Roadmap/RM-03-assistant-hub/, WP1.7) — pure helpers shared by the mission planner,
// orchestrator, synthesizer and board reducer. No I/O, no model calls — safe to import anywhere.

import type {
  HubAgentReport,
  HubBudgets,
  HubPlannedAgent,
  HubToolGrants,
} from "@mcp-token-footprint/shared";

/** A one-line capabilities summary for the planner's session-context prompt layer. The planner turn
 *  runs on the parent session's model with the standard AI-SDK capability shape (tools + accounting);
 *  a static line is enough (the planner routes over the roster, not this line). */
export function summarizeCapabilitiesLine(): string {
  return "tools · context accounting · tokens: exact · cost: est.";
}

/**
 * hub-fixes WP2.2 (RC2.4) — a short "e.g. …" capability line for ONE grantable server, from the first
 * few of its scanned tool names. Orientation for the planner + the plan-card chips, never an exhaustive
 * listing (the full tool surface is measured elsewhere). Deterministic (input order preserved).
 */
export function summarizeServerCapability(toolNames: readonly string[], max = 6): string {
  const names = toolNames.map((n) => n.trim()).filter((n) => n.length > 0);
  if (names.length === 0) return "";
  const shown = names.slice(0, max);
  const more = names.length - shown.length;
  return `e.g. ${shown.join(", ")}${more > 0 ? `, +${more} more` : ""}`;
}

/**
 * hub-fixes WP2.2 (RC2.4) — the STABLE placeholder substrings a half-configured crew role carries
 * until its profile is finished (see the web `QuickCreate` role generator + `mission-role-placeholders.ts`,
 * which mirror these markers on the web side of the boundary — web cannot import from `apps/api`). Named
 * so the check (here, in the plan clamp's note; on the web, in the plan card's warning badge) is never a
 * magic string. If the generated placeholders change, change these + the web mirror together.
 */
export const HUB_ROLE_PLACEHOLDER_MARKERS = ["Finish configuring", "Not yet configured"] as const;

/**
 * hub-fixes WP2.2 (RC2.4) — does this planned agent still carry a "finish configuring" placeholder in
 * its instructions / target / expected outcome? A `true` means the role would run half-configured; the
 * plan clamp surfaces it as a LOUD plan note and the plan card as a per-agent warning badge.
 */
export function plannedAgentNeedsConfiguration(
  agent: Pick<HubPlannedAgent, "systemPrompt" | "target" | "expectedOutcome">,
): boolean {
  const haystack = `${agent.systemPrompt}\n${agent.target}\n${agent.expectedOutcome}`;
  return HUB_ROLE_PLACEHOLDER_MARKERS.some((marker) => haystack.includes(marker));
}

/** A compact human budget line (`"6 turns · 40000 tokens · $0.50"`), for role templates + board cards. */
export function summarizeBudgets(budgets?: HubBudgets): string {
  if (!budgets) return "none";
  const bits: string[] = [];
  if (budgets.maxTurns) bits.push(`${budgets.maxTurns} turns`);
  if (budgets.maxTokens) bits.push(`${budgets.maxTokens} tokens`);
  if (budgets.maxToolCalls) bits.push(`${budgets.maxToolCalls} tool calls`);
  if (budgets.maxCostUsd) bits.push(`$${budgets.maxCostUsd}`);
  if (budgets.maxDurationMs) bits.push(`${Math.round(budgets.maxDurationMs / 1000)}s`);
  return bits.length > 0 ? bits.join(" · ") : "none";
}

/** A compact per-server tool-grant signature list for the role template's `agentToolSignatures`. An
 *  empty grant (no servers, no built-ins) → the honest "(none — reasoning only)". */
export function agentToolSignatures(grants: HubToolGrants): string {
  const parts: string[] = [];
  for (const [serverId, grant] of Object.entries(grants.servers ?? {})) {
    parts.push(grant === "all" ? `${serverId}: all tools` : `${serverId}: ${grant.join(", ")}`);
  }
  if (grants.builtins && grants.builtins.length > 0) parts.push(`built-ins: ${grants.builtins.join(", ")}`);
  return parts.length > 0 ? parts.join("; ") : "(none — reasoning only)";
}

/**
 * Render a structured {@link HubAgentReport} as READABLE markdown text — used for the child agent
 * session's settled `assistant_message` (so a child drill-in reads as prose, not JSON) AND, per agent,
 * as one section of the synthesizer's reports digest. Findings keep their `[n]` markers verbatim so
 * citations survive into the synthesis (§1.7). Deterministic (stable ordering) so replay is inert.
 */
export function renderReportText(report: HubAgentReport, opts: { heading?: string } = {}): string {
  const lines: string[] = [];
  if (opts.heading) lines.push(`### ${opts.heading}`);
  if (report.summary?.trim()) lines.push(report.summary.trim());
  if (report.findings.length > 0) {
    lines.push("", "Findings:");
    for (const finding of report.findings) {
      const conf = finding.confidence ? ` _(confidence: ${finding.confidence})_` : "";
      lines.push(`- ${finding.summary}${conf}`);
      if (finding.detail?.trim()) lines.push(`  ${finding.detail.trim()}`);
    }
  }
  if (report.openQuestions.length > 0) {
    lines.push("", "Open questions:");
    for (const q of report.openQuestions) lines.push(`- ${q}`);
  }
  lines.push("", `Confidence: ${report.confidence}`);
  return lines.join("\n").trim();
}

/** The role name + model a planned agent presents on the board / in `agent_spawned`. */
export function plannedAgentLabel(agent: HubPlannedAgent): string {
  return agent.name.trim() || agent.key;
}

// ── Debate rounds (hub-fixes WP4.4 / D-HF3) ───────────────────────────────────────────────────────────

/** The default debate round count when the plan names none (openings + one rebuttal). */
export const DEBATE_ROUNDS_DEFAULT = 2;
/** The hard cap on debate rounds (server-side, like every mission cap — a plan can never schedule more). */
export const DEBATE_ROUNDS_MAX = 3;

/** Clamp a plan's `debateRounds` into 1..{@link DEBATE_ROUNDS_MAX} (default when absent/NaN). `1` = the
 *  independent openings only (no rebuttal). The planner passthrough, `runDebate`, and the graph read this
 *  same helper so a value can never drift between them. */
export function clampDebateRounds(rounds: number | undefined): number {
  if (rounds === undefined || !Number.isFinite(rounds)) return DEBATE_ROUNDS_DEFAULT;
  return Math.min(DEBATE_ROUNDS_MAX, Math.max(1, Math.trunc(rounds)));
}

/**
 * hub-fixes WP4.4 (D-HF3) — the DEBATE-ROUND brief variant. Between rounds, each debater's next brief is
 * its OWN bare planned brief enriched with the LATEST reports of every OTHER active debater (never its own
 * — a debater rebuts opponents, it does not re-read itself), framed adversarially ("rebut or strengthen a
 * counter-position"). This is the round-based analogue of `composeHandoffBrief`'s sequential "debate" mode
 * (WP4.4 replaced the single sequential pass with parallel opening + rebuttal rounds). The opposing reports
 * are STRUCTURED agent output — not the parent chat transcript — so the isolation invariant holds (D-AH9):
 * a debater still only ever sees its own curated brief, now carrying the opposing arguments to answer.
 * Deterministic (input order preserved) so a replay is inert. `opposingReports` is expected to already
 * EXCLUDE the debater's own report (the caller selects the others); an empty list yields the bare brief.
 */
export const DEBATE_ROUND_BRIEF_INTRO =
  "## Opposing arguments to rebut\nAnother debater made each argument below. In this round, directly REBUT or strengthen a counter-position against them — do not merely restate your own opening or agree:";

export function composeDebateRoundBrief(
  baseBrief: string,
  opposingReports: readonly HubAgentReport[],
): string {
  if (opposingReports.length === 0) return baseBrief;
  const rendered = opposingReports
    .map((report, i) => {
      const heading = report.roleName?.trim() || `Opponent ${i + 1}`;
      return renderReportText(report, { heading });
    })
    .join("\n\n");
  return `${baseBrief}\n\n${DEBATE_ROUND_BRIEF_INTRO}\n\n${rendered}`;
}
