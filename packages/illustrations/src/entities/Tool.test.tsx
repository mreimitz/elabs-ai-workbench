import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { footprintUnits } from "../iso-math.js";
import { attributeValues } from "../test-support.js";
import { mcpServerMeta } from "./McpServer.js";
import { Tool, toolHeightUnits, toolMeta } from "./Tool.js";
import { describeEntityContract, renderEntity } from "./contract-support.js";

describeEntityContract(Tool, toolMeta);

describe("tool — the joint with `mcp-server` is one declaration, seen from two sides (WP 1.2)", () => {
  it("puts `plug` on the same side, at the same offset, as the server's `bus`", () => {
    // The whole point of asserting it HERE rather than writing -1.8 into a comment twice: if either
    // entity moves its half of the joint, this goes red instead of a Phase 2 connector going crooked.
    const plug = toolMeta.ports.plug;
    const bus = mcpServerMeta.ports.bus;
    assert.ok(plug, "the tool entry declares no `plug` port");
    assert.ok(bus, "the server entry declares no `bus` port");
    assert.equal(plug.side, bus.side);
    assert.equal(plug.offset, bus.offset);
  });

  it("keeps the joint clear of the plain `bottom` cardinal it shares a side with", () => {
    assert.notEqual(toolMeta.ports.plug?.offset ?? 0, toolMeta.ports.bottom?.offset ?? 0);
    // Inside the smallest footprint, whose half-extent is 2 units.
    assert.ok(Math.abs(toolMeta.ports.plug?.offset ?? 0) < footprintUnits("s") / 2);
  });

  it("names the call and the answer as a pair, on opposite sides", () => {
    assert.equal(toolMeta.ports["invoke-in"]?.side, "left");
    assert.equal(toolMeta.ports["result-out"]?.side, "right");
    assert.equal(toolMeta.ports["invoke-in"]?.offset, -1.4);
    assert.equal(toolMeta.ports["result-out"]?.offset, 1.4);
  });
});

describe("tool — a part, not a machine (WP 1.2)", () => {
  it("stands on ONE plinth tier, unlike the server it plugs into", () => {
    for (const size of toolMeta.sizes) {
      assert.equal(toolHeightUnits(size), 0.7 + footprintUnits(size) * 0.2);
    }
  });

  it("draws exactly three solids — the pad, the module, and nothing else", () => {
    const housings = attributeValues(renderEntity(Tool, {}), "data-illus-primitive").filter(
      (name) => name === "iso-housing",
    ).length;
    // One platform tier plus the module. A rack, a mast or a status column would push this up, and
    // pushing it up is exactly how a part turns back into a machine.
    assert.equal(housings, 2);
  });

  it("declares no variants — a tool is a tool (D-IL8)", () => {
    assert.deepEqual(toolMeta.variants, []);
  });

  it("binds to the table an operator would recognise as this thing", () => {
    assert.equal(toolMeta.entity, "mcp_tool_scans");
  });
});

describe("tool — a connector edge is not a gaze, so it ignores `facing` (D-IL17)", () => {
  it("keeps its card edge on the left face whichever way the flow runs", () => {
    const faces = (facing: "upstream" | "downstream") =>
      attributeValues(renderEntity(Tool, { facing }), "data-illus-glyph-face");
    assert.deepEqual(faces("upstream"), ["left"]);
    assert.deepEqual(faces("downstream"), ["left"]);
  });
});

describe("tool — one accent moment, and error recolours it (D-IL6)", () => {
  const accents = (markup: string) => (markup.match(/var\(--illus-accent\)/g) ?? []).length;

  it("lights only the connector key while idle", () => {
    const markup = renderEntity(Tool, {});
    assert.equal(accents(markup), 1);
    assert.ok(markup.includes('data-illus-mark="connector-key"'));
  });

  it("turns the key to the error token rather than adding a second mark", () => {
    const markup = renderEntity(Tool, { state: "error" });
    assert.equal(accents(markup), 0);
    assert.ok(markup.includes("var(--illus-error)"));
  });
});
