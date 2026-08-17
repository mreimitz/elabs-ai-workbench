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

const KNOWN = ["acme_search", "acme_get_data_model", "acme_create_data_object"];

/** Terser assertions: pick `[kind, name, line, startColumn, backticked]` tuples. */
function tuples(matches: ToolReferenceMatch[]): Array<[string, string, number, number, boolean]> {
  return matches.map((m) => [m.kind, m.name, m.line, m.startColumn, m.backticked]);
}

describe("isToolLikeName (the conservative server tool-name shape)", () => {
  it("accepts snake_case tool names", () => {
    expect(isToolLikeName("acme_search")).toBe(true);
    expect(isToolLikeName("acme_get_data_model")).toBe(true);
    expect(isToolLikeName("ab_c1")).toBe(true);
  });

  it("rejects everything that is not a lowercase multi-segment snake_case identifier", () => {
    expect(isToolLikeName("acme")).toBe(false); // no separator — a single bare word never matches
    expect(isToolLikeName("a_b")).toBe(false); // first segment must be ≥ 2 chars
    expect(isToolLikeName("Acme_Search")).toBe(false); // uppercase
    expect(isToolLikeName("foo-bar")).toBe(false); // kebab-case is not flagged (conservative)
    expect(isToolLikeName("foo__bar")).toBe(false); // double underscore
    expect(isToolLikeName("acme_search_")).toBe(false); // trailing underscore
    expect(isToolLikeName("_acme_search")).toBe(false); // leading underscore
    expect(isToolLikeName("1lik_search")).toBe(false); // must start with a letter
    expect(isToolLikeName("")).toBe(false);
  });
});

describe("matchToolReferences — known names", () => {
  it("matches a backticked known name as an exact inline-code span", () => {
    const matches = matchToolReferences("Use `acme_search` to find things.", KNOWN);
    expect(tuples(matches)).toEqual([["known", "acme_search", 1, 6, true]]);
    expect(matches[0]?.endColumn).toBe(17); // 6 + "acme_search".length
  });

  it("matches a BARE known name (the SI7 gap) at word boundaries", () => {
    const matches = matchToolReferences("Run acme_search now.", KNOWN);
    expect(tuples(matches)).toEqual([["known", "acme_search", 1, 5, false]]);
  });

  it("matches inside a heading", () => {
    const matches = matchToolReferences("## Fetch with acme_search", KNOWN);
    expect(tuples(matches)).toEqual([["known", "acme_search", 1, 15, false]]);
  });

  it("matches inside bold and other markdown emphasis", () => {
    expect(tuples(matchToolReferences("**acme_search** first", KNOWN))).toEqual([
      ["known", "acme_search", 1, 3, false],
    ]);
    expect(tuples(matchToolReferences("see [acme_search](#anchor)", KNOWN))).toEqual([
      ["known", "acme_search", 1, 6, false],
    ]);
  });

  it("matches a known name embedded in a LONGER inline-code span as a bare (non-exact) reference", () => {
    const matches = matchToolReferences("Run `use acme_search here` now.", KNOWN);
    expect(tuples(matches)).toEqual([["known", "acme_search", 1, 10, false]]);
  });

  it("reports every occurrence, in document order, once each", () => {
    const text = "Use `acme_search` then acme_search again.\nAnd acme_get_data_model too.";
    expect(tuples(matchToolReferences(text, KNOWN))).toEqual([
      ["known", "acme_search", 1, 6, true],
      ["known", "acme_search", 1, 24, false],
      ["known", "acme_get_data_model", 2, 5, false],
    ]);
  });

  it("is case-sensitive (a scan's tool names are exact)", () => {
    expect(matchToolReferences("Use Acme_Search or ACME_SEARCH.", KNOWN)).toEqual([]);
    expect(matchToolReferences("Use `Acme_Search`.", KNOWN)).toEqual([]); // not toollike either
  });

  it("enforces word boundaries (underscore is a word character)", () => {
    expect(matchToolReferences("xacme_search acme_searchx acme_search2", KNOWN)).toEqual([]);
    expect(matchToolReferences("pre_acme_search and acme_search_post", KNOWN)).toEqual([]);
  });

  it("allows punctuation and brackets as boundaries", () => {
    const text = "(acme_search) acme_search. acme_search, “acme_search”";
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
    expect(matchToolReferences("Run acme_search now.", [])).toEqual([]);
  });
});

describe("matchToolReferences — unknown-toollike (conservative)", () => {
  it("flags a BACKTICKED toollike span that is not in the known list", () => {
    const matches = matchToolReferences("Call `acme_serach` first.", KNOWN);
    expect(tuples(matches)).toEqual([["unknown-toollike", "acme_serach", 1, 7, true]]);
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
    const matches = matchToolReferences("Call `acme_search` here.", []);
    expect(tuples(matches)).toEqual([["unknown-toollike", "acme_search", 1, 7, true]]);
  });
});

describe("matchToolReferences — overlapping names resolve longest-match", () => {
  const OVERLAP = ["acme_search", "acme_search_advanced"];

  it("bare: the longer known name wins, the shorter never fires inside it", () => {
    expect(tuples(matchToolReferences("Use acme_search_advanced.", OVERLAP))).toEqual([
      ["known", "acme_search_advanced", 1, 5, false],
    ]);
    expect(tuples(matchToolReferences("Use acme_search.", OVERLAP))).toEqual([
      ["known", "acme_search", 1, 5, false],
    ]);
  });

  it("backticked: the exact span text decides", () => {
    expect(tuples(matchToolReferences("Use `acme_search_advanced`.", OVERLAP))).toEqual([
      ["known", "acme_search_advanced", 1, 6, true],
    ]);
    // With only the SHORTER name known, the longer span is a whole unknown-toollike token — the
    // shorter name must NOT light up inside it.
    expect(tuples(matchToolReferences("Use `acme_search_advanced`.", ["acme_search"]))).toEqual([
      ["unknown-toollike", "acme_search_advanced", 1, 6, true],
    ]);
  });

  it("bare prefix of a longer unknown identifier does not fire (word boundary)", () => {
    expect(matchToolReferences("Use acme_search_advanced.", ["acme_search"])).toEqual([]);
  });
});

describe("matchToolReferences — YAML frontmatter is excluded", () => {
  const doc = [
    "---",
    "name: data-helper",
    "acme_search: a-key-that-collides", // a frontmatter KEY shaped like a tool name
    "description: use acme_search often", // a VALUE containing a known name
    "---",
    "Body acme_search here.",
  ].join("\n");

  it("matches nothing inside the frontmatter block, keys or values", () => {
    const matches = matchToolReferences(doc, KNOWN);
    expect(tuples(matches)).toEqual([["known", "acme_search", 6, 6, false]]);
  });

  it("supports the `...` YAML end marker", () => {
    const text = "---\nname: x\n...\nacme_search";
    expect(tuples(matchToolReferences(text, KNOWN))).toEqual([
      ["known", "acme_search", 4, 1, false],
    ]);
  });

  it("treats an UNTERMINATED leading --- as no frontmatter (matches the API extractor)", () => {
    const text = "---\nUse acme_search now.";
    expect(tuples(matchToolReferences(text, KNOWN))).toEqual([
      ["known", "acme_search", 2, 5, false],
    ]);
  });

  it("only a document-LEADING --- opens frontmatter", () => {
    const text = "Intro.\n---\nacme_search: not frontmatter\n---";
    // The --- lines here are horizontal rules; line 3 contains a bare known name (the colon after
    // it is a boundary, not a YAML key position — we are not in frontmatter).
    expect(tuples(matchToolReferences(text, KNOWN))).toEqual([
      ["known", "acme_search", 3, 1, false],
    ]);
  });
});

describe("matchToolReferences — fenced code blocks", () => {
  it("never matches on the fence delimiter line (language tags)", () => {
    const text = "```acme_search\ncontent\n```";
    expect(matchToolReferences(text, KNOWN)).toEqual([]);
  });

  it("matches KNOWN names inside fence content as bare references (an example call is real)", () => {
    const text = ["Before.", "```json", '{ "tool": "acme_search" }', "```", "After."].join("\n");
    expect(tuples(matchToolReferences(text, KNOWN))).toEqual([
      ["known", "acme_search", 3, 12, false],
    ]);
  });

  it("never produces unknown-toollike findings inside a fence (backticks are literal there)", () => {
    const text = ["```python", "result = call_helper(`weird_token`)", "```"].join("\n");
    expect(matchToolReferences(text, KNOWN)).toEqual([]);
  });

  it("supports ~~~ fences and indented fence delimiters", () => {
    const text = ["  ~~~", "acme_search", "  ~~~", "acme_search"].join("\n");
    const matches = matchToolReferences(text, KNOWN);
    expect(tuples(matches)).toEqual([
      ["known", "acme_search", 2, 1, false],
      ["known", "acme_search", 4, 1, false],
    ]);
  });
});

describe("matchToolReferences — input plumbing", () => {
  it("handles CRLF line endings with correct line numbers", () => {
    const matches = matchToolReferences("a\r\nUse `acme_search`\r\nb", KNOWN);
    expect(tuples(matches)).toEqual([["known", "acme_search", 2, 6, true]]);
  });

  it("returns [] for empty text and ignores empty/duplicate known names", () => {
    expect(matchToolReferences("", KNOWN)).toEqual([]);
    const matches = matchToolReferences("acme_search", ["", "acme_search", "acme_search"]);
    expect(tuples(matches)).toEqual([["known", "acme_search", 1, 1, false]]);
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
      "Call `acme_serach` first.",
      "Then `acme_serach` again, and `made_up_tool` once.",
    ].join("\n");
    expect(findUnknownToolReferences(text, KNOWN)).toEqual([
      { name: "acme_serach", line: 1, count: 2 },
      { name: "made_up_tool", line: 2, count: 1 },
    ]);
  });

  it("returns [] when there are no known tools (no scan basis → no findings)", () => {
    expect(findUnknownToolReferences("Call `acme_serach`.", [])).toEqual([]);
  });

  it("returns [] when every backticked toollike span is known", () => {
    expect(findUnknownToolReferences("Use `acme_search`.", KNOWN)).toEqual([]);
  });
});

describe("formatUnknownToolWarning / parseUnknownToolWarning (the warnings-channel wire)", () => {
  it("round-trips a single-occurrence finding", () => {
    const warning = formatUnknownToolWarning({ name: "acme_serach", line: 12, count: 1 });
    expect(warning).toBe(
      "Unknown tool reference `acme_serach` — not found in the bound servers’ latest scans (line 12).",
    );
    expect(parseUnknownToolWarning(warning)).toEqual({ name: "acme_serach", line: 12 });
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
