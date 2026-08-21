import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { footprintUnits } from "../iso-math.js";
import { attributeValues } from "../test-support.js";
import { RUN_VARIANTS, Run, runHeightUnits, runMeta } from "./Run.js";
import { describeEntityContract, renderEntity } from "./contract-support.js";

describeEntityContract(Run, runMeta);

describe("run — the variant list and the drawing are one declaration", () => {
  it("draws exactly the variants the registry entry publishes", () => {
    assert.deepEqual([...RUN_VARIANTS], [...runMeta.variants]);
  });

  it("repeats SIDEWAYS: a second lane, not a taller one", () => {
    const lanes = (variant: string) =>
      attributeValues(renderEntity(Run, { variant }), "data-illus-primitive").filter(
        (name) => name === "iso-housing",
      ).length;
    // Both variants also draw the single platform tier, which is a housing itself.
    assert.equal(lanes("repeated") - lanes("single"), 1);
  });
});

describe("run — repetition must not move the ports (D-IL7)", () => {
  it("keeps both variants exactly as tall, so `enter` and `exit` cannot jump between them", () => {
    const dots = (variant: string) =>
      [
        ...renderEntity(Run, { variant, showPorts: true }).matchAll(
          /<circle cx="([^"]+)" cy="([^"]+)" r="4"/g,
        ),
      ].map((match) => `${match[1]},${match[2]}`);
    assert.deepEqual(dots("single"), dots("repeated"));
  });

  it("declares ground pad plus lane, at every footprint", () => {
    for (const size of runMeta.sizes) {
      assert.equal(runHeightUnits(size), 0.7 + footprintUnits(size) * 0.13);
    }
  });

  it("publishes `enter` and `exit`, clear of the cardinals they share a side with", () => {
    for (const [semantic, cardinal] of [
      ["enter", "left"],
      ["exit", "right"],
    ] as const) {
      const port = runMeta.ports[semantic];
      assert.ok(port, `the entry declares no \`${semantic}\` port`);
      assert.equal(port.side, cardinal);
      assert.notEqual(port.offset ?? 0, runMeta.ports[cardinal]?.offset ?? 0);
      assert.ok(Math.abs(port.offset ?? 0) < footprintUnits("s") / 2);
    }
  });
});

describe("run — a track has no gaze, so it ignores `facing` (D-IL17)", () => {
  it("keeps the direction marks on the top face whichever way the flow runs", () => {
    // Which way the work travels is the CONNECTORS' job. A track that silently re-pointed itself
    // when a layout engine set `facing` would contradict the lines drawn to it.
    const faces = (facing: "upstream" | "downstream") =>
      attributeValues(renderEntity(Run, { facing }), "data-illus-glyph-face");
    assert.deepEqual(new Set(faces("upstream")), new Set(["top"]));
    assert.deepEqual(new Set(faces("downstream")), new Set(["top"]));
  });
});

describe("run — one accent moment, and error recolours it (D-IL6)", () => {
  const accents = (markup: string) => (markup.match(/var\(--illus-accent\)/g) ?? []).length;

  it("lights exactly one chevron, even when there are two lanes of three", () => {
    for (const variant of RUN_VARIANTS) {
      const markup = renderEntity(Run, { variant });
      assert.equal(accents(markup), 1, `${variant} spent more than one accent moment`);
      assert.equal(
        attributeValues(markup, "data-illus-mark").filter((mark) => mark === "direction").length,
        variant === "repeated" ? 6 : 3,
      );
    }
  });

  it("turns the lit chevron to the error token rather than adding a second mark", () => {
    const markup = renderEntity(Run, { state: "error" });
    assert.equal(accents(markup), 0);
    assert.ok(markup.includes("var(--illus-error)"));
  });
});
