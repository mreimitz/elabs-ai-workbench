// tsc does not copy non-TS assets to dist. The compatibility engine reads its bundled JSON dataset
// (all-models.json, cross-cutting-limits.json, test-catalog.json) relative to its module, so after
// the TS build we copy src/compatibility/data → dist/compatibility/data for `node dist`.
import { cpSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(here, "..");
const src = path.join(apiRoot, "src/compatibility/data");
const dest = path.join(apiRoot, "dist/compatibility/data");

if (!existsSync(src)) {
  console.error(`copy-data: missing ${src} — run \`pnpm build:model-data\` first.`);
  process.exit(1);
}
cpSync(src, dest, { recursive: true });
console.log(`copy-data: ${src} → ${dest}`);
