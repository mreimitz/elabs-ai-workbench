// WP 6.2 (Phase 6 — streaming fidelity): the pure `parseReasoningSections` parser was MOVED from
// `apps/api/src/testing/qlik-answers-reasoning.ts` to `packages/shared` so the web can call it LIVE
// (client-side) while a `qlik_answers` run streams. This is a MOVE, not a change — the exhaustive
// behavior lock stays in `apps/api/test/qlik-answers-reasoning.test.ts` (it now imports the API
// re-export shim, which re-exports THIS module). This co-located test is a smoke check that the
// shared module itself parses the recognized phases + is partial/mid-token tolerant (the property the
// live parse relies on: a half-formed tail flows as `prose`/`raw`, never dropped, never a throw).
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseReasoningSections } from "./qlik-answers-reasoning.js";

test("empty reasoning → no sections", () => {
  assert.deepEqual(parseReasoningSections(""), []);
  assert.deepEqual(parseReasoningSections("   \n  "), []);
});

test("recognizes the numbered pipeline phases", () => {
  const sections = parseReasoningSections(
    "1. **Understanding**: The user wants carrier delays.\n2. **Rewritten Question**: Which carriers are late?",
  );
  assert.equal(sections.length, 2);
  assert.equal(sections[0]?.kind, "understanding");
  assert.equal(sections[1]?.kind, "rewritten");
});

test("parses a Search Findings asset list into a typed table", () => {
  const sections = parseReasoningSections(
    [
      "**Master Dimensions:**",
      "- [Carrier.airline_name] - dimension, similarity: 0.876, hybrid: N/A [GLOSSARY MATCH: airline, carrier]",
    ].join("\n"),
  );
  const assets = sections.find((s) => s.kind === "assets");
  assert.ok(assets && assets.kind === "assets");
  assert.equal(assets.rows.length, 1);
  assert.equal(assets.rows[0]?.asset, "Carrier.airline_name");
  assert.equal(assets.rows[0]?.type, "dimension");
  assert.equal(assets.rows[0]?.similarity, 0.876);
  assert.equal(assets.rows[0]?.glossary, "airline, carrier");
});

test("a '## …' draft is flagged duplicatesAnswer vs the final answer", () => {
  const answer = "American Airlines had the most delays at 13.49% of flights.";
  const sections = parseReasoningSections(
    "## Answer\nAmerican Airlines had the most delays at 13.49% of flights.",
    answer,
  );
  const draft = sections.find((s) => s.kind === "draft");
  assert.ok(draft && draft.kind === "draft");
  assert.equal(draft.duplicatesAnswer, true);
});

test("a total parse miss returns the whole reasoning verbatim as one `raw` section (never dropped)", () => {
  const text = "Just some free-flowing narrative with no phase markers at all.";
  const sections = parseReasoningSections(text);
  assert.equal(sections.length, 1);
  assert.equal(sections[0]?.kind, "raw");
  assert.equal(sections[0]?.kind === "raw" ? sections[0].markdown : "", text);
});

test("partial/mid-token tail is tolerated — a half-formed asset row flows as prose, never throws", () => {
  // Mimics a LIVE parse mid-delta: the header + one complete row are recognized, and the truncated
  // next row (no closing bracket yet) ends the asset list and flows as trailing prose.
  const partial = [
    "1. **Understanding**: carrier delays",
    "**Master Dimensions:**",
    "- [Carrier.airline_name] - dimension, similarity: 0.876",
    "- [Origin.airp", // truncated mid-stream
  ].join("\n");
  const sections = parseReasoningSections(partial, "an answer");
  const assets = sections.find((s) => s.kind === "assets");
  assert.ok(assets && assets.kind === "assets");
  assert.equal(assets.rows.length, 1); // only the complete row is in the table
  // the truncated tail is preserved as prose, not dropped
  const prose = sections.filter((s) => s.kind === "prose");
  assert.ok(prose.some((s) => s.kind === "prose" && s.markdown.includes("Origin.airp")));
});
