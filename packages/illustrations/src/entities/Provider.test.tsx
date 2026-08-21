import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { footprintUnits } from "../iso-math.js";
import { attributeValues } from "../test-support.js";
import { Provider, providerHeightUnits, providerMeta } from "./Provider.js";
import { describeEntityContract, renderEntity } from "./contract-support.js";

describeEntityContract(Provider, providerMeta);

describe("provider — the cartouche stays empty (WP 1.1)", () => {
  it("declares no variants, because the only per-vendor difference is a mark it refuses to draw", () => {
    assert.deepEqual(providerMeta.variants, []);
  });

  it("draws the slot and its registration ticks, and nothing that could be a wordmark", () => {
    const markup = renderEntity(Provider, {});
    // A drawn mark would have to be text or a path; the entity contract already forbids the path,
    // and a vendor name would have to arrive as <text> — which only `EntityRoot`'s screen-aligned
    // label may emit, and only when a caller supplies one.
    assert.ok(!markup.includes("<text"), "the provider drew text of its own");
    assert.ok(!markup.includes("<path"), "the provider drew a path of its own");
  });

  it("takes a vendor name from the caller's label, where it can be read and translated", () => {
    const markup = renderEntity(Provider, { label: "Anthropic" });
    assert.ok(markup.includes(">Anthropic</text>"));
    // …and screen-aligned, never skewed onto the cartouche.
    const label = /<text[^>]*>Anthropic<\/text>/.exec(markup);
    assert.ok(label && !label[0].includes("transform"));
  });
});

describe("provider — a board has no gaze, so it ignores `facing` (D-IL17)", () => {
  it("keeps the cartouche on the left face whichever way the flow runs", () => {
    const faces = (facing: "upstream" | "downstream") =>
      attributeValues(renderEntity(Provider, { facing }), "data-illus-glyph-face");
    assert.deepEqual(faces("upstream"), ["left"]);
    assert.deepEqual(faces("downstream"), ["left"]);
  });
});

describe("provider — one accent moment, and error recolours it (D-IL6)", () => {
  const accents = (markup: string) => (markup.match(/var\(--illus-accent\)/g) ?? []).length;

  it("lights only the rule under the slot", () => {
    assert.equal(accents(renderEntity(Provider, {})), 1);
  });

  it("turns that rule to the error token rather than adding a second mark", () => {
    const markup = renderEntity(Provider, { state: "error" });
    assert.equal(accents(markup), 0);
    assert.ok(markup.includes("var(--illus-error)"));
  });
});

describe("provider — the height and the one semantic port (D-IL7)", () => {
  it("declares plinth plus board, at every footprint", () => {
    for (const size of providerMeta.sizes) {
      assert.equal(providerHeightUnits(size), 1.2 + footprintUnits(size) * 0.44);
    }
  });

  it("publishes `serves` on the right edge, clear of the plain `right` cardinal", () => {
    const port = providerMeta.ports.serves;
    assert.ok(port, "the entry declares no `serves` port");
    assert.equal(port.side, "right");
    assert.notEqual(port.offset ?? 0, providerMeta.ports.right?.offset ?? 0);
    assert.ok(Math.abs(port.offset ?? 0) < footprintUnits("s") / 2);
  });
});
