import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { footprintUnits } from "../iso-math.js";
import { attributeValues } from "../test-support.js";
import { MODEL_VARIANTS, Model, modelHeightUnits, modelMeta } from "./Model.js";
import { describeEntityContract, renderEntity } from "./contract-support.js";

describeEntityContract(Model, modelMeta);

describe("model — the variant list and the drawing are one declaration", () => {
  it("draws exactly the variants the registry entry publishes", () => {
    assert.deepEqual([...MODEL_VARIANTS], [...modelMeta.variants]);
  });

  it("changes the companion block and nothing else between hosted and local", () => {
    // Both variants draw the same three solids — the plinth tier, the chip, the companion — so the
    // difference is the companion's own dimensions, never an extra object.
    const solids = (variant: string) =>
      attributeValues(renderEntity(Model, { variant }), "data-illus-primitive").filter(
        (name) => name === "iso-housing",
      ).length;
    assert.equal(solids("hosted"), solids("local"));
    assert.notEqual(renderEntity(Model, { variant: "hosted" }), renderEntity(Model, { variant: "local" }));
  });
});

describe("model — the companion never becomes the tallest thing (D-IL7)", () => {
  it("declares plinth plus chip, at every footprint, whichever variant is drawn", () => {
    for (const size of modelMeta.sizes) {
      assert.equal(modelHeightUnits(size), 0.7 + footprintUnits(size) * 0.17);
    }
  });

  it("anchors `context-in` and `tokens-out` identically in both variants", () => {
    const dots = (variant: string) =>
      [
        ...renderEntity(Model, { variant, showPorts: true }).matchAll(
          /<circle cx="([^"]+)" cy="([^"]+)" r="4"/g,
        ),
      ].map((match) => `${match[1]},${match[2]}`);
    assert.deepEqual(dots("hosted"), dots("local"));
  });

  it("keeps both semantic ports clear of the plain cardinals they share a side with", () => {
    for (const [semantic, cardinal] of [
      ["context-in", "left"],
      ["tokens-out", "right"],
    ] as const) {
      const port = modelMeta.ports[semantic];
      assert.ok(port, `the entry declares no \`${semantic}\` port`);
      assert.equal(port.side, cardinal);
      assert.notEqual(port.offset ?? 0, modelMeta.ports[cardinal]?.offset ?? 0);
      // Inside the smallest footprint, whose half-extent is 2 units.
      assert.ok(Math.abs(port.offset ?? 0) < footprintUnits("s") / 2);
    }
  });
});

describe("model — a chip has no gaze, so it ignores `facing` (D-IL17)", () => {
  it("prints its contacts on the top face whichever way the flow runs", () => {
    const faces = (facing: "upstream" | "downstream") =>
      attributeValues(renderEntity(Model, { facing }), "data-illus-glyph-face");
    assert.deepEqual(faces("upstream"), ["top"]);
    assert.deepEqual(faces("downstream"), ["top"]);
  });
});

describe("model — one accent moment, and error recolours it (D-IL6)", () => {
  const accents = (markup: string) => (markup.match(/var\(--illus-accent\)/g) ?? []).length;

  it("lights only the die while idle, whichever variant", () => {
    for (const variant of MODEL_VARIANTS) {
      assert.equal(accents(renderEntity(Model, { variant })), 1);
    }
  });

  it("turns the die to the error token rather than adding a second mark", () => {
    const markup = renderEntity(Model, { state: "error" });
    assert.equal(accents(markup), 0);
    assert.ok(markup.includes("var(--illus-error)"));
  });
});

describe("model — declines a domain binding rather than stretching one (WP 1.1)", () => {
  it("binds to no table, because `model_pricing` is pricing and not the model", () => {
    assert.equal(modelMeta.entity, null);
  });
});
