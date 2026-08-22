// ==================================================================================================
// No package may build `packages/shared` concurrently with another package's tests.
// ==================================================================================================
//
// THE DEFECT THIS LOCKS OUT, measured 2026-08-22. `pnpm -r --if-present test` runs workspace packages
// CONCURRENTLY. Four of them (`apps/api`, `apps/web`, `apps/cli`, `packages/illustrations`) each need
// `packages/shared/dist` fresh, and each opened its `test` script with a bare
// `pnpm --filter @mcp-token-footprint/shared build`. So up to four `tsc` processes wrote the SAME
// `dist/` directory while other packages' tests were already importing out of it.
//
// Observed in one instrumented `pnpm test` run: THREE concurrent `tsc` processes, and
// `packages/shared/dist/index.js` rewritten TWICE — at startup and again 33 s in, with api and web
// tests already executing. A module read while it is being rewritten is truncated or briefly absent,
// which is why the suite failed on a DIFFERENT file almost every run, always passed in isolation, and
// produced bare 5000 ms vitest timeouts plus one 4-second perf outlier that no amount of CPU load
// could reproduce on its own. (CPU contention and memory pressure were both tested and REFUTED: the
// web suite passes 4319/4319 at load average 300, and this machine swaps zero bytes.)
//
// The earlier "packages/illustrations reads a stale dist" incident was the same defect from the other
// side. The fix then added a FOURTH inline build, which cured the staleness and worsened the race.
//
// The fix is `scripts/build-shared-once.mjs`: freshness check, then an atomic `mkdir` lock, so the
// build happens and happens exactly once. This test keeps every call site pointed at it — a new
// package that copies the old prefix goes red here rather than making the suite flaky for everyone.

import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const GUARD = "scripts/build-shared-once.mjs";

/** Every workspace package.json, found the way pnpm-workspace.yaml globs them. */
function workspacePackages(): Array<{ name: string; dir: string; scripts: Record<string, string> }> {
  const found: Array<{ name: string; dir: string; scripts: Record<string, string> }> = [];
  for (const group of ["apps", "packages"]) {
    const root = path.join(REPO_ROOT, group);
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifest = path.join(root, entry.name, "package.json");
      if (!existsSync(manifest)) continue;
      const parsed = JSON.parse(readFileSync(manifest, "utf8")) as {
        name?: string;
        scripts?: Record<string, string>;
      };
      found.push({
        name: parsed.name ?? `${group}/${entry.name}`,
        dir: `${group}/${entry.name}`,
        scripts: parsed.scripts ?? {},
      });
    }
  }
  return found;
}

test("the build-once guard script exists and is what the call sites point at", () => {
  assert.ok(
    existsSync(path.join(REPO_ROOT, GUARD)),
    `${GUARD} is the single definition of "build shared, at most once" — every test script depends on it`,
  );
});

test("no package script builds packages/shared directly — that is the race", () => {
  const packages = workspacePackages();
  // Not vacuous: if the discovery ever stops finding the workspace, this fails instead of going quiet.
  assert.ok(packages.length >= 4, `expected to find the workspace packages, saw ${packages.length}`);

  const offenders: string[] = [];
  for (const pkg of packages) {
    for (const [scriptName, body] of Object.entries(pkg.scripts)) {
      // `packages/shared` building ITSELF is the one legitimate case.
      if (pkg.name === "@mcp-token-footprint/shared") continue;
      if (/--filter\s+@mcp-token-footprint\/shared\s+build/.test(body)) {
        offenders.push(`${pkg.dir} → "${scriptName}": ${body}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `these scripts build packages/shared directly; call \`node ../../${GUARD}\` instead so concurrent callers serialize`,
  );
});

test("every package whose tests import shared goes through the guard", () => {
  const needGuard = [
    "apps/api",
    "apps/web",
    "apps/cli",
    "packages/illustrations",
  ];
  const byDir = new Map(workspacePackages().map((pkg) => [pkg.dir, pkg]));
  for (const dir of needGuard) {
    const pkg = byDir.get(dir);
    assert.ok(pkg, `${dir} is expected to exist`);
    const script = pkg.scripts.test;
    assert.ok(script, `${dir} has a test script`);
    assert.match(
      script,
      /build-shared-once\.mjs/,
      `${dir}'s test script must build shared through the guard, not directly`,
    );
  }
});
