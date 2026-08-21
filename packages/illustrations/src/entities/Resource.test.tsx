import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { footprintUnits } from "../iso-math.js";
import { attributeValues } from "../test-support.js";
import { Resource, resourceHeightUnits, resourceMeta } from "./Resource.js";
import { describeEntityContract, renderEntity } from "./contract-support.js";

describeEntityContract(Resource, resourceMeta);

describe("resource — read, never written (WP 1.2)", () => {
  const CARDINALS = ["top", "bottom", "left", "right"];

  it("declares exactly one semantic port, and it points outward", () => {
    const semantic = Object.keys(resourceMeta.ports).filter((name) => !CARDINALS.includes(name));
    assert.deepEqual(semantic, ["read-out"]);
    assert.equal(resourceMeta.ports["read-out"]?.side, "right");
  });

  it("keeps `read-out` clear of the plain `right` cardinal it shares a side with", () => {
    const port = resourceMeta.ports["read-out"];
    assert.ok(port);
    assert.notEqual(port.offset ?? 0, resourceMeta.ports.right?.offset ?? 0);
    // Inside the smallest footprint, whose half-extent is 2 units.
    assert.ok(Math.abs(port.offset ?? 0) < footprintUnits("s") / 2);
  });

  it("binds to the table an operator would recognise as this thing", () => {
    assert.equal(resourceMeta.entity, "mcp_resource_scans");
  });
});

describe("resource — a crate on the ground, not a station on a plinth (WP 1.2)", () => {
  it("stands on ONE plinth tier", () => {
    for (const size of resourceMeta.sizes) {
      assert.equal(resourceHeightUnits(size), 0.7 + footprintUnits(size) * 0.28);
    }
  });

  it("carries its manifest as a card fixed to the crate, not as printing on the wood", () => {
    // The card is a real outlined surface — the thing that makes this a LABELLED crate rather than
    // a box with a stripe. If it stops being drawn, the drawing stops saying what it is.
    const markup = renderEntity(Resource, {});
    assert.ok(markup.includes('data-illus-mark="manifest-card"'));
    assert.ok(markup.includes("var(--illus-surface)"));
  });
});

describe("resource — a labelled side is not a gaze, so it ignores `facing` (D-IL17)", () => {
  it("keeps the manifest on the left face whichever way the flow runs", () => {
    const faces = (facing: "upstream" | "downstream") =>
      attributeValues(renderEntity(Resource, { facing }), "data-illus-glyph-face");
    assert.deepEqual(faces("upstream"), ["left"]);
    assert.deepEqual(faces("downstream"), ["left"]);
  });
});

describe("resource — one accent moment, and error recolours it (D-IL6)", () => {
  const accents = (markup: string) => (markup.match(/var\(--illus-accent\)/g) ?? []).length;

  it("lights only the URI chip on the manifest while idle", () => {
    assert.equal(accents(renderEntity(Resource, {})), 1);
  });

  it("turns the chip to the error token rather than adding a second mark", () => {
    const markup = renderEntity(Resource, { state: "error" });
    assert.equal(accents(markup), 0);
    assert.ok(markup.includes("var(--illus-error)"));
  });
});
