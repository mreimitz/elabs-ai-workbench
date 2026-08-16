import type { Scenario, Test, TokenProfileRef } from "@mcp-token-footprint/shared";

/**
 * Effective profiles for a run = scenario.defaultProfiles ∪ test.addedProfiles, de-duplicated and
 * order-preserving (scenario defaults first, then any test additions not already present).
 * Consumed by the run engine (WP 1.3).
 */
export function unionProfiles(
  defaultProfiles: TokenProfileRef[],
  addedProfiles: TokenProfileRef[],
): TokenProfileRef[] {
  const seen = new Set<TokenProfileRef>();
  const result: TokenProfileRef[] = [];
  for (const profile of [...defaultProfiles, ...addedProfiles]) {
    if (seen.has(profile)) continue;
    seen.add(profile);
    result.push(profile);
  }
  return result;
}

/** Effective profiles from a scenario + test pair. */
export function resolveProfiles(scenario: Scenario, test: Test): TokenProfileRef[] {
  return unionProfiles(scenario.defaultProfiles, test.addedProfiles);
}

/**
 * Effective system prompt = test.systemPromptOverride ?? scenario.systemPrompt. An override is
 * applied only when present (undefined falls back to the scenario prompt; an explicit empty string
 * is treated as an intentional override). Consumed by the run engine (WP 1.3).
 */
export function resolveSystemPrompt(
  scenarioSystemPrompt: string,
  testSystemPromptOverride: string | undefined,
): string {
  return testSystemPromptOverride ?? scenarioSystemPrompt;
}
