// Assistant Hub (hub-fixes WP2.2, RC2.4) — the STABLE "finish configuring" placeholder strings a
// half-configured crew role carries until its profile is filled in, in ONE place so neither the
// generator (`workforce/QuickCreate.tsx`) nor the checker (`MissionPlanCard.tsx`) hand-codes a magic
// string. This mirrors `apps/api/src/hub/missions/shared.ts`'s `HUB_ROLE_PLACEHOLDER_MARKERS` /
// `plannedAgentNeedsConfiguration` on the web side of the api↔web boundary (web cannot import from
// `apps/api`) — keep the two in lockstep; `mission-role-placeholders.test.ts` asserts the alignment.

import type { HubPlannedAgent } from "@mcp-token-footprint/shared";

/** The substrings that mark a not-yet-configured role. Must stay a superset match of the exact strings
 *  below (and of the api-side markers). */
export const ROLE_PLACEHOLDER_MARKERS = ["Finish configuring", "Not yet configured"] as const;

/** The exact placeholder `target` a freshly quick-created role starts with. */
export const ROLE_PLACEHOLDER_TARGET = "Not yet configured — set this agent's objective in its profile.";

/** The exact placeholder `expectedOutcome` a freshly quick-created role starts with. */
export const ROLE_PLACEHOLDER_EXPECTED_OUTCOME =
  "Not yet configured — set this agent's expected outcome in its profile.";

/** The exact placeholder `systemPrompt` a freshly quick-created role starts with (name-parameterized). */
export function rolePlaceholderSystemPrompt(name: string): string {
  return `You are ${name}. Finish configuring this agent's instructions in its profile.`;
}

/** Does this planned agent still carry a "finish configuring" placeholder in its instructions / target /
 *  expected outcome? `true` ⇒ the plan card shows a per-agent "not fully configured" warning. */
export function plannedAgentNeedsConfiguration(
  agent: Pick<HubPlannedAgent, "systemPrompt" | "target" | "expectedOutcome">,
): boolean {
  const haystack = `${agent.systemPrompt}\n${agent.target}\n${agent.expectedOutcome}`;
  return ROLE_PLACEHOLDER_MARKERS.some((marker) => haystack.includes(marker));
}
