import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { footprintUnits } from "../iso-math.js";
import { attributeValues } from "../test-support.js";
import { Prompt, promptHeightUnits, promptMeta } from "./Prompt.js";
import {
  PromptTemplate,
  promptTemplateHeightUnits,
  promptTemplateMeta,
} from "./PromptTemplate.js";
import { describeEntityContract, renderEntity } from "./contract-support.js";

describeEntityContract(PromptTemplate, promptTemplateMeta);

// WP 1.2's one hard requirement for this entity: it must be visibly NOT the same object as WP 1.1's
// `prompt`. "Visibly" is checked the way a viewer checks it — posture first, then where the drawing
// is read from — rather than by asserting that two markup strings differ, which two arrangements of
// the same speech bubble would also satisfy.
describe("prompt-template — the form, not the message (WP 1.2)", () => {
  it("lies flat where `prompt` stands up: under two fifths of its height, at every size", () => {
    for (const size of promptTemplateMeta.sizes) {
      const plate = promptTemplateHeightUnits(size);
      const bubble = promptHeightUnits(size);
      assert.ok(
        plate < bubble * 0.4,
        `${size}: the template stands ${plate} against the prompt's ${bubble} — too close to read as a different object`,
      );
    }
  });

  it("is read from ABOVE, where `prompt` is read from the front", () => {
    assert.deepEqual(
      attributeValues(renderEntity(PromptTemplate, {}), "data-illus-glyph-face"),
      ["top"],
    );
    assert.deepEqual(attributeValues(renderEntity(Prompt, {}), "data-illus-glyph-face"), ["left"]);
  });

  it("is its own catalog entry against its own table, not a variant of `prompt`", () => {
    assert.notEqual(promptTemplateMeta.id, promptMeta.id);
    assert.equal(promptTemplateMeta.entity, "mcp_prompt_scans");
    assert.equal(promptMeta.entity, "tests");
  });
});

describe("prompt-template — a stencil is holes plus registration (WP 1.2)", () => {
  const marks = (markup: string, mark: string) =>
    (markup.match(new RegExp(`data-illus-mark="${mark}"`, "g")) ?? []).length;

  it("cuts three argument slots and fills exactly one of them", () => {
    const markup = renderEntity(PromptTemplate, {});
    assert.equal(marks(markup, "argument-slot"), 3);
    assert.equal(marks(markup, "filled-argument"), 1);
  });

  it("draws the slots SUNKEN, so a cut reads as a cut rather than as printing", () => {
    assert.ok(renderEntity(PromptTemplate, {}).includes("var(--illus-surface-sunken)"));
  });

  it("carries a registration mark at each of the plate's four corners", () => {
    assert.equal(marks(renderEntity(PromptTemplate, {}), "registration"), 4);
  });
});

describe("prompt-template — arguments in, a message out (D-IL7)", () => {
  it("fills from above and emits sideways, both clear of the cardinals they share", () => {
    for (const [semantic, cardinal] of [
      ["fill-in", "top"],
      ["emit", "right"],
    ] as const) {
      const port = promptTemplateMeta.ports[semantic];
      assert.ok(port, `the entry declares no \`${semantic}\` port`);
      assert.equal(port.side, cardinal);
      assert.notEqual(port.offset ?? 0, promptTemplateMeta.ports[cardinal]?.offset ?? 0);
      // Inside the smallest footprint, whose half-extent is 2 units.
      assert.ok(Math.abs(port.offset ?? 0) < footprintUnits("s") / 2);
    }
  });
});

describe("prompt-template — a plate has no gaze, so it ignores `facing` (D-IL17)", () => {
  it("keeps its cuts on the top face whichever way the flow runs", () => {
    const faces = (facing: "upstream" | "downstream") =>
      attributeValues(renderEntity(PromptTemplate, { facing }), "data-illus-glyph-face");
    assert.deepEqual(faces("upstream"), ["top"]);
    assert.deepEqual(faces("downstream"), ["top"]);
  });
});

describe("prompt-template — one accent moment, and error recolours it (D-IL6)", () => {
  const accents = (markup: string) => (markup.match(/var\(--illus-accent\)/g) ?? []).length;

  it("lights only the supplied argument while idle", () => {
    assert.equal(accents(renderEntity(PromptTemplate, {})), 1);
  });

  it("turns it to the error token rather than adding a second mark", () => {
    const markup = renderEntity(PromptTemplate, { state: "error" });
    assert.equal(accents(markup), 0);
    assert.ok(markup.includes("var(--illus-error)"));
  });
});
