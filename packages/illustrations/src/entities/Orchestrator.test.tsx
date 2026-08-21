import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { attributeValues } from "../test-support.js";
import { Orchestrator, orchestratorHeightUnits, orchestratorMeta } from "./Orchestrator.js";
import { describeEntityContract, renderEntity } from "./contract-support.js";

describeEntityContract(Orchestrator, orchestratorMeta);

const accents = (markup: string) => (markup.match(/var\(--illus-accent\)/g) ?? []).length;
const marks = (markup: string, mark: string) =>
  attributeValues(markup, "data-illus-mark").filter((name) => name === mark).length;

describe("orchestrator — machinery, not a clock (WP 1.3's explicit constraint)", () => {
  it("draws eight teeth, not twelve", () => {
    // Twelve marks around a circle is a dial no matter what else is on the drawing, and the app has
    // no scheduler to justify one. Eight is a gear.
    assert.equal(marks(renderEntity(Orchestrator, {}), "gear-tooth"), 8);
  });

  it("keys the wheel to a shaft, which is what a clock face never is", () => {
    const markup = renderEntity(Orchestrator, {});
    assert.equal(marks(markup, "keyway"), 1);
    assert.equal(marks(markup, "drive-boss"), 1);
  });

  it("gives it a physical queue and physical outputs — a clock has neither", () => {
    // One stub in, three out, each a `run` lane borrowed from the shared primitive. This is the
    // assertion that actually settles "automation" versus "time": what is drawn is work moving.
    const markup = renderEntity(Orchestrator, {});
    assert.equal(marks(markup, "direction"), 4);
  });

  it("stays an entity rather than a flowchart (D-IL1)", () => {
    // The temptation here is to draw the PROCESS. A process is connectors between stations, and a
    // connector is `connectors`-layer furniture an entity may not emit; if this ever starts drawing
    // its own arrows between boxes, that layer will show up here.
    const layers = attributeValues(renderEntity(Orchestrator, { showPorts: true }), "data-illus-layer");
    assert.ok(!layers.includes("connectors"), `an entity painted into ${layers.join(", ")}`);
  });
});

describe("orchestrator — one accent moment (D-IL6)", () => {
  it("lights the drive boss and nothing else, teeth and stubs included", () => {
    assert.equal(accents(renderEntity(Orchestrator, {})), 1);
  });

  it("recolours the boss on error rather than adding a mark", () => {
    const markup = renderEntity(Orchestrator, { state: "error" });
    assert.equal(accents(markup), 0);
    assert.ok(markup.includes("var(--illus-error)"));
    assert.equal(marks(markup, "gear-tooth"), 8);
  });
});

describe("orchestrator — three ports for three different things (D-IL7)", () => {
  it("separates work waiting, work handed out, and the roll-up that leaves", () => {
    assert.equal(orchestratorMeta.ports["queue-in"]?.side, "left");
    assert.equal(orchestratorMeta.ports.dispatch?.side, "right");
    // The report leaves from the TOP because it is not more work — it is what the run produced.
    assert.equal(orchestratorMeta.ports["report-out"]?.side, "top");
    assert.notEqual(
      orchestratorMeta.ports["report-out"]?.offset ?? 0,
      orchestratorMeta.ports.top?.offset ?? 0,
    );
  });

  it("declares a height the gear actually reaches", () => {
    for (const size of orchestratorMeta.sizes) {
      assert.ok(orchestratorHeightUnits(size) > 0);
    }
  });
});
