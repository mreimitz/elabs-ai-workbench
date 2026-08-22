// CLI: regenerate the pack's derived artifacts + the manifest from the hand-curated pack sources
// under `data-pack/`. Run after editing any pack data file:
//
//     pnpm build:data-pack        (`pnpm build:model-data` still works, and says it is deprecated)
//
// Reads (hand-curated, the source of truth):
//   - data-pack/models/{saas,open-weight}/*.json   per-provider model entries
//   - data-pack/limits/cross-cutting.json          protocol / client / SDK / provider limits
//   - data-pack/compatibility/test-catalog.json    the compatibility rule catalog
//
// Writes (all committed; the drift test re-derives in memory and fails if any is stale):
//   - data-pack/generated/all-models.json          built flat index — the pack's derived artifact
//   - data-pack/manifest.json                      packVersion + schemaVersion + per-file SHA-256
//   - packages/shared/src/model-data.generated.ts  derived context-limit + pricing maps
//
// It no longer writes a copy into `apps/api/src/compatibility/data/`: RM-38 WP 1.2 moved the
// compatibility engine onto the resolved pack (`apps/api/src/data-pack/`), and that directory was
// deleted in the same change. The pack IS the address now; `apps/api/scripts/copy-data-pack.mjs`
// puts it in `apps/api/dist/data-pack-bundled/` at build time so `node dist` can read it.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAllModels, renderSharedGenerated, serializeAllModels } from "./build.js";
import { buildManifest, serializeManifest } from "./manifest.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// data-pack/build → data-pack → <repo root>. Two levels, not four: this file used to live at
// apps/api/src/compatibility/ and walked up `../../../..`. A relative walk like that is wrong by
// exactly as many levels as the file is moved, and it fails INTO A REAL DIRECTORY rather than
// erroring — so `assertAnchors()` below proves each anchor is the directory it claims to be,
// before anything is written.
export const PACK_ROOT = path.resolve(here, "..");
const repoRoot = path.resolve(PACK_ROOT, "..");

const modelsDir = path.join(PACK_ROOT, "models");
const generatedDir = path.join(PACK_ROOT, "generated");
const sharedGenerated = path.join(repoRoot, "packages/shared/src/model-data.generated.ts");

/**
 * Prove the two path anchors before writing a single byte. A silently-wrong `repoRoot` would write
 * `model-data.generated.ts` into some other real directory and report success.
 */
function assertAnchors(): void {
  const nameOf = (dir: string): unknown => {
    try {
      return (JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as { name?: unknown })
        .name;
    } catch {
      return undefined;
    }
  };
  if (nameOf(PACK_ROOT) !== "@mcp-token-footprint/data-pack") {
    throw new Error(`PACK_ROOT does not look like the data pack: ${PACK_ROOT}`);
  }
  if (nameOf(repoRoot) !== "mcp-token-footprint") {
    throw new Error(`repoRoot does not look like the repository root: ${repoRoot}`);
  }
  for (const required of [modelsDir, path.dirname(sharedGenerated)]) {
    if (!existsSync(required)) {
      throw new Error(`Expected directory is missing — wrong anchor? ${required}`);
    }
  }
}

/**
 * The pack LAYOUT version this build writes. Held equal to
 * `DATA_PACK_SCHEMA_VERSION` in `packages/shared/src/data-pack.ts` by a test — deliberately NOT
 * imported, so the pack build never needs `packages/shared` to be built first.
 */
export const PACK_SCHEMA_VERSION = 1;

/** The generator path stamped into `all-models.json` and `manifest.json`. */
export const GENERATOR_PATH = "data-pack/build/build-cli.ts";

/** Read every per-provider data file (models/<group>/<provider>.json), with repo-relative paths. */
export function readProviderFiles(): { relPath: string; data: unknown }[] {
  const out: { relPath: string; data: unknown }[] = [];
  for (const group of readdirSync(modelsDir, { withFileTypes: true })) {
    if (!group.isDirectory()) continue;
    const groupDir = path.join(modelsDir, group.name);
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

/** Build every derived output in memory (no writes) — the drift test calls this. */
export function buildOutputs() {
  const all = buildAllModels(readProviderFiles());
  return {
    allModelsJson: serializeAllModels(all),
    sharedGeneratedTs: renderSharedGenerated(all),
    asOf: all.as_of,
    modelCount: all.model_count,
    providerCount: all.provider_count,
  };
}

export const OUTPUT_PATHS = {
  /** The pack's own derived artifact — what `apps/api/src/data-pack/loader.ts` reads. */
  packAllModels: path.join(generatedDir, "all-models.json"),
  packManifest: path.join(PACK_ROOT, "manifest.json"),
  sharedGenerated,
};

/** The pack version stamped into the manifest — `data-pack/package.json`'s `version`. */
export function readPackVersion(): string {
  const pkg = JSON.parse(readFileSync(path.join(PACK_ROOT, "package.json"), "utf8")) as {
    version?: unknown;
  };
  if (typeof pkg.version !== "string" || !/^\d+\.\d+\.\d+$/.test(pkg.version)) {
    throw new Error("data-pack/package.json must carry a semver-core `version` (the packVersion)");
  }
  return pkg.version;
}

/**
 * `asOf` for the manifest: the newest `as_of` across every hand-curated source in the pack, so the
 * manifest is only as current as the freshest fact it carries. Derived, never wall-clock — the
 * drift test rebuilds this and byte-compares.
 */
function packAsOf(modelsAsOf: string): string {
  const readAsOf = (rel: string): string => {
    const parsed = JSON.parse(readFileSync(path.join(PACK_ROOT, rel), "utf8")) as {
      as_of?: unknown;
    };
    return typeof parsed.as_of === "string" ? parsed.as_of : "";
  };
  const candidates = [
    modelsAsOf,
    readAsOf("limits/cross-cutting.json"),
    readAsOf("compatibility/test-catalog.json"),
  ];
  let newest = "";
  for (const v of candidates) if (v > newest) newest = v;
  return newest;
}

function main() {
  assertAnchors();
  const o = buildOutputs();

  mkdirSync(generatedDir, { recursive: true });
  writeFileSync(OUTPUT_PATHS.packAllModels, o.allModelsJson);
  writeFileSync(OUTPUT_PATHS.sharedGenerated, o.sharedGeneratedTs);

  // The manifest digests what is on disk, so it is written LAST.
  const manifest = buildManifest({
    packRoot: PACK_ROOT,
    packVersion: readPackVersion(),
    schemaVersion: PACK_SCHEMA_VERSION,
    asOf: packAsOf(o.asOf),
    generator: GENERATOR_PATH,
  });
  writeFileSync(OUTPUT_PATHS.packManifest, serializeManifest(manifest));

  console.log(
    `Built data pack ${manifest.packVersion} (schema ${manifest.schemaVersion}, as-of ${manifest.asOf}): ` +
      `${o.providerCount} providers, ${o.modelCount} models, ${manifest.files.length} pack files → ` +
      "data-pack/{generated,manifest.json} + packages/shared/src/model-data.generated.ts",
  );
}

// Run only when invoked directly (not when imported by the drift test).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
