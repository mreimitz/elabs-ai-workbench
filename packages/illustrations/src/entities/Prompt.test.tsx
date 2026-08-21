import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { footprintUnits } from "../iso-math.js";
import { attributeValues } from "../test-support.js";
import { PROMPT_VARIANTS, Prompt, promptHeightUnits, promptMeta } from "./Prompt.js";
import { describeEntityContract, renderEntity } from "./contract-support.js";

describeEntityContract(Prompt, promptMeta);

describe("prompt — the variant list and the drawing are one declaration", () => {
  it("draws exactly the variants the registry entry publishes", () => {
    assert.deepEqual([...PROMPT_VARIANTS], [...promptMeta.variants]);
  });

  it("gives a person's prompt a tail and a system instruction its brackets", () => {
    // `EntityRoot` paints its own `ground-shadow` mark under every entity, so this asks only about
    // the marks the PROMPT contributes.
    const marks = (variant: string) =>
      attributeValues(renderEntity(Prompt, { variant }), "data-illus-mark").filter(
        (mark) => mark !== "ground-shadow",
      );
    assert.deepEqual(marks("user"), ["speech-tail"]);
    assert.deepEqual(marks("system"), ["placard-bracket", "placard-bracket"]);
  });
});

describe("prompt — the attachment changes, the board does not (D-IL7)", () => {
  it("keeps both variants exactly as tall, so `emit` cannot jump between them", () => {
    const dots = (variant: string) =>
      [
        ...renderEntity(Prompt, { variant, showPorts: true }).matchAll(
          /<circle cx="([^"]+)" cy="([^"]+)" r="4"/g,
        ),
      ].map((match) => `${match[1]},${match[2]}`);
    assert.deepEqual(dots("user"), dots("system"));
  });

  it("declares plinth plus post plus board, at every footprint", () => {
    for (const size of promptMeta.sizes) {
      const footprint = footprintUnits(size);
      assert.equal(promptHeightUnits(size), 1.2 + footprint * 0.19 + footprint * 0.3);
    }
  });

  it("publishes `emit` on the right edge, clear of the plain `right` cardinal", () => {
    const port = promptMeta.ports.emit;
    assert.ok(port, "the entry declares no `emit` port");
    assert.equal(port.side, "right");
    assert.notEqual(port.offset ?? 0, promptMeta.ports.right?.offset ?? 0);
    assert.ok(Math.abs(port.offset ?? 0) < footprintUnits("s") / 2);
  });
});

describe("prompt — a placard does not turn, so it ignores `facing` (D-IL17)", () => {
  it("keeps the message on the left face whichever way the flow runs", () => {
    // The closest call among WP 1.1's five: a board obviously has a front. But `facing` is about
    // GAZE — a character turning to look at the work — and a mounted board does not turn.
    const faces = (facing: "upstream" | "downstream") =>
      attributeValues(renderEntity(Prompt, { facing }), "data-illus-glyph-face");
    assert.deepEqual(faces("upstream"), ["left"]);
    assert.deepEqual(faces("downstream"), ["left"]);
  });
});

describe("prompt — one accent moment, and error recolours it (D-IL6)", () => {
  const accents = (markup: string) => (markup.match(/var\(--illus-accent\)/g) ?? []).length;

  it("lights only the heading bar, whichever variant", () => {
    for (const variant of PROMPT_VARIANTS) {
      assert.equal(accents(renderEntity(Prompt, { variant })), 1);
    }
  });

  it("turns the heading bar to the error token rather than adding a second mark", () => {
    const markup = renderEntity(Prompt, { state: "error" });
    assert.equal(accents(markup), 0);
    assert.ok(markup.includes("var(--illus-error)"));
  });
});
