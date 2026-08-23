// tsc does not copy non-TS assets to dist, and only `apps/api/dist` is carried into the runtime
// image (see the Dockerfile's `runtime` stage). So after the TS build, the reference data pack is
// copied out of the repository-root `data-pack/` and into `apps/api/dist/data-pack-bundled/` —
// the bundled snapshot `apps/api/src/data-pack/resolve.ts` looks for when it is running compiled.
//
// It replaces `copy-data.mjs` (RM-38 WP 1.2), which copied a THIRD copy of the same three JSON
// files out of `apps/api/src/compatibility/data/`. That directory is gone; the pack is the one
// address.
//
// `data-pack-bundled`, not `data-pack`: `apps/api/src/data-pack/*.ts` compiles to
// `apps/api/dist/data-pack/*.js`, so the obvious name would put the loader's own code in the
// directory the loader digests.
//
// Only PACK CONTENT ships — the manifest plus the directories it digests. `build/`, `package.json`,
// `tsconfig.json` and `relocation-ledger.json` are repository scaffolding, and shipping any of them
// would put an unlisted file in the pack, which the loader refuses outright.
import { cpSync, existsSync, mkdirSync, rmSync, copyFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Kept in step with DATA_PACK_CONTENT_DIRS in packages/shared/src/data-pack.ts. This script runs
// before `packages/shared` is necessarily importable from here (it is a plain .mjs invoked by
// `tsc && node`), so the list is repeated rather than imported —
// `apps/api/test/data-pack-seam.test.ts` reads this file and fails if the two disagree.
const CONTENT_DIRS = [
  "advisor",
  "compatibility",
  "generated",
  "limits",
  "models",
  "models/open-weight",
  "models/saas",
  "quality",
  "schema",
  "security",
];

const here = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(here, "..");
const repoRoot = path.resolve(apiRoot, "../..");
const packRoot = path.join(repoRoot, "data-pack");
const dest = path.join(apiRoot, "dist/data-pack-bundled");

const manifest = path.join(packRoot, "manifest.json");
if (!existsSync(manifest)) {
  console.error(`copy-data-pack: missing ${manifest} — run \`pnpm build:data-pack\` first.`);
  process.exit(1);
}

// Replace, never merge: a stale file left behind from a previous pack layout would be an unlisted
// file, and the loader refuses a pack that carries one.
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });

copyFileSync(manifest, path.join(dest, "manifest.json"));
let copied = 1;
for (const dir of CONTENT_DIRS) {
  const from = path.join(packRoot, ...dir.split("/"));
  if (!existsSync(from)) continue;
  const to = path.join(dest, ...dir.split("/"));
  mkdirSync(path.dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true });
  copied += 1;
}

console.log(`copy-data-pack: ${packRoot} → ${dest} (manifest + ${copied - 1} content dirs)`);
