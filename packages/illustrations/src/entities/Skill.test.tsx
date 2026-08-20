import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { attributeValues } from "../test-support.js";
import { SKILL_VARIANTS, Skill, skillHeightUnits, skillMeta } from "./Skill.js";
import { describeEntityContract, renderEntity } from "./contract-support.js";
import { footprintUnits } from "../iso-math.js";

describeEntityContract(Skill, skillMeta);

describe("skill — the variant list and the drawing are one declaration", () => {
  it("draws exactly the variants the registry entry publishes", () => {
    assert.deepEqual([...SKILL_VARIANTS], [...skillMeta.variants]);
  });

  it("laminates the slab into three sheets on the versioned variant, one on plain", () => {
    const sheets = (variant: string) =>
      attributeValues(renderEntity(Skill, { variant }), "data-illus-primitive").filter(
        (name) => name === "iso-housing",
      ).length;
    // Both variants also draw the two platform tiers, which are housings themselves.
    assert.equal(sheets("versioned") - sheets("plain"), 2);
  });
});

describe("skill — lamination must not move the ports", () => {
  it("keeps both variants exactly as tall, so `version-out` cannot jump between them", () => {
    const anchors = (variant: string) =>
      attributeValues(renderEntity(Skill, { variant, showPorts: true }), "data-illus-port");
    assert.deepEqual(anchors("plain"), anchors("versioned"));
    // Same claim at the geometry level: the port dots land on identical coordinates.
    const dots = (variant: string) =>
      [
        ...renderEntity(Skill, { variant, showPorts: true }).matchAll(
          /<circle cx="([^"]+)" cy="([^"]+)" r="4"/g,
        ),
      ].map((match) => `${match[1]},${match[2]}`);
    assert.deepEqual(dots("plain"), dots("versioned"));
  });

  it("declares a height of plinth plus slab, at every footprint", () => {
    for (const size of skillMeta.sizes) {
      assert.equal(skillHeightUnits(size), 1.2 + footprintUnits(size) * 0.17);
    }
  });
});

describe("skill — the semantic port system design 2.2 names (D-IL7)", () => {
  it("publishes `version-out` on the right edge, clear of the plain `right` cardinal", () => {
    const port = skillMeta.ports["version-out"];
    assert.ok(port, "the entry declares no `version-out` port");
    assert.equal(port.side, "right");
    assert.notEqual(port.offset ?? 0, skillMeta.ports.right?.offset ?? 0);
  });
});

describe("skill — a document has no gaze, so it ignores `facing` (D-IL17)", () => {
  it("prints its manifest on the top face whichever way the flow runs", () => {
    const faces = (facing: "upstream" | "downstream") =>
      attributeValues(renderEntity(Skill, { facing }), "data-illus-glyph-face");
    assert.deepEqual(faces("upstream"), ["top"]);
    assert.deepEqual(faces("downstream"), ["top"]);
  });
});
