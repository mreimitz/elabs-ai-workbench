import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import {
  ASSERTIONS_VERSION,
  type AssertionReport,
  MCPFP_ASSERT_FILE_NAME,
  MCPFP_EXIT,
  MCPFP_OUTPUT_VERSION,
} from "@mcp-token-footprint/shared";
import { runCliCapture, startStub, type StubRoutes, VALID_TOKEN } from "./harness.js";

// `mcpfp assert`, end to end against a `node:http` stub of the workbench API (roadmap/ci/ WP 1.3 —
// A5, A6, A7, A8, A9). The API evaluates; the CLI renders and picks an exit code. So everything here
// is about the CLI's half of that split: which file it found, what it sent, what it printed, on
// which stream, and what it exited with.

const temporaryDirectories: string[] = [];

after(() => {
  for (const directory of temporaryDirectories)
    fs.rmSync(directory, { recursive: true, force: true });
});

/** An empty cwd, so no stray `mcpfp.assert.json` above the repo can influence a test. */
function makeCwd(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpfp-cli-assert-"));
  temporaryDirectories.push(root);
  return root;
}

const DOCUMENT = {
  version: ASSERTIONS_VERSION,
  target: { server: "Everything" },
  baseline: "previous",
  rules: [
    { rule: "max-server-tokens", max: 3000 },
    { rule: "no-new-tools" },
  ],
};

/** Write a gate file into `cwd` (or a subdirectory of it) and return the directory to run from. */
function writeDocument(cwd: string, document: unknown = DOCUMENT, name = MCPFP_ASSERT_FILE_NAME) {
  fs.writeFileSync(path.join(cwd, name), JSON.stringify(document, null, 2));
  return cwd;
}

const SUBJECT = {
  scanId: "scn_new",
  serverId: "srv_1",
  serverName: "Everything",
  scannedAt: "2026-08-19T10:00:00.000Z",
  tokenProfile: "generic_o200k" as const,
  countingVersion: 2,
  totalTokens: 2224,
  totalTools: 21,
};

const BASELINE_SCAN = { ...SUBJECT, scanId: "scn_old", scannedAt: "2026-08-18T10:00:00.000Z" };

/** A report the API might have returned. Every field the CLI reads comes from here, never from a rule. */
function report(overrides: Partial<AssertionReport> = {}): AssertionReport {
  const results = overrides.results ?? [
    {
      rule: "max-server-tokens" as const,
      status: "pass" as const,
      message: "Server tokens 2,224 within budget 3,000.",
      observed: 2224,
      limit: 3000,
    },
    {
      rule: "no-new-tools" as const,
      status: "pass" as const,
      message: "No tools were added against the baseline.",
    },
  ];
  const failed = results.filter((result) => result.status === "fail").length;
  const skipped = results.filter((result) => result.status === "skipped").length;
  return {
    assertionsVersion: ASSERTIONS_VERSION,
    evaluatedAt: "2026-08-19T12:00:00.000Z",
    subject: SUBJECT,
    baseline: { requested: "previous", scan: BASELINE_SCAN },
    results,
    counts: {
      total: results.length,
      passed: results.length - failed - skipped,
      failed,
      skipped,
    },
    passed: failed === 0,
    ...overrides,
  };
}

function routesFor(response: unknown, status = 200): StubRoutes {
  return { "POST /api/assertions/evaluate": { status, body: response } };
}

async function withStub<T>(routes: StubRoutes, body: (stub: Awaited<ReturnType<typeof startStub>>) => Promise<T>) {
  const stub = await startStub(routes);
  try {
    return await body(stub);
  } finally {
    await stub.close();
  }
}

// ── A5 (D-C7) — the exit codes ──────────────────────────────────────────────────────────────────

test("A5 — a failing rule exits 1, and everything passing exits 0", async () => {
  await withStub(routesFor(report()), async (stub) => {
    const cwd = writeDocument(makeCwd());
    const green = await runCliCapture(["assert", "--url", stub.url], { cwd });
    assert.equal(green.exitCode, MCPFP_EXIT.success);
    assert.match(green.stdout, /2 passed · 0 failed · 0 skipped/);
  });

  const failing = report({
    results: [
      {
        rule: "max-server-tokens",
        status: "fail",
        message: "Server tokens 2,224 exceed budget 1,000 by 1,224.",
        observed: 2224,
        limit: 1000,
      },
      { rule: "no-new-tools", status: "pass", message: "No tools were added against the baseline." },
    ],
  });
  await withStub(routesFor(failing), async (stub) => {
    const cwd = writeDocument(makeCwd());
    const red = await runCliCapture(["assert", "--url", stub.url], { cwd });
    assert.equal(red.exitCode, MCPFP_EXIT.assertionFailure);
    // The verdict is on stderr, so the payload stream stays clean for a redirect.
    assert.match(red.stderr, /Assertions failed: 1 of 2\./);
    assert.match(red.stdout, /FAIL {2}max-server-tokens/);
    assert.match(red.stdout, /1 passed · 1 failed · 0 skipped/);
  });
});

test("A5 (D-C8 case 1) — a SKIPPED rule warns loudly on stderr and still exits 0", async () => {
  const skipped = report({
    baseline: null,
    results: [
      {
        rule: "max-server-tokens",
        status: "pass",
        message: "Server tokens 2,224 within budget 3,000.",
      },
      {
        rule: "no-new-tools",
        status: "skipped",
        message: "no-new-tools could not be evaluated without a baseline.",
        skipReason: "No earlier completed scan of \"Everything\" — scn_new is the first one.",
      },
    ],
  });
  await withStub(routesFor(skipped), async (stub) => {
    const cwd = writeDocument(makeCwd());
    const result = await runCliCapture(["assert", "--url", stub.url], { cwd });
    // A first-ever run must not fail a pipeline for having no history…
    assert.equal(result.exitCode, MCPFP_EXIT.success);
    // …but it must not be silent about it either.
    assert.match(result.stderr, /Warning: no-new-tools was skipped — No earlier completed scan/);
    assert.match(result.stdout, /SKIP {2}no-new-tools/);
    assert.match(result.stdout, /1 passed · 0 failed · 1 skipped/);

    // `--quiet` is "be less chatty", not "hide that a rule did not run".
    const quiet = await runCliCapture(["assert", "--url", stub.url, "--quiet"], { cwd });
    assert.equal(quiet.exitCode, MCPFP_EXIT.success);
    assert.match(quiet.stderr, /was skipped/);
  });
});

test("A5 — a missing, malformed or version-mismatched file exits 2 without a request", async () => {
  await withStub(routesFor(report()), async (stub) => {
    const missing = await runCliCapture(["assert", "--url", stub.url], { cwd: makeCwd() });
    assert.equal(missing.exitCode, MCPFP_EXIT.error);
    assert.match(missing.stderr, new RegExp(`No ${MCPFP_ASSERT_FILE_NAME} found`));

    const named = await runCliCapture(["assert", "gate.json", "--url", stub.url], {
      cwd: makeCwd(),
    });
    assert.equal(named.exitCode, MCPFP_EXIT.error);
    assert.match(named.stderr, /No assertions file at .*gate\.json/);

    const badJson = makeCwd();
    fs.writeFileSync(path.join(badJson, MCPFP_ASSERT_FILE_NAME), "{ nope");
    const malformed = await runCliCapture(["assert", "--url", stub.url], { cwd: badJson });
    assert.equal(malformed.exitCode, MCPFP_EXIT.error);
    assert.match(malformed.stderr, /is not valid JSON/);

    // `.strict()` — a typo'd key is a named field error, not a rule that quietly vanished.
    const typo = writeDocument(makeCwd(), { ...DOCUMENT, baselines: "previous" });
    const strict = await runCliCapture(["assert", "--url", stub.url], { cwd: typo });
    assert.equal(strict.exitCode, MCPFP_EXIT.error);
    assert.match(strict.stderr, /is not a valid assertions document/);
    assert.match(strict.stderr, /baselines/);

    const future = writeDocument(makeCwd(), { ...DOCUMENT, version: ASSERTIONS_VERSION + 1 });
    const mismatch = await runCliCapture(["assert", "--url", stub.url], { cwd: future });
    assert.equal(mismatch.exitCode, MCPFP_EXIT.error);
    assert.match(mismatch.stderr, /written for assertions v2; this workbench speaks v1/);

    // Every one of those failed BEFORE the network — a broken gate never reaches the API.
    assert.deepEqual(stub.requests, []);
  });
});

test("A5 — an unreachable API and a non-2xx are BOTH 2, never 1", async () => {
  const stub = await startStub(routesFor({ error: "boom" }, 500));
  const url = stub.url;
  const cwd = writeDocument(makeCwd());
  try {
    const serverError = await runCliCapture(["assert", "--url", url], { cwd });
    assert.equal(serverError.exitCode, MCPFP_EXIT.error);
    assert.equal(serverError.stdout, "", "an error never writes to the payload stream");
  } finally {
    await stub.close();
  }

  const unreachable = await runCliCapture(["assert", "--url", url], { cwd });
  assert.equal(unreachable.exitCode, MCPFP_EXIT.error);
  assert.match(unreachable.stderr, /No workbench API at .* is it running\?/);
});

test("A5 (D-C8 cases 2 and 3) — an API 400 is a 2 carrying the API's own sentence", async () => {
  const message =
    "Cannot measure a token delta: baseline scan scn_old and subject scan scn_new are not on the same scale.";
  await withStub(routesFor({ error: message }, 400), async (stub) => {
    const cwd = writeDocument(makeCwd());
    const result = await runCliCapture(["assert", "--url", stub.url], { cwd });
    assert.equal(
      result.exitCode,
      MCPFP_EXIT.error,
      "the gate could NOT RUN — that is a 2, not the 1 that means it said no",
    );
    assert.match(result.stderr, /not on the same scale/);
  });
});

test("A5 — conflicting and misplaced flags are usage errors (2)", async () => {
  await withStub(routesFor(report()), async (stub) => {
    const cwd = writeDocument(makeCwd());
    const both = await runCliCapture(
      ["assert", "--url", stub.url, "--server", "Everything", "--scan", "scn_1"],
      { cwd },
    );
    assert.equal(both.exitCode, MCPFP_EXIT.error);
    assert.match(both.stderr, /name two different targets/);

    // The WP 1.2 guard is extended, not deleted: `--server` still means nothing on `scan`.
    for (const argv of [
      ["scan", "Everything", "--server", "Everything"],
      ["servers", "--scan", "scn_1"],
      ["scans", "--baseline", "previous"],
      ["report", "fleet", "--file", "x.json"],
    ]) {
      const result = await runCliCapture([...argv, "--url", stub.url], { cwd });
      assert.equal(result.exitCode, MCPFP_EXIT.error, argv.join(" "));
      assert.match(result.stderr, /only applies to/);
    }

    assert.deepEqual(stub.requests, [], "a usage error never opens a socket");
  });
});

// ── A6 (D-C6) — stdout is the payload, stderr is the narration ──────────────────────────────────

test("A6 — --format json is a byte-exact parseable envelope with the report verbatim in data", async () => {
  await withStub(routesFor(report()), async (stub) => {
    const cwd = writeDocument(makeCwd());
    const result = await runCliCapture(["assert", "--url", stub.url, "--format", "json"], { cwd });
    assert.equal(result.exitCode, MCPFP_EXIT.success);

    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.outputVersion, MCPFP_OUTPUT_VERSION);
    assert.equal(MCPFP_OUTPUT_VERSION, 1, "assert is additive — it does not bump the envelope");
    assert.equal(envelope.command, "assert");
    // Verbatim: the CLI re-shapes nothing.
    assert.deepEqual(envelope.data, report());

    // The narration went to the other stream.
    assert.match(result.stderr, /Evaluating .* against http/);

    // …and `--quiet` empties stderr entirely without touching the payload. (`generatedAt` is the
    // instant the CLI produced the envelope, so it legitimately differs between two invocations.)
    const quiet = await runCliCapture(["assert", "--url", stub.url, "--format", "json", "--quiet"], {
      cwd,
    });
    assert.equal(quiet.stderr, "");
    assert.deepEqual(withoutTimestamp(quiet.stdout), withoutTimestamp(result.stdout));
  });
});

/** The envelope minus the one field that is a clock reading rather than content. */
function withoutTimestamp(json: string): Record<string, unknown> {
  const { generatedAt: _generatedAt, ...rest } = JSON.parse(json) as Record<string, unknown>;
  return rest;
}

test("A6 — --output writes the same bytes to a file and leaves stdout empty", async () => {
  await withStub(routesFor(report()), async (stub) => {
    const cwd = writeDocument(makeCwd());
    const target = path.join(makeCwd(), "nested", "gate.json");
    const direct = await runCliCapture(["assert", "--url", stub.url, "--format", "json"], { cwd });
    const written = await runCliCapture(
      ["assert", "--url", stub.url, "--format", "json", "--output", target],
      { cwd },
    );

    assert.equal(written.exitCode, MCPFP_EXIT.success);
    assert.equal(written.stdout, "", "--output means stdout carries nothing");
    const file = fs.readFileSync(target, "utf8");
    // Byte-for-byte the same document as the redirect would have produced, save the clock reading.
    assert.deepEqual(withoutTimestamp(file), withoutTimestamp(direct.stdout));
    assert.deepEqual(JSON.parse(file).data, report());
    assert.match(written.stderr, /Wrote \d+ bytes to/);
  });
});

// ── A7 — the client invariant: the CLI renders a verdict, it does not compute one ────────────────

test("A7 — the CLI trusts the API's verdict rather than recomputing it from the results", async () => {
  // A deliberately INCONSISTENT report: every result says "pass", but the API says the gate failed.
  // A CLI that re-derived the verdict from `results` would exit 0 here. The right answer is 1 — the
  // API evaluates, the CLI renders (roadmap/ci/README.md's client invariant).
  const contradictory = {
    ...report(),
    counts: { total: 2, passed: 1, failed: 1, skipped: 0 },
    passed: false,
  };
  await withStub(routesFor(contradictory), async (stub) => {
    const cwd = writeDocument(makeCwd());
    const result = await runCliCapture(["assert", "--url", stub.url], { cwd });
    assert.equal(result.exitCode, MCPFP_EXIT.assertionFailure);
    assert.match(result.stderr, /Assertions failed: 1 of 2\./);
    // The rendered counts are the API's, not a recount of the rows above them.
    assert.match(result.stdout, /1 passed · 1 failed · 0 skipped/);
  });
});

test("A7 — the document and the flag overrides are posted; the API resolves everything", async () => {
  await withStub(routesFor(report()), async (stub) => {
    const cwd = writeDocument(makeCwd());
    await runCliCapture(
      ["assert", "--url", stub.url, "--scan", "scn_override", "--baseline", "scn_base"],
      { cwd },
    );

    assert.equal(stub.requests.length, 1);
    const sent = JSON.parse(stub.requests[0]?.body ?? "{}");
    assert.deepEqual(sent.document, DOCUMENT, "the document goes over the wire unchanged");
    assert.deepEqual(sent.target, { scan: "scn_override" });
    assert.equal(sent.baseline, "scn_base");
  });

  // With no overrides, nothing extra is sent — the API sees the document's own target.
  await withStub(routesFor(report()), async (stub) => {
    const cwd = writeDocument(makeCwd());
    await runCliCapture(["assert", "--url", stub.url], { cwd });
    const sent = JSON.parse(stub.requests[0]?.body ?? "{}");
    assert.deepEqual(Object.keys(sent), ["document"]);
  });
});

test("A7 — the gate file is found by walking UP from the cwd, and a named path wins", async () => {
  await withStub(routesFor(report()), async (stub) => {
    const root = writeDocument(makeCwd());
    const nested = path.join(root, "packages", "thing");
    fs.mkdirSync(nested, { recursive: true });

    const found = await runCliCapture(["assert", "--url", stub.url], { cwd: nested });
    assert.equal(found.exitCode, MCPFP_EXIT.success);
    assert.match(found.stderr, new RegExp(`Evaluating .*${MCPFP_ASSERT_FILE_NAME}`));

    // A named file is used verbatim, relative to the cwd.
    fs.writeFileSync(
      path.join(nested, "other.json"),
      JSON.stringify({ ...DOCUMENT, target: { scan: "scn_named" } }),
    );
    const explicit = await runCliCapture(["assert", "other.json", "--url", stub.url], {
      cwd: nested,
    });
    assert.equal(explicit.exitCode, MCPFP_EXIT.success);
    const sent = JSON.parse(stub.requests.at(-1)?.body ?? "{}");
    assert.deepEqual(sent.document.target, { scan: "scn_named" });
  });
});

// ── A8 (D-C9) — assert never runs a scan ────────────────────────────────────────────────────────

test("A8 — assert issues exactly one POST to the evaluate endpoint and never scans", async () => {
  await withStub(routesFor(report()), async (stub) => {
    const cwd = writeDocument(makeCwd());
    await runCliCapture(["assert", "--url", stub.url, "--server", "Everything"], { cwd });

    assert.deepEqual(
      stub.requests.map((request) => `${request.method} ${request.url}`),
      ["POST /api/assertions/evaluate"],
    );
    for (const request of stub.requests) {
      assert.ok(
        !/\/scan$/.test(request.url),
        `assert must not run a scan (D-C9), saw ${request.method} ${request.url}`,
      );
    }
  });
});

// ── A9 — the token appears in no stream, no file, and no JSON ───────────────────────────────────

test("A9 — the token never reaches stdout, stderr or the output file — even echoed back in an error", async () => {
  // The API echoing the credential into its own error body is the case a per-call-site check misses.
  const echo = { error: `token ${VALID_TOKEN} was rejected`, code: "invalid_token" };
  const stub = await startStub({
    "POST /api/assertions/evaluate": (request) =>
      request.authorization === `Bearer ${VALID_TOKEN}`
        ? { status: 500, body: echo }
        : { status: 200, body: report() },
  });
  try {
    const cwd = writeDocument(makeCwd());
    const failed = await runCliCapture(["assert", "--url", stub.url, "--token", VALID_TOKEN], {
      cwd,
    });
    assert.equal(failed.exitCode, MCPFP_EXIT.error);
    assert.ok(!failed.stderr.includes(VALID_TOKEN), "the echoed token must be masked on stderr");
    assert.ok(!failed.stdout.includes(VALID_TOKEN));
    // It was masked, not dropped — the operator still sees that a token was involved.
    assert.match(failed.stderr, /mcpfp_A1b2C3d4…/);

    // The header DID carry it — the redaction is on the way out, not a failure to authenticate.
    assert.equal(stub.requests[0]?.authorization, `Bearer ${VALID_TOKEN}`);
  } finally {
    await stub.close();
  }

  await withStub(routesFor(report()), async (ok) => {
    const cwd = writeDocument(makeCwd());
    const target = path.join(makeCwd(), "gate.json");
    const green = await runCliCapture(
      [
        "assert",
        "--url",
        ok.url,
        "--token",
        VALID_TOKEN,
        "--format",
        "json",
        "--output",
        target,
      ],
      { cwd },
    );
    assert.equal(green.exitCode, MCPFP_EXIT.success);
    const file = fs.readFileSync(target, "utf8");
    assert.ok(!file.includes(VALID_TOKEN), "the envelope carries no credential");
    assert.ok(!green.stderr.includes(VALID_TOKEN));
    // …and the envelope has no credential-shaped field at any depth of its own.
    assert.deepEqual(Object.keys(JSON.parse(file)), [
      "outputVersion",
      "command",
      "generatedAt",
      "apiUrl",
      "data",
    ]);
  });
});

// ── A11 — help ──────────────────────────────────────────────────────────────────────────────────

test("A11 — `mcpfp help assert` lists every rule kind, generated from the shared meta", async () => {
  const result = await runCliCapture(["help", "assert"], { cwd: makeCwd() });
  assert.equal(result.exitCode, MCPFP_EXIT.success);
  for (const kind of [
    "max-server-tokens",
    "max-tool-tokens",
    "max-tool-count",
    "no-new-tools",
    "no-removed-tools",
    "max-scan-delta",
  ]) {
    assert.match(result.stdout, new RegExp(kind), kind);
  }
  assert.match(result.stdout, /1 {2}at least one rule failed/);

  // The top-level usage advertises it and no longer calls it unbuilt.
  const usage = await runCliCapture(["help"], { cwd: makeCwd() });
  assert.match(usage.stdout, /assert \[file\]/);
  assert.ok(!/assert \(WP 1\.3\)/.test(usage.stdout));
});

test("A11 — assert refuses --format markdown, naming what it does support", async () => {
  const result = await runCliCapture(["assert", "--format", "markdown"], { cwd: makeCwd() });
  assert.equal(result.exitCode, MCPFP_EXIT.error);
  assert.match(result.stderr, /does not support --format markdown/);
  assert.match(result.stderr, /human, json/);
});
