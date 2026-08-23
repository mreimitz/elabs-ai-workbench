// RM-38 WP 2.2 — the advisor / quality thresholds and the model merge chains, read from the pack.
//
// WHAT EACH GUARD IN THIS FILE ACTUALLY ASSERTS, AND WHAT IT THEREFORE CANNOT SEE.
// This item's own ledger records a guard that was "precisely right about the wrong quantity": WP
// 1.1's hash ledger recorded PRE-MOVE bytes, so a silent reversion TO those bytes passed. Every
// guard below states its quantity and its blind spot in one sentence, so nobody can later cite one
// as proof of something it does not prove.
//
//   1. NO SECOND COPY (source scan). No file under `apps/api/src` or `packages/shared/src` declares
//      an identifier named after an advisor threshold. CANNOT SEE: a copy spelled with a different
//      identifier name, a bare numeric literal inline, or a value computed at runtime. It is a
//      tripwire against the exact regression this WP removed (two `HIGH_WASTE_SHARE` declarations,
//      the same shape as this repo's two `buildRunFilterWhere` copies) — not a proof of uniqueness.
//   2. PROSE FOLLOWS THE PACK (behavioural). With a doctored pack installed, the advisor's numbers
//      AND the sentences that quote them both move. CANNOT SEE: a rule that reads the pack for its
//      arithmetic but hardcodes a DIFFERENT number in prose that happens to equal the default —
//      which is why each assertion checks the sentence contains the NEW value and NOT the old one.
//   3. ENV → PACK → COMPILED (behavioural). The two skill-quality ceilings resolve in that order.
//      CANNOT SEE: whether the resolved value reaches the quality engine — the route wiring is
//      covered by `skill-ide-quality.test.ts`, not here.
//   4. MERGE ORDER (behavioural). A model id present in several layers resolves to the winner the
//      contract names, for context limits AND for pricing. CANNOT SEE: a reorder that leaves the
//      relative winner unchanged for the ids this fixture uses — which is why the fixture puts a
//      DIFFERENT value in every layer for the SAME id, so any swap changes the answer.
//   5. D-DP3 FLOOR (behavioural). A pack that DROPS a model cannot disarm the context-window
//      guardrail or the unpriced-model refusal. CANNOT SEE: a guardrail that reads the limits map
//      by some other path — it asserts the map and `isModelPriced`, which are the two inputs the
//      ledger names, not every caller of them.
//   6. BUDGET FROM THE PACK (behavioural). `pnpm mcp:self-scan`'s verdict follows a pack edit.
//      CANNOT SEE: whether the CI workflow actually runs that command.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  DEFAULT_HEATMAP_MODELS as FLOOR_DEFAULT_HEATMAP_MODELS,
  DEFAULT_SKILL_QUALITY_L1_TOKEN_CEILING,
  DEFAULT_SKILL_QUALITY_L2_TOKEN_CEILING,
  MODEL_CONTEXT_LIMITS,
} from "@mcp-token-footprint/shared";
import { runAdvisor } from "../src/advisor/engine.js";
import { descriptionBloatRule } from "../src/advisor/rules/description-bloat.js";
import { toolOverlapRule } from "../src/advisor/rules/tool-overlap.js";
import { unusedToolTrimRule } from "../src/advisor/rules/unused-tool-trim.js";
import type { AdvisorContext } from "../src/advisor/types.js";
import { defaultHeatmapModels, modelIdAliases } from "../src/compatibility/dataset.js";
import type { ResolvedDataPack } from "../src/data-pack/loader.js";
import { resolveDataPackFromDisk } from "../src/data-pack/resolve.js";
import {
  getDataPack,
  installDataPackSource,
  resetDataPackSourceForTests,
} from "../src/data-pack/source.js";
import {
  advisorThresholds,
  modelContextLimits,
  modelPricingTable,
  qualityThresholds,
  skillQualityCeilings,
  workbenchMcpDefinitionTokenBudget,
  zeroPriceModels,
} from "../src/data-pack/thresholds.js";
import { isModelPriced, MODEL_PRICING } from "../src/providers/pricing.js";
import { advisorFixtureContext } from "./support/advisor-fixture.js";

const API_ROOT = path.resolve(import.meta.dirname, "..");
const REPO_ROOT = path.resolve(API_ROOT, "../..");

// ── Fixture plumbing ─────────────────────────────────────────────────────────────────────────────

/** The real resolved pack, read once. Never mutated — every doctored pack is a fresh deep copy. */
const REAL = resolveDataPackFromDisk().pack;

/** A deep copy of the real pack with `mutate` applied. Nothing on disk is touched. */
function doctoredPack(mutate: (pack: ResolvedDataPack) => void): ResolvedDataPack {
  const copy = JSON.parse(JSON.stringify(REAL)) as ResolvedDataPack;
  mutate(copy);
  return copy;
}

/** Run `body` with `pack` in force, restoring the real resolution afterwards even on a throw. */
function withPack<T>(pack: ResolvedDataPack, body: () => T): T {
  resetDataPackSourceForTests();
  installDataPackSource(pack);
  try {
    return body();
  } finally {
    resetDataPackSourceForTests();
  }
}


// ── 1. No second copy of a threshold ─────────────────────────────────────────────────────────────

/** Every advisor threshold, by the identifier name it used to be declared under. */
const RETIRED_ADVISOR_CONSTANTS = [
  "DESCRIPTION_SHARE_THRESHOLD",
  "MIN_DESCRIPTION_TOKENS",
  "TOP_TOOLS",
  "HIGH_SCAN_SHARE",
  "MEDIUM_SCAN_SHARE",
  "OVERLAP_SIMILARITY_THRESHOLD",
  "MEDIUM_OVERLAP_COUNT",
  "HIGH_WASTE_SHARE",
  "MEDIUM_WASTE_SHARE",
  "SUITE_RUN_WINDOW",
  "PROVENANCE_SUITE_RUN_LIMIT",
  "EVIDENCE_TOOL_LIMIT",
  "EVIDENCE_RUN_LIMIT",
] as const;

/**
 * Rough comment strip, the same one `data-pack-seam.test.ts` uses. Good enough to tell a documented
 * name from a declaration of one — the rule files deliberately keep the retired names in prose so a
 * reader can see WHAT moved and why.
 *
 * THIS WIDENS THE BLIND SPOT: a declaration hidden inside a template literal or a string would also
 * become invisible. Accepted, because the alternative is deleting the explanatory comments, and a
 * threshold re-declared inside a string is not the regression this guard is for.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function walkTs(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walkTs(abs, out);
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) out.push(abs);
  }
  return out;
}

test("no file declares an advisor threshold a second time (the two-copies regression)", () => {
  // The quantity: a `const|let|var NAME =` DECLARATION of any retired threshold name, anywhere in
  // `apps/api/src` or `packages/shared/src`. Not a mention, not a comment reference — a declaration.
  // Blind spot stated in the header.
  const files = [
    ...walkTs(path.join(API_ROOT, "src")),
    ...walkTs(path.join(REPO_ROOT, "packages/shared/src")),
  ];
  const offenders: string[] = [];
  for (const file of files) {
    const source = stripComments(readFileSync(file, "utf8"));
    for (const name of RETIRED_ADVISOR_CONSTANTS) {
      if (new RegExp(`\\b(?:const|let|var)\\s+${name}\\b\\s*(?::[^=]*)?=`).test(source)) {
        offenders.push(`${path.relative(REPO_ROOT, file)} declares ${name}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "advisor thresholds live in data-pack/advisor/thresholds.json — read them via advisorThresholds()",
  );
});

test("the waste bands are ONE pack entry that both trim rules read", () => {
  // The quantity: both rule files' CODE — comments stripped — names the pack field.
  //
  // stripComments is NOT decoration here, and this is not inherited caution: probed 2026-08-23 by
  // reverting `quality-validated-trim.ts` to hardcoded `0.5` / `0.2` while leaving the comment that
  // names `high_waste_share` in place. Un-stripped, this test stayed GREEN — the comment alone
  // satisfied it, which is the same defect `1687eb8` found in the shipping guard. Re-probed after:
  // same mutation, red.
  //
  // WHAT IT STILL CANNOT SEE: whether the resulting SEVERITY moves. Only `unused-tool-trim` has a
  // behavioural band test below (`quality-validated-trim` needs a graded suite-run fixture this WP
  // does not build). So for that rule this asserts "the code reads the pack field", not "the finding
  // changes" — a real, named gap, not a covered one.
  const rules = path.join(API_ROOT, "src/advisor/rules");
  for (const name of ["unused-tool-trim.ts", "quality-validated-trim.ts"]) {
    const source = stripComments(readFileSync(path.join(rules, name), "utf8"));
    assert.match(source, /high_waste_share/, `${name} must read the pack's high_waste_share`);
    assert.match(source, /medium_waste_share/, `${name} must read the pack's medium_waste_share`);
  }
  const pack = JSON.parse(
    readFileSync(path.join(REPO_ROOT, "data-pack/advisor/thresholds.json"), "utf8"),
  ) as Record<string, unknown>;
  assert.equal(pack.high_waste_share, 0.5);
  assert.equal(pack.medium_waste_share, 0.2);
  assert.equal(advisorThresholds().high_waste_share, 0.5);
  assert.equal(advisorThresholds().medium_waste_share, 0.2);
});

// ── 2. Advisor prose follows the pack ────────────────────────────────────────────────────────────

test("description-bloat's arithmetic AND its sentence both move with the pack", () => {
  const ctx: AdvisorContext = advisorFixtureContext();

  const before = runAdvisor(ctx, { kind: "server", id: "srv-a" }, {
    rules: [descriptionBloatRule],
  });
  const beforeRec = before.recommendations[0];
  assert.ok(beforeRec, "the fixture must produce a description-bloat finding at the default pack");
  assert.match(beforeRec.assumptions.join(" "), /at least 50\.0% of its own tool's/);
  assert.match(beforeRec.assumptions.join(" "), /at least 100 tokens/);
  assert.match(beforeRec.assumptions.join(" "), /the 5 largest tools/);
  assert.match(beforeRec.detail, /of the 5 largest tool/);
  const beforeFlagged = beforeRec.title;

  // Raise the share threshold to 0.9 and the floor to 250, and narrow the window to 2. Every one of
  // those changes the SET of flagged tools as well as the sentence.
  const after = withPack(
    doctoredPack((p) => {
      p.documents.advisorThresholds.description_share_threshold = 0.9;
      p.documents.advisorThresholds.min_description_tokens = 250;
      p.documents.advisorThresholds.top_tools = 2;
    }),
    () => runAdvisor(ctx, { kind: "server", id: "srv-a" }, { rules: [descriptionBloatRule] }),
  );

  const afterRec = after.recommendations[0];
  if (afterRec) {
    const prose = afterRec.assumptions.join(" ");
    assert.match(prose, /at least 90\.0% of its own tool's/, "the share threshold must be quoted");
    assert.match(prose, /at least 250 tokens/, "the absolute floor must be quoted");
    assert.match(prose, /the 2 largest tools/, "the window must be quoted");
    assert.doesNotMatch(prose, /50\.0%/, "the OLD threshold must not survive anywhere in the prose");
    assert.doesNotMatch(prose, /at least 100 tokens/, "the OLD floor must not survive");
    assert.match(afterRec.detail, /of the 2 largest tool/, "the detail quotes the window too");
    assert.notEqual(afterRec.title, beforeFlagged, "a narrower window must flag fewer tools");
  } else {
    // A pack strict enough to flag nothing is also a pass for "the arithmetic moved" — but say so
    // rather than letting an empty result silently satisfy a prose assertion.
    assert.equal(after.recommendations.length, 0);
  }
});

test("tool-overlap's matched-tool count AND its quoted similarity move together (teeth 3)", () => {
  const ctx = advisorFixtureContext();

  const before = runAdvisor(ctx, { kind: "fleet" }, { rules: [toolOverlapRule] });
  const beforeRec = before.recommendations[0];
  assert.ok(beforeRec, "the fixture must produce an overlap finding at the default pack");
  assert.match(beforeRec.assumptions.join(" "), /Jaccard similarity ≥ 0\.7 over name/);
  const beforeCount = countFromOverlapTitle(beforeRec.title);
  assert.ok(beforeCount > 0);

  // 0.999 is above any real Jaccard score, so only the exact/normalized matches survive.
  const after = withPack(
    doctoredPack((p) => {
      p.documents.advisorThresholds.overlap_similarity_threshold = 0.999;
    }),
    () => runAdvisor(ctx, { kind: "fleet" }, { rules: [toolOverlapRule] }),
  );
  const afterRec = after.recommendations[0];
  assert.ok(afterRec, "an exact-name overlap still exists at any similarity floor");
  const prose = afterRec.assumptions.join(" ");
  assert.match(prose, /Jaccard similarity ≥ 0\.999 over name/, "the sentence must quote the pack");
  assert.doesNotMatch(prose, /≥ 0\.7 /, "the OLD threshold must not survive in the prose");
  assert.ok(
    countFromOverlapTitle(afterRec.title) < beforeCount,
    `the matched-tool count must fall with the threshold (was ${beforeCount}, now ${afterRec.title})`,
  );
});

function countFromOverlapTitle(title: string): number {
  const m = /^(\d+) overlapping/.exec(title);
  assert.ok(m, `unexpected overlap title: ${title}`);
  return Number(m[1]);
}

test("the shared waste bands drive severity from the pack, in both trim rules", () => {
  const ctx = advisorFixtureContext();
  const scope = { kind: "scenario", id: "env-1" } as const;

  const before = runAdvisor(ctx, scope, { rules: [unusedToolTrimRule] });
  const beforeRec = before.recommendations.find((r) => r.id.endsWith(":srv-a"));
  assert.ok(beforeRec);
  assert.equal(beforeRec.severity, "high", "the fixture wastes >50% of srv-a's tokens");

  // Push both bands above the fixture's waste share; the SAME finding must drop to `info`.
  const after = withPack(
    doctoredPack((p) => {
      p.documents.advisorThresholds.high_waste_share = 0.99;
      p.documents.advisorThresholds.medium_waste_share = 0.98;
    }),
    () => runAdvisor(ctx, scope, { rules: [unusedToolTrimRule] }),
  );
  const afterRec = after.recommendations.find((r) => r.id.endsWith(":srv-a"));
  assert.ok(afterRec);
  assert.equal(afterRec.severity, "info", "unused-tool-trim reads the pack's waste bands");
  assert.equal(afterRec.detail, beforeRec.detail, "only the BAND moved, not the arithmetic");
});

// ── 3. env → pack → compiled, for the two skill-quality ceilings ─────────────────────────────────

test("with no env override the PACK's ceilings win, not the compiled default", () => {
  // The middle rung. This test runner carries no `SKILL_QUALITY_*` variable, so `config`'s override
  // fields are null and the pack is the answer — which is what makes the child-process test below
  // meaningful rather than vacuous.
  const packOnly = withPack(
    doctoredPack((p) => {
      p.documents.qualityThresholds.skill_quality_l1_token_ceiling = 777;
      p.documents.qualityThresholds.skill_quality_l2_token_ceiling = 8888;
    }),
    () => skillQualityCeilings(),
  );
  assert.deepEqual(packOnly, { l1: 777, l2: 8888 });

  // The bottom rung: the compiled default is what the SHIPPED pack carries, so with the real pack in
  // force the answer equals `DEFAULT_SKILL_QUALITY_L1/L2_TOKEN_CEILING`. If the two ever diverge,
  // `compatibility-data.test.ts`'s rebuild-and-byte-compare goes red first.
  const shipped = withPack(REAL, () => skillQualityCeilings());
  assert.deepEqual(shipped, {
    l1: DEFAULT_SKILL_QUALITY_L1_TOKEN_CEILING,
    l2: DEFAULT_SKILL_QUALITY_L2_TOKEN_CEILING,
  });
});

test("an env override BEATS the pack — proved in a child process, not by reading the source", () => {
  // `config` is built once at module load from `process.env`, so this runner cannot change an
  // override and observe it. A child process can. The quantity: the value
  // `skillQualityCeilings()` returns in a process that carries the variables. WHAT IT CANNOT SEE:
  // whether the route handlers call that function — `skill-ide-quality.test.ts` covers the engine,
  // and the wiring is a one-line read in `skillflow/routes.ts`.
  const probe = path.join(API_ROOT, "test/support/print-skill-quality-ceilings.ts");

  const withOverride = runProbe({
    SKILL_QUALITY_L1_TOKEN_CEILING: "123",
    SKILL_QUALITY_L2_TOKEN_CEILING: "4567",
  });
  assert.deepEqual(
    withOverride,
    { l1: 123, l2: 4567 },
    "an env override must beat the pack's 500 / 5000",
  );

  const withoutOverride = runProbe({});
  assert.deepEqual(
    withoutOverride,
    { l1: 500, l2: 5000 },
    "with no override the PACK's value is the answer — so the case above really moved something",
  );

  // One override, not both: the two must resolve independently.
  assert.deepEqual(runProbe({ SKILL_QUALITY_L2_TOKEN_CEILING: "9" }), { l1: 500, l2: 9 });

  function runProbe(env: Record<string, string>): { l1: number; l2: number } {
    const out = execFileSync("pnpm", ["exec", "tsx", probe], {
      cwd: API_ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        SKILL_QUALITY_L1_TOKEN_CEILING: "",
        SKILL_QUALITY_L2_TOKEN_CEILING: "",
        ...env,
      },
    });
    return JSON.parse(out.trim().split("\n").at(-1) as string) as { l1: number; l2: number };
  }
});

// ── 4. Merge order is contract ───────────────────────────────────────────────────────────────────

const ORDER_PROBE = "wp22-merge-order-probe";

test("context limits merge floor → legacy → roster-gap → generated (a swap changes the answer)", () => {
  // Every layer carries a DIFFERENT value for the SAME id, so any reorder of the four spreads
  // produces a different winner. That is what makes this a reorder detector rather than a smoke test.
  const pack = doctoredPack((p) => {
    p.documents.modelOverrides.legacy_context_limits[ORDER_PROBE] = 1;
    p.documents.modelOverrides.roster_gap_context_limits[ORDER_PROBE] = 2;
    const first = p.documents.allModels.models[0];
    assert.ok(first);
    p.documents.allModels.models.push({ ...first, model_id: ORDER_PROBE, context_window_tokens: 3 });
  });

  withPack(pack, () => {
    assert.equal(
      modelContextLimits()[ORDER_PROBE],
      3,
      "the generated dataset must win over roster-gap, which must win over legacy",
    );
  });

  // Drop the generated layer: roster-gap must win, not legacy.
  withPack(
    doctoredPack((p) => {
      p.documents.modelOverrides.legacy_context_limits[ORDER_PROBE] = 1;
      p.documents.modelOverrides.roster_gap_context_limits[ORDER_PROBE] = 2;
    }),
    () => assert.equal(modelContextLimits()[ORDER_PROBE], 2, "roster-gap wins over legacy"),
  );

  // Drop roster-gap too: legacy is the last pack layer above the floor.
  withPack(
    doctoredPack((p) => {
      p.documents.modelOverrides.legacy_context_limits[ORDER_PROBE] = 1;
    }),
    () => assert.equal(modelContextLimits()[ORDER_PROBE], 1),
  );
});

test("prices merge in the same order, and the DB resolver still sits above all of it", () => {
  const pack = doctoredPack((p) => {
    p.documents.modelOverrides.legacy_pricing[ORDER_PROBE] = { inPer1M: 1, outPer1M: 1 };
    p.documents.modelOverrides.roster_gap_pricing[ORDER_PROBE] = { inPer1M: 2, outPer1M: 2 };
    const first = p.documents.allModels.models[0];
    assert.ok(first);
    p.documents.allModels.models.push({
      ...first,
      model_id: ORDER_PROBE,
      input_per_mtok_usd: 3,
      output_per_mtok_usd: 3,
      cached_input_per_mtok_usd: null,
    });
  });
  withPack(pack, () => {
    assert.deepEqual(modelPricingTable()[ORDER_PROBE], { inPer1M: 3, outPer1M: 3 });
  });

  withPack(
    doctoredPack((p) => {
      p.documents.modelOverrides.legacy_pricing[ORDER_PROBE] = { inPer1M: 1, outPer1M: 1 };
      p.documents.modelOverrides.roster_gap_pricing[ORDER_PROBE] = { inPer1M: 2, outPer1M: 2 };
    }),
    () => assert.deepEqual(modelPricingTable()[ORDER_PROBE], { inPer1M: 2, outPer1M: 2 }),
  );

  // The DB-backed resolver's precedence over the whole chain is asserted by source, because
  // installing a real `PricingRepository` here would be testing `pricing-editor.test.ts`'s subject.
  // The quantity: `resolvePrice` consults `activeResolver` BEFORE the table. Blind spot: it does not
  // prove the resolver returns anything useful.
  // Comments stripped, for the reason the waste-band guard above records: an un-stripped presence
  // check asserts "someone wrote this string", and a comment describing where a call USED to be is
  // exactly what outlives the call.
  const source = stripComments(readFileSync(path.join(API_ROOT, "src/providers/pricing.ts"), "utf8"));
  const resolverAt = source.indexOf("const hit = resolver.resolve(model, opts);");
  const tableAt = source.indexOf("const codeHit = table[model];");
  assert.ok(resolverAt > 0 && tableAt > 0, "both reads must still exist in the CODE");
  assert.ok(resolverAt < tableAt, "the DB resolver is consulted before the pack-resolved table");
});

// ── 5. D-DP3 — the compiled floor still arms both guardrails ─────────────────────────────────────

/** A model the SHIPPED pack knows, whose absence would be a real guardrail loss. */
const GUARDED_MODEL = "claude-sonnet-5";

test("a pack that DROPS a model cannot disarm the context-window guardrail (D-DP3, teeth 2)", () => {
  assert.ok(
    (MODEL_CONTEXT_LIMITS[GUARDED_MODEL] ?? 0) > 0,
    `${GUARDED_MODEL} must be in the compiled floor for this test to mean anything`,
  );

  const stripped = doctoredPack((p) => {
    delete p.documents.modelOverrides.legacy_context_limits[GUARDED_MODEL];
    delete p.documents.modelOverrides.roster_gap_context_limits[GUARDED_MODEL];
    p.documents.allModels.models = p.documents.allModels.models.filter(
      (m) => m.model_id !== GUARDED_MODEL,
    );
  });

  withPack(stripped, () => {
    const limits = modelContextLimits();
    assert.equal(
      limits[GUARDED_MODEL],
      MODEL_CONTEXT_LIMITS[GUARDED_MODEL],
      "the COMPILED FLOOR must still supply the window — a 0 silently disables compaction and " +
        "makes every '% of context used' surface meaningless (D-DP3)",
    );
    assert.ok((limits[GUARDED_MODEL] ?? 0) > 0);
  });
});

test("a pack that DROPS a model cannot make it price-unknown (D-DP3, issue #10)", () => {
  assert.ok(MODEL_PRICING[GUARDED_MODEL], "precondition: the compiled seed prices it");
  assert.equal(isModelPriced(GUARDED_MODEL), true, "precondition, with the real pack in force");

  const stripped = doctoredPack((p) => {
    delete p.documents.modelOverrides.legacy_pricing[GUARDED_MODEL];
    delete p.documents.modelOverrides.roster_gap_pricing[GUARDED_MODEL];
    p.documents.allModels.models = p.documents.allModels.models.filter(
      (m) => m.model_id !== GUARDED_MODEL,
    );
  });

  withPack(stripped, () => {
    assert.ok(
      modelPricingTable()[GUARDED_MODEL],
      "the COMPILED FLOOR must still price it — an unpriced model makes isModelPriced() false, " +
        "which REFUSES a cost-capped run and makes estimateCost() return 0 (D-DP3)",
    );
    assert.equal(isModelPriced(GUARDED_MODEL), true);
  });
});

test("a pack that DROPS a zero-price local model cannot make it price-unknown either", () => {
  const local = "llama3.1";
  const stripped = doctoredPack((p) => {
    p.documents.modelOverrides.zero_price_models =
      p.documents.modelOverrides.zero_price_models.filter((id) => id !== local);
  });
  withPack(stripped, () => {
    assert.ok(zeroPriceModels().includes(local), "the floor UNION the pack, never the pack alone");
    assert.deepEqual(modelPricingTable()[local], { inPer1M: 0, outPer1M: 0 });
    assert.equal(isModelPriced(local), true);
  });
});

// ── 6. Everything else the pack now feeds ────────────────────────────────────────────────────────

test("the workbench MCP definition-token budget comes from the pack", () => {
  assert.equal(workbenchMcpDefinitionTokenBudget(), 3500, "the shipped pack's value");
  withPack(
    doctoredPack((p) => {
      p.documents.qualityThresholds.workbench_mcp_definition_token_budget = 7;
    }),
    () => assert.equal(workbenchMcpDefinitionTokenBudget(), 7),
  );
});

test("the heatmap defaults and the model-id aliases come from the pack", () => {
  assert.deepEqual(
    defaultHeatmapModels(),
    [...FLOOR_DEFAULT_HEATMAP_MODELS],
    "the shipped pack and the compiled floor agree today",
  );
  withPack(
    doctoredPack((p) => {
      p.documents.modelOverrides.default_heatmap_models = ["gpt-4o"];
      p.documents.modelOverrides.model_id_aliases["wp22-alias"] = "gpt-4o";
    }),
    () => {
      assert.deepEqual(defaultHeatmapModels(), ["gpt-4o"]);
      assert.equal(modelIdAliases()["wp22-alias"], "gpt-4o");
    },
  );
});

test("the quality thresholds the pack carries are the ones the app compiled against", () => {
  const q = qualityThresholds();
  assert.deepEqual(q.quality_severity_weights, { error: 15, warning: 5, info: 1 });
  assert.equal(q.default_compare_threshold, 0.6);
  assert.equal(q.default_loop_threshold, 3);
  assert.equal(q.failure_bucket_score_threshold, 0.5);
});

// ── 7. A pack missing or malformed in a judgement table is refused whole ─────────────────────────

test("the resolved pack carries all three judgement documents", () => {
  // Cheap, but it is the assertion that would go red if the loader stopped parsing one of them —
  // every behavioural test above would then throw a TypeError instead of failing meaningfully.
  const docs = getDataPack().documents;
  assert.equal(typeof docs.advisorThresholds.top_tools, "number");
  assert.equal(typeof docs.qualityThresholds.default_compare_threshold, "number");
  assert.equal(typeof docs.modelOverrides.assistant_default_title_model, "string");
  resetDataPackSourceForTests();
});
