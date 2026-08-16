import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReasoningSection } from "@mcp-token-footprint/shared";
import { parseReasoningSections } from "../src/testing/qlik-answers-reasoning.js";

// WP 5.2 (Phase 5 — answer rendering, D-QA11): the pure reasoning-stream phase parser. Fixtures mirror
// the REAL run `hHGgqkU…` reasoning shape (numbered pipeline · Search Findings asset lists · a
// Classification line · a "## …" draft answer). NO network. The reasoning STRING is never mutated —
// these are additive projections.

/** A faithful (trimmed) reasoning stream in the real shape. */
function reasoningStream(): string {
  return [
    "1. **Understanding**: The user wants to evaluate American Airlines as a strategic travel partner.",
    "2. **Current Primary Subject**: American Airlines on-time performance vs. other carriers.",
    "3. **Rewritten Question**: Compare American Airlines' on-time performance against all other major US carriers.",
    "",
    "I'll help you evaluate your strategic partnership. Let me start by discovering the relevant assets.",
    "",
    "**Search Findings:**",
    "",
    "Keywords extracted: [airline, carrier, delay, punctuality]",
    "",
    "**Master Measures:**",
    "- [DepDelay] - measure, similarity: 0.888, hybrid: N/A",
    "- [Flights] - measure, similarity: 0.848, hybrid: N/A",
    "",
    "**Master Dimensions:**",
    "- [Carrier] - dimension, similarity: 0.899, hybrid: N/A [GLOSSARY MATCH: carrier]",
    "- [Carrier.airline_name] - dimension, similarity: 0.876, hybrid: N/A [GLOSSARY MATCH: airline, carrier]",
    "",
    "**Classification: Exploratory**",
    "Justification: Multi-dimensional strategic evaluation requiring 5 analytical perspectives.",
    "Planned charts: 5",
    "",
    "## Strategic Partnership Evaluation: American Airlines Performance Analysis",
    "",
    "American Airlines holds 13.49% market share and ranks last in punctuality across all 20 carriers. Recommend a multi-vendor strategy anchored by Alaska Airlines and Delta.",
  ].join("\n");
}

const ANSWER =
  "American Airlines holds roughly 13.5% market share and ranks last in punctuality. A multi-vendor strategy anchored by Alaska Airlines and Delta is recommended.";

test("parseReasoningSections: recognizes the full pipeline in order (D-QA11)", () => {
  const sections = parseReasoningSections(reasoningStream(), ANSWER);
  const kinds = sections.map((s) => s.kind);
  assert.deepEqual(kinds, [
    "understanding",
    "prose", // "Current Primary Subject" — no dedicated kind
    "rewritten",
    "prose", // intro + Search Findings + keywords
    "assets", // Master Measures
    "assets", // Master Dimensions
    "classification",
    "draft",
  ]);
});

test("parseReasoningSections: understanding / rewritten carry their title + inline text", () => {
  const sections = parseReasoningSections(reasoningStream(), ANSWER);
  assert.deepEqual(sections[0], {
    kind: "understanding",
    title: "Understanding",
    markdown: "The user wants to evaluate American Airlines as a strategic travel partner.",
  });
  assert.deepEqual(sections[1], {
    kind: "prose",
    title: "Current Primary Subject",
    markdown: "American Airlines on-time performance vs. other carriers.",
  });
  assert.deepEqual(sections[2], {
    kind: "rewritten",
    title: "Rewritten Question",
    markdown: "Compare American Airlines' on-time performance against all other major US carriers.",
  });
});

test("parseReasoningSections: Search Findings asset lists become tabular rows with similarity + glossary", () => {
  const sections = parseReasoningSections(reasoningStream(), ANSWER);
  const assets = sections.filter((s): s is Extract<ReasoningSection, { kind: "assets" }> => s.kind === "assets");
  assert.equal(assets.length, 2);
  assert.deepEqual(assets[0], {
    kind: "assets",
    title: "Master Measures",
    rows: [
      { asset: "DepDelay", type: "measure", similarity: 0.888 },
      { asset: "Flights", type: "measure", similarity: 0.848 },
    ],
  });
  assert.deepEqual(assets[1], {
    kind: "assets",
    title: "Master Dimensions",
    rows: [
      { asset: "Carrier", type: "dimension", similarity: 0.899, glossary: "carrier" },
      { asset: "Carrier.airline_name", type: "dimension", similarity: 0.876, glossary: "airline, carrier" },
    ],
  });
});

test("parseReasoningSections: the intro + keyword narrative is a verbatim prose section (no text dropped)", () => {
  const sections = parseReasoningSections(reasoningStream(), ANSWER);
  const prose = sections.find((s) => s.kind === "prose" && s.title === undefined);
  assert.ok(prose && prose.kind === "prose");
  assert.match(prose.markdown, /I'll help you evaluate your strategic partnership/);
  assert.match(prose.markdown, /Keywords extracted: \[airline, carrier, delay, punctuality\]/);
});

test("parseReasoningSections: classification captures its justification + planned charts", () => {
  const sections = parseReasoningSections(reasoningStream(), ANSWER);
  const classification = sections.find(
    (s): s is Extract<ReasoningSection, { kind: "classification" }> => s.kind === "classification",
  );
  assert.equal(classification?.title, "Classification");
  assert.match(classification?.markdown ?? "", /\*\*Classification: Exploratory\*\*/);
  assert.match(classification?.markdown ?? "", /Planned charts: 5/);
});

test("parseReasoningSections: a '## …' draft that restates the answer is flagged duplicatesAnswer (D-QA11)", () => {
  const sections = parseReasoningSections(reasoningStream(), ANSWER);
  const draft = sections.find((s): s is Extract<ReasoningSection, { kind: "draft" }> => s.kind === "draft");
  assert.ok(draft, "the draft is recognized");
  assert.equal(draft?.title, "Strategic Partnership Evaluation: American Airlines Performance Analysis");
  assert.equal(draft?.duplicatesAnswer, true);
  // The draft text is FLAGGED, never deleted from the section.
  assert.match(draft?.markdown ?? "", /## Strategic Partnership Evaluation/);
});

test("parseReasoningSections: a '## …' draft unrelated to the answer is NOT flagged duplicative", () => {
  const reasoning = "## Draft\n\nThe weather in Paris is sunny with mild temperatures all week.";
  const sections = parseReasoningSections(reasoning, ANSWER);
  const draft = sections.find((s): s is Extract<ReasoningSection, { kind: "draft" }> => s.kind === "draft");
  assert.equal(draft?.duplicatesAnswer, false);
});

test("parseReasoningSections: a draft defaults to duplicative when no answer text is supplied", () => {
  const sections = parseReasoningSections("## Draft\n\nSome answer draft text about carriers.");
  const draft = sections.find((s): s is Extract<ReasoningSection, { kind: "draft" }> => s.kind === "draft");
  assert.equal(draft?.duplicatesAnswer, true);
});

test("parseReasoningSections: unrecognized reasoning → a single verbatim raw section (never drops text)", () => {
  const reasoning = "Just some free-form thinking with no recognizable phase markers at all.";
  assert.deepEqual(parseReasoningSections(reasoning), [{ kind: "raw", markdown: reasoning }]);
});

test("parseReasoningSections: empty / whitespace input → []", () => {
  assert.deepEqual(parseReasoningSections(""), []);
  assert.deepEqual(parseReasoningSections("   \n  "), []);
});
