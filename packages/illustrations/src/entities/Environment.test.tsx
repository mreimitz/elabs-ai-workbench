import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { footprintUnits } from "../iso-math.js";
import { attributeValues } from "../test-support.js";
import { Agent, agentHeightUnits } from "./Agent.js";
import {
  Environment,
  environmentFloorUnits,
  environmentHeightUnits,
  environmentMeta,
} from "./Environment.js";
import { describeEntityContract, renderEntity } from "./contract-support.js";

describeEntityContract(Environment, environmentMeta);

const accents = (markup: string) => (markup.match(/var\(--illus-accent\)/g) ?? []).length;
const marks = (markup: string, mark: string) =>
  attributeValues(markup, "data-illus-mark").filter((name) => name === mark).length;

/** The top of each solid, in screen px (smaller y is higher), in document order. */
function housingTops(markup: string): number[] {
  return markup
    .split('data-illus-primitive="iso-housing"')
    .slice(1)
    .map((chunk) => {
      const points = /points="([^"]+)"/.exec(chunk)?.[1] ?? "";
      const ys = points.split(" ").map((pair) => Number(pair.split(",")[1]));
      return Math.min(...ys);
    });
}

describe("environment — it is a CONTAINER, and has to read as one", () => {
  it("keeps the near rim far lower than the far walls, so an occupant is not hidden", () => {
    // The obvious four-walled tray occludes whatever it holds: the near walls paint over it. The rim
    // is therefore asymmetric — tall at the back, a kerb at the front — which is what makes an
    // `agent` standing on the plate read as being INSIDE rather than behind.
    for (const size of environmentMeta.sizes) {
      const tops = housingTops(renderEntity(Environment, { size }));
      // plate, far wall, far wall, near kerb, near kerb.
      assert.equal(tops.length, 5);
      const [, farA, farB, kerbA, kerbB] = tops as [number, number, number, number, number];
      const wall = Math.min(farA, farB);
      const kerb = Math.min(kerbA, kerbB);
      const plateTop = -environmentFloorUnits(size) * 16;
      assert.ok(wall < kerb, "the near kerbs are not lower than the far walls");
      // The kerb rises less than a third of the wall's height above the plate surface.
      assert.ok(
        (plateTop - kerb) / (plateTop - wall) < 0.34,
        `the near kerb reaches ${(plateTop - kerb) / (plateTop - wall)} of the far wall`,
      );
    }
  });

  it("puts its floor low enough that an occupant is not stood on a monument", () => {
    // A hosted entity sits on the plate surface. If the plate were as tall as a plinth, an occupant
    // would read as standing on a second pedestal inside the first.
    for (const size of environmentMeta.sizes) {
      assert.ok(environmentFloorUnits(size) < agentHeightUnits(size) / 5);
      assert.ok(environmentFloorUnits(size) < environmentHeightUnits(size) / 4);
    }
  });

  it("is not so tall that it swallows what stands in it", () => {
    // The container must stay visibly SHORTER than the cast's tallest occupant, or the walls become
    // a box rather than a stage.
    for (const size of environmentMeta.sizes) {
      assert.ok(
        environmentHeightUnits(size) < agentHeightUnits(size),
        `at ${size} the enclosure (${environmentHeightUnits(size)}) is taller than an agent`,
      );
    }
    // And the drawing genuinely renders with something standing in it — the acceptance screenshot's
    // arrangement, asserted rather than only looked at.
    const staged = renderEntity(Environment, { size: "m" }) + renderEntity(Agent, { size: "m" });
    assert.ok(staged.includes('data-illus-entity="environment"'));
    assert.ok(staged.includes('data-illus-entity="agent"'));
  });
});

describe("environment — the binding is `scenarios`, and that is not stale (RM-27)", () => {
  it("names the table the wire still uses, not the label the UI now shows", () => {
    // RM-27 renamed Scenario -> Environment in UI LABELS ONLY and froze the wire: `scenarioId`, the
    // `Scenario` type and `/api/scenarios` all survive. `environments` would bind to nothing.
    assert.equal(environmentMeta.entity, "scenarios");
    assert.equal(environmentMeta.title, "Environment");
  });
});

describe("environment — one accent moment, and it marks the spot (D-IL6)", () => {
  it("lights the centre pip and leaves the setting-out brackets muted", () => {
    const markup = renderEntity(Environment, {});
    assert.equal(accents(markup), 1);
    assert.equal(marks(markup, "stage-pip"), 1);
    assert.equal(marks(markup, "setting-out"), 4);
  });

  it("recolours the pip on error rather than adding a mark", () => {
    const markup = renderEntity(Environment, { state: "error" });
    assert.equal(accents(markup), 0);
    assert.equal(marks(markup, "stage-pip"), 1);
    assert.ok(markup.includes("var(--illus-error)"));
  });
});

describe("environment — `host` is on top, because that is where an occupant goes (D-IL7)", () => {
  it("declares it clear of the plain `top` cardinal", () => {
    const host = environmentMeta.ports.host;
    assert.ok(host);
    assert.equal(host.side, "top");
    assert.notEqual(host.offset ?? 0, environmentMeta.ports.top?.offset ?? 0);
    assert.ok(Math.abs(host.offset ?? 0) < footprintUnits("s") / 2);
  });
});
