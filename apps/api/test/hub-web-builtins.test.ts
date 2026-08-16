// Assistant Hub — hub-fixes WP5.1 (RC5, D-HF2). Unit coverage for the "web" capability, all offline
// (no network, no provider): the provider gating matrix (`composeWebTools`), the SSRF guard
// (`isBlockedIp`/`assertPublicHttpUrl`/`guardedFetch` — table-driven private/loopback/redirect-to-private
// + size-cap spill), text extraction, Google grounding mapping, and the web-search → citation post-pass.

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_TOKEN_PROFILE,
  HUB_WEB_FETCH_BUILTIN,
  HUB_WEB_SEARCH_BUILTIN,
} from "@mcp-token-footprint/shared";
import { beginHubCitationTurn } from "../src/hub/citations.js";
import { composeWebCitationPostPass } from "../src/hub/session-service.js";
import {
  extractGroundingWebSources,
  providerSupportsWebSearch,
} from "../src/providers/registry.js";
import {
  assertPublicHttpUrl,
  composeWebTools,
  extractPageMarkdown,
  extractReadableText,
  guardedFetch,
  htmlToText,
  isBlockedIp,
  runWebFetch,
  WEB_SEARCH_FRESHNESS_NOTE,
  WebFetchError,
  type WebFetchTransport,
} from "../src/hub/tools/builtins/web.js";
import {
  createFallbackWebSearchTool,
  DDG_DEGRADED_NOTE,
  describeSearchChain,
  runSearchChain,
} from "../src/hub/tools/builtins/web-search-fallback.js";
import { getTokenCounter } from "../src/token-counting/profiles.js";

const tokenCounter = getTokenCounter(DEFAULT_TOKEN_PROFILE);
const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-webfetch-"));
  tempDirs.push(dir);
  return dir;
}

// ── (1) Provider gating matrix ────────────────────────────────────────────────────────────────────

test("composeWebTools: anthropic/openai/google expose web.search; openai_compatible/ollama do not + the prompt says why when a scope requested it", () => {
  for (const kind of ["anthropic", "openai", "google"] as const) {
    const out = composeWebTools({
      providerKind: kind,
      grantedBuiltins: [HUB_WEB_SEARCH_BUILTIN],
      webToolsEnabled: true,
    });
    assert.ok(out.searchTool, `${kind} exposes web.search`);
    assert.equal(out.searchExposed, true, kind);
    assert.equal(out.promptNote, undefined, `${kind}: no note when supported`);
    assert.equal(providerSupportsWebSearch(kind), true);
  }
  for (const kind of ["openai_compatible", "ollama"] as const) {
    const out = composeWebTools({
      providerKind: kind,
      grantedBuiltins: [HUB_WEB_SEARCH_BUILTIN],
      webToolsEnabled: true,
    });
    assert.equal(out.searchTool, undefined, `${kind} has no native web.search`);
    assert.equal(out.searchExposed, false, kind);
    assert.ok(
      out.promptNote && /web\.search is unavailable/.test(out.promptNote),
      `${kind}: prompt explains the absence`,
    );
    assert.equal(providerSupportsWebSearch(kind), false);
  }
});

test("composeWebTools: capability-derived default grants BOTH web tools to any unscoped session — INCLUDING a mission agent", () => {
  const supported = composeWebTools({
    providerKind: "anthropic",
    grantedBuiltins: [], // default scope: neither web tool explicitly listed
    webToolsEnabled: true,
  });
  assert.ok(supported.searchTool, "web.search default-granted on a search-capable model");
  assert.equal(supported.includeFetch, true, "web.fetch default-granted alongside it");

  // web-access-fix (2026-07-27, owner decision) — a MISSION AGENT is granted by default too. It used
  // to require an explicit planner grant (D-HF2), but `missions/planner.ts` and its prompt never
  // mention `web.search`/`web.fetch` at all, so the planner could not emit that grant and no crew
  // agent could ever reach the internet: "use the available agent crews and research the internet"
  // was structurally unsatisfiable. A crew agent is now as web-capable as the session that
  // commissioned it. The composition no longer takes a session-kind input at all.
  const agentDefault = composeWebTools({
    providerKind: "anthropic",
    grantedBuiltins: [],
    webToolsEnabled: true,
  });
  assert.ok(agentDefault.searchTool, "a mission agent gets web.search by default");
  assert.equal(agentDefault.includeFetch, true, "and web.fetch alongside it");

  // v1-fixes (F6): an unsupported model still gets web.fetch by default (the web capability no longer
  // vanishes with native-search support), and gets the FALLBACK search when one is supplied.
  const unsupportedDefault = composeWebTools({
    providerKind: "ollama",
    grantedBuiltins: [],
    webToolsEnabled: true,
  });
  assert.equal(unsupportedDefault.searchTool, undefined);
  assert.equal(unsupportedDefault.includeFetch, true, "web.fetch survives without native search");
  assert.ok(
    unsupportedDefault.promptNote && /no fallback search provider/.test(unsupportedDefault.promptNote),
    "honest note when neither native nor fallback search exists",
  );
});

test("composeWebTools: HUB_WEB_TOOLS=off removes BOTH tools everywhere; a note only when a scope requested one", () => {
  // The kill switch is absolute and is checked BEFORE the capability default, so widening that default
  // to mission agents (web-access-fix) cannot leak past an operator who turned web off.
  const killed = composeWebTools({
    providerKind: "anthropic",
    grantedBuiltins: [HUB_WEB_SEARCH_BUILTIN, HUB_WEB_FETCH_BUILTIN],
    webToolsEnabled: false,
  });
  assert.equal(killed.searchTool, undefined, "web.search removed");
  assert.equal(killed.includeFetch, false, "web.fetch removed");
  assert.ok(
    killed.promptNote && /disabled by the operator/.test(killed.promptNote),
    "note explains the kill switch",
  );

  // No request, no note (a session that never asked for web tools isn't told they're off).
  const quiet = composeWebTools({
    providerKind: "anthropic",
    grantedBuiltins: [],
    webToolsEnabled: false,
  });
  assert.equal(quiet.promptNote, undefined);
  assert.equal(quiet.searchTool, undefined);
  assert.equal(quiet.includeFetch, false);
});

// ── (2) SSRF address guard (table-driven) ─────────────────────────────────────────────────────────

test("isBlockedIp: blocks private/loopback/link-local/CGNAT/reserved v4+v6, allows public", () => {
  const blocked = [
    "127.0.0.1",
    "10.0.0.5",
    "10.255.255.255",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254", // cloud metadata
    "100.64.0.1", // CGNAT
    "0.0.0.0",
    "224.0.0.1", // multicast
    "255.255.255.255",
    "::1", // v6 loopback
    "::", // v6 unspecified
    "fe80::1", // v6 link-local
    "fc00::1", // v6 ULA
    "fd12:3456::1", // v6 ULA
    "ff02::1", // v6 multicast
    "::ffff:127.0.0.1", // v4-mapped loopback
    "::ffff:10.0.0.1", // v4-mapped private
    "64:ff9b::a00:1", // NAT64 wrapping 10.0.0.1
    "2001:db8::1", // documentation
    "not-an-ip", // fail closed
  ];
  for (const ip of blocked) assert.equal(isBlockedIp(ip), true, `blocked: ${ip}`);

  const allowed = ["93.184.216.34", "1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"];
  for (const ip of allowed) assert.equal(isBlockedIp(ip), false, `allowed: ${ip}`);
});

test("assertPublicHttpUrl: rejects non-http(s), embedded credentials, and private IP literals; accepts a public URL", () => {
  assert.throws(() => assertPublicHttpUrl("ftp://example.com/x"), WebFetchError);
  assert.throws(() => assertPublicHttpUrl("file:///etc/passwd"), WebFetchError);
  assert.throws(() => assertPublicHttpUrl("http://user:pass@example.com/"), WebFetchError);
  assert.throws(() => assertPublicHttpUrl("http://127.0.0.1/"), WebFetchError);
  assert.throws(() => assertPublicHttpUrl("http://[::1]/"), WebFetchError);
  assert.throws(
    () => assertPublicHttpUrl("http://169.254.169.254/latest/meta-data"),
    WebFetchError,
  );
  assert.doesNotThrow(() => assertPublicHttpUrl("https://example.com/page?q=1"));
});

test("guardedFetch: blocks a name that resolves to a private IP, blocks a redirect to a private target, allows a public fetch", async () => {
  const seenConnectIps: string[] = [];
  const transport: WebFetchTransport = {
    async resolveHostIps(host) {
      if (host === "internal.example") return ["10.0.0.5"]; // resolves private
      if (host === "mixed.example") return ["93.184.216.34", "127.0.0.1"]; // ANY blocked → deny
      return ["93.184.216.34"]; // everything else is public
    },
    async fetchOnce({ url, ip }) {
      seenConnectIps.push(ip);
      if (url.hostname === "rebind.example") {
        return {
          status: 302,
          location: "http://169.254.169.254/latest",
          body: "",
          truncated: false,
        };
      }
      if (url.hostname === "offsite.example") {
        return { status: 301, location: "https://good.example/final", body: "", truncated: false };
      }
      return { status: 200, contentType: "text/html", body: "<p>hello</p>", truncated: false };
    },
  };

  // A hostname that resolves to a private address is refused (never connected).
  await assert.rejects(() => guardedFetch("http://internal.example/", transport), WebFetchError);
  // A host resolving to a mix that includes a blocked IP is refused (deny-if-any).
  await assert.rejects(() => guardedFetch("http://mixed.example/", transport), WebFetchError);
  // A redirect to a link-local metadata address is refused after re-validation.
  await assert.rejects(() => guardedFetch("http://rebind.example/", transport), WebFetchError);

  // A public redirect to a public target is followed and returns the final body.
  const followed = await guardedFetch("http://offsite.example/", transport);
  assert.equal(followed.finalUrl, "https://good.example/final");
  assert.equal(followed.status, 200);
  // Every connection targeted the validated public IP (rebind-safe — never a resolved-then-re-resolved host).
  assert.ok(seenConnectIps.every((ip) => ip === "93.184.216.34"));
});

test("guardedFetch: a redirect loop past the hop cap is refused", async () => {
  const transport: WebFetchTransport = {
    async resolveHostIps() {
      return ["93.184.216.34"];
    },
    async fetchOnce({ url }) {
      return {
        status: 302,
        location: `https://loop.example/${url.pathname.length + 1}`,
        body: "",
        truncated: false,
      };
    },
  };
  await assert.rejects(
    () => guardedFetch("https://loop.example/", transport),
    /Too many redirects/,
  );
});

// ── (3) size cap + spill, text extraction ─────────────────────────────────────────────────────────

test("runWebFetch: a small page returns extracted text inline; an oversized page spills to the workspace", async () => {
  const workspaceRoot = tempDir();
  const smallTransport: WebFetchTransport = {
    async resolveHostIps() {
      return ["93.184.216.34"];
    },
    async fetchOnce() {
      return {
        status: 200,
        contentType: "text/html",
        body: "<html><body><h1>Title</h1><script>evil()</script><p>Body text.</p></body></html>",
        truncated: false,
      };
    },
  };
  const small = await runWebFetch(
    "https://ok.example/",
    { workspaceRoot, tokenCounter },
    smallTransport,
  );
  assert.equal(small.artifact, undefined, "small result is inline (no spill)");
  const content = small.modelContent as { text: string; note: string };
  assert.match(content.text, /Title/);
  assert.match(content.text, /Body text\./);
  assert.doesNotMatch(content.text, /evil\(\)/, "script content is stripped");
  assert.match(content.note, /Untrusted web content/);

  const bigTransport: WebFetchTransport = {
    async resolveHostIps() {
      return ["93.184.216.34"];
    },
    async fetchOnce() {
      return {
        status: 200,
        contentType: "text/plain",
        body: "lorem ipsum ".repeat(20_000),
        truncated: false,
      };
    },
  };
  const big = await runWebFetch(
    "https://huge.example/",
    { workspaceRoot, tokenCounter },
    bigTransport,
  );
  assert.ok(big.artifact, "oversized result spills to an artifact");
  assert.equal(big.artifact?.kind, "spill");
  assert.match(String(big.modelContent), /spilled to the session workspace/);
  assert.ok(
    big.artifact?.spillPath && fs.existsSync(path.join(workspaceRoot, big.artifact.spillPath)),
    "the spill file exists",
  );
});

test("runWebFetch: an HTTP error status is surfaced as an isError result", async () => {
  const transport: WebFetchTransport = {
    async resolveHostIps() {
      return ["93.184.216.34"];
    },
    async fetchOnce() {
      return { status: 404, body: "", truncated: false };
    },
  };
  const out = await runWebFetch(
    "https://missing.example/",
    { workspaceRoot: tempDir(), tokenCounter },
    transport,
  );
  assert.equal(out.isError, true);
  assert.match(String(out.errorText), /HTTP 404/);
});

test("extractReadableText / htmlToText: strips markup, decodes entities, keeps json/plain as-is", () => {
  assert.equal(htmlToText("<p>a &amp; b</p>"), "a & b");
  assert.match(extractReadableText("<html><body>x</body></html>", "text/html"), /x/);
  assert.equal(extractReadableText('{"k":1}', "application/json"), '{"k":1}');
});

// ── (4) citation mapping (stubbed) ────────────────────────────────────────────────────────────────

test("extractGroundingWebSources: maps Google grounding chunks to http(s) sources, skips non-web/non-http", () => {
  const meta = {
    google: {
      groundingMetadata: {
        groundingChunks: [
          { web: { uri: "https://a.example/x", title: "A" } },
          { web: { uri: "ftp://nope/x", title: "skip" } },
          { retrievedContext: { uri: "https://b.example", title: "not-web" } },
          { web: { uri: "https://c.example" } },
        ],
      },
    },
  };
  const sources = extractGroundingWebSources(meta);
  assert.deepEqual(sources, [
    { title: "A", url: "https://a.example/x" },
    { title: "https://c.example", url: "https://c.example" },
  ]);
  assert.deepEqual(extractGroundingWebSources(undefined), []);
  assert.deepEqual(extractGroundingWebSources({ google: {} }), []);
});

test("composeWebCitationPostPass: numbers web.search tool-results (Anthropic/OpenAI) and Google grounding into the citation ledger", async () => {
  const citation = beginHubCitationTurn([]);
  const post = composeWebCitationPostPass(citation, citation.postPass);
  assert.ok(post);

  const out = await post({
    messageId: "m1",
    text: "Here is a summary.",
    parts: [
      {
        type: "tool_call",
        toolCallId: "ws1",
        toolName: HUB_WEB_SEARCH_BUILTIN,
        source: "builtin",
        state: "input-available",
        args: {},
      },
      { type: "text", text: "Here is a summary." },
    ],
    toolResults: [
      {
        toolCallId: "ws1",
        toolName: HUB_WEB_SEARCH_BUILTIN,
        isError: false,
        // The Anthropic web_search_result shape the SDK surfaces as the tool-result output.
        output: [
          {
            type: "web_search_result",
            url: "https://en.wikipedia.org/wiki/Cat",
            title: "Cat — Wikipedia",
            pageAge: null,
            encryptedContent: "SECRET",
          },
        ],
      },
    ],
    providerSearchSources: [
      { title: "Google source", url: "https://example.com/g", toolCallId: "" },
    ],
  });

  const urls = out.citations?.map((c) => c.url) ?? [];
  assert.ok(
    urls.includes("https://en.wikipedia.org/wiki/Cat"),
    "web.search result became a citation",
  );
  assert.ok(urls.includes("https://example.com/g"), "Google grounding source became a citation");
  // The encrypted payload must never leak into a citation snippet.
  assert.ok(
    !JSON.stringify(out.citations).includes("SECRET"),
    "opaque provider content is never citation evidence",
  );
  // The web.search tool_call part is tagged with the citation id it produced.
  const taggedCall = out.parts?.find((p) => p.type === "tool_call") as
    | { citationIds?: string[] }
    | undefined;
  assert.ok(
    taggedCall?.citationIds && taggedCall.citationIds.length > 0,
    "the tool_call part carries its citation ids",
  );
});

test("composeWebCitationPostPass: with no citation apparatus, returns the base post-pass unchanged", () => {
  const base = () => ({ parts: [], citations: [] });
  assert.equal(composeWebCitationPostPass(undefined, base), base);
  assert.equal(composeWebCitationPostPass(undefined, undefined), undefined);
});

// ── assistant-hub v1-fixes (F6): the fallback search chain + composition + freshness ──────────────

test("v1-fixes F6: composeWebTools exposes the FALLBACK search on kinds without native search, plus the freshness rule", async () => {
  const fallback = createFallbackWebSearchTool({ duckduckgo: true }, fakeTransport({}));
  for (const kind of ["openai_compatible", "ollama", "claude_subscription"] as const) {
    const out = composeWebTools({
      providerKind: kind,
      grantedBuiltins: [],
      webToolsEnabled: true,
      fallbackSearch: fallback,
    });
    assert.equal(out.searchTool, undefined, `${kind}: no native tool`);
    assert.equal(out.fallbackSearchTool?.name, HUB_WEB_SEARCH_BUILTIN, `${kind}: fallback exposed`);
    assert.equal(out.searchExposed, true, kind);
    assert.equal(out.promptNote, undefined, `${kind}: no absence note when the fallback covers it`);
    assert.ok(out.freshnessNote?.includes("BEFORE answering"), `${kind}: freshness rule present`);
  }
  // Native kinds keep the native tool and never double-expose the fallback.
  const native = composeWebTools({
    providerKind: "anthropic",
    grantedBuiltins: [],
    webToolsEnabled: true,
    fallbackSearch: fallback,
  });
  assert.ok(native.searchTool, "native tool wins");
  assert.equal(native.fallbackSearchTool, undefined, "no fallback next to a native tool");
  assert.equal(native.freshnessNote, WEB_SEARCH_FRESHNESS_NOTE);

  // A planner-granted mission AGENT on a facade/ollama model now gets working search too.
  const agent = composeWebTools({
    providerKind: "openai_compatible",
    grantedBuiltins: [HUB_WEB_SEARCH_BUILTIN],
    webToolsEnabled: true,
    fallbackSearch: fallback,
  });
  assert.equal(agent.fallbackSearchTool?.name, HUB_WEB_SEARCH_BUILTIN);
});

function fakeTransport(responses: {
  tavily?: unknown;
  serper?: unknown;
  searxng?: unknown;
  ddgHtml?: string;
  failHosts?: string[];
  calls?: string[];
}) {
  return {
    async fetchJson(url: string): Promise<unknown> {
      const host = new URL(url).host;
      responses.calls?.push(host);
      if (responses.failHosts?.includes(host)) throw new Error(`boom ${host}`);
      if (host.includes("tavily")) return responses.tavily ?? {};
      if (host.includes("serper")) return responses.serper ?? {};
      return responses.searxng ?? {};
    },
    async fetchText(url: string): Promise<string> {
      const host = new URL(url).host;
      responses.calls?.push(host);
      if (responses.failHosts?.includes(host)) throw new Error(`boom ${host}`);
      return responses.ddgHtml ?? "";
    },
  };
}

const DDG_FIXTURE = `
<div class="result"><h2 class="result__title">
<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fweather.example%2Fnyc&amp;rut=x">NYC Weather <b>Today</b></a></h2>
<a class="result__snippet" href="#">Partly cloudy, 84°F high, 15% rain chance in New York City today.</a></div>
<div class="result"><h2 class="result__title">
<a rel="nofollow" class="result__a" href="https://forecast.example/ny">10-day forecast</a></h2>
<a class="result__snippet" href="#">Extended outlook for New York.</a></div>`;

test("v1-fixes F6: the chain prefers Tavily, normalizes results, and surfaces the answer box", async () => {
  const calls: string[] = [];
  const search = runSearchChain(
    { tavilyKey: "tk", serperKey: "sk", duckduckgo: true },
    fakeTransport({
      calls,
      tavily: {
        answer: "84°F and partly cloudy in New York today.",
        results: [
          { title: "NYC weather", url: "https://weather.example/nyc", content: "84°F, partly cloudy.", published_date: "2026-07-20" },
        ],
      },
    }),
  );
  const out = await search("weather today in NY");
  assert.equal(out.provider, "tavily");
  assert.equal(out.answerBox, "84°F and partly cloudy in New York today.");
  assert.deepEqual(out.results[0], {
    title: "NYC weather",
    url: "https://weather.example/nyc",
    snippet: "84°F, partly cloudy.",
    publishedDate: "2026-07-20",
  });
  assert.deepEqual(calls, ["api.tavily.com"], "serper/ddg never called when tavily answers");
});

test("v1-fixes F6: a failing keyed provider falls through the chain to the DDG scrape, honestly labeled degraded", async () => {
  const calls: string[] = [];
  const search = runSearchChain(
    { tavilyKey: "tk", duckduckgo: true },
    fakeTransport({ calls, failHosts: ["api.tavily.com"], ddgHtml: DDG_FIXTURE }),
  );
  const out = await search("weather today in NY");
  assert.equal(out.provider, "duckduckgo");
  assert.equal(out.note, DDG_DEGRADED_NOTE);
  assert.equal(out.results.length, 2);
  assert.equal(out.results[0]?.url, "https://weather.example/nyc", "the DDG redirect is decoded");
  assert.equal(out.results[0]?.title, "NYC Weather Today", "tags are stripped from titles");
  assert.match(out.results[0]?.snippet ?? "", /84°F high/);
  assert.deepEqual(calls, ["api.tavily.com", "html.duckduckgo.com"]);
});

test("v1-fixes F6: serper answerBox is surfaced; searxng answers map too", async () => {
  const serperSearch = runSearchChain(
    { serperKey: "sk", duckduckgo: false },
    fakeTransport({
      serper: {
        answerBox: { answer: "84°F" },
        organic: [{ title: "Weather NYC", link: "https://g.example/w", snippet: "84°F today." }],
      },
    }),
  );
  const serperOut = await serperSearch("weather in NY");
  assert.equal(serperOut.provider, "serper");
  assert.equal(serperOut.answerBox, "84°F");

  const searxSearch = runSearchChain(
    { searxngUrl: "https://searx.local", duckduckgo: false },
    fakeTransport({
      searxng: {
        answers: ["84°F in NYC"],
        results: [{ title: "NYC", url: "https://w.example", content: "warm" }],
      },
    }),
  );
  const searxOut = await searxSearch("weather in NY");
  assert.equal(searxOut.provider, "searxng");
  assert.equal(searxOut.answerBox, "84°F in NYC");
});

test("v1-fixes F6: results are cached for the TTL (a retried query never re-hits the provider)", async () => {
  const calls: string[] = [];
  const search = runSearchChain(
    { tavilyKey: "tk", duckduckgo: false },
    fakeTransport({ calls, tavily: { results: [{ title: "A", url: "https://a.example", content: "a" }] } }),
  );
  let clock = 1_000_000;
  const now = () => clock;
  await search("same query", now);
  await search("same query", now);
  assert.equal(calls.length, 1, "second identical query served from cache");
  clock += 16 * 60 * 1000; // past the 15-minute TTL
  await search("same query", now);
  assert.equal(calls.length, 2, "expired cache re-queries the provider");
});

test("v1-fixes F6: describeSearchChain reflects the configured links in order", () => {
  assert.deepEqual(describeSearchChain({}), ["duckduckgo"]);
  assert.deepEqual(describeSearchChain({ duckduckgo: false }), []);
  assert.deepEqual(
    describeSearchChain({ tavilyKey: "a", serperKey: "b", searxngUrl: "c" }),
    ["tavily", "serper", "searxng", "duckduckgo"],
  );
});

test("v1-fixes F6: the fallback builtin executes a full search through safe input validation", async () => {
  const tool = createFallbackWebSearchTool(
    { tavilyKey: "tk", duckduckgo: false },
    fakeTransport({ tavily: { results: [{ title: "T", url: "https://t.example", content: "c" }] } }),
  );
  assert.equal(tool.name, HUB_WEB_SEARCH_BUILTIN);
  assert.equal(tool.annotations?.readOnlyHint, true);
  const out = await tool.execute({ query: "anything" }, {} as never);
  const content = out.modelContent as { provider: string; results: unknown[] };
  assert.equal(content.provider, "tavily");
  assert.equal(content.results.length, 1);
});

test("v1-fixes F6: extractPageMarkdown produces reader markdown for a real article and falls back for junk", async () => {
  const article = `<!doctype html><html><head><title>Quarterly results</title></head><body>
    <nav><a href="/">Home</a><a href="/about">About</a><a href="/contact">Contact</a></nav>
    <article><h1>Quarterly results</h1>
    <p>${"Revenue grew strongly across all regions this quarter. ".repeat(12)}</p>
    <p>Wealth management remained the dominant product area with continued momentum.</p>
    </article>
    <footer>Copyright — legal — privacy — cookie settings</footer></body></html>`;
  const extracted = await extractPageMarkdown(article, "text/html", "https://example.com/q");
  assert.equal(extracted.extractor, "defuddle");
  assert.match(extracted.text, /Revenue grew strongly/);
  assert.ok(!extracted.text.includes("cookie settings"), "boilerplate removed");

  const nonHtml = await extractPageMarkdown('{"a":1}', "application/json", "https://api.example/x");
  assert.equal(nonHtml.extractor, "plain");
  assert.equal(nonHtml.text, '{"a":1}');
});
