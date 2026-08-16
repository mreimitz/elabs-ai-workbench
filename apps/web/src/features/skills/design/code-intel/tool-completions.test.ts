import { describe, expect, it } from "vitest";
import type { BoundTool } from "@mcp-token-footprint/shared";
import type { MonacoApi, MonacoEditor, MonacoModel } from "./monaco-types";
import {
  buildToolCompletionItems,
  getToolCompletionContext,
  registerToolCompletionProvider,
  type ToolCompletionContext,
} from "./tool-completions";

// Skill Studio SI9 — the tool-name completion behavior lock. Three layers, mirroring the module:
// the PURE context decision (when completions may fire, and over which span), the PURE item mapper
// (which bound tools are offered, with what insert/detail/sort), and the registered provider's
// gates (scope, unbound silence, frontmatter, backtick deferral to WP 8.2, lazy async arrival).

function tool(name: string, server: string, tokens: number, description?: string): BoundTool {
  return {
    serverId: `srv-${server}`,
    serverName: server,
    toolName: name,
    ...(description !== undefined ? { description } : {}),
    schemaParams: [],
    definitionTokens: tokens,
  };
}

const TOOLS: BoundTool[] = [
  tool("qlik_connect", "Qlik Cloud", 95, "Open an authenticated connection to the tenant."),
  tool("qlik_create_data_object", "Qlik Cloud", 210, "Create a data object in the current app."),
  tool("atlas_search", "Atlas", 40),
];

// ── getToolCompletionContext — the pure per-line decision ───────────────────────────────────────────

describe("getToolCompletionContext — bare words", () => {
  it("fires on a word at the START of a line (cursor at its end)", () => {
    expect(getToolCompletionContext("qli", 4)).toEqual({
      replaceRange: { startColumn: 1, endColumn: 4 },
      query: "qli",
      backticked: false,
    });
  });

  it("fires on the owner's repro — `qlik_` alone on a line", () => {
    expect(getToolCompletionContext("qlik_", 6)).toEqual({
      replaceRange: { startColumn: 1, endColumn: 6 },
      query: "qlik_",
      backticked: false,
    });
  });

  it("fires MID-word and replaces the WHOLE word (query = typed part before the cursor)", () => {
    // "Use qlik_search now", cursor after "qlik_" (col 10): word spans cols 5..15.
    expect(getToolCompletionContext("Use qlik_search now", 10)).toEqual({
      replaceRange: { startColumn: 5, endColumn: 16 },
      query: "qlik_",
      backticked: false,
    });
  });

  it("fires on a word at the END of a line", () => {
    expect(getToolCompletionContext("Run qlik_se", 12)).toEqual({
      replaceRange: { startColumn: 5, endColumn: 12 },
      query: "qlik_se",
      backticked: false,
    });
  });

  it("fires on a word in the MIDDLE of a line, stopping the range at the word end", () => {
    expect(getToolCompletionContext("qlik_ and more", 6)).toEqual({
      replaceRange: { startColumn: 1, endColumn: 6 },
      query: "qlik_",
      backticked: false,
    });
  });

  it("fires after punctuation (a clean non-identifier boundary)", () => {
    expect(getToolCompletionContext("(qlik_", 7)).toEqual({
      replaceRange: { startColumn: 2, endColumn: 7 },
      query: "qlik_",
      backticked: false,
    });
  });

  it("returns a context for ordinary prose words too — the MAPPER's prefix gate decides", () => {
    expect(getToolCompletionContext("hello", 6)).toEqual({
      replaceRange: { startColumn: 1, endColumn: 6 },
      query: "hello",
      backticked: false,
    });
  });

  it("does NOT fire under 3 typed chars (conservative)", () => {
    expect(getToolCompletionContext("ql", 3)).toBeNull();
    expect(getToolCompletionContext("Use ql then", 7)).toBeNull();
  });

  it("does NOT fire on an empty line or at column 1 (nothing typed)", () => {
    expect(getToolCompletionContext("", 1)).toBeNull();
    expect(getToolCompletionContext("qlik_", 1)).toBeNull();
  });

  it("does NOT fire mid-identifier after an uppercase start (`Qlik_search`)", () => {
    expect(getToolCompletionContext("Qlik_search", 12)).toBeNull();
  });

  it("does NOT fire when the word continues in uppercase past the cursor (`qlik_Search`)", () => {
    expect(getToolCompletionContext("qlik_Search", 6)).toBeNull();
  });

  it("does NOT fire on a word starting with a digit", () => {
    expect(getToolCompletionContext("2fa_code", 9)).toBeNull();
  });
});

describe("getToolCompletionContext — backticks", () => {
  it("fires inside an unterminated inline-code span", () => {
    expect(getToolCompletionContext("`qlik_", 7)).toEqual({
      replaceRange: { startColumn: 2, endColumn: 7 },
      query: "qlik_",
      backticked: true,
    });
  });

  it("fires right after an opening backtick with an EMPTY query (no 3-char gate in code context)", () => {
    expect(getToolCompletionContext("`", 2)).toEqual({
      replaceRange: { startColumn: 2, endColumn: 2 },
      query: "",
      backticked: true,
    });
  });

  it("fires mid-span in a TERMINATED span and replaces the whole span content", () => {
    // "`qlik_search`", cursor after "qlik_" (col 7): inner content spans cols 2..12.
    expect(getToolCompletionContext("`qlik_search`", 7)).toEqual({
      replaceRange: { startColumn: 2, endColumn: 13 },
      query: "qlik_",
      backticked: true,
    });
  });

  it("treats a cursor AFTER a closed span as a bare context again (even parity)", () => {
    expect(getToolCompletionContext("`qlik_search` then qlik_", 25)).toEqual({
      replaceRange: { startColumn: 20, endColumn: 25 },
      query: "qlik_",
      backticked: false,
    });
  });

  it("does NOT fire inside a span whose typed content is not a tool token (`foo bar…)", () => {
    expect(getToolCompletionContext("`foo bar", 9)).toBeNull();
  });
});

describe("getToolCompletionContext — frontmatter", () => {
  it("NEVER fires on a line flagged as frontmatter, even with a tool-like word", () => {
    expect(getToolCompletionContext("servers: qlik_", 15, { inFrontmatter: true })).toBeNull();
    expect(
      getToolCompletionContext("description: use qlik_tools", 22, { inFrontmatter: true }),
    ).toBeNull();
    expect(getToolCompletionContext("---", 4, { inFrontmatter: true })).toBeNull();
  });

  it("fires on the SAME line when it is body text (the flag decides, not the shape)", () => {
    expect(getToolCompletionContext("servers: qlik_", 15)).toEqual({
      replaceRange: { startColumn: 10, endColumn: 15 },
      query: "qlik_",
      backticked: false,
    });
  });
});

// ── buildToolCompletionItems — the pure item mapper ─────────────────────────────────────────────────

const bareContext = (query: string): ToolCompletionContext => ({
  replaceRange: { startColumn: 1, endColumn: query.length + 1 },
  query,
  backticked: false,
});

describe("buildToolCompletionItems", () => {
  it("offers the prefix-matching subset for `qlik_c`, backticked insert, server · tokens detail", () => {
    const items = buildToolCompletionItems(bareContext("qlik_c"), TOOLS);
    expect(items.map((item) => item.label)).toEqual(["qlik_connect", "qlik_create_data_object"]);
    expect(items.map((item) => item.insertText)).toEqual([
      "`qlik_connect`",
      "`qlik_create_data_object`",
    ]);
    expect(items[0]?.detail).toBe("Qlik Cloud · 95 tok");
    expect(items[1]?.detail).toBe("Qlik Cloud · 210 tok");
    expect(items[0]?.documentation).toBe("Open an authenticated connection to the tenant.");
    expect(items.every((item) => item.sortText.startsWith("0_"))).toBe(true);
  });

  it("inserts the BARE name when the context is already inside backticks", () => {
    const items = buildToolCompletionItems({ ...bareContext("qlik_c"), backticked: true }, TOOLS);
    expect(items.map((item) => item.insertText)).toEqual([
      "qlik_connect",
      "qlik_create_data_object",
    ]);
  });

  it("returns [] when the skill has no bound tools (unbound → silence)", () => {
    expect(buildToolCompletionItems(bareContext("qlik_c"), [])).toEqual([]);
  });

  it("returns [] for a prose word that shares no prefix with any bound tool", () => {
    expect(buildToolCompletionItems(bareContext("hello"), TOOLS)).toEqual([]);
  });

  it("returns [] on a substring-only hit — the prefix match against the bound list decides firing", () => {
    // "search" sits inside atlas_search but no tool STARTS with it → nothing pops mid-sentence.
    expect(buildToolCompletionItems(bareContext("search"), TOOLS)).toEqual([]);
  });

  it("offers EVERY tool on an empty query (a just-opened backtick span)", () => {
    const items = buildToolCompletionItems(
      { replaceRange: { startColumn: 2, endColumn: 2 }, query: "", backticked: true },
      TOOLS,
    );
    expect(items.map((item) => item.label)).toEqual([
      "atlas_search",
      "qlik_connect",
      "qlik_create_data_object",
    ]);
  });

  it("ranks exact-prefix matches before substring matches via sortText", () => {
    const pair = [tool("qlik_search", "S", 10), tool("super_qlik_tool", "S", 20)];
    const items = buildToolCompletionItems(bareContext("qlik"), pair);
    expect(items.map((item) => [item.label, item.sortText])).toEqual([
      ["qlik_search", "0_qlik_search"],
      ["super_qlik_tool", "1_super_qlik_tool"],
    ]);
  });

  it("formats large token counts with the locale separator", () => {
    const items = buildToolCompletionItems(bareContext("big"), [tool("big_tool", "S", 1234)]);
    expect(items[0]?.detail).toBe(`S · ${(1234).toLocaleString()} tok`);
  });

  it("excerpts a long description and leaves documentation empty when the scan has none", () => {
    const long = "word ".repeat(60).trim();
    const items = buildToolCompletionItems(bareContext("qlik"), [
      tool("qlik_long", "S", 5, long),
      tool("qlik_bare", "S", 6),
    ]);
    const withDoc = items.find((item) => item.label === "qlik_long");
    const withoutDoc = items.find((item) => item.label === "qlik_bare");
    expect(withDoc?.documentation.endsWith("…")).toBe(true);
    expect(withDoc?.documentation.length).toBeLessThanOrEqual(201);
    expect(withoutDoc?.documentation).toBe("");
  });
});

// ── registerToolCompletionProvider — the provider's gates over a stub Monaco ────────────────────────

type StubPosition = { lineNumber: number; column: number };
type StubSuggestion = {
  label: string;
  kind: number;
  insertText: string;
  detail: string;
  sortText: string;
  documentation?: { value: string };
  range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number };
};
type StubProvider = {
  triggerCharacters?: string[];
  provideCompletionItems: (
    model: MonacoModel,
    position: StubPosition,
  ) => { suggestions: StubSuggestion[] };
};

function stubModel(text: string): MonacoModel {
  const lines = text.split(/\r?\n/);
  return {
    getValue: () => text,
    getLineCount: () => lines.length,
    getLineContent: (line: number) => lines[line - 1] ?? "",
  } as unknown as MonacoModel;
}

function stubHarness(model: MonacoModel) {
  const state: { provider: StubProvider | null; disposed: number } = {
    provider: null,
    disposed: 0,
  };
  const monacoApi = {
    languages: {
      CompletionItemKind: { Function: 3 },
      registerCompletionItemProvider: (_language: string, provider: StubProvider) => {
        state.provider = provider;
        return {
          dispose: () => {
            state.disposed += 1;
          },
        };
      },
    },
  } as unknown as MonacoApi;
  const editor = { getModel: () => model } as unknown as MonacoEditor;
  return { monacoApi, editor, state };
}

const DOC = "---\nname: demo\nservers: qlik_\n---\nUse qlik_";

describe("registerToolCompletionProvider", () => {
  it("registers with '`' and '_' trigger characters and disposes exactly once", () => {
    const { monacoApi, editor, state } = stubHarness(stubModel(DOC));
    const disposer = registerToolCompletionProvider(monacoApi, editor, {
      getBoundTools: () => TOOLS,
    });
    expect(state.provider?.triggerCharacters).toEqual(["`", "_"]);
    disposer.dispose();
    expect(state.disposed).toBe(1);
  });

  it("reads the CURRENT bound tools lazily — an async-arriving list works without re-registration", () => {
    const model = stubModel(DOC);
    const { monacoApi, editor, state } = stubHarness(model);
    let tools: BoundTool[] = []; // the fetch has not landed yet
    registerToolCompletionProvider(monacoApi, editor, { getBoundTools: () => tools });
    const position: StubPosition = { lineNumber: 5, column: 10 }; // "Use qlik_" ▮
    expect(state.provider?.provideCompletionItems(model, position).suggestions).toEqual([]);
    tools = TOOLS; // …now it lands (the WP 7.5 async-arrival path)
    const suggestions = state.provider?.provideCompletionItems(model, position).suggestions ?? [];
    expect(suggestions.map((item) => item.label)).toEqual([
      "qlik_connect",
      "qlik_create_data_object",
    ]);
  });

  it("maps items to Monaco shape: Function kind, backticked insert, line-qualified word range", () => {
    const model = stubModel(DOC);
    const { monacoApi, editor, state } = stubHarness(model);
    registerToolCompletionProvider(monacoApi, editor, { getBoundTools: () => TOOLS });
    const suggestions =
      state.provider?.provideCompletionItems(model, { lineNumber: 5, column: 10 }).suggestions ??
      [];
    expect(suggestions[0]).toMatchObject({
      label: "qlik_connect",
      kind: 3,
      insertText: "`qlik_connect`",
      detail: "Qlik Cloud · 95 tok",
      sortText: "0_qlik_connect",
      documentation: { value: "Open an authenticated connection to the tenant." },
      range: { startLineNumber: 5, startColumn: 5, endLineNumber: 5, endColumn: 10 },
    });
  });

  it("yields nothing inside the YAML frontmatter block", () => {
    const model = stubModel(DOC);
    const { monacoApi, editor, state } = stubHarness(model);
    registerToolCompletionProvider(monacoApi, editor, { getBoundTools: () => TOOLS });
    const result = state.provider?.provideCompletionItems(model, { lineNumber: 3, column: 15 });
    expect(result?.suggestions).toEqual([]);
  });

  it("DEFERS backticked contexts to WP 8.2's provider (no double suggestions)", () => {
    const model = stubModel("Use `qlik_");
    const { monacoApi, editor, state } = stubHarness(model);
    registerToolCompletionProvider(monacoApi, editor, { getBoundTools: () => TOOLS });
    const result = state.provider?.provideCompletionItems(model, { lineNumber: 1, column: 11 });
    expect(result?.suggestions).toEqual([]);
  });

  it("yields nothing when the skill has no bound tools (no noise)", () => {
    const model = stubModel(DOC);
    const { monacoApi, editor, state } = stubHarness(model);
    registerToolCompletionProvider(monacoApi, editor, { getBoundTools: () => [] });
    const result = state.provider?.provideCompletionItems(model, { lineNumber: 5, column: 10 });
    expect(result?.suggestions).toEqual([]);
  });

  it("only answers for ITS editor's model (scope guard)", () => {
    const model = stubModel(DOC);
    const foreign = stubModel("Use qlik_");
    const { monacoApi, editor, state } = stubHarness(model);
    registerToolCompletionProvider(monacoApi, editor, { getBoundTools: () => TOOLS });
    const result = state.provider?.provideCompletionItems(foreign, { lineNumber: 1, column: 10 });
    expect(result?.suggestions).toEqual([]);
  });
});
