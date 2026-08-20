// CLI: regenerate the bundled model-comparison assets + the derived shared slice from the
// research source-of-truth (`planning/Research/RS-01-token-context-comparison/outputs/data/**`).
// Run after editing any
// provider data file:
//
//     pnpm build:model-data
//
// Outputs (all committed; the drift test re-derives in-memory and fails if any is stale):
//   - apps/api/src/compatibility/data/all-models.json        (built index — engine reads this)
//   - apps/api/src/compatibility/data/cross-cutting-limits.json (copied verbatim)
//   - apps/api/src/compatibility/data/test-catalog.json         (copied verbatim)
//   - packages/shared/src/model-data.generated.ts            (derived context-limit + pricing maps)
//
// The per-provider JSON files stay the human-curated SoT; this never hand-edits the outputs.

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAllModels, renderSharedGenerated, serializeAllModels } from "./build.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// src/compatibility → src → api → apps → <repo root>
const repoRoot = path.resolve(here, "../../../..");
const researchDir = path.join(repoRoot, "planning/Research/RS-01-token-context-comparison/outputs");
const dataDir = path.join(researchDir, "data");
const appDataDir = path.join(repoRoot, "apps/api/src/compatibility/data");
const sharedGenerated = path.join(repoRoot, "packages/shared/src/model-data.generated.ts");

/** Read every per-provider data file (data/<group>/<provider>.json), with repo-relative paths. */
export function readProviderFiles(): { relPath: string; data: unknown }[] {
  const out: { relPath: string; data: unknown }[] = [];
  for (const group of readdirSync(dataDir, { withFileTypes: true })) {
    if (!group.isDirectory()) continue;
    const groupDir = path.join(dataDir, group.name);
    for (const file of readdirSync(groupDir)) {
      if (!file.endsWith(".json")) continue;
      const abs = path.join(groupDir, file);
      out.push({
        relPath: path.relative(repoRoot, abs),
        data: JSON.parse(readFileSync(abs, "utf8")),
      });
    }
  }
  out.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return out;
}

/** Build all four outputs in-memory (no writes) — the drift test calls this. */
export function buildOutputs() {
  const all = buildAllModels(readProviderFiles());
  return {
    allModelsJson: serializeAllModels(all),
    crossCuttingJson: readFileSync(path.join(dataDir, "cross-cutting-limits.json"), "utf8"),
    testCatalogJson: readFileSync(path.join(researchDir, "tests/test-catalog.json"), "utf8"),
    sharedGeneratedTs: renderSharedGenerated(all),
    modelCount: all.model_count,
    providerCount: all.provider_count,
  };
}

export const OUTPUT_PATHS = {
  allModels: path.join(appDataDir, "all-models.json"),
  crossCutting: path.join(appDataDir, "cross-cutting-limits.json"),
  testCatalog: path.join(appDataDir, "test-catalog.json"),
  sharedGenerated,
};

function main() {
  const o = buildOutputs();
  mkdirSync(appDataDir, { recursive: true });
  writeFileSync(OUTPUT_PATHS.allModels, o.allModelsJson);
  writeFileSync(OUTPUT_PATHS.crossCutting, o.crossCuttingJson);
  writeFileSync(OUTPUT_PATHS.testCatalog, o.testCatalogJson);
  writeFileSync(OUTPUT_PATHS.sharedGenerated, o.sharedGeneratedTs);
  // eslint-disable-next-line no-console
  console.log(
    `Built model-data assets: ${o.providerCount} providers, ${o.modelCount} models → apps/api/src/compatibility/data/ + packages/shared/src/model-data.generated.ts`,
  );
}

// Run only when invoked directly (not when imported by the drift test).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
