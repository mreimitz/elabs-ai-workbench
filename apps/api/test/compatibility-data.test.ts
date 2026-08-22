import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { MODEL_CONTEXT_LIMITS } from "@mcp-token-footprint/shared";
import {
  buildOutputs,
  OUTPUT_PATHS,
  PACK_ROOT,
  readProviderFiles,
} from "../../../data-pack/build/build-cli.js";
import { buildAllModels } from "../../../data-pack/build/build.js";
import { getCatalog } from "../src/compatibility/catalog.js";
import {
  getAllModels,
  getCrossCutting,
  getModel,
  listModelIds,
  resolveDatasetModelId,
} from "../src/compatibility/dataset.js";
import { estimateCost, MODEL_PRICING } from "../src/providers/pricing.js";

const read = (p: string) => readFileSync(p, "utf8");

// --- Drift: the committed bundled assets must equal a fresh build from the research SoT ----------

test("bundled all-models.json is not stale vs data-pack/models/** (rebuild + byte-compare)", () => {
  const fresh = buildOutputs();
  assert.equal(
    read(OUTPUT_PATHS.allModels),
    fresh.allModelsJson,
    "run `pnpm build:data-pack` — apps/api/.../data/all-models.json is stale",
  );
  assert.equal(
    read(OUTPUT_PATHS.packAllModels),
    fresh.allModelsJson,
    "run `pnpm build:data-pack` — data-pack/generated/all-models.json is stale",
  );
  assert.equal(
    read(OUTPUT_PATHS.sharedGenerated),
    fresh.sharedGeneratedTs,
    "run `pnpm build:data-pack` — model-data.generated.ts is stale",
  );
});

test("cross-cutting-limits.json + test-catalog.json snapshots match the pack source verbatim", () => {
  assert.equal(
    read(OUTPUT_PATHS.crossCutting),
    read(path.join(PACK_ROOT, "limits/cross-cutting.json")),
  );
  assert.equal(
    read(OUTPUT_PATHS.testCatalog),
    read(path.join(PACK_ROOT, "compatibility/test-catalog.json")),
  );
});

// RM-37 WP 0.5 (action 7) — `finding_name` is REQUIRED on `CatalogTest`, so a missing one is a
// compile error. Nothing at the type level stops it being a copy-paste of `user_facing_name`
// though, and that would defeat the point: `user_facing_name` names the CHECK ("Tool has a
// description"), `finding_name` names the PROBLEM ("Tool has no description"). A findings card
// printing the check name reads as though the check itself were the bad news.
//
// Note this reads through `getCatalog()`, i.e. the BUNDLED copy — which the test above has just
// pinned byte-identical to the research source, so pinning one pins both.
test("every catalog test names its finding as a problem, not as the check", () => {
  const { tests } = getCatalog();
  assert.ok(tests.length > 0, "the catalog must not be empty");
  for (const entry of tests) {
    assert.equal(typeof entry.finding_name, "string", `${entry.id}: finding_name must be a string`);
    assert.ok(entry.finding_name.trim().length > 0, `${entry.id}: finding_name must not be empty`);
    assert.notEqual(
      entry.finding_name,
      entry.user_facing_name,
      `${entry.id}: finding_name duplicates user_facing_name, so the findings list still reads as a checks list`,
    );
  }
});

test("builder validates + merges the full roster (11 providers, 55 models, unique ids)", () => {
  const all = buildAllModels(readProviderFiles());
  assert.equal(all.provider_count, 11);
  assert.equal(all.model_count, 55);
  assert.equal(new Set(all.models.map((m) => m.model_id)).size, 55);
});

// --- Loader ------------------------------------------------------------------------------------

test("dataset loader indexes by model id with provenanced detail", () => {
  const opus = getModel("claude-opus-4-8");
  assert.ok(opus, "claude-opus-4-8 must be in the dataset");
  assert.equal(opus.provider_id, "anthropic");
  assert.equal(opus.context_window_tokens, 1_000_000);
  // `detail` carries the full provenanced model the severity resolver reads.
  const cw = (opus.detail as { context?: { context_window_tokens?: { value?: unknown } } }).context
    ?.context_window_tokens?.value;
  assert.equal(cw, 1_000_000);
  assert.equal(getModel("definitely-not-a-model"), undefined);
});

test("model-id alias crosswalk resolves snapshot ids to the dataset id", () => {
  assert.equal(resolveDatasetModelId("claude-haiku-4-5-20251001"), "claude-haiku-4-5");
  assert.equal(resolveDatasetModelId("claude-opus-4-8"), "claude-opus-4-8");
  assert.equal(resolveDatasetModelId("nope"), null);
});

test("dataset exposes the full roster + cross-cutting client limits", () => {
  assert.equal(listModelIds().length, 55);
  assert.equal(getAllModels().models.length, 55);
  const cross = getCrossCutting() as { clients?: { cursor?: { max_tools?: number } } };
  assert.equal(cross.clients?.cursor?.max_tools, 40);
});

// --- Derivation + spend-cap no-regression (the explicit Decision-1 sequencing gate) -------------

test("MODEL_CONTEXT_LIMITS unions dataset (current-gen) over legacy (previous-gen) ids", () => {
  // Dataset-derived current generation.
  assert.equal(MODEL_CONTEXT_LIMITS["claude-opus-4-8"], 1_000_000);
  assert.equal(MODEL_CONTEXT_LIMITS["gpt-5.5"], 1_050_000);
  // Legacy fallback retained for older ids the dataset does not cover.
  assert.equal(MODEL_CONTEXT_LIMITS["gpt-4o"], 128_000);
  assert.equal(MODEL_CONTEXT_LIMITS["claude-opus-4-1"], 200_000);
});

test("pricing unification keeps the spend cap firing for BOTH legacy and current-gen models", () => {
  // Current-gen priced from the dataset.
  assert.ok(MODEL_PRICING["gpt-5.5"], "gpt-5.5 must be priced from the dataset");
  assert.ok(MODEL_PRICING["claude-opus-4-8"]);
  // Legacy ids still priced (no silent zeroing → spend cap still fires for them).
  assert.ok(MODEL_PRICING["gpt-4o"]);
  const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000 };
  assert.ok(estimateCost("gpt-4o", usage) > 0, "legacy model must still estimate a non-zero cost");
  assert.ok(
    estimateCost("claude-opus-4-8", usage) > 0,
    "current-gen model must estimate a non-zero cost",
  );
  // Dataset value wins on the single overlapping id (gemini-2.5-pro).
  assert.equal(MODEL_PRICING["gemini-2.5-pro"]?.outPer1M, 10);
});
