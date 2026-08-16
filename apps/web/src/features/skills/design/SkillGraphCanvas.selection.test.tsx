import { useMemo, useState, type ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { Button } from "@brand/ui";
import type { Edge } from "@brand/flow";
import { resolveSeededFocus, SkillGraphCanvas, type SkillCanvasNode } from "./SkillGraphCanvas";

// ── SI14 regression — minified React #185 on the problems panel's "Show node" ──────────────────────
// The crash: an EXTERNAL selection (ProblemsPanel "Show node" → `setSelectedNodeId` → seeded
// `selected` flags on the `nodes` prop) ping-ponged with React Flow's internal selection store.
// @xyflow/react's `SelectionListenerInner` keys its announce effect on the `onSelectionChange`
// CALLBACK IDENTITY, so the old inline-lambda handler (a new identity every render) re-announced the
// store's one-commit-STALE selection on every render, clobbering the just-seeded id back to
// `undefined`, which re-seeded, which the store echoed one pass later — an infinite value flip that
// hit React's nested-update limit. The fix gives the announce ONE stable identity (latest
// `onSelectNode` observed through a ref), so the listener only fires on REAL selection-id changes.
// These tests pin (a) the stable identity, (b) survival of a seeded selection against a faithfully
// stale announcer, and (c) the bring-into-view child (`FocusSeededSelection`) + its pure resolver.

const h = vi.hoisted(() => {
  const paneSize = { width: 800, height: 600 };
  return {
    shellProps: [] as Array<Record<string, unknown>>,
    paneSize,
    // ONE stable store instance, like the real `useStoreApi` (an unstable identity here would
    // re-fire the focus effect on every render and mask the same-seed no-op guard).
    storeApi: { getState: () => paneSize },
    reactFlow: {
      getNode: vi.fn(),
      getViewport: vi.fn(() => ({ x: 0, y: 0, zoom: 1 })),
      setCenter: vi.fn(),
      getNodes: vi.fn(() => []),
      getNodesBounds: vi.fn(() => ({ x: 0, y: 0, width: 0, height: 0 })),
      setViewport: vi.fn(),
    },
  };
});

vi.mock("@brand/flow", async () => {
  const react = await import("react");
  return {
    /** Captures every render's props and mimics @xyflow/react's `SelectionListenerInner`: the
     *  announce effect depends on the `onSelectionChange` IDENTITY, so a recreated callback
     *  re-announces the store's CURRENT selection. The "store" here stays empty forever — exactly
     *  the one-commit-stale value an externally seeded selection meets in the real canvas. */
    CanvasShell: (props: Record<string, unknown>) => {
      h.shellProps.push(props);
      const announce = props.onSelectionChange as
        | ((params: { nodes: unknown[]; edges: unknown[] }) => void)
        | undefined;
      react.useEffect(() => {
        announce?.({ nodes: [], edges: [] });
      }, [announce]);
      return react.createElement(
        "div",
        { "data-testid": "canvas-shell" },
        props.children as ReactNode,
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
  // graph-layout (REAL in this test) reads `Position` at module init.
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
}));

vi.mock("../skills-inspector-api", () => ({
  getToolDiagnostics: vi.fn(async () => ({ diagnostics: [] })),
}));

// jsdom omits these (same stubs as SkillTraceView.test.tsx).
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

type Announce = (params: { nodes: SkillCanvasNode[]; edges: Edge[] }) => void;

const latestShell = () =>
  h.shellProps.at(-1) as { onSelectionChange?: Announce } & Record<string, unknown>;

const brandNode = (id: string, x = 0, y = 0): SkillCanvasNode => ({
  id,
  type: "brand",
  position: { x, y },
  data: { title: id },
});

beforeEach(() => {
  h.shellProps.length = 0;
  h.reactFlow.getNode.mockReset();
  h.reactFlow.setCenter.mockClear();
});

describe("SkillGraphCanvas selection announce (SI14 — the #185 guard)", () => {
  test("onSelectionChange keeps ONE stable identity across re-renders (fails on the old inline lambda)", () => {
    const { rerender } = render(
      <SkillGraphCanvas nodes={[brandNode("s1")]} edges={[]} onSelectNode={vi.fn()} />,
    );
    const first = latestShell().onSelectionChange;
    expect(typeof first).toBe("function");
    // Re-render with a CHANGED seed (the Show-node flow) AND a changed onSelectNode identity — the
    // worst case; the announce handler must still be the same function object.
    rerender(
      <SkillGraphCanvas
        nodes={[{ ...brandNode("s1"), selected: true }]}
        edges={[]}
        onSelectNode={vi.fn()}
      />,
    );
    expect(latestShell().onSelectionChange).toBe(first);
  });

  test("an externally seeded selection SURVIVES the stale re-announce (old code: clobbered → loop)", () => {
    // Mimics UnifiedEditor's exact contract: state → seeded `selected` flags → canvas; announce →
    // state. With the old per-render handler identity, the mock shell's stale-empty announce fired
    // after the seeding render and reset the state to undefined (in the real canvas the store then
    // echoed the seed one commit later — flipping forever into React error #185).
    function SeedingHost() {
      const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
      const nodes = useMemo(
        () => ["s1", "s2"].map((id) => ({ ...brandNode(id), selected: id === selectedId })),
        [selectedId],
      );
      return (
        <div>
          <Button onClick={() => setSelectedId("s1")}>show node</Button>
          <output data-testid="selected-id">{selectedId ?? "none"}</output>
          <SkillGraphCanvas nodes={nodes} edges={[]} onSelectNode={setSelectedId} />
        </div>
      );
    }

    render(<SeedingHost />);
    expect(screen.getByTestId("selected-id").textContent).toBe("none");
    fireEvent.click(screen.getByRole("button", { name: "show node" }));
    expect(screen.getByTestId("selected-id").textContent).toBe("s1");
  });

  test("the stable announce always reaches the LATEST onSelectNode", () => {
    const firstHandler = vi.fn();
    const secondHandler = vi.fn();
    const { rerender } = render(
      <SkillGraphCanvas nodes={[brandNode("s1")]} edges={[]} onSelectNode={firstHandler} />,
    );
    rerender(
      <SkillGraphCanvas nodes={[brandNode("s1")]} edges={[]} onSelectNode={secondHandler} />,
    );
    const announce = latestShell().onSelectionChange;
    announce?.({ nodes: [{ ...brandNode("s1"), selected: true }], edges: [] });
    expect(secondHandler).toHaveBeenCalledWith("s1");
    expect(firstHandler).not.toHaveBeenCalledWith("s1");
  });
});

describe("FocusSeededSelection (SI14 — Show node brings the node into view)", () => {
  test("centers an OFF-viewport seeded node once, keeping the zoom; the same seed never re-pans", () => {
    h.reactFlow.getNode.mockReturnValue({
      id: "s1",
      position: { x: 2000, y: 0 },
      measured: { width: 224, height: 72 },
    });
    const seeded = [{ ...brandNode("s1", 2000, 0), selected: true }];
    const { rerender } = render(
      <SkillGraphCanvas nodes={seeded} edges={[]} onSelectNode={vi.fn()} />,
    );
    expect(h.reactFlow.setCenter).toHaveBeenCalledTimes(1);
    expect(h.reactFlow.setCenter).toHaveBeenCalledWith(2112, 36, { zoom: 1, duration: 250 });
    rerender(<SkillGraphCanvas nodes={seeded} edges={[]} onSelectNode={vi.fn()} />);
    expect(h.reactFlow.setCenter).toHaveBeenCalledTimes(1);
  });

  test("a seeded node already in view never moves the camera (canvas clicks stay calm)", () => {
    h.reactFlow.getNode.mockReturnValue({
      id: "s1",
      position: { x: 100, y: 100 },
      measured: { width: 224, height: 72 },
    });
    render(
      <SkillGraphCanvas
        nodes={[{ ...brandNode("s1", 100, 100), selected: true }]}
        edges={[]}
        onSelectNode={vi.fn()}
      />,
    );
    expect(h.reactFlow.setCenter).not.toHaveBeenCalled();
  });

  test("a seeded id absent from the canvas (e.g. hidden by the flow filter) is a safe no-op", () => {
    h.reactFlow.getNode.mockReturnValue(undefined);
    render(
      <SkillGraphCanvas
        nodes={[{ ...brandNode("s1"), selected: true }]}
        edges={[]}
        onSelectNode={vi.fn()}
      />,
    );
    expect(h.reactFlow.setCenter).not.toHaveBeenCalled();
  });
});

describe("resolveSeededFocus (pure bring-into-view decision)", () => {
  const origin = { x: 0, y: 0, zoom: 1 };

  test("returns the node center when it sits outside the pane", () => {
    expect(
      resolveSeededFocus(
        { position: { x: 2000, y: 0 }, measured: { width: 224, height: 72 } },
        origin,
        800,
        600,
      ),
    ).toEqual({ x: 2112, y: 36 });
  });

  test("returns null when the center is inside the pane (no camera move)", () => {
    expect(
      resolveSeededFocus(
        { position: { x: 100, y: 100 }, measured: { width: 224, height: 72 } },
        origin,
        800,
        600,
      ),
    ).toBeNull();
  });

  test("judges visibility in SCREEN space — pan and zoom count", () => {
    const node = { position: { x: 2000, y: 0 }, measured: { width: 224, height: 72 } };
    // Panned so the node lands mid-pane → visible → null.
    expect(resolveSeededFocus(node, { x: -1800, y: 100, zoom: 1 }, 800, 600)).toBeNull();
    // Zoomed out far enough that x2112 lands inside the pane → visible → null.
    expect(resolveSeededFocus(node, { x: 0, y: 100, zoom: 0.25 }, 800, 600)).toBeNull();
  });

  test("falls back to the layout dims when the node is unmeasured", () => {
    // NODE_WIDTH 224 / NODE_HEIGHT_ESTIMATE 72 → the same center as the measured twin.
    expect(resolveSeededFocus({ position: { x: 2000, y: 0 } }, origin, 800, 600)).toEqual({
      x: 2112,
      y: 36,
    });
  });

  test("an unmeasured pane (0×0) is a no-op", () => {
    expect(resolveSeededFocus({ position: { x: 2000, y: 0 } }, origin, 0, 0)).toBeNull();
  });
});
