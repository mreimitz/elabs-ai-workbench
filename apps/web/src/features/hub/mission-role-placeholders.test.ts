// Assistant Hub (hub-fixes WP2.2, RC2.4) — the shared "finish configuring" placeholder markers used by
// the QuickCreate role generator and the plan card's warning check. Locks: the exact generated strings
// each carry a detectable marker, the predicate flags any placeholder field, and a fully-configured role
// is never flagged.

import { describe, expect, test } from "vitest";
import {
  plannedAgentNeedsConfiguration,
  ROLE_PLACEHOLDER_EXPECTED_OUTCOME,
  ROLE_PLACEHOLDER_MARKERS,
  ROLE_PLACEHOLDER_TARGET,
  rolePlaceholderSystemPrompt,
} from "./mission-role-placeholders";

const configured = {
  systemPrompt: "You are a data analyst who answers with cited findings.",
  target: "Answer the revenue question.",
  expectedOutcome: "A short report with citations.",
};

describe("mission-role-placeholders", () => {
  test("every generated placeholder string carries a detectable marker (generator ↔ checker aligned)", () => {
    for (const value of [
      rolePlaceholderSystemPrompt("X"),
      ROLE_PLACEHOLDER_TARGET,
      ROLE_PLACEHOLDER_EXPECTED_OUTCOME,
    ]) {
      expect(ROLE_PLACEHOLDER_MARKERS.some((marker) => value.includes(marker))).toBe(true);
    }
  });

  test("plannedAgentNeedsConfiguration flags a placeholder in ANY of the three fields", () => {
    expect(
      plannedAgentNeedsConfiguration({ ...configured, systemPrompt: rolePlaceholderSystemPrompt("X") }),
    ).toBe(true);
    expect(plannedAgentNeedsConfiguration({ ...configured, target: ROLE_PLACEHOLDER_TARGET })).toBe(true);
    expect(
      plannedAgentNeedsConfiguration({ ...configured, expectedOutcome: ROLE_PLACEHOLDER_EXPECTED_OUTCOME }),
    ).toBe(true);
  });

  test("a fully-configured role is never flagged", () => {
    expect(plannedAgentNeedsConfiguration(configured)).toBe(false);
  });
});
