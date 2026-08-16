import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import type { ServerAuthInput } from "@mcp-token-footprint/shared";
import {
  McpServerLinkedAuth,
  type LinkedOAuthReader,
  type LinkedServerReader,
} from "../src/providers/linked-auth.js";
import {
  bearerFromRequestAuth,
  probeAssistantsAvailability,
  probeRequestAnswers,
  probeServerAnswers,
  type ProbeFetch,
} from "../src/servers/qlik-answers-probe.js";
import {
  isLikelyQlikTenantUrl,
  qlikTenantOrigin,
  safeUrlOrigin,
} from "../src/servers/qlik-detect.js";
import type { InternalServerConfig } from "../src/servers/repository.js";

// Qlik Answers detection + list-only availability probe (WP 2.1). EVERY tenant HTTP call goes through an
// injected fetch — NO real Qlik tenant is ever contacted. The headline invariant (a probe is list-only,
// never consumes a question) is asserted both by the recorded request URL AND by a structural source
// check that the probe module holds no invoke/stream path.

const NOW = "2026-07-11T00:00:00.000Z";
const QLIK_URL = "https://my-tenant.us.qlikcloud.com/api/ai/mcp";
const QLIK_ORIGIN = "https://my-tenant.us.qlikcloud.com";
const ASSISTANTS_URL = `${QLIK_ORIGIN}/api/v1/assistants?limit=100`;

// ── qlik-detect (pure URL heuristic, mirrors the web isLikelyQlikMcpUrl) ───────────────────────────

test("isLikelyQlikTenantUrl — a Qlik Cloud MCP URL matches; other/stdio/unparseable do not", () => {
  assert.equal(isLikelyQlikTenantUrl(QLIK_URL), true);
  assert.equal(isLikelyQlikTenantUrl("https://my-tenant.eu.qlikcloud.com/api/ai/mcp/"), true);
  // Right host, wrong path.
  assert.equal(isLikelyQlikTenantUrl("https://my-tenant.us.qlikcloud.com/api/v1/items"), false);
  // Right path shape, wrong host — a look-alike domain must NOT match (endsWith guards the dot).
  assert.equal(isLikelyQlikTenantUrl("https://evil-qlikcloud.com/api/ai/mcp"), false);
  assert.equal(isLikelyQlikTenantUrl("https://other-mcp.example.com/mcp"), false);
  assert.equal(isLikelyQlikTenantUrl(undefined), false);
  assert.equal(isLikelyQlikTenantUrl(""), false);
  assert.equal(isLikelyQlikTenantUrl("not a url"), false);
});

test("safeUrlOrigin / qlikTenantOrigin — origin is scheme+host (no path); tenant origin gated on Qlik-ness", () => {
  assert.equal(safeUrlOrigin(QLIK_URL), QLIK_ORIGIN);
  assert.equal(safeUrlOrigin("https://x.example.com:9000/a/b?q=1"), "https://x.example.com:9000");
  assert.equal(safeUrlOrigin(undefined), undefined);
  assert.equal(safeUrlOrigin("nope"), undefined);
  assert.equal(qlikTenantOrigin(QLIK_URL), QLIK_ORIGIN);
  assert.equal(qlikTenantOrigin("https://other-mcp.example.com/mcp"), undefined);
});

// ── probeAssistantsAvailability (the single list-only GET) ──────────────────────────────────────────

test("probeAssistantsAvailability — 2xx → available + counts one page of data[], sends Bearer, hits assistants only", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = recordingFetch(calls, () =>
    jsonResponse(200, { data: [{ id: "a" }, { id: "b" }, { id: "c" }] }),
  );

  const result = await probeAssistantsAvailability(QLIK_ORIGIN, "tok-123", fetchImpl);

  assert.deepEqual(result, { answersAvailable: true, assistantCount: 3, needsOwnKey: false });
  assert.equal(calls.length, 1, "exactly one request");
  assert.equal(
    calls[0]?.url,
    ASSISTANTS_URL,
    "the ONLY endpoint is /api/v1/assistants (list-only)",
  );
  assert.equal(calls[0]?.init?.method ?? "GET", "GET");
  assert.equal(
    header(calls[0]?.init, "authorization"),
    "Bearer tok-123",
    "the resolved bearer authorizes the GET",
  );
});

test("probeAssistantsAvailability — 401 and 403 → not available + needsOwnKey (API-key fallback, D-QA1)", async () => {
  for (const status of [401, 403]) {
    const result = await probeAssistantsAvailability(QLIK_ORIGIN, "tok", () =>
      Promise.resolve(emptyResponse(status)),
    );
    assert.deepEqual(
      result,
      { answersAvailable: false, assistantCount: 0, needsOwnKey: true },
      `status ${status}`,
    );
  }
});

test("probeAssistantsAvailability — 5xx / network error / unreadable body → not available, NO needsOwnKey", async () => {
  const server = await probeAssistantsAvailability(QLIK_ORIGIN, "tok", () =>
    Promise.resolve(emptyResponse(500)),
  );
  assert.deepEqual(server, { answersAvailable: false, assistantCount: 0 });

  const network = await probeAssistantsAvailability(QLIK_ORIGIN, "tok", () =>
    Promise.reject(new Error("ECONNREFUSED")),
  );
  assert.deepEqual(network, { answersAvailable: false, assistantCount: 0 });

  const unreadable = await probeAssistantsAvailability(QLIK_ORIGIN, "tok", () =>
    Promise.resolve(new Response("<<not json>>", { status: 200 })),
  );
  assert.deepEqual(unreadable, { answersAvailable: false, assistantCount: 0 });
});

test("probeAssistantsAvailability — a missing/malformed data[] on a 2xx counts as 0 (still available)", async () => {
  const noData = await probeAssistantsAvailability(QLIK_ORIGIN, "tok", () =>
    Promise.resolve(jsonResponse(200, {})),
  );
  assert.deepEqual(noData, { answersAvailable: true, assistantCount: 0, needsOwnKey: false });
});

// ── bearerFromRequestAuth (URL-first probe supplies its own auth) ───────────────────────────────────

test("bearerFromRequestAuth — resolves bearer / api_key / custom-header (Authorization + custom name); none/oauth → undefined", () => {
  assert.equal(bearerFromRequestAuth({ type: "bearer", token: "  raw-bearer  " }), "raw-bearer");
  assert.equal(
    bearerFromRequestAuth({ type: "api_key", headerName: "qlik-api-key", key: "raw-key" }),
    "raw-key",
  );
  assert.equal(
    bearerFromRequestAuth({ type: "custom_headers", headers: { Authorization: "Bearer hdr-tok" } }),
    "hdr-tok",
    "an Authorization header is Bearer-stripped",
  );
  assert.equal(
    bearerFromRequestAuth({ type: "custom_headers", headers: { "qlik-api-key": "custom-tok" } }),
    "custom-tok",
    "a custom header value is the token",
  );
  assert.equal(bearerFromRequestAuth({ type: "none" }), undefined);
  assert.equal(
    bearerFromRequestAuth({ type: "oauth" }),
    undefined,
    "oauth is not connected during an unauth probe",
  );
  assert.equal(bearerFromRequestAuth(undefined), undefined);
  assert.equal(
    bearerFromRequestAuth({ type: "bearer" }),
    undefined,
    "an empty bearer is undefined",
  );
});

// ── probeServerAnswers (dedicated route) — the FOUR auth flavors of a SAVED server ──────────────────

for (const flavor of authFlavors()) {
  test(`probeServerAnswers — a Qlik ${flavor.name} server resolves its own credential and lists (available)`, async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = recordingFetch(calls, () =>
      jsonResponse(200, { data: [{ id: "assistant-1" }] }),
    );

    const result = await probeServerAnswers(
      depsFor(flavor.config, flavor.accessToken),
      "srv-qlik",
      fetchImpl,
    );

    assert.deepEqual(result, {
      origin: QLIK_ORIGIN,
      answersAvailable: true,
      assistantCount: 1,
      needsOwnKey: false,
    });
    assert.equal(calls[0]?.url, ASSISTANTS_URL, "list-only endpoint");
    assert.equal(
      header(calls[0]?.init, "authorization"),
      `Bearer ${flavor.expectedBearer}`,
      "the flavor's token becomes the bearer",
    );
    // The token must NEVER appear in the redacted response.
    assert.equal(
      JSON.stringify(result).includes(flavor.expectedBearer),
      false,
      "no secret in the probe response",
    );
  });
}

test("probeServerAnswers — 401 from the tenant → not available + needsOwnKey (per flavor is covered above; here bearer)", async () => {
  const result = await probeServerAnswers(
    depsFor(
      serverConfig({ authType: "bearer", headers: { Authorization: "Bearer SUPER-SECRET" } }),
    ),
    "srv-qlik",
    () => Promise.resolve(emptyResponse(401)),
  );
  assert.deepEqual(result, {
    origin: QLIK_ORIGIN,
    answersAvailable: false,
    assistantCount: 0,
    needsOwnKey: true,
  });
  assert.equal(
    JSON.stringify(result).includes("SUPER-SECRET"),
    false,
    "the bearer never leaks on the 401 path",
  );
});

test("probeServerAnswers — a non-Qlik streamable server → not available, NO tenant HTTP at all", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = recordingFetch(calls, () => jsonResponse(200, { data: [{ id: "x" }] }));
  const config = serverConfig({
    url: "https://other-mcp.example.com/mcp",
    authType: "bearer",
    headers: { Authorization: "Bearer t" },
  });

  const result = await probeServerAnswers(depsFor(config), "srv-other", fetchImpl);

  assert.deepEqual(result, {
    origin: "https://other-mcp.example.com",
    answersAvailable: false,
    assistantCount: 0,
  });
  assert.equal(calls.length, 0, "a non-Qlik server is never contacted (no list call)");
});

test("probeServerAnswers — a stdio server (no URL) → origin '' + not available, no HTTP", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = recordingFetch(calls, () => jsonResponse(200, { data: [] }));
  const config = serverConfig({
    transport: "stdio",
    url: undefined,
    authType: "none",
    headers: {},
  });

  const result = await probeServerAnswers(depsFor(config), "srv-stdio", fetchImpl);

  assert.deepEqual(result, { origin: "", answersAvailable: false, assistantCount: 0 });
  assert.equal(calls.length, 0);
});

test("probeServerAnswers — a Qlik server whose own auth is unresolvable (broken link) → not available, NO needsOwnKey, no leak", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = recordingFetch(calls, () => jsonResponse(200, { data: [] }));
  // oauth server with NO stored token → McpServerLinkedAuth.resolve throws brokenLinkError.
  const config = serverConfig({ authType: "oauth" });

  const result = await probeServerAnswers(depsFor(config, undefined), "srv-qlik", fetchImpl);

  assert.deepEqual(result, { origin: QLIK_ORIGIN, answersAvailable: false, assistantCount: 0 });
  assert.equal(calls.length, 0, "with no usable credential we never attempt the GET");
});

// ── probeRequestAnswers (URL-first folding into POST /api/servers/probe) ────────────────────────────

test("probeRequestAnswers — a Qlik URL + supplied bearer → available; the request's own auth is used", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = recordingFetch(calls, () =>
    jsonResponse(200, { data: [{ id: "a" }, { id: "b" }] }),
  );

  const result = await probeRequestAnswers(
    QLIK_URL,
    { type: "bearer", token: "probe-tok" },
    fetchImpl,
  );

  assert.deepEqual(result, {
    origin: QLIK_ORIGIN,
    answersAvailable: true,
    assistantCount: 2,
    needsOwnKey: false,
  });
  assert.equal(header(calls[0]?.init, "authorization"), "Bearer probe-tok");
});

test("probeRequestAnswers — a non-Qlik URL → undefined (qlikTenant stays absent), no HTTP", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = recordingFetch(calls, () => jsonResponse(200, { data: [] }));

  const result = await probeRequestAnswers(
    "https://other-mcp.example.com/mcp",
    { type: "bearer", token: "t" },
    fetchImpl,
  );

  assert.equal(result, undefined);
  assert.equal(calls.length, 0);
});

test("probeRequestAnswers — a Qlik URL with oauth (not yet connected) → available:false, no HTTP", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = recordingFetch(calls, () => jsonResponse(200, { data: [] }));

  const result = await probeRequestAnswers(QLIK_URL, { type: "oauth" }, fetchImpl);

  assert.deepEqual(result, { origin: QLIK_ORIGIN, answersAvailable: false, assistantCount: 0 });
  assert.equal(calls.length, 0, "no resolvable bearer → nothing to probe with");
});

// ── list-only BY CONSTRUCTION — a structural guard, not just behavior ───────────────────────────────

test("the probe module has NO invoke/stream code path (list-only by construction)", () => {
  const raw = readFileSync(
    fileURLToPath(new URL("../src/servers/qlik-answers-probe.ts", import.meta.url)),
    "utf8",
  );
  // Guard the EXECUTABLE code, not the prose — the doc comment intentionally names the forbidden
  // endpoints to explain the invariant, so strip comments before asserting on what the module can DO.
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  // The only tenant path the code may build is the assistants list — no reachable invoke/stream call.
  assert.equal(
    /invoke|stream/i.test(code),
    false,
    "code names neither invoke nor stream (a probe can't consume a question)",
  );
  assert.match(
    code,
    /api\/v1\/assistants/,
    "the one and only tenant endpoint is the assistants list",
  );
});

// ── fixtures / helpers ──────────────────────────────────────────────────────────────────────────────

type Flavor = {
  name: string;
  config: InternalServerConfig;
  accessToken?: string;
  expectedBearer: string;
};

function authFlavors(): Flavor[] {
  return [
    {
      name: "oauth",
      config: serverConfig({ authType: "oauth" }),
      accessToken: "oauth-access-xyz",
      expectedBearer: "oauth-access-xyz",
    },
    {
      name: "bearer",
      config: serverConfig({
        authType: "bearer",
        headers: { Authorization: "Bearer bearer-tok-123" },
      }),
      expectedBearer: "bearer-tok-123",
    },
    {
      name: "api-key",
      config: serverConfig({
        authType: "api_key",
        authHeaderName: "qlik-api-key",
        headers: { "qlik-api-key": "api-key-abc" },
      }),
      expectedBearer: "api-key-abc",
    },
    {
      name: "custom-header",
      config: serverConfig({
        authType: "custom_headers",
        headers: { "X-Qlik-Token": "custom-hdr-xyz" },
      }),
      expectedBearer: "custom-hdr-xyz",
    },
  ];
}

/** A full InternalServerConfig defaulting to a Qlik-tenant streamable-HTTP server. */
function serverConfig(over: Partial<InternalServerConfig> = {}): InternalServerConfig {
  return {
    id: "srv-qlik",
    name: "Qlik",
    transport: "streamable_http",
    url: QLIK_URL,
    args: [],
    env: {},
    headers: {},
    authType: "oauth",
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function serverReader(config: InternalServerConfig): LinkedServerReader {
  return { getInternal: () => config };
}

function oauthReader(accessToken?: string): LinkedOAuthReader {
  return { getCredentials: () => (accessToken ? { tokens: { access_token: accessToken } } : {}) };
}

/** Build the dedicated-route deps against the REAL McpServerLinkedAuth so the four flavors resolve for real. */
function depsFor(config: InternalServerConfig, accessToken?: string) {
  const servers = serverReader(config);
  return { servers, auth: new McpServerLinkedAuth(servers, oauthReader(accessToken)) };
}

function recordingFetch(
  sink: Array<{ url: string; init?: RequestInit }>,
  respond: () => Response,
): ProbeFetch {
  return ((url: string, init?: RequestInit) => {
    sink.push({ url, init });
    return Promise.resolve(respond());
  }) as unknown as ProbeFetch;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function emptyResponse(status: number): Response {
  return new Response("", { status });
}

function header(init: RequestInit | undefined, name: string): string | undefined {
  const headers = init?.headers as Record<string, string> | undefined;
  if (!headers) return undefined;
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return entry?.[1];
}
