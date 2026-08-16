import assert from "node:assert/strict";
import { test } from "node:test";
import { runStartSchema, scenarioInputSchema, testInputSchema } from "@mcp-token-footprint/shared";

test("scenarioInputSchema accepts a valid scenario and applies defaults", () => {
  const parsed = scenarioInputSchema.parse({
    name: "Baseline",
    providerId: "prov_1",
    model: "claude-sonnet-4-5",
    systemPrompt: "You are a helpful assistant.",
    allowedServers: [{ serverId: "srv_1", allowedTools: null }],
  });

  assert.equal(parsed.model, "claude-sonnet-4-5");
  assert.deepEqual(parsed.params, {});
  assert.deepEqual(parsed.defaultProfiles, []);
  assert.deepEqual(parsed.guardrails, {});
  // Tool loading defaults to the historical eager behavior so existing inputs are unchanged.
  assert.equal(parsed.toolLoadingMode, "eager");
});

test("scenarioInputSchema accepts deferred tool loading and rejects an unknown mode", () => {
  const deferred = scenarioInputSchema.parse({
    name: "Deferred",
    providerId: "prov_1",
    model: "claude-sonnet-4-5",
    toolLoadingMode: "deferred",
  });
  assert.equal(deferred.toolLoadingMode, "deferred");

  assert.equal(
    scenarioInputSchema.safeParse({
      name: "Bad mode",
      providerId: "prov_1",
      model: "claude-sonnet-4-5",
      toolLoadingMode: "lazy",
    }).success,
    false,
  );
});

test("scenarioInputSchema rejects an empty model", () => {
  const result = scenarioInputSchema.safeParse({
    name: "Bad",
    providerId: "prov_1",
    model: "",
  });

  assert.equal(result.success, false);
});

test("testInputSchema accepts a valid test and rejects an empty prompt", () => {
  const ok = testInputSchema.parse({
    name: "List tools",
    userPrompt: "What tools are available?",
  });
  assert.equal(ok.name, "List tools");
  assert.deepEqual(ok.addedProfiles, []);

  assert.equal(testInputSchema.safeParse({ name: "Bad", userPrompt: "" }).success, false);
});

test("runStartSchema accepts a valid mode and rejects an unknown one", () => {
  const ok = runStartSchema.parse({ testId: "t_1", scenarioId: "s_1", mode: "automated" });
  assert.equal(ok.mode, "automated");

  assert.equal(
    runStartSchema.safeParse({ testId: "t_1", scenarioId: "s_1", mode: "turbo" }).success,
    false,
  );
});
