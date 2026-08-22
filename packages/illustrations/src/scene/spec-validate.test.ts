import {
  ILLUSTRATION_REGISTRY_VERSION,
  type IllustrationRegistryEntry,
  type IllustrationSceneSpec,
} from "@mcp-token-footprint/shared";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ILLUSTRATION_REGISTRY } from "../registry.js";
import { readRunFlowExemplar, readSceneFixture } from "./fixtures.js";
import {
  SCENE_ISSUE_CODES,
  SCENE_ROOT_PATH,
  type SceneIssue,
  type SceneIssueCode,
  formatScenePath,
  isRegistryVersionAhead,
  parseScene,
  splitEndpoint,
  validateScene,
} from "./spec-validate.js";

// The validator's whole job is the questions the zod schema CANNOT ask, so every test here names one
// and shows the path it comes back on. Two things are pinned that are easy to lose later: that a
// shape failure does not silence a reference failure, and that nothing here throws — not on `null`,
// not on a string, not on a spec that is half-written.

const codes = (issues: readonly SceneIssue[]): SceneIssueCode[] => issues.map((issue) => issue.code);
const paths = (issues: readonly SceneIssue[]): string[] => issues.map((issue) => issue.path);
const only = (issues: readonly SceneIssue[], code: SceneIssueCode): SceneIssue[] =>
  issues.filter((issue) => issue.code === code);

/** A tiny catalog, so a test states what it depends on instead of inheriting twenty-four entries. */
const TEST_REGISTRY: IllustrationRegistryEntry[] = [
  {
    id: "widget",
    title: "Widget",
    entity: null,
    tier: 1,
    keywords: ["widget"],
    variants: ["plain", "fancy"],
    states: ["idle", "active"],
    ports: { top: { title: "Top", side: "top" }, feed: { title: "Feed", side: "left" } },
    sizes: ["m", "l"],
    since: "0.1.0",
    description: "A widget.",
  },
];

const base: IllustrationSceneSpec = {
  version: 1,
  registryVersion: ILLUSTRATION_REGISTRY_VERSION,
  id: "fixture",
  title: "Fixture",
  summary: "A minimal scene used to isolate one validator question at a time.",
  canvas: { format: "square", stage: "plain" },
  bands: [{ id: "row", kind: "lane" }],
  nodes: [{ id: "one", component: "widget", band: "row", seq: 1 }],
};

const check = (spec: unknown, registry = TEST_REGISTRY): SceneIssue[] =>
  validateScene(spec, registry);

describe("validateScene — the catalog questions the schema cannot ask", () => {
  it("passes a scene whose every reference resolves", () => {
    assert.deepEqual(check(base), []);
  });

  it("names a component the catalog does not have, at the node's own path", () => {
    const issues = check({ ...base, nodes: [{ id: "one", component: "sprocket", band: "row" }] });
    assert.deepEqual(codes(issues), ["unknown-component"]);
    assert.deepEqual(paths(issues), ["nodes[0].component"]);
    assert.equal(issues[0]?.value, "sprocket");
  });

  it("rejects a variant, a state and a size the entry does not declare", () => {
    const issues = check({
      ...base,
      nodes: [
        { id: "one", component: "widget", band: "row", variant: "sparkly" },
        { id: "two", component: "widget", band: "row", state: "error" },
        { id: "three", component: "widget", band: "row", size: "s" },
      ],
    });
    assert.deepEqual(codes(issues), ["unknown-variant", "unknown-state", "unknown-size"]);
    assert.deepEqual(paths(issues), [
      "nodes[0].variant",
      "nodes[1].state",
      "nodes[2].size",
    ]);
  });

  it("rejects a port the component does not expose, and says which it does", () => {
    const issues = check({
      ...base,
      connectors: [{ from: "one.top", to: "one.exhaust", kind: "flow" }],
    });
    assert.deepEqual(codes(issues), ["unknown-port"]);
    assert.deepEqual(paths(issues), ["connectors[0].to"]);
    assert.match(issues[0]?.message ?? "", /feed, top/);
  });

  it("rejects an endpoint naming no node", () => {
    const issues = check({
      ...base,
      connectors: [{ from: "nobody.top", to: "one.top", kind: "flow" }],
    });
    assert.deepEqual(codes(issues), ["unknown-node"]);
    assert.deepEqual(paths(issues), ["connectors[0].from"]);
  });

  it("does not pile port errors on top of an unknown component — one finding, not five", () => {
    const issues = check({
      ...base,
      nodes: [{ id: "one", component: "sprocket", band: "row" }],
      connectors: [{ from: "one.nowhere", to: "one.nohow", kind: "flow" }],
    });
    assert.deepEqual(codes(issues), ["unknown-component"]);
  });

  it("rejects a band reference that names no band, on a node and on an annotation", () => {
    const issues = check({
      ...base,
      nodes: [{ id: "one", component: "widget", band: "ghost" }],
      annotations: [{ kind: "callout", band: "phantom", body: "Where am I?" }],
    });
    assert.deepEqual(codes(issues), ["unknown-band", "unknown-band"]);
    assert.deepEqual(paths(issues), ["nodes[0].band", "annotations[0].band"]);
  });

  it("reaches a cycle band through entry and exit, and refuses any other member", () => {
    const cycleSpec = {
      ...base,
      bands: [
        { id: "row", kind: "lane" },
        { id: "loop", kind: "cycle", stations: 2, direction: "cw", counter: "turns" },
      ],
      nodes: [
        { id: "one", component: "widget", band: "loop", seq: 1 },
        { id: "two", component: "widget", band: "loop", seq: 2 },
      ],
    };
    assert.deepEqual(
      check({
        ...cycleSpec,
        connectors: [
          { from: "one.top", to: "loop.entry", kind: "flow" },
          { from: "loop.exit", to: "two.top", kind: "flow" },
        ],
      }),
      [],
    );
    const wrongGate = check({
      ...cycleSpec,
      connectors: [{ from: "one.top", to: "loop.middle", kind: "flow" }],
    });
    assert.deepEqual(codes(wrongGate), ["unknown-port"]);
    assert.match(wrongGate[0]?.message ?? "", /entry and exit/);
  });

  it("refuses to treat a lane or hub band as an endpoint — only a ring has gates", () => {
    const issues = check({
      ...base,
      connectors: [{ from: "row.entry", to: "one.top", kind: "flow" }],
    });
    assert.deepEqual(codes(issues), ["unknown-node"]);
    assert.match(issues[0]?.message ?? "", /lane band, not a node/);
  });

  it("rejects a step focusing a node, or spotlighting a connector, that is not there", () => {
    const issues = check({
      ...base,
      connectors: [{ id: "c1", from: "one.top", to: "one.feed", kind: "loop" }],
      steps: [
        { focus: ["one", "ghost"], connectors: ["c1", "c9"], caption: "Half of this is real." },
      ],
    });
    assert.deepEqual(codes(issues), ["unknown-node", "unknown-connector"]);
    assert.deepEqual(paths(issues), ["steps[0].focus[1]", "steps[0].connectors[1]"]);
  });

  it("rejects an annotation target that resolves to nothing, in both spellings", () => {
    const byId = check({ ...base, annotations: [{ kind: "callout", target: "ghost" }] });
    assert.deepEqual(codes(byId), ["unknown-node"]);
    assert.deepEqual(paths(byId), ["annotations[0].target"]);
    const byPort = check({ ...base, annotations: [{ kind: "callout", target: "one.exhaust" }] });
    assert.deepEqual(codes(byPort), ["unknown-port"]);
  });

  it("catches a duplicated band, node and connector id", () => {
    const issues = check({
      ...base,
      bands: [
        { id: "row", kind: "lane" },
        { id: "row", kind: "hub" },
      ],
      nodes: [
        { id: "one", component: "widget", band: "row" },
        { id: "one", component: "widget", band: "row" },
      ],
      connectors: [
        { id: "c1", from: "one.top", to: "one.feed", kind: "flow" },
        { id: "c1", from: "one.feed", to: "one.top", kind: "flow" },
      ],
    });
    assert.deepEqual(codes(issues), [
      "duplicate-band-id",
      "duplicate-node-id",
      "duplicate-connector-id",
    ]);
    assert.deepEqual(paths(issues), ["bands[1].id", "nodes[1].id", "connectors[1].id"]);
  });

  it("rejects an `attach` naming no node, and an attach chain that goes round in a circle", () => {
    const missing = check({
      ...base,
      nodes: [{ id: "one", component: "widget", band: "row", attach: "ghost" }],
    });
    assert.deepEqual(codes(missing), ["unknown-attach"]);
    assert.deepEqual(paths(missing), ["nodes[0].attach"]);

    const circle = check({
      ...base,
      nodes: [
        { id: "one", component: "widget", band: "row", attach: "two" },
        { id: "two", component: "widget", band: "row", attach: "one" },
      ],
    });
    assert.deepEqual(codes(circle), ["attach-cycle", "attach-cycle"]);

    // A node pinned to a node that is itself pinned is FINE — the chain just has to end somewhere.
    assert.deepEqual(
      check({
        ...base,
        nodes: [
          { id: "one", component: "widget", band: "row", seq: 1 },
          { id: "two", component: "widget", band: "row", attach: "one" },
          { id: "three", component: "widget", band: "row", attach: "two" },
        ],
      }),
      [],
    );
  });

  it("reports a cycle band whose declared station count disagrees with its nodes", () => {
    const issues = check({
      ...base,
      bands: [{ id: "loop", kind: "cycle", stations: 4, direction: "ccw" }],
      nodes: [
        { id: "one", component: "widget", band: "loop", seq: 1 },
        { id: "two", component: "widget", band: "loop", seq: 2 },
      ],
    });
    assert.deepEqual(codes(issues), ["cycle-station-count"]);
    assert.deepEqual(paths(issues), ["bands[0].stations"]);
    assert.match(issues[0]?.message ?? "", /declares 4 stations but 2 node\(s\)/);
  });
});

describe("validateScene — registryVersion is a flag, not a break (D-IL9 / amended D-IL12)", () => {
  it("compares major and minor only, and a patch is never ahead", () => {
    assert.equal(isRegistryVersionAhead("0.1.0", "0.1.0"), false);
    assert.equal(isRegistryVersionAhead("0.0.9", "0.1.0"), false);
    assert.equal(isRegistryVersionAhead("0.1.9", "0.1.0"), false, "a patch bump is not ahead");
    assert.equal(isRegistryVersionAhead("0.2.0", "0.1.0"), true);
    assert.equal(isRegistryVersionAhead("1.0.0", "0.9.9"), true);
    assert.equal(isRegistryVersionAhead("nonsense", "0.1.0"), false);
  });

  it("flags a scene authored against a newer catalog, and stays silent on an older one", () => {
    const ahead = check({ ...base, registryVersion: "9.9.9" });
    assert.deepEqual(codes(ahead), ["registry-version-ahead"]);
    assert.deepEqual(paths(ahead), ["registryVersion"]);
    assert.deepEqual(check({ ...base, registryVersion: "0.0.1" }), []);
  });
});

describe("validateScene — a shape failure never silences a reference failure", () => {
  it("reports both, and the reference issues survive an unknown top-level key", () => {
    const issues = check({
      ...base,
      theme: "blueprint",
      nodes: [{ id: "one", component: "sprocket", band: "row" }],
    });
    assert.deepEqual(codes(issues), ["schema", "unknown-component"]);
    assert.deepEqual(paths(issues), [SCENE_ROOT_PATH, "nodes[0].component"]);
  });
});

describe("validateScene — it does not throw, whatever it is handed", () => {
  const hostile: unknown[] = [
    undefined,
    null,
    0,
    "",
    "not a scene at all",
    [],
    [1, 2, 3],
    {},
    { version: 1 },
    { ...base, bands: "not an array" },
    { ...base, nodes: [null, 7, "nope", { id: 4 }, { component: [] }] },
    { ...base, connectors: [{ from: 1, to: {}, kind: null }] },
    { ...base, annotations: "no", steps: 12 },
    { ...base, steps: [{ focus: [null, 3], connectors: [{}] }] },
    { ...base, registryVersion: {} },
    { ...base, bands: [{ id: "row", kind: "cycle" }] },
  ];

  for (const [index, input] of hostile.entries()) {
    it(`survives hostile input #${index}`, () => {
      const issues = check(input);
      assert.ok(Array.isArray(issues));
      for (const issue of issues) {
        assert.ok((SCENE_ISSUE_CODES as readonly string[]).includes(issue.code));
        assert.equal(typeof issue.path, "string");
        assert.ok(issue.message.length > 0);
      }
    });
  }

  it("survives a self-referencing object, which JSON could not even print", () => {
    const circular: Record<string, unknown> = { ...base };
    circular.self = circular;
    assert.ok(Array.isArray(check(circular)));
  });
});

describe("parseScene — a typed spec only when there is nothing wrong with it", () => {
  it("returns the parsed spec when the scene is clean", () => {
    const result = parseScene(base, TEST_REGISTRY);
    assert.deepEqual(result.issues, []);
    assert.equal(result.spec?.id, "fixture");
  });

  it("returns null — not a cast — when a reference does not resolve", () => {
    const result = parseScene(
      { ...base, nodes: [{ id: "one", component: "sprocket", band: "row" }] },
      TEST_REGISTRY,
    );
    assert.equal(result.spec, null);
    assert.deepEqual(codes(result.issues), ["unknown-component"]);
  });
});

describe("the path and endpoint helpers", () => {
  it("spells a path the way the JSON reads, and names the document `<root>`", () => {
    assert.equal(formatScenePath(["nodes", 3, "component"]), "nodes[3].component");
    assert.equal(formatScenePath(["steps", 0, "focus", 2]), "steps[0].focus[2]");
    assert.equal(formatScenePath([]), SCENE_ROOT_PATH);
  });

  it("splits an endpoint at the first dot, and refuses the shapes that are not one", () => {
    assert.deepEqual(splitEndpoint("agent.context-in"), { owner: "agent", member: "context-in" });
    for (const bad of ["agent", ".bus", "agent.", ""]) {
      assert.equal(splitEndpoint(bad), undefined, `expected ${JSON.stringify(bad)} to be refused`);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// The NEGATIVE fixture, and the reason it is one.
//
// `examples/run-flow.scene.json` is the document that discovered the `cycle` band — its own
// `$comment` says the lane/hub grammar cannot express an execution loop, which is why WP 2.1 has a
// ring at all. It is also a DRAFT, written before a single entity existed, and it names nine
// components that were never built. The correct behaviour is to report exactly those nine and no
// more, and the correct thing NOT to do is invent nine entities so a fixture goes green.
// ══════════════════════════════════════════════════════════════════════════════════════════════════

describe("the run-flow exemplar — the band grammar's source, and a negative fixture", () => {
  const issues = validateScene(readRunFlowExemplar(), ILLUSTRATION_REGISTRY);

  it("reports exactly the nine components it names that the catalog does not have", () => {
    assert.deepEqual(
      only(issues, "unknown-component").map((issue) => issue.value),
      [
        "person",
        "plan-card",
        "station-decide",
        "station-tool-call",
        "station-observe",
        "station-append",
        "context-stack",
        "summarizer",
        "answer-card",
      ],
    );
  });

  it("finds no OTHER reference problem — its bands, ports and steps are all coherent", () => {
    const references = issues.filter((issue) => issue.code !== "schema");
    assert.deepEqual(
      references.map((issue) => issue.code),
      Array.from({ length: 9 }, () => "unknown-component"),
      `unexpected non-schema issues: ${JSON.stringify(references.filter((issue) => issue.code !== "unknown-component"))}`,
    );
  });

  it("reaches its cycle band's gates without a node — `loop.entry` and `loop.exit` resolve", () => {
    // c4 targets `loop.entry` and c7 leaves from `loop.exit`. Neither is a node; both are the ring's
    // own crossings, and neither appears above. That is the `cycle` band earning its place.
    assert.equal(
      issues.some((issue) => issue.value === "loop.entry" || issue.value === "loop.exit"),
      false,
    );
  });

  it("is still a DRAFT, and says so — the schema issues are recorded, not hidden", () => {
    // Pinned rather than merely allowed: if somebody modernizes the exemplar these go green, and the
    // list should say what changed rather than quietly shrinking.
    assert.deepEqual(
      only(issues, "schema").map((issue) => `${issue.path}: ${issue.message}`),
      [
        "registryVersion: a registry version is a plain major.minor.patch triple",
        "connectors[1]: Unrecognized key(s) in object: 'phase'",
        "connectors[2]: Unrecognized key(s) in object: 'dashed', 'phase'",
        "annotations[1].kind: Invalid enum value. Expected 'callout' | 'principle-card', received 'caption'",
        "annotations[1]: Unrecognized key(s) in object: 'text'",
        `${SCENE_ROOT_PATH}: Unrecognized key(s) in object: '$comment'`,
      ],
    );
  });

  it("cannot be parsed into a spec, which is the honest answer", () => {
    assert.equal(parseScene(readRunFlowExemplar(), ILLUSTRATION_REGISTRY).spec, null);
  });
});

describe("the shipped positive fixtures validate against the live catalog", () => {
  for (const name of ["self-learning-loop", "run-turn-cycle"]) {
    it(`${name} names only components, ports, bands and steps that exist`, () => {
      assert.deepEqual(validateScene(readSceneFixture(name), ILLUSTRATION_REGISTRY), []);
    });
  }
});
