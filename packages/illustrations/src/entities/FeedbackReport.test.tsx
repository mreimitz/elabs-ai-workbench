import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { footprintUnits } from "../iso-math.js";
import { attributeValues } from "../test-support.js";
import {
  FeedbackReport,
  feedbackReportHeightUnits,
  feedbackReportMeta,
} from "./FeedbackReport.js";
import { validatorMeta } from "./Validator.js";
import { describeEntityContract, renderEntity } from "./contract-support.js";

describeEntityContract(FeedbackReport, feedbackReportMeta);

describe("feedback-report — the tray is OPEN, and the sheets are inside it (WP 1.2)", () => {
  // The only thing that puts the pile inside the tray rather than on top of it is DOCUMENT ORDER:
  // walls and sheets are all `structure`, so the layer system cannot separate them, and
  // `collectLayers` is stable within a layer precisely so back-to-front authoring survives. If that
  // ever stops being true this assertion is what says so.
  it("paints the far rim, then the pile, then the near rim", () => {
    const markup = renderEntity(FeedbackReport, {});
    const back = markup.indexOf('data-illus-mark="tray-wall-back"');
    const sheets = markup.indexOf('data-illus-primitive="iso-sheet-stack"');
    const front = markup.indexOf('data-illus-mark="tray-wall-front"');
    assert.ok(back >= 0 && sheets >= 0 && front >= 0, "the tray did not draw all three parts");
    assert.ok(back < sheets, "the far rim was painted after the pile, so the tray has no back");
    assert.ok(sheets < front, "the near rim was painted before the pile, so the pile sits on top");
  });

  it("builds the rim from four walls rather than a lid — a lid would hide what settled in it", () => {
    const housings = attributeValues(renderEntity(FeedbackReport, {}), "data-illus-primitive").filter(
      (name) => name === "iso-housing",
    ).length;
    // Two plinth tiers, the tray floor, four rim walls, three sheets.
    assert.equal(housings, 2 + 1 + 4 + 3);
  });

  it("declares a height of plinth plus tray floor plus rim, at every footprint", () => {
    for (const size of feedbackReportMeta.sizes) {
      // Nine decimals rather than strict equality: the height is a sum of products, and the
      // drawing is the same drawing whether the last bit rounds up or down.
      assert.equal(
        feedbackReportHeightUnits(size).toFixed(9),
        (1.2 + footprintUnits(size) * (0.045 + 0.1)).toFixed(9),
      );
    }
  });
});

describe("feedback-report — the entity binding, and why it is not the other two (WP 1.2)", () => {
  it("binds to `run_feedback`, the one candidate table that ACCUMULATES", () => {
    assert.equal(feedbackReportMeta.entity, "run_feedback");
  });

  it("does not take `run_grades`, which WP 1.1's `validator` already depicts", () => {
    assert.equal(validatorMeta.entity, "run_grades");
    assert.notEqual(feedbackReportMeta.entity, validatorMeta.entity);
  });
});

describe("feedback-report — work lands, a judgement leaves (D-IL7)", () => {
  it("declares `in` and `out` as a symmetric pair, both clear of their cardinals", () => {
    for (const [semantic, cardinal] of [
      ["in", "left"],
      ["out", "right"],
    ] as const) {
      const port = feedbackReportMeta.ports[semantic];
      assert.ok(port, `the entry declares no \`${semantic}\` port`);
      assert.equal(port.side, cardinal);
      assert.notEqual(port.offset ?? 0, feedbackReportMeta.ports[cardinal]?.offset ?? 0);
      // Inside the smallest footprint, whose half-extent is 2 units.
      assert.ok(Math.abs(port.offset ?? 0) < footprintUnits("s") / 2);
    }
    assert.equal(
      Math.abs(feedbackReportMeta.ports.in?.offset ?? 0),
      Math.abs(feedbackReportMeta.ports.out?.offset ?? 0),
    );
  });
});

describe("feedback-report — a tray has no gaze, so it ignores `facing` (D-IL17)", () => {
  it("keeps the headline on the top face whichever way the flow runs", () => {
    const faces = (facing: "upstream" | "downstream") =>
      attributeValues(renderEntity(FeedbackReport, { facing }), "data-illus-glyph-face");
    assert.deepEqual(faces("upstream"), ["top"]);
    assert.deepEqual(faces("downstream"), ["top"]);
  });
});

describe("feedback-report — one accent moment, and error recolours it (D-IL6)", () => {
  const accents = (markup: string) => (markup.match(/var\(--illus-accent\)/g) ?? []).length;

  it("lights only the headline on the topmost sheet while idle", () => {
    const markup = renderEntity(FeedbackReport, {});
    assert.equal(accents(markup), 1);
    assert.ok(markup.includes('data-illus-mark="headline"'));
  });

  it("turns the headline to the error token rather than adding a second mark", () => {
    const markup = renderEntity(FeedbackReport, { state: "error" });
    assert.equal(accents(markup), 0);
    assert.ok(markup.includes("var(--illus-error)"));
  });
});
