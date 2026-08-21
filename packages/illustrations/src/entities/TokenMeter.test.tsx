import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { footprintUnits } from "../iso-math.js";
import { attributeValues } from "../test-support.js";
import {
  TOKEN_METER_VARIANTS,
  TokenMeter,
  tokenMeterHeightUnits,
  tokenMeterMeta,
} from "./TokenMeter.js";
import { describeEntityContract, renderEntity } from "./contract-support.js";

describeEntityContract(TokenMeter, tokenMeterMeta);

describe("token-meter — the variant list and the drawing are one declaration", () => {
  it("draws exactly the variants the registry entry publishes", () => {
    assert.deepEqual([...TOKEN_METER_VARIANTS], [...tokenMeterMeta.variants]);
  });

  it("marks a ceiling on `budget` and a quantity on `spend`, never both", () => {
    const budget = renderEntity(TokenMeter, { variant: "budget" });
    const spend = renderEntity(TokenMeter, { variant: "spend" });
    assert.ok(budget.includes('data-illus-mark="ceiling"'));
    assert.ok(!budget.includes('data-illus-mark="consumed"'));
    assert.ok(spend.includes('data-illus-mark="consumed"'));
    assert.ok(!spend.includes('data-illus-mark="ceiling"'));
  });

  it("draws a ceiling in the CONSTRUCTION vocabulary — a limit is a line you have not reached", () => {
    assert.ok(renderEntity(TokenMeter, { variant: "budget" }).includes("var(--illus-guide)"));
  });
});

describe("token-meter — the reading moves, the column does not (D-IL7)", () => {
  it("stacks four segments on a two-tier plinth, at every footprint", () => {
    for (const size of tokenMeterMeta.sizes) {
      assert.equal(tokenMeterHeightUnits(size), 1.2 + footprintUnits(size) * 0.6);
    }
    const housings = attributeValues(renderEntity(TokenMeter, {}), "data-illus-primitive").filter(
      (name) => name === "iso-housing",
    ).length;
    // Two plinth tiers plus four segments.
    assert.equal(housings, 6);
  });

  it("anchors `measure-in` identically in both variants", () => {
    const dots = (variant: string) =>
      [
        ...renderEntity(TokenMeter, { variant, showPorts: true }).matchAll(
          /<circle cx="([^"]+)" cy="([^"]+)" r="4"/g,
        ),
      ].map((match) => `${match[1]},${match[2]}`);
    assert.deepEqual(dots("budget"), dots("spend"));
  });

  it("is fed, never feeds — one semantic port, pointing inward", () => {
    const cardinals = ["top", "bottom", "left", "right"];
    const semantic = Object.keys(tokenMeterMeta.ports).filter((name) => !cardinals.includes(name));
    assert.deepEqual(semantic, ["measure-in"]);
    assert.equal(tokenMeterMeta.ports["measure-in"]?.side, "left");
    assert.notEqual(
      tokenMeterMeta.ports["measure-in"]?.offset ?? 0,
      tokenMeterMeta.ports.left?.offset ?? 0,
    );
  });
});

describe("token-meter — a meter, not a chart (D-IL1, D-IL6)", () => {
  it("sets no type of its own — no axis, no scale, no number", () => {
    // A chart is a drawing that needs lettering to be read. This one must not: the ONLY text an
    // illustration may carry is the screen-aligned caption and the port overlay, both of which the
    // caller asks for explicitly. Anything else here would be `@elabs-ai/components-charts`' job.
    for (const variant of TOKEN_METER_VARIANTS) {
      assert.ok(!renderEntity(TokenMeter, { variant }).includes("<text"));
    }
  });

  it("puts the accent on the read-off mark and leaves the segments as ink", () => {
    for (const variant of TOKEN_METER_VARIANTS) {
      const markup = renderEntity(TokenMeter, { variant });
      assert.equal((markup.match(/var\(--illus-accent\)/g) ?? []).length, 1);
      assert.ok(markup.includes('data-illus-mark="read-off"'));
    }
  });

  it("turns the pointer to the error token rather than adding a second mark", () => {
    const markup = renderEntity(TokenMeter, { state: "error" });
    assert.equal((markup.match(/var\(--illus-accent\)/g) ?? []).length, 0);
    assert.ok(markup.includes("var(--illus-error)"));
  });

  it("declines a domain binding, because accounting is not a table (WP 1.2)", () => {
    assert.equal(tokenMeterMeta.entity, null);
  });
});

describe("token-meter — a dial has no gaze, so it ignores `facing` (D-IL17)", () => {
  it("keeps the read-off face on the left whichever way the flow runs", () => {
    const faces = (facing: "upstream" | "downstream") =>
      attributeValues(renderEntity(TokenMeter, { facing }), "data-illus-glyph-face");
    assert.deepEqual(faces("upstream"), ["left"]);
    assert.deepEqual(faces("downstream"), ["left"]);
  });
});
