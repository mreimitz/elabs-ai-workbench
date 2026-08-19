import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatSelfScanHeadline,
  renderSelfScanJson,
  renderSelfScanMarkdown,
  runWorkbenchSelfScan,
} from "./self-scan.js";

// CLI: scan the workbench's OWN MCP mount with the app's own scanner and assert the tool-definition
// token budget (D-MCP5). Run from the repo root:
//
//     pnpm mcp:self-scan            # writes .artifacts/mcp-self-scan/{footprint.json,footprint.md}
//     pnpm mcp:self-scan --out=…    # write the artifact somewhere else (CI upload path)
//
// Exit codes (the plan's CLI invariant):
//   0 — measured, under budget
//   1 — measured, OVER budget (the assertion this gate exists for)
//   2 — could not measure (the mount would not serve, the scan failed, the artifact would not write)
//
// It needs nothing but a free loopback port: its own temp database, its own in-memory key, no
// provider credentials, no network. Output paths are printed repo-relative — a build log is not the
// place to publish someone's home directory.

const here = path.dirname(fileURLToPath(import.meta.url));
// src/mcp-server → src → api → apps → <repo root>
const repoRoot = path.resolve(here, "../../../..");
const DEFAULT_OUT_DIR = path.join(repoRoot, ".artifacts", "mcp-self-scan");

function readOutDir(argv: readonly string[]): string {
  const flag = argv.find((arg) => arg.startsWith("--out="));
  if (!flag) return DEFAULT_OUT_DIR;
  const value = flag.slice("--out=".length).trim();
  if (!value) return DEFAULT_OUT_DIR;
  return path.resolve(repoRoot, value);
}

/** Print a path the way a build log should: relative to the repo, never an absolute local path. */
function display(file: string): string {
  const relative = path.relative(repoRoot, file);
  return relative.startsWith("..") ? path.basename(file) : relative;
}

async function main(): Promise<number> {
  const outDir = readOutDir(process.argv.slice(2));
  const result = await runWorkbenchSelfScan();

  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, "footprint.json");
  const markdownPath = path.join(outDir, "footprint.md");
  fs.writeFileSync(jsonPath, renderSelfScanJson(result));
  fs.writeFileSync(markdownPath, renderSelfScanMarkdown(result));

  console.log(formatSelfScanHeadline(result));
  console.log(
    `Resources: ${result.resourceCount} · templates: ${result.resourceTemplateCount} · prompts: ${result.promptCount}`,
  );
  console.log(`Artifact: ${display(jsonPath)} · ${display(markdownPath)}`);

  if (result.overBudget) {
    console.error(
      `FAIL: the workbench MCP tool definitions cost ${result.measuredTokens} tokens, over the ` +
        `${result.budget} budget. Every host pays this on every conversation — trim a description ` +
        "or a schema, or raise WORKBENCH_MCP_DEFINITION_TOKEN_BUDGET deliberately.",
    );
    return 1;
  }
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(
      `ERROR: the workbench MCP self-scan could not run — ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 2;
  });
