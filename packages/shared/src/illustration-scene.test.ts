import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ILLUSTRATION_REGISTRY_VERSION } from "./illustration-registry.js";
import {
  ILLUSTRATION_ANNOTATION_KINDS,
  ILLUSTRATION_BAND_KINDS,
  ILLUSTRATION_CANVAS_FORMATS,
  ILLUSTRATION_CYCLE_DIRECTIONS,
  ILLUSTRATION_NODE_DEFAULTS,
  ILLUSTRATION_SCENE_SPEC_VERSION,
  ILLUSTRATION_STAGE_KINDS,
  type IllustrationSceneSpec,
  illustrationSceneSpecSchema,
} from "./illustration-scene.js";

// Same job as the registry tests: WP 0.1's scene module renders nothing, so what is testable is the
// ENVELOPE it fixes (D-IL10) and the closed grammars it refuses to let a spec escape (D-IL8). The
// deliberately-loose parts are asserted as loose ON PURPOSE — a test here that started resolving
// node ids or port existence would be WP 2.1 work smuggled in, and the comments say so.

const FROZEN_CANVAS_FORMATS = ["hero_wide", "ultra", "square"];
const FROZEN_STAGE_KINDS = ["paper", "plain"];
const FROZEN_BAND_KINDS = ["lane", "hub", "annotations", "cycle"];
const FROZEN_ANNOTATION_KINDS = ["callout", "principle-card"];
const FROZEN_CYCLE_DIRECTIONS = ["cw", "ccw"];

/**
 * A spec exercising every array, modelled on the design's self-learning-agentic-loop example, so a
 * shape regression in any of them is a red test rather than a surprise in WP 2.1.
 */
const VALID_SPEC: IllustrationSceneSpec = {
  version: ILLUSTRATION_SCENE_SPEC_VERSION,
  registryVersion: ILLUSTRATION_REGISTRY_VERSION,
  id: "self-learning-agentic-loop",
  title: "Self-Learning Agentic Loop",
  summary: "Six steps sharing one MCP server and one Skill, feeding results back as a new version.",
  canvas: { format: "hero_wide", stage: "paper" },
  bands: [
    { id: "process", kind: "lane", title: "The loop" },
    { id: "shared", kind: "hub" },
    { id: "notes", kind: "annotations" },
  ],
  nodes: [
    {
      id: "agent",
      component: "agent",
      band: "process",
      seq: 1,
      title: "Primary LLM",
      caption: "Accesses the shared MCP server and Skill",
      state: "active",
      size: "m",
      detail: "standard",
      facing: "upstream",
    },
    { id: "hub-mcp", component: "mcp-server", band: "shared", variant: "stdio" },
    { id: "hub-skill", component: "skill", band: "shared", at: { x: 12, y: -4 } },
  ],
  connectors: [
    {
      id: "c1",
      from: "hub-mcp.bus",
      to: "agent.context-in",
      kind: "read",
      label: "provides MCP tools and the current Skill",
    },
    { from: "agent.result-out", to: "hub-skill.top", kind: "write" },
  ],
  annotations: [
    {
      kind: "principle-card",
      band: "notes",
      align: "start",
      title: "The loop principle",
      items: ["Execute with context", "Feed the result back"],
      target: "hub-skill.top",
    },
  ],
  steps: [
    {
      focus: ["agent", "hub-mcp", "hub-skill"],
      connectors: ["c1"],
      caption: "The agent loads the current Skill and the MCP tool surface.",
      detail: "cutaway",
    },
  ],
};

describe("illustration scene — closed vocabularies (D-IL8)", () => {
  it("freezes the three canvas formats", () => {
    assert.deepEqual([...ILLUSTRATION_CANVAS_FORMATS], FROZEN_CANVAS_FORMATS);
  });

  it("freezes the two stage kinds — the grid on/off half of the canvas line", () => {
    assert.deepEqual([...ILLUSTRATION_STAGE_KINDS], FROZEN_STAGE_KINDS);
  });

  it("freezes the four band kinds, cycle included (WP 2.1 owns their layout, not their names)", () => {
    assert.deepEqual([...ILLUSTRATION_BAND_KINDS], FROZEN_BAND_KINDS);
  });

  it("freezes the two annotation card kinds", () => {
    assert.deepEqual([...ILLUSTRATION_ANNOTATION_KINDS], FROZEN_ANNOTATION_KINDS);
  });

  it("pins the documented node defaults (D-IL16, D-IL17)", () => {
    assert.deepEqual(ILLUSTRATION_NODE_DEFAULTS, {
      detail: "standard",
      facing: "upstream",
      state: "idle",
    });
  });
});

describe("illustrationSceneSpecSchema — round trip", () => {
  it("parses a complete spec unchanged", () => {
    const parsed = illustrationSceneSpecSchema.parse(VALID_SPEC);
    assert.deepEqual(parsed, VALID_SPEC);
  });

  it("parses the minimum viable spec: envelope plus one node", () => {
    const minimal = {
      version: ILLUSTRATION_SCENE_SPEC_VERSION,
      registryVersion: ILLUSTRATION_REGISTRY_VERSION,
      id: "scan-pipeline",
      title: "Scan pipeline",
      summary: "How a discovery scan reaches a token footprint.",
      canvas: { format: "square", stage: "plain" },
      bands: [{ id: "process", kind: "lane" }],
      nodes: [{ id: "scan", component: "scan" }],
    };
    assert.equal(illustrationSceneSpecSchema.safeParse(minimal).success, true);
  });

  // TIGHTENED BY WP 2.1, and this is the assertion that records it. Before the layout engine
  // existed `bands` was optional, which was honest then and is not now: a node names the band it
  // belongs to, and a scene with nodes and no band has nowhere to put them.
  it("rejects a spec with no bands — bands are the composition (WP 2.1)", () => {
    const { bands: _dropped, ...withoutBands } = VALID_SPEC;
    assert.equal(illustrationSceneSpecSchema.safeParse(withoutBands).success, false);
    assert.equal(illustrationSceneSpecSchema.safeParse({ ...VALID_SPEC, bands: [] }).success, false);
  });
});

describe("illustrationSceneSpecSchema — the cycle band (WP 2.1)", () => {
  const withBands = (bands: unknown) => illustrationSceneSpecSchema.safeParse({
    ...VALID_SPEC,
    bands,
    nodes: [{ id: "agent", component: "agent", band: "loop", seq: 1 }],
    connectors: [],
    annotations: [],
    steps: [{ focus: ["agent"], caption: "One lap." }],
  });

  it("freezes the two travel directions", () => {
    assert.deepEqual([...ILLUSTRATION_CYCLE_DIRECTIONS], FROZEN_CYCLE_DIRECTIONS);
  });

  it("accepts the exemplar's ring — stations, direction and a lap counter", () => {
    const result = withBands([
      { id: "loop", kind: "cycle", stations: 4, direction: "cw", counter: "turns" },
    ]);
    assert.equal(result.success, true);
  });

  it("accepts explicit entry and exit gates", () => {
    const result = withBands([
      {
        id: "loop",
        kind: "cycle",
        stations: 3,
        direction: "ccw",
        counter: "retries",
        entry: { angle: 200, gap: 24 },
        exit: { angle: 20 },
      },
    ]);
    assert.equal(result.success, true);
  });

  it("refuses a ring with no station count and a ring with no direction", () => {
    assert.equal(withBands([{ id: "loop", kind: "cycle", direction: "cw" }]).success, false);
    assert.equal(withBands([{ id: "loop", kind: "cycle", stations: 4 }]).success, false);
  });

  it("refuses a one-station ring and an unknown direction", () => {
    assert.equal(
      withBands([{ id: "loop", kind: "cycle", stations: 1, direction: "cw" }]).success,
      false,
    );
    assert.equal(
      withBands([{ id: "loop", kind: "cycle", stations: 4, direction: "widdershins" }]).success,
      false,
    );
  });

  // The discriminated union earning its keep: a ring's four fields are not merely optional
  // elsewhere, they are unspellable elsewhere.
  it("refuses ring fields on a lane — the union is discriminated, not a bag of optionals", () => {
    assert.equal(
      withBands([{ id: "loop", kind: "lane", stations: 4, direction: "cw" }]).success,
      false,
    );
    assert.equal(withBands([{ id: "loop", kind: "hub", counter: "turns" }]).success, false);
  });
});

describe("illustrationSceneSpecSchema — a11y is schema-enforced (D-IL10)", () => {
  it("rejects a spec with no title", () => {
    const { title: _dropped, ...withoutTitle } = VALID_SPEC;
    assert.equal(illustrationSceneSpecSchema.safeParse(withoutTitle).success, false);
  });

  it("rejects an empty summary — the text alternative cannot be blank", () => {
    assert.equal(
      illustrationSceneSpecSchema.safeParse({ ...VALID_SPEC, summary: "" }).success,
      false,
    );
  });

  it("rejects a step with no caption — that is silence in the aria-live region", () => {
    const result = illustrationSceneSpecSchema.safeParse({
      ...VALID_SPEC,
      steps: [{ focus: ["agent"] }],
    });
    assert.equal(result.success, false);
  });
});

describe("illustrationSceneSpecSchema — a spec cannot go off-brand (D-IL8)", () => {
  it("rejects an unknown top-level key (.strict())", () => {
    assert.equal(
      illustrationSceneSpecSchema.safeParse({ ...VALID_SPEC, theme: "blueprint" }).success,
      false,
    );
  });

  it("rejects a raw style on a node — there is no field to put one in", () => {
    const result = illustrationSceneSpecSchema.safeParse({
      ...VALID_SPEC,
      nodes: [{ id: "agent", component: "agent", fill: "var(--primary)" }],
    });
    assert.equal(result.success, false);
  });

  it("rejects a raw style on a connector", () => {
    const result = illustrationSceneSpecSchema.safeParse({
      ...VALID_SPEC,
      connectors: [{ from: "a.top", to: "b.top", kind: "flow", stroke: "2px" }],
    });
    assert.equal(result.success, false);
  });

  it("rejects an unknown connector kind", () => {
    const result = illustrationSceneSpecSchema.safeParse({
      ...VALID_SPEC,
      connectors: [{ from: "a.top", to: "b.top", kind: "sync" }],
    });
    assert.equal(result.success, false);
  });

  it("rejects an unknown canvas format and an unknown stage", () => {
    assert.equal(
      illustrationSceneSpecSchema.safeParse({
        ...VALID_SPEC,
        canvas: { format: "portrait", stage: "paper" },
      }).success,
      false,
    );
    assert.equal(
      illustrationSceneSpecSchema.safeParse({
        ...VALID_SPEC,
        canvas: { format: "square", stage: "graph" },
      }).success,
      false,
    );
  });

  it("rejects an unknown band kind and an unknown annotation kind", () => {
    assert.equal(
      illustrationSceneSpecSchema.safeParse({
        ...VALID_SPEC,
        bands: [{ id: "process", kind: "column" }],
      }).success,
      false,
    );
    assert.equal(
      illustrationSceneSpecSchema.safeParse({
        ...VALID_SPEC,
        annotations: [{ kind: "sticky-note" }],
      }).success,
      false,
    );
  });

  it("rejects an unknown entity state on a node", () => {
    const result = illustrationSceneSpecSchema.safeParse({
      ...VALID_SPEC,
      nodes: [{ id: "agent", component: "agent", state: "pulsing" }],
    });
    assert.equal(result.success, false);
  });
});

describe("illustrationSceneSpecSchema — connectors attach to ports (D-IL7)", () => {
  it("rejects an endpoint that is not `nodeId.port`", () => {
    for (const from of ["agent", "agent.", ".bus", "agent.bus.extra", "Agent.bus", "12,40"]) {
      assert.equal(
        illustrationSceneSpecSchema.safeParse({
          ...VALID_SPEC,
          connectors: [{ from, to: "hub-skill.top", kind: "flow" }],
        }).success,
        false,
        `expected the endpoint ${JSON.stringify(from)} to be rejected`,
      );
    }
  });

  it("lets a node be pinned to another node instead of sequenced (`attach`, WP 2.1)", () => {
    const result = illustrationSceneSpecSchema.safeParse({
      ...VALID_SPEC,
      nodes: [
        { id: "agent", component: "agent", band: "process", seq: 1 },
        { id: "plan", component: "prompt", band: "process", attach: "agent" },
      ],
      connectors: [],
      steps: [{ focus: ["agent"], caption: "The agent drafts a plan." }],
    });
    assert.equal(result.success, true);
    // Still SHAPE only: that `agent` exists is the WP 2.1 validator's question, not the parser's.
    assert.equal(
      illustrationSceneSpecSchema.safeParse({
        ...VALID_SPEC,
        nodes: [{ id: "plan", component: "prompt", attach: "nobody-at-all" }],
        connectors: [],
        steps: [{ focus: ["plan"], caption: "Pinned to a node that is not here." }],
      }).success,
      true,
    );
  });

  it("keeps the one sanctioned coordinate escape hatch: a per-node `at` override", () => {
    const result = illustrationSceneSpecSchema.safeParse({
      ...VALID_SPEC,
      nodes: [{ id: "agent", component: "agent", at: { x: 4, y: 8 } }],
    });
    assert.equal(result.success, true);
  });
});

describe("illustrationSceneSpecSchema — versioning (D-IL9)", () => {
  it("rejects a spec claiming a format version this build does not implement", () => {
    assert.equal(
      illustrationSceneSpecSchema.safeParse({ ...VALID_SPEC, version: 2 }).success,
      false,
    );
  });

  it("rejects a registryVersion that is not a plain version triple", () => {
    assert.equal(
      illustrationSceneSpecSchema.safeParse({ ...VALID_SPEC, registryVersion: "latest" }).success,
      false,
    );
  });

  it("accepts a registryVersion older than this build's — flag, do not break", () => {
    assert.equal(
      illustrationSceneSpecSchema.safeParse({ ...VALID_SPEC, registryVersion: "0.0.1" }).success,
      true,
    );
  });
});

describe("illustrationSceneSpecSchema — the WP 2.1 boundary", () => {
  // These assertions record what this stub deliberately does NOT do. When WP 2.1 lands the
  // validator, these flip — and flipping them is the sign the boundary moved on purpose.
  it("does not resolve `component` against the registry", () => {
    const result = illustrationSceneSpecSchema.safeParse({
      ...VALID_SPEC,
      nodes: [{ id: "agent", component: "component-that-does-not-exist" }],
    });
    assert.equal(result.success, true);
  });

  it("does not check that a connector's node ids or ports exist", () => {
    const result = illustrationSceneSpecSchema.safeParse({
      ...VALID_SPEC,
      connectors: [{ from: "nobody.nowhere", to: "nothing.nohow", kind: "flow" }],
    });
    assert.equal(result.success, true);
  });

  it("does not check that a step focuses declared nodes", () => {
    const result = illustrationSceneSpecSchema.safeParse({
      ...VALID_SPEC,
      steps: [{ focus: ["ghost"], caption: "A node that is not in this scene." }],
    });
    assert.equal(result.success, true);
  });
});
