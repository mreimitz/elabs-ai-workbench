import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@elabs-ai/components-ui";
import type { Skill, SkillGraph, SkillVersion } from "@mcp-token-footprint/shared";
import { formatVersionLabel, SkillInspector } from "../SkillInspector";
import { readPanelCollapsed, writePanelCollapsed } from "./UnifiedEditor";

// ── SI13 + SI16 chrome — the inspector-hosted save cluster and the collapsible Design panels ───────
// A full-mount SkillInspector harness with the API layer mocked at the fetch-wrapper seam, the
// sibling tabs stubbed to nulls, and Monaco/canvas kept out of jsdom. What stays REAL is the chain
// under test: SkillInspector (header slot, version labels) → SkillDesignView → UnifiedEditor (save
// cluster registration, resizable/collapsible flow panels) → ToolsPalette / NodeDetailPanel.

const SKILL_MD = [
  "# Demo skill",
  "",
  "Intro text.",
  "",
  "## Do the thing",
  "",
  "Body line one.",
  "Body line two.",
  "",
].join("\n");

const GRAPH: SkillGraph = {
  nodes: [
    {
      id: "sec-1",
      kind: "subroutine",
      label: "Do the thing",
      source: "inferred",
      anchor: { headingPath: ["Do the thing"], startLine: 5, endLine: 8 },
    },
  ],
  edges: [],
  warnings: [],
};

const SKILL: Skill = {
  id: "sk-1",
  name: "demo",
  displayName: "Demo skill",
  slug: "demo",
  sourceType: "upload",
  description: "A demo",
  currentVersionId: "ver-2",
  versionCount: 2,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

const makeVersion = (id: string, seq: number, versionLabel: string): SkillVersion => ({
  id,
  skillId: "sk-1",
  seq,
  versionLabel,
  treeSha: `sha-${seq}`,
  sourceKind: "upload",
  manifest: { name: "demo", description: "A demo" },
  manifestValid: true,
  manifestErrors: [],
  fileCount: 1,
  totalBytes: 128,
  importedFrom: "upload",
  createdAt: "2026-07-01T00:00:00.000Z",
  tokenProfile: "generic_o200k",
  l1MetadataTokens: 5,
  l2BodyTokens: 20,
  l3ResourceTokens: 0,
  totalTokens: 25,
});

// The API's editor-save fallback label is exactly `v{seq}` — the owner-spotted "v2 · v2" case.
const VERSIONS = [makeVersion("ver-2", 2, "v2"), makeVersion("ver-1", 1, "one")];

vi.mock("../skills-inspector-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../skills-inspector-api")>();
  return {
    ...actual,
    getSkill: vi.fn(async () => SKILL),
    listSkillVersions: vi.fn(async () => VERSIONS),
    getSkillVersion: vi.fn(
      async (_skillId: string, versionId: string) =>
        VERSIONS.find((v) => v.id === versionId) ?? VERSIONS[0],
    ),
    getSkillFiles: vi.fn(async () => []),
    getSkillFile: vi.fn(async () => ({
      path: "SKILL.md",
      isBinary: false as const,
      text: SKILL_MD,
      tokenTotal: 25,
    })),
    getSkillGraph: vi.fn(async () => ({ graph: GRAPH, warnings: [] })),
    getSkillUpstreamSafe: vi.fn(async () => null),
    getToolDiagnostics: vi.fn(async () => ({ diagnostics: [] })),
    getQualityReport: vi.fn(async () => {
      throw new Error("no quality report in this harness");
    }),
  };
});

vi.mock("../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api")>();
  return {
    ...actual,
    apiGet: vi.fn(async () => []),
    apiPost: vi.fn(async (path: string, body: unknown) => {
      if (path === "/api/skillflow/apply-preview") {
        const request = body as { content: string };
        return { content: `${request.content}\n## New part\n` };
      }
      if (path === "/api/skillflow/project-preview") return { graph: GRAPH, warnings: [] };
      throw new Error(`unexpected apiPost ${path}`);
    }),
    pullSkill: vi.fn(),
  };
});

vi.mock("../use-bound-tools", () => ({
  useBoundTools: () => ({ boundTools: [], loading: false, error: null }),
  registerBoundToolProviders: vi.fn(() => ({ dispose: vi.fn() })),
}));

// Monaco / code-intel never enter jsdom.
vi.mock("@elabs-ai/components-editor", () => ({ CodeEditor: () => null }));
vi.mock("./code-intel", () => ({
  registerCodeIntel: vi.fn(() => ({
    dispose: vi.fn(),
    setGraph: vi.fn(),
    setBoundTools: vi.fn(),
    setFilePaths: vi.fn(),
  })),
}));

// The React Flow canvas itself stays out of jsdom; buildFlow/ExplainerLegend remain real.
vi.mock("./SkillGraphCanvas", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./SkillGraphCanvas")>();
  return { ...actual, SkillGraphCanvas: () => <div data-testid="canvas" /> };
});

// Sibling tabs / dialogs that aren't under test.
vi.mock("../SkillOverview", () => ({ SkillOverview: () => null }));
vi.mock("../SkillUsageTab", () => ({ SkillUsageTab: () => null }));
vi.mock("../trace/SkillTraceView", () => ({ SkillTraceView: () => null }));
vi.mock("../quality/QualityView", () => ({ QualityView: () => null }));
vi.mock("../SkillFileExplorer", () => ({ SkillFileExplorer: () => null }));
vi.mock("../SkillVersions", () => ({ SkillVersions: () => null }));
vi.mock("../SkillDiffView", () => ({ SkillDiffView: () => null }));
vi.mock("../PublishGithubDialog", () => ({ PublishGithubDialog: () => null }));
vi.mock("./ToolRunnerSheet", () => ({ ToolRunnerSheet: () => null }));

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

const renderInspector = () =>
  render(
    <MemoryRouter>
      <TooltipProvider>
        <SkillInspector skillId="sk-1" />
      </TooltipProvider>
    </MemoryRouter>,
  );

/** Radix TabsTrigger activates on mousedown (and keyboard) — click alone doesn't switch it. */
const activateTab = (name: string) => {
  const tab = screen.getByRole("tab", { name });
  fireEvent.mouseDown(tab, { button: 0 });
  fireEvent.click(tab);
};

const openDesignTab = async () => {
  await screen.findByRole("tab", { name: "Design" });
  activateTab("Design");
  // The Design surface is mounted once its save cluster registers into the header slot.
  return await screen.findByTestId("design-save-cluster");
};

beforeEach(() => {
  window.localStorage.clear();
});

describe("formatVersionLabel (SI13 — the duplicated 'v5 · v5' select label)", () => {
  test("drops a versionLabel that merely repeats v{seq} (the editor-save fallback)", () => {
    expect(formatVersionLabel({ seq: 5, versionLabel: "v5" })).toBe("v5");
    expect(formatVersionLabel({ seq: 5, versionLabel: "V5" })).toBe("v5");
    expect(formatVersionLabel({ seq: 5, versionLabel: " v5 " })).toBe("v5");
  });

  test("keeps a label that adds information", () => {
    expect(formatVersionLabel({ seq: 5, versionLabel: "stable" })).toBe("v5 · stable");
    expect(formatVersionLabel({ seq: 3, versionLabel: "abc1234" })).toBe("v3 · abc1234");
  });

  test("an empty/blank label falls back to v{seq} alone", () => {
    expect(formatVersionLabel({ seq: 2, versionLabel: "" })).toBe("v2");
    expect(formatVersionLabel({ seq: 2, versionLabel: "   " })).toBe("v2");
  });
});

describe("panel-collapsed persistence helpers (SI16)", () => {
  test("round-trips per-panel flags under distinct keys", () => {
    expect(readPanelCollapsed("tools")).toBe(false);
    writePanelCollapsed("tools", true);
    expect(readPanelCollapsed("tools")).toBe(true);
    expect(readPanelCollapsed("detail")).toBe(false);
    writePanelCollapsed("tools", false);
    expect(readPanelCollapsed("tools")).toBe(false);
  });
});

// O2b (2026-07-06): the Design tab is HIDDEN (the visual-design surface is parked — roadmap Phase 7).
// These two suites drive the Design surface THROUGH the inspector UI (open the "Design" tab), which no
// longer exists, so they're skipped until Design returns. The Design components keep their own unit
// tests (SkillGraphCanvas.*, code-intel/*, graph-layout, frontmatter-servers, ProblemsPanel). The
// SI13 label + SI16 persistence-helper suites above stay active (they don't touch the tab).
describe.skip("SkillInspector header save cluster (SI13) — parked with the Design tab (O2b)", () => {
  test("no cluster off the Design tab; on Design it lands in the HEADER action row", async () => {
    renderInspector();
    await screen.findByRole("tab", { name: "Design" });
    // Overview (the initial tab) — the Design surface isn't mounted, so no cluster anywhere.
    expect(screen.queryByTestId("design-save-cluster")).toBeNull();

    const cluster = await openDesignTab();
    expect(cluster).toHaveTextContent("No unsaved changes");
    // It sits in the PageHeader action row — the same container as the header's own actions.
    const publish = screen.getByRole("button", { name: /Publish to GitHub/ });
    expect(cluster.parentElement).toBe(publish.parentElement);
  });

  test("dirty → chip + Discard + Save… (in the header, not duplicated in the toolbar); discard on tab-switch removes it", async () => {
    renderInspector();
    const cluster = await openDesignTab();

    // Stage an edit through the real Add-section flow.
    fireEvent.click(screen.getByRole("button", { name: /Add section/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Title"), {
      target: { value: "New part" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /Add section/ }));

    await within(cluster).findByText("1 unsaved change");
    const discardButtons = screen.getAllByRole("button", { name: "Discard unsaved changes" });
    expect(discardButtons).toHaveLength(1); // header only — the IDE toolbar no longer repeats it
    expect(within(cluster).getByRole("button", { name: "Save…" })).toBeInTheDocument();
    expect(
      within(cluster).getByRole("button", { name: "Discard unsaved changes" }),
    ).toBeInTheDocument();

    // Navigating away while dirty runs the existing guard; confirming discards and the cluster
    // leaves the header with the surface — unsaved state is never silently carried invisible.
    activateTab("Files");
    const guard = await screen.findByRole("alertdialog");
    fireEvent.click(within(guard).getByRole("button", { name: "Discard changes" }));
    await waitFor(() => expect(screen.queryByTestId("design-save-cluster")).toBeNull());
  });
});

describe.skip("Design side panels collapse/expand + persistence (SI16) — parked with the Design tab (O2b)", () => {
  test("Tools collapses to a rail (chevron), reopens from the rail, and persists the flag", async () => {
    renderInspector();
    await openDesignTab();

    // Expanded: the palette header + its collapse chevron are present.
    const collapseTools = await screen.findByRole("button", { name: "Collapse the Tools panel" });
    expect(screen.getByRole("heading", { name: "Tools" })).toBeInTheDocument();

    fireEvent.click(collapseTools);
    const rail = await screen.findByRole("button", { name: "Expand the Tools panel" });
    expect(screen.queryByRole("heading", { name: "Tools" })).toBeNull();
    expect(readPanelCollapsed("tools")).toBe(true);

    fireEvent.click(rail);
    await screen.findByRole("heading", { name: "Tools" });
    expect(readPanelCollapsed("tools")).toBe(false);
  });

  test("Node details collapses via its header chevron and persists", async () => {
    renderInspector();
    await openDesignTab();

    const collapseDetail = await screen.findByRole("button", {
      name: "Collapse the Node details panel",
    });
    expect(screen.getByRole("heading", { name: "Node details" })).toBeInTheDocument();

    fireEvent.click(collapseDetail);
    await screen.findByRole("button", { name: "Expand the Node details panel" });
    expect(screen.queryByRole("heading", { name: "Node details" })).toBeNull();
    expect(readPanelCollapsed("detail")).toBe(true);
  });

  test("a persisted collapsed flag restores the rail on a FRESH mount", async () => {
    writePanelCollapsed("detail", true);
    renderInspector();
    await openDesignTab();

    await screen.findByRole("button", { name: "Expand the Node details panel" });
    expect(screen.queryByRole("heading", { name: "Node details" })).toBeNull();
    // The other panel is unaffected — keys are per panel.
    expect(screen.getByRole("heading", { name: "Tools" })).toBeInTheDocument();
  });
});
