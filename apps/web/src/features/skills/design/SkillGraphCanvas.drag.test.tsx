import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Edge } from "@elabs-ai/components-flow";
import {
  applyPositionOverrides,
  nodeGeometrySignature,
  SkillGraphCanvas,
  type SkillCanvasNode,
} from "./SkillGraphCanvas";

// ── SI10 — session-local node dragging ──────────────────────────────────────────────────────────────
// Dragging a node is VIEW state only: the position sticks through selection re-seeds (merged over the
// auto-layout output), resets when the graph's structural geometry — or the skill/version — changes,
// never re-triggers the auto-fit (whose signature is computed from the PRE-override positions), and
// never reaches the draft (no callback prop fires, so no op / dirty flag / persistence can happen).
// Harness mirrors SkillGraphCanvas.selection.test.tsx: `@elabs-ai/components-flow` is mocked with a props-capturing
// CanvasShell + a useState-backed useNodesState, so the nodes the shell receives ARE the live nodes.

const h = vi.hoisted(() => {
  const paneSize = { width: 800, height: 600 };
  return {
    shellProps: [] as Array<Record<string, unknown>>,
    paneSize,
    storeApi: { getState: () => paneSize },
    reactFlow: {
      getNode: vi.fn(),
      getViewport: vi.fn(() => ({ x: 0, y: 0, zoom: 1 })),
      setCenter: vi.fn(),
      getNodes: vi.fn(() => []),
      // A REAL (non-empty) bounds so `resolveFitViewport` produces a viewport — the fit-stability
      // test counts `setViewport` calls to prove a drag never re-fits.
      getNodesBounds: vi.fn(() => ({ x: 0, y: 0, width: 600, height: 300 })),
      setViewport: vi.fn(),
    },
  };
});

vi.mock("@elabs-ai/components-flow", async () => {
  const react = await import("react");
  return {
    CanvasShell: (props: Record<string, unknown>) => {
      h.shellProps.push(props);
      return react.createElement(
        "div",
        { "data-testid": "canvas-shell" },
        props.children as React.ReactNode,
      );
    },
    FlowNode: () => null,
    useNodesState: (initial: unknown[]) => {
      const [nodes, setNodes] = react.useState(initial);
      return [nodes, setNodes, vi.fn()];
    },
    useReactFlow: () => h.reactFlow,
    ZoomControls: () => null,
  };
});

vi.mock("@xyflow/react", () => ({
  BaseEdge: () => null,
  getSmoothStepPath: () => ["M 0 0"],
  Handle: () => null,
  useStoreApi: () => h.storeApi,
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
}));

// Diagnostics fetch (only fired when skillId+versionId are passed): keep it forever-pending so no
// async state lands outside `act` — the reset-on-version-switch test only needs the props to change.
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

type DragStop = (event: unknown, node: SkillCanvasNode) => void;

const latestShell = () =>
  h.shellProps.at(-1) as {
    nodes: SkillCanvasNode[];
    nodesDraggable?: boolean;
    onNodeDragStop?: DragStop;
    onSelectionChange?: (params: { nodes: SkillCanvasNode[]; edges: Edge[] }) => void;
  } & Record<string, unknown>;

const brandNode = (id: string, x = 0, y = 0, selected = false): SkillCanvasNode => ({
  id,
  type: "brand",
  position: { x, y },
  ...(selected ? { selected } : {}),
  data: { title: id },
});

const positionOf = (nodes: SkillCanvasNode[], id: string) =>
  nodes.find((node) => node.id === id)?.position;

/** Simulate React Flow's end-of-drag callback (the node arrives carrying its NEW position). */
const dragTo = (id: string, x: number, y: number) => {
  const stop = latestShell().onNodeDragStop;
  expect(typeof stop).toBe("function");
  act(() => {
    stop?.(undefined, brandNode(id, x, y));
  });
};

beforeEach(() => {
  h.shellProps.length = 0;
  h.reactFlow.setViewport.mockClear();
  h.reactFlow.setCenter.mockClear();
  h.reactFlow.getNode.mockReset();
});

describe("applyPositionOverrides / nodeGeometrySignature (pure)", () => {
  test("applies an override to its node only; untouched nodes keep their object identity", () => {
    const nodes = [brandNode("a", 0, 0), brandNode("b", 240, 0)];
    const merged = applyPositionOverrides(nodes, new Map([["a", { x: 50, y: 60 }]]));
    expect(positionOf(merged, "a")).toEqual({ x: 50, y: 60 });
    expect(merged[1]).toBe(nodes[1]);
  });

  test("an empty override map returns the SAME array (identity-stable re-seed path)", () => {
    const nodes = [brandNode("a")];
    expect(applyPositionOverrides(nodes, new Map())).toBe(nodes);
  });

  test("the signature reflects ids+positions but ignores the selection flag", () => {
    const base = [brandNode("a", 0, 0), brandNode("b", 240, 0)];
    const reselected = [brandNode("a", 0, 0, true), brandNode("b", 240, 0)];
    const moved = [brandNode("a", 0, 0), brandNode("b", 240, 96)];
    expect(nodeGeometrySignature(reselected)).toBe(nodeGeometrySignature(base));
    expect(nodeGeometrySignature(moved)).not.toBe(nodeGeometrySignature(base));
  });
});

describe("SkillGraphCanvas dragging (SI10 — session-local view state)", () => {
  test("nodes are draggable and the drag-stop handler is wired (read-only canvas too)", () => {
    render(<SkillGraphCanvas nodes={[brandNode("a")]} edges={[]} onSelectNode={vi.fn()} />);
    expect(latestShell().nodesDraggable).toBe(true);
    expect(typeof latestShell().onNodeDragStop).toBe("function");
  });

  test("a dragged position is merged over the layout and SURVIVES a selection re-seed", () => {
    const nodes = [brandNode("a", 0, 0), brandNode("b", 240, 0)];
    const { rerender } = render(
      <SkillGraphCanvas nodes={nodes} edges={[]} onSelectNode={vi.fn()} />,
    );
    dragTo("a", 500, 40);
    expect(positionOf(latestShell().nodes, "a")).toEqual({ x: 500, y: 40 });
    expect(positionOf(latestShell().nodes, "b")).toEqual({ x: 240, y: 0 });

    // The caller re-seeds `selected` flags on every selection change (same ids+positions) — the
    // manual position must not snap back.
    rerender(
      <SkillGraphCanvas
        nodes={[brandNode("a", 0, 0, true), brandNode("b", 240, 0)]}
        edges={[]}
        onSelectNode={vi.fn()}
      />,
    );
    expect(positionOf(latestShell().nodes, "a")).toEqual({ x: 500, y: 40 });
  });

  test("overrides RESET when the structural geometry (the fit signature) changes", () => {
    const { rerender } = render(
      <SkillGraphCanvas
        nodes={[brandNode("a", 0, 0), brandNode("b", 240, 0)]}
        edges={[]}
        onSelectNode={vi.fn()}
      />,
    );
    dragTo("a", 500, 40);
    expect(positionOf(latestShell().nodes, "a")).toEqual({ x: 500, y: 40 });

    // A relayout (b moved to a new rank/row) — auto-layout wins again, the stale drag is dropped.
    rerender(
      <SkillGraphCanvas
        nodes={[brandNode("a", 0, 0), brandNode("b", 240, 96)]}
        edges={[]}
        onSelectNode={vi.fn()}
      />,
    );
    expect(positionOf(latestShell().nodes, "a")).toEqual({ x: 0, y: 0 });
  });

  test("overrides RESET on a version switch even when the geometry is identical", () => {
    const nodes = [brandNode("a", 0, 0)];
    const { rerender } = render(
      <SkillGraphCanvas
        nodes={nodes}
        edges={[]}
        onSelectNode={vi.fn()}
        skillId="sk-1"
        versionId="ver-1"
      />,
    );
    dragTo("a", 321, 12);
    expect(positionOf(latestShell().nodes, "a")).toEqual({ x: 321, y: 12 });

    rerender(
      <SkillGraphCanvas
        nodes={nodes}
        edges={[]}
        onSelectNode={vi.fn()}
        skillId="sk-1"
        versionId="ver-2"
      />,
    );
    expect(positionOf(latestShell().nodes, "a")).toEqual({ x: 0, y: 0 });
  });

  test("dragging NEVER reaches the draft: no gesture callback fires (no op → no dirty flag)", () => {
    // The canvas's ONLY channels to the edit buffer / draft store are these callback props; a drag
    // that fires none of them cannot stage an op, flip the dirty chip, or persist anything.
    const onSelectNode = vi.fn();
    const onConnect = vi.fn();
    const onEdgesDelete = vi.fn();
    const onToolDrop = vi.fn();
    render(
      <SkillGraphCanvas
        nodes={[brandNode("a")]}
        edges={[]}
        onSelectNode={onSelectNode}
        editable
        onConnect={onConnect}
        onEdgesDelete={onEdgesDelete}
        onToolDrop={onToolDrop}
      />,
    );
    dragTo("a", 999, 999);
    expect(onSelectNode).not.toHaveBeenCalled();
    expect(onConnect).not.toHaveBeenCalled();
    expect(onEdgesDelete).not.toHaveBeenCalled();
    expect(onToolDrop).not.toHaveBeenCalled();
  });

  test("a drag never re-runs the auto-fit — the fit signature is computed from PRE-drag positions", () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(
        <SkillGraphCanvas
          nodes={[brandNode("a", 0, 0), brandNode("b", 240, 0)]}
          edges={[]}
          onSelectNode={vi.fn()}
        />,
      );
      // Flush the mount-time fit ticks (60…1200 ms + rAF) — the initial framing.
      act(() => {
        vi.runAllTimers();
      });
      const initialFits = h.reactFlow.setViewport.mock.calls.length;
      expect(initialFits).toBeGreaterThan(0);

      dragTo("a", 500, 40);
      act(() => {
        vi.runAllTimers();
      });
      expect(h.reactFlow.setViewport.mock.calls.length).toBe(initialFits);

      // Control: a REAL geometry change does re-fit.
      rerender(
        <SkillGraphCanvas
          nodes={[brandNode("a", 0, 0), brandNode("b", 240, 96)]}
          edges={[]}
          onSelectNode={vi.fn()}
        />,
      );
      act(() => {
        vi.runAllTimers();
      });
      expect(h.reactFlow.setViewport.mock.calls.length).toBeGreaterThan(initialFits);
    } finally {
      vi.useRealTimers();
    }
  });
});
