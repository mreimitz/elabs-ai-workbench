import {
  ILLUSTRATION_NODE_DEFAULTS,
  ILLUSTRATION_PORT_SIDES,
  type IllustrationRegistryEntry,
  type IllustrationSceneConnector,
  type IllustrationSceneSpec,
  illustrationSceneSpecSchema,
} from "@mcp-token-footprint/shared";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { ISO_UNIT } from "../iso-math.js";
import { ILLUSTRATION_REGISTRY } from "../registry.js";
import { ILLUSTRATION_SCENE_CATALOG, type SceneCatalog, sceneCatalogOf } from "./catalog.js";
import { readSceneFixture } from "./fixtures.js";
import {
  type SceneLayout,
  type SceneNodeLayout,
  type ScenePoint,
  type SceneRect,
  layoutScene,
} from "./layout.js";
import {
  CONNECTOR_CORNER_UNITS,
  CONNECTOR_NUDGE_UNITS,
  LABEL_ALONG_FRACTIONS,
  PORT_SIDE_DIRECTIONS,
  type OrthoDirection,
  type RoutedConnector,
  type SceneRouting,
  connectorPathData,
  endpointDirectionsToward,
  labelBoxSize,
  framePortDirection,
  routeScene,
  portSideDirection,
  routeShapeOf,
} from "./route.js";

// DETERMINISM IS THE ACCEPTANCE CRITERION, and this file carries it the way `layout.test.ts` does:
// golden routes that fail on any drift at all, plus the determinism tests that say WHY a drift is a
// defect rather than a re-baseline. Everything else pins one rule each — the departure direction,
// the four shapes, the nudge, the radius clamp, the label.
//
// REGENERATING A GOLDEN. `ILLUS_UPDATE_SCENE_GOLDEN=1 pnpm --filter @mcp-token-footprint/illustrations test`
// rewrites them — the same switch the layout goldens use, so one command re-baselines both passes.
// Read the diff before committing it: a fixture's routes do not move unless a dial in `route.ts` or
// the layout underneath it moved, and if they moved for any other reason THAT is the finding.

const GOLDEN_DIR = fileURLToPath(new URL("./golden/", import.meta.url));
const ROUTE_SOURCE = fileURLToPath(new URL("./route.ts", import.meta.url));
const FIXTURE_NAMES = ["self-learning-loop", "run-turn-cycle"] as const;

function specOf(name: string): IllustrationSceneSpec {
  return illustrationSceneSpecSchema.parse(readSceneFixture(name));
}

function routingOf(name: string, catalog: SceneCatalog = ILLUSTRATION_SCENE_CATALOG): SceneRouting {
  const spec = specOf(name);
  return routed(layoutScene(spec, { catalog }), spec.connectors ?? [], catalog);
}

/**
 * `routeScene` with the live catalog, which is what every caller in the app will hand it. The stub
 * scenes below deliberately use port names the catalog does NOT declare, so they exercise the
 * frame-derived fallback; the fixtures exercise the declared-side rule.
 */
function routed(
  layout: SceneLayout,
  connectors: readonly IllustrationSceneConnector[],
  catalog: SceneCatalog = ILLUSTRATION_SCENE_CATALOG,
): SceneRouting {
  return routeScene(layout, connectors, { catalog });
}

function routeOf(routing: SceneRouting, id: string): RoutedConnector {
  const route = routing.routes.find((candidate) => candidate.id === id);
  assert.ok(route, `the routing has no connector "${id}"`);
  return route;
}

// ── Stub scenes ───────────────────────────────────────────────────────────────────────────────────
// A hand-built layout is how a shape gets pinned to exact turn points: the two fixtures exercise the
// router against real geometry, but they cannot say "this pair of directions produces THIS corner".

function stubNode(
  id: string,
  frame: SceneRect,
  ports: Readonly<Record<string, ScenePoint>>,
): SceneNodeLayout {
  return {
    id,
    component: "agent",
    band: null,
    placement: "explicit",
    size: "m",
    state: ILLUSTRATION_NODE_DEFAULTS.state,
    detail: ILLUSTRATION_NODE_DEFAULTS.detail,
    facing: ILLUSTRATION_NODE_DEFAULTS.facing,
    variant: null,
    heightUnits: 3,
    origin: { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 },
    frame,
    ports,
  };
}

/**
 * A node whose only port is on the named face, positioned so {@link framePortDirection} says so.
 * The port is called `p`, which the `agent` entry does not declare — so these stubs deliberately
 * fall through rule 1 and exercise the geometric fallback.
 */
function faceNode(
  id: string,
  centre: ScenePoint,
  face: "north" | "east" | "south" | "west",
): SceneNodeLayout {
  const width = 80;
  const height = 80;
  const frame = { x: centre.x - width / 2, y: centre.y - height / 2, width, height };
  const port: ScenePoint =
    face === "east"
      ? { x: centre.x + width / 2, y: centre.y }
      : face === "west"
        ? { x: centre.x - width / 2, y: centre.y }
        : face === "north"
          ? { x: centre.x, y: centre.y - height / 2 }
          : { x: centre.x, y: centre.y + height / 2 };
  return stubNode(id, frame, { p: port });
}

function stubLayout(
  nodes: readonly SceneNodeLayout[],
  extraEndpoints: Readonly<Record<string, ScenePoint>> = {},
): SceneLayout {
  const endpoints: Record<string, ScenePoint> = {};
  for (const node of nodes) {
    for (const [name, point] of Object.entries(node.ports)) endpoints[`${node.id}.${name}`] = point;
  }
  for (const [key, point] of Object.entries(extraEndpoints)) endpoints[key] = point;
  return {
    id: "stub",
    title: "Stub scene",
    summary: "A hand-built layout, so a shape can be pinned to exact turn points.",
    canvas: {
      format: "square",
      stage: "plain",
      aspect: 1,
      x: 0,
      y: 0,
      width: 1000,
      height: 1000,
      viewBox: "0 0 1000 1000",
    },
    bands: [],
    nodes,
    annotations: [],
    endpoints,
  };
}

function connector(
  id: string,
  from: string,
  to: string,
  label?: string,
): IllustrationSceneConnector {
  return label === undefined
    ? { id, from, to, kind: "flow" }
    : { id, from, to, kind: "flow", label };
}

// ── The goldens ───────────────────────────────────────────────────────────────────────────────────

describe("golden routes — a fixture in, a stable set of paths out", () => {
  for (const name of FIXTURE_NAMES) {
    it(`${name} routes exactly as recorded`, () => {
      const produced = `${JSON.stringify(routingOf(name), null, 2)}\n`;
      const path = join(GOLDEN_DIR, `${name}.routes.json`);
      if (process.env.ILLUS_UPDATE_SCENE_GOLDEN === "1") writeFileSync(path, produced);
      assert.equal(
        produced,
        readFileSync(path, "utf8"),
        `${name}'s routes moved. Regenerate with ILLUS_UPDATE_SCENE_GOLDEN=1 only after reading ` +
          "the diff — routes do not move unless a dial in route.ts or the layout under it did.",
      );
    });
  }
});

describe("determinism — the same layout and connectors give byte-identical output", () => {
  it("produces identical JSON when run twice", () => {
    for (const name of FIXTURE_NAMES) {
      assert.equal(JSON.stringify(routingOf(name)), JSON.stringify(routingOf(name)));
    }
  });

  it("produces identical JSON from a spec that has been through a JSON round trip", () => {
    for (const name of FIXTURE_NAMES) {
      const spec = specOf(name);
      const clone = JSON.parse(JSON.stringify(spec)) as IllustrationSceneSpec;
      const serialize = (subject: IllustrationSceneSpec): string =>
        JSON.stringify(
          routed(
            layoutScene(subject, { catalog: ILLUSTRATION_SCENE_CATALOG }),
            subject.connectors ?? [],
          ),
        );
      assert.equal(serialize(spec), serialize(clone));
    }
  });

  // The layout underneath reads one unordered collection — a registry entry's `ports` — and sorts
  // its keys. This is the router's half of that guarantee: rebuild every entry with its ports
  // inserted in the opposite order and not one byte of the routing may move.
  it("does not depend on the insertion order of a registry entry's ports", () => {
    const reversed: IllustrationRegistryEntry[] = ILLUSTRATION_REGISTRY.map((entry) => ({
      ...entry,
      ports: Object.fromEntries(Object.entries(entry.ports).reverse()),
    }));
    for (const name of FIXTURE_NAMES) {
      assert.equal(
        JSON.stringify(routingOf(name, sceneCatalogOf(reversed))),
        JSON.stringify(routingOf(name)),
      );
    }
  });

  // A single `Date.now()` or `getBBox()` added later would pass every other test in this file while
  // destroying the property they exist for. COMMENTS ARE STRIPPED FIRST — `route.ts` names all four
  // bans in its own header, so a scan over raw text would fail on the documentation of the rule
  // rather than on a breach of it, which is exactly the sort of noisy guard people learn to delete.
  it("the router's source contains no clock, no randomness and no DOM measurement", () => {
    const source = strippedRouteSource();
    for (const pattern of [
      /\bMath\s*\.\s*random\b/,
      /\bDate\b/,
      /getBBox/,
      /getBoundingClientRect/,
    ]) {
      assert.doesNotMatch(source, pattern, `route.ts reaches for ${pattern}`);
    }
  });

  // §1: "The one thing you must not do: give the router a stroke, fill, color, className or
  // opacity." The output type has to stay colour-free BY CONSTRUCTION, so that a future author
  // cannot smuggle paint through the geometry layer on the way to the renderer.
  //
  // The patterns are SUBSTRINGS on purpose, not `\b`-anchored words: `strokeWidth`, `fillOpacity`
  // and `colorScheme` are exactly how paint would arrive, and every one of them would walk straight
  // through a word-boundary match. Nothing in this file's own code contains any of them.
  it("the router's source paints nothing — no stroke, fill, colour, class, opacity or dash", () => {
    const source = strippedRouteSource();
    for (const pattern of [
      /stroke/i,
      /fill/i,
      /colou?r/i,
      /classname/i,
      /opacity/i,
      /dash/i,
      /from\s+"react"/,
      /<svg/,
      /<path/,
    ]) {
      assert.doesNotMatch(
        source,
        pattern,
        `route.ts reaches for ${pattern}, which is WP 2.3's job`,
      );
    }
  });
});

function strippedRouteSource(): string {
  const raw = readFileSync(ROUTE_SOURCE, "utf8");
  const stripped = raw.replace(/\/\*[\s\S]*?\*\//g, "\n").replace(/^[ \t]*\/\/.*$/gm, "");
  // The stripper must actually strip, or every assertion above passes for the wrong reason.
  assert.doesNotMatch(
    stripped,
    /DETERMINISM IS THE ACCEPTANCE CRITERION/,
    "the comment stripper did nothing, so the source scan is vacuous",
  );
  assert.match(
    stripped,
    /export function routeScene/,
    "the comment stripper ate the code as well as the comments",
  );
  return stripped;
}

// ── Orthogonality ─────────────────────────────────────────────────────────────────────────────────

describe("every routed path is orthogonal — no diagonals in the connector layer", () => {
  for (const name of FIXTURE_NAMES) {
    it(`${name}: every emitted segment is horizontal or vertical`, () => {
      const routing = routingOf(name);
      assert.equal(routing.unresolved.length, 0, "every fixture endpoint must resolve");
      assert.equal(routing.routes.length, (specOf(name).connectors ?? []).length);
      let segments = 0;
      for (const route of routing.routes) {
        assert.ok(route.points.length >= 2, `${route.identity} produced no segment`);
        for (let index = 1; index < route.points.length; index += 1) {
          const a = route.points[index - 1];
          const b = route.points[index];
          assert.ok(a);
          assert.ok(b);
          const horizontal = a.y === b.y && a.x !== b.x;
          const vertical = a.x === b.x && a.y !== b.y;
          assert.ok(
            horizontal !== vertical,
            `${route.identity} segment ${index} runs from (${a.x}, ${a.y}) to (${b.x}, ${b.y}), ` +
              "which is neither horizontal nor vertical",
          );
          segments += 1;
        }
      }
      assert.ok(segments > 0, "the walk must actually walk something");
    });
  }
});

// ── The departure rule ────────────────────────────────────────────────────────────────────────────

describe("portSideDirection — rule 1, the side the catalog declares", () => {
  it("maps each iso face to the screen direction it projects to", () => {
    assert.equal(portSideDirection("top"), "north");
    assert.equal(portSideDirection("bottom"), "south");
    assert.equal(portSideDirection("left"), "west");
    assert.equal(portSideDirection("right"), "east");
    assert.deepEqual(Object.keys(PORT_SIDE_DIRECTIONS).sort(), [...ILLUSTRATION_PORT_SIDES].sort());
  });

  // THE MEASUREMENT, AS A GUARD. The frame-derived rule this replaced agreed with the catalog on
  // 89 of the 93 catalogued ports across both fixtures — every disagreement a ground port carried
  // off the frame's centre line by an `offset`, which no rule reading only a box can recover. This
  // sweep is the reason that can never quietly come back: it routes one connector out of EVERY
  // catalogued port in both fixtures and insists the line leaves along the side the registry
  // declares. Anything less than 93 of 93 is a regression, not a rounding.
  it("routes every catalogued port in both fixtures along its DECLARED side, 93 of 93", () => {
    let checked = 0;
    for (const name of FIXTURE_NAMES) {
      const spec = specOf(name);
      const laid = layoutScene(spec, { catalog: ILLUSTRATION_SCENE_CATALOG });
      // An extra sink endpoint far off the canvas, so EVERY catalogued port can be a source. Using
      // one of the real ports as the target would silently drop it from the sweep.
      const layout: SceneLayout = {
        ...laid,
        endpoints: {
          ...laid.endpoints,
          "probe.sink": { x: laid.canvas.x + laid.canvas.width + 1000, y: laid.canvas.y - 1000 },
        },
      };

      const probes: IllustrationSceneConnector[] = [];
      const expected: OrthoDirection[] = [];
      for (const node of layout.nodes) {
        const entry = ILLUSTRATION_SCENE_CATALOG.entry(node.component);
        if (entry === undefined) continue;
        for (const port of Object.keys(node.ports).sort()) {
          const side = entry.ports[port]?.side;
          if (side === undefined) continue;
          probes.push({
            id: `p${probes.length}`,
            from: `${node.id}.${port}`,
            to: "probe.sink",
            kind: "flow",
          });
          expected.push(portSideDirection(side));
        }
      }

      const routing = routed(layout, probes);
      assert.equal(routing.unresolved.length, 0);
      assert.equal(routing.routes.length, probes.length);
      for (const [index, route] of routing.routes.entries()) {
        assert.equal(
          route.fromDirection,
          expected[index],
          `${name}/${route.from} left ${route.fromDirection}, but the catalog declares ` +
            `${expected[index]}`,
        );
      }
      checked += probes.length;
    }
    assert.equal(checked, 93, "the sweep must cover every catalogued port, not a shrinking subset");
  });
});

describe("framePortDirection — rule 2, the fallback for a port with no declared side", () => {
  const frame: SceneRect = { x: 0, y: 0, width: 200, height: 100 };

  it("takes north or south when the port is materially above or below the mid-band", () => {
    assert.equal(framePortDirection({ x: 100, y: 4 }, frame), "north");
    assert.equal(framePortDirection({ x: 100, y: 96 }, frame), "south");
    assert.equal(framePortDirection({ x: 10, y: 4 }, frame), "north");
  });

  it("takes west or east inside the mid-band", () => {
    assert.equal(framePortDirection({ x: 20, y: 50 }, frame), "west");
    assert.equal(framePortDirection({ x: 180, y: 50 }, frame), "east");
    assert.equal(framePortDirection({ x: 20, y: 70 }, frame), "west");
  });

  it("takes south on the frame's vertical centre line — the ground port", () => {
    assert.equal(framePortDirection({ x: 100, y: 50 }, frame), "south");
    assert.equal(framePortDirection({ x: 100 + 3, y: 52 }, frame), "south");
    assert.equal(
      framePortDirection({ x: 100 + 5, y: 52 }, frame),
      "east",
      "5 units is off the line",
    );
  });

  // The rule is a rule about a BOX, and this is exactly what a box cannot tell you: an entity's
  // ground port sits at the centre of its own frame, so nothing but the centre-line clause reaches
  // it. Locking the boundary here means a later edit to the tolerance cannot quietly lose it.
  it("keeps the two clauses from swallowing each other", () => {
    const tall: SceneRect = { x: 0, y: 0, width: 200, height: 400 };
    assert.equal(framePortDirection({ x: 100, y: 200 }, tall), "south");
    assert.equal(framePortDirection({ x: 100, y: 299 }, tall), "south");
    assert.equal(
      framePortDirection({ x: 100, y: 301 }, tall),
      "south",
      "past the band, still south",
    );
    assert.equal(
      framePortDirection({ x: 40, y: 301 }, tall),
      "south",
      "past the band, so not west",
    );
    assert.equal(framePortDirection({ x: 40, y: 299 }, tall), "west");
  });
});

describe("endpointDirectionsToward — an endpoint with no box faces the other end", () => {
  it("offers the axis of greatest separation first", () => {
    assert.deepEqual(endpointDirectionsToward({ x: 0, y: 0 }, { x: 100, y: 10 }), [
      "east",
      "south",
    ]);
    assert.deepEqual(endpointDirectionsToward({ x: 0, y: 0 }, { x: -10, y: -100 }), [
      "north",
      "west",
    ]);
  });

  it("offers one candidate when there is no separation on an axis", () => {
    assert.deepEqual(endpointDirectionsToward({ x: 0, y: 0 }, { x: 0, y: 100 }), ["south"]);
    assert.deepEqual(endpointDirectionsToward({ x: 0, y: 0 }, { x: -100, y: 0 }), ["west"]);
    assert.deepEqual(endpointDirectionsToward({ x: 5, y: 5 }, { x: 5, y: 5 }), ["east"]);
  });

  // The second candidate is what lets a cycle band's gate produce an honest line: the dominant axis
  // would make this one leave backwards, so the router falls to the other and gets a `u`.
  it("lets a gate fall to its second candidate rather than double back", () => {
    const layout = stubLayout([faceNode("a", { x: 0, y: 0 }, "east")], {
      "gate.entry": { x: -400, y: 600 },
    });
    const routing = routed(layout, [connector("c", "a.p", "gate.entry")]);
    const route = routeOf(routing, "c");
    assert.equal(route.shape, "u");
    assert.equal(route.doublesBack, false);
  });
});

// ── The four shapes ───────────────────────────────────────────────────────────────────────────────

describe("the four route shapes, each pinned to its corner count and turn points", () => {
  it("straight: the endpoints share an axis and the travel directions agree", () => {
    const layout = stubLayout([
      faceNode("a", { x: 0, y: 0 }, "east"),
      faceNode("b", { x: 240, y: 0 }, "west"),
    ]);
    const route = routeOf(routed(layout, [connector("c", "a.p", "b.p")]), "c");
    assert.equal(route.shape, "straight");
    assert.equal(route.corners, 0);
    assert.deepEqual(route.points, [
      { x: 40, y: 0 },
      { x: 200, y: 0 },
    ]);
    assert.equal(route.d, "M 40 0 L 200 0");
  });

  it("L: the travel directions are perpendicular, so there is one corner", () => {
    const layout = stubLayout([
      faceNode("a", { x: 0, y: 0 }, "east"),
      faceNode("b", { x: 300, y: 240 }, "north"),
    ]);
    const route = routeOf(routed(layout, [connector("c", "a.p", "b.p")]), "c");
    assert.equal(route.shape, "l");
    assert.equal(route.corners, 1);
    assert.deepEqual(route.points, [
      { x: 40, y: 0 },
      { x: 300, y: 0 },
      { x: 300, y: 200 },
    ]);
  });

  it("Z: the travel directions agree but the endpoints are offset, so it splits at the middle", () => {
    const layout = stubLayout([
      faceNode("a", { x: 0, y: 0 }, "east"),
      faceNode("b", { x: 400, y: 200 }, "west"),
    ]);
    const route = routeOf(routed(layout, [connector("c", "a.p", "b.p")]), "c");
    assert.equal(route.shape, "z");
    assert.equal(route.corners, 2);
    assert.deepEqual(route.points, [
      { x: 40, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 200 },
      { x: 360, y: 200 },
    ]);
  });

  it("U: the travel directions oppose, so it loops back beyond the further endpoint", () => {
    const layout = stubLayout([
      faceNode("a", { x: 0, y: 0 }, "east"),
      faceNode("b", { x: 300, y: 200 }, "east"),
    ]);
    const route = routeOf(routed(layout, [connector("c", "a.p", "b.p")]), "c");
    assert.equal(route.shape, "u");
    assert.equal(route.corners, 2);
    assert.deepEqual(route.points, [
      { x: 40, y: 0 },
      { x: 372, y: 0 },
      { x: 372, y: 200 },
      { x: 340, y: 200 },
    ]);
    assert.equal(route.doublesBack, false);
  });

  it("classifies a direction pair the same way the router does", () => {
    const from = { x: 0, y: 0 };
    assert.equal(routeShapeOf("east", "east", from, { x: 100, y: 0 }), "straight");
    assert.equal(routeShapeOf("east", "east", from, { x: 100, y: 50 }), "z");
    assert.equal(routeShapeOf("east", "south", from, { x: 100, y: 50 }), "l");
    assert.equal(routeShapeOf("east", "west", from, { x: 100, y: 50 }), "u");
  });

  // A port facing east whose partner sits to the west has no honest 1- or 2-corner path, and the
  // closed set has no fifth shape. The router still draws it, and SAYS so, rather than hiding it.
  it("flags a route that leaves against its own port instead of pretending", () => {
    const layout = stubLayout([
      faceNode("a", { x: 400, y: 0 }, "east"),
      faceNode("b", { x: 0, y: 200 }, "east"),
    ]);
    const behind = routeOf(routed(layout, [connector("c", "a.p", "b.p")]), "c");
    assert.equal(behind.doublesBack, false, "a u reaches behind itself honestly");

    const facing = stubLayout([
      faceNode("a", { x: 400, y: 0 }, "east"),
      faceNode("b", { x: 0, y: 200 }, "west"),
    ]);
    const doubled = routeOf(routed(facing, [connector("c", "a.p", "b.p")]), "c");
    assert.equal(doubled.shape, "z");
    assert.equal(doubled.doublesBack, true);
  });
});

// ── Parallel-run nudging ──────────────────────────────────────────────────────────────────────────

describe("parallel runs are nudged apart so two lines never read as one", () => {
  const step = CONNECTOR_NUDGE_UNITS * ISO_UNIT;

  function twoZLayout(): SceneLayout {
    return stubLayout([
      faceNode("a1", { x: 0, y: 0 }, "east"),
      faceNode("b1", { x: 400, y: 200 }, "west"),
      faceNode("a2", { x: 0, y: 60 }, "east"),
      faceNode("b2", { x: 400, y: 260 }, "west"),
    ]);
  }

  const first = connector("alpha", "a1.p", "b1.p");
  const second = connector("beta", "a2.p", "b2.p");

  it("pushes two collinear, overlapping runs apart about their shared centre line", () => {
    const routing = routed(twoZLayout(), [first, second]);
    const alpha = routeOf(routing, "alpha");
    const beta = routeOf(routing, "beta");
    assert.equal(alpha.nudge, -step / 2);
    assert.equal(beta.nudge, step / 2);
    const alphaLine = alpha.points[1]?.x;
    const betaLine = beta.points[1]?.x;
    assert.notEqual(alphaLine, betaLine, "the two runs still share a centre line");
    assert.equal(Math.abs((alphaLine ?? 0) - (betaLine ?? 0)), step);
    assert.equal((alphaLine ?? 0) + (betaLine ?? 0), 400, "the pair stays centred on 200");
  });

  it("assigns the same offset to the same connector however the array is ordered", () => {
    const forward = routed(twoZLayout(), [first, second]);
    const backward = routed(twoZLayout(), [second, first]);
    for (const id of ["alpha", "beta"]) {
      assert.deepEqual(
        routeOf(backward, id).points,
        routeOf(forward, id).points,
        `${id} moved when the connector array was reordered`,
      );
      assert.equal(routeOf(backward, id).nudge, routeOf(forward, id).nudge);
    }
  });

  it("leaves runs on the same line alone when they do not overlap", () => {
    const layout = stubLayout([
      faceNode("a1", { x: 0, y: 0 }, "east"),
      faceNode("b1", { x: 400, y: 200 }, "west"),
      faceNode("a2", { x: 0, y: 600 }, "east"),
      faceNode("b2", { x: 400, y: 800 }, "west"),
    ]);
    const routing = routed(layout, [
      connector("alpha", "a1.p", "b1.p"),
      connector("beta", "a2.p", "b2.p"),
    ]);
    assert.equal(routeOf(routing, "alpha").nudge, 0);
    assert.equal(routeOf(routing, "beta").nudge, 0);
  });

  // A run that touches an endpoint is pinned: moving it would pull the line off its port. So two
  // straights lying on top of each other stay there, and the router says nothing it cannot do.
  it("never moves a pinned run off its port", () => {
    const layout = stubLayout([
      faceNode("a1", { x: 0, y: 0 }, "east"),
      faceNode("b1", { x: 400, y: 0 }, "west"),
      faceNode("a2", { x: 0, y: 0 }, "east"),
      faceNode("b2", { x: 400, y: 0 }, "west"),
    ]);
    const routing = routed(layout, [
      connector("alpha", "a1.p", "b1.p"),
      connector("beta", "a2.p", "b2.p"),
    ]);
    assert.equal(routeOf(routing, "alpha").nudge, 0);
    assert.deepEqual(routeOf(routing, "alpha").points[0], layout.endpoints["a1.p"]);
    assert.deepEqual(routeOf(routing, "beta").points[0], layout.endpoints["a2.p"]);
  });
});

// ── Corner radii ──────────────────────────────────────────────────────────────────────────────────

/** Every `A r r 0 0 f x y` in a path, as numbers. */
function arcsOf(data: string): { r: number; x: number; y: number }[] {
  return [...data.matchAll(/A (-?[\d.]+) -?[\d.]+ 0 0 [01] (-?[\d.]+) (-?[\d.]+)/g)].map(
    (match) => ({
      r: Number(match[1]),
      x: Number(match[2]),
      y: Number(match[3]),
    }),
  );
}

describe("corner radii are fixed, and clamped to half the shorter run they join", () => {
  const radius = CONNECTOR_CORNER_UNITS * ISO_UNIT;

  it("uses the full radius when both runs are long enough", () => {
    const layout = stubLayout([
      faceNode("a", { x: 0, y: 0 }, "east"),
      faceNode("b", { x: 400, y: 200 }, "west"),
    ]);
    const route = routeOf(routed(layout, [connector("c", "a.p", "b.p")]), "c");
    assert.deepEqual(
      arcsOf(route.d).map((arc) => arc.r),
      [radius, radius],
    );
  });

  // The clamp is the property that keeps a path from self-crossing: a 16-unit fillet on a 4-unit
  // run would start before the previous corner ended and the arc would reverse. Half each also
  // means two corners sharing one short run can only ever meet, never overlap.
  it("clamps on a short run, and the two fillets meet instead of crossing", () => {
    const layout = stubLayout([
      faceNode("a", { x: 0, y: 0 }, "east"),
      faceNode("b", { x: 400, y: 4 }, "west"),
    ]);
    const route = routeOf(routed(layout, [connector("c", "a.p", "b.p")]), "c");
    const arcs = arcsOf(route.d);
    assert.equal(arcs.length, 2);
    assert.equal(arcs[0]?.r, 2, "the fillet is half the 4-unit run, not the full radius");
    assert.equal(arcs[1]?.r, 2);
    assert.ok(radius > 2, "this case only means something while the fixed radius exceeds the run");
    // Spelled out in full, because the WHOLE path is the property: the first fillet ends at y = 2
    // and the second begins at y = 2, so they meet. Unclamped they would be r = 8 — the first
    // ending at y = 8 and the second beginning at y = -4, so the run between them reverses and the
    // path crosses itself.
    assert.equal(route.d, "M 40 0 L 198 0 A 2 2 0 0 1 200 2 L 200 2 A 2 2 0 0 0 202 4 L 360 4");
  });

  // The same property, stated over real geometry rather than one contrived case.
  it("never emits a fillet longer than half either run it joins, in either fixture", () => {
    for (const name of FIXTURE_NAMES) {
      for (const route of routingOf(name).routes) {
        const arcs = arcsOf(route.d);
        if (arcs.length !== route.corners) continue;
        for (let corner = 1; corner <= route.corners; corner += 1) {
          const previous = route.points[corner - 1];
          const here = route.points[corner];
          const next = route.points[corner + 1];
          const found = arcs[corner - 1]?.r;
          assert.ok(previous && here && next && found !== undefined);
          const inLength = Math.hypot(here.x - previous.x, here.y - previous.y);
          const outLength = Math.hypot(next.x - here.x, next.y - here.y);
          assert.ok(
            found <= radius && found <= inLength / 2 + 1e-9 && found <= outLength / 2 + 1e-9,
            `${name}/${route.identity} corner ${corner}: r=${found} against runs ` +
              `${inLength} and ${outLength}`,
          );
        }
      }
    }
  });

  it("drops to a sharp corner rather than emitting a zero-radius arc", () => {
    const data = connectorPathData(
      [
        { x: 0, y: 0 },
        { x: 0, y: 0.0001 },
        { x: 40, y: 0.0001 },
      ],
      radius,
    );
    assert.equal(arcsOf(data).length, 0);
    assert.match(data, /^M 0 0 L/);
  });
});

// ── Labels ────────────────────────────────────────────────────────────────────────────────────────

describe("a label is placed from character counts, never from a measurement", () => {
  it("grows with the text and never with a rendered font", () => {
    const short = labelBoxSize("a");
    const long = labelBoxSize("aaaaaaaaaa");
    assert.ok(long.width > short.width);
    assert.equal(long.height, short.height);
    assert.ok(short.width > 0 && short.height > 0);
  });
});

describe("a label is moved clear of the node boxes", () => {
  const wall = (frame: SceneRect): SceneNodeLayout => stubNode("wall", frame, {});

  it("displaces a midpoint that lands inside a node frame, and clears every frame", () => {
    const layout = stubLayout([
      faceNode("a", { x: -60, y: 0 }, "east"),
      faceNode("b", { x: 460, y: 0 }, "west"),
      wall({ x: 150, y: -50, width: 100, height: 100 }),
    ]);
    const route = routeOf(routed(layout, [connector("c", "a.p", "b.p", "over the wall")]), "c");
    const label = route.label;
    assert.ok(label);
    assert.equal(label.collides, false);
    assert.notEqual(label.offset, 0, "the midpoint was inside the wall, so it had to move");
    for (const node of layout.nodes) {
      const clash: boolean =
        label.box.x < node.frame.x + node.frame.width &&
        node.frame.x < label.box.x + label.box.width &&
        label.box.y < node.frame.y + node.frame.height &&
        node.frame.y < label.box.y + label.box.height;
      assert.equal(clash, false, `the label still sits on "${node.id}"`);
    }
  });

  it("returns the midpoint WITH A FLAG when nothing clears, rather than looping", () => {
    const layout = stubLayout([
      faceNode("a", { x: -60, y: 0 }, "east"),
      faceNode("b", { x: 460, y: 0 }, "west"),
      wall({ x: -4000, y: -4000, width: 8000, height: 8000 }),
    ]);
    const route = routeOf(routed(layout, [connector("c", "a.p", "b.p", "nowhere to go")]), "c");
    const label = route.label;
    assert.ok(label);
    assert.equal(label.collides, true);
    assert.equal(label.offset, 0);
    assert.equal(label.along, LABEL_ALONG_FRACTIONS[0]);
    assert.deepEqual(label.anchor, { x: 200, y: 0 });
  });

  it("leaves a connector with no label without one", () => {
    const layout = stubLayout([
      faceNode("a", { x: 0, y: 0 }, "east"),
      faceNode("b", { x: 400, y: 0 }, "west"),
    ]);
    assert.equal(routeOf(routed(layout, [connector("c", "a.p", "b.p")]), "c").label, null);
  });

  it("places every fixture label clear of every node frame", () => {
    for (const name of FIXTURE_NAMES) {
      const spec = specOf(name);
      const layout = layoutScene(spec, { catalog: ILLUSTRATION_SCENE_CATALOG });
      for (const route of routed(layout, spec.connectors ?? []).routes) {
        if (route.label === null) continue;
        assert.equal(
          route.label.collides,
          false,
          `${name}/${route.identity}: "${route.label.text}" could not be placed clear`,
        );
      }
    }
  });
});

// ── Robustness ────────────────────────────────────────────────────────────────────────────────────

describe("the router reports what it cannot route instead of throwing", () => {
  it("collects an endpoint the layout does not have", () => {
    const layout = stubLayout([faceNode("a", { x: 0, y: 0 }, "east")]);
    const routing = routed(layout, [
      connector("c", "a.p", "ghost.in"),
      connector("d", "ghost.out", "a.p"),
    ]);
    assert.equal(routing.routes.length, 0);
    assert.deepEqual(
      routing.unresolved.map((item) => item.missing),
      [["ghost.in"], ["ghost.out"]],
    );
  });

  it("routes nothing at all without complaint", () => {
    assert.deepEqual(routed(stubLayout([]), []), { routes: [], unresolved: [] });
  });

  it("identifies a connector with no id by its endpoints, so the nudge order is still stable", () => {
    const layout = stubLayout([
      faceNode("a", { x: 0, y: 0 }, "east"),
      faceNode("b", { x: 400, y: 200 }, "west"),
    ]);
    const routing = routed(layout, [{ from: "a.p", to: "b.p", kind: "flow" }]);
    assert.equal(routing.routes[0]?.id, null);
    assert.equal(routing.routes[0]?.identity, "a.p->b.p");
  });
});
