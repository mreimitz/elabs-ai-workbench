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
import { runCliCapture, startStub } from "./harness.js";

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
