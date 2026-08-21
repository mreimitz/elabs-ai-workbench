import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type IsoBox, footprintUnits } from "../iso-math.js";
import { sheetStackBoxes } from "../primitives/IsoSheetStack.js";
import { attributeValues } from "../test-support.js";
import { FILE_VARIANTS, File, fileHeightUnits, fileMeta } from "./File.js";
import { describeEntityContract, renderEntity } from "./contract-support.js";

describeEntityContract(File, fileMeta);

const SLAB: IsoBox = { cx: 0, cy: 0, w: 3.48, d: 3.48, z0: 1.2, h: 0.84 };

describe("file — the variant list and the drawing are one declaration", () => {
  it("draws exactly the variants the registry entry publishes", () => {
    assert.deepEqual([...FILE_VARIANTS], [...fileMeta.variants]);
  });

  it("adds three more sheets for `stack`, and nothing else", () => {
    const housings = (variant: string) =>
      attributeValues(renderEntity(File, { variant }), "data-illus-primitive").filter(
        (name) => name === "iso-housing",
      ).length;
    assert.equal(housings("stack") - housings("single"), 3);
  });
});

describe("file — a pile is fanned where a skill is laminated (WP 1.2)", () => {
  // Both entities are drawn on the SAME primitive, so the thing that has to be true is that they
  // ask it for different shapes. Asserted through the primitive's own geometry rather than by
  // diffing markup: two drawings differ for all sorts of uninteresting reasons, but only one of
  // them means "a pile of attachments does not look like a bound document".
  it("nudges every sheet off the one below it, on both ground axes", () => {
    const fanned = sheetStackBoxes(SLAB, 4, { staggerFraction: 0.075 }).sheets;
    for (let sheet = 1; sheet < fanned.length; sheet += 1) {
      const above = fanned[sheet] as IsoBox;
      const below = fanned[sheet - 1] as IsoBox;
      assert.ok(above.cx > below.cx, `sheet ${sheet} did not fan along x`);
      assert.ok(above.cy > below.cy, `sheet ${sheet} did not fan along y`);
    }
  });

  it("keeps a lamination flush, which is what `skill` asks the same primitive for", () => {
    for (const sheet of sheetStackBoxes(SLAB, 3).sheets) {
      assert.equal(sheet.cx, SLAB.cx);
      assert.equal(sheet.cy, SLAB.cy);
    }
  });

  it("prints the clip on whichever sheet the fan puts on top, not on the slab's centre", () => {
    const top = sheetStackBoxes(SLAB, 4, { staggerFraction: 0.075 }).top;
    assert.ok(top.cx > SLAB.cx);
    assert.equal(top.z0 + top.h, SLAB.z0 + SLAB.h);
  });
});

describe("file — fanning must not move the ports (D-IL7)", () => {
  it("keeps both variants exactly as tall, so `attach` cannot jump between them", () => {
    const dots = (variant: string) =>
      [
        ...renderEntity(File, { variant, showPorts: true }).matchAll(
          /<circle cx="([^"]+)" cy="([^"]+)" r="4"/g,
        ),
      ].map((match) => `${match[1]},${match[2]}`);
    assert.deepEqual(dots("single"), dots("stack"));
  });

  it("declares a height of plinth plus slab, at every footprint", () => {
    for (const size of fileMeta.sizes) {
      assert.equal(fileHeightUnits(size), 1.2 + footprintUnits(size) * 0.14);
    }
  });
});

describe("file — carried, not sent (WP 1.2)", () => {
  it("puts `attach` on the top edge where a clip bites, clear of the `top` cardinal", () => {
    const port = fileMeta.ports.attach;
    assert.ok(port, "the entry declares no `attach` port");
    assert.equal(port.side, "top");
    assert.notEqual(port.offset ?? 0, fileMeta.ports.top?.offset ?? 0);
    // Inside the smallest footprint, whose half-extent is 2 units.
    assert.ok(Math.abs(port.offset ?? 0) < footprintUnits("s") / 2);
  });

  it("binds to the table an operator would recognise as this thing", () => {
    assert.equal(fileMeta.entity, "test_attachments");
  });
});

describe("file — paper has no gaze, so it ignores `facing` (D-IL17)", () => {
  it("keeps the clip on the top face whichever way the flow runs", () => {
    const faces = (facing: "upstream" | "downstream") =>
      attributeValues(renderEntity(File, { facing }), "data-illus-glyph-face");
    assert.deepEqual(faces("upstream"), ["top"]);
    assert.deepEqual(faces("downstream"), ["top"]);
  });
});

describe("file — one accent moment, and error recolours it (D-IL6)", () => {
  const accents = (markup: string) => (markup.match(/var\(--illus-accent\)/g) ?? []).length;

  it("lights only the clip, whichever variant", () => {
    for (const variant of FILE_VARIANTS) {
      assert.equal(accents(renderEntity(File, { variant })), 1);
    }
  });

  it("turns the clip to the error token rather than adding a second mark", () => {
    const markup = renderEntity(File, { state: "error" });
    assert.equal(accents(markup), 0);
    assert.ok(markup.includes("var(--illus-error)"));
  });
});
