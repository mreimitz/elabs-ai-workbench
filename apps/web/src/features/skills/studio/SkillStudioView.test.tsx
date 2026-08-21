import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { Button, TooltipProvider } from "@elabs-ai/components-ui";
import type { Skill, SkillFileNode, SkillGraph, SkillVersion } from "@mcp-token-footprint/shared";
import { SkillStudioView } from "./SkillStudioView";

// ── RM-30 WP 7.1 — the Studio shell, driven through the real route ────────────────────────────────
// A full mount of `/skills/:skillId/studio` with the API layer mocked at the fetch-wrapper seam and
// Monaco / the React Flow canvas kept out of jsdom. What stays REAL is the chain under test: the
// route → `StudioShell` (toolbar, rails, problems strip, exit guard) → `SkillDesignView` →
// `UnifiedEditor` (the WP's new host-chrome slots).

const SKILL_MD = ["# Demo skill", "", "## Do the thing", "", "Body line.", ""].join("\n");

const GRAPH: SkillGraph = {
  nodes: [
    {
      id: "sec-1",
      kind: "subroutine",
      label: "Do the thing",
      source: "inferred",
      anchor: { headingPath: ["Do the thing"], startLine: 3, endLine: 5 },
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

const makeVersion = (id: string, seq: number): SkillVersion => ({
  id,
  skillId: "sk-1",
  seq,
  versionLabel: `v${seq}`,
  treeSha: `sha-${seq}`,
  sourceKind: "upload",
  manifest: { name: "demo", description: "A demo" },
  manifestValid: true,
  manifestErrors: [],
  fileCount: 2,
  totalBytes: 128,
  importedFrom: "upload",
  createdAt: "2026-07-01T00:00:00.000Z",
  tokenProfile: "generic_o200k",
  l1MetadataTokens: 5,
  l2BodyTokens: 20,
  l3ResourceTokens: 0,
  totalTokens: 25,
});

const VERSIONS = [makeVersion("ver-2", 2), makeVersion("ver-1", 1)];

const FILES: SkillFileNode[] = [
  { path: "SKILL.md", isSkillMd: true, isBinary: false, sizeBytes: 64, tokenTotal: 20 },
  {
    path: "references/api.md",
    isSkillMd: false,
    isBinary: false,
    sizeBytes: 32,
    tokenTotal: 5,
  },
];

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
    getSkillFiles: vi.fn(async () => FILES),
    getSkillFile: vi.fn(async () => ({
      path: "SKILL.md",
      isBinary: false as const,
      text: SKILL_MD,
      tokenTotal: 20,
    })),
    getSkillGraph: vi.fn(async () => ({ graph: GRAPH, projectorVersion: 1 })),
    getToolDiagnostics: vi.fn(async () => ({ diagnostics: [] })),
    getQualityReport: vi.fn(async () => {
      throw new Error("no quality report in this harness");
    }),
    fetchSkillBindings: vi.fn(async () => []),
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
  };
});

vi.mock("../use-bound-tools", () => ({
  useBoundTools: () => ({ boundTools: [], loading: false, error: null }),
  registerBoundToolProviders: vi.fn(() => ({ dispose: vi.fn() })),
}));

// Monaco / code-intel never enter jsdom.
vi.mock("@elabs-ai/components-editor", () => ({ CodeEditor: () => null }));
vi.mock("../design/code-intel", () => ({
  registerCodeIntel: vi.fn(() => ({
    dispose: vi.fn(),
    setGraph: vi.fn(),
    setBoundTools: vi.fn(),
    setFilePaths: vi.fn(),
  })),
}));

// The React Flow canvas stays out of jsdom; `buildFlow`/`ExplainerLegend` remain real. The stub
// keeps the two halves of the canvas's CONTRACT that the `?sel=` round-trip depends on: it reports a
// selection UP (`onSelectNode`) and it reflects the built nodes' `selected` flag back DOWN — so both
// directions of the shell's selection plumbing are exercised for real rather than assumed.
vi.mock("../design/SkillGraphCanvas", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../design/SkillGraphCanvas")>();
  return {
    ...actual,
    SkillGraphCanvas: ({
      nodes,
      onSelectNode,
    }: {
      nodes: Array<{ id: string; selected?: boolean }>;
      onSelectNode: (nodeId: string | undefined) => void;
    }) => (
      <div
        data-testid="canvas"
        data-selected={nodes
          .filter((node) => node.selected)
          .map((node) => node.id)
          .join(",")}
      >
        <Button size="sm" onClick={() => onSelectNode("sec-1")}>
          Select sec-1 (stub)
        </Button>
        <Button size="sm" onClick={() => onSelectNode(undefined)}>
          Clear selection (stub)
        </Button>
      </div>
    ),
  };
});

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

/** Publishes the live location so a test can assert what the URL round-tripped to. */
function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location">{`${location.pathname}${location.search}`}</div>
  );
}

const renderStudio = (initialEntry = "/skills/sk-1/studio") =>
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <TooltipProvider>
        <Routes>
          <Route path="/skills/:skillId/studio" element={<SkillStudioView />} />
          <Route path="/skills/:skillId" element={<div data-testid="inspector" />} />
        </Routes>
        <LocationProbe />
      </TooltipProvider>
    </MemoryRouter>,
  );

const url = () => screen.getByTestId("location").textContent ?? "";

/** The workbench is mounted once the centre surface and its toolbar exist. */
const waitForStudio = async () => {
  await screen.findByTestId("studio-center");
  await screen.findByRole("button", { name: "Exit" });
};

beforeEach(() => {
  window.localStorage.clear();
});

describe("the Studio shell (RM-30 WP 7.1)", () => {
  test("renders a usable workbench with ZERO query params (D-TB10)", async () => {
    renderStudio();
    await waitForStudio();

    // The slim toolbar: Exit · the view control · Problems · the editor's save cluster.
    expect(screen.getByRole("button", { name: "Exit" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Editor view" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Problems 0" })).toBeInTheDocument();
    await screen.findByTestId("design-save-cluster");

    // The mode toggle is the SHELL's — the editor must not render a second one.
    expect(screen.getAllByRole("radiogroup", { name: "Editor view" })).toHaveLength(1);

    // The URL is left clean: a default view writes nothing.
    expect(url()).toBe("/skills/sk-1/studio");
  });

  test("the left rail is open with Files·Tools·Settings; the context panel starts COLLAPSED", async () => {
    renderStudio();
    await waitForStudio();

    const rail = screen.getByTestId("studio-left-rail");
    expect(within(rail).getByRole("tab", { name: "Files" })).toBeInTheDocument();
    expect(within(rail).getByRole("tab", { name: "Tools" })).toBeInTheDocument();
    expect(within(rail).getByRole("tab", { name: "Settings" })).toBeInTheDocument();

    // Never a reserved blank column: the context panel is a slim strip until asked for.
    expect(screen.getByTestId("studio-context-panel-collapsed")).toBeInTheDocument();
    expect(screen.queryByTestId("studio-context-panel")).toBeNull();
  });

  test("the context panel opens, persists its state, and shows the selected node", async () => {
    renderStudio("/skills/sk-1/studio?sel=sec-1");
    await waitForStudio();

    fireEvent.click(screen.getByRole("button", { name: "Show the Context panel" }));
    await screen.findByTestId("studio-context-panel");
    // The `?sel=` node is what the panel is ABOUT — that is what makes the param meaningful.
    const node = await screen.findByTestId("studio-context-node");
    // The label appears twice on purpose (the node's own title, and its heading path).
    expect(within(node).getAllByText("Do the thing").length).toBeGreaterThan(0);
    expect(within(node).getByText("Sub-routine")).toBeInTheDocument();
    expect(within(node).getByText("3–5")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Hide the Context panel" }));
    await screen.findByTestId("studio-context-panel-collapsed");
  });

  test("the mode toggle round-trips through ?mode=", async () => {
    renderStudio();
    await waitForStudio();
    expect(url()).toBe("/skills/sk-1/studio");

    fireEvent.click(screen.getByRole("radio", { name: "Show code" }));
    await waitFor(() => expect(url()).toContain("mode=code"));

    fireEvent.click(screen.getByRole("radio", { name: "Split view" }));
    await waitFor(() => expect(url()).toContain("mode=split"));
  });

  test("?mode= from a cold load selects that view (the reload half of the round-trip)", async () => {
    renderStudio("/skills/sk-1/studio?mode=split");
    await waitForStudio();
    expect(screen.getByRole("radio", { name: "Split view" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("selecting a node on the canvas round-trips through ?sel=", async () => {
    renderStudio();
    await waitForStudio();
    expect(url()).not.toContain("sel=");

    fireEvent.click(await screen.findByRole("button", { name: "Select sec-1 (stub)" }));
    await waitFor(() => expect(url()).toContain("sel=sec-1"));

    // Clearing the selection CLEARS the param — it never strands an empty `sel=` on the URL.
    fireEvent.click(screen.getByRole("button", { name: "Clear selection (stub)" }));
    await waitFor(() => expect(url()).not.toContain("sel="));
  });

  test("?sel= from a cold load seeds the canvas selection (the reload half)", async () => {
    renderStudio("/skills/sk-1/studio?sel=sec-1");
    await waitForStudio();
    await waitFor(() =>
      expect(screen.getByTestId("canvas")).toHaveAttribute("data-selected", "sec-1"),
    );
  });

  test("selecting a file in the rail round-trips through ?file=", async () => {
    renderStudio();
    await waitForStudio();

    const rail = screen.getByTestId("studio-left-rail");
    fireEvent.click(await within(rail).findByText("api.md"));
    await waitFor(() => expect(url()).toContain("file=references%2Fapi.md"));

    // SKILL.md is the default, so re-selecting it CLEARS the param rather than pinning the default.
    fireEvent.click(within(rail).getByText("SKILL.md"));
    await waitFor(() => expect(url()).not.toContain("file="));
  });

  test("?file= from a cold load is the rail's selection", async () => {
    renderStudio("/skills/sk-1/studio?file=references%2Fapi.md");
    await waitForStudio();
    const rail = screen.getByTestId("studio-left-rail");
    const row = await within(rail).findByText("api.md");
    expect(row.closest('[aria-selected="true"]')).not.toBeNull();
  });

  test("the Files rail is BROWSE-ONLY here (the editable workspace is WP 7.4)", async () => {
    renderStudio();
    await waitForStudio();
    const rail = screen.getByTestId("studio-left-rail");
    expect(within(rail).queryByRole("button", { name: "New file" })).toBeNull();
    expect(within(rail).queryByRole("button", { name: "Delete" })).toBeNull();
  });

  test("the Problems strip is mounted ONCE, in the shell's bottom strip", async () => {
    renderStudio();
    await waitForStudio();

    const strip = await screen.findByTestId("studio-problems");
    expect(within(strip).getByTestId("problems-panel")).toBeInTheDocument();
    // Never twice: the editor hands its panel to the shell instead of also rendering it inline.
    expect(screen.getAllByTestId("problems-panel")).toHaveLength(1);

    // The toolbar's Problems control opens it (the panel's own trigger is named
    // "Problems — N items"; the toolbar's reads "Problems N").
    expect(screen.queryByTestId("problems-body")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Problems 0" }));
    await screen.findByTestId("problems-body");
  });

  test("Exit leaves for the inspector when the draft is clean", async () => {
    renderStudio();
    await waitForStudio();

    fireEvent.click(screen.getByRole("button", { name: "Exit" }));
    await screen.findByTestId("inspector");
    expect(url()).toBe("/skills/sk-1");
  });

  test("Exit with a DIRTY draft runs the existing discard guard", async () => {
    renderStudio();
    await waitForStudio();

    // Stage a real edit through the editor's own Add-section flow.
    fireEvent.click(screen.getByRole("button", { name: /Add section/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Title"), { target: { value: "New part" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Add section/ }));
    await screen.findByText("1 unsaved change");

    fireEvent.click(screen.getByRole("button", { name: "Exit" }));
    const guard = await screen.findByRole("alertdialog");
    expect(within(guard).getByText("Discard unsaved changes?")).toBeInTheDocument();

    // Keeping the draft stays put…
    fireEvent.click(within(guard).getByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.getByTestId("studio-center")).toBeInTheDocument();

    // …and confirming discards it and leaves.
    fireEvent.click(screen.getByRole("button", { name: "Exit" }));
    const guard2 = await screen.findByRole("alertdialog");
    fireEvent.click(within(guard2).getByRole("button", { name: "Discard changes" }));
    await screen.findByTestId("inspector");
  });
});
