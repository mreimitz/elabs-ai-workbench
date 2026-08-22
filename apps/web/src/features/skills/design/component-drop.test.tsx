import { fireEvent, render } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { SkillGraph, SkillGraphNode } from "@mcp-token-footprint/shared";
import { SkillGraphCanvas, type SkillCanvasNode } from "./SkillGraphCanvas";
import {
  COMPONENT_DRAG_MIME,
  resolveComponentPlacement,
  TOOL_DRAG_MIME,
  type ComponentDragPayload,
} from "./skill-components";
import { applyPreviewOps, PREVIEW_NODE_PREFIX } from "./use-edit-ops";

// ── RM-30 WP 7.7 — dropping a component on the canvas CREATES a node ──────────────────────────────
// The creation path has three links and this file walks all three, because each one can fail
// independently:
//
//   1. the canvas hit-tests the drop and hands (component, node under the pointer) UP — it decides
//      nothing about what a component means;
//   2. `resolveComponentPlacement` turns that into ops on the frozen `SkillEditOp` union;
//   3. `applyPreviewOps` turns those ops into a node the author can see, before any save.
//
// Link 1 also has a security-shaped assertion: a drag payload is text an untrusted source could have
// written, so a payload naming something that is not one of the nine components must be dropped on
// the floor rather than handed up.

const h = vi.hoisted(() => ({
  paneSize: { width: 800, height: 600 },
}));

vi.mock("@elabs-ai/components-flow", async () => {
  const react = await import("react");
  return {
    // The shell must forward the drag handlers onto a real DOM node — they are the whole subject
    // here, and a stub that swallowed them would make every assertion below vacuous.
    CanvasShell: (props: Record<string, unknown>) =>
      react.createElement(
        "div",
        {
          "data-testid": "canvas-shell",
          onDragOver: props.onDragOver as React.DragEventHandler,
          onDrop: props.onDrop as React.DragEventHandler,
        },
        props.children as React.ReactNode,
      ),
    FlowNode: () => null,
    useNodesState: (initial: unknown[]) => {
      const [nodes, setNodes] = react.useState(initial);
      return [nodes, setNodes, vi.fn()];
    },
    useReactFlow: () => ({
      getNode: vi.fn(),
      getViewport: vi.fn(() => ({ x: 0, y: 0, zoom: 1 })),
      setCenter: vi.fn(),
      getNodes: vi.fn(() => []),
      getNodesBounds: vi.fn(() => ({ x: 0, y: 0, width: 0, height: 0 })),
      setViewport: vi.fn(),
    }),
    ZoomControls: () => null,
  };
});

vi.mock("@xyflow/react", () => ({
  BaseEdge: () => null,
  getSmoothStepPath: () => ["M 0 0"],
  Handle: () => null,
  useStoreApi: () => ({ getState: () => h.paneSize }),
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
}));

vi.mock("../skills-inspector-api", () => ({
  getToolDiagnostics: vi.fn(() => new Promise(() => {})),
}));

if (typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
if (typeof window.ResizeObserver !== "function") {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof window.ResizeObserver;
}

const canvasNode = (id: string): SkillCanvasNode => ({
  id,
  type: "brand",
  position: { x: 0, y: 0 },
  data: { title: id },
});

/** A `DataTransfer` stand-in: jsdom's drag events carry none. */
function dataTransfer(entries: Record<string, string>) {
  return {
    types: Object.keys(entries),
    getData: (mime: string) => entries[mime] ?? "",
    setData: vi.fn(),
    dropEffect: "none",
    effectAllowed: "none",
  };
}

/**
 * Render the canvas, then fire a drop. `over` names the React Flow node wrapper the pointer was on
 * (its `data-id` is what the canvas hit-tests); `null` drops on the empty pane.
 */
function dropOnCanvas(entries: Record<string, string>, over: string | null) {
  const onComponentDrop = vi.fn();
  const onToolDrop = vi.fn();
  const { container } = render(
    <SkillGraphCanvas
      nodes={[canvasNode("sec-1")]}
      edges={[]}
      editable
      onSelectNode={vi.fn()}
      onToolDrop={onToolDrop}
      onComponentDrop={onComponentDrop}
    />,
  );

  const shell = container.querySelector('[data-testid="canvas-shell"]') as HTMLElement;
  let target: HTMLElement = shell;
  if (over !== null) {
    const nodeEl = document.createElement("div");
    nodeEl.className = "react-flow__node";
    nodeEl.setAttribute("data-id", over);
    shell.appendChild(nodeEl);
    target = nodeEl;
  }

  fireEvent.drop(target, { dataTransfer: dataTransfer(entries) });
  return { onComponentDrop, onToolDrop };
}

const componentPayload = (component: string) =>
  JSON.stringify({ component } as ComponentDragPayload);

describe("link 1 — the canvas hit-tests a component drop and hands it up", () => {
  test("a drop ON a node reports that node's id", () => {
    const { onComponentDrop } = dropOnCanvas(
      { [COMPONENT_DRAG_MIME]: componentPayload("gatekeeper") },
      "sec-1",
    );
    expect(onComponentDrop).toHaveBeenCalledWith({ component: "gatekeeper", nodeId: "sec-1" });
  });

  test("a drop on the empty pane reports a null target", () => {
    const { onComponentDrop } = dropOnCanvas(
      { [COMPONENT_DRAG_MIME]: componentPayload("section") },
      null,
    );
    expect(onComponentDrop).toHaveBeenCalledWith({ component: "section", nodeId: null });
  });

  test("the two payload kinds never cross — a tool drag stays a tool drop", () => {
    const { onComponentDrop, onToolDrop } = dropOnCanvas(
      { [TOOL_DRAG_MIME]: JSON.stringify({ server: "files", tool: "read_file" }) },
      "sec-1",
    );
    expect(onComponentDrop).not.toHaveBeenCalled();
    expect(onToolDrop).toHaveBeenCalledWith({
      server: "files",
      tool: "read_file",
      nodeId: "sec-1",
    });
  });

  test("an unknown component id in the payload is dropped on the floor, not handed up", () => {
    const { onComponentDrop } = dropOnCanvas(
      { [COMPONENT_DRAG_MIME]: componentPayload("rm -rf") },
      "sec-1",
    );
    expect(onComponentDrop).not.toHaveBeenCalled();
  });

  test("malformed JSON is survived rather than thrown", () => {
    const { onComponentDrop } = dropOnCanvas({ [COMPONENT_DRAG_MIME]: "{not json" }, "sec-1");
    expect(onComponentDrop).not.toHaveBeenCalled();
  });

  test("a drag over the canvas is accepted for the component MIME (so a drop can land at all)", () => {
    const onComponentDrop = vi.fn();
    const { container } = render(
      <SkillGraphCanvas
        nodes={[canvasNode("sec-1")]}
        edges={[]}
        editable
        onSelectNode={vi.fn()}
        onComponentDrop={onComponentDrop}
      />,
    );
    const shell = container.querySelector('[data-testid="canvas-shell"]') as HTMLElement;
    const accepted = fireEvent.dragOver(shell, {
      dataTransfer: dataTransfer({ [COMPONENT_DRAG_MIME]: "" }),
    });
    // fireEvent returns false when a handler called preventDefault — which is what marks the canvas
    // a valid drop target.
    expect(accepted).toBe(false);
  });

  test("a foreign drag is NOT accepted — the canvas only claims its own two MIMEs", () => {
    const { container } = render(
      <SkillGraphCanvas
        nodes={[canvasNode("sec-1")]}
        edges={[]}
        editable
        onSelectNode={vi.fn()}
        onComponentDrop={vi.fn()}
      />,
    );
    const shell = container.querySelector('[data-testid="canvas-shell"]') as HTMLElement;
    const accepted = fireEvent.dragOver(shell, {
      dataTransfer: dataTransfer({ "text/plain": "" }),
    });
    expect(accepted).toBe(true);
  });

  test("out of edit mode the drop handlers are not wired at all", () => {
    const onComponentDrop = vi.fn();
    const { container } = render(
      <SkillGraphCanvas
        nodes={[canvasNode("sec-1")]}
        edges={[]}
        onSelectNode={vi.fn()}
        onComponentDrop={onComponentDrop}
      />,
    );
    const shell = container.querySelector('[data-testid="canvas-shell"]') as HTMLElement;
    fireEvent.drop(shell, {
      dataTransfer: dataTransfer({ [COMPONENT_DRAG_MIME]: componentPayload("section") }),
    });
    expect(onComponentDrop).not.toHaveBeenCalled();
  });
});

describe("links 2 + 3 — the dropped component becomes a node the author can see", () => {
  const sectionNode: SkillGraphNode = {
    id: "sec-1",
    kind: "subroutine",
    label: "Collect input",
    anchor: { headingPath: ["Skill", "Collect input"], startLine: 2, endLine: 4 },
    source: "heading",
  };
  const graph: SkillGraph = { nodes: [sectionNode], edges: [], warnings: [] };
  const text = ["# Skill", "## Collect input", "Ask for the file."].join("\n");

  /** The whole path, exactly as `UnifiedEditor` runs it: drop → resolve → preview. */
  function dropAndPreview(component: Parameters<typeof resolveComponentPlacement>[0]["component"]) {
    const { onComponentDrop } = dropOnCanvas(
      { [COMPONENT_DRAG_MIME]: componentPayload(component) },
      "sec-1",
    );
    const [payload] = onComponentDrop.mock.calls[0] as [
      { component: typeof component; nodeId: string | null },
    ];
    const placement = resolveComponentPlacement({
      component: payload.component,
      targetNodeId: payload.nodeId,
      graph,
      text,
      existingTitles: graph.nodes.map((node) => node.label),
      existingCommands: [],
      existingKeywords: [],
      canStageSettings: true,
    });
    expect(placement.ok).toBe(true);
    if (!placement.ok) throw new Error("placement refused");
    return { placement, preview: applyPreviewOps(graph, placement.ops) };
  }

  test("dropping a Section adds a node to the preview graph, before any save", () => {
    const { preview } = dropAndPreview("section");
    expect(preview.nodes).toHaveLength(2);
    const added = preview.nodes.find((node) => node.id.startsWith(PREVIEW_NODE_PREFIX));
    expect(added?.label).toBe("New section");
  });

  test("dropping a /command adds an entry point to the preview graph", () => {
    const { preview } = dropAndPreview("command");
    const added = preview.nodes.find((node) => node.kind === "entry_point");
    expect(added).toBeDefined();
    expect(added?.id.startsWith(PREVIEW_NODE_PREFIX)).toBe(true);
  });

  test("dropping a Gatekeeper marks the section it landed on rather than adding a node", () => {
    const { placement, preview } = dropAndPreview("gatekeeper");
    expect(preview.nodes).toHaveLength(1);
    // The preview marks the node ANNOTATED; the kind only becomes `gatekeeper` when the save
    // round-trips the annotation through the server's projector. Asserting the kind here would be
    // asserting something the preview deliberately does not claim to know.
    expect(preview.nodes[0]?.source).toBe("annotated");
    expect(placement.ops[0]).toMatchObject({ op: "set_annotation", kind: "gatekeeper" });
  });

  test("the drop never mutates the authoritative graph — the preview is a new object", () => {
    const { preview } = dropAndPreview("section");
    expect(graph.nodes).toHaveLength(1);
    expect(preview).not.toBe(graph);
  });
});
