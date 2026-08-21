import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { attributeValues } from "../test-support.js";
import {
  COLLECTION_VARIANTS,
  Collection,
  collectionHeightUnits,
  collectionMeta,
} from "./Collection.js";
import { describeEntityContract, renderEntity } from "./contract-support.js";

describeEntityContract(Collection, collectionMeta);

const accents = (markup: string) => (markup.match(/var\(--illus-accent\)/g) ?? []).length;
const marks = (markup: string, mark: string) =>
  attributeValues(markup, "data-illus-mark").filter((name) => name === mark).length;

/** The screen width of each solid, in document order: the first polygon of each housing group. */
function housingWidths(markup: string): number[] {
  return markup
    .split('data-illus-primitive="iso-housing"')
    .slice(1)
    .map((chunk) => {
      const points = /points="([^"]+)"/.exec(chunk)?.[1] ?? "";
      const xs = points.split(" ").map((pair) => Number(pair.split(",")[0]));
      return Number((Math.max(...xs) - Math.min(...xs)).toFixed(3));
    });
}

describe("collection — the variant list and the drawing are one declaration", () => {
  it("draws exactly the variants the registry entry publishes", () => {
    assert.deepEqual([...COLLECTION_VARIANTS], [...collectionMeta.variants]);
  });
});

describe("collection — the pulled drawer is the silhouette, not a front-panel detail", () => {
  it("stands the drawer OUTSIDE the cabinet, so the outline itself steps", () => {
    // A detail on a closed cabinet front vanishes at `s` and from across a scene. The step has to be
    // in the outline, which means the drawer's own solid must reach past the body's near edge.
    const markup = renderEntity(Collection, { variant: "local" });
    const rightmost = (chunk: string) => {
      const points = /points="([^"]+)"/.exec(chunk)?.[1] ?? "";
      return Math.max(...points.split(" ").map((pair) => Number(pair.split(",")[0])));
    };
    const solids = markup.split('data-illus-primitive="iso-housing"').slice(1);
    // pad tier, cabinet body, drawer — the drawer is the last one drawn on `local`.
    const body = rightmost(solids[1] as string);
    const drawer = rightmost(solids[2] as string);
    assert.ok(drawer > body, `the drawer (${drawer}) does not reach past the body (${body})`);
  });

  it("divides the open drawer, which is what makes it a collection and not a cupboard", () => {
    assert.equal(marks(renderEntity(Collection, { variant: "local" }), "tab"), 1);
  });
});

describe("collection — binding MOVES the accent, it never adds one (D-IL6)", () => {
  it("spends exactly one accent in either variant", () => {
    for (const variant of COLLECTION_VARIANTS) {
      assert.equal(accents(renderEntity(Collection, { variant })), 1, `${variant} spent more`);
    }
  });

  it("lights the drawer tab when local and the coupling when bound", () => {
    const local = renderEntity(Collection, { variant: "local" });
    const bound = renderEntity(Collection, { variant: "git-bound" });
    assert.equal(marks(local, "coupling"), 0);
    assert.equal(marks(bound, "coupling"), 1);
    // The tab is still drawn when bound — it just stops being the lit one.
    assert.equal(marks(bound, "tab"), 1);
  });

  it("recolours rather than adds on error, in either variant", () => {
    for (const variant of COLLECTION_VARIANTS) {
      const markup = renderEntity(Collection, { variant, state: "error" });
      assert.equal(accents(markup), 0);
      assert.ok(markup.includes("var(--illus-error)"));
    }
  });
});

describe("collection — binding to git must not move a connector (D-IL7)", () => {
  it("keeps the coupling shorter than the body, so both variants declare one height", () => {
    for (const size of collectionMeta.sizes) {
      const local = housingWidths(renderEntity(Collection, { size, variant: "local" }));
      const bound = housingWidths(renderEntity(Collection, { size, variant: "git-bound" }));
      // The bound variant adds exactly one solid — the coupling — and nothing else changes shape.
      assert.equal(bound.length - local.length, 1);
      assert.ok(collectionHeightUnits(size) > 0);
    }
  });

  it("anchors every port at the same place in both variants", () => {
    const dots = (variant: string) =>
      [
        ...renderEntity(Collection, { variant, showPorts: true }).matchAll(
          /<circle cx="([^"]+)" cy="([^"]+)" r="4"/g,
        ),
      ].map((match) => `${match[1]},${match[2]}`);
    assert.deepEqual(dots("local"), dots("git-bound"));
  });
});
