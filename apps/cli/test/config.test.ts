import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { MCPFP_DEFAULT_API_URL, MCPFP_DEFAULT_TIMEOUT_MS } from "@mcp-token-footprint/shared";
import { runCliCapture, startStub, VALID_TOKEN } from "./harness.js";

// Config resolution + the token-handling rules (roadmap/ci/ WP 1.2 — A5, A6, A7).
//
// Every case runs `config show --format json`, because that is the one command whose payload IS the
// resolved config: the precedence table is asserted against what the CLI would actually use, not
// against an internal function nobody calls in anger.

const temporaryDirectories: string[] = [];

after(() => {
  for (const directory of temporaryDirectories)
    fs.rmSync(directory, { recursive: true, force: true });
});

function makeWorkspace(files: Record<string, string> = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpfp-cli-"));
  temporaryDirectories.push(root);
  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents, "utf8");
  }
  return root;
}

type ShownConfig = {
  apiUrl: string;
  timeoutMs: number;
  configFile: string | null;
  token: { present: true; displayPrefix: string; source: string } | null;
};

async function showConfig(
  argv: string[],
  options: { env?: Record<string, string | undefined>; cwd?: string } = {},
): Promise<{ config: ShownConfig; stdout: string; stderr: string; exitCode: number }> {
  const result = await runCliCapture(["config", "show", "--format", "json", ...argv], options);
  assert.equal(result.exitCode, 0, result.stderr);
  const envelope = JSON.parse(result.stdout) as { data: ShownConfig };
  return { config: envelope.data, ...result };
}

test("A5 — with nothing set, the defaults apply", async () => {
  const { config } = await showConfig([], { cwd: makeWorkspace() });
  assert.equal(config.apiUrl, MCPFP_DEFAULT_API_URL);
  assert.equal(config.timeoutMs, MCPFP_DEFAULT_TIMEOUT_MS);
  assert.equal(config.configFile, null);
  assert.equal(config.token, null);
});

test("A5 — the config file is found by walking UP from the cwd", async () => {
  const root = makeWorkspace({
    "mcpfp.config.json": JSON.stringify({ url: "http://10.0.0.5:9000", timeoutMs: 4321 }),
    "nested/deeper/.keep": "",
  });
  const { config } = await showConfig([], { cwd: path.join(root, "nested", "deeper") });
  assert.equal(config.apiUrl, "http://10.0.0.5:9000");
  assert.equal(config.timeoutMs, 4321);
  assert.equal(config.configFile, path.join(root, "mcpfp.config.json"));
});

test("A5 — the NEAREST config file wins over one further up", async () => {
  const root = makeWorkspace({
    "mcpfp.config.json": JSON.stringify({ url: "http://outer:1111" }),
    "inner/mcpfp.config.json": JSON.stringify({ url: "http://inner:2222" }),
  });
  const { config } = await showConfig([], { cwd: path.join(root, "inner") });
  assert.equal(config.apiUrl, "http://inner:2222");
});

test("A5 — env beats the config file", async () => {
  const cwd = makeWorkspace({ "mcpfp.config.json": JSON.stringify({ url: "http://file:1111" }) });
  const { config } = await showConfig([], {
    cwd,
    env: { MCPFP_URL: "http://env:2222", MCPFP_TIMEOUT_MS: "5000" },
  });
  assert.equal(config.apiUrl, "http://env:2222");
  assert.equal(config.timeoutMs, 5000);
});

test("A5 — a flag beats env, which beats the file, which beats the default", async () => {
  const cwd = makeWorkspace({
    "mcpfp.config.json": JSON.stringify({ url: "http://file:1111", timeoutMs: 1111 }),
  });
  const { config } = await showConfig(["--url", "http://flag:3333", "--timeout", "3333"], {
    cwd,
    env: { MCPFP_URL: "http://env:2222", MCPFP_TIMEOUT_MS: "2222" },
  });
  assert.equal(config.apiUrl, "http://flag:3333");
  assert.equal(config.timeoutMs, 3333);
});

test("A5 — --config names a file explicitly, wherever the cwd is", async () => {
  const elsewhere = makeWorkspace({ "custom.json": JSON.stringify({ url: "http://named:4444" }) });
  const { config } = await showConfig(["--config", path.join(elsewhere, "custom.json")], {
    cwd: makeWorkspace(),
  });
  assert.equal(config.apiUrl, "http://named:4444");
  assert.equal(config.configFile, path.join(elsewhere, "custom.json"));
});

test("A5 — a --config path that does not exist exits 2, never a silent fallback", async () => {
  const cwd = makeWorkspace();
  const missing = path.join(cwd, "nope.json");
  const result = await runCliCapture(["config", "show", "--config", missing], { cwd });
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /No config file at/);
  assert.equal(result.stdout, "");
});

test("A5 — an unknown key in the config file is an error, not a silently ignored setting", async () => {
  const cwd = makeWorkspace({
    "mcpfp.config.json": JSON.stringify({ apiUrl: "http://typo:1111" }),
  });
  const result = await runCliCapture(["config", "show"], { cwd });
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /not a valid mcpfp config/);
  assert.match(result.stderr, /apiUrl/);
});

test("A5 — a malformed config file and a non-http URL both exit 2 with a named cause", async () => {
  const broken = makeWorkspace({ "mcpfp.config.json": "{ not json" });
  const brokenResult = await runCliCapture(["config", "show"], { cwd: broken });
  assert.equal(brokenResult.exitCode, 2);
  assert.match(brokenResult.stderr, /not valid JSON/);

  const scheme = await runCliCapture(["config", "show", "--url", "ftp://example.test"], {
    cwd: makeWorkspace(),
  });
  assert.equal(scheme.exitCode, 2);
  assert.match(scheme.stderr, /http:\/\/ or https:\/\//);

  const nonsense = await runCliCapture(["config", "show", "--url", "not a url"], {
    cwd: makeWorkspace(),
  });
  assert.equal(nonsense.exitCode, 2);
  assert.match(nonsense.stderr, /not a valid URL/);

  const timeout = await runCliCapture(["config", "show", "--timeout", "soon"], {
    cwd: makeWorkspace(),
  });
  assert.equal(timeout.exitCode, 2);
  assert.match(timeout.stderr, /positive whole number/);
});

test("A6 — config show renders the token's prefix and never the token", async () => {
  const cwd = makeWorkspace();
  const json = await showConfig(["--token", VALID_TOKEN], { cwd });
  assert.equal(json.config.token?.present, true);
  assert.equal(json.config.token?.source, "flag");
  assert.equal(json.config.token?.displayPrefix, "mcpfp_A1b2C3d4…");

  // The whole point: the plaintext is in NO stream, and the prefix that IS shown is genuinely shorter.
  assert.ok(!json.stdout.includes(VALID_TOKEN));
  assert.ok(!json.stderr.includes(VALID_TOKEN));
  assert.ok(VALID_TOKEN.startsWith("mcpfp_A1b2C3d4"));
  assert.ok(
    json.config.token !== null && json.config.token.displayPrefix.length < VALID_TOKEN.length,
  );

  const human = await runCliCapture(["config", "show"], {
    cwd,
    env: { MCPFP_TOKEN: VALID_TOKEN },
  });
  assert.equal(human.exitCode, 0);
  assert.match(human.stdout, /mcpfp_A1b2C3d4…/);
  assert.ok(!human.stdout.includes(VALID_TOKEN));
  assert.ok(!human.stderr.includes(VALID_TOKEN));
});

test("A6 — a token resolved from the config file warns and is still never printed", async () => {
  const cwd = makeWorkspace({
    "mcpfp.config.json": JSON.stringify({ token: VALID_TOKEN }),
  });
  const result = await runCliCapture(["config", "show"], { cwd });
  assert.equal(result.exitCode, 0);
  assert.match(result.stderr, /Prefer the MCPFP_TOKEN environment variable in CI/);
  assert.ok(!result.stderr.includes(VALID_TOKEN));
  assert.ok(!result.stdout.includes(VALID_TOKEN));

  // The warning is a security nudge, so --quiet must not silence it.
  const quiet = await runCliCapture(["config", "show", "--quiet"], { cwd });
  assert.match(quiet.stderr, /Prefer the MCPFP_TOKEN environment variable in CI/);
});

test("A6 — --output never writes the token to the file either", async () => {
  const cwd = makeWorkspace();
  const target = path.join(cwd, "out", "config.json");
  const result = await runCliCapture(
    ["config", "show", "--format", "json", "--token", VALID_TOKEN, "--output", target],
    { cwd },
  );
  assert.equal(result.exitCode, 0);
  const written = fs.readFileSync(target, "utf8");
  assert.ok(!written.includes(VALID_TOKEN));
  assert.match(written, /mcpfp_A1b2C3d4…/);
});

test("A7 — a malformed token exits 2 BEFORE any request reaches the API", async () => {
  const stub = await startStub({ "GET /api/servers": { body: [] } });
  try {
    const result = await runCliCapture(["servers", "--url", stub.url, "--token", "mcpfp_short"], {
      cwd: makeWorkspace(),
    });
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /not a workbench token/);
    assert.match(result.stderr, /from --token/);
    assert.equal(result.stdout, "");
    // The claim that matters: nothing went out on the wire.
    assert.deepEqual(stub.requests, []);
  } finally {
    await stub.close();
  }
});

test("A7 — the rejected token value is never echoed back", async () => {
  const stub = await startStub({ "GET /api/servers": { body: [] } });
  // A real secret of the WRONG shape — the classic "pasted the provider key into MCPFP_TOKEN".
  const leaky = "sk-live-9f2c4d6e8a0b2c4d6e8f0a1b";
  try {
    const result = await runCliCapture(["servers", "--url", stub.url], {
      cwd: makeWorkspace(),
      env: { MCPFP_TOKEN: leaky },
    });
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /from MCPFP_TOKEN/);
    assert.ok(!result.stderr.includes(leaky));
    assert.deepEqual(stub.requests, []);
  } finally {
    await stub.close();
  }
});

test("A6/A7 — a valid token IS sent, as a bearer header, and only there", async () => {
  const stub = await startStub({ "GET /api/servers": { body: [] } });
  try {
    const result = await runCliCapture(["servers", "--url", stub.url, "--token", VALID_TOKEN], {
      cwd: makeWorkspace(),
    });
    assert.equal(result.exitCode, 0);
    assert.equal(stub.requests.length, 1);
    assert.equal(stub.requests[0]?.authorization, `Bearer ${VALID_TOKEN}`);
    assert.ok(!result.stdout.includes(VALID_TOKEN));
    assert.ok(!result.stderr.includes(VALID_TOKEN));
  } finally {
    await stub.close();
  }
});

test("A5 — no token is sent when none is configured (D-C2: loopback is open)", async () => {
  const stub = await startStub({ "GET /api/servers": { body: [] } });
  try {
    const result = await runCliCapture(["servers", "--url", stub.url], { cwd: makeWorkspace() });
    assert.equal(result.exitCode, 0);
    assert.equal(stub.requests[0]?.authorization, undefined);
  } finally {
    await stub.close();
  }
});
