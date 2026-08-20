// Assistant Hub (planning/Roadmap/RM-03-assistant-hub/, WP1.4, §1.7 / D-AH10 / R-UX5) — the first-class citation
// pipeline: extraction → stable-per-session numbering → numbered-envelope injection → the `[n]`→
// `citations[]` post-pass. The HEADLINE is the resolve-test (Acceptance): drive a stubbed tool result
// carrying sources through a real turn → the model cites `[n]` → EVERY rendered marker resolves to a
// real source, and numbering does not drift across turns.

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import type { HubCitation, HubEvent, HubSession, HubToolPart } from "@mcp-token-footprint/shared";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { jsonSchema, tool, type Tool } from "ai";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { hubCapabilitiesForKind } from "../src/hub/capabilities.js";
import { HubRepository } from "../src/hub/repository.js";
import {
  beginHubCitationTurn,
  extractCitationSources,
  findCitationMarkers,
  HubCitationLedger,
  injectCitationEnvelope,
  reconstructCitationBaseline,
  wrapToolsetWithCitations,
} from "../src/hub/citations.js";
import { HubSteeringQueue, runHubTurn, type HubResolvedToolset } from "../src/hub/turn-engine.js";

type MockStreamResult = Awaited<ReturnType<NonNullable<MockLanguageModelV3["doStream"]>>>;
type V3Part = MockStreamResult["stream"] extends ReadableStream<infer P> ? P : never;

const USAGE = {
  inputTokens: { total: 12, noCache: 12, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 7, text: 7, reasoning: 0 },
} as const;

const databases: AppDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function openRepo(): HubRepository {
  const db = new Database(":memory:") as unknown as AppDatabase;
  databases.push(db);
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  return new HubRepository(db);
}

function streamOf(chunks: V3Part[]) {
  return { stream: simulateReadableStream({ chunks }) };
}

// ── (A) extraction — structured content first, then url/title heuristics (§1.7) ────────────────────

test("extractCitationSources lifts sources from a structuredContent results array", () => {
  const result = {
    structuredContent: {
      results: [
        { title: "MCP spec", url: "https://modelcontextprotocol.io/spec", snippet: "The spec." },
        { title: "Token counting", url: "https://example.com/tokens" },
      ],
    },
    content: [{ type: "text", text: "see the results" }],
  };
  const sources = extractCitationSources(result);
  assert.deepEqual(
    sources.map((s) => s.url),
    ["https://modelcontextprotocol.io/spec", "https://example.com/tokens"],
  );
  assert.equal(sources[0]?.title, "MCP spec");
  assert.equal(sources[0]?.snippet, "The spec.");
});

test("extractCitationSources mines markdown links + bare URLs from text content, deduped", () => {
  const result = {
    content: [
      {
        type: "text",
        text: "See [the docs](https://docs.example.com/a) and https://docs.example.com/a again.",
      },
      { type: "text", text: "Also https://other.example.org/page." },
    ],
  };
  const sources = extractCitationSources(result);
  // The markdown link + the identical bare URL collapse to ONE source; the second bare URL is distinct.
  assert.deepEqual(
    sources.map((s) => s.url),
    ["https://docs.example.com/a", "https://other.example.org/page"],
  );
  assert.equal(sources[0]?.title, "the docs", "markdown link text wins as the title");
});

test("extractCitationSources drops non-http URLs and returns [] for a source-less result", () => {
  assert.deepEqual(
    extractCitationSources({ content: [{ type: "text", text: "no links here" }] }),
    [],
  );
  assert.deepEqual(
    extractCitationSources({
      structuredContent: { url: "ftp://nope.example.com/x", title: "bad" },
    }),
    [],
    "a non-http(s) scheme is not a citable source",
  );
});

// ── (B) stable per-session numbering (the ledger) ──────────────────────────────────────────────────

test("HubCitationLedger numbers new sources sequentially and reuses a number for a repeated URL", () => {
  const ledger = new HubCitationLedger();
  const first = ledger.record("call-1", [
    { title: "A", url: "https://a.example.com/" },
    { title: "B", url: "https://b.example.com/" },
  ]);
  assert.deepEqual(
    first.map((c) => c.id),
    ["1", "2"],
  );
  // A different call re-surfaces A (same URL, different casing/trailing) → reuses [1]; C is new → [3].
  const second = ledger.record("call-2", [
    { title: "A again", url: "https://a.example.com" },
    { title: "C", url: "https://c.example.com/" },
  ]);
  assert.deepEqual(
    second.map((c) => c.id),
    ["1", "3"],
  );
  assert.equal(ledger.resolve(1)?.url, "https://a.example.com/");
  assert.deepEqual(
    ledger.citationsForCall("call-1").map((c) => c.id),
    ["1", "2"],
  );
  assert.deepEqual(
    ledger.all().map((c) => c.id),
    ["1", "2", "3"],
  );
});

test("a ledger seeded from a baseline CONTINUES numbering (no drift across turns)", () => {
  const baseline: HubCitation[] = [
    { id: "1", title: "A", url: "https://a.example.com/" },
    { id: "2", title: "B", url: "https://b.example.com/" },
  ];
  const ledger = new HubCitationLedger(baseline);
  // Re-seeing A keeps [1]; a genuinely new source continues at [3], never re-using or shuffling.
  assert.equal(ledger.record("c", [{ title: "A", url: "https://a.example.com/" }])[0]?.id, "1");
  assert.equal(ledger.record("c", [{ title: "D", url: "https://d.example.com/" }])[0]?.id, "3");
});

test("reconstructCitationBaseline gathers prior assistant_message citations by id", () => {
  const events: HubEvent[] = [
    { type: "user_message", messageId: "u1", text: "hi" },
    {
      type: "assistant_message",
      messageId: "a1",
      model: "gpt-4o",
      parts: [],
      citations: [{ id: "1", title: "A", url: "https://a.example.com/" }],
      artifactsTouched: [],
    },
  ];
  const baseline = reconstructCitationBaseline(events);
  assert.deepEqual(
    baseline.map((c) => c.id),
    ["1"],
  );
});

// ── (C) envelope injection + marker parsing ────────────────────────────────────────────────────────

test("injectCitationEnvelope augments an object result additively (original shape preserved)", () => {
  const out = injectCitationEnvelope({ structuredContent: { rows: 3 }, isError: false }, [
    { id: "1", title: "A", url: "https://a.example.com/" },
  ]) as Record<string, unknown>;
  assert.deepEqual(out.structuredContent, { rows: 3 }); // original preserved (R-MCP6 rendering still works)
  assert.equal(out.isError, false); // error detection still works
  assert.deepEqual(out.availableCitations, [
    { n: 1, cite: "[1]", title: "A", url: "https://a.example.com/" },
  ]);
});

test("findCitationMarkers returns the distinct [n] numbers in order", () => {
  assert.deepEqual(findCitationMarkers("Paris[1] is the capital[2][1]. Berlin[3]."), [1, 2, 3]);
  assert.deepEqual(findCitationMarkers("no markers"), []);
});

// ── (D) the toolset wrapper only touches MCP tools ─────────────────────────────────────────────────

function stubTool(output: unknown): Tool {
  return tool({
    description: "stub",
    inputSchema: jsonSchema<{ q?: string }>({
      type: "object",
      properties: { q: { type: "string" } },
    }),
    execute: async () => output,
  });
}

test("wrapToolsetWithCitations wraps only mcp-source tools; a wrapped call records + injects", async () => {
  const ledger = new HubCitationLedger();
  const toolset: HubResolvedToolset = {
    tools: {
      web_search: stubTool({
        structuredContent: { results: [{ title: "A", url: "https://a.example.com/" }] },
      }),
      files_read: stubTool({ text: "https://ignored.example.com/ inside a builtin" }),
    },
    sources: { web_search: "mcp", files_read: "builtin" },
  };
  const wrapped = wrapToolsetWithCitations(toolset, ledger);

  const searchExec = (
    wrapped.tools.web_search as { execute: (i: unknown, o: unknown) => Promise<unknown> }
  ).execute;
  const searchOut = (await searchExec({}, { toolCallId: "call-1" })) as Record<string, unknown>;
  assert.ok(
    Array.isArray(searchOut.availableCitations),
    "the mcp tool result carries the numbered list",
  );
  assert.deepEqual(
    ledger.citationsForCall("call-1").map((c) => c.id),
    ["1"],
  );

  const filesExec = (
    wrapped.tools.files_read as { execute: (i: unknown, o: unknown) => Promise<unknown> }
  ).execute;
  const filesOut = (await filesExec({}, { toolCallId: "call-2" })) as Record<string, unknown>;
  assert.equal(
    filesOut.availableCitations,
    undefined,
    "a builtin tool is never mined for citations",
  );
  assert.equal(ledger.citationsForCall("call-2").length, 0);
});

// ── (E) THE RESOLVE-TEST (headline) — full turn: tool w/ sources → model cites [n] → citations[] ────

/** A mock model that (step 1) calls `web_search`, then (step 2) answers citing `[1]`. */
function mockSearchThenCite(answerText: string): MockLanguageModelV3 {
  let call = 0;
  return new MockLanguageModelV3({
    doStream: async () => {
      call += 1;
      if (call === 1) {
        return streamOf([
          { type: "stream-start", warnings: [] },
          {
            type: "tool-call",
            toolCallId: "tc-1",
            toolName: "web_search",
            input: JSON.stringify({ q: "capital of france" }),
          },
          {
            type: "finish",
            finishReason: { unified: "tool-calls", raw: "tool_use" },
            usage: USAGE,
          },
        ]);
      }
      return streamOf([
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: answerText },
        { type: "text-end", id: "t1" },
        { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: USAGE },
      ]);
    },
  });
}

function searchToolset(output: unknown, ledger: HubCitationLedger): HubResolvedToolset {
  return wrapToolsetWithCitations(
    { tools: { web_search: stubTool(output) }, sources: { web_search: "mcp" } },
    ledger,
  );
}

function assistantMessages(events: HubEvent[]) {
  return events.filter(
    (e): e is Extract<HubEvent, { type: "assistant_message" }> => e.type === "assistant_message",
  );
}

async function runOneTurn(
  repo: HubRepository,
  session: HubSession,
  userText: string,
  userMsgId: string,
  toolOutput: unknown,
  answerText: string,
): Promise<void> {
  repo.appendEvent(session.id, { type: "user_message", messageId: userMsgId, text: userText });
  const citation = beginHubCitationTurn(repo.listEvents(session.id));
  await runHubTurn(
    { repository: repo },
    {
      session: repo.getSession(session.id),
      promptMode: "chat",
      model: mockSearchThenCite(answerText),
      providerKind: "openai",
      modelId: "gpt-4o",
      capabilities: hubCapabilitiesForKind("openai"),
      contextWindow: 128000,
      toolset: searchToolset(toolOutput, citation.ledger),
      abortSignal: new AbortController().signal,
      steering: new HubSteeringQueue(session.id, repo),
      sink: { onEvent: () => undefined, onDelta: () => undefined },
      citationPostPass: citation.postPass,
    },
  );
}

test("RESOLVE-TEST: a cited [n] maps to a real source; the tool part carries its citation ids", async () => {
  const repo = openRepo();
  const session = repo.createSession({ mode: "research", model: "gpt-4o" });
  await runOneTurn(
    repo,
    session,
    "What is the capital of France?",
    "u1",
    {
      structuredContent: {
        results: [
          {
            title: "France — Wikipedia",
            url: "https://en.wikipedia.org/wiki/France",
            snippet: "Paris is the capital of France.",
          },
        ],
      },
    },
    "The capital of France is Paris[1].",
  );

  const events = repo.listEvents(session.id);
  const [am] = assistantMessages(events);
  assert.ok(am);

  // Every rendered [n] resolves to a real source (R-UX5): the answer cited [1] and citations[] has it.
  const markers = findCitationMarkers("The capital of France is Paris[1].");
  for (const n of markers) {
    assert.ok(
      am.citations.some((c) => Number(c.id) === n),
      `marker [${n}] resolves to a citation`,
    );
  }
  assert.equal(am.citations.length, 1);
  assert.equal(am.citations[0]?.id, "1");
  assert.equal(am.citations[0]?.url, "https://en.wikipedia.org/wiki/France");
  assert.equal(
    am.citations[0]?.toolCallRef,
    "tc-1",
    "the citation is traced back to the tool call",
  );

  // The tool part is tagged with the citation ids it produced (per-message Sources grouping).
  const toolPart = am.parts.find((p): p is HubToolPart => p.type === "tool_call");
  assert.deepEqual(toolPart?.citationIds, ["1"]);

  // The model-visible tool result carried the numbered envelope (what the model cited FROM).
  const toolResult = events.find(
    (e): e is Extract<HubEvent, { type: "tool_result" }> => e.type === "tool_result",
  );
  const modelContent = toolResult?.modelContent as { availableCitations?: unknown[] } | undefined;
  assert.ok(
    Array.isArray(modelContent?.availableCitations),
    "the numbered source list reached the model",
  );
});

test("RESOLVE-TEST: an orphan marker (no such source) never lands in citations[]", async () => {
  const repo = openRepo();
  const session = repo.createSession({ mode: "research", model: "gpt-4o" });
  await runOneTurn(
    repo,
    session,
    "Tell me about Rome.",
    "u1",
    {
      structuredContent: {
        results: [{ title: "Rome", url: "https://en.wikipedia.org/wiki/Rome" }],
      },
    },
    "Rome is the capital of Italy[1]. Fabricated fact[7].", // [7] has no source
  );
  const [am] = assistantMessages(repo.listEvents(session.id));
  assert.deepEqual(
    am?.citations.map((c) => c.id),
    ["1"],
    "only the resolvable marker's source is kept",
  );
  assert.ok(
    !am?.citations.some((c) => c.id === "7"),
    "the orphan [7] is never fabricated into a source",
  );
});

test("NO DRIFT: across two turns a re-cited source keeps its number and a new source continues", async () => {
  const repo = openRepo();
  const session = repo.createSession({ mode: "research", model: "gpt-4o" });

  // Turn 1: source A → [1].
  await runOneTurn(
    repo,
    session,
    "First question",
    "u1",
    { structuredContent: { results: [{ title: "A", url: "https://a.example.com/" }] } },
    "Answer one[1].",
  );

  // Turn 2: the tool returns A again (reuse [1]) AND a new source B → B must be [2], not [1].
  await runOneTurn(
    repo,
    session,
    "Second question",
    "u2",
    {
      structuredContent: {
        results: [
          { title: "A", url: "https://a.example.com/" },
          { title: "B", url: "https://b.example.com/" },
        ],
      },
    },
    "Answer two cites both[1][2].",
  );

  const [first, second] = assistantMessages(repo.listEvents(session.id));
  assert.deepEqual(
    first?.citations.map((c) => c.id),
    ["1"],
  );
  // Turn 2 resolves BOTH markers; A is STILL [1] (no drift), B is the continued [2].
  const t2 = new Map(second?.citations.map((c) => [c.id, c.url]));
  assert.equal(t2.get("1"), "https://a.example.com/", "A keeps [1] across turns");
  assert.equal(t2.get("2"), "https://b.example.com/", "B is the new [2], numbering continued");
  assert.equal(t2.size, 2);
});
