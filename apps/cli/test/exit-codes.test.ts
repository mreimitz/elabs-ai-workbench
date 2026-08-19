import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { MCPFP_EXIT, MCPFP_OUTPUT_VERSION } from "@mcp-token-footprint/shared";
import { runCliCapture, startStub } from "./harness.js";

// **D-C7 — the exit-code contract, pinned so WP 1.3 inherits a stable one** (A11).
//
// The distinction this file exists to protect: `1` means "an assertion failed" and NOTHING in this
// build may emit it. If a later change makes a failed scan or a 500 exit `1`, `mcpfp assert` will
// have inherited a code that already means two different things, and a CI pipeline will not be able
// to tell "the gate said no" from "the gate could not run".

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

test("A11 — 1 is RESERVED: no invocation in this build returns it", async () => {
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
