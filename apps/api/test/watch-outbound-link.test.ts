// Observability — the ONE outbound-link vocabulary (RM-17 Phase 6, AM-OB13).
//
// Proves (acceptance #2 + #3):
//   2. An outbound link is ABSOLUTE when a base URL is configured and falls back to today's bare
//      relative path when it is not — never a fabricated origin. Both states asserted directly.
//   3. Every link a watch payload or a notification carries is built through THIS module's `appPath`,
//      pinned by a SOURCE WALK over `apps/api/src/watch/**` that fails on a link-shaped literal
//      anywhere but here — so a second link-building path cannot quietly reappear.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { appPath, outboundUrl } from "../src/watch/outbound-link.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WATCH_DIR = path.join(HERE, "..", "src", "watch");
const HELPER = "outbound-link.ts";

// ── Acceptance #2 — absolute when configured, relative when not ──────────────────────────────────

test("outboundUrl returns the bare app path when no base URL is configured", () => {
  // The honest fallback: a receiver gets exactly what it got before AM-OB13, not a guessed origin.
  assert.equal(outboundUrl("/testing/runs/run-1", undefined), "/testing/runs/run-1");
  assert.equal(
    outboundUrl(appPath.runReport("run-1"), undefined),
    "/api/reports/run/run-1/markdown",
  );
});

test("outboundUrl makes the app path absolute when a base URL IS configured", () => {
  assert.equal(
    outboundUrl("/testing/runs/run-1", "http://localhost:8081"),
    "http://localhost:8081/testing/runs/run-1",
  );
  assert.equal(
    outboundUrl(appPath.suiteRun("sr-9"), "https://bench.example.test"),
    "https://bench.example.test/testing/suite-runs/sr-9",
  );
});

test("outboundUrl never doubles a slash, and PRESERVES a base URL's own path prefix", () => {
  // `new URL(path, base)` would DISCARD `/bench` here — which silently breaks a sub-path
  // deployment — so the join is deliberately a concatenation.
  assert.equal(outboundUrl("/testing/runs/r", "http://h:8081/"), "http://h:8081/testing/runs/r");
  assert.equal(outboundUrl("/testing/runs/r", "http://h:8081///"), "http://h:8081/testing/runs/r");
  assert.equal(outboundUrl("/testing/runs/r", "http://h/bench"), "http://h/bench/testing/runs/r");
});

test("a base URL that is not an absolute http(s) URL resolves to UNSET, never a fabricated origin", async () => {
  // The rejection happens in `config/env.ts`'s `readBaseUrl`; assert it on the source's own
  // behaviour by re-importing the module under a mutated env (`config` is built at module load,
  // so a cache-busting query re-evaluates it per case).
  for (const value of ["not-a-url", "ftp://host/x", "  ", "example.com"]) {
    const previous = process.env.APP_BASE_URL;
    process.env.APP_BASE_URL = value;
    try {
      const mod = (await import(
        `../src/config/env.js?probe=${encodeURIComponent(value)}`
      )) as typeof import("../src/config/env.js");
      assert.equal(mod.config.appBaseUrl, undefined, `"${value}" must resolve to unset`);
    } finally {
      // Restored as blank rather than deleted: every reader treats blank as absent (`readBaseUrl`
      // trims, `classifyEnvVar` trims), and Biome forbids the `delete` form on `process.env`.
      process.env.APP_BASE_URL = previous ?? "";
    }
  }
});

test("a well-formed base URL IS accepted, so the rejection test above is not vacuous", async () => {
  const previous = process.env.APP_BASE_URL;
  process.env.APP_BASE_URL = "https://bench.example.test/";
  try {
    const mod = (await import(
      "../src/config/env.js?probe=valid"
    )) as typeof import("../src/config/env.js");
    // Trailing slash normalized away at read time so the joiner can never produce `//`.
    assert.equal(mod.config.appBaseUrl, "https://bench.example.test");
  } finally {
    process.env.APP_BASE_URL = previous ?? "";
  }
});

// ── Acceptance #3 — the source walk: ONE link-building path ──────────────────────────────────────

/**
 * A link-shaped string literal: an app route (`"/testing/..."`) or an API report path
 * (`"/api/reports/..."`), quoted or inside a template literal. Anything matching this OUTSIDE the
 * helper is a second definition of where a thing lives — the exact drift AM-OB13 exists to remove.
 */
const LINK_LITERAL = /["'`](\/testing\/[^"'`]*|\/api\/reports\/[^"'`]*)["'`]/;

test("no watch module builds an app link inline — the vocabulary lives in ONE file", () => {
  const offenders: string[] = [];
  for (const name of fs.readdirSync(WATCH_DIR)) {
    if (!name.endsWith(".ts") || name === HELPER) continue;
    const source = fs.readFileSync(path.join(WATCH_DIR, name), "utf8");
    for (const line of source.split("\n")) {
      // Comments are prose ABOUT the paths, not a second builder — the doc blocks name the routes
      // on purpose so a reader can see what the vocabulary covers.
      const code = line.trimStart();
      if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) continue;
      if (LINK_LITERAL.test(line)) offenders.push(`${name}: ${line.trim()}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `These build an app link inline instead of calling \`appPath\` from watch/${HELPER}:\n${offenders.join("\n")}`,
  );
});

test("the helper itself is the only declaration of each path", () => {
  const source = fs.readFileSync(path.join(WATCH_DIR, HELPER), "utf8");
  for (const fragment of [
    "/testing/runs/",
    "/testing/suite-runs/",
    "/testing/observability/rules",
    "/api/reports/run/",
    "/api/reports/suite-run/",
  ]) {
    assert.ok(source.includes(fragment), `${HELPER} must declare ${fragment}`);
  }
  // And the vocabulary answers what the tests above assert it answers.
  assert.equal(appPath.run("r1"), "/testing/runs/r1");
  assert.equal(appPath.suiteRun("s1"), "/testing/suite-runs/s1");
  assert.equal(appPath.watchRules(), "/testing/observability/rules");
  assert.equal(appPath.runReport("r1"), "/api/reports/run/r1/markdown");
  assert.equal(appPath.suiteRunReport("s1"), "/api/reports/suite-run/s1/markdown");
});
