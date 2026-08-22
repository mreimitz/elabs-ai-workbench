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
  {
    path: "SKILL.md",
    isSkillMd: true,
    isBinary: false,
    size: 64,
    kind: "skill_md",
    tokenTotal: 20,
  },
  {
    path: "references/api.md",
    isSkillMd: false,
    isBinary: false,
    size: 32,
    kind: "reference",
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
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
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

    // The slim toolbar: Exit · Problems · the editor's save cluster. RM-30 WP 7.9 removed the view
    // control from it — see the "the mode axis is GONE" block below.
    expect(screen.getByRole("button", { name: "Exit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Problems 0" })).toBeInTheDocument();
    await screen.findByTestId("design-save-cluster");

    // Zero params lands on the DESIGNER, and it is a real surface (the canvas), not a blank pane.
    const tabs = await screen.findByRole("tablist", { name: "Open files" });
    expect(within(tabs).getByRole("tab", { name: "Designer" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await screen.findByTestId("canvas")).toBeInTheDocument();

    // The URL is left clean: a default view writes nothing.
    expect(url()).toBe("/skills/sk-1/studio");
  });

  test("the left rail is open with Files·Components·Settings; the context panel starts COLLAPSED", async () => {
    renderStudio();
    await waitForStudio();

    const rail = screen.getByTestId("studio-left-rail");
    // RM-30 WP 7.9 paid WP 7.7's recorded debt: the TAB reads "Components", matching the panel it
    // opens. There is no tab called "Tools" any more.
    expect(within(rail).getByRole("tab", { name: "Files" })).toBeInTheDocument();
    expect(within(rail).getByRole("tab", { name: "Components" })).toBeInTheDocument();
    expect(within(rail).getByRole("tab", { name: "Settings" })).toBeInTheDocument();
    expect(within(rail).queryByRole("tab", { name: "Tools" })).toBeNull();

    // The tabs are STACKED, which is what makes the longer label fit at all: measured in Chromium at
    // 1600×1000 the label needs 105.17px, a three-way horizontal split of this rail leaves ~54px,
    // and the full-width stack gives 163.05px. jsdom has no layout engine, so the pixels are the
    // browser's job — what is pinned here is the orientation those pixels depend on, so putting the
    // strip back in a row has to be a deliberate change and not an accident.
    expect(within(rail).getByRole("tablist")).toHaveAttribute("aria-orientation", "vertical");

    // Never a reserved blank column: the context panel is a slim strip until asked for.
    expect(screen.getByTestId("studio-context-panel-collapsed")).toBeInTheDocument();
    expect(screen.queryByTestId("studio-context-panel")).toBeNull();
  });

  test("a legacy ?rail=tools link still opens the Components tab", async () => {
    renderStudio("/skills/sk-1/studio?rail=tools");
    await waitForStudio();
    const rail = screen.getByTestId("studio-left-rail");
    await waitFor(() =>
      expect(within(rail).getByRole("tab", { name: "Components" })).toHaveAttribute(
        "aria-selected",
        "true",
      ),
    );
    // And the palette is actually mounted under it, not just the tab selected.
    expect(await screen.findByRole("heading", { name: "Components" })).toBeInTheDocument();
  });

  test("the context panel opens onto the editor's OWN Node details panel, and collapses again", async () => {
    renderStudio("/skills/sk-1/studio?sel=sec-1");
    await waitForStudio();

    fireEvent.click(screen.getByRole("button", { name: "Show the Context panel" }));
    const panel = await screen.findByTestId("studio-context-panel");
    // Portalled in from the editor, not re-implemented here — so it is the live, editable panel and
    // it is the ONLY one on screen (the centre surface no longer carries a second copy).
    await waitFor(() =>
      expect(within(panel).getByRole("heading", { name: "Node details" })).toBeInTheDocument(),
    );
    expect(screen.getAllByRole("heading", { name: "Node details" })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Hide the Context panel" }));
    await screen.findByTestId("studio-context-panel-collapsed");
  });

  // RM-30 WP 7.7 renamed the PANEL to "Components"; the rail TAB still reads "Tools" (the label did
  // not fit a three-way split of the 184px rail — see the note in StudioLeftRail.tsx).
  test("the Components palette lives in the rail ONLY — the centre surface is the canvas alone", async () => {
    renderStudio();
    await waitForStudio();

    // Not mounted while the Files tab is active (Radix unmounts inactive tab content).
    expect(screen.queryByRole("heading", { name: "Components" })).toBeNull();

    const rail = screen.getByTestId("studio-left-rail");
    fireEvent.mouseDown(within(rail).getByRole("tab", { name: "Components" }), { button: 0 });
    fireEvent.click(within(rail).getByRole("tab", { name: "Components" }));

    const palette = await screen.findByRole("heading", { name: "Components" });
    expect(rail.contains(palette)).toBe(true);
    // Exactly one palette — the editor portals its own in rather than the shell mounting a copy.
    expect(screen.getAllByRole("heading", { name: "Components" })).toHaveLength(1);
  });

  // ── RM-30 WP 7.9 (D-UX19 #2) — the mode axis is GONE, not moved ────────────────────────────────
  // "Designer = visual, Files = source": the surface follows the open tab, so there is no control to
  // pick a view with and no `?mode=` to carry one.

  test("no view control renders anywhere in the Studio", async () => {
    renderStudio();
    await waitForStudio();
    expect(screen.queryByRole("radiogroup", { name: "Editor view" })).toBeNull();
    expect(screen.queryByRole("radio", { name: /Show flow|Show code|Split view/ })).toBeNull();
  });

  test("the SURFACE follows the tab: Designer ⇄ SKILL.md, carried by ?file= alone", async () => {
    renderStudio();
    await waitForStudio();
    expect(url()).toBe("/skills/sk-1/studio");
    expect(await screen.findByTestId("canvas")).toBeInTheDocument();

    const rail = screen.getByTestId("studio-left-rail");
    fireEvent.click(await within(rail).findByText("SKILL.md"));

    // SKILL.md is written EXPLICITLY now — it is a file tab, not the absent default.
    await waitFor(() => expect(url()).toContain("file=SKILL.md"));
    expect(url()).not.toContain("mode=");
    const tabs = screen.getByRole("tablist", { name: "Open files" });
    await waitFor(() =>
      expect(within(tabs).getByRole("tab", { name: /SKILL\.md/ })).toHaveAttribute(
        "aria-selected",
        "true",
      ),
    );
    // The canvas is gone: one surface at a time, never two views of one document side by side.
    await waitFor(() => expect(screen.queryByTestId("canvas")).toBeNull());

    // …and back to the Designer clears the param.
    fireEvent.click(within(tabs).getByRole("tab", { name: "Designer" }));
    await waitFor(() => expect(url()).toBe("/skills/sk-1/studio"));
    expect(await screen.findByTestId("canvas")).toBeInTheDocument();
  });

  test("a legacy ?mode= bookmark still lands on a usable workbench", async () => {
    renderStudio("/skills/sk-1/studio?mode=split");
    await waitForStudio();
    // Ignored, not honoured and not an error: the Designer is showing, with its canvas.
    const tabs = await screen.findByRole("tablist", { name: "Open files" });
    expect(within(tabs).getByRole("tab", { name: "Designer" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await screen.findByTestId("canvas")).toBeInTheDocument();
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

    // RM-30 WP 7.9 inverted the default: SKILL.md is written out like every other path, and it is
    // the DESIGNER (the pinned tab, no file at all) that clears the param.
    fireEvent.click(within(rail).getByText("SKILL.md"));
    await waitFor(() => expect(url()).toContain("file=SKILL.md"));

    const tabs = screen.getByRole("tablist", { name: "Open files" });
    fireEvent.click(within(tabs).getByRole("tab", { name: "Designer" }));
    await waitFor(() => expect(url()).not.toContain("file="));
  });

  test("?file= from a cold load is the rail's selection", async () => {
    renderStudio("/skills/sk-1/studio?file=references%2Fapi.md");
    await waitForStudio();
    const rail = screen.getByTestId("studio-left-rail");
    const row = await within(rail).findByText("api.md");
    expect(row.closest('[aria-selected="true"]')).not.toBeNull();
  });

  // RM-30 WP 7.4 replaced WP 7.1's "the Files rail is BROWSE-ONLY here" assertion: the rail IS the
  // editable workspace now, and its mutation toolbar is the visible proof.
  test("the Files rail is EDITABLE (RM-30 WP 7.4)", async () => {
    renderStudio();
    await waitForStudio();
    const rail = screen.getByTestId("studio-left-rail");
    expect(await within(rail).findByRole("button", { name: "New file" })).toBeInTheDocument();
    expect(within(rail).getByRole("button", { name: "New folder" })).toBeInTheDocument();
    expect(within(rail).getByRole("button", { name: "Upload files" })).toBeInTheDocument();

    // RM-30 WP 7.9: the Studio opens on the DESIGNER, which is not a file — so nothing in the tree
    // is selected and the three path controls are disabled rather than aimed at a non-path.
    expect(within(rail).getByRole("button", { name: "Delete" })).toBeDisabled();

    // Pick the manifest and the invariant is still visible AND still refused with a reason.
    fireEvent.click(within(rail).getByText("SKILL.md"));
    await waitFor(() =>
      expect(
        within(rail).getByRole("button", { name: "SKILL.md can’t be deleted" }),
      ).toBeDisabled(),
    );
    expect(within(rail).getByRole("button", { name: "SKILL.md can’t be renamed" })).toBeDisabled();
    expect(within(rail).getByRole("button", { name: "SKILL.md can’t be moved" })).toBeDisabled();
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

    // Stage a real edit through the editor's own creation path. RM-30 WP 7.7 deleted the toolbar's
    // "Add section" button — creation is the Components palette now, so the dirty state is reached
    // exactly the way an author reaches it: open the palette, press a component's Add.
    const rail = screen.getByTestId("studio-left-rail");
    fireEvent.mouseDown(within(rail).getByRole("tab", { name: "Components" }), { button: 0 });
    fireEvent.click(within(rail).getByRole("tab", { name: "Components" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Add a Section/ }));
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
