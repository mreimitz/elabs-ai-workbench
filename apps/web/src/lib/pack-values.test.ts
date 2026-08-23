/**
 * pack-values.test.ts — RM-38 WP 3.2 (owner ruling 2026-08-23).
 *
 * The store's job is to keep the browser from lagging the API once a pack can be fetched. Its four
 * rules are each a way that goes wrong, and each is tested here for that reason rather than for
 * coverage:
 *
 *  1. the compiled floor is the initial value AND the per-key fallback — the store is NEVER empty;
 *  2. `CompareView`'s threshold is an INITIAL value (that half is tested in the component, not here);
 *  3. a malformed payload degrades rather than throwing;
 *  4. a hydrated value is genuinely readable through the accessors the six sites now use.
 *
 * The seam itself — a changed pack actually changing what the browser renders — is proved against
 * the RUNNING app, not here. A test that installs a value into the store and reads it back proves
 * the store, not the seam.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_COMPARE_THRESHOLD,
  FAILURE_BUCKET_SCORE_THRESHOLD,
  MODEL_CONTEXT_LIMITS,
  SECURITY_RULES,
} from "@mcp-token-footprint/shared";
import {
  contextLimitFor,
  defaultCompareThreshold,
  failureBucketScoreThreshold,
  installPackValues,
  isKnownModelId,
  knownModelIds,
  packValues,
  resetPackValuesForTests,
  securityRuleCount,
  securityRuleFor,
  securityRuleRegistry,
} from "./pack-values";

afterEach(() => {
  resetPackValuesForTests();
});

/** A model the compiled floor certainly knows, taken from the floor itself rather than guessed. */
const FLOOR_MODEL = Object.keys(MODEL_CONTEXT_LIMITS)[0] as string;
const FLOOR_LIMIT = MODEL_CONTEXT_LIMITS[FLOOR_MODEL] as number;

describe("rule 1 — the floor is the initial value AND the fallback", () => {
  it("answers from the compiled floor before anything hydrates", () => {
    expect(contextLimitFor(FLOOR_MODEL)).toBe(FLOOR_LIMIT);
    expect(defaultCompareThreshold()).toBe(DEFAULT_COMPARE_THRESHOLD);
    expect(failureBucketScoreThreshold()).toBe(FAILURE_BUCKET_SCORE_THRESHOLD);
    expect(securityRuleCount()).toBe(Object.keys(SECURITY_RULES).length);
  });

  it("an EMPTIED store still answers the compiled limit — never 0, never null", () => {
    // Teeth 4. This is the `RunConsole` case: its previous `MODEL_CONTEXT_LIMITS[model] ?? 0` turned
    // an unknown window into a confident, meaningless "0% of context used".
    expect(
      installPackValues({
        modelContextLimits: {},
        defaultCompareThreshold: 0.6,
        failureBucketScoreThreshold: 0.5,
        securityRules: {},
      }),
    ).toBe(true);

    expect(contextLimitFor(FLOOR_MODEL)).toBe(FLOOR_LIMIT);
    expect(isKnownModelId(FLOOR_MODEL)).toBe(true);
    expect(knownModelIds()).toContain(FLOOR_MODEL);
    // …and the whole rule registry falls back rather than reporting an analyzer with no rules.
    expect(securityRuleCount()).toBe(Object.keys(SECURITY_RULES).length);
  });

  it("a model NOTHING knows is null — the honest answer, distinct from a window of zero", () => {
    expect(contextLimitFor("not-a-model-anyone-ships")).toBeNull();
    expect(isKnownModelId("not-a-model-anyone-ships")).toBe(false);
  });

  it("a pack that DROPS a model cannot un-know it (D-DP3), and one that adds one is offerable", () => {
    installPackValues({
      modelContextLimits: { "brand-new-model": 4242 },
      defaultCompareThreshold: 0.6,
      failureBucketScoreThreshold: 0.5,
      securityRules: {},
    });
    expect(contextLimitFor("brand-new-model")).toBe(4242);
    expect(knownModelIds()).toContain("brand-new-model");
    expect(knownModelIds()).toContain(FLOOR_MODEL);
  });
});

describe("rule 3 — a malformed payload degrades, it does not throw", () => {
  it("rejects a payload that fails the shared schema and keeps what was in force", () => {
    installPackValues({
      modelContextLimits: { good: 1 },
      defaultCompareThreshold: 0.42,
      failureBucketScoreThreshold: 0.5,
      securityRules: {},
    });
    expect(defaultCompareThreshold()).toBe(0.42);

    for (const bad of [null, undefined, 42, "nope", {}, { modelContextLimits: "not a map" }]) {
      expect(installPackValues(bad)).toBe(false);
    }
    expect(defaultCompareThreshold()).toBe(0.42);
    expect(contextLimitFor("good")).toBe(1);
  });
});

describe("rule 4 — a hydrated pack is what the accessors answer", () => {
  it("installs values and reads every one of them back", () => {
    installPackValues({
      modelContextLimits: { "pack-only-model": 999 },
      defaultCompareThreshold: 0.77,
      failureBucketScoreThreshold: 0.33,
      securityRules: {
        "poisoning.made-up": {
          id: "poisoning.made-up",
          severity: "error",
          title: "A title only the pack has",
          rationale: "A rationale only the pack has.",
        },
      },
    });

    expect(contextLimitFor("pack-only-model")).toBe(999);
    expect(defaultCompareThreshold()).toBe(0.77);
    expect(failureBucketScoreThreshold()).toBe(0.33);
    expect(securityRuleFor("poisoning.made-up")?.title).toBe("A title only the pack has");
    expect(securityRuleCount()).toBe(1);
    expect(Object.keys(securityRuleRegistry())).toEqual(["poisoning.made-up"]);
    expect(packValues().defaultCompareThreshold).toBe(0.77);
  });

  it("resetPackValuesForTests puts the floor back", () => {
    installPackValues({
      modelContextLimits: {},
      defaultCompareThreshold: 0.01,
      failureBucketScoreThreshold: 0.02,
      securityRules: {},
    });
    resetPackValuesForTests();
    expect(defaultCompareThreshold()).toBe(DEFAULT_COMPARE_THRESHOLD);
    expect(failureBucketScoreThreshold()).toBe(FAILURE_BUCKET_SCORE_THRESHOLD);
  });
});
