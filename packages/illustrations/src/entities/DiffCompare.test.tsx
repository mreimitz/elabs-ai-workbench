import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { attributeValues } from "../test-support.js";
import {
  DIFF_COMPARE_VARIANTS,
  DiffCompare,
  diffCompareHeightUnits,
  diffCompareMeta,
} from "./DiffCompare.js";
import { describeEntityContract, renderEntity } from "./contract-support.js";

describeEntityContract(DiffCompare, diffCompareMeta);

const accents = (markup: string) => (markup.match(/var\(--illus-accent\)/g) ?? []).length;
const marks = (markup: string, mark: string) =>
  attributeValues(markup, "data-illus-mark").filter((name) => name === mark).length;

describe("diff-compare — the split IS the entity", () => {
  it("draws exactly the variants the registry entry publishes", () => {
    assert.deepEqual([...DIFF_COMPARE_VARIANTS], [...diffCompareMeta.variants]);
  });

  it("uses no plinth at all — the thing being cut is the pedestal itself", () => {
    // Every other station in the catalog stands ON an `IsoPlatform`. Here the platform is the
    // subject, so there is none: a comparison drawn as two objects on one plinth is two objects.
    const markup = renderEntity(DiffCompare, {});
    assert.ok(
      !attributeValues(markup, "data-illus-primitive").includes("iso-platform"),
      "a plinth appeared under the split pedestal, so the split stopped being the drawing",
    );
  });

  it("leaves daylight between the halves, at every footprint and in both variants", () => {
    // The gap is the shape. If the two halves ever touch, the drawing is one pedestal with a seam.
    const nearestEdges = (markup: string) => {
      const solids = markup.split('data-illus-primitive="iso-housing"').slice(1);
      // The two halves are the first and the third solid (each is followed by its specimen).
      return [solids[0], solids[2]].map((chunk) => {
        const points = /points="([^"]+)"/.exec(chunk as string)?.[1] ?? "";
        const ys = points.split(" ").map((pair) => Number(pair.split(",")[1]));
        return { min: Math.min(...ys), max: Math.max(...ys) };
      });
    };
    for (const size of diffCompareMeta.sizes) {
      for (const variant of DIFF_COMPARE_VARIANTS) {
        const [far, near] = nearestEdges(renderEntity(DiffCompare, { size, variant }));
        assert.ok(far && near);
        assert.ok(far.max < near.max, `${size}/${variant} did not stagger its halves`);
      }
    }
  });
});

describe("diff-compare — the variant changes the far half's SHAPE, never the height (D-IL7)", () => {
  it("flattens the far half into a datum plate on `baseline`", () => {
    const rules = (markup: string) => (markup.match(/<line /g) ?? []).length;
    const twoWay = renderEntity(DiffCompare, { variant: "two-way" });
    const baseline = renderEntity(DiffCompare, { variant: "baseline" });
    // Both still carry exactly one delta — the near half is a full specimen either way.
    assert.equal(marks(twoWay, "delta"), 1);
    assert.equal(marks(baseline, "delta"), 1);
    // The graduation rules are what turn a flat plate into a reference SURFACE rather than a
    // squashed peer, and they exist only on `baseline`.
    assert.equal(rules(twoWay), 0);
    assert.equal(rules(baseline), 5);
  });

  it("anchors `delta-out` at exactly the same place in both variants", () => {
    const dots = (variant: string) =>
      [
        ...renderEntity(DiffCompare, { variant, showPorts: true }).matchAll(
          /<circle cx="([^"]+)" cy="([^"]+)" r="4"/g,
        ),
      ].map((match) => `${match[1]},${match[2]}`);
    assert.deepEqual(dots("two-way"), dots("baseline"));
  });

  it("declares one height, decided by the near specimen", () => {
    for (const size of diffCompareMeta.sizes) {
      assert.ok(diffCompareHeightUnits(size) > 0);
    }
  });
});

describe("diff-compare — one accent moment, and it is the delta (D-IL6)", () => {
  it("spends exactly one in either variant", () => {
    for (const variant of DIFF_COMPARE_VARIANTS) {
      assert.equal(accents(renderEntity(DiffCompare, { variant })), 1);
    }
  });

  it("recolours the delta on error rather than adding a mark", () => {
    const markup = renderEntity(DiffCompare, { state: "error" });
    assert.equal(accents(markup), 0);
    assert.equal(marks(markup, "delta"), 1);
    assert.ok(markup.includes("var(--illus-error)"));
  });
});

describe("diff-compare — it binds to no table, on purpose", () => {
  it("omits `entity` rather than stretching one (WP 1.3)", () => {
    // Scans, servers, runs and suites are all compared. Naming one of those tables would have made
    // this "the scan comparison", which is not what the component is.
    assert.equal(diffCompareMeta.entity, null);
  });
});
