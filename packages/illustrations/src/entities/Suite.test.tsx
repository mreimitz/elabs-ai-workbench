import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { footprintUnits } from "../iso-math.js";
import { attributeValues } from "../test-support.js";
import { Run, runHeightUnits } from "./Run.js";
import { Suite, suiteHeightUnits, suiteMeta } from "./Suite.js";
import { describeEntityContract, renderEntity } from "./contract-support.js";

describeEntityContract(Suite, suiteMeta);

const accents = (markup: string) => (markup.match(/var\(--illus-accent\)/g) ?? []).length;
const marks = (markup: string, mark: string) =>
  attributeValues(markup, "data-illus-mark").filter((name) => name === mark).length;

describe("suite — it is made of `run`'s track, not of a second track", () => {
  it("draws three lanes, each carrying the shared direction marks", () => {
    // The point of extracting `primitives/IsoTrack.tsx`: a suite is literally many runs, so the
    // lanes here are the SAME lane `run` draws. Three lanes x two chevrons is the shared glyph
    // running three times, not a lookalike drawn from memory.
    assert.equal(marks(renderEntity(Suite, {}), "direction"), 6);
  });

  it("frames them, which is the whole difference from a repeated run", () => {
    // Without the two end rails a three-lane suite is a repeated run with one more lane — the same
    // silhouette at a glance, which is exactly the sameness this cast has to avoid. The rails are
    // two extra solids beyond the pad and the lanes.
    const housings = (markup: string) =>
      attributeValues(markup, "data-illus-primitive").filter((name) => name === "iso-housing")
        .length;
    // pad tier (1) + three lanes + two rails = 6; a repeated run is pad + two lanes = 3.
    assert.equal(housings(renderEntity(Suite, {})), 6);
    assert.equal(housings(renderEntity(Run, { variant: "repeated" })), 3);
  });

  it("stands well clear of a run at every footprint, so the two never read the same", () => {
    for (const size of suiteMeta.sizes) {
      assert.ok(
        suiteHeightUnits(size) > runHeightUnits(size) * 1.5,
        `at ${size} a suite is only ${suiteHeightUnits(size)} against a run's ${runHeightUnits(size)}`,
      );
    }
  });
});

describe("suite — one accent moment across three lanes (D-IL6)", () => {
  it("lights exactly one chevron, on the middle lane", () => {
    assert.equal(accents(renderEntity(Suite, {})), 1);
  });

  it("recolours it on error rather than adding a second mark", () => {
    const markup = renderEntity(Suite, { state: "error" });
    assert.equal(accents(markup), 0);
    assert.ok(markup.includes("var(--illus-error)"));
    assert.equal(marks(markup, "direction"), 6);
  });
});

describe("suite — dispatch and collect share an edge (D-IL7)", () => {
  it("declares both on the right side, at offsets that cannot stack on the cardinal", () => {
    // A suite is not a stage work passes through: it hands members out and takes results back. Two
    // ports on one edge is that sentence, and both must stay clear of the plain `right` cardinal.
    for (const name of ["dispatch", "collect"] as const) {
      const port = suiteMeta.ports[name];
      assert.ok(port, `the entry declares no \`${name}\` port`);
      assert.equal(port.side, "right");
      assert.notEqual(port.offset ?? 0, suiteMeta.ports.right?.offset ?? 0);
      assert.ok(Math.abs(port.offset ?? 0) < footprintUnits("s") / 2);
    }
    assert.notEqual(suiteMeta.ports.dispatch?.offset, suiteMeta.ports.collect?.offset);
  });
});
