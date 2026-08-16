import { describe, expect, it } from "vitest";
import {
  findUnknownToolReferences,
  formatUnknownToolWarning,
  isToolLikeName,
  matchToolReferences,
  parseUnknownToolWarning,
  type ToolReferenceMatch,
} from "./tool-references";

// Skill Studio WP 7.5 (SI7) — the matcher's behavior lock. Every rule the decoration + hover +
// problems surfaces depend on is pinned here: known matching (bare + backticked, word-boundary,
// case-sensitive), unknown-toollike (backticked-only, shape-gated, conservative), frontmatter and
// fence handling, heading/bold resilience, and longest-match resolution of overlapping names.

const KNOWN = ["qlik_search", "qlik_get_data_model", "qlik_create_data_object"];

/** Terser assertions: pick `[kind, name, line, startColumn, backticked]` tuples. */
function tuples(matches: ToolReferenceMatch[]): Array<[string, string, number, number, boolean]> {
  return matches.map((m) => [m.kind, m.name, m.line, m.startColumn, m.backticked]);
}

describe("isToolLikeName (the conservative server tool-name shape)", () => {
  it("accepts snake_case tool names", () => {
    expect(isToolLikeName("qlik_search")).toBe(true);
    expect(isToolLikeName("qlik_get_data_model")).toBe(true);
    expect(isToolLikeName("ab_c1")).toBe(true);
  });

  it("rejects everything that is not a lowercase multi-segment snake_case identifier", () => {
    expect(isToolLikeName("qlik")).toBe(false); // no separator — a single bare word never matches
    expect(isToolLikeName("a_b")).toBe(false); // first segment must be ≥ 2 chars
    expect(isToolLikeName("Qlik_Search")).toBe(false); // uppercase
    expect(isToolLikeName("foo-bar")).toBe(false); // kebab-case is not flagged (conservative)
    expect(isToolLikeName("foo__bar")).toBe(false); // double underscore
    expect(isToolLikeName("qlik_search_")).toBe(false); // trailing underscore
    expect(isToolLikeName("_qlik_search")).toBe(false); // leading underscore
    expect(isToolLikeName("1lik_search")).toBe(false); // must start with a letter
    expect(isToolLikeName("")).toBe(false);
  });
});

describe("matchToolReferences — known names", () => {
  it("matches a backticked known name as an exact inline-code span", () => {
    const matches = matchToolReferences("Use `qlik_search` to find things.", KNOWN);
    expect(tuples(matches)).toEqual([["known", "qlik_search", 1, 6, true]]);
    expect(matches[0]?.endColumn).toBe(17); // 6 + "qlik_search".length
  });

  it("matches a BARE known name (the SI7 gap) at word boundaries", () => {
    const matches = matchToolReferences("Run qlik_search now.", KNOWN);
    expect(tuples(matches)).toEqual([["known", "qlik_search", 1, 5, false]]);
  });

  it("matches inside a heading", () => {
    const matches = matchToolReferences("## Fetch with qlik_search", KNOWN);
    expect(tuples(matches)).toEqual([["known", "qlik_search", 1, 15, false]]);
  });

  it("matches inside bold and other markdown emphasis", () => {
    expect(tuples(matchToolReferences("**qlik_search** first", KNOWN))).toEqual([
      ["known", "qlik_search", 1, 3, false],
    ]);
    expect(tuples(matchToolReferences("see [qlik_search](#anchor)", KNOWN))).toEqual([
      ["known", "qlik_search", 1, 6, false],
    ]);
  });

  it("matches a known name embedded in a LONGER inline-code span as a bare (non-exact) reference", () => {
    const matches = matchToolReferences("Run `use qlik_search here` now.", KNOWN);
    expect(tuples(matches)).toEqual([["known", "qlik_search", 1, 10, false]]);
  });

  it("reports every occurrence, in document order, once each", () => {
    const text = "Use `qlik_search` then qlik_search again.\nAnd qlik_get_data_model too.";
    expect(tuples(matchToolReferences(text, KNOWN))).toEqual([
      ["known", "qlik_search", 1, 6, true],
      ["known", "qlik_search", 1, 24, false],
      ["known", "qlik_get_data_model", 2, 5, false],
    ]);
  });

  it("is case-sensitive (a scan's tool names are exact)", () => {
    expect(matchToolReferences("Use Qlik_Search or QLIK_SEARCH.", KNOWN)).toEqual([]);
    expect(matchToolReferences("Use `Qlik_Search`.", KNOWN)).toEqual([]); // not toollike either
  });

  it("enforces word boundaries (underscore is a word character)", () => {
    expect(matchToolReferences("xqlik_search qlik_searchx qlik_search2", KNOWN)).toEqual([]);
    expect(matchToolReferences("pre_qlik_search and qlik_search_post", KNOWN)).toEqual([]);
  });

  it("allows punctuation and brackets as boundaries", () => {
    const text = "(qlik_search) qlik_search. qlik_search, “qlik_search”";
    const matches = matchToolReferences(text, KNOWN);
    expect(matches).toHaveLength(4);
    expect(matches.every((m) => m.kind === "known")).toBe(true);
  });

  it("matches known names of ANY shape (list-driven), e.g. kebab-case or single words", () => {
    const matches = matchToolReferences("Call fetch-page then search.", ["fetch-page", "search"]);
    expect(tuples(matches)).toEqual([
      ["known", "fetch-page", 1, 6, false],
      ["known", "search", 1, 22, false],
    ]);
  });

  it("never matches bare names when the known list is empty", () => {
    expect(matchToolReferences("Run qlik_search now.", [])).toEqual([]);
  });
});

describe("matchToolReferences — unknown-toollike (conservative)", () => {
  it("flags a BACKTICKED toollike span that is not in the known list", () => {
    const matches = matchToolReferences("Call `qlik_serach` first.", KNOWN);
    expect(tuples(matches)).toEqual([["unknown-toollike", "qlik_serach", 1, 7, true]]);
  });

  it("never flags a BARE snake_case word (the false-positive guard)", () => {
    expect(matchToolReferences("The data_model and file_name fields.", KNOWN)).toEqual([]);
  });

  it("never flags backticked spans that do not have the tool-name shape", () => {
    const text = "Use `CamelCase`, `foo`, `foo-bar`, `a_b`, `has space_inside`.";
    expect(matchToolReferences(text, KNOWN)).toEqual([]);
  });

  it("classifies a toollike span as unknown-toollike even with an empty known list (pure)", () => {
    // The CALLER decides that an unbound skill styles these neutrally and raises no problems.
    const matches = matchToolReferences("Call `qlik_search` here.", []);
    expect(tuples(matches)).toEqual([["unknown-toollike", "qlik_search", 1, 7, true]]);
  });
});

describe("matchToolReferences — overlapping names resolve longest-match", () => {
  const OVERLAP = ["qlik_search", "qlik_search_advanced"];

  it("bare: the longer known name wins, the shorter never fires inside it", () => {
    expect(tuples(matchToolReferences("Use qlik_search_advanced.", OVERLAP))).toEqual([
      ["known", "qlik_search_advanced", 1, 5, false],
    ]);
    expect(tuples(matchToolReferences("Use qlik_search.", OVERLAP))).toEqual([
      ["known", "qlik_search", 1, 5, false],
    ]);
  });

  it("backticked: the exact span text decides", () => {
    expect(tuples(matchToolReferences("Use `qlik_search_advanced`.", OVERLAP))).toEqual([
      ["known", "qlik_search_advanced", 1, 6, true],
    ]);
    // With only the SHORTER name known, the longer span is a whole unknown-toollike token — the
    // shorter name must NOT light up inside it.
    expect(tuples(matchToolReferences("Use `qlik_search_advanced`.", ["qlik_search"]))).toEqual([
      ["unknown-toollike", "qlik_search_advanced", 1, 6, true],
    ]);
  });

  it("bare prefix of a longer unknown identifier does not fire (word boundary)", () => {
    expect(matchToolReferences("Use qlik_search_advanced.", ["qlik_search"])).toEqual([]);
  });
});

describe("matchToolReferences — YAML frontmatter is excluded", () => {
  const doc = [
    "---",
    "name: data-helper",
    "qlik_search: a-key-that-collides", // a frontmatter KEY shaped like a tool name
    "description: use qlik_search often", // a VALUE containing a known name
    "---",
    "Body qlik_search here.",
  ].join("\n");

  it("matches nothing inside the frontmatter block, keys or values", () => {
    const matches = matchToolReferences(doc, KNOWN);
    expect(tuples(matches)).toEqual([["known", "qlik_search", 6, 6, false]]);
  });

  it("supports the `...` YAML end marker", () => {
    const text = "---\nname: x\n...\nqlik_search";
    expect(tuples(matchToolReferences(text, KNOWN))).toEqual([
      ["known", "qlik_search", 4, 1, false],
    ]);
  });

  it("treats an UNTERMINATED leading --- as no frontmatter (matches the API extractor)", () => {
    const text = "---\nUse qlik_search now.";
    expect(tuples(matchToolReferences(text, KNOWN))).toEqual([
      ["known", "qlik_search", 2, 5, false],
    ]);
  });

  it("only a document-LEADING --- opens frontmatter", () => {
    const text = "Intro.\n---\nqlik_search: not frontmatter\n---";
    // The --- lines here are horizontal rules; line 3 contains a bare known name (the colon after
    // it is a boundary, not a YAML key position — we are not in frontmatter).
    expect(tuples(matchToolReferences(text, KNOWN))).toEqual([
      ["known", "qlik_search", 3, 1, false],
    ]);
  });
});

describe("matchToolReferences — fenced code blocks", () => {
  it("never matches on the fence delimiter line (language tags)", () => {
    const text = "```qlik_search\ncontent\n```";
    expect(matchToolReferences(text, KNOWN)).toEqual([]);
  });

  it("matches KNOWN names inside fence content as bare references (an example call is real)", () => {
    const text = ["Before.", "```json", '{ "tool": "qlik_search" }', "```", "After."].join("\n");
    expect(tuples(matchToolReferences(text, KNOWN))).toEqual([
      ["known", "qlik_search", 3, 12, false],
    ]);
  });

  it("never produces unknown-toollike findings inside a fence (backticks are literal there)", () => {
    const text = ["```python", "result = call_helper(`weird_token`)", "```"].join("\n");
    expect(matchToolReferences(text, KNOWN)).toEqual([]);
  });

  it("supports ~~~ fences and indented fence delimiters", () => {
    const text = ["  ~~~", "qlik_search", "  ~~~", "qlik_search"].join("\n");
    const matches = matchToolReferences(text, KNOWN);
    expect(tuples(matches)).toEqual([
      ["known", "qlik_search", 2, 1, false],
      ["known", "qlik_search", 4, 1, false],
    ]);
  });
});

describe("matchToolReferences — input plumbing", () => {
  it("handles CRLF line endings with correct line numbers", () => {
    const matches = matchToolReferences("a\r\nUse `qlik_search`\r\nb", KNOWN);
    expect(tuples(matches)).toEqual([["known", "qlik_search", 2, 6, true]]);
  });

  it("returns [] for empty text and ignores empty/duplicate known names", () => {
    expect(matchToolReferences("", KNOWN)).toEqual([]);
    const matches = matchToolReferences("qlik_search", ["", "qlik_search", "qlik_search"]);
    expect(tuples(matches)).toEqual([["known", "qlik_search", 1, 1, false]]);
  });

  it("escapes regex metacharacters in known names", () => {
    const matches = matchToolReferences("call a.b(c) now", ["a.b(c)"]);
    expect(tuples(matches)).toEqual([["known", "a.b(c)", 1, 6, false]]);
    expect(matchToolReferences("call aXb(c) now", ["a.b(c)"])).toEqual([]);
  });
});

describe("findUnknownToolReferences (the problems feed)", () => {
  it("dedupes by name with the first line and an occurrence count", () => {
    const text = [
      "Call `qlik_serach` first.",
      "Then `qlik_serach` again, and `made_up_tool` once.",
    ].join("\n");
    expect(findUnknownToolReferences(text, KNOWN)).toEqual([
      { name: "qlik_serach", line: 1, count: 2 },
      { name: "made_up_tool", line: 2, count: 1 },
    ]);
  });

  it("returns [] when there are no known tools (no scan basis → no findings)", () => {
    expect(findUnknownToolReferences("Call `qlik_serach`.", [])).toEqual([]);
  });

  it("returns [] when every backticked toollike span is known", () => {
    expect(findUnknownToolReferences("Use `qlik_search`.", KNOWN)).toEqual([]);
  });
});

describe("formatUnknownToolWarning / parseUnknownToolWarning (the warnings-channel wire)", () => {
  it("round-trips a single-occurrence finding", () => {
    const warning = formatUnknownToolWarning({ name: "qlik_serach", line: 12, count: 1 });
    expect(warning).toBe(
      "Unknown tool reference `qlik_serach` — not found in the bound servers’ latest scans (line 12).",
    );
    expect(parseUnknownToolWarning(warning)).toEqual({ name: "qlik_serach", line: 12 });
  });

  it("round-trips a multi-occurrence finding", () => {
    const warning = formatUnknownToolWarning({ name: "made_up_tool", line: 3, count: 4 });
    expect(warning).toContain("×4");
    expect(parseUnknownToolWarning(warning)).toEqual({ name: "made_up_tool", line: 3 });
  });

  it("returns null for projector-style and arbitrary warnings", () => {
    expect(
      parseUnknownToolWarning(
        `gatekeeper "Decide" branch targets are not resolvable to sections; routed onward.`,
      ),
    ).toBeNull();
    expect(parseUnknownToolWarning("Unknown tool reference without the exact shape")).toBeNull();
    expect(parseUnknownToolWarning("")).toBeNull();
  });
});
