import assert from "node:assert/strict";
import { test } from "node:test";

/** The subset of `config` (apps/api/src/config/env.ts) these tests care about — WP 0.3
 *  (roadmap/crew-nesting/, D-CN3/D-CN10): the two new nested-crew-tree hard caps. */
interface HubMissionNestingConfigSlice {
  hubMissionMaxDepth: number;
  hubMissionMaxTotalAgents: number;
}

// config/env.ts computes `config` once at module-evaluation time from process.env, so exercising
// different env-var combinations needs a fresh module instance per scenario. A cache-busting query
// string on the dynamic import specifier forces Node's ESM loader to re-evaluate the module instead
// of returning the cached one (env.ts is pure computation from process.env + path.resolve, so
// re-evaluating it repeatedly has no side effects to worry about) — mirrors `assistant-env.test.ts`.
let importCounter = 0;
async function freshConfig(
  env: Record<string, string | undefined>,
): Promise<HubMissionNestingConfigSlice> {
  const saved: Record<string, string | undefined> = {};
  const keys = ["HUB_MISSION_MAX_DEPTH", "HUB_MISSION_MAX_TOTAL_AGENTS"];
  for (const key of keys) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) process.env[key] = value;
  }

  try {
    const mod = (await import(`../src/config/env.js?case=${importCounter++}`)) as {
      config: HubMissionNestingConfigSlice;
    };
    return mod.config;
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

test("HUB_MISSION_MAX_DEPTH defaults to 2 when unset", async () => {
  const config = await freshConfig({});
  assert.equal(config.hubMissionMaxDepth, 2);
});

test("HUB_MISSION_MAX_DEPTH defaults to 2 when empty", async () => {
  const config = await freshConfig({ HUB_MISSION_MAX_DEPTH: "" });
  assert.equal(config.hubMissionMaxDepth, 2);
});

test("HUB_MISSION_MAX_TOTAL_AGENTS defaults to 24 when unset", async () => {
  const config = await freshConfig({});
  assert.equal(config.hubMissionMaxTotalAgents, 24);
});

test("HUB_MISSION_MAX_TOTAL_AGENTS defaults to 24 when empty", async () => {
  const config = await freshConfig({ HUB_MISSION_MAX_TOTAL_AGENTS: "" });
  assert.equal(config.hubMissionMaxTotalAgents, 24);
});

test("HUB_MISSION_MAX_DEPTH override is parsed and stored verbatim", async () => {
  const config = await freshConfig({ HUB_MISSION_MAX_DEPTH: "3" });
  assert.equal(config.hubMissionMaxDepth, 3);
});

test("HUB_MISSION_MAX_TOTAL_AGENTS override is parsed and stored verbatim", async () => {
  const config = await freshConfig({ HUB_MISSION_MAX_TOTAL_AGENTS: "40" });
  assert.equal(config.hubMissionMaxTotalAgents, 40);
});

test("HUB_MISSION_MAX_DEPTH falls back to the default on a non-positive value", async () => {
  const zero = await freshConfig({ HUB_MISSION_MAX_DEPTH: "0" });
  assert.equal(zero.hubMissionMaxDepth, 2);

  const negative = await freshConfig({ HUB_MISSION_MAX_DEPTH: "-1" });
  assert.equal(negative.hubMissionMaxDepth, 2);
});

test("HUB_MISSION_MAX_DEPTH falls back to the default on a non-numeric value", async () => {
  const config = await freshConfig({ HUB_MISSION_MAX_DEPTH: "abc" });
  assert.equal(config.hubMissionMaxDepth, 2);
});

test("HUB_MISSION_MAX_TOTAL_AGENTS falls back to the default on a non-positive value", async () => {
  const zero = await freshConfig({ HUB_MISSION_MAX_TOTAL_AGENTS: "0" });
  assert.equal(zero.hubMissionMaxTotalAgents, 24);

  const negative = await freshConfig({ HUB_MISSION_MAX_TOTAL_AGENTS: "-1" });
  assert.equal(negative.hubMissionMaxTotalAgents, 24);
});

test("HUB_MISSION_MAX_TOTAL_AGENTS falls back to the default on a non-numeric value", async () => {
  const config = await freshConfig({ HUB_MISSION_MAX_TOTAL_AGENTS: "abc" });
  assert.equal(config.hubMissionMaxTotalAgents, 24);
});

test("HUB_MISSION_MAX_DEPTH=1 is accepted and parsed as 1 (today's-behavior reproduction value; no rejection logic here — that is WP 1.1)", async () => {
  const config = await freshConfig({ HUB_MISSION_MAX_DEPTH: "1" });
  assert.equal(config.hubMissionMaxDepth, 1);
});
