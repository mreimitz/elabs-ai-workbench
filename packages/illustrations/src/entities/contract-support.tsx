// ==================================================================================================
// The entity contract harness — the checklist D-IL12 makes mandatory, as executable assertions
// ==================================================================================================
// D-IL12 says every component ships with "the illustration checklist: footprint · ports · five
// states · both themes · accent budget · screen-aligned label · <title>/<desc> · a co-located
// contract test". Most of that list is the SAME question asked of every entity, so it is asked once,
// here, and each entity's own `*.test.tsx` calls it and then adds what is specific to that drawing.
//
// The co-location that matters is the CALL: `McpServer.test.tsx` sits beside `McpServer.tsx` and is
// what goes red. This file is the shared body, not a substitute for it — the alternative is three
// copies of the same 150 lines, which is how the third entity ends up quietly checking less than the
// first two.
//
// Everything is asserted against the component's REGISTRY ENTRY, never against a literal repeated in
// the test. That is the point of the spec's "a component whose ports or states disagree with its
// entry must fail a test, not render wrong": the entry is the claim, the drawing is the evidence,
// and the test is what holds them together.

import {
  ILLUSTRATION_SIZES,
  ILLUSTRATION_STATES,
  type IllustrationRegistryEntry,
} from "@mcp-token-footprint/shared";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { attributeValues, isAllowedPaint, paintValues, render } from "../test-support.js";
import type { EntityComponentProps, IllustrationEntityComponent } from "./entity-props.js";
import { ILLUSTRATION_REGISTRY } from "../registry.js";

/** Render an entity inside a minimal `<svg>`, since an entity is a `<g>` and needs a host. */
export function renderEntity(
  Component: IllustrationEntityComponent,
  props: EntityComponentProps = {},
): string {
  return render(
    <svg aria-hidden="true">
      <Component idPrefix="illus-fixture" {...props} />
    </svg>,
  );
}

/** Every `data-illus-port` name the markup carries, which is what the port overlay actually drew. */
export function renderedPorts(markup: string): string[] {
  return attributeValues(markup, "data-illus-port").sort();
}

/**
 * The whole shared checklist for one entity. `variants` defaults to the registry entry's own list,
 * with a single `undefined` standing in for "this entity has no variants" so the loops still run.
 */
export function describeEntityContract(
  Component: IllustrationEntityComponent,
  meta: IllustrationRegistryEntry,
): void {
  const variants: (string | undefined)[] =
    meta.variants.length > 0 ? [...meta.variants] : [undefined];

  describe(`${meta.id} — catalog conformance (D-IL9)`, () => {
    it("is the entry the registry actually publishes for this id", () => {
      const published = ILLUSTRATION_REGISTRY.find((entry) => entry.id === meta.id);
      assert.deepEqual(published, meta, `the registry publishes a different entry for ${meta.id}`);
    });

    it("claims every state the closed set defines, `idle` included (D-IL8)", () => {
      assert.deepEqual([...meta.states].sort(), [...ILLUSTRATION_STATES].sort());
    });

    it("claims every quantized footprint (D-IL2)", () => {
      assert.deepEqual([...meta.sizes].sort(), [...ILLUSTRATION_SIZES].sort());
    });

    it("was introduced in the version the registry is stamped at", () => {
      assert.equal(meta.since, "0.1.0");
    });
  });

  describe(`${meta.id} — the drawing matches the entry`, () => {
    it("renders at every size x every state x every variant", () => {
      for (const size of meta.sizes) {
        for (const state of meta.states) {
          for (const variant of variants) {
            const markup = renderEntity(Component, { size, state, variant });
            assert.ok(markup.length > 0, `${size}/${state}/${variant} rendered nothing`);
            assert.ok(
              markup.includes(`data-illus-state="${state}"`),
              `${size}/${state} did not record its state`,
            );
            assert.ok(markup.includes(`data-illus-size="${size}"`));
            assert.ok(markup.includes(`data-illus-entity="${meta.id}"`));
          }
        }
      }
    });

    it("draws each footprint at a different scale — the size prop is not decorative", () => {
      const widths = meta.sizes.map((size) => {
        const markup = renderEntity(Component, { size });
        // The first polygon is the platform's bottom tier, whose extent IS the footprint.
        const points = attributeValues(markup, "points")[0] as string;
        const xs = points.split(" ").map((pair) => Number(pair.split(",")[0]));
        return Math.max(...xs) - Math.min(...xs);
      });
      const sorted = [...widths].sort((left, right) => left - right);
      assert.deepEqual(widths, sorted, "footprints must grow with the size prop");
      assert.equal(new Set(widths).size, widths.length, "two sizes drew the same footprint");
    });

    it("exposes exactly the ports the entry declares, and only when asked (D-IL7)", () => {
      assert.deepEqual(
        renderedPorts(renderEntity(Component, {})),
        [],
        "ports drew without showPorts",
      );
      assert.deepEqual(
        renderedPorts(renderEntity(Component, { showPorts: true })),
        Object.keys(meta.ports).sort(),
      );
    });

    it("draws every declared variant differently (D-IL8)", () => {
      if (meta.variants.length < 2) return;
      const drawings = meta.variants.map((variant) => renderEntity(Component, { variant }));
      assert.equal(
        new Set(drawings).size,
        drawings.length,
        "two variants produced identical markup, so one of them is not implemented",
      );
    });

    it("falls back to its default variant rather than throwing on an unknown one (D-IL16)", () => {
      if (meta.variants.length === 0) return;
      const unknown = renderEntity(Component, { variant: "not-a-real-variant" });
      const fallback = renderEntity(Component, { variant: meta.variants[0] });
      // Everything but the recorded variant attribute must be identical to the default drawing.
      const strip = (markup: string) => markup.replace(/ data-illus-variant="[^"]*"/g, "");
      assert.equal(strip(unknown), strip(fallback));
    });
  });

  describe(`${meta.id} — accessibility (D-IL12)`, () => {
    it("is an image labelled by the entry's title and described by its description", () => {
      const markup = renderEntity(Component, {});
      assert.ok(markup.includes('role="img"'));
      assert.ok(markup.includes(`<title id="illus-fixture-title">${meta.title}</title>`));
      assert.ok(markup.includes(`<desc id="illus-fixture-desc">${meta.description}</desc>`));
    });

    it("prefers a caller's label for the accessible name, keeping the entry's description", () => {
      const markup = renderEntity(Component, { label: "Primary" });
      assert.ok(markup.includes(">Primary</title>"));
      assert.ok(markup.includes(meta.description));
    });

    it("keeps the label screen-aligned — never skewed onto a face (D-IL2)", () => {
      const markup = renderEntity(Component, { label: "Primary" });
      const label = /<text[^>]*>Primary<\/text>/.exec(markup);
      assert.ok(label, "the label did not render as text");
      assert.ok(!label[0].includes("transform"), "the label carries a transform, so it is skewed");
    });
  });

  describe(`${meta.id} — construction (D-IL5, D-IL12)`, () => {
    it("paints only --illus-* tokens, at every state and variant", () => {
      for (const state of meta.states) {
        for (const variant of variants) {
          for (const paint of paintValues(
            renderEntity(Component, { state, variant, showPorts: true }),
          )) {
            assert.ok(
              isAllowedPaint(paint),
              `${meta.id} (${state}/${variant}) painted ${paint}, which is not an --illus-* token`,
            );
          }
        }
      }
    });

    it("authors no <path> of its own — it is composed from WP 0.2 primitives only", () => {
      // Every WP 0.2 structural primitive draws polygons, ellipses, rects, circles and lines. The
      // only primitives that emit a `<path>` are the stage furniture (`PaperStage`'s grid and
      // registration marks, `CalibrationCube`'s dimension line), and an entity draws neither. So a
      // `<path>` in an entity's markup means somebody hand-drew structure instead of composing it,
      // which is exactly what WP 0.3's scope forbids.
      for (const size of meta.sizes) {
        for (const variant of variants) {
          const markup = renderEntity(Component, {
            size,
            variant,
            state: "error",
            showPorts: true,
          });
          assert.ok(
            !markup.includes("<path"),
            `${meta.id} (${size}/${variant}) drew a <path>; entities compose primitives`,
          );
        }
      }
    });

    it("is deterministic — the same props emit the same bytes (D-IL10)", () => {
      const once = renderEntity(Component, { size: "l", state: "active", showPorts: true });
      const twice = renderEntity(Component, { size: "l", state: "active", showPorts: true });
      assert.equal(once, twice);
    });

    it("paints into the fixed layer order, never around it (D-IL16)", () => {
      const layers = attributeValues(
        renderEntity(Component, { showPorts: true, label: "Primary" }),
        "data-illus-layer",
      );
      const order = [
        "stage",
        "shadows",
        "structure",
        "detail",
        "connectors",
        "annotations",
        "labels",
      ];
      const indices = layers.map((layer) => order.indexOf(layer));
      assert.ok(
        indices.every(
          (value, position) => position === 0 || value > (indices[position - 1] as number),
        ),
        `layers were painted out of order: ${layers.join(" -> ")}`,
      );
    });
  });
}
