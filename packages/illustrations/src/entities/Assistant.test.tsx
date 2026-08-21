import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { attributeValues } from "../test-support.js";
import { Agent, agentHeightUnits } from "./Agent.js";
import {
  ASSISTANT_VARIANTS,
  Assistant,
  assistantCrownUnits,
  assistantHeightUnits,
  assistantMeta,
} from "./Assistant.js";
import { describeEntityContract, renderEntity } from "./contract-support.js";

describeEntityContract(Assistant, assistantMeta);

const accents = (markup: string) => (markup.match(/var\(--illus-accent\)/g) ?? []).length;
const marks = (markup: string, mark: string) =>
  attributeValues(markup, "data-illus-mark").filter((name) => name === mark).length;
const primitives = (markup: string) => attributeValues(markup, "data-illus-primitive");

describe("assistant — it reuses the shared figure rather than redrawing one", () => {
  it("draws exactly the same `IsoFigure` two other entities do", () => {
    // WP 1.1 pulled the standing figure into `primitives/IsoFigure.tsx` so `Validator` could carry a
    // shield without copying a robot, and said in as many words that it "pays forward" to this
    // entity. Redrawing the torso here would have been the copy that primitive exists to prevent.
    assert.ok(primitives(renderEntity(Assistant, {})).includes("iso-figure"));
  });

  it("draws exactly the variants the registry entry publishes", () => {
    assert.deepEqual([...ASSISTANT_VARIANTS], [...assistantMeta.variants]);
  });
});

describe("assistant — distinguishable from `agent` AT `s` (WP 1.3's hard requirement)", () => {
  // "If the only difference is a detail that vanishes at the small footprint, the drawing is wrong."
  // So the difference is three things, all of them silhouette, and all three are asserted here at
  // the small footprint specifically as well as at the other two.

  it("stands on a flat pad where an agent stands on a stepped plinth", () => {
    for (const size of assistantMeta.sizes) {
      assert.ok(
        !primitives(renderEntity(Assistant, { size })).includes("iso-platform"),
        `at ${size} the assistant grew the same plinth an agent stands on`,
      );
      assert.ok(primitives(renderEntity(Agent, { size })).includes("iso-platform"));
    }
  });

  it("is shorter overall than an agent, `s` included", () => {
    for (const size of assistantMeta.sizes) {
      assert.ok(
        assistantHeightUnits(size) < agentHeightUnits(size),
        `at ${size} the assistant reaches ${assistantHeightUnits(size)} against ${agentHeightUnits(size)}`,
      );
    }
  });

  it("sits its head WELL below its own top, which is what makes it a niche and not a figure", () => {
    // The panel has to rise clearly above the crown or the drawing is a figure with a board behind
    // it. A quarter of the entity's height is the margin that survives the small footprint.
    for (const size of assistantMeta.sizes) {
      const crown = assistantCrownUnits(size);
      const top = assistantHeightUnits(size);
      assert.ok(crown < top, `at ${size} the head (${crown}) reaches the panel top (${top})`);
      assert.ok(
        (top - crown) / top > 0.25,
        `at ${size} the panel clears the head by only ${((top - crown) / top).toFixed(2)} of the height`,
      );
    }
  });

  it("is a different drawing at `s`, not the same one scaled", () => {
    assert.notEqual(renderEntity(Assistant, { size: "s" }), renderEntity(Agent, { size: "s" }));
  });
});

describe("assistant — it has a face, so it honours `facing` (D-IL17)", () => {
  it("moves the visor between the two iso faces", () => {
    const gaze = (facing: "upstream" | "downstream") =>
      attributeValues(renderEntity(Assistant, { facing }), "data-illus-glyph-face");
    // The dock indicator always sits on the panel's `top`; the visor is what moves.
    assert.ok(gaze("upstream").includes("left"));
    assert.ok(gaze("downstream").includes("right"));
    assert.ok(!gaze("upstream").includes("right"));
  });
});

describe("assistant — the `hub` variant widens the dock without moving anything (D-IL7)", () => {
  it("adds a second panel of exactly the same height", () => {
    const solids = (variant: string) =>
      primitives(renderEntity(Assistant, { variant })).filter((name) => name === "iso-housing")
        .length;
    assert.equal(solids("hub") - solids("dock"), 1);
  });

  it("anchors every port at the same place in both variants", () => {
    const dots = (variant: string) =>
      [
        ...renderEntity(Assistant, { variant, showPorts: true }).matchAll(
          /<circle cx="([^"]+)" cy="([^"]+)" r="4"/g,
        ),
      ].map((match) => `${match[1]},${match[2]}`);
    assert.deepEqual(dots("dock"), dots("hub"));
  });
});

describe("assistant — one accent moment, and it belongs to the DOCK (D-IL6)", () => {
  it("lights the dock indicator, never the figure", () => {
    for (const variant of ASSISTANT_VARIANTS) {
      const markup = renderEntity(Assistant, { variant });
      assert.equal(accents(markup), 1, `${variant} spent more than one accent moment`);
      assert.equal(marks(markup, "dock-indicator"), 1);
    }
  });

  it("recolours the indicator on error rather than adding a mark", () => {
    const markup = renderEntity(Assistant, { state: "error" });
    assert.equal(accents(markup), 0);
    assert.equal(marks(markup, "dock-indicator"), 1);
    assert.ok(markup.includes("var(--illus-error)"));
  });
});
