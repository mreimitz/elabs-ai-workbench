import {
  ILLUSTRATION_REGISTRY_VERSION,
  type IllustrationRegistryEntry,
  type IllustrationSceneSpec,
  illustrationSceneSpecSchema,
} from "@mcp-token-footprint/shared";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { ISO_UNIT, footprintUnits, portAnchor, projectPoint } from "../iso-math.js";
import { ILLUSTRATION_REGISTRY } from "../registry.js";
import { ILLUSTRATION_SCENE_CATALOG, type SceneCatalog, sceneCatalogOf } from "./catalog.js";
import { readSceneFixture } from "./fixtures.js";
import {
  ATTACH_GAP_UNITS,
  ILLUSTRATION_CANVAS_ASPECT,
  LANE_GAP_UNITS,
  type SceneLayout,
  type SceneNodeLayout,
  layoutScene,
  ringStationAngles,
  roundScene,
  rowCentres,
} from "./layout.js";

// DETERMINISM IS THE ACCEPTANCE CRITERION. Two things in this file carry that: the golden layouts,
// which fail on any drift at all, and the four determinism tests, which say WHY a drift would be a
// defect rather than a re-baseline. The rest checks that each band kind does what its name claims.
//
// REGENERATING A GOLDEN. `ILLUS_UPDATE_SCENE_GOLDEN=1 pnpm --filter @mcp-token-footprint/illustrations test`
// rewrites them. Read the diff before committing it: the layout of a fixture is not supposed to move
// unless a dial in `layout.ts` moved, and if it moved for any other reason that IS the finding.

const GOLDEN_DIR = fileURLToPath(new URL("./golden/", import.meta.url));
const SCENE_DIR = fileURLToPath(new URL(".", import.meta.url));
const FIXTURE_NAMES = ["self-learning-loop", "run-turn-cycle"] as const;

function specOf(name: string): IllustrationSceneSpec {
  return illustrationSceneSpecSchema.parse(readSceneFixture(name));
}

function layoutOf(name: string, catalog: SceneCatalog = ILLUSTRATION_SCENE_CATALOG): SceneLayout {
  return layoutScene(specOf(name), { catalog });
}

function nodeOf(layout: SceneLayout, id: string): SceneNodeLayout {
  const node = layout.nodes.find((candidate) => candidate.id === id);
  assert.ok(node, `the layout has no node "${id}"`);
  return node;
}

// ── The goldens ───────────────────────────────────────────────────────────────────────────────────

describe("golden layouts — a fixture in, a stable drawing out", () => {
  for (const name of FIXTURE_NAMES) {
    it(`${name} lays out exactly as recorded`, () => {
      const produced = `${JSON.stringify(layoutOf(name), null, 2)}\n`;
      const path = join(GOLDEN_DIR, `${name}.layout.json`);
      if (process.env.ILLUS_UPDATE_SCENE_GOLDEN === "1") writeFileSync(path, produced);
      assert.equal(
        produced,
        readFileSync(path, "utf8"),
        `${name}'s layout moved. Regenerate with ILLUS_UPDATE_SCENE_GOLDEN=1 only after reading ` +
          "the diff — a layout does not move unless a dial in layout.ts did.",
      );
    });
  }
});

describe("determinism — the same spec and catalog give byte-identical output", () => {
  it("produces identical JSON when run twice", () => {
    for (const name of FIXTURE_NAMES) {
      assert.equal(JSON.stringify(layoutOf(name)), JSON.stringify(layoutOf(name)));
    }
  });

  it("produces identical JSON from a spec that has been through a JSON round trip", () => {
    for (const name of FIXTURE_NAMES) {
      const spec = specOf(name);
      const clone = JSON.parse(JSON.stringify(spec)) as IllustrationSceneSpec;
      assert.equal(
        JSON.stringify(layoutScene(spec, { catalog: ILLUSTRATION_SCENE_CATALOG })),
        JSON.stringify(layoutScene(clone, { catalog: ILLUSTRATION_SCENE_CATALOG })),
      );
    }
  });

  // The port `Record` is the one unordered collection the engine reads. This is the test that says
  // sorting its keys is load-bearing rather than tidy: rebuild the catalog with every entry's ports
  // inserted in the opposite order and the emitted layout must not move by one byte.
  it("does not depend on the insertion order of a registry entry's ports", () => {
    const reversed: IllustrationRegistryEntry[] = ILLUSTRATION_REGISTRY.map((entry) => ({
      ...entry,
      ports: Object.fromEntries(Object.entries(entry.ports).reverse()),
    }));
    for (const name of FIXTURE_NAMES) {
      assert.equal(
        JSON.stringify(layoutOf(name, sceneCatalogOf(reversed))),
        JSON.stringify(layoutOf(name)),
      );
    }
  });

  // The engine's own source is held to the rules the header states, because a single `Date.now()`
  // added later would pass every other test in this file while destroying the property they exist
  // for. COMMENTS ARE STRIPPED FIRST, and that is not a loophole: `layout.ts` names all four in its
  // own header, so a scan over raw text fails on the documentation of the rule rather than on a
  // breach of it — which is exactly the sort of noisy guard people learn to delete.
  it("the engine's sources contain no clock, no randomness and no DOM measurement", () => {
    const banned = [
      /\bMath\s*\.\s*random\b/,
      /\bnew\s+Date\b/,
      /\bDate\s*\.\s*now\b/,
      /\bperformance\s*\.\s*now\b/,
      /\bdocument\b/,
      /\bwindow\b/,
      /getBoundingClientRect/,
      /getComputedStyle/,
    ];
    const stripComments = (source: string): string =>
      source.replace(/\/\*[\s\S]*?\*\//g, "\n").replace(/^[ \t]*\/\/.*$/gm, "");

    const sources = readdirSync(SCENE_DIR, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts"),
      )
      .map(
        (entry) =>
          [entry.name, stripComments(readFileSync(join(SCENE_DIR, entry.name), "utf8"))] as const,
      );

    assert.ok(
      sources.some(([name]) => name === "layout.ts"),
      "the scan must reach the layout engine itself",
    );
    // The stripper must actually strip, or every assertion below passes for the wrong reason.
    assert.doesNotMatch(
      sources.find(([name]) => name === "layout.ts")?.[1] ?? "",
      /DETERMINISM IS THE ACCEPTANCE CRITERION/,
      "the comment stripper did nothing, so this whole check is vacuous",
    );
    assert.match(
      sources.find(([name]) => name === "layout.ts")?.[1] ?? "",
      /export function layoutScene/,
      "the comment stripper ate the code as well as the comments",
    );
    for (const [name, source] of sources) {
      for (const pattern of banned) {
        assert.doesNotMatch(source, pattern, `${name} reaches for ${pattern}`);
      }
    }
  });
});

// ── Row bands ─────────────────────────────────────────────────────────────────────────────────────

describe("rowCentres — quantized distribution", () => {
  it("centres a row on x = 0 at a whole-unit pitch", () => {
    assert.deepEqual(rowCentres(3, 10, 4), [-14, 0, 14]);
    assert.deepEqual(rowCentres(1, 10, 4), [0]);
    assert.deepEqual(rowCentres(0, 10, 4), []);
  });

  it("keeps the pitch a whole number of units, which is what makes stations swappable", () => {
    const centres = rowCentres(4, 7, 3);
    for (let index = 1; index < centres.length; index += 1) {
      assert.equal((centres[index] ?? 0) - (centres[index - 1] ?? 0), 10);
    }
  });
});

describe("a lane band distributes its stations by seq", () => {
  const layout = layoutOf("self-learning-loop");

  it("orders the row by `seq`, not by declaration", () => {
    const lane = layout.bands.find((band) => band.id === "process");
    assert.deepEqual(lane?.nodeIds, ["owner", "agent", "grader", "feedback"]);
    const xs = lane?.nodeIds.map((id) => nodeOf(layout, id).origin.x) ?? [];
    assert.deepEqual([...xs].sort((left, right) => left - right), xs);
  });

  it("reorders when `seq` does, and does not care what order the nodes were written in", () => {
    const spec = specOf("self-learning-loop");
    const reversed: IllustrationSceneSpec = {
      ...spec,
      nodes: [...spec.nodes].reverse(),
    };
    const other = layoutScene(reversed, { catalog: ILLUSTRATION_SCENE_CATALOG });
    assert.equal(
      nodeOf(other, "owner").origin.x,
      nodeOf(layout, "owner").origin.x,
      "a lane is ordered by seq, so rewriting the file in another order must not move anything",
    );
  });

  it("spaces adjacent stations by a whole number of grid units", () => {
    const xs = ["owner", "agent", "grader", "feedback"].map((id) => nodeOf(layout, id).origin.x);
    for (let index = 1; index < xs.length; index += 1) {
      const pitch = (xs[index] ?? 0) - (xs[index - 1] ?? 0);
      assert.equal(pitch % ISO_UNIT, 0, `pitch ${pitch} is not a whole number of grid units`);
      assert.ok(pitch >= LANE_GAP_UNITS * ISO_UNIT);
    }
  });

  it("stands every station in the band on the same baseline", () => {
    const lane = layout.bands.find((band) => band.id === "process");
    for (const id of lane?.nodeIds ?? []) {
      assert.equal(nodeOf(layout, id).origin.y, lane?.baseline);
    }
  });
});

describe("a hub band centres its nodes as one group", () => {
  const layout = layoutOf("self-learning-loop");

  it("puts the group's centre of mass on the scene's centre line", () => {
    const hub = layout.bands.find((band) => band.id === "shared");
    const xs = (hub?.nodeIds ?? []).map((id) => nodeOf(layout, id).origin.x);
    assert.equal(roundScene(xs.reduce((sum, x) => sum + x, 0) / xs.length), 0);
  });

  it("stacks below the lane above it, never overlapping", () => {
    const lane = layout.bands.find((band) => band.id === "process");
    const hub = layout.bands.find((band) => band.id === "shared");
    assert.ok((hub?.frame.y ?? 0) >= (lane?.frame.y ?? 0) + (lane?.frame.height ?? 0));
  });
});

// ── The ring ──────────────────────────────────────────────────────────────────────────────────────

describe("ringStationAngles — a ring of stations with gaps for the crossings", () => {
  // Worked by hand from the defaults, so the numbers below are a derivation rather than a recording.
  // Entry sits at 180 with a 30-degree gap, exit at 0 with a 30-degree gap, travelling clockwise:
  // the walk starts at 195, has 300 degrees of usable arc, and the exit gap begins 150 degrees along.
  // Four stations sit at 1/5, 2/5, 3/5 and 4/5 of the arc — 60, 120, 180, 240 — and the last two are
  // past the exit gap, so they are pushed a further 30 degrees on.
  const entry = { angle: 180, gap: 30 };
  const exit = { angle: 0, gap: 30 };

  it("places four clockwise stations where the arithmetic says", () => {
    assert.deepEqual(ringStationAngles(4, "cw", entry, exit), [255, 315, 45, 105]);
  });

  it("mirrors exactly when the travel direction reverses", () => {
    assert.deepEqual(
      ringStationAngles(4, "ccw", entry, exit),
      [...ringStationAngles(4, "cw", entry, exit)].reverse(),
    );
  });

  it("never puts a station inside either gap", () => {
    for (const count of [2, 3, 5, 8]) {
      for (const angle of ringStationAngles(count, "cw", entry, exit)) {
        const fromEntry = Math.min(Math.abs(angle - 180), 360 - Math.abs(angle - 180));
        const fromExit = Math.min(angle, 360 - angle);
        assert.ok(fromEntry >= 15, `station at ${angle} sits inside the entry gap`);
        assert.ok(fromExit >= 15, `station at ${angle} sits inside the exit gap`);
      }
    }
  });

  it("degrades rather than collapsing when the gaps ask for more than a circle has", () => {
    const angles = ringStationAngles(3, "cw", { angle: 180, gap: 200 }, { angle: 0, gap: 200 });
    assert.equal(angles.length, 3);
    assert.equal(new Set(angles).size, 3, "every station still gets its own angle");
  });

  it("honours an explicit entry angle", () => {
    const shifted = ringStationAngles(4, "cw", { angle: 90, gap: 30 }, { angle: 270, gap: 30 });
    assert.deepEqual(shifted, [165, 225, 315, 15]);
  });
});

describe("a cycle band lays its stations out as a ring", () => {
  const layout = layoutOf("run-turn-cycle");
  const loop = layout.bands.find((band) => band.id === "loop");

  it("carries the ring's own geometry, its direction and its lap counter", () => {
    assert.ok(loop?.ring);
    assert.equal(loop.ring.direction, "cw");
    assert.equal(loop.ring.counter, "turns");
    assert.equal(loop.ring.stationAngles.length, 4);
  });

  it("puts every station on the circle, at the radius the band reports", () => {
    for (const id of loop?.nodeIds ?? []) {
      const node = nodeOf(layout, id);
      const dx = node.origin.x - (loop?.ring?.centre.x ?? 0);
      const dy = node.origin.y - (loop?.ring?.centre.y ?? 0);
      assert.equal(roundScene(Math.hypot(dx, dy), 1), roundScene(loop?.ring?.radius ?? 0, 1));
    }
  });

  it("exposes `entry` and `exit` as endpoints — the band, not any one station", () => {
    assert.deepEqual(layout.endpoints["loop.entry"], loop?.ring?.entry);
    assert.deepEqual(layout.endpoints["loop.exit"], loop?.ring?.exit);
    assert.equal(
      Object.keys(layout.endpoints).some((key) => key.startsWith("process.")),
      false,
      "only a cycle band exposes endpoints",
    );
  });

  it("draws the slots the band DECLARES, even when fewer nodes reference it", () => {
    const spec = specOf("run-turn-cycle");
    const thinned: IllustrationSceneSpec = {
      ...spec,
      nodes: spec.nodes.filter((node) => node.id !== "observe" && node.id !== "append"),
      connectors: (spec.connectors ?? []).filter(
        (connector) => !connector.from.startsWith("append.") && !connector.to.startsWith("append."),
      ),
      steps: undefined,
    };
    const other = layoutScene(thinned, { catalog: ILLUSTRATION_SCENE_CATALOG });
    const ring = other.bands.find((band) => band.id === "loop")?.ring;
    assert.equal(ring?.stationAngles.length, 4, "the ring keeps the four slots the author asked for");
  });
});

// ── The escape hatches ────────────────────────────────────────────────────────────────────────────

describe("`attach` pins a node to a neighbour instead of sequencing it", () => {
  const layout = layoutOf("run-turn-cycle");

  it("hangs the pinned node directly below its anchor, at the attach gap", () => {
    const anchor = nodeOf(layout, "append");
    const pinned = nodeOf(layout, "meter");
    assert.equal(pinned.placement, "attached");
    assert.equal(pinned.origin.x, anchor.origin.x);
    assert.equal(
      pinned.frame.y,
      roundScene(anchor.frame.y + anchor.frame.height + ATTACH_GAP_UNITS * ISO_UNIT),
    );
  });

  it("stacks two nodes pinned to the same anchor rather than drawing them on top of each other", () => {
    const spec = specOf("run-turn-cycle");
    const stacked: IllustrationSceneSpec = {
      ...spec,
      nodes: [
        ...spec.nodes,
        { id: "second", component: "token-meter", band: "process", attach: "append" },
      ],
    };
    const other = layoutScene(stacked, { catalog: ILLUSTRATION_SCENE_CATALOG });
    const first = nodeOf(other, "meter");
    const second = nodeOf(other, "second");
    assert.ok(second.frame.y >= first.frame.y + first.frame.height);
  });

  it("resolves a chain, and simply leaves a circle unplaced rather than looping forever", () => {
    const spec = specOf("self-learning-loop");
    const chained = layoutScene(
      {
        ...spec,
        nodes: [
          ...spec.nodes,
          { id: "note-a", component: "file", band: "process", attach: "agent" },
          { id: "note-b", component: "file", band: "process", attach: "note-a" },
        ],
      },
      { catalog: ILLUSTRATION_SCENE_CATALOG },
    );
    assert.equal(nodeOf(chained, "note-b").placement, "attached");
    assert.ok(nodeOf(chained, "note-b").frame.y > nodeOf(chained, "note-a").frame.y);

    const circular = layoutScene(
      {
        ...spec,
        nodes: [
          ...spec.nodes,
          { id: "loop-a", component: "file", band: "process", attach: "loop-b" },
          { id: "loop-b", component: "file", band: "process", attach: "loop-a" },
        ],
      },
      { catalog: ILLUSTRATION_SCENE_CATALOG },
    );
    assert.equal(nodeOf(circular, "loop-a").placement, "unbanded");
    assert.equal(nodeOf(circular, "loop-b").placement, "unbanded");
  });
});

describe("an explicit `at` is the one coordinate escape hatch (D-IL7)", () => {
  const layout = layoutOf("run-turn-cycle");

  it("puts the node exactly where the spec says, in grid units", () => {
    const vault = nodeOf(layout, "vault");
    assert.equal(vault.placement, "explicit");
    assert.deepEqual(vault.origin, { x: 40 * ISO_UNIT, y: 8 * ISO_UNIT });
  });

  it("takes the node out of its band's distribution rather than shifting the row", () => {
    const spec = specOf("self-learning-loop");
    const pinnedOut = layoutScene(
      {
        ...spec,
        nodes: spec.nodes.map((node) =>
          node.id === "feedback" ? { ...node, at: { x: 60, y: 2 } } : node,
        ),
      },
      { catalog: ILLUSTRATION_SCENE_CATALOG },
    );
    const lane = pinnedOut.bands.find((band) => band.id === "process");
    assert.deepEqual(lane?.nodeIds, ["owner", "agent", "grader"]);
    assert.deepEqual(nodeOf(pinnedOut, "feedback").origin, { x: 60 * ISO_UNIT, y: 2 * ISO_UNIT });
  });
});

// ── Ports, canvas, robustness ─────────────────────────────────────────────────────────────────────

describe("port coordinates come from iso-math, not from a second geometry", () => {
  const layout = layoutOf("self-learning-loop");

  it("resolves every declared port, and none that is not declared", () => {
    const server = nodeOf(layout, "hub-mcp");
    const entry = ILLUSTRATION_REGISTRY.find((candidate) => candidate.id === "mcp-server");
    assert.deepEqual(Object.keys(server.ports).sort(), Object.keys(entry?.ports ?? {}).sort());
  });

  it("places a port where `portAnchor` + `project` put it, offset by the node's origin", () => {
    const server = nodeOf(layout, "hub-mcp");
    const entry = ILLUSTRATION_REGISTRY.find((candidate) => candidate.id === "mcp-server");
    const bus = entry?.ports.bus;
    assert.ok(bus);
    const local = projectPoint(portAnchor(bus, footprintUnits(server.size), server.heightUnits));
    assert.deepEqual(server.ports.bus, {
      x: roundScene(server.origin.x + local.x),
      y: roundScene(server.origin.y + local.y),
    });
  });

  it("keys `endpoints` exactly the way a connector writes them", () => {
    const spec = specOf("self-learning-loop");
    for (const connector of spec.connectors ?? []) {
      assert.ok(layout.endpoints[connector.from], `${connector.from} did not resolve`);
      assert.ok(layout.endpoints[connector.to], `${connector.to} did not resolve`);
    }
  });
});

describe("the canvas is fitted to the format's aspect and never crops", () => {
  it("matches the declared aspect", () => {
    for (const name of FIXTURE_NAMES) {
      const layout = layoutOf(name);
      assert.equal(
        roundScene(layout.canvas.width / layout.canvas.height, 4),
        roundScene(ILLUSTRATION_CANVAS_ASPECT[layout.canvas.format], 4),
      );
    }
  });

  it("contains every node, band and annotation it was given", () => {
    for (const name of FIXTURE_NAMES) {
      const layout = layoutOf(name);
      const { x, y, width, height } = layout.canvas;
      const boxes = [
        ...layout.nodes.map((node) => node.frame),
        ...layout.bands.map((band) => band.frame),
        ...layout.annotations.map((annotation) => annotation.frame),
      ];
      for (const box of boxes) {
        assert.ok(box.x >= x, `${name}: ${box.x} escapes the canvas on the left`);
        assert.ok(box.y >= y, `${name}: ${box.y} escapes the canvas at the top`);
        assert.ok(box.x + box.width <= x + width, `${name}: a box escapes on the right`);
        assert.ok(box.y + box.height <= y + height, `${name}: a box escapes at the bottom`);
      }
    }
  });

  it("spells the viewBox from the same four numbers it reports", () => {
    const layout = layoutOf("self-learning-loop");
    const { x, y, width, height, viewBox } = layout.canvas;
    assert.equal(viewBox, `${x} ${y} ${width} ${height}`);
  });
});

describe("the engine lays out what it is given, even when the catalog cannot help", () => {
  const spec: IllustrationSceneSpec = {
    version: 1,
    registryVersion: ILLUSTRATION_REGISTRY_VERSION,
    id: "broken",
    title: "A scene with a component that does not exist",
    summary: "A preview that renders and reports the error beats a blank page.",
    canvas: { format: "square", stage: "plain" },
    bands: [{ id: "row", kind: "lane" }],
    nodes: [
      { id: "real", component: "agent", band: "row", seq: 1 },
      { id: "ghost", component: "does-not-exist", band: "row", seq: 2 },
    ],
  };

  it("gives an uncatalogued component a fallback box and no ports, without throwing", () => {
    const layout = layoutScene(spec, { catalog: ILLUSTRATION_SCENE_CATALOG });
    const ghost = nodeOf(layout, "ghost");
    assert.equal(ghost.placement, "row");
    assert.deepEqual(ghost.ports, {});
    assert.ok(ghost.frame.width > 0 && ghost.frame.height > 0);
    assert.equal(nodeOf(layout, "real").ports.top !== undefined, true);
  });

  it("gives a node with no band, no anchor and no coordinates a row of its own", () => {
    const layout = layoutScene(
      { ...spec, nodes: [{ id: "orphan", component: "agent" }] },
      { catalog: ILLUSTRATION_SCENE_CATALOG },
    );
    const orphan = nodeOf(layout, "orphan");
    assert.equal(orphan.placement, "unbanded");
    assert.equal(orphan.origin.x, 0);
  });

  it("produces a usable canvas for a scene with a single node", () => {
    const layout = layoutScene(
      { ...spec, nodes: [{ id: "only", component: "agent", band: "row" }] },
      { catalog: ILLUSTRATION_SCENE_CATALOG },
    );
    assert.ok(layout.canvas.width > 0);
    assert.ok(layout.canvas.height > 0);
  });
});

describe("roundScene", () => {
  it("rounds to three places and normalizes negative zero", () => {
    assert.equal(roundScene(13.856406460551018), 13.856);
    assert.equal(roundScene(-0.0001), 0);
    assert.ok(Object.is(roundScene(-0), 0));
  });
});
