import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import {
  API_TOKEN_SCOPE_FORBIDDEN_ERROR_CODE,
  MCPFP_OUTPUT_VERSION,
  MCPFP_SUITE_RUN_MEMBER_ROWS,
  type RunStatus,
  type Suite,
  type SuiteAggregates,
  type SuiteRun,
  type SuiteRunMember,
} from "@mcp-token-footprint/shared";
import { runCliCapture, startStub, type StubRoutes, VALID_TOKEN } from "./harness.js";

// `mcpfp suite run`, end to end against a `node:http` stub of the workbench API (roadmap/ci/ WP 2.1
// — A1, A2, A4, A5, A6, A8). No real workbench, no provider, no database: the matrix runs in the
// API, so a stub that speaks the same four routes is a complete substitute for it.
//
// **These tests really sleep.** The poll interval is the shared constant (5 s) and D-C11 chose a
// dependency-free `setTimeout` over a clock seam, so a case that needs three polls costs ten
// seconds of wall time. Every case below therefore uses the FEWEST polls that still proves its
// property, and only the happy path and the rating wait poll more than once.

const temporaryDirectories: string[] = [];

after(() => {
  for (const directory of temporaryDirectories)
    fs.rmSync(directory, { recursive: true, force: true });
});

/** An empty cwd, so no stray `mcpfp.config.json` above the repo can influence a test. */
function makeCwd(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpfp-cli-suite-"));
  temporaryDirectories.push(root);
  return root;
}

// ── Fixtures ─────────────────────────────────────────────────────────────────────────────────────

const SUITES: Suite[] = [
  suite("ste_nightly", "Nightly"),
  suite("ste_twin_a", "Twin"),
  suite("ste_twin_b", "Twin"),
];

function suite(id: string, name: string): Suite {
  return {
    id,
    name,
    config: { repetitions: 1, maxConcurrency: 2 },
    testIds: ["tst_1", "tst_2"],
    scenarioIds: ["scen_1"],
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:00:00.000Z",
  };
}

const AGGREGATES: SuiteAggregates = {
  cellsTotal: 4,
  cellsCompleted: 4,
  meanGrade: 0.82,
  gradeStdDev: 0.11,
  passRateAt05: 0.75,
  totalTokens: 41_200,
  execCostUsd: 1.02,
  judgeCostUsd: 0.12,
};

function suiteRun(overrides: Partial<SuiteRun> = {}): SuiteRun {
  return {
    id: "srn_1",
    suiteId: "ste_nightly",
    status: "completed",
    source: "suite",
    configSnapshot: { repetitions: 1, maxConcurrency: 2 },
    startedAt: "2026-08-20T09:00:00.000Z",
    endedAt: "2026-08-20T09:04:30.000Z",
    aggregates: AGGREGATES,
    ratingState: "rated",
    ...overrides,
  };
}

/** A suite run that has NOT settled: no `endedAt`, a partial matrix, rating still pending. */
function runningSuiteRun(cellsCompleted: number): SuiteRun {
  const { endedAt: _ended, ...rest } = suiteRun();
  return {
    ...rest,
    status: "running",
    ratingState: "pending",
    aggregates: {
      ...AGGREGATES,
      cellsCompleted,
      meanGrade: null,
      gradeStdDev: null,
      passRateAt05: null,
    },
  };
}

function member(id: string, score: number | null, status: RunStatus = "completed"): SuiteRunMember {
  return {
    id,
    testId: "tst_1",
    scenarioId: "scen_1",
    mode: "automated",
    status,
    startedAt: "2026-08-20T09:00:10.000Z",
    durationMs: 12_000,
    turns: 4,
    toolCalls: 6,
    peakContextTokens: 9_100,
    tokensIn: 8_000,
    tokensOut: 2_300,
    costUsd: 0.2551,
    suiteRunId: "srn_1",
    repetition: 1,
    score,
  };
}

const MEMBERS: SuiteRunMember[] = [
  member("run_a", 0.91),
  member("run_b", 0.44),
  member("run_c", null, "error"),
  member("run_d", 0.67),
];

/**
 * A stub whose `GET /api/suite-runs/srn_1` walks a scripted sequence, one entry per poll, holding
 * the last entry forever. That is what lets a test say "running, running, then completed" without
 * any notion of time in the stub itself.
 */
function pollingRoutes(sequence: SuiteRun[], extra: StubRoutes = {}): StubRoutes {
  let poll = 0;
  return {
    "POST /api/suites/ste_nightly/run": { status: 202, body: sequence[0] ?? suiteRun() },
    "GET /api/suite-runs/srn_1": () => {
      const answer = sequence[Math.min(poll, sequence.length - 1)] ?? suiteRun();
      poll += 1;
      return { body: answer };
    },
    "GET /api/suite-runs/srn_1/members": { body: MEMBERS },
    "GET /api/suites": { body: SUITES },
    ...extra,
  };
}

async function withStub(
  routes: StubRoutes,
  body: (context: {
    url: string;
    requests: { method: string; url: string; authorization: string | undefined; body: string }[];
    run: (argv: string[]) => ReturnType<typeof runCliCapture>;
  }) => Promise<void>,
): Promise<void> {
  const stub = await startStub(routes);
  const cwd = makeCwd();
  try {
    await body({
      url: stub.url,
      requests: stub.requests,
      run: (argv) => runCliCapture([...argv, "--url", stub.url], { cwd }),
    });
  } finally {
    await stub.close();
  }
}

function paths(requests: { method: string; url: string }[]): string[] {
  return requests.map((request) => `${request.method} ${request.url}`);
}

// ── A1 — start, poll, summarize ──────────────────────────────────────────────────────────────────

test("A1 — suite run starts the matrix, polls until terminal, then reads the members", async () => {
  // running → running → completed. Three polls, so two real 5 s sleeps: the slowest case in the file.
  const routes = pollingRoutes([
    runningSuiteRun(0),
    runningSuiteRun(2),
    suiteRun(),
  ]);
  await withStub(routes, async ({ requests, run }) => {
    const result = await run(["suite", "run", "ste_nightly", "--format", "json"]);
    assert.equal(result.exitCode, 0, result.stderr);

    // The WHOLE request log: the start POST, exactly three polls, and one members read. Nothing
    // else — no suite listing (the ref was an id), no SSE stream, no report.
    assert.deepEqual(paths(requests), [
      "POST /api/suites/ste_nightly/run",
      "GET /api/suite-runs/srn_1",
      "GET /api/suite-runs/srn_1",
      "GET /api/suite-runs/srn_1",
      "GET /api/suite-runs/srn_1/members",
    ]);

    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.outputVersion, MCPFP_OUTPUT_VERSION);
    assert.equal(envelope.command, "suite run");
    // D-C12: exactly the two keys, each verbatim from its endpoint.
    assert.deepEqual(Object.keys(envelope.data), ["suiteRun", "members"]);
    assert.deepEqual(envelope.data.suiteRun, suiteRun());
    assert.deepEqual(envelope.data.members, MEMBERS);

    // D-C6: stdout is byte-exactly the envelope; the narration is on stderr.
    assert.equal(result.stdout, `${JSON.stringify(envelope, null, 2)}\n`);
    assert.match(result.stderr, /Starting suite run for ste_nightly on http/);
    // Narrated only when the cell count MOVED: 0 → 2 → 4, never once per poll.
    const progress = result.stderr.split("\n").filter((line) => line.includes("cells,"));
    assert.deepEqual(progress, [
      "Suite run srn_1: 0/4 cells, $1.14 so far…",
      "Suite run srn_1: 2/4 cells, $1.14 so far…",
      "Suite run srn_1: 4/4 cells, $1.14 so far…",
    ]);
  });
});

test("A1 — the human rendering ends with one verdict sentence and never prints 0 for a null", async () => {
  await withStub(pollingRoutes([suiteRun()]), async ({ run }) => {
    const result = await run(["suite", "run", "ste_nightly"]);
    assert.equal(result.exitCode, 0, result.stderr);

    assert.match(result.stdout, /^Suite run\s+srn_1$/m);
    assert.match(result.stdout, /^Status\s+completed$/m);
    assert.match(result.stdout, /^Duration\s+4m 30s$/m);
    assert.match(result.stdout, /^Cells\s+4\/4$/m);
    assert.match(result.stdout, /^Mean grade\s+0\.82$/m);
    assert.match(result.stdout, /^Pass rate @0\.5\s+75\.0%$/m);
    assert.match(result.stdout, /^Execution cost\s+\$1\.0200$/m);
    // Worst score first; the ungraded member sorts last as an em dash, not as a 0.
    const rows = result.stdout.split("\n").filter((line) => /^run_[a-d]/.test(line));
    assert.deepEqual(
      rows.map((row) => row.split(/\s+/)[0]),
      ["run_b", "run_d", "run_a", "run_c"],
    );
    assert.match(result.stdout, /^run_c\s+error\s+—\s/m);

    assert.equal(
      result.stdout.trimEnd().split("\n").at(-1),
      "Suite run srn_1 completed: 4/4 cells, mean grade 0.82, $1.14.",
    );
  });
});

test("A1 — a matrix with no aggregates renders em dashes, and a long member list is truncated", async () => {
  const many = Array.from({ length: MCPFP_SUITE_RUN_MEMBER_ROWS + 3 }, (_, index) =>
    member(`run_${index}`, index / 100),
  );
  const { aggregates: _dropped, ...bare } = suiteRun();
  const routes = pollingRoutes([bare as SuiteRun], {
    "GET /api/suite-runs/srn_1/members": { body: many },
  });
  await withStub(routes, async ({ run }) => {
    const result = await run(["suite", "run", "ste_nightly"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /^Cells\s+—$/m);
    assert.match(result.stdout, /^Mean grade\s+—$/m);
    assert.match(result.stdout, /^Total tokens\s+—$/m);
    assert.match(result.stdout, /^…and 3 more \(--format json carries all of them\)$/m);
    assert.equal(result.stdout.trimEnd().split("\n").at(-1), "Suite run srn_1 completed.");
    // No aggregates means nothing MOVED, so there is no progress line to print either.
    assert.ok(!result.stderr.includes("cells,"));
  });
});

// ── A2 — id first, name second ───────────────────────────────────────────────────────────────────

test("A2 — a name is resolved only AFTER the id POST 404s, then started by id", async () => {
  const routes = pollingRoutes([suiteRun()], {
    "POST /api/suites/Nightly/run": { status: 404, body: { error: "Suite not found" } },
  });
  await withStub(routes, async ({ requests, run }) => {
    const result = await run(["suite", "run", "Nightly"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(paths(requests), [
      "POST /api/suites/Nightly/run",
      "GET /api/suites",
      "POST /api/suites/ste_nightly/run",
      "GET /api/suite-runs/srn_1",
      "GET /api/suite-runs/srn_1/members",
    ]);
    assert.equal(
      requests.filter((request) => request.url === "/api/suites").length,
      1,
      "the suite listing is requested exactly once, and only after the 404",
    );
    assert.match(result.stderr, /resolving it as a name/);
    // The resolved NAME is what the header shows, without a second lookup.
    assert.match(result.stdout, /^Suite\s+Nightly \(ste_nightly\)$/m);
  });
});

test("A2 — an ambiguous name exits 2 listing the candidate ids, with no second POST", async () => {
  const routes = pollingRoutes([suiteRun()], {
    "POST /api/suites/Twin/run": { status: 404, body: { error: "Suite not found" } },
  });
  await withStub(routes, async ({ requests, run }) => {
    const result = await run(["suite", "run", "Twin"]);
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /matches 2 saved suites/);
    assert.match(result.stderr, /ste_twin_a/);
    assert.match(result.stderr, /ste_twin_b/);
    assert.equal(result.stdout, "");
    assert.deepEqual(paths(requests), ["POST /api/suites/Twin/run", "GET /api/suites"]);
  });
});

test("A2 — an unknown suite exits 2 and says what IS saved", async () => {
  const routes = pollingRoutes([suiteRun()], {
    "POST /api/suites/nope/run": { status: 404, body: { error: "Suite not found" } },
  });
  await withStub(routes, async ({ run }) => {
    const result = await run(["suite", "run", "nope"]);
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /No saved suite with the id or exact name "nope"/);
    assert.match(result.stderr, /ste_nightly\s+Nightly/);
  });
});

// ── A4 — the rating half of "settled" (D-C11) ───────────────────────────────────────────────────

test("A4 — a terminal status with an unsettled rating keeps polling until the review settles", async () => {
  const routes = pollingRoutes([
    suiteRun({ ratingState: "rating" }),
    suiteRun({ ratingState: "rated" }),
  ]);
  await withStub(routes, async ({ requests, run }) => {
    const result = await run(["suite", "run", "ste_nightly"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(
      requests.filter((request) => request.url === "/api/suite-runs/srn_1").length,
      2,
      "a `completed` run whose rating is still in flight is NOT settled",
    );
    assert.ok(!result.stderr.includes("Warning:"), "a rating that settled in time warns nobody");
  });
});

test("A4 — an exhausted budget on a terminal-but-unrated run keeps the status code and WARNS through --quiet", async () => {
  const routes = pollingRoutes([suiteRun({ ratingState: "rating" })]);
  await withStub(routes, async ({ run }) => {
    const result = await run(["suite", "run", "ste_nightly", "--wait", "1", "--quiet"]);
    // The exit code comes from the STATUS, not from the unfinished review.
    assert.equal(result.exitCode, 0);
    assert.match(
      result.stderr,
      /Warning: suite run srn_1 reached completed but its rating was still "rating"/,
    );
    assert.match(result.stderr, /grades in this summary may be incomplete/);
    // `--quiet` silenced the narration and nothing else.
    assert.ok(!result.stderr.includes("Starting suite run"));
    assert.ok(result.stdout.length > 0, "the summary is still the deliverable");
  });
});

test("A4 — a suite run with NO ratingState at all settles on the terminal status alone", async () => {
  const { ratingState: _absent, ...noRating } = suiteRun();
  await withStub(pollingRoutes([noRating as SuiteRun]), async ({ requests, run }) => {
    const result = await run(["suite", "run", "ste_nightly"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(requests.filter((request) => request.url === "/api/suite-runs/srn_1").length, 1);
    assert.ok(!result.stderr.includes("Warning:"));
  });
});

// ── A5/A6 — the envelope, the streams, redaction ────────────────────────────────────────────────

test("A6 — --no-wait returns after the 202 with members: [] and exits 0", async () => {
  const routes = pollingRoutes([runningSuiteRun(0)]);
  await withStub(routes, async ({ requests, run }) => {
    const result = await run(["suite", "run", "ste_nightly", "--no-wait", "--format", "json"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(paths(requests), ["POST /api/suites/ste_nightly/run"]);

    const envelope = JSON.parse(result.stdout);
    assert.deepEqual(Object.keys(envelope.data), ["suiteRun", "members"]);
    assert.deepEqual(envelope.data.members, []);
    assert.equal(envelope.data.suiteRun.status, "running");
    assert.match(result.stderr, /not waiting for it \(--no-wait\)/);
  });
});

test("A5 — a stubbed error body echoing a token reaches neither stream unredacted", async () => {
  const routes: StubRoutes = {
    "POST /api/suites/ste_nightly/run": (request) => ({
      status: 500,
      body: { error: `boom for ${request.authorization ?? "none"}` },
    }),
  };
  await withStub(routes, async ({ run }) => {
    const result = await run(["suite", "run", "ste_nightly", "--token", VALID_TOKEN]);
    assert.equal(result.exitCode, 2);
    assert.ok(!result.stderr.includes(VALID_TOKEN), "the echoed token leaked into stderr");
    assert.ok(!result.stdout.includes(VALID_TOKEN), "the echoed token leaked into stdout");
    assert.match(result.stderr, /mcpfp_A1b2C3d4…/, "masked, not dropped");
  });
});

test("A5 — a 403 on the start POST names the suites:run scope", async () => {
  const routes: StubRoutes = {
    "POST /api/suites/ste_nightly/run": {
      status: 403,
      body: { error: "no", code: API_TOKEN_SCOPE_FORBIDDEN_ERROR_CODE },
    },
  };
  await withStub(routes, async ({ run }) => {
    const result = await run(["suite", "run", "ste_nightly", "--token", VALID_TOKEN]);
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /This command needs the `suites:run` scope\./);
  });
});

test("A5 — a members read that fails is an execution error, not a silent zero-member summary", async () => {
  const routes = pollingRoutes([suiteRun()], {
    "GET /api/suite-runs/srn_1/members": { status: 500, body: { error: "boom" } },
  });
  await withStub(routes, async ({ run }) => {
    const result = await run(["suite", "run", "ste_nightly"]);
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "", "no half-summary claiming the matrix ran nothing");
  });
});

// ── A8 — the flags ───────────────────────────────────────────────────────────────────────────────

test("A8 — --format markdown is refused naming the formats suite run DOES support", async () => {
  await withStub(pollingRoutes([suiteRun()]), async ({ requests, run }) => {
    const result = await run(["suite", "run", "ste_nightly", "--format", "markdown"]);
    assert.equal(result.exitCode, 2);
    assert.match(
      result.stderr,
      /`mcpfp suite run` does not support --format markdown\. It supports: human, json\./,
    );
    assert.equal(result.stdout, "", "a refused format must not silently downgrade to human");
    assert.deepEqual(requests, [], "refused before any network call — no matrix was started");
  });
});

test("A8 — a bad --wait, a missing subcommand and a missing ref are named usage errors", async () => {
  await withStub(pollingRoutes([suiteRun()]), async ({ requests, run }) => {
    for (const argv of [
      ["suite", "run", "ste_nightly", "--wait", "nope"],
      ["suite", "run", "ste_nightly", "--wait", "0"],
      ["suite", "run", "ste_nightly", "--wait", "1.5"],
      ["suite", "run", "ste_nightly", "--wait", ""],
      // Written with `=` because a bare `-5` is option-shaped and `parseArgs` refuses it first.
      ["suite", "run", "ste_nightly", "--wait=-5"],
    ]) {
      const result = await run(argv);
      assert.equal(result.exitCode, 2, argv.join(" "));
      assert.match(result.stderr, /`--wait` takes a positive whole number of seconds/);
    }

    const both = await run(["suite", "run", "ste_nightly", "--wait", "60", "--no-wait"]);
    assert.equal(both.exitCode, 2);
    assert.match(both.stderr, /`--wait` and `--no-wait` contradict each other/);

    const noSubcommand = await run(["suite"]);
    assert.equal(noSubcommand.exitCode, 2);
    assert.match(noSubcommand.stderr, /`mcpfp suite` needs a subcommand\. The only one is `run`\./);

    const wrongSubcommand = await run(["suite", "list"]);
    assert.equal(wrongSubcommand.exitCode, 2);
    assert.match(wrongSubcommand.stderr, /Unknown suite subcommand "list"\./);

    const noRef = await run(["suite", "run"]);
    assert.equal(noRef.exitCode, 2);
    assert.match(noRef.stderr, /`mcpfp suite run` needs a suite id or exact name\./);

    assert.deepEqual(requests, [], "every one of these is refused before a socket is opened");
  });
});

test("A8 — --wait and --no-wait are refused by name on every other command", async () => {
  await withStub({ "GET /api/servers": { body: [] } }, async ({ requests, run }) => {
    for (const argv of [
      ["servers", "--no-wait"],
      ["scans", "--wait", "60"],
      ["scan", "srv_1", "--no-wait"],
      ["assert", "--wait", "60"],
    ]) {
      const result = await run(argv);
      assert.equal(result.exitCode, 2, argv.join(" "));
      assert.match(result.stderr, /only applies to `mcpfp suite run`\./);
    }
    assert.deepEqual(requests, []);
  });
});

// ── A10 — help ───────────────────────────────────────────────────────────────────────────────────

test("A10 — the command list names `suite run`, both help keys resolve, and it is no longer 'not built yet'", async () => {
  const cwd = makeCwd();
  const usage = await runCliCapture(["help"], { cwd });
  assert.equal(usage.exitCode, 0);
  assert.match(usage.stdout, /^ {2}suite run <suite> {10}Run a saved suite's matrix/m);
  assert.match(usage.stdout, /`suite run` needs\n\s+`suites:run` to start the matrix PLUS `read` to poll it/);
  assert.ok(
    !/suite run \(WP 2\.1\)/.test(usage.stdout),
    "`suite run` must be gone from the 'Not built yet' list — it is built",
  );
  // WP 2.2 built the artifact, so the 'Not built yet' list no longer claims it is missing — only
  // WP 2.3's workflow, which POSTS it, is still outstanding.
  assert.ok(
    !/The baseline-delta PR-comment artifact \(WP 2\.2\)/.test(usage.stdout),
    "the PR-comment artifact must be gone from the 'Not built yet' list — it is built",
  );
  assert.match(usage.stdout, /Not built yet\n {2}Nothing this text describes\./);

  for (const topic of [["help", "suite"], ["help", "suite run"]]) {
    const result = await runCliCapture(topic, { cwd });
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /^mcpfp suite run <suite>/);
    assert.match(result.stdout, /Needs a token with the `suites:run` scope/);
  }

  // A9 — the assert topic no longer claims a remote caller needs an execute scope.
  const assertTopic = await runCliCapture(["help", "assert"], { cwd });
  assert.match(assertTopic.stdout, /A remote caller needs a token with the `read` scope/);
  assert.ok(
    !/needs a token with an execute scope/.test(assertTopic.stdout),
    "the pre-WP-M.2 execute-scope claim must be gone (D-C10, closed)",
  );
});
