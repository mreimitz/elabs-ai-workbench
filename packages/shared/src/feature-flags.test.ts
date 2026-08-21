import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  APP_FEATURE_IDS,
  APP_FEATURE_META,
  DEFAULT_APP_FEATURE_FLAGS,
  appFeatureFlagsSchema,
  appFeatureFlagsUpdateSchema,
  featureForPath,
  isAppFeatureId,
  isFeatureEnabled,
  pathMatchesPrefix,
  resolveFeatureFlags,
} from "./feature-flags.js";

describe("feature-flags registry", () => {
  it("ships every registered feature ENABLED by default", () => {
    for (const id of APP_FEATURE_IDS) {
      assert.equal(DEFAULT_APP_FEATURE_FLAGS[id], true, `${id} must default to on`);
    }
  });

  it("keeps every meta entry keyed by its own id, with non-empty prefixes", () => {
    for (const id of APP_FEATURE_IDS) {
      const meta = APP_FEATURE_META[id];
      assert.equal(meta.id, id);
      assert.ok(meta.label.length > 0);
      assert.ok(meta.description.length > 0);
      assert.ok(meta.surfaces.length > 0, `${id} must list what turning it off hides`);
      // `routePrefixes` MAY be empty — a machine-facing feature (the workbench MCP mount) owns no
      // screen to swap for the "turned off" panel. `apiPrefixes` may not: without a server-side
      // prefix the switch would be decoration, and hiding UI is not an off-switch.
      assert.ok(meta.apiPrefixes.length > 0, `${id} must own at least one API prefix to enforce`);
      // Every API prefix is under /api, so the guard can never shadow the SPA's own static routes.
      for (const prefix of meta.apiPrefixes) {
        assert.ok(prefix.startsWith("/api/"), `${id} api prefix ${prefix} must live under /api/`);
      }
    }
  });

  it("never lets a feature claim the flags endpoint itself (you could not switch it back on)", () => {
    for (const id of APP_FEATURE_IDS) {
      for (const prefix of APP_FEATURE_META[id].apiPrefixes) {
        assert.ok(!pathMatchesPrefix("/api/features", prefix));
      }
    }
  });

  it("recognises registered ids only", () => {
    assert.equal(isAppFeatureId("assistant"), true);
    assert.equal(isAppFeatureId("nope"), false);
    assert.equal(isAppFeatureId(null), false);
    assert.equal(isAppFeatureId(undefined), false);
  });
});

describe("resolveFeatureFlags", () => {
  it("returns the defaults for a missing / non-object value", () => {
    assert.deepEqual(resolveFeatureFlags(undefined), DEFAULT_APP_FEATURE_FLAGS);
    assert.deepEqual(resolveFeatureFlags(null), DEFAULT_APP_FEATURE_FLAGS);
    assert.deepEqual(resolveFeatureFlags("assistant=false"), DEFAULT_APP_FEATURE_FLAGS);
    assert.deepEqual(resolveFeatureFlags([false]), DEFAULT_APP_FEATURE_FLAGS);
  });

  it("honours an explicit false", () => {
    assert.equal(resolveFeatureFlags({ assistant: false }).assistant, false);
  });

  it("treats a non-boolean stored value as ENABLED rather than off", () => {
    assert.equal(resolveFeatureFlags({ assistant: "false" }).assistant, true);
    assert.equal(resolveFeatureFlags({ assistant: 0 }).assistant, true);
  });

  it("drops unknown ids instead of leaking them into the map", () => {
    const flags = resolveFeatureFlags({ assistant: false, ghost: false });
    assert.deepEqual(Object.keys(flags).sort(), [...APP_FEATURE_IDS].sort());
  });
});

describe("isFeatureEnabled", () => {
  it("reads ON while flags are still unknown (boot / fetch failure never hides the app)", () => {
    assert.equal(isFeatureEnabled(null, "assistant"), true);
    assert.equal(isFeatureEnabled(undefined, "assistant"), true);
  });

  it("reads the loaded map otherwise", () => {
    // Spread the defaults so the map stays complete as features are registered.
    assert.equal(
      isFeatureEnabled({ ...DEFAULT_APP_FEATURE_FLAGS, assistant: false }, "assistant"),
      false,
    );
    assert.equal(
      isFeatureEnabled({ ...DEFAULT_APP_FEATURE_FLAGS, assistant: true }, "assistant"),
      true,
    );
  });
});

describe("pathMatchesPrefix / featureForPath", () => {
  it("matches the prefix itself and /-delimited children only", () => {
    assert.equal(pathMatchesPrefix("/assistant", "/assistant"), true);
    assert.equal(pathMatchesPrefix("/assistant/agents", "/assistant"), true);
    assert.equal(pathMatchesPrefix("/assistant-hub", "/assistant"), false);
    assert.equal(pathMatchesPrefix("/assistantx", "/assistant"), false);
  });

  it("resolves route paths to the owning feature", () => {
    assert.equal(featureForPath("/assistant/agents", "route")?.id, "assistant");
    assert.equal(featureForPath("/dashboard", "route"), undefined);
    // The API prefixes are a different list — a browser route must not match them and vice versa.
    assert.equal(featureForPath("/assistant/agents", "api"), undefined);
  });

  it("resolves api paths to the owning feature", () => {
    // The two assistants own DIFFERENT trees — that is the whole point of the split.
    assert.equal(featureForPath("/api/hub/sessions", "api")?.id, "assistant");
    assert.equal(featureForPath("/api/assistant/threads", "api")?.id, "app_assistant");
    assert.equal(featureForPath("/api/features", "api"), undefined);
    assert.equal(featureForPath("/api/health", "api"), undefined);
    assert.equal(featureForPath("/api/scans", "api"), undefined);
  });

  it("lets an exempt sub-path out of its feature's own governed tree", () => {
    // `/api/assistant/auth` is the shared Claude sign-in: it sits under the dock's prefix but the
    // WORKSPACE runs on it too, so the dock's switch must not reach it.
    assert.equal(featureForPath("/api/assistant/auth", "api"), undefined);
    assert.equal(featureForPath("/api/assistant/auth/status", "api"), undefined);
    assert.equal(featureForPath("/api/assistant/auth/oauth/start", "api"), undefined);
    // The exemption is a PREFIX, not a substring — a sibling that merely starts the same is still
    // the dock's. `/api/assistant/authorize` is the shape that would leak if this used startsWith.
    assert.equal(featureForPath("/api/assistant/authorize", "api")?.id, "app_assistant");
    assert.equal(featureForPath("/api/assistant/auth-x", "api")?.id, "app_assistant");
    // Exemptions are an API-side concept only; route matching has none to consult.
    assert.equal(featureForPath("/assistant/agents", "route")?.id, "assistant");
  });

  it("keeps the workspace's route prefix off the dock, which owns no route at all", () => {
    // The dock is a panel beside the current page, never a URL — nothing renders a "turned off"
    // panel for it, and no route may resolve to it.
    assert.deepEqual(APP_FEATURE_META.app_assistant.routePrefixes, []);
    for (const path of ["/assistant", "/assistant/agents", "/dashboard", "/scans"]) {
      assert.notEqual(featureForPath(path, "route")?.id, "app_assistant", path);
    }
  });
});

describe("wire schemas", () => {
  it("requires every id on the full schema", () => {
    // Built from the registry, not hand-listed, so registering feature #3 does not edit this test.
    assert.equal(appFeatureFlagsSchema.safeParse(DEFAULT_APP_FEATURE_FLAGS).success, true);
    assert.equal(appFeatureFlagsSchema.safeParse({}).success, false);
    // A map missing ONE registered id is still incomplete — that is the point of the full schema.
    const partial = { ...DEFAULT_APP_FEATURE_FLAGS } as Record<string, boolean>;
    delete partial[APP_FEATURE_IDS[APP_FEATURE_IDS.length - 1] as string];
    assert.equal(appFeatureFlagsSchema.safeParse(partial).success, false);
  });

  it("accepts a partial patch but rejects an unknown id", () => {
    assert.equal(appFeatureFlagsUpdateSchema.safeParse({}).success, true);
    assert.equal(appFeatureFlagsUpdateSchema.safeParse({ assistant: false }).success, true);
    assert.equal(appFeatureFlagsUpdateSchema.safeParse({ ghost: false }).success, false);
    assert.equal(appFeatureFlagsUpdateSchema.safeParse({ assistant: "no" }).success, false);
  });
});
