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
      assert.ok(meta.routePrefixes.length > 0);
      assert.ok(meta.apiPrefixes.length > 0);
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
    assert.equal(isFeatureEnabled({ assistant: false }, "assistant"), false);
    assert.equal(isFeatureEnabled({ assistant: true }, "assistant"), true);
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

  it("resolves api paths to the owning feature (both prefixes)", () => {
    assert.equal(featureForPath("/api/assistant/threads", "api")?.id, "assistant");
    assert.equal(featureForPath("/api/hub/sessions", "api")?.id, "assistant");
    assert.equal(featureForPath("/api/features", "api"), undefined);
    assert.equal(featureForPath("/api/health", "api"), undefined);
    assert.equal(featureForPath("/api/scans", "api"), undefined);
  });
});

describe("wire schemas", () => {
  it("requires every id on the full schema", () => {
    assert.equal(appFeatureFlagsSchema.safeParse({ assistant: true }).success, true);
    assert.equal(appFeatureFlagsSchema.safeParse({}).success, false);
  });

  it("accepts a partial patch but rejects an unknown id", () => {
    assert.equal(appFeatureFlagsUpdateSchema.safeParse({}).success, true);
    assert.equal(appFeatureFlagsUpdateSchema.safeParse({ assistant: false }).success, true);
    assert.equal(appFeatureFlagsUpdateSchema.safeParse({ ghost: false }).success, false);
    assert.equal(appFeatureFlagsUpdateSchema.safeParse({ assistant: "no" }).success, false);
  });
});
