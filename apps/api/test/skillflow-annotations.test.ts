import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSkillflowAnnotations } from "../src/skillflow/annotations.js";

const split = (md: string) => md.split(/\r?\n/);

test("parses gatekeeper/gate annotations directly above their heading", () => {
  const md = [
    "# Title",
    "",
    "<!-- skillflow:gatekeeper id=route-input -->",
    "## Route the input",
    "",
    "<!-- skillflow:gate id=check-output -->",
    "## Check the output",
  ].join("\n");

  const { byTargetLine, warnings } = parseSkillflowAnnotations(split(md));
  assert.equal(warnings.length, 0);

  const gatekeeper = byTargetLine.get(4); // 1-based line of "## Route the input"
  assert.equal(gatekeeper?.keyword, "gatekeeper");
  assert.equal(gatekeeper?.id, "route-input");

  const gate = byTargetLine.get(7); // 1-based line of "## Check the output"
  assert.equal(gate?.keyword, "gate");
  assert.equal(gate?.id, "check-output");
});

test("tolerates a blank line between the annotation and its heading", () => {
  const md = ["<!-- skillflow:gatekeeper id=x -->", "", "## Heading"].join("\n");
  const { byTargetLine, warnings } = parseSkillflowAnnotations(split(md));
  assert.equal(warnings.length, 0);
  assert.equal(byTargetLine.get(3)?.id, "x");
});

test("unknown skillflow keyword → a warning, never an error", () => {
  const md = ["<!-- skillflow:frobnicate id=x -->", "## Heading"].join("\n");
  const { byTargetLine, warnings } = parseSkillflowAnnotations(split(md));
  assert.equal(byTargetLine.size, 0);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /unknown annotation "skillflow:frobnicate"/);
});

test("an annotation not directly above a heading → a warning, no target", () => {
  const md = ["<!-- skillflow:gate id=x -->", "", "Just some prose, not a heading."].join("\n");
  const { byTargetLine, warnings } = parseSkillflowAnnotations(split(md));
  assert.equal(byTargetLine.size, 0);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /not directly above a heading/);
});

test("non-skillflow HTML comments are ignored entirely", () => {
  const md = ["<!-- just a normal comment -->", "## Heading"].join("\n");
  const { byTargetLine, warnings } = parseSkillflowAnnotations(split(md));
  assert.equal(byTargetLine.size, 0);
  assert.equal(warnings.length, 0);
});
