import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { attributeValues } from "../test-support.js";
import { Agent, agentHeightUnits, agentMeta } from "./Agent.js";
import { describeEntityContract, renderEntity } from "./contract-support.js";

describeEntityContract(Agent, agentMeta);

describe("agent — the D-IL17 proof case: gaze meets the flow", () => {
  it("mounts the face panel on the LEFT face by default, so it looks upstream", () => {
    const faces = attributeValues(renderEntity(Agent, {}), "data-illus-glyph-face");
    assert.deepEqual(new Set(faces), new Set(["left"]), "the default gaze is not the +y face");
  });

  it("moves BOTH gaze-mounted panels to the right face when it faces downstream", () => {
    const faces = attributeValues(
      renderEntity(Agent, { facing: "downstream" }),
      "data-illus-glyph-face",
    );
    assert.deepEqual(new Set(faces), new Set(["right"]));
  });

  it("really redraws — the two facings are different markup, not just a different attribute", () => {
    const strip = (markup: string) => markup.replace(/ data-illus-facing="[^"]*"/g, "");
    assert.notEqual(
      strip(renderEntity(Agent, { facing: "upstream" })),
      strip(renderEntity(Agent, { facing: "downstream" })),
    );
  });
});

describe("agent — the exemplar's proportions, at the `m` footprint", () => {
  // planning/Roadmap/RM-14-illustrations/examples/Agent.example.tsx draws its robot with a torso at
  // z 1.2 of height 1.8, a neck at 3.0 of height 0.18, a head at 3.18 of height 1.4, and an antenna
  // from 4.58 to 5.35. This entity expresses those as fractions of the footprint so it exists at S
  // and L too — which is only faithful if `m` still evaluates to the exemplar's own numbers.
  it("puts the antenna tip at the exemplar's 5.35 units", () => {
    assert.equal(agentHeightUnits("m"), 5.35);
  });

  it("anchors the `top` port on the antenna tip, as the exemplar does", () => {
    const markup = renderEntity(Agent, { size: "m", showPorts: true });
    // project(0, 0, 5.35) is (0, -85.6): straight up from the origin, 5.35 units at 16 px each.
    assert.ok(markup.includes('<circle cx="0" cy="-85.6" r="4"'), "the top port is not on the tip");
  });
});

describe("agent — one accent moment, and error recolours it (D-IL6)", () => {
  const accents = (markup: string) => (markup.match(/var\(--illus-accent\)/g) ?? []).length;

  it("lights only the antenna LED while idle", () => {
    assert.equal(accents(renderEntity(Agent, {})), 1);
  });

  it("adds one signal ring while active, and nothing else", () => {
    const markup = renderEntity(Agent, { state: "active" });
    assert.ok(markup.includes('data-illus-mark="antenna-active"'));
    // Three, not two: `EntityRoot` paints the `active` glow under EVERY entity in the same accent
    // (D-IL8 — the state set looks the same on an agent as on a server), and this entity adds the
    // LED and its ring. What the budget forbids is a FOURTH mark of the agent's own.
    assert.equal(accents(markup), 3, "active is EntityRoot's glow plus the LED and its ring");
  });

  it("turns the LED and its ring to the error token, never a second accent", () => {
    const markup = renderEntity(Agent, { state: "error" });
    assert.ok(markup.includes('data-illus-mark="antenna-error"'));
    assert.equal(accents(markup), 0);
    assert.ok(markup.includes("var(--illus-error)"));
  });
});

describe("agent — no variants, deliberately (recorded deviation from the exemplar)", () => {
  it("publishes an empty variant list, because `facing` is not a variant", () => {
    assert.deepEqual(agentMeta.variants, []);
  });
});
