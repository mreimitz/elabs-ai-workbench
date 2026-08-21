import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { footprintUnits } from "../iso-math.js";
import { figureHeightUnits } from "../primitives/IsoFigure.js";
import { attributeValues } from "../test-support.js";
import { Agent } from "./Agent.js";
import { VALIDATOR_VARIANTS, Validator, validatorHeightUnits, validatorMeta } from "./Validator.js";
import { describeEntityContract, renderEntity } from "./contract-support.js";

describeEntityContract(Validator, validatorMeta);

describe("validator — the variant list and the drawing are one declaration", () => {
  it("draws exactly the variants the registry entry publishes", () => {
    assert.deepEqual([...VALIDATOR_VARIANTS], [...validatorMeta.variants]);
  });

  it("changes the MARK inside the shield, never the shield itself", () => {
    // The shield is the entity; what it is held up for is the variant. Both drawings carry exactly
    // one shield outline, and they differ in the mark on it.
    for (const variant of VALIDATOR_VARIANTS) {
      const marks = attributeValues(renderEntity(Validator, { variant }), "data-illus-mark");
      assert.equal(marks.filter((mark) => mark === "shield").length, 1);
    }
    assert.ok(
      attributeValues(renderEntity(Validator, { variant: "grader" }), "data-illus-mark").includes(
        "score-chevron",
      ),
    );
    assert.ok(
      attributeValues(renderEntity(Validator, { variant: "guardrail" }), "data-illus-mark").includes(
        "barrier",
      ),
    );
  });
});

describe("validator — it is NOT the agent in a costume (WP 1.1 §3)", () => {
  it("has its own id, so the gallery, the scene validator and the assistant can all find it", () => {
    assert.equal(validatorMeta.id, "validator");
    assert.notEqual(validatorMeta.entity, "runs");
  });

  it("shares the figure with the agent but carries something different", () => {
    const validator = renderEntity(Validator, {});
    const agent = renderEntity(Agent, {});
    // The same primitive draws the silhouette in both — that is the shared shape §3 moved into
    // `primitives/`, and the reason the two figures cannot drift apart at the shoulders.
    assert.ok(validator.includes('data-illus-primitive="iso-figure"'));
    assert.ok(agent.includes('data-illus-primitive="iso-figure"'));
    // And what they carry is what tells them apart: a shield here, a mast there.
    assert.ok(validator.includes('data-illus-mark="shield"'));
    assert.ok(!validator.includes('data-illus-mark="antenna"'));
    assert.ok(agent.includes('data-illus-mark="antenna"'));
    assert.ok(!agent.includes('data-illus-mark="shield"'));
  });

  it("stands exactly as tall as the figure, because there is no mast above it", () => {
    for (const size of validatorMeta.sizes) {
      assert.equal(validatorHeightUnits(size), figureHeightUnits(footprintUnits(size), 1.2));
    }
  });
});

describe("validator — it HAS a face, so it honours `facing` (D-IL17)", () => {
  it("mounts the visor and the shield on the LEFT face by default, looking upstream", () => {
    const faces = attributeValues(renderEntity(Validator, {}), "data-illus-glyph-face");
    assert.deepEqual(new Set(faces), new Set(["left"]));
    assert.equal(faces.length, 2, "expected exactly the visor and the shield on the gaze face");
  });

  it("moves both to the right face when it faces downstream", () => {
    const faces = attributeValues(
      renderEntity(Validator, { facing: "downstream" }),
      "data-illus-glyph-face",
    );
    assert.deepEqual(new Set(faces), new Set(["right"]));
  });

  it("really redraws — the two facings are different markup, not just a different attribute", () => {
    const strip = (markup: string) => markup.replace(/ data-illus-facing="[^"]*"/g, "");
    assert.notEqual(
      strip(renderEntity(Validator, { facing: "upstream" })),
      strip(renderEntity(Validator, { facing: "downstream" })),
    );
  });
});

describe("validator — one accent moment, and error recolours it (D-IL6)", () => {
  const accents = (markup: string) => (markup.match(/var\(--illus-accent\)/g) ?? []).length;

  it("lights only the verdict mark, whichever variant", () => {
    for (const variant of VALIDATOR_VARIANTS) {
      assert.equal(accents(renderEntity(Validator, { variant })), 1);
    }
  });

  it("turns the mark and the figure's eyes to the error token, never a second accent", () => {
    const markup = renderEntity(Validator, { state: "error" });
    assert.equal(accents(markup), 0);
    assert.ok(markup.includes("var(--illus-error)"));
  });
});

describe("validator — the sentence its ports draw (D-IL7)", () => {
  it("publishes `subject-in` and `verdict-out`, clear of the cardinals they share a side with", () => {
    for (const [semantic, cardinal] of [
      ["subject-in", "left"],
      ["verdict-out", "right"],
    ] as const) {
      const port = validatorMeta.ports[semantic];
      assert.ok(port, `the entry declares no \`${semantic}\` port`);
      assert.equal(port.side, cardinal);
      assert.notEqual(port.offset ?? 0, validatorMeta.ports[cardinal]?.offset ?? 0);
      assert.ok(Math.abs(port.offset ?? 0) < footprintUnits("s") / 2);
    }
  });
});
