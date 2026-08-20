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
  type SuiteRun,
  type SuiteRunStatus,
} from "@mcp-token-footprint/shared";
import { runCliCapture, startStub, type StubRoutes } from "./harness.js";

// **D-C7 — the exit-code contract** (A11; WP 1.2's A11, narrowed by WP 1.3's A5).
//
// The distinction this file exists to protect: `1` means "an assertion failed", and **only
// `mcpfp assert` may say it**. If a later change makes a failed scan or a 500 exit `1`, a CI
// pipeline stops being able to tell "the gate said no" from "the gate could not run" — so every
// other invocation is still asserted never to return it, and the two `assert` cases at the bottom
// pin both sides of the split.

const temporaryDirectories: string[] = [];

after(() => {
  for (const directory of temporaryDirectories)
    fs.rmSync(directory, { recursive: true, force: true });
});

function makeCwd(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpfp-cli-exit-"));
  temporaryDirectories.push(root);
  return root;
}

test("A11 — 0 on success", async () => {
  const stub = await startStub({ "GET /api/servers": { body: [] } });
  try {
    const result = await runCliCapture(["servers", "--url", stub.url], { cwd: makeCwd() });
    assert.equal(result.exitCode, MCPFP_EXIT.success);
  } finally {
    await stub.close();
  }
});

test("A11 — 0 for the explicitly requested help and version, on stdout", async () => {
  for (const argv of [["help"], ["--help"], ["help", "scan"], ["--version"]]) {
    const result = await runCliCapture(argv, { cwd: makeCwd() });
    assert.equal(result.exitCode, MCPFP_EXIT.success, argv.join(" "));
    assert.ok(result.stdout.length > 0, `${argv.join(" ")} must print to stdout`);
    assert.equal(result.stderr, "");
  }
  const version = await runCliCapture(["--version"], { cwd: makeCwd() });
  assert.equal(version.stdout.trim(), `mcpfp 0.1.0 (output envelope v${MCPFP_OUTPUT_VERSION})`);
});

test("A11 — 2 on an unknown command, an unknown option, and no command at all", async () => {
  const unknownCommand = await runCliCapture(["frobnicate"], { cwd: makeCwd() });
  assert.equal(unknownCommand.exitCode, MCPFP_EXIT.error);
  assert.match(unknownCommand.stderr, /Unknown command "frobnicate"/);
  assert.equal(
    unknownCommand.stdout,
    "",
    "usage for an ERROR goes to stderr, not the payload stream",
  );

  const unknownOption = await runCliCapture(["servers", "--wat"], { cwd: makeCwd() });
  assert.equal(unknownOption.exitCode, MCPFP_EXIT.error);
  assert.equal(unknownOption.stdout, "");

  const nothing = await runCliCapture([], { cwd: makeCwd() });
  assert.equal(nothing.exitCode, MCPFP_EXIT.error);
  assert.match(nothing.stderr, /No command given\./);
});

test("A11 — 2 on a config error, an unreachable API, and a non-2xx response", async () => {
  const badConfig = await runCliCapture(["servers", "--url", "nope"], { cwd: makeCwd() });
  assert.equal(badConfig.exitCode, MCPFP_EXIT.error);

  const stub = await startStub({ "GET /api/servers": { status: 503, body: { error: "down" } } });
  const url = stub.url;
  try {
    const nonOk = await runCliCapture(["servers", "--url", url], { cwd: makeCwd() });
    assert.equal(nonOk.exitCode, MCPFP_EXIT.error);
  } finally {
    await stub.close();
  }

  const unreachable = await runCliCapture(["servers", "--url", url], { cwd: makeCwd() });
  assert.equal(unreachable.exitCode, MCPFP_EXIT.error);
});

test("A11 — 1 is RESERVED: no invocation other than a failed assertion returns it", async () => {
  const stub = await startStub({
    "GET /api/servers": { status: 401, body: { error: "no", code: "authentication_required" } },
    "GET /api/scans": { status: 500, body: { error: "boom" } },
    // WP 2.1 — every terminal status a suite run can reach, plus the failure to start one at all.
    // All of them are checked below for the ONE thing that matters here: none of them is a `1`.
    "POST /api/suites/ste_error/run": { status: 202, body: suiteRunWith("error") },
    "POST /api/suites/ste_capped/run": { status: 202, body: suiteRunWith("capped") },
    "POST /api/suites/ste_stopped/run": { status: 202, body: suiteRunWith("stopped") },
    "POST /api/suites/ste_boom/run": { status: 500, body: { error: "boom" } },
    "GET /api/suite-runs/srn_error": { body: suiteRunWith("error") },
    "GET /api/suite-runs/srn_capped": { body: suiteRunWith("capped") },
    "GET /api/suite-runs/srn_stopped": { body: suiteRunWith("stopped") },
    "GET /api/suite-runs/srn_error/members": { body: [] },
    "GET /api/suite-runs/srn_capped/members": { body: [] },
    "GET /api/suite-runs/srn_stopped/members": { body: [] },
  });
  const url = stub.url;
  try {
    const invocations: string[][] = [
      [],
      ["frobnicate"],
      ["help"],
      ["--version"],
      ["servers", "--url", url],
      ["scans", "--url", url],
      ["servers", "--url", url, "--format", "markdown"],
      ["servers", "--url", url, "--token", "mcpfp_nope"],
      ["config", "show", "--config", "/definitely/not/here.json"],
      ["scan"],
      ["report"],
      // WP 1.3: `assert` with no gate file to find. "The gate could not run" is a 2, never a 1.
      ["assert", "--url", url],
      ["assert", "/definitely/not/here.json", "--url", url],
      // WP 2.1: a suite run that ended badly is "the matrix did not finish", not "a gate said no".
      ["suite", "--url", url],
      ["suite", "run", "--url", url],
      ["suite", "run", "ste_boom", "--url", url],
      ["suite", "run", "ste_error", "--url", url],
      ["suite", "run", "ste_capped", "--url", url],
      ["suite", "run", "ste_stopped", "--url", url],
    ];
    for (const argv of invocations) {
      const result = await runCliCapture(argv, { cwd: makeCwd() });
      assert.notEqual(
        result.exitCode,
        MCPFP_EXIT.assertionFailure,
        `\`mcpfp ${argv.join(" ")}\` returned the RESERVED assertion-failure code`,
      );
      assert.ok([0, 2].includes(result.exitCode), `unexpected exit ${result.exitCode}`);
    }
  } finally {
    await stub.close();
  }
});

test("A11 — 1 is EMITTED for a failed rule, and only for that: the same endpoint's 500 is a 2", async () => {
  // The positive half of the reservation. Two runs of the same command against the same endpoint,
  // differing only in what the API said — one "your gate failed", one "I could not evaluate it".
  const failing: AssertionReport = {
    assertionsVersion: ASSERTIONS_VERSION,
    evaluatedAt: "2026-08-19T12:00:00.000Z",
    subject: {
      scanId: "scn_1",
      serverId: "srv_1",
      serverName: "Everything",
      scannedAt: "2026-08-19T10:00:00.000Z",
      tokenProfile: "generic_o200k",
      countingVersion: 2,
      totalTokens: 4000,
      totalTools: 21,
    },
    baseline: null,
    results: [
      {
        rule: "max-server-tokens",
        status: "fail",
        message: "Server tokens 4,000 exceed budget 3,000 by 1,000.",
        observed: 4000,
        limit: 3000,
      },
    ],
    counts: { total: 1, passed: 0, failed: 1, skipped: 0 },
    passed: false,
  };

  const cwd = makeCwd();
  fs.writeFileSync(
    path.join(cwd, MCPFP_ASSERT_FILE_NAME),
    JSON.stringify({
      version: ASSERTIONS_VERSION,
      target: { server: "Everything" },
      rules: [{ rule: "max-server-tokens", max: 3000 }],
    }),
  );

  const gateSaidNo = await startStub({
    "POST /api/assertions/evaluate": { body: failing },
  });
  try {
    const result = await runCliCapture(["assert", "--url", gateSaidNo.url], { cwd });
    assert.equal(result.exitCode, MCPFP_EXIT.assertionFailure);
  } finally {
    await gateSaidNo.close();
  }

  const gateBroke = await startStub({
    "POST /api/assertions/evaluate": { status: 500, body: { error: "boom" } },
  });
  try {
    const result = await runCliCapture(["assert", "--url", gateBroke.url], { cwd });
    assert.equal(
      result.exitCode,
      MCPFP_EXIT.error,
      "a 500 from the evaluate endpoint is 'could not run' (2), not 'said no' (1)",
    );
  } finally {
    await gateBroke.close();
  }
});

// **D-C11 — `mcpfp suite run`'s exit-code table** (WP 2.1, A3).
//
// The whole point of the command in CI is that a build step can believe its exit code, so the table
// is pinned in full rather than by example: only `completed` is a `0`, every other terminal status
// is a `2`, running out of time while the matrix is still going is a `2`, and `--no-wait` — which
// deliberately learns nothing about the outcome — is a `0` because starting the run is all it
// claimed to do. None of them is a `1`; that is `mcpfp assert`'s alone (asserted above).

/** A terminal suite run whose id encodes its status, so one stub can serve the whole table. */
function suiteRunWith(status: SuiteRunStatus): SuiteRun {
  return {
    id: `srn_${status}`,
    suiteId: `ste_${status}`,
    status,
    source: "suite",
    configSnapshot: { repetitions: 1, maxConcurrency: 1 },
    startedAt: "2026-08-20T09:00:00.000Z",
    endedAt: "2026-08-20T09:01:00.000Z",
    ratingState: "rated",
    aggregates: {
      cellsTotal: 2,
      cellsCompleted: 2,
      meanGrade: 0.5,
      gradeStdDev: 0,
      passRateAt05: 1,
      totalTokens: 100,
      execCostUsd: 0.01,
      judgeCostUsd: 0,
    },
  };
}

/** A suite run that never settles: the wait budget is the only thing that can end the loop. */
const NEVER_SETTLES: SuiteRun = {
  ...suiteRunWith("completed"),
  id: "srn_forever",
  suiteId: "ste_forever",
  status: "running",
  ratingState: "pending",
};

test("A3 — the D-C11 exit-code table: only `completed` is 0, and nothing here is ever 1", async () => {
  const routes: StubRoutes = {
    "GET /api/suite-runs/srn_forever": { body: NEVER_SETTLES },
    "GET /api/suite-runs/srn_forever/members": { body: [] },
    "POST /api/suites/ste_forever/run": { status: 202, body: NEVER_SETTLES },
  };
  for (const status of ["completed", "capped", "stopped", "error"] as const) {
    const run = suiteRunWith(status);
    routes[`POST /api/suites/${run.suiteId}/run`] = { status: 202, body: run };
    routes[`GET /api/suite-runs/${run.id}`] = { body: run };
    routes[`GET /api/suite-runs/${run.id}/members`] = { body: [] };
  }

  const stub = await startStub(routes);
  try {
    const cases: [argv: string[], expected: number, why: string][] = [
      [["suite", "run", "ste_completed"], MCPFP_EXIT.success, "completed"],
      [["suite", "run", "ste_error"], MCPFP_EXIT.error, "error"],
      [["suite", "run", "ste_capped"], MCPFP_EXIT.error, "capped (the cost cap soft-stopped it)"],
      [["suite", "run", "ste_stopped"], MCPFP_EXIT.error, "stopped (an operator halted it)"],
      // One second of budget against a run that is still `running`: the timeout branch.
      [["suite", "run", "ste_forever", "--wait", "1"], MCPFP_EXIT.error, "budget exhausted"],
      // `--no-wait` never learns the outcome, and says so by exiting 0 having started the matrix.
      [["suite", "run", "ste_forever", "--no-wait"], MCPFP_EXIT.success, "--no-wait"],
    ];

    for (const [argv, expected, why] of cases) {
      const result = await runCliCapture([...argv, "--url", stub.url], { cwd: makeCwd() });
      assert.equal(result.exitCode, expected, `${why}: ${result.stderr}`);
      assert.notEqual(
        result.exitCode,
        MCPFP_EXIT.assertionFailure,
        `\`mcpfp ${argv.join(" ")}\` returned the RESERVED assertion-failure code`,
      );
    }

    // The two failure sentences an operator reads in a build log.
    const capped = await runCliCapture(["suite", "run", "ste_capped", "--url", stub.url], {
      cwd: makeCwd(),
    });
    assert.match(capped.stderr, /Suite run srn_capped ended capped\./);

    const timedOut = await runCliCapture(
      ["suite", "run", "ste_forever", "--wait", "1", "--url", stub.url],
      { cwd: makeCwd() },
    );
    assert.match(
      timedOut.stderr,
      /Suite run srn_forever was still running when the 1s wait budget ran out/,
    );
  } finally {
    await stub.close();
  }
});
