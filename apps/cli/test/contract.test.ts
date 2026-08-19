import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  createMcpfpOutput,
  MCPFP_EXIT,
  MCPFP_OUTPUT_VERSION,
  mcpfpConfigFileSchema,
} from "@mcp-token-footprint/shared";

// The invariants that make this package a CLIENT rather than a second copy of the app
// (roadmap/ci/ WP 1.2 — A2, A3, A4, A11). These are structural assertions over the manifest and the
// source tree, deliberately not over behaviour: the failure they exist to catch is somebody reaching
// for `@modelcontextprotocol/sdk` or `commander` in six months because it was momentarily convenient.

const CLI_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = path.dirname(path.dirname(CLI_ROOT));

function readManifest(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(CLI_ROOT, "package.json"), "utf8"));
}

test("A2 — the CLI's only runtime dependency is @mcp-token-footprint/shared", () => {
  const manifest = readManifest();
  assert.deepEqual(manifest.dependencies, { "@mcp-token-footprint/shared": "workspace:*" });

  // Spelled out rather than derived, so the failure message names the thing that was added.
  const forbidden = [
    "@modelcontextprotocol/sdk",
    "better-sqlite3",
    "js-tiktoken",
    "@mcp-token-footprint/api",
    "@mcp-token-footprint/web",
    "fastify",
    "commander",
    "yargs",
    "zod",
  ];
  const declared = Object.keys({
    ...(manifest.dependencies as Record<string, string>),
    ...((manifest.devDependencies ?? {}) as Record<string, string>),
  });
  for (const name of forbidden) {
    assert.ok(
      !declared.includes(name),
      `${name} must not be a dependency of apps/cli — the CLI is a client (roadmap/ci/README.md).`,
    );
  }
});

test("A2 — the package declares the mcpfp bin and the workspace scripts the root recurses into", () => {
  const manifest = readManifest();
  assert.equal(manifest.name, "@mcp-token-footprint/cli");
  assert.equal(manifest.private, true);
  assert.equal(manifest.type, "module");
  assert.deepEqual(manifest.bin, { mcpfp: "./dist/index.js" });

  const scripts = manifest.scripts as Record<string, string>;
  // `pnpm -r` picks these up with no edit to the root build/typecheck/test scripts.
  for (const script of ["build", "typecheck", "test"]) {
    assert.ok(scripts[script], `apps/cli must define a "${script}" script`);
  }
});

test("A2/A3 — every import in apps/cli/src is node:*, relative, or @mcp-token-footprint/shared", () => {
  const offenders: string[] = [];
  for (const file of walkTypeScript(path.join(CLI_ROOT, "src"))) {
    const source = stripComments(fs.readFileSync(file, "utf8"));
    // Anchored at a statement start and stopped by the first `;`, so a `from "…"` inside a template
    // string in the middle of a function body is not mistaken for an import.
    const specifiers = [
      ...source.matchAll(/^\s*(?:import|export)[^;]*?\sfrom\s+"([^"]+)"/gm),
      ...source.matchAll(/^\s*import\s+"([^"]+)"/gm),
    ];
    for (const match of specifiers) {
      const specifier = match[1] as string;
      const allowed =
        specifier.startsWith(".") ||
        specifier.startsWith("node:") ||
        specifier === "@mcp-token-footprint/shared";
      if (!allowed) offenders.push(`${path.relative(REPO_ROOT, file)} imports "${specifier}"`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("A3 — the bin entry keeps its shebang so the built dist/index.js is executable", () => {
  const entry = fs.readFileSync(path.join(CLI_ROOT, "src", "index.ts"), "utf8");
  assert.ok(entry.startsWith("#!/usr/bin/env node\n"));
});

test("A4 — the machine envelope is declared in shared and carries no credential field", () => {
  const envelope = createMcpfpOutput({
    command: "servers",
    apiUrl: "http://127.0.0.1:8080",
    data: [{ id: "srv_1" }],
    generatedAt: "2026-08-19T00:00:00.000Z",
  });

  assert.deepEqual(Object.keys(envelope), [
    "outputVersion",
    "command",
    "generatedAt",
    "apiUrl",
    "data",
  ]);
  assert.equal(envelope.outputVersion, MCPFP_OUTPUT_VERSION);
  assert.equal(MCPFP_OUTPUT_VERSION, 1);

  // Nothing in the envelope's OWN shape may name a credential. `data` is whatever the API returned,
  // and the API never returns a secret (`.claude/rules/mcp-and-security.md`).
  for (const key of Object.keys(envelope)) {
    assert.ok(
      !/token|secret|auth|credential|password/i.test(key),
      `the envelope must not carry a credential-shaped field, found "${key}"`,
    );
  }
});

test("A4 — the config-file schema is strict, so a typo'd key is an error", () => {
  assert.ok(mcpfpConfigFileSchema.safeParse({ url: "http://127.0.0.1:8080" }).success);
  assert.ok(!mcpfpConfigFileSchema.safeParse({ apiUrl: "http://127.0.0.1:8080" }).success);
  assert.ok(!mcpfpConfigFileSchema.safeParse({ timeoutMs: -1 }).success);
});

test("A11 — MCPFP_EXIT matches the exit-code invariant in roadmap/ci/README.md", () => {
  assert.deepEqual(MCPFP_EXIT, { success: 0, assertionFailure: 1, error: 2 });

  const readme = fs.readFileSync(path.join(REPO_ROOT, "roadmap", "ci", "README.md"), "utf8");
  assert.match(readme, /0 pass/);
  assert.match(readme, /1 assertion failure/);
  assert.match(readme, /2 execution\/config error/);
});

test("A11 — exit code 1 is RESERVED: no source file in apps/cli emits it", () => {
  // WP 1.3's `mcpfp assert` is the only thing that may ever return `MCPFP_EXIT.assertionFailure`.
  // Until then a `1` from this CLI would be a lie, so nothing here is allowed to reference it.
  const offenders: string[] = [];
  for (const file of walkTypeScript(path.join(CLI_ROOT, "src"))) {
    // Comments explain WHY the code is reserved; only executable code is scanned for it.
    const source = stripComments(fs.readFileSync(file, "utf8"));
    for (const [index, line] of source.split("\n").entries()) {
      if (line.includes("assertionFailure")) {
        offenders.push(`${path.relative(REPO_ROOT, file)}:${index + 1}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

/** Blank out comments while preserving line numbers, so an offender's line still points at itself. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (match) => " ".repeat(match.length));
}

function walkTypeScript(directory: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...walkTypeScript(full));
    else if (entry.name.endsWith(".ts")) found.push(full);
  }
  return found.sort();
}
