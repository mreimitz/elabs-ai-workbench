import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { Button, TooltipProvider } from "@elabs-ai/components-ui";
import type {
  Skill,
  SkillEditOp,
  SkillFileNode,
  SkillGraph,
  SkillVersion,
} from "@mcp-token-footprint/shared";
import { SkillStudioView } from "../SkillStudioView";

// ── RM-30 WP 7.4 acceptance (audit §I8, middle) ───────────────────────────────────────────────────
// Driven through the REAL route, with only the API layer, Monaco and the React Flow canvas stubbed.
// What the WP promises, asserted end to end:
//
//   1. create an L3 resource file in the Studio's Files rail — it opens as an editable buffer;
//   2. type content into it;
//   3. reference it from SKILL.md;
//   4. ONE save → ONE new version, carrying BOTH the manifest text and the file's `add_file` op;
//   5. …and one dirty count over the lot, itemised in the save dialog.
//
// Plus the two invariants that would be invisible otherwise: a file edit is NOT lost when the author
// then types in SKILL.md, and no op in the saved batch ever names SKILL.md.

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
  currentVersionId: "ver-4",
  versionCount: 4,
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

const VERSIONS = [makeVersion("ver-4", 4)];

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

/** Every `apiPost` the mounted tree makes, so the test can assert what was (and was not) sent. */
const posts: { path: string; body: unknown }[] = [];

vi.mock("../../skills-inspector-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../skills-inspector-api")>();
  return {
    ...actual,
    getSkill: vi.fn(async () => SKILL),
    listSkillVersions: vi.fn(async () => VERSIONS),
    getSkillVersion: vi.fn(async () => VERSIONS[0]),
    getSkillFiles: vi.fn(async () => FILES),
    getSkillFile: vi.fn(async (_skillId: string, _versionId: string, path: string) => ({
      path,
      isBinary: false as const,
      text: path === "SKILL.md" ? SKILL_MD : "# The API\n",
      tokenTotal: 20,
    })),
    getSkillGraph: vi.fn(async () => ({ graph: GRAPH, projectorVersion: 1 })),
    getToolDiagnostics: vi.fn(async () => ({ diagnostics: [] })),
    getQualityReport: vi.fn(async () => {
      throw new Error("no quality report in this harness");
    }),
    fetchSkillBindings: vi.fn(async () => []),
    getBoundTools: vi.fn(async () => []),
  };
});

vi.mock("../../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/api")>();
  return {
    ...actual,
    apiGet: vi.fn(async () => []),
    listServerTypes: vi.fn(async () => []),
    apiPost: vi.fn(async (path: string, body: unknown) => {
      posts.push({ path, body });
      if (path === "/api/skillflow/apply-preview")
        return { content: (body as { content: string }).content };
      if (path === "/api/skillflow/project-preview") return { graph: GRAPH, warnings: [] };
      if (path === "/api/skills/sk-1/save-draft") {
        return {
          version: makeVersion("ver-5", 5),
          diff: {
            entries: [],
            rollup: {
              filesAdded: 1,
              filesModified: 1,
              filesRemoved: 0,
              l2Delta: 0,
              totalDelta: 0,
              bytesDelta: 0,
            },
          },
          warnings: [],
        };
      }
      throw new Error(`unexpected apiPost ${path}`);
    }),
  };
});

vi.mock("../../use-bound-tools", () => ({
  useBoundTools: () => ({ boundTools: [], loading: false, error: null }),
  registerBoundToolProviders: vi.fn(() => ({ dispose: vi.fn() })),
}));

// Monaco is replaced by a readout of the value it is handed plus a button that types through its
// real `onChange` — so "the file is an editable buffer" is asserted against the actual prop chain,
// not a claim. Each mounted editor is tagged by the `path` prop so the two panes are told apart.
const TYPED_RESOURCE = "# Limits\n\nAt most 10 items.\n";
const REFERENCING_MD = `${SKILL_MD}\nSee references/limits.md for the limits.\n`;

vi.mock("@elabs-ai/components-editor", () => ({
  CodeEditor: ({
    value,
    onChange,
    path,
    readOnly,
  }: {
    value?: string;
    onChange?: (next: string) => void;
    path?: string;
    readOnly?: boolean;
  }) => {
    // The manifest pane addresses its Monaco model by a `skill-ide://…/SKILL.md` URI; a file tab
    // uses the plain working-tree path. Key on the tail so both are named the same way here.
    const key = (path ?? "?").split("/").slice(-1)[0] === "SKILL.md" ? "SKILL.md" : (path ?? "?");
    return (
      <div data-testid={`editor:${key}`} data-readonly={String(Boolean(readOnly))}>
        {value}
        <Button
          data-testid={`type:${key}`}
          onClick={() => onChange?.(key === "SKILL.md" ? REFERENCING_MD : TYPED_RESOURCE)}
        >
          type (stub)
        </Button>
      </div>
    );
  },
}));
vi.mock("../../design/code-intel", () => ({
  registerCodeIntel: vi.fn(() => ({
    dispose: vi.fn(),
    setGraph: vi.fn(),
    setBoundTools: vi.fn(),
    setFilePaths: vi.fn(),
  })),
}));
vi.mock("../../design/SkillGraphCanvas", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../design/SkillGraphCanvas")>();
  return { ...actual, SkillGraphCanvas: () => <div data-testid="canvas" /> };
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
if (typeof window.ResizeObserver !== "function") {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof window.ResizeObserver;
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

const renderStudio = (entry = "/skills/sk-1/studio") =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <TooltipProvider>
        <Routes>
          <Route path="/skills/:skillId/studio" element={<SkillStudioView />} />
          <Route path="/skills/:skillId" element={<Button>inspector</Button>} />
        </Routes>
        <LocationProbe />
      </TooltipProvider>
    </MemoryRouter>,
  );

const url = () => screen.getByTestId("location").textContent ?? "";
const saveDraftPosts = () => posts.filter((post) => post.path === "/api/skills/sk-1/save-draft");
const savedBody = () => saveDraftPosts()[0]?.body as { content: string; treeOps: SkillEditOp[] };

/** The workbench, once its draft has loaded (the rail's tree is the proof). */
const waitForStudio = async () => {
  await screen.findByTestId("studio-center");
  await screen.findByRole("button", { name: "Exit" });
  await within(screen.getByTestId("studio-left-rail")).findByText("SKILL.md");
};

/**
 * Create `name` through the rail's New-file dialog. `inFolder` selects that folder first — the
 * dialog validates a single path SEGMENT (no slashes), so a nested file is made by choosing where
 * it lands, exactly as an author does.
 */
const createFile = async (name: string, inFolder?: string) => {
  const rail = screen.getByTestId("studio-left-rail");
  if (inFolder) fireEvent.click(within(rail).getByText(inFolder));
  fireEvent.click(within(rail).getByRole("button", { name: "New file" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("File name"), { target: { value: name } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
};

beforeEach(() => {
  posts.length = 0;
  window.localStorage.clear();
});

describe("§I8 — create a resource file, type it, reference it, save ONE version", () => {
  test("the rail's tree lists the version's files, and picking one opens it as a TAB", async () => {
    renderStudio();
    await waitForStudio();

    const rail = screen.getByTestId("studio-left-rail");
    fireEvent.click(within(rail).getByText("api.md"));

    await waitFor(() => expect(url()).toContain("file=references%2Fapi.md"));
    const tabs = await screen.findByRole("tablist", { name: "Open files" });
    // The pinned Designer stays first; the picked file joins it. SKILL.md is NOT there — it is a
    // file tab now (WP 7.9), so it appears only once someone opens it.
    expect(within(tabs).getByRole("tab", { name: "Designer" })).toBeInTheDocument();
    expect(within(tabs).getByRole("tab", { name: /api\.md/ })).toBeInTheDocument();
    expect(within(tabs).queryByRole("tab", { name: /SKILL\.md/ })).toBeNull();
    // The file's own editor is on screen, and it is EDITABLE — no read-only badge in the Studio.
    expect(await screen.findByTestId("editor:references/api.md")).toHaveAttribute(
      "data-readonly",
      "false",
    );
    expect(screen.queryByText("Read-only")).toBeNull();
  });

  test("a new file opens as an editable buffer immediately, and closes back to the Designer", async () => {
    renderStudio();
    await waitForStudio();

    await createFile("limits.md");

    await waitFor(() => expect(url()).toContain("file=limits.md"));
    expect(await screen.findByTestId("editor:limits.md")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close limits.md" }));
    await waitFor(() => expect(url()).not.toContain("file="));
    // …and the editor surface is back, without ever having been unmounted.
    expect(screen.getByTestId("studio-pane-editor")).toBeInTheDocument();
  });

  test("the Designer tab can never be closed, and is always first", async () => {
    renderStudio();
    await waitForStudio();
    const tabs = await screen.findByRole("tablist", { name: "Open files" });

    // Every FILE tab carries its own × (owner decision 2026-08-22); the pinned Designer carries NONE
    // at all, not a disabled one, so with no file open there is no close control in the strip.
    expect(within(tabs).queryByRole("button", { name: /^Close/ })).toBeNull();
    expect(within(tabs).getAllByRole("tab")[0]).toHaveAccessibleName("Designer");

    // …and the strip's keyboard close shortcut is inert on it.
    const designerTab = within(tabs).getByRole("tab", { name: "Designer" });
    fireEvent.keyDown(designerTab, { key: "Delete" });
    expect(within(tabs).getByRole("tab", { name: "Designer" })).toBeInTheDocument();
    expect(screen.getByTestId("studio-pane-editor")).toBeInTheDocument();
  });

  test("SKILL.md is a SOURCE tab: it opens from the rail, is editable, and closes like a file", async () => {
    renderStudio();
    await waitForStudio();

    const rail = screen.getByTestId("studio-left-rail");
    fireEvent.click(within(rail).getByText("SKILL.md"));
    await waitFor(() => expect(url()).toContain("file=SKILL.md"));

    // It renders as TEXT in the centre surface, through the editor's own code pane (not through
    // `WorkspaceEditor`, which would be a second writer for the manifest).
    const editor = await screen.findByTestId("editor:SKILL.md");
    expect(editor).toHaveAttribute("data-readonly", "false");
    expect(editor.textContent).toContain("# Demo skill");

    // And it closes like any other file, handing back to the Designer.
    fireEvent.click(screen.getByRole("button", { name: "Close SKILL.md" }));
    await waitFor(() => expect(url()).not.toContain("file="));
    expect(await screen.findByTestId("canvas")).toBeInTheDocument();
  });

  test("create + type + reference, then ONE save carrying BOTH halves", async () => {
    renderStudio();
    await waitForStudio();

    // 1 — create the L3 resource file.
    await createFile("limits.md", "references");
    await screen.findByTestId("editor:references/limits.md");

    // 2 — type content into it (through the editor's real onChange).
    fireEvent.click(screen.getByTestId("type:references/limits.md"));

    // 3 — reference it from SKILL.md, in the Code view.
    // Open the manifest's SOURCE tab — RM-30 WP 7.9: that IS how you get the code surface now.
    const rail = screen.getByTestId("studio-left-rail");
    fireEvent.click(within(rail).getByText("SKILL.md"));
    fireEvent.click(await screen.findByTestId("type:SKILL.md"));

    // ONE dirty count over both halves, and still nothing saved.
    const cluster = await screen.findByTestId("design-save-cluster");
    await waitFor(() => expect(cluster.textContent).toMatch(/2 unsaved changes/));
    expect(saveDraftPosts()).toHaveLength(0);

    // 4 — one save action, naming the version it will create.
    fireEvent.click(within(cluster).getByRole("button", { name: /Save as v5/ }));
    const dialog = await screen.findByRole("dialog");
    // It is ITEMISED: the file change is reviewable beside the manifest edit.
    expect(within(dialog).getByText("Add references/limits.md")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: /Save as v5/ }));

    await waitFor(() => expect(saveDraftPosts()).toHaveLength(1));
    const body = savedBody();
    // The manifest text carries the reference…
    expect(body.content).toContain("references/limits.md");
    // …and the file rides the SAME request as an add_file with the typed bytes.
    expect(body.treeOps).toEqual([
      { op: "add_file", path: "references/limits.md", content: TYPED_RESOURCE },
    ]);
  });

  test("typing in SKILL.md does NOT throw away a staged file change", async () => {
    // The regression the layering exists to prevent: `setContent` clears the op buffer by design, so
    // a file staged there would vanish the instant the author touched the manifest.
    renderStudio();
    await waitForStudio();

    await createFile("limits.md", "references");
    fireEvent.click(await screen.findByTestId("type:references/limits.md"));

    // Open the manifest's SOURCE tab — RM-30 WP 7.9: that IS how you get the code surface now.
    const rail = screen.getByTestId("studio-left-rail");
    fireEvent.click(within(rail).getByText("SKILL.md"));
    fireEvent.click(await screen.findByTestId("type:SKILL.md"));

    const cluster = await screen.findByTestId("design-save-cluster");
    fireEvent.click(within(cluster).getByRole("button", { name: /Save as v5/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Save as v5/ }));

    await waitFor(() => expect(saveDraftPosts()).toHaveLength(1));
    expect(savedBody().treeOps).toContainEqual({
      op: "add_file",
      path: "references/limits.md",
      content: TYPED_RESOURCE,
    });
  });

  test("no op in the saved batch ever names SKILL.md — the manifest has ONE writer", async () => {
    renderStudio();
    await waitForStudio();

    await createFile("limits.md", "references");
    fireEvent.click(await screen.findByTestId("type:references/limits.md"));

    // RM-30 WP 7.9 — and now type into SKILL.md THROUGH ITS OWN TAB, which is the move that could
    // reintroduce the second writer. The tab sits in the same strip as `limits.md`, so the obvious
    // wrong implementation (route it through `WorkspaceEditor`, which writes `files.setText`) would
    // derive an `update_file` for the manifest and silently beat `content` on the server.
    const rail = screen.getByTestId("studio-left-rail");
    fireEvent.click(within(rail).getByText("SKILL.md"));
    fireEvent.click(await screen.findByTestId("type:SKILL.md"));

    const cluster = await screen.findByTestId("design-save-cluster");
    fireEvent.click(within(cluster).getByRole("button", { name: /Save as v5/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Save as v5/ }));

    await waitFor(() => expect(saveDraftPosts()).toHaveLength(1));
    const body = savedBody();
    expect(body.treeOps.length).toBeGreaterThan(0);
    for (const op of body.treeOps) {
      expect(JSON.stringify(op)).not.toContain("SKILL.md");
    }
    // The manifest went exactly once, as `content` — carrying what was typed into its source tab.
    expect(body.content).toContain("# Demo skill");
    expect(body.content).toContain("See references/limits.md for the limits.");
  });

  test("ONE draft across all three layers: canvas + SKILL.md source + a resource file", async () => {
    // RM-30 WP 7.9 acceptance #5. Three surfaces an author would think of as separate documents —
    // the visual composer, the manifest's text, and a resource file — resolve to ONE dirty count,
    // ONE save action and ONE new immutable version.
    renderStudio();
    await waitForStudio();

    // 1 — the FILE layer: a new resource with typed bytes.
    await createFile("limits.md", "references");
    fireEvent.click(await screen.findByTestId("type:references/limits.md"));

    // 2 — the CANVAS layer: add a component from the palette (WP 7.7's one creation path).
    const rail = screen.getByTestId("studio-left-rail");
    fireEvent.mouseDown(within(rail).getByRole("tab", { name: "Tools" }), { button: 0 });
    fireEvent.click(within(rail).getByRole("tab", { name: "Tools" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Add a Section/ }));

    const cluster = await screen.findByTestId("design-save-cluster");
    await waitFor(() => expect(cluster.textContent).toMatch(/2 unsaved changes/));

    // 3 — the MANIFEST TEXT layer, through the SKILL.md source tab.
    fireEvent.mouseDown(within(rail).getByRole("tab", { name: "Files" }), { button: 0 });
    fireEvent.click(within(rail).getByRole("tab", { name: "Files" }));
    fireEvent.click(within(rail).getByText("SKILL.md"));
    fireEvent.click(await screen.findByTestId("type:SKILL.md"));

    // STILL two, not three — and that is the "one draft" property rather than a lost edit: a direct
    // text edit makes the TEXT authoritative, so the staged canvas op stops being counted on its own
    // because it is already inside the document the author has now typed over (`design/
    // use-skill-draft.ts` + `studio/draft.ts`). One count, whatever the author touched.
    await waitFor(() => expect(cluster.textContent).toMatch(/2 unsaved changes/));

    // ONE save action in the whole workbench — no second save surface anywhere (WP 7.4's guardrail).
    expect(screen.getAllByRole("button", { name: /Save as v5/ })).toHaveLength(1);
    expect(saveDraftPosts()).toHaveLength(0);

    fireEvent.click(within(cluster).getByRole("button", { name: /Save as v5/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Add references/limits.md")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: /Save as v5/ }));

    // ONE request → ONE new version, carrying every layer.
    await waitFor(() => expect(saveDraftPosts()).toHaveLength(1));
    const body = savedBody();
    expect(body.content).toContain("See references/limits.md for the limits.");
    expect(body.treeOps).toEqual([
      { op: "add_file", path: "references/limits.md", content: TYPED_RESOURCE },
    ]);
  });

  test("deleting a file closes its tab and stages the delete on the same draft", async () => {
    renderStudio();
    await waitForStudio();

    const rail = screen.getByTestId("studio-left-rail");
    fireEvent.click(within(rail).getByText("api.md"));
    await screen.findByTestId("editor:references/api.md");

    fireEvent.click(within(rail).getByRole("button", { name: "Delete" }));
    const confirm = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirm).getByRole("button", { name: /Delete/ }));

    // The tab is gone (the file no longer exists in the working tree) and the surface fell back.
    await waitFor(() => expect(screen.queryByTestId("editor:references/api.md")).toBeNull());
    const cluster = await screen.findByTestId("design-save-cluster");
    await waitFor(() => expect(cluster.textContent).toMatch(/1 unsaved change/));

    fireEvent.click(within(cluster).getByRole("button", { name: /Save as v5/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Delete references/api.md")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: /Save as v5/ }));

    await waitFor(() => expect(saveDraftPosts()).toHaveLength(1));
    expect(savedBody().treeOps).toEqual([{ op: "delete_file", path: "references/api.md" }]);
  });

  test("renaming an open file keeps its tab AND moves ?file= with it", async () => {
    renderStudio();
    await waitForStudio();

    const rail = screen.getByTestId("studio-left-rail");
    fireEvent.click(within(rail).getByText("api.md"));
    await waitFor(() => expect(url()).toContain("file=references%2Fapi.md"));

    fireEvent.click(within(rail).getByRole("button", { name: "Rename" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("File name"), { target: { value: "spec.md" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Rename" }));

    await waitFor(() => expect(url()).toContain("file=references%2Fspec.md"));
    const tabs = await screen.findByRole("tablist", { name: "Open files" });
    expect(within(tabs).getByRole("tab", { name: /spec\.md/ })).toBeInTheDocument();
    expect(within(tabs).queryByRole("tab", { name: /api\.md/ })).toBeNull();
  });
});
