import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import {
  API_TOKEN_AUTH_REQUIRED_ERROR_CODE,
  API_TOKEN_INVALID_ERROR_CODE,
  API_TOKEN_SCOPE_FORBIDDEN_ERROR_CODE,
  FEATURE_DISABLED_ERROR_CODE,
  MCPFP_OUTPUT_VERSION,
  type ScanDetail,
  type ScanSummary,
  type ServerConfig,
} from "@mcp-token-footprint/shared";
import { runCliCapture, startStub, type StubRoutes, VALID_TOKEN } from "./harness.js";

// The commands, end to end against a `node:http` stub of the workbench API (roadmap/ci/ WP 1.2 —
// A8, A9, A10, A12, A13, A14). No real workbench, no MCP server, no database: the CLI is a client,
// so a stub that speaks the same routes is a complete substitute for it.

const temporaryDirectories: string[] = [];

after(() => {
  for (const directory of temporaryDirectories)
    fs.rmSync(directory, { recursive: true, force: true });
});

/** An empty cwd, so no stray `mcpfp.config.json` above the repo can influence a test. */
function makeCwd(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpfp-cli-cmd-"));
  temporaryDirectories.push(root);
  return root;
}

const SERVERS: ServerConfig[] = [
  {
    id: "srv_everything",
    name: "Everything",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-everything"],
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:00:00.000Z",
    hasEnvSecrets: false,
    hasHeaderSecrets: false,
    authType: "none",
  },
  {
    id: "srv_twin_a",
    name: "Twin",
    transport: "streamable_http",
    url: "https://a.example.test/mcp",
    createdAt: "2026-08-02T10:00:00.000Z",
    updatedAt: "2026-08-02T10:00:00.000Z",
    hasEnvSecrets: false,
    hasHeaderSecrets: false,
    authType: "none",
  },
  {
    id: "srv_twin_b",
    name: "Twin",
    transport: "streamable_http",
    url: "https://b.example.test/mcp",
    createdAt: "2026-08-03T10:00:00.000Z",
    updatedAt: "2026-08-03T10:00:00.000Z",
    hasEnvSecrets: false,
    hasHeaderSecrets: false,
    authType: "none",
  },
];

const SCAN_SUMMARY: ScanSummary = {
  id: "scn_1",
  serverId: "srv_everything",
  serverName: "Everything",
  tokenProfile: "generic_o200k",
  scannedAt: "2026-08-19T09:30:00.000Z",
  status: "success",
  totalTools: 3,
  totalTokens: 2224,
  totalRawBytes: 9102,
  averageTokensPerTool: 741,
  largestToolName: "run_query",
  largestToolTokens: 1200,
  totalResources: 2,
  totalResourceTemplates: 1,
  totalPrompts: 1,
  totalResourceTokens: 90,
  totalPromptTokens: 40,
  largestResourceTokens: 50,
  largestPromptTokens: 40,
  countingVersion: 2,
};

const SCAN_DETAIL: ScanDetail = {
  ...SCAN_SUMMARY,
  tools: [tool("run_query", 1200, 53.9), tool("list_tables", 700, 31.5), tool("ping", 324, 14.6)],
  resources: [],
  prompts: [],
  events: [],
};

function tool(toolName: string, totalTokens: number, contributionPercent: number) {
  return {
    id: `tls_${toolName}`,
    scanId: "scn_1",
    toolName,
    description: `${toolName} does a thing`,
    rawTool: { name: toolName },
    totalTokens,
    nameTokens: 2,
    descriptionTokens: 20,
    schemaTokens: totalTokens - 22,
    annotationsTokens: 0,
    rawBytes: totalTokens * 4,
    contributionPercent,
  };
}

/** The routes every command test starts from; individual tests override or add. */
function baseRoutes(): StubRoutes {
  return {
    "GET /api/servers": { body: SERVERS },
    "GET /api/scans": { body: [SCAN_SUMMARY] },
    "GET /api/servers/srv_everything/scans": { body: [SCAN_SUMMARY] },
    "POST /api/servers/srv_everything/scan": { body: SCAN_DETAIL },
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

// ── scan (A8) ─────────────────────────────────────────────────────────────────────────────────────

test("A8 — scan <id> POSTs the scan route and renders the footprint", async () => {
  await withStub(baseRoutes(), async ({ requests, run }) => {
    const result = await run(["scan", "srv_everything"]);
    assert.equal(result.exitCode, 0);
    assert.deepEqual(
      requests.map((request) => `${request.method} ${request.url}`),
      ["POST /api/servers/srv_everything/scan"],
    );

    assert.match(result.stdout, /^Server\s+Everything \(srv_everything\)$/m);
    assert.match(result.stdout, /^Scan\s+scn_1$/m);
    assert.match(result.stdout, /^Total tokens\s+2,224$/m);
    assert.match(result.stdout, /run_query/);
    // The one line an operator wants, last.
    assert.match(
      result.stdout,
      /2,224 definition tokens across 3 tools \(generic_o200k, counting version 2\)\./,
    );
  });
});

test("A8 — scan <name> resolves the name via GET /api/servers after the id 404s", async () => {
  const routes: StubRoutes = {
    ...baseRoutes(),
    "POST /api/servers/Everything/scan": { status: 404, body: { error: "Server not found" } },
  };
  await withStub(routes, async ({ requests, run }) => {
    const result = await run(["scan", "Everything"]);
    assert.equal(result.exitCode, 0);
    assert.deepEqual(
      requests.map((request) => `${request.method} ${request.url}`),
      [
        "POST /api/servers/Everything/scan",
        "GET /api/servers",
        "POST /api/servers/srv_everything/scan",
      ],
    );
    assert.match(result.stderr, /resolving it as a name/);
  });
});

test("A8 — an ambiguous name exits 2 listing the candidate ids", async () => {
  const routes: StubRoutes = {
    ...baseRoutes(),
    "POST /api/servers/Twin/scan": { status: 404, body: { error: "Server not found" } },
  };
  await withStub(routes, async ({ run }) => {
    const result = await run(["scan", "Twin"]);
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /matches 2 registered servers/);
    assert.match(result.stderr, /srv_twin_a/);
    assert.match(result.stderr, /srv_twin_b/);
    assert.equal(result.stdout, "");
  });
});

test("A8 — an unknown server exits 2 and says what IS registered", async () => {
  const routes: StubRoutes = {
    ...baseRoutes(),
    "POST /api/servers/nope/scan": { status: 404, body: { error: "Server not found" } },
  };
  await withStub(routes, async ({ run }) => {
    const result = await run(["scan", "nope"]);
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /No registered server with the id or exact name "nope"/);
    assert.match(result.stderr, /srv_everything\s+Everything/);
  });
});

test("A8 — a scan that FAILED exits 2 while still printing the payload", async () => {
  const failed: ScanDetail = {
    ...SCAN_DETAIL,
    status: "failed",
    errorMessage: "spawn npx ENOENT",
    tools: [],
    totalTools: 0,
    totalTokens: 0,
  };
  const routes: StubRoutes = {
    ...baseRoutes(),
    "POST /api/servers/srv_everything/scan": { body: failed },
  };
  await withStub(routes, async ({ run }) => {
    const result = await run(["scan", "srv_everything", "--format", "json"]);
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /Scan scn_1 failed: spawn npx ENOENT/);
    // Still a complete, parseable payload — the caller gets the evidence, not just the verdict.
    assert.equal(JSON.parse(result.stdout).data.status, "failed");
  });
});

// ── report (A9) ───────────────────────────────────────────────────────────────────────────────────

const REPORT_ROUTES: StubRoutes = {
  "GET /api/reports/scan/scn_1/json": { body: { kind: "scan-report", scanId: "scn_1" } },
  "GET /api/reports/scan/scn_1/markdown": {
    body: "# Scan report\n\nscn_1\n",
    contentType: "text/markdown; charset=utf-8",
  },
  "GET /api/reports/server/scn_1": { body: { kind: "server-report", scanId: "scn_1" } },
  "GET /api/reports/server/scn_1/markdown": {
    body: "# Server report\n",
    contentType: "text/markdown; charset=utf-8",
  },
  "GET /api/reports/run/run_1/json": { body: { kind: "run-report", runId: "run_1" } },
  "GET /api/reports/run/run_1/markdown": {
    body: "# Run report\n",
    contentType: "text/markdown; charset=utf-8",
  },
  "GET /api/reports/fleet/json": { body: { kind: "fleet-report" } },
  "GET /api/reports/fleet/markdown": {
    body: "# Fleet report\n",
    contentType: "text/markdown; charset=utf-8",
  },
};

test("A9 — every report target works in both json and markdown, on the real endpoints", async () => {
  const cases: [args: string[], jsonPath: string, markdownPath: string, command: string][] = [
    [
      ["report", "scan", "scn_1"],
      "/api/reports/scan/scn_1/json",
      "/api/reports/scan/scn_1/markdown",
      "report scan",
    ],
    [
      ["report", "server", "scn_1"],
      "/api/reports/server/scn_1",
      "/api/reports/server/scn_1/markdown",
      "report server",
    ],
    [
      ["report", "run", "run_1"],
      "/api/reports/run/run_1/json",
      "/api/reports/run/run_1/markdown",
      "report run",
    ],
    [["report", "fleet"], "/api/reports/fleet/json", "/api/reports/fleet/markdown", "report fleet"],
  ];

  await withStub(REPORT_ROUTES, async ({ requests, run }) => {
    for (const [args, jsonPath, markdownPath, command] of cases) {
      const json = await run([...args, "--format", "json"]);
      assert.equal(json.exitCode, 0, json.stderr);
      const envelope = JSON.parse(json.stdout);
      assert.equal(envelope.outputVersion, MCPFP_OUTPUT_VERSION);
      assert.equal(envelope.command, command);
      assert.equal(requests.at(-1)?.url, jsonPath);

      const markdown = await run([...args, "--format", "markdown"]);
      assert.equal(markdown.exitCode, 0, markdown.stderr);
      assert.match(markdown.stdout, /^# /);
      assert.equal(requests.at(-1)?.url, markdownPath);
    }
  });
});

test("A9 — report human renders the API's markdown verbatim, and a missing id exits 2", async () => {
  await withStub(REPORT_ROUTES, async ({ run }) => {
    const human = await run(["report", "scan", "scn_1"]);
    assert.equal(human.exitCode, 0);
    assert.equal(human.stdout, "# Scan report\n\nscn_1\n");

    const missingId = await run(["report", "scan"]);
    assert.equal(missingId.exitCode, 2);
    assert.match(missingId.stderr, /needs an id/);

    const badTarget = await run(["report", "everything"]);
    assert.equal(badTarget.exitCode, 2);
    assert.match(badTarget.stderr, /Unknown report target "everything"/);
  });
});

// ── servers / scans listings ──────────────────────────────────────────────────────────────────────

test("A8 — servers and scans list what the API returned", async () => {
  await withStub(baseRoutes(), async ({ requests, run }) => {
    const servers = await run(["servers"]);
    assert.equal(servers.exitCode, 0);
    assert.match(servers.stdout, /^ID\s+NAME\s+TRANSPORT\s+TARGET$/m);
    assert.match(servers.stdout, /^srv_everything\s+Everything\s+stdio\s+npx$/m);

    const scans = await run(["scans"]);
    assert.equal(scans.exitCode, 0);
    assert.match(
      scans.stdout,
      /^scn_1\s+Everything\s+2026-08-19T09:30:00\.000Z\s+success\s+3\s+2,224$/m,
    );
    assert.equal(requests.at(-1)?.url, "/api/scans");

    const byServer = await run(["scans", "--server", "Everything"]);
    assert.equal(byServer.exitCode, 0);
    assert.deepEqual(
      requests.slice(-2).map((request) => request.url),
      ["/api/servers", "/api/servers/srv_everything/scans"],
    );

    const misplaced = await run(["servers", "--server", "Everything"]);
    assert.equal(misplaced.exitCode, 2);
    assert.match(misplaced.stderr, /only applies to `mcpfp scans`/);
  });
});

test("A8 — empty listings render a real empty state, not broken output", async () => {
  await withStub(
    { "GET /api/servers": { body: [] }, "GET /api/scans": { body: [] } },
    async ({ run }) => {
      assert.match((await run(["servers"])).stdout, /No MCP servers are registered\./);
      assert.match((await run(["scans"])).stdout, /No scans have been run on this instance\./);
    },
  );
});

// ── D-C6: the stdout/stderr split (A10) ───────────────────────────────────────────────────────────

test("A10 — with --format json, stdout is nothing but parseable JSON while stderr narrates", async () => {
  const routes: StubRoutes = {
    ...baseRoutes(),
    "POST /api/servers/Everything/scan": { status: 404, body: { error: "Server not found" } },
  };
  await withStub(routes, async ({ run }) => {
    // Narration ON, and a command that narrates three separate lines (resolve → resolved → scan).
    const result = await run(["scan", "Everything", "--format", "json"]);
    assert.equal(result.exitCode, 0);

    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.command, "scan");
    assert.equal(envelope.data.id, "scn_1");
    // Byte-exact: pretty-printed JSON plus exactly one trailing newline, nothing else.
    assert.equal(result.stdout, `${JSON.stringify(envelope, null, 2)}\n`);

    assert.match(result.stderr, /Scanning Everything on http/);
    assert.match(result.stderr, /resolving it as a name/);
    assert.ok(!result.stderr.includes("{"), "narration must not leak payload onto stderr");

    // --quiet removes the narration and leaves the payload byte-identical.
    const quiet = await run(["scan", "Everything", "--format", "json", "--quiet"]);
    assert.equal(quiet.stderr, "");
    assert.equal(JSON.parse(quiet.stdout).data.id, "scn_1");
  });
});

// ── D-C7 translations (A12) ───────────────────────────────────────────────────────────────────────

test("A12 — each guard error becomes an operator sentence and exits 2", async () => {
  const cases: [code: string, status: number, expected: RegExp][] = [
    [
      API_TOKEN_AUTH_REQUIRED_ERROR_CODE,
      401,
      /This instance requires a service token\. Create one in Settings › API tokens/,
    ],
    [API_TOKEN_INVALID_ERROR_CODE, 401, /rejected \(unknown, revoked or expired\)/],
    [API_TOKEN_SCOPE_FORBIDDEN_ERROR_CODE, 403, /lacks the scope for this request/],
    [FEATURE_DISABLED_ERROR_CODE, 403, /switched off in Settings › Features/],
  ];

  for (const [code, status, expected] of cases) {
    // The stub echoes the Authorization header back inside the error body — the nastiest realistic
    // way a token could end up in a build log. It must still not appear in any stream.
    const routes: StubRoutes = {
      "GET /api/servers": (request) => ({
        status,
        body: { error: `refused: ${request.authorization ?? "none"}`, code },
      }),
    };
    await withStub(routes, async ({ run }) => {
      const result = await run(["servers", "--token", VALID_TOKEN]);
      assert.equal(result.exitCode, 2);
      assert.match(result.stderr, expected);
      assert.equal(result.stdout, "");
      assert.ok(!result.stderr.includes(VALID_TOKEN), `${code} leaked the token`);
      assert.ok(!result.stdout.includes(VALID_TOKEN), `${code} leaked the token`);
    });
  }
});

test("A12 — scan names the scan:run scope on a 403", async () => {
  const routes: StubRoutes = {
    "POST /api/servers/srv_everything/scan": {
      status: 403,
      body: { error: "no", code: API_TOKEN_SCOPE_FORBIDDEN_ERROR_CODE },
    },
  };
  await withStub(routes, async ({ run }) => {
    const result = await run(["scan", "srv_everything", "--token", VALID_TOKEN]);
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /This command needs the `scan:run` scope\./);
  });
});

test("A12 — an unreachable API names the URL and never the token", async () => {
  const stub = await startStub({});
  const url = stub.url;
  await stub.close(); // Nothing is listening on that port any more.

  const result = await runCliCapture(["servers", "--url", url, "--token", VALID_TOKEN], {
    cwd: makeCwd(),
  });
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, new RegExp(`No workbench API at ${url} — is it running\\?`));
  assert.ok(!result.stderr.includes(VALID_TOKEN));
});

test("A12 — an UNRECOGNIZED status echoing the token is redacted too (WP 1.3 regression)", async () => {
  // The four guard codes above get canned sentences that never quote the API's body, so they could
  // not leak. A *plain* 500 does quote it — and that message is printed by `runCli`'s top-level
  // catch, which writes to the raw stream rather than through the `Emitter`. Until WP 1.3 that path
  // was the one place the token-shaped mask did not reach; this pins the fix (the same
  // `redactTokens`, not a second masker).
  const routes: StubRoutes = {
    "GET /api/servers": (request) => ({
      status: 500,
      body: { error: `boom for ${request.authorization ?? "none"}` },
    }),
  };
  await withStub(routes, async ({ run }) => {
    const result = await run(["servers", "--token", VALID_TOKEN]);
    assert.equal(result.exitCode, 2);
    assert.ok(!result.stderr.includes(VALID_TOKEN), "the echoed token leaked into stderr");
    assert.match(result.stderr, /mcpfp_A1b2C3d4…/, "masked, not dropped");
  });
});

test("A12 — a plain 500 is an execution error (2), not an assertion failure", async () => {
  await withStub(
    { "GET /api/servers": { status: 500, body: { error: "boom" } } },
    async ({ run }) => {
      const result = await run(["servers"]);
      assert.equal(result.exitCode, 2);
      assert.match(result.stderr, /answered 500 for GET \/api\/servers: boom/);
    },
  );
});

// ── --format guards (A13) and --output (A14) ─────────────────────────────────────────────────────

test("A13 — --format markdown on a command without one exits 2 naming the supported formats", async () => {
  await withStub(baseRoutes(), async ({ requests, run }) => {
    for (const command of [
      ["servers"],
      ["scans"],
      ["config", "show"],
      ["scan", "srv_everything"],
      // `suite run` withholds markdown: the PR-comment artifact belongs to the GATE, and WP 2.2 put
      // it on `mcpfp assert --format markdown`. A human table written into a file a later step
      // parses as the artifact is exactly the failure this guard exists to prevent.
      ["suite", "run", "ste_nightly"],
    ]) {
      const result = await run([...command, "--format", "markdown"]);
      assert.equal(result.exitCode, 2, `${command.join(" ")} should refuse markdown`);
      assert.match(
        result.stderr,
        /does not support --format markdown\. It supports: human, json\./,
      );
      assert.equal(result.stdout, "", "a refused format must not silently downgrade to human");
    }
    // Refused before any network call — a format error is a usage error, not a wasted scan.
    assert.deepEqual(requests, []);

    const unknown = await run(["servers", "--format", "yaml"]);
    assert.equal(unknown.exitCode, 2);
    assert.match(unknown.stderr, /Unknown --format "yaml"/);
  });
});

test("A14 — --output writes the payload to the file, creating parent dirs", async () => {
  const stub = await startStub(baseRoutes());
  const cwd = makeCwd();
  const target = path.join(cwd, "deep", "nested", "servers.json");
  try {
    const written = await runCliCapture(
      ["servers", "--format", "json", "--url", stub.url, "--output", target],
      { cwd },
    );
    assert.equal(written.exitCode, 0);
    assert.equal(written.stdout, "", "--output means stdout carries nothing");
    assert.match(written.stderr, /Wrote \d+ bytes to /);

    const piped = await runCliCapture(["servers", "--format", "json", "--url", stub.url], { cwd });
    // The file contains EXACTLY what stdout would have carried, byte for byte (bar the timestamp).
    const fromFile = JSON.parse(fs.readFileSync(target, "utf8"));
    const fromStdout = JSON.parse(piped.stdout);
    assert.deepEqual(fromFile.data, fromStdout.data);
    assert.deepEqual({ ...fromFile, generatedAt: null }, { ...fromStdout, generatedAt: null });

    const quiet = await runCliCapture(
      ["servers", "--format", "json", "--url", stub.url, "--output", target, "--quiet"],
      { cwd },
    );
    assert.equal(quiet.stderr, "", "--quiet silences the write confirmation, which is narration");
  } finally {
    await stub.close();
  }
});

test("A14 — an unwritable --output path exits 2 rather than failing silently", async () => {
  const stub = await startStub(baseRoutes());
  const cwd = makeCwd();
  const blocker = path.join(cwd, "blocker");
  fs.writeFileSync(blocker, "not a directory", "utf8");
  try {
    const result = await runCliCapture(
      ["servers", "--url", stub.url, "--output", path.join(blocker, "out.json")],
      { cwd },
    );
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /Could not write /);
  } finally {
    await stub.close();
  }
});
