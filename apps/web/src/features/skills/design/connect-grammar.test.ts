import { describe, expect, it } from "vitest";
import {
  SKILL_GRAPH_NODE_KINDS,
  type BoundTool,
  type SkillGraph,
  type SkillGraphNode,
  type SkillGraphNodeKind,
} from "@mcp-token-footprint/shared";
import {
  isConnectionOfferable,
  resolveConnection,
  type ConnectResolution,
} from "./connect-grammar";
import { explainerFor } from "./code-intel/explainers";
import { PREVIEW_NODE_PREFIX } from "./use-edit-ops";

// RM-30 WP 7.8, design decision 4. The rule the build is held to, verbatim from the design doc:
// **no message that only says an action failed.** Every refusal either offers the correct move or
// names the rule that was broken — and that is asserted over the whole message SET below, not by
// spot-checking two cases.

const BOUND_TOOLS: BoundTool[] = [
  {
    serverId: "srv1",
    serverName: "acme",
    toolName: "acme_search",
    schemaParams: [],
    definitionTokens: 900,
  },
];

function node(
  id: string,
  kind: SkillGraphNodeKind,
  line: number,
  extra: Record<string, unknown> = {},
): SkillGraphNode {
  return {
    id,
    kind,
    label: id,
    anchor: { headingPath: [id], startLine: line, endLine: line + 1 },
    source: "inferred",
    ...extra,
  } as SkillGraphNode;
}

/** One node of every kind, wired so each accessory hangs off a section that owns it. */
function fullGraph(): SkillGraph {
  return {
    nodes: [
      node("cmd", "entry_point", 1, { trigger: { type: "command", value: "/go" } }),
      node("step", "subroutine", 3),
      node("other-step", "subroutine", 5),
      node("decide", "gatekeeper", 7),
      // An INFERRED gate box: it hangs off `decide`, so its label is the script's basename and its
      // anchor is the OWNING section's heading path — not its own. That is what makes it an
      // accessory rather than a section, and the grammar has to tell the two apart.
      {
        id: "gate",
        kind: "validation_gate",
        label: "check.py",
        anchor: { headingPath: ["decide"], startLine: 7, endLine: 8 },
        source: "inferred",
        script: "scripts/check.py",
        expectation: "exits 0",
      },
      node("spec", "asset", 11, { path: "reference/spec.md", fileKind: "reference" }),
      node("notes", "asset", 13, { path: "reference/notes.md", fileKind: "reference" }),
      node("loop", "loop_guard", 15),
      node("search", "tool_ref", 17, { toolName: "acme_search" }),
      node("render", "tool_ref", 19, { toolName: "acme_render" }),
    ],
    edges: [
      { id: "e1", from: "cmd", to: "step", kind: "triggers" },
      { id: "e2", from: "step", to: "other-step", kind: "then" },
      { id: "e3", from: "step", to: "spec", kind: "uses" },
      { id: "e4", from: "other-step", to: "notes", kind: "uses" },
      { id: "e5", from: "other-step", to: "search", kind: "uses" },
      { id: "e6", from: "step", to: "render", kind: "uses" },
      { id: "e7", from: "step", to: "loop", kind: "uses" },
      { id: "e8", from: "decide", to: "gate", kind: "uses" },
    ],
    warnings: [],
  };
}

describe("behaviour 1 — the impossible is prevented silently", () => {
  it("never offers an arrow INTO a bundled file from anything but a step", () => {
    const graph = fullGraph();
    expect(isConnectionOfferable(graph, "loop", "spec")).toBe(false);
    expect(isConnectionOfferable(graph, "gate", "spec")).toBe(false);
    expect(isConnectionOfferable(graph, "search", "spec")).toBe(false);
  });

  it("never offers a self-connection or an unknown endpoint", () => {
    const graph = fullGraph();
    expect(isConnectionOfferable(graph, "step", "step")).toBe(false);
    expect(isConnectionOfferable(graph, "step", "no-such-node")).toBe(false);
    expect(isConnectionOfferable(graph, null, "step")).toBe(false);
    expect(isConnectionOfferable(graph, undefined, undefined)).toBe(false);
  });

  it("offers the ONE authorable pair — a step onto a bundled file", () => {
    const graph = fullGraph();
    expect(isConnectionOfferable(graph, "step", "notes")).toBe(true);
    expect(isConnectionOfferable(graph, "decide", "spec")).toBe(true);
  });
});

describe("behaviour 2 — an obvious intent gets the legal move, not a dead stop", () => {
  it("tool onto tool offers calling it from the target's own step, in one click", () => {
    const resolution = resolveConnection(fullGraph(), "search", "render", {
      boundTools: BOUND_TOOLS,
    });
    expect(resolution.outcome).toBe("offer");
    if (resolution.outcome !== "offer") return;
    expect(resolution.title).toContain("can’t be called by another tool");
    // `render` hangs off `step`, so that is where the offer routes the call.
    expect(resolution.description).toContain("step");
    expect(resolution.op).toEqual({
      op: "add_tool_ref",
      nodeId: "step",
      server: "acme",
      tool: "acme_search",
    });
    expect(resolution.actionLabel).toContain("step");
  });

  it("tool onto a step offers calling it from that step", () => {
    const resolution = resolveConnection(fullGraph(), "search", "other-step", {
      boundTools: BOUND_TOOLS,
    });
    expect(resolution.outcome).toBe("offer");
    if (resolution.outcome !== "offer") return;
    expect(resolution.op).toMatchObject({ op: "add_tool_ref", nodeId: "other-step" });
  });

  it("file onto file offers referencing it from the target's own step", () => {
    const resolution = resolveConnection(fullGraph(), "spec", "notes", {
      boundTools: BOUND_TOOLS,
    });
    expect(resolution.outcome).toBe("offer");
    if (resolution.outcome !== "offer") return;
    expect(resolution.op).toEqual({
      op: "connect_asset",
      nodeId: "other-step",
      path: "reference/spec.md",
    });
  });

  it("a file dragged the WRONG WAY onto a step offers the right-way-round connection", () => {
    const resolution = resolveConnection(fullGraph(), "notes", "decide", {
      boundTools: BOUND_TOOLS,
    });
    expect(resolution.outcome).toBe("offer");
    if (resolution.outcome !== "offer") return;
    expect(resolution.title).toContain("from a step to a file");
    expect(resolution.op).toEqual({
      op: "connect_asset",
      nodeId: "decide",
      path: "reference/notes.md",
    });
  });

  it("an offer never proposes something that already exists", () => {
    // `spec` is already referenced from `step`; dragging it back onto `step` must not offer a dupe.
    const resolution = resolveConnection(fullGraph(), "spec", "step", { boundTools: BOUND_TOOLS });
    expect(resolution.outcome).toBe("refuse");
    if (resolution.outcome !== "refuse") return;
    expect(resolution.description).toContain("already references it");
  });

  it("falls back to a NAMED refusal when the tool is on no bound server", () => {
    // `acme_render` is cited by the skill but no bound server exposes it, so there is no server to
    // record the call against. That is a real reason, and the message gives it.
    const resolution = resolveConnection(fullGraph(), "render", "other-step", {
      boundTools: BOUND_TOOLS,
    });
    expect(resolution.outcome).toBe("refuse");
    if (resolution.outcome !== "refuse") return;
    expect(resolution.description).toContain("no bound server");
  });
});

describe("behaviour 3 — a genuine refusal names the rule and links the guide", () => {
  it("step onto step teaches that the order comes from the document", () => {
    const resolution = resolveConnection(fullGraph(), "step", "other-step", {
      boundTools: BOUND_TOOLS,
    });
    expect(resolution.outcome).toBe("refuse");
    if (resolution.outcome !== "refuse") return;
    expect(resolution.explainerId).toBe("edge:then");
    expect(resolution.description).toContain("then connection");
    expect(resolution.guideAnchor).toBe(explainerFor("edge:then")?.guideAnchor);
  });

  it("a decision point teaches that branches are written, not drawn (decision 6, deferred)", () => {
    const resolution = resolveConnection(fullGraph(), "decide", "step", {
      boundTools: BOUND_TOOLS,
    });
    expect(resolution.outcome).toBe("refuse");
    if (resolution.outcome !== "refuse") return;
    expect(resolution.explainerId).toBe("edge:branch");
    expect(resolution.title).toContain("Branches are written, not drawn");
  });

  it("anything onto a trigger teaches that a trigger is where a flow starts", () => {
    const resolution = resolveConnection(fullGraph(), "step", "cmd", { boundTools: BOUND_TOOLS });
    expect(resolution.outcome).toBe("refuse");
    if (resolution.outcome !== "refuse") return;
    expect(resolution.explainerId).toBe("edge:triggers");
  });

  it("a duplicate step→file connection says it already exists rather than staging a second", () => {
    const resolution = resolveConnection(fullGraph(), "step", "spec", { boundTools: BOUND_TOOLS });
    expect(resolution.outcome).toBe("refuse");
    if (resolution.outcome !== "refuse") return;
    expect(resolution.title).toContain("already reads");
  });

  it("an unsaved preview box says to save first, rather than failing opaquely", () => {
    const graph = fullGraph();
    graph.nodes.push(node(`${PREVIEW_NODE_PREFIX}0`, "subroutine", 30));
    const resolution = resolveConnection(graph, `${PREVIEW_NODE_PREFIX}0`, "spec", {
      boundTools: BOUND_TOOLS,
    });
    expect(resolution.outcome).toBe("refuse");
    if (resolution.outcome !== "refuse") return;
    expect(resolution.title).toContain("Save this version first");
  });

  it("every refusal's guide anchor resolves through the ONE explainer registry", () => {
    for (const resolution of everyResolution()) {
      if (resolution.outcome !== "refuse") continue;
      const entry = explainerFor(resolution.explainerId);
      expect(entry, `${resolution.explainerId} is a registry id`).toBeTruthy();
      expect(resolution.guideAnchor).toBe(entry?.guideAnchor);
      expect(resolution.guideAnchor).toMatch(/^docs\/skill-authoring\.md#/);
    }
  });
});

/** Every resolution the grammar can produce over every ordered pair of node kinds in `fullGraph`. */
function everyResolution(): ConnectResolution[] {
  const graph = fullGraph();
  const out: ConnectResolution[] = [];
  for (const from of graph.nodes) {
    for (const to of graph.nodes) {
      if (from.id === to.id) continue;
      out.push(resolveConnection(graph, from.id, to.id, { boundTools: BOUND_TOOLS }));
    }
  }
  // Plus the two degenerate inputs a caller could hand in.
  out.push(resolveConnection(graph, "step", "no-such-node", { boundTools: BOUND_TOOLS }));
  out.push(resolveConnection(graph, null, null, { boundTools: BOUND_TOOLS }));
  return out;
}

describe("THE RULE — no message anywhere says only that an action failed", () => {
  it("covers every ordered pair, so this is a set assertion and not a spot check", () => {
    const resolutions = everyResolution();
    // 10 nodes → 90 ordered pairs, plus the two degenerate inputs.
    expect(resolutions.length).toBe(SKILL_GRAPH_NODE_KINDS.length > 0 ? 92 : 0);
    expect(resolutions.some((r) => r.outcome === "connect")).toBe(true);
    expect(resolutions.some((r) => r.outcome === "offer")).toBe(true);
    expect(resolutions.some((r) => r.outcome === "refuse")).toBe(true);
  });

  it("no message is a bare failure — every one offers a move or names a rule", () => {
    // The exact shape being outlawed: the old single toast, and anything else that reports only that
    // the attempt did not work without saying what the rule is or what to do instead.
    const BARE_FAILURE =
      /^(couldn.t|could not|cannot|can.t|unable to|failed to)\b[^.]*$|^(that )?(didn.t|did not) work/i;
    for (const resolution of everyResolution()) {
      expect(resolution.title.trim().length).toBeGreaterThan(0);
      expect(resolution.description.trim().length).toBeGreaterThan(0);
      expect(BARE_FAILURE.test(resolution.title), `bare failure title: "${resolution.title}"`).toBe(
        false,
      );

      if (resolution.outcome === "refuse") {
        // A refusal must TEACH: it cites a registry entry, and its description says something beyond
        // "no". A one-clause "you can't do that." is not a rule.
        expect(explainerFor(resolution.explainerId)).toBeTruthy();
        expect(
          resolution.description.length,
          `too terse to be a rule: "${resolution.description}"`,
        ).toBeGreaterThan(60);
      }
      if (resolution.outcome === "offer") {
        // An offer must ACT: a labelled button and a real op behind it.
        expect(resolution.actionLabel.trim().length).toBeGreaterThan(0);
        expect(resolution.op.op.length).toBeGreaterThan(0);
      }
    }
  });

  it("the message the old build showed is gone from the source of truth", () => {
    // "Couldn't create that connection — A connection runs from a section to an asset file" named one
    // legal move and did not say which part of what you did was wrong. Nothing may produce it again.
    for (const resolution of everyResolution()) {
      expect(resolution.title).not.toContain("Couldn’t create that connection");
      expect(resolution.description).not.toContain(
        "A connection runs from a section to an asset file",
      );
    }
  });

  it("every offer's staged op is a real edit op the buffer already understands — no new save path", () => {
    const known = new Set(["connect_asset", "disconnect_asset", "add_tool_ref"]);
    for (const resolution of everyResolution()) {
      if (resolution.outcome === "refuse") continue;
      expect(known.has(resolution.op.op), `unexpected op ${resolution.op.op}`).toBe(true);
    }
  });
});
