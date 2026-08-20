import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_ILLUSTRATION_LAYER,
  ILLUSTRATION_LAYERS,
  Layer,
  collectLayers,
  renderLayers,
} from "./layers.js";
import { Connector } from "./primitives/Connector.js";
import { ConstructionGhost } from "./primitives/ConstructionGhost.js";
import { IsoPlatform } from "./primitives/IsoPlatform.js";
import { PaperStage } from "./primitives/PaperStage.js";
import { StationHeader } from "./primitives/StationHeader.js";
import { attributeValues, render } from "./test-support.js";

// D-IL16's whole claim is that z-order belongs to the LAYER. The only way to state that as a test is
// to write the children in deliberately wrong order and check the output comes back right.

describe("layers — the fixed paint order (D-IL16)", () => {
  it("paints stage first and labels last", () => {
    assert.deepEqual(
      [...ILLUSTRATION_LAYERS],
      ["stage", "shadows", "structure", "detail", "connectors", "annotations", "labels"],
    );
  });

  it("reorders children into layer order, whatever order they were written in", () => {
    const markup = render(
      <g>
        {renderLayers([
          <StationHeader key="header" at={{ x: 0, y: 0 }} title="last" />,
          <Connector key="line" kind="flow" from={{ x: 0, y: 0 }} to={{ x: 10, y: 0 }} />,
          <ConstructionGhost key="ghost" width={4} depth={4} />,
          <IsoPlatform key="platform" tiers={1} />,
          <PaperStage key="stage" width={40} height={40} />,
        ])}
      </g>,
    );
    assert.deepEqual(attributeValues(markup, "data-illus-layer"), [
      "stage",
      "structure",
      "detail",
      "connectors",
      "labels",
    ]);
  });

  it("drops the layers nothing was written into", () => {
    const markup = render(<g>{renderLayers([<IsoPlatform key="p" tiers={1} />])}</g>);
    assert.deepEqual(attributeValues(markup, "data-illus-layer"), ["structure"]);
  });

  it("keeps authoring order WITHIN a layer — back-to-front still means something", () => {
    const buckets = collectLayers([
      <IsoPlatform key="first" tiers={1} footprint="l" />,
      <IsoPlatform key="second" tiers={2} footprint="s" />,
    ]);
    assert.equal(buckets.structure.length, 2);
    const markup = render(
      <g>
        {renderLayers([
          <IsoPlatform key="first" tiers={1} />,
          <IsoPlatform key="second" tiers={3} />,
        ])}
      </g>,
    );
    const tiers = attributeValues(markup, "data-illus-tiers");
    assert.deepEqual(tiers, ["1", "3"]);
  });

  it("reads each primitive's own declared layer, so a call site cannot forget", () => {
    assert.equal(PaperStage.illusLayer, "stage");
    assert.equal(IsoPlatform.illusLayer, "structure");
    assert.equal(ConstructionGhost.illusLayer, "detail");
    assert.equal(Connector.illusLayer, "connectors");
    assert.equal(StationHeader.illusLayer, "labels");
  });

  it("honours an explicit <Layer> wrapper and unwraps it into that layer's group", () => {
    const markup = render(
      <g>
        {renderLayers([
          <Layer key="note" name="annotations">
            <circle data-illus-probe="note" r={1} />
          </Layer>,
        ])}
      </g>,
    );
    assert.deepEqual(attributeValues(markup, "data-illus-layer"), ["annotations"]);
    // Unwrapped: exactly one group, not a group inside a group.
    assert.equal(markup.match(/data-illus-layer/g)?.length, 1);
    assert.ok(markup.includes('data-illus-probe="note"'));
  });

  it("puts an undeclared child in the structure layer", () => {
    const buckets = collectLayers(<circle r={1} />);
    assert.equal(DEFAULT_ILLUSTRATION_LAYER, "structure");
    assert.equal(buckets.structure.length, 1);
    for (const layer of ILLUSTRATION_LAYERS) {
      if (layer !== "structure") assert.equal(buckets[layer].length, 0);
    }
  });

  it("ignores the nulls a conditional child leaves behind", () => {
    const show = false;
    const buckets = collectLayers([null, undefined, show ? <circle key="c" r={1} /> : null, ""]);
    for (const layer of ILLUSTRATION_LAYERS) assert.equal(buckets[layer].length, 0);
  });
});
