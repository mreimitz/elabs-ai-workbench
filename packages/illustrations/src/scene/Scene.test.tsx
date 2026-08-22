import type {
  IllustrationConnectorKind,
  IllustrationRegistryEntry,
  IllustrationSceneSpec,
} from "@mcp-token-footprint/shared";
import { ILLUSTRATION_CONNECTOR_KINDS } from "@mcp-token-footprint/shared";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { fmt } from "../iso-math.js";
import { ILLUSTRATION_LAYERS } from "../layers.js";
import { CONNECTOR_STYLE } from "../primitives/Connector.js";
import { ILLUSTRATION_REGISTRY } from "../registry.js";
import {
  attributeValues,
  isAllowedPaint,
  paintValues,
  render,
  tokensUsed,
} from "../test-support.js";
import {
  ILLUS_ACCENT_BAND,
  IllustrationScene,
  LABEL_BASELINE_SHIFT,
  type SceneRenderReport,
  sceneAccentBudget,
  sceneElementId,
  sceneRenderReport,
  warnAboutScene,
} from "./Scene.js";
import { annotationLineBudget, wrapAnnotationBody } from "./annotations.js";
import { ILLUSTRATION_SCENE_CATALOG, sceneCatalogOf } from "./catalog.js";
import { readSceneFixture } from "./fixtures.js";
import { layoutScene } from "./layout.js";
import { routeScene } from "./route.js";

// ==================================================================================================
// WP 2.3 — the renderer. What is asserted here, and what is NOT.
// ==================================================================================================
// Every question below is asked of the EMITTED MARKUP, not of the JSX that produced it. That is the
// only reading that survives a refactor: `renderLayers` reorders children, so inspecting the source
// would prove the author's intent rather than the drawing's paint order.
//
// What none of it can tell you: whether the picture READS. Nothing in Phase 2 has been opened in a
// browser, in either theme, at any zoom, and this file does not change that. "The markup is
// asserted" and "the picture reads" are different claims, and only the first is made here.

const SCENE_DIR = fileURLToPath(new URL(".", import.meta.url));
const FIXTURE_NAMES = ["self-learning-loop", "run-turn-cycle", "crowded-labels"] as const;

function specOf(name: string): IllustrationSceneSpec {
  return readSceneFixture(name) as IllustrationSceneSpec;
}

/**
 * Render with the dev warning silenced. Every fixture this package ships trips the accent budget
 * (see the finding on `ILLUS_ACCENT_BAND`), so leaving it on would bury a real failure under a
 * hundred lines of expected noise. The warning itself is asserted, deliberately, further down.
 */
function quietly<T>(body: () => T): T {
  const original = console.warn;
  console.warn = () => {};
  try {
    return body();
  } finally {
    console.warn = original;
  }
}

function renderScene(spec: IllustrationSceneSpec, props: Record<string, unknown> = {}): string {
  return quietly(() => render(<IllustrationScene spec={spec} {...props} />));
}

function reportOf(spec: IllustrationSceneSpec): SceneRenderReport {
  const layout = layoutScene(spec, { catalog: ILLUSTRATION_SCENE_CATALOG });
  const routing = routeScene(layout, spec.connectors ?? [], {
    catalog: ILLUSTRATION_SCENE_CATALOG,
  });
  return sceneRenderReport(spec, layout, routing);
}

/**
 * The `data-illus-layer` groups that are DIRECT children of the root `<svg>`.
 *
 * A flat attribute sweep cannot answer the layer-order question: every entity runs `renderLayers`
 * inside its own `<g>`, so the document also carries `shadows`/`structure`/`labels` groups nested
 * one level down, interleaved with the scene's own. Depth is the whole difference, so the scan
 * tracks it.
 */
function topLevelLayers(markup: string): string[] {
  const layers: string[] = [];
  let depth = 0;
  for (const match of markup.matchAll(/<(\/?)[a-zA-Z][a-zA-Z0-9]*([^>]*?)(\/?)>/g)) {
    const [, closing, attributes, selfClosing] = match;
    if (closing === "/") {
      depth -= 1;
      continue;
    }
    const layer = /data-illus-layer="([a-z]+)"/.exec(attributes ?? "");
    if (layer?.[1] !== undefined && depth === 1) layers.push(layer[1]);
    if (selfClosing !== "/") depth += 1;
  }
  return layers;
}

/** Every `<g …>` open tag in the markup, so a group's attributes can be asked about. */
function groupTags(markup: string, attribute: string): string[] {
  return [...markup.matchAll(/<g[^>]*>/g)]
    .filter((tag) => tag[0].includes(attribute))
    .map((tag) => tag[0]);
}

// ── 1. A valid spec becomes a complete drawing ────────────────────────────────────────────────────

describe("IllustrationScene — a valid spec renders a complete SVG", () => {
  for (const name of FIXTURE_NAMES) {
    it(`${name}: stage, entities, connectors, labels and cards all appear`, () => {
      const spec = specOf(name);
      const markup = renderScene(spec);
      const layout = layoutScene(spec, { catalog: ILLUSTRATION_SCENE_CATALOG });
      const routing = routeScene(layout, spec.connectors ?? [], {
        catalog: ILLUSTRATION_SCENE_CATALOG,
      });

      assert.ok(markup.startsWith("<svg "), markup.slice(0, 60));
      assert.ok(
        markup.includes(`viewBox="${layout.canvas.viewBox}"`),
        "the canvas is the layout's",
      );
      assert.ok(markup.includes('data-illus-primitive="paper-stage"'), "no stage was drawn");

      // Every node is instantiated at the origin the LAYOUT gave it — the renderer places nothing.
      for (const node of layout.nodes) {
        const expected = `<g data-illus-node="${node.id}" transform="translate(${fmt(node.origin.x)} ${fmt(node.origin.y)})">`;
        assert.ok(markup.includes(expected), `missing or displaced node: ${expected}`);
      }
      assert.equal(attributeValues(markup, "data-illus-node").length, layout.nodes.length);

      // Every routed connector is drawn, on a path that starts at the router's own first point.
      const connectorGroups = groupTags(markup, "data-illus-connector=");
      assert.equal(connectorGroups.length, routing.routes.length);
      for (const route of routing.routes) {
        const first = route.points[0];
        assert.ok(first);
        assert.ok(
          markup.includes(`d="M ${first.x} ${first.y}`),
          `${route.identity} does not start where the router put it`,
        );
      }

      // Every routed label sits at the router's anchor, with the renderer's own baseline.
      for (const route of routing.routes) {
        if (route.label === null) continue;
        assert.ok(
          markup.includes(
            `x="${fmt(route.label.anchor.x)}" y="${fmt(route.label.anchor.y + LABEL_BASELINE_SHIFT)}"`,
          ),
          `caption "${route.label.text}" is not at its routed anchor`,
        );
        assert.ok(markup.includes(`>${route.label.text}</text>`));
      }

      // Every annotation the layout placed produced a card.
      const cards = layout.annotations.length;
      const drawn =
        (markup.match(/data-illus-primitive="callout-card"/g) ?? []).length +
        (markup.match(/data-illus-primitive="principle-card"/g) ?? []).length;
      assert.equal(drawn, cards, "an annotation the layout placed was not drawn");
    });
  }

  it("draws a callout's leader at the point the LAYOUT resolved its target to", () => {
    const spec = specOf("self-learning-loop");
    const layout = layoutScene(spec, { catalog: ILLUSTRATION_SCENE_CATALOG });
    const target = (spec.annotations ?? [])[1]?.target;
    assert.equal(target, "hub-skill.top");
    const anchor = layout.endpoints[target as string];
    assert.ok(anchor, "the fixture's callout target must resolve");
    const markup = renderScene(spec);
    assert.ok(
      markup.includes(`<circle cx="${fmt(anchor.x)}" cy="${fmt(anchor.y)}"`),
      "the leader's anchor dot is not on the resolved port",
    );
  });

  it("renders a node's `title` as a station heading and its `caption` as the entity label", () => {
    const spec = specOf("self-learning-loop");
    const markup = renderScene(spec);
    assert.ok(markup.includes(">Owner</text>"), "the node title is missing");
    assert.ok(markup.includes(">states the intent</text>"), "the node caption is missing");
    assert.ok(markup.includes(">One cycle</text>"), "the band title is missing");
  });
});

// ── 2. Layer order (D-IL16) ───────────────────────────────────────────────────────────────────────

describe("paint order is ILLUSTRATION_LAYERS, read off the emitted markup", () => {
  for (const name of FIXTURE_NAMES) {
    it(`${name}: the scene's own groups appear in the fixed order`, () => {
      const layers = topLevelLayers(renderScene(specOf(name)));
      assert.ok(layers.length >= 4, `only ${layers.length} scene layers — the scan found nothing`);

      // A subsequence of the canonical order: empty layers are dropped, none may be out of place.
      let cursor = -1;
      for (const layer of layers) {
        const index = (ILLUSTRATION_LAYERS as readonly string[]).indexOf(layer);
        assert.ok(index >= 0, `unknown layer "${layer}"`);
        assert.ok(index > cursor, `${layer} was painted out of order: ${layers.join(" → ")}`);
        cursor = index;
      }
      assert.deepEqual(layers, [...new Set(layers)], "a layer group was emitted twice");
    });
  }

  it("puts connectors above entities and captions above both — the order authoring cannot change", () => {
    const layers = topLevelLayers(renderScene(specOf("self-learning-loop")));
    assert.deepEqual(layers, ["stage", "structure", "connectors", "annotations", "labels"]);
  });

  it("is not fooled by the layer groups an entity emits INSIDE itself", () => {
    // The non-vacuity guard for `topLevelLayers`: a flat sweep sees far more, in an order that is
    // deliberately NOT the canonical one, so a scan that lost its depth tracking would go red here.
    const markup = renderScene(specOf("self-learning-loop"));
    const flat = attributeValues(markup, "data-illus-layer");
    assert.ok(flat.length > topLevelLayers(markup).length + 3, "entities emit their own layers");
    assert.ok(flat.indexOf("shadows") > flat.indexOf("structure"), "nested groups interleave");
  });
});

// ── 3. Determinism ────────────────────────────────────────────────────────────────────────────────

describe("determinism — the same spec and catalog give byte-identical markup", () => {
  for (const name of FIXTURE_NAMES) {
    it(`${name}: renders identically twice`, () => {
      assert.equal(renderScene(specOf(name)), renderScene(specOf(name)));
    });

    it(`${name}: renders identically after a JSON round trip of the spec`, () => {
      const spec = specOf(name);
      const clone = JSON.parse(JSON.stringify(spec)) as IllustrationSceneSpec;
      assert.equal(renderScene(clone), renderScene(spec));
    });

    it(`${name}: renders identically against a registry rebuilt in reverse order`, () => {
      const reversed = [...ILLUSTRATION_REGISTRY].reverse();
      assert.equal(
        renderScene(specOf(name), {
          registry: reversed,
          catalog: sceneCatalogOf(reversed),
        }),
        renderScene(specOf(name)),
      );
    });
  }

  // This is the one the id derivation buys, and the only one a positional id would fail: `useId` is
  // stable per POSITION, so two renders of the same lone scene agree even with it. Rendering the
  // scene SECOND, behind another one, is what tells a derived id from a generated one.
  it("emits the same bytes for one scene rendered alone and rendered second on a page", () => {
    const spec = specOf("self-learning-loop");
    const alone = renderScene(spec);
    const beside = quietly(() =>
      render(
        <g>
          <IllustrationScene spec={specOf("run-turn-cycle")} />
          <IllustrationScene spec={spec} />
        </g>,
      ),
    );
    assert.ok(
      beside.includes(alone),
      "the scene's bytes changed when it moved position — an id is positional, not derived",
    );
  });

  it("derives every id from the scene id and the thing it names", () => {
    const markup = renderScene(specOf("self-learning-loop"));
    assert.equal(
      sceneElementId("self-learning-agentic-loop", "scene"),
      "illus-self-learning-agentic-loop-scene",
    );
    assert.ok(markup.includes('id="illus-self-learning-agentic-loop-scene-title"'));
    assert.ok(markup.includes('id="illus-self-learning-agentic-loop-scene-desc"'));
    // The entity's own title/desc ids come from the prefix the scene handed it.
    assert.ok(markup.includes('id="illus-self-learning-agentic-loop-node-agent-title"'));
    // The stage's grid pattern too — nothing is left on React's generated ids.
    // Including the stage's grid pattern, whose id EMBEDS the prefix rather than starting with it
    // (`illus-paper-grid-<prefix>-c16-m4`) — nothing is left on React's generated ids.
    const ids = attributeValues(markup, "id");
    assert.ok(ids.length > 10, `only ${ids.length} ids — the sweep found nothing`);
    for (const id of ids) {
      assert.ok(
        id.includes("illus-self-learning-agentic-loop-"),
        `${id} was not derived from the scene id`,
      );
    }
  });

  it("the renderer's own sources carry no clock, no randomness and no DOM measurement", () => {
    for (const [name, source] of rendererSources()) {
      for (const pattern of [
        /\bMath\s*\.\s*random\b/,
        /\bnew\s+Date\b/,
        /\bDate\s*\.\s*now\b/,
        /\buseId\b/,
        /getBBox/,
        /getBoundingClientRect/,
        /getComputedStyle/,
      ]) {
        assert.doesNotMatch(source, pattern, `${name} reaches for ${pattern}`);
      }
    }
  });
});

function rendererSources(): (readonly [string, string])[] {
  const strip = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, "\n").replace(/^[ \t]*\/\/.*$/gm, "");
  const names = readdirSync(SCENE_DIR, { withFileTypes: true })
    .filter(
      (entry) => entry.isFile() && entry.name.endsWith(".tsx") && !entry.name.includes(".test."),
    )
    .map((entry) => entry.name);
  assert.deepEqual(names.sort(), ["Scene.tsx", "annotations.tsx"], "the scan lost a renderer file");
  const sources = names.map(
    (name) => [name, strip(readFileSync(join(SCENE_DIR, name), "utf8"))] as const,
  );
  const scene = sources.find(([name]) => name === "Scene.tsx")?.[1] ?? "";
  // The stripper must actually strip, or every assertion above passes for the wrong reason.
  assert.doesNotMatch(scene, /THE PAINT ORDER IS THE LAYER'S/, "the comment stripper did nothing");
  assert.match(scene, /export function IllustrationScene/, "the stripper ate the code");
  return sources;
}

// ── 4. Accessibility ──────────────────────────────────────────────────────────────────────────────

describe("accessibility — role, title and desc come from the spec and are wired to it", () => {
  for (const name of FIXTURE_NAMES) {
    it(`${name}: role="img" with an associated <title> and <desc>`, () => {
      const spec = specOf(name);
      const markup = renderScene(spec);
      const root = markup.slice(0, markup.indexOf(">") + 1);
      assert.ok(root.includes('role="img"'));

      const labelledBy = /aria-labelledby="([^"]+)"/.exec(root)?.[1];
      const describedBy = /aria-describedby="([^"]+)"/.exec(root)?.[1];
      assert.ok(labelledBy && describedBy, root);
      assert.notEqual(labelledBy, describedBy);
      assert.ok(markup.includes(`<title id="${labelledBy}">`), "aria-labelledby names no <title>");
      assert.ok(markup.includes(`<desc id="${describedBy}">`), "aria-describedby names no <desc>");

      // And they carry the spec's own words — the schema requires both, so there is no fallback.
      const title = /<title id="[^"]+">([^<]*)<\/title>/.exec(markup)?.[1];
      assert.equal(title, spec.title);
      const desc = /<desc id="[^"]+">([\s\S]*?)<\/desc>/.exec(markup)?.[1];
      assert.ok(desc && desc.length > 0);
      assert.equal(decodeEntities(desc), spec.summary);
    });
  }
});

function decodeEntities(value: string): string {
  return value
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// ── 5. No colour literal, no brand-ui (D-IL5, D-IL14) ─────────────────────────────────────────────

describe("every painted value is an --illus-* token", () => {
  for (const name of FIXTURE_NAMES) {
    it(`${name}: paints nothing that is not a token`, () => {
      const markup = renderScene(specOf(name));
      const paints = paintValues(markup);
      assert.ok(paints.length > 20, `only ${paints.length} paint values — the scene drew nothing`);
      for (const value of paints) assert.ok(isAllowedPaint(value), `painted ${value}`);
      for (const token of tokensUsed(markup)) assert.match(token, /^--illus-[a-z0-9-]+$/);
    });
  }

  it("the renderer imports nothing from a component library", () => {
    for (const [name, source] of rendererSources()) {
      assert.doesNotMatch(source, /@elabs-ai\//, `${name} imports brand-ui — illustrations are `);
      assert.doesNotMatch(
        source,
        /from "(?!\.|@mcp-token-footprint|react)/,
        `${name} has a new dep`,
      );
    }
  });
});

// ── 6. The six connector kinds ────────────────────────────────────────────────────────────────────

/** A kind's appearance with its HUE removed: width, dash pattern, terminal, cap. */
function nonHueSignature(kind: IllustrationConnectorKind): string {
  const style = CONNECTOR_STYLE[kind];
  return [
    style.width,
    style.dash ?? "solid",
    style.arrow === "none" ? "no-head" : "head",
    style.round ? "round" : "butt",
  ].join("|");
}

describe("all six connector kinds render, each with its own row of the ONE table", () => {
  const markup = renderScene(specOf("crowded-labels"));

  it("draws exactly one line of each kind, and the fixture covers all six", () => {
    const drawn = attributeValues(markup, "data-illus-connector");
    assert.deepEqual([...drawn].sort(), [...ILLUSTRATION_CONNECTOR_KINDS].sort());
  });

  for (const kind of ILLUSTRATION_CONNECTOR_KINDS) {
    it(`paints ${kind} with the stroke, weight and dash the table declares`, () => {
      const style = CONNECTOR_STYLE[kind];
      const group = markup.slice(markup.indexOf(`data-illus-connector="${kind}"`));
      const path = /<path[^>]*>/.exec(group)?.[0] ?? "";
      assert.ok(path.includes(`stroke-width="${style.width}"`), path);
      assert.ok(path.includes(style.stroke), path);
      assert.equal(
        path.includes("stroke-dasharray"),
        style.dash !== undefined,
        `${kind} dash: ${path}`,
      );
      const head = /<polygon[^>]*>/.exec(group.slice(0, group.indexOf("</g>")))?.[0];
      assert.equal(head !== undefined, style.arrow !== "none", `${kind} arrowhead: ${head}`);
    });
  }

  // ── THE MEASUREMENT, and it does not fully pass ────────────────────────────────────────────────
  // WP 2.3 acceptance 6 asks that every kind be separable "by more than hue alone — pattern or
  // terminal, not colour only". Measured over all 15 ordered-free pairs of the shipped table, THIRTEEN
  // separate without hue and TWO do not:
  //
  //   flow  vs publish — both solid 2.5 with an arrowhead; only ink-muted vs accent tells them apart
  //   write vs loop    — both dashed "6 4" at 2; only accent vs guide tells them apart
  //
  // That is a property of 01-system-design.md §2.3's table, not of this renderer: the table is a
  // LOCKED design artifact, kept honest by a second hand-transcribed copy in `Connector.test.tsx`
  // precisely so it cannot be edited casually. Changing it to satisfy this acceptance item is an
  // owner/orchestrator call, not a builder's, so the state is PINNED here instead of patched, and
  // reported. The minimum fix, if it is taken: give `loop` the `construction` dash (it already
  // strokes `--illus-guide`, which is what that dash is for) and `publish` a second chevron.
  it("pins today's measured truth: 13 of 15 pairs separate without hue, and names the 2 that do not", () => {
    const collisions: string[] = [];
    const kinds = [...ILLUSTRATION_CONNECTOR_KINDS];
    for (let i = 0; i < kinds.length; i += 1) {
      for (let j = i + 1; j < kinds.length; j += 1) {
        const a = kinds[i] as IllustrationConnectorKind;
        const b = kinds[j] as IllustrationConnectorKind;
        if (nonHueSignature(a) === nonHueSignature(b)) collisions.push(`${a}/${b}`);
      }
    }
    assert.equal((kinds.length * (kinds.length - 1)) / 2, 15);
    assert.deepEqual(
      collisions.sort(),
      ["flow/publish", "write/loop"],
      "the connector table's non-hue separation changed — re-read WP 2.3 acceptance 6 before " +
        "updating this list, and update the report that cites it",
    );
  });

  it("separates read from write without hue, which is the example the acceptance names", () => {
    assert.notEqual(nonHueSignature("read"), nonHueSignature("write"));
  });
});

// ── 7. The three honesty rules ────────────────────────────────────────────────────────────────────

describe("a connector that doubles back is DRAWN and reported, never dropped", () => {
  const spec = specOf("self-learning-loop");
  const report = reportOf(spec);
  const markup = renderScene(spec);

  it("the fixture really produces the condition", () => {
    assert.deepEqual(report.doublesBack, ["c5", "c6"]);
  });

  it("draws every one of them, on the best-effort path the router returned", () => {
    const layout = layoutScene(spec, { catalog: ILLUSTRATION_SCENE_CATALOG });
    const routing = routeScene(layout, spec.connectors ?? [], {
      catalog: ILLUSTRATION_SCENE_CATALOG,
    });
    const doubled = routing.routes.filter((route) => route.doublesBack);
    assert.equal(doubled.length, 2);
    for (const route of doubled) {
      const first = route.points[0];
      const last = route.points[route.points.length - 1];
      assert.ok(first && last);
      assert.ok(markup.includes(`d="M ${first.x} ${first.y}`), `${route.identity} was not drawn`);
    }
    assert.equal((markup.match(/data-illus-doubles-back="true"/g) ?? []).length, 2);
  });

  it("says so on the artifact itself, not only in a console nobody kept", () => {
    assert.ok(markup.includes('data-illus-doubles-back="c5 c6"'), markup.slice(0, 400));
  });
});

describe("a connector with no geometry is REPORTED, never swallowed", () => {
  // The only way to reach this from a spec that validates: render against a catalog that is not the
  // one the spec was validated against — a real case (D-IL9's flag-don't-break scenario) and the
  // reason `catalog` and `registry` are separate props.
  const portless: IllustrationRegistryEntry[] = ILLUSTRATION_REGISTRY.map((entry) => ({
    ...entry,
    ports: {},
  }));
  const spec = specOf("crowded-labels");
  const markup = renderScene(spec, { catalog: sceneCatalogOf(portless) });

  it("still draws the scene rather than failing outright", () => {
    assert.ok(markup.includes('data-illus-node="west"'), "the stations should still be drawn");
    assert.ok(markup.includes('data-illus-primitive="paper-stage"'));
  });

  it("draws no line for a connector it has no points for", () => {
    assert.equal(groupTags(markup, "data-illus-connector=").length, 0);
  });

  it("names every unresolved endpoint on the artifact", () => {
    const listed = /data-illus-unresolved="([^"]+)"/.exec(markup)?.[1]?.split(" ") ?? [];
    assert.equal(listed.length, (spec.connectors ?? []).length);
    assert.ok(listed.includes("west.read"));
  });

  it("reports them through the one warning channel", () => {
    const lines = capturedWarnings(() =>
      render(<IllustrationScene spec={spec} catalog={sceneCatalogOf(portless)} />),
    );
    assert.ok(
      lines.some((line) => line.includes("have no geometry and were NOT drawn")),
      lines.join("\n"),
    );
  });
});

describe("a caption that cannot be cleared is rendered and counted", () => {
  const spec = specOf("crowded-labels");
  const report = reportOf(spec);
  const markup = renderScene(spec);

  it("the fixture really produces the condition", () => {
    assert.deepEqual(report.collidingLabels, ["k-flow"]);
  });

  it("renders the caption anyway — an author has to be able to see it", () => {
    assert.ok(markup.includes(">a caption with nowhere to go</text>"));
    assert.ok(markup.includes('data-illus-label-collides="true"'));
  });

  it("counts it on the artifact and in the warning", () => {
    assert.ok(markup.includes('data-illus-label-collisions="k-flow"'));
    const lines = capturedWarnings(() => render(<IllustrationScene spec={spec} />));
    assert.ok(
      lines.some((line) => line.includes("sit on a node box")),
      lines.join("\n"),
    );
  });
});

function capturedWarnings(body: () => unknown): string[] {
  const original = console.warn;
  const lines: string[] = [];
  console.warn = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    body();
  } finally {
    console.warn = original;
  }
  return lines;
}

// ── 8. The accent budget warning (D-IL6) ──────────────────────────────────────────────────────────

describe("the accent-ratio warning (D-IL6)", () => {
  it("counts accent-carrying parts against the total, exactly as the WP defines it", () => {
    const budget = sceneAccentBudget(specOf("self-learning-loop"));
    // 6 nodes + 6 connectors + 2 annotations = 14 parts; two `active` nodes and the `write` and
    // `publish` connectors carry the accent.
    assert.deepEqual(
      { accentParts: budget.accentParts, totalParts: budget.totalParts },
      { accentParts: 4, totalParts: 14 },
    );
    assert.equal(budget.withinBand, false);
  });

  it("fires when the ratio is outside the band", () => {
    const lines = capturedWarnings(() =>
      render(<IllustrationScene spec={specOf("crowded-labels")} />),
    );
    assert.ok(
      lines.some((line) => line.includes("accent budget")),
      lines.join("\n"),
    );
  });

  it("is silent when the ratio is inside the band", () => {
    // 20 nodes, one of them `active`: 1/20 = 5%, inside 2-6%. A real, renderable scene rather than a
    // hand-built report, because "silent inside the band" is a claim about the RENDER.
    const spec = evenlyAccentedScene();
    assert.equal(sceneAccentBudget(spec).withinBand, true);
    assert.deepEqual(
      capturedWarnings(() => render(<IllustrationScene spec={spec} />)),
      [],
    );
  });

  it("cannot land inside the band at all below 17 parts — the measured finding, pinned", () => {
    // The reachable ratios for n parts are 0, 1/n, 2/n, …. For any n < 17, 1/n > 0.06 and 0 < 0.02,
    // so NO scene of fewer than 17 parts can satisfy the band. Both original fixtures have 14.
    for (let parts = 1; parts < 17; parts += 1) {
      const reachable = Array.from({ length: parts + 1 }, (_, k) => k / parts);
      assert.ok(
        !reachable.some((r) => r >= ILLUS_ACCENT_BAND.min && r <= ILLUS_ACCENT_BAND.max),
        `a scene of ${parts} parts CAN land in the band, so the finding is wrong`,
      );
    }
    assert.equal(1 / 17 >= ILLUS_ACCENT_BAND.min && 1 / 17 <= ILLUS_ACCENT_BAND.max, true);
  });

  it("is dev-only: a production build says nothing at all", () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      assert.deepEqual(
        capturedWarnings(() => render(<IllustrationScene spec={specOf("crowded-labels")} />)),
        [],
      );
    } finally {
      // `Reflect.deleteProperty` rather than `delete`, so the variable is restored to ABSENT when it
      // started absent — assigning `undefined` would leave the literal string "undefined" behind.
      if (previous === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
      else process.env.NODE_ENV = previous;
    }
  });

  it("never throws, even when the console itself does", () => {
    const original = console.warn;
    console.warn = () => {
      throw new Error("a hostile console");
    };
    try {
      assert.doesNotThrow(() => render(<IllustrationScene spec={specOf("crowded-labels")} />));
    } finally {
      console.warn = original;
    }
  });

  it("contributes nothing to the markup", () => {
    const markup = renderScene(specOf("crowded-labels"));
    for (const word of ["accent budget", "console", "D-IL6", "warn"]) {
      assert.equal(markup.includes(word), false, `"${word}" leaked into the drawing`);
    }
  });

  it("says everything it has to say in ONE warning, so there is one place to look", () => {
    const lines = capturedWarnings(() =>
      render(<IllustrationScene spec={specOf("self-learning-loop")} />),
    );
    assert.equal(lines.length, 1, lines.join("\n---\n"));
    assert.ok(lines[0]?.includes("double back"));
    assert.ok(lines[0]?.includes("accent budget"));
  });

  it("stays quiet when a scene has nothing to report", () => {
    const clean: SceneRenderReport = {
      sceneId: "quiet",
      doublesBack: [],
      unresolved: [],
      collidingLabels: [],
      missingComponents: [],
      accent: { accentParts: 1, totalParts: 20, ratio: 0.05, withinBand: true },
    };
    assert.deepEqual(
      capturedWarnings(() => warnAboutScene(clean)),
      [],
    );
  });
});

function evenlyAccentedScene(): IllustrationSceneSpec {
  return {
    version: 1,
    registryVersion: "0.1.0",
    id: "accent-in-band",
    title: "Twenty stores, one lit",
    summary: "A scene of twenty stations with exactly one accent moment, so the budget is met.",
    canvas: { format: "hero_wide", stage: "plain" },
    bands: [{ id: "row", kind: "hub" }],
    nodes: Array.from({ length: 20 }, (_, index) => ({
      id: `n${index}`,
      component: "database",
      band: "row",
      size: "s" as const,
      ...(index === 0 ? { state: "active" as const } : {}),
    })),
  };
}

// ── 9. An invalid spec ────────────────────────────────────────────────────────────────────────────

describe("an invalid spec renders a visible, accessible failure", () => {
  const broken = {
    version: 1,
    registryVersion: "0.1.0",
    id: "broken-scene",
    title: "Broken",
    summary: "Names a component that does not exist.",
    canvas: { format: "square", stage: "paper" },
    bands: [{ id: "row", kind: "lane" }],
    nodes: [{ id: "ghost", component: "not-a-component", band: "row", seq: 1 }],
  } as unknown as IllustrationSceneSpec;

  it("does not throw", () => {
    assert.doesNotThrow(() => renderScene(broken));
  });

  it("is not a blank canvas — it says what went wrong, in words", () => {
    const markup = renderScene(broken);
    assert.ok(markup.includes("This illustration could not be drawn"));
    assert.ok(markup.includes("1 problem in the scene spec"));
    assert.ok(markup.includes('data-illus-issue="unknown-component"'));
    assert.ok(markup.includes("not-a-component"), "the offending value is quoted");
  });

  it("stays accessible: role=img with an associated title and desc", () => {
    const markup = renderScene(broken);
    const root = markup.slice(0, markup.indexOf(">") + 1);
    assert.ok(root.includes('role="img"'));
    assert.ok(root.includes('data-illus-scene-invalid="true"'));
    const labelledBy = /aria-labelledby="([^"]+)"/.exec(root)?.[1];
    const describedBy = /aria-describedby="([^"]+)"/.exec(root)?.[1];
    assert.ok(labelledBy && describedBy);
    assert.ok(markup.includes(`<title id="${labelledBy}">`));
    assert.ok(markup.includes(`<desc id="${describedBy}">`));
  });

  it("draws NO part of the scene — a partial drawing that looks complete is the worst outcome", () => {
    const markup = renderScene(broken);
    assert.equal(markup.includes("data-illus-node="), false);
    assert.equal(markup.includes("data-illus-entity="), false);
    assert.equal(markup.includes("data-illus-connector="), false);
  });

  it("paints only --illus-* tokens, like everything else here", () => {
    for (const value of paintValues(renderScene(broken))) assert.ok(isAllowedPaint(value));
  });

  it("summarizes a long list rather than growing without bound", () => {
    const many = {
      ...broken,
      nodes: Array.from({ length: 30 }, (_, index) => ({
        id: `g${index}`,
        component: "not-a-component",
        band: "row",
        seq: index,
      })),
    } as unknown as IllustrationSceneSpec;
    const markup = renderScene(many);
    assert.equal((markup.match(/data-illus-issue=/g) ?? []).length, 12);
    assert.ok(markup.includes("+ 18 more"));
    assert.ok(markup.includes('data-illus-issue-count="30"'));
  });

  it("renders identically twice", () => {
    assert.equal(renderScene(broken), renderScene(broken));
  });
});

// ── 10. The annotation body wrapper ───────────────────────────────────────────────────────────────

describe("annotation bodies are wrapped by character count, never measured", () => {
  it("breaks on whitespace and keeps every word", () => {
    const lines = wrapAnnotationBody("one two three four five six", 9);
    assert.deepEqual(lines, ["one two", "three", "four five", "six"]);
    assert.equal(lines.join(" ").split(" ").length, 6);
  });

  it("gives an over-long word its own line rather than cutting it", () => {
    assert.deepEqual(wrapAnnotationBody("a supercalifragilistic b", 6), [
      "a",
      "supercalifragilistic",
      "b",
    ]);
  });

  it("returns nothing for an empty body, and is stable under repetition", () => {
    assert.deepEqual(wrapAnnotationBody("   ", 10), []);
    const body = "Every station reaches the same MCP server and the same Skill.";
    assert.deepEqual(wrapAnnotationBody(body, 24), wrapAnnotationBody(body, 24));
  });

  it("derives its budget from the card width and never goes below the floor", () => {
    assert.ok(annotationLineBudget(352) > annotationLineBudget(200));
    assert.ok(annotationLineBudget(1) >= 8);
  });
});
