import type { HubAgentRole, HubCrew } from "@mcp-token-footprint/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TooltipProvider } from "@brand/ui";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { makeCrew, makeRole } from "./test-fixtures";

// The tab's import chain now reaches the REAL `@brand/ai` (whose index.js imports
// `@xyflow/react/dist/style.css`, unresolvable under the jsdom ESM loader) — mock it with the shared
// hub stub, exactly as TopologyGraph.test / Mission.test do for the same chain.
vi.mock("@brand/ai", () => import("../../test-support/brand-ai-mock"));

// Mock the API module the tab (and the org rail it imports for `parseOrgRailScope`) pull from.
const listHubAgentRoles = vi.fn<() => Promise<HubAgentRole[]>>();
const listHubCrews = vi.fn<() => Promise<HubCrew[]>>();
vi.mock("../../../../lib/api", () => ({
  listHubAgentRoles: () => listHubAgentRoles(),
  listHubCrews: () => listHubCrews(),
}));

import {
  buildOrgProfilePath,
  isOrgNodeActivateKey,
  nodeNavigationTarget,
  orgNodeIdFromEventTarget,
  OrgChartTab,
  OrgInspectorBody,
} from "./OrgChartTab";
import type { OrgNodeMeta } from "./org-model";

beforeEach(() => {
  listHubAgentRoles.mockReset();
  listHubCrews.mockReset();
});

// ── Pure navigation helpers (interaction logic, canvas-independent) ───────────────────────────────

describe("nodeNavigationTarget", () => {
  test("resolves an agent / crew node; a lane node navigates nowhere", () => {
    expect(nodeNavigationTarget({ kind: "agent", nodeId: "n", agentId: "a", identity: "A", roleTitle: "", model: "", archived: false })).toEqual({ kind: "agent", id: "a" });
    expect(nodeNavigationTarget({ kind: "crew", nodeId: "n", crewId: "k", crewName: "K", topology: "pipeline", memberCount: 1 })).toEqual({ kind: "crew", id: "k" });
    expect(nodeNavigationTarget({ kind: "lane", nodeId: "n", laneId: "unassigned", title: "Unassigned", count: 2 })).toBeNull();
    expect(nodeNavigationTarget(undefined)).toBeNull();
  });

  // Crew nesting (WP4.2 / D-CN8) — a "sub-crew" node navigates EXACTLY like a top-level "crew" node
  // (route reuse, no new `<Route>`); a placeholder (cycle/missing) node has nothing to open.
  test("a 'sub-crew' node returns the crew's own profile target; a 'placeholder' node navigates nowhere", () => {
    expect(
      nodeNavigationTarget({
        kind: "sub-crew",
        nodeId: "n",
        crewId: "sub-1",
        crewName: "Sub",
        topology: "pipeline",
        memberCount: 1,
        parentCrewId: "top-1",
      }),
    ).toEqual({ kind: "crew", id: "sub-1" });
    expect(
      nodeNavigationTarget({ kind: "placeholder", nodeId: "n", reason: "cycle", label: "Circular reference" }),
    ).toBeNull();
    expect(
      nodeNavigationTarget({ kind: "placeholder", nodeId: "n", reason: "missing", label: "Deleted crew" }),
    ).toBeNull();
  });
});

describe("buildOrgProfilePath", () => {
  test("targets the {agent|crew}/:id route, preserving tab+scope and adding settings=profile", () => {
    const { pathname, search } = buildOrgProfilePath({ kind: "agent", id: "abc" }, "tab=org&scope=crew:k1");
    expect(pathname).toBe("/assistant/agents/agent/abc");
    const params = new URLSearchParams(search);
    expect(params.get("tab")).toBe("org");
    expect(params.get("scope")).toBe("crew:k1");
    expect(params.get("settings")).toBe("profile");
  });

  test("crew target", () => {
    expect(buildOrgProfilePath({ kind: "crew", id: "k9" }, "").pathname).toBe("/assistant/agents/crew/k9");
  });
});

// ── Keyboard node parity (WP4.2 / WP2.R) — canvas-independent DOM + model resolution ──────────────

describe("orgNodeIdFromEventTarget", () => {
  function reactFlowNode(id: string): { node: HTMLElement; inner: HTMLElement } {
    const node = document.createElement("div");
    node.className = "react-flow__node react-flow__node-brand";
    node.setAttribute("data-id", id);
    const inner = document.createElement("span");
    node.appendChild(inner);
    return { node, inner };
  }

  test("resolves the node id from the focused element or a descendant of the React Flow node", () => {
    const { node, inner } = reactFlowNode("agent:a1");
    expect(orgNodeIdFromEventTarget(node)).toBe("agent:a1");
    expect(orgNodeIdFromEventTarget(inner)).toBe("agent:a1");
  });

  test("returns null for canvas chrome (a zoom control, the pane) and non-elements", () => {
    const zoomButton = document.createElement("button"); // ZoomControls / minimap — not a node
    expect(orgNodeIdFromEventTarget(zoomButton)).toBeNull();
    expect(orgNodeIdFromEventTarget(null)).toBeNull();
    // A node element MISSING data-id is not a valid selection target either.
    const bare = document.createElement("div");
    bare.className = "react-flow__node";
    expect(orgNodeIdFromEventTarget(bare)).toBeNull();
  });
});

describe("isOrgNodeActivateKey", () => {
  test("Enter and Space activate a focused node (mirroring the mouse double-click); other keys don't", () => {
    expect(isOrgNodeActivateKey("Enter")).toBe(true);
    expect(isOrgNodeActivateKey(" ")).toBe(true);
    expect(isOrgNodeActivateKey("Spacebar")).toBe(true);
    expect(isOrgNodeActivateKey("Tab")).toBe(false);
    expect(isOrgNodeActivateKey("Escape")).toBe(false);
    expect(isOrgNodeActivateKey("a")).toBe(false);
  });
});

describe("keyboard activation resolves to the same nav target as the mouse double-click", () => {
  // The exact composition the capture handler runs: DOM node id → model meta → nav target. Asserts
  // the MODEL/NAV (not canvas geometry): a keyboard-activated agent/crew node opens its profile; a
  // lane node opens nothing — identical to `onNodeDoubleClick`.
  const meta = new Map<string, OrgNodeMeta>([
    ["agent:a1", { kind: "agent", nodeId: "agent:a1", agentId: "a1", identity: "Nova", roleTitle: "", model: "", archived: false }],
    ["crew:k", { kind: "crew", nodeId: "crew:k", crewId: "k", crewName: "K", topology: "pipeline", memberCount: 1 }],
    ["lane:unassigned", { kind: "lane", nodeId: "lane:unassigned", laneId: "unassigned", title: "Unassigned", count: 2 }],
  ]);

  function focusEventTargetFor(id: string): HTMLElement {
    const node = document.createElement("div");
    node.className = "react-flow__node";
    node.setAttribute("data-id", id);
    return node;
  }

  test("an agent node → agent profile; a crew node → crew profile; a lane node → nowhere", () => {
    const agentId = orgNodeIdFromEventTarget(focusEventTargetFor("agent:a1"));
    expect(nodeNavigationTarget(meta.get(agentId ?? ""))).toEqual({ kind: "agent", id: "a1" });

    const crewId = orgNodeIdFromEventTarget(focusEventTargetFor("crew:k"));
    expect(nodeNavigationTarget(meta.get(crewId ?? ""))).toEqual({ kind: "crew", id: "k" });

    const laneId = orgNodeIdFromEventTarget(focusEventTargetFor("lane:unassigned"));
    expect(nodeNavigationTarget(meta.get(laneId ?? ""))).toBeNull();
  });
});

// ── Inspector body (interaction test — the "Open profile" action) ─────────────────────────────────

describe("OrgInspectorBody", () => {
  test("an agent summary opens the agent profile", async () => {
    const onOpen = vi.fn();
    const meta: OrgNodeMeta = {
      kind: "agent",
      nodeId: "n",
      agentId: "a1",
      identity: "Nova",
      roleTitle: "Researcher",
      model: "gpt-4o",
      topologyRole: "Stage 1",
      crewName: "Alpha",
      crewColor: "chart-1",
      archived: false,
    };
    render(<OrgInspectorBody meta={meta} onOpenProfile={onOpen} />);
    expect(screen.getByText("Researcher")).toBeInTheDocument();
    expect(screen.getByText("gpt-4o")).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /open agent profile/i }));
    expect(onOpen).toHaveBeenCalledWith({ kind: "agent", id: "a1" });
  });

  test("a crew summary shows its topology + opens the crew profile", async () => {
    const onOpen = vi.fn();
    const meta: OrgNodeMeta = {
      kind: "crew",
      nodeId: "crew:k",
      crewId: "k",
      crewName: "Alpha",
      topology: "best_of_n",
      memberCount: 3,
      color: "chart-2",
    };
    render(<OrgInspectorBody meta={meta} onOpenProfile={onOpen} />);
    expect(screen.getByText("Best of N")).toBeInTheDocument();
    expect(screen.getByText(/converge on the aggregator/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /open crew profile/i }));
    expect(onOpen).toHaveBeenCalledWith({ kind: "crew", id: "k" });
  });

  // Crew nesting (WP4.2 / D-CN8) — a "sub-crew" body is identical to "crew"'s, plus a "Nested in
  // <parentCrewName>" line (resolved by the caller and passed in, since this component only ever sees
  // the one selected node's own meta).
  test("a sub-crew summary shows its topology, names its parent crew, and opens the crew profile", () => {
    const onOpen = vi.fn();
    const meta: OrgNodeMeta = {
      kind: "sub-crew",
      nodeId: "crew:top>sub",
      crewId: "sub",
      crewName: "Intel Squad",
      topology: "parallel",
      memberCount: 2,
      parentCrewId: "top",
    };
    render(<OrgInspectorBody meta={meta} onOpenProfile={onOpen} parentCrewName="Research Team" />);
    expect(screen.getByText("Parallel")).toBeInTheDocument();
    expect(screen.getByText("Nested in Research Team")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /open crew profile/i }));
    expect(onOpen).toHaveBeenCalledWith({ kind: "crew", id: "sub" });
  });

  // Crew nesting (WP4.2 / D-CN8) — a placeholder (cycle/missing) body explains why, with no
  // "Open profile" action — there is nothing to open.
  test("a cycle placeholder body explains the loop and offers no 'Open profile' action", () => {
    const onOpen = vi.fn();
    const meta: OrgNodeMeta = { kind: "placeholder", nodeId: "n", reason: "cycle", label: "Circular reference" };
    render(<OrgInspectorBody meta={meta} onOpenProfile={onOpen} />);
    expect(screen.getByText("Circular reference")).toBeInTheDocument();
    expect(screen.getByText(/loop/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open .* profile/i })).not.toBeInTheDocument();
  });

  test("a missing-crew placeholder body explains the dangling reference", () => {
    const onOpen = vi.fn();
    const meta: OrgNodeMeta = { kind: "placeholder", nodeId: "n", reason: "missing", label: "Deleted crew · abcdef" };
    render(<OrgInspectorBody meta={meta} onOpenProfile={onOpen} />);
    expect(screen.getByText("Missing crew")).toBeInTheDocument();
    expect(screen.getByText(/no longer exists/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open .* profile/i })).not.toBeInTheDocument();
  });
});

// ── Tab render (fetch → model → canvas + legend + inspector) ─────────────────────────────────────

function renderTab(scope = "") {
  const search = scope ? `?scope=${encodeURIComponent(scope)}` : "";
  return render(
    <MemoryRouter initialEntries={[`/assistant/agents${search}`]}>
      <OrgChartTab />
    </MemoryRouter>,
  );
}

describe("OrgChartTab", () => {
  test("fetches, builds the model, and renders the legend for the present topology", async () => {
    listHubAgentRoles.mockResolvedValue([makeRole("a"), makeRole("b")]);
    listHubCrews.mockResolvedValue([makeCrew("k1", "pipeline", ["a", "b"], { name: "Alpha", color: "chart-1" })]);
    renderTab();
    // The legend (a Flow Panel, not canvas geometry) proves the model was built + rendered.
    expect(await screen.findByText("Pipeline")).toBeInTheDocument();
    // The InspectorPanel empty prompt renders alongside the canvas.
    expect(screen.getByText(/Select an agent or crew/i)).toBeInTheDocument();
  });

  test("a fleet with no agents renders a real EmptyState, not a blank canvas", async () => {
    listHubAgentRoles.mockResolvedValue([]);
    listHubCrews.mockResolvedValue([]);
    renderTab();
    expect(await screen.findByText(/Nothing to chart yet/i)).toBeInTheDocument();
  });

  test("surfaces a load failure with a retry", async () => {
    listHubAgentRoles.mockRejectedValue(new Error("boom"));
    listHubCrews.mockResolvedValue([]);
    renderTab();
    expect(await screen.findByText(/Couldn’t load the org chart/i)).toBeInTheDocument();
  });
});

// ── ui-wave U5 (owner feedback) — P0 regression: a crew scope must not crash the tab ──────────────

describe("OrgChartTab — crew scope (ui-wave U5 P0 regression)", () => {
  test("?scope=crew:<id> renders the scoped crew's nodes without an update-depth loop (React #185)", async () => {
    // The bug: `parseOrgRailScope` built a FRESH scope object every render, the model/decoratedNodes
    // memos keyed on it re-derived every render, and the canvas re-seed effect then called setNodes
    // with a brand-new array each time — an unconditional update-per-render loop that hit React's
    // maximum update depth (minified #185) for any non-default scope. The spy is silenced so the
    // (expected-absent) React error noise stays out of the runner output while still assertable.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      listHubAgentRoles.mockResolvedValue([
        makeRole("a", { name: "Scout" }),
        makeRole("b", { name: "Scribe" }),
      ]);
      listHubCrews.mockResolvedValue([
        makeCrew("k1", "pipeline", ["a", "b"], { name: "Alpha", color: "chart-1" }),
        makeCrew("k2", "parallel", ["b"], { name: "Beta" }),
      ]);
      renderTab("crew:k1");

      // The scoped crew's member nodes reach the DOM — the model was built AND seeded the canvas.
      expect(await screen.findByText("Scout")).toBeInTheDocument();
      expect(screen.getByText("Scribe")).toBeInTheDocument();
      // Scoped to k1 only — the other crew's container is filtered out of the chart.
      expect(screen.queryByText(/Beta/)).not.toBeInTheDocument();

      const depthErrors = errorSpy.mock.calls.filter((args) =>
        args.some((arg) => String(arg).includes("Maximum update depth")),
      );
      expect(depthErrors).toEqual([]);
    } finally {
      errorSpy.mockRestore();
    }
  });
});

// ── Slot-fill: WorkforceView mounts OrgChartTab in its orgChartTab slot ───────────────────────────

describe("WorkforceView orgChartTab slot", () => {
  test("the org tab renders the chart when passed as the slot", async () => {
    listHubAgentRoles.mockResolvedValue([makeRole("a")]);
    listHubCrews.mockResolvedValue([makeCrew("k1", "parallel", ["a"], { name: "Beta" })]);
    // Import here so the api mock is installed first.
    const { WorkforceView } = await import("../WorkforceView");
    render(
      // WorkforceView now mounts a Radix Tooltip via ViewToolbar `info` (WP 1.2) — the app root
      // supplies a TooltipProvider, so wrap the render the same way the real tree does.
      <TooltipProvider>
        <MemoryRouter initialEntries={["/assistant/agents?tab=org"]}>
          <Routes>
            <Route path="/assistant/agents" element={<WorkforceView orgChartTab={<OrgChartTab />} />} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>,
    );
    // The org tab is active → the chart's legend renders (Beta has no color, so the topology row shows).
    expect(await screen.findByText("Parallel")).toBeInTheDocument();
  });
});
