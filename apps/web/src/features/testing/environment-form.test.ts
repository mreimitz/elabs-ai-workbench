import { describe, expect, it } from "vitest";
import type { Scenario, ScenarioInput } from "@mcp-token-footprint/shared";
import { EMPTY_FORM, fromScenario, REASONING_NONE, toInput } from "./environment-form";

/**
 * The WP 2.7 acceptance contract: opening an existing environment and saving it with NO edits
 * produces the identical wire input — `toInput(fromScenario(scenario))` deep-equals the scenario's
 * own input projection. This is what guards against the primitives (SliderNumber/BoundedNumber)
 * silently re-normalizing a loaded value on open.
 */

function inputOf(scenario: Scenario): ScenarioInput {
  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = scenario;
  return rest;
}

const fullScenario: Scenario = {
  id: "env-1",
  name: "Prod-Claude",
  providerId: "cred-1",
  model: "claude-opus-4-8",
  params: { temperature: 0.3, maxOutputTokens: 4096, topP: 0.9, reasoningEffort: "high" },
  systemPrompt: "You are an operator assistant.",
  allowedServers: [{ serverId: "srv-1", allowedTools: ["a", "b"] }],
  allowedSkills: [{ skillId: "sk-1", versionMode: "latest", eager: true }],
  defaultProfiles: ["generic_o200k", "generic_cl100k"],
  guardrails: { maxTurns: 12, maxTokens: 200000, maxCostUsd: 2.5 },
  toolLoadingMode: "deferred",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

const minimalScenario: Scenario = {
  id: "env-2",
  name: "Bare",
  providerId: "cred-2",
  model: "gpt-4o",
  params: {},
  systemPrompt: "",
  allowedServers: [],
  allowedSkills: [],
  defaultProfiles: ["generic_o200k"],
  guardrails: {},
  toolLoadingMode: "eager",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

describe("environment-form round-trip", () => {
  it("round-trips a fully-populated environment with no diff", () => {
    expect(toInput(fromScenario(fullScenario))).toEqual(inputOf(fullScenario));
  });

  it("round-trips a minimal environment (all params/guardrails absent)", () => {
    expect(toInput(fromScenario(minimalScenario))).toEqual(inputOf(minimalScenario));
  });

  it("keeps optional params omitted rather than serialized as null", () => {
    const input = toInput(fromScenario(minimalScenario));
    expect(input.params).toEqual({});
    expect("temperature" in input.params).toBe(false);
    expect("reasoningEffort" in input.params).toBe(false);
  });

  it("maps an absent reasoning effort to the REASONING_NONE sentinel and back to absent", () => {
    const form = fromScenario(minimalScenario);
    expect(form.reasoningEffort).toBe(REASONING_NONE);
    expect(toInput(form).params.reasoningEffort).toBeUndefined();
  });

  it("EMPTY_FORM produces a valid new-environment input skeleton", () => {
    const input = toInput(EMPTY_FORM);
    expect(input.name).toBe("");
    expect(input.params).toEqual({});
    expect(input.defaultProfiles).toEqual(["generic_o200k"]);
    expect(input.toolLoadingMode).toBe("eager");
  });

});
