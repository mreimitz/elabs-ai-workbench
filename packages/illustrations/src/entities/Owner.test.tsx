// The D-IL12 checklist for `owner`, executed. `describeEntityContract` asks every entity the same
// questions — five states, three footprints, exactly the declared ports, both a `<title>` and a
// `<desc>`, only `--illus-*` paint, no `<path>`, the fixed layer order, deterministic bytes.
//
// Beneath it: what the shared harness cannot know. This entity's whole problem is that THREE other
// components already draw a standing figure, so "is it distinguishable" is not a matter of taste
// here — it is the thing that had to be designed, and it is asserted at `s` specifically, which is
// where a detail-based difference would quietly stop working.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { attributeValues } from "../test-support.js";
import { Agent } from "./Agent.js";
import { Assistant } from "./Assistant.js";
import { Owner, ownerConsoleHeightUnits, ownerHeightUnits, ownerMeta } from "./Owner.js";
import { Validator } from "./Validator.js";
import { describeEntityContract, renderEntity } from "./contract-support.js";

describeEntityContract(Owner, ownerMeta);

const accents = (markup: string) => (markup.match(/var\(--illus-accent\)/g) ?? []).length;
const marks = (markup: string, mark: string) =>
  attributeValues(markup, "data-illus-mark").filter((name) => name === mark).length;
const primitives = (markup: string) => attributeValues(markup, "data-illus-primitive");
const tiers = (markup: string) => attributeValues(markup, "data-illus-tiers");

describe("owner — it reuses the shared figure rather than redrawing a person", () => {
  it("draws the same `IsoFigure` the machine figures do", () => {
    // WP 1.1 extracted the figure so `Validator` could carry a shield without copying a robot, and
    // said outright that it "pays forward — research 5's tier-3 cast is `assistant` and
    // `owner/user`, which are the same silhouette again". This is the rest of that payment.
    assert.ok(primitives(renderEntity(Owner, {})).includes("iso-figure"));
  });
});

describe("owner — distinguishable from the three other figures, AT `s`", () => {
  // "If the only difference is a detail that vanishes at the small footprint, the drawing is wrong."
  // So the difference is the CONSOLE — a separate ground-standing solid spanning most of the
  // footprint — and it is asserted at every size, `s` included.

  it("stands on ONE tier where agent and validator stand on two", () => {
    for (const size of ownerMeta.sizes) {
      assert.deepEqual(tiers(renderEntity(Owner, { size })), ["1"], `at ${size}`);
      assert.deepEqual(tiers(renderEntity(Agent, { size })), ["2"], `at ${size}`);
      assert.deepEqual(tiers(renderEntity(Validator, { size })), ["2"], `at ${size}`);
    }
  });

  it("stands at a console — a solid the other three figures do not have", () => {
    for (const size of ownerMeta.sizes) {
      assert.equal(marks(renderEntity(Owner, { size }), "console-strip"), 1, `at ${size}`);
    }
    for (const Other of [Agent, Validator, Assistant]) {
      assert.equal(marks(renderEntity(Other, { size: "s" }), "console-strip"), 0);
    }
  });

  it("keeps the console clearly below the head, so it reads as a desk and not a niche", () => {
    // The opposite of `assistant`, whose panel rises ABOVE the crown. If the console ever grew past
    // mid-figure the two would start converging, which is the failure this pins.
    for (const size of ownerMeta.sizes) {
      const desk = ownerConsoleHeightUnits(size);
      const crown = ownerHeightUnits(size);
      assert.ok(desk < crown * 0.62, `at ${size} the console reaches ${desk} of ${crown}`);
    }
  });

  it("is a different drawing from each of them at `s`, not the same one restyled", () => {
    const owner = renderEntity(Owner, { size: "s" });
    for (const Other of [Agent, Validator, Assistant]) {
      assert.notEqual(owner, renderEntity(Other, { size: "s" }));
    }
  });
});

describe("owner — it has a face, so it honours `facing` (D-IL17)", () => {
  it("moves the visor — and the console — between the two iso faces", () => {
    const faces = (facing: "upstream" | "downstream") =>
      attributeValues(renderEntity(Owner, { facing }), "data-illus-glyph-face");
    // The console strip always mounts on the console's own `top`; the VISOR is what changes face,
    // and the console's position moves with it, so the two renders differ in both.
    assert.ok(faces("upstream").includes("left"));
    assert.ok(faces("downstream").includes("right"));
    assert.ok(!faces("upstream").includes("right"));
    assert.notEqual(
      renderEntity(Owner, { facing: "upstream" }),
      renderEntity(Owner, { facing: "downstream" }),
    );
  });

  it("does NOT let `facing` move the entity's height — no connector follows a turn (D-IL7)", () => {
    const dots = (facing: "upstream" | "downstream") =>
      [
        ...renderEntity(Owner, { facing, showPorts: true }).matchAll(
          /<circle cx="([^"]+)" cy="([^"]+)" r="4"/g,
        ),
      ].map((match) => `${match[1]},${match[2]}`);
    assert.deepEqual(dots("upstream"), dots("downstream"));
  });
});

describe("owner — one accent moment, and it belongs to the WORK (D-IL6)", () => {
  it("lights the console strip, never the person", () => {
    const markup = renderEntity(Owner, {});
    assert.equal(accents(markup), 1);
    assert.equal(marks(markup, "console-strip"), 1);
  });

  it("recolours the strip on error rather than adding a mark", () => {
    const markup = renderEntity(Owner, { state: "error" });
    assert.equal(accents(markup), 0);
    assert.equal(marks(markup, "console-strip"), 1);
    assert.ok(markup.includes("var(--illus-error)"));
  });
});
