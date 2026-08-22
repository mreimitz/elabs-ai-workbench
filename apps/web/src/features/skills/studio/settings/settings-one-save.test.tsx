import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { Button, TooltipProvider } from "@elabs-ai/components-ui";
import type {
  ScanSummary,
  ServerConfig,
  Skill,
  SkillFileNode,
  SkillGraph,
  SkillVersion,
} from "@mcp-token-footprint/shared";
import { SkillStudioView } from "../SkillStudioView";

// ── RM-30 WP 7.3 acceptance (audit §I8, first half) ───────────────────────────────────────────────
// Driven through the REAL route, with only the API layer, Monaco and the React Flow canvas stubbed.
// The four things the WP promises are asserted end to end:
//
//   1. bind a server + add a keyword + add a command, all from the settings panel;
//   2. ONE save produces ONE new version — the settings panel itself never POSTs;
//   3. the YAML is written for the author (the saved content carries `servers:` and `keywords:`);
//   4. the Code view reflects each settings change LIVE.
//
// The apply-preview stub is deliberately an identity over the base content plus the command heading,
// so the assertion on the saved bytes is about what the FRONTMATTER layer wrote, not about the
// server-side splice (which has its own tests in the API suite).

const SKILL_MD = [
  "---",
  "name: demo",
  "description: A demo skill.",
  "---",
  "",
  "# Demo skill",
  "",
  "## Do the thing",
  "",
  "Body line.",
  "",
].join("\n");

const GRAPH: SkillGraph = {
  nodes: [
    {
      id: "sec-1",
      kind: "subroutine",
      label: "Do the thing",
      source: "inferred",
      anchor: { headingPath: ["Do the thing"], startLine: 8, endLine: 10 },
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

const VERSIONS = [makeVersion("ver-4", 4)];

const FILES: SkillFileNode[] = [
  { path: "SKILL.md", isSkillMd: true, isBinary: false, size: 64, kind: "skill_md", tokenTotal: 20 },
];

const SERVERS = [
  { id: "s-files", name: "files", transport: "stdio" },
] as unknown as ServerConfig[];

const SCANS = [
  {
    serverId: "s-files",
    status: "success",
    scannedAt: "2026-02-01T00:00:00.000Z",
    totalTools: 1,
  },
] as unknown as ScanSummary[];

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
    getBoundTools: vi.fn(async () => []),
  };
});

vi.mock("../../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/api")>();
  return {
    ...actual,
    apiGet: vi.fn(async (url: string) =>
      url === "/api/servers" ? SERVERS : url === "/api/scans" ? SCANS : [],
    ),
    listServerTypes: vi.fn(async () => []),
    apiPost: vi.fn(async (path: string, body: unknown) => {
      posts.push({ path, body });
      if (path === "/api/skillflow/apply-preview") {
        // A stand-in for the server-side splice: an `add_command` op appends its heading.
        const request = body as { content: string; ops: { op: string; command?: string }[] };
        const added = request.ops
          .filter((op) => op.op === "add_command")
          .map((op) => `\n## ${op.command ?? ""}\n`)
          .join("");
        return { content: `${request.content}${added}` };
      }
      if (path === "/api/skillflow/project-preview") return { graph: GRAPH, warnings: [] };
      if (path === "/api/skills/sk-1/save-draft") {
        return {
          version: makeVersion("ver-5", 5),
          diff: { entries: [], rollup: { filesAdded: 0, filesModified: 1, filesRemoved: 0, l2Delta: 0, totalDelta: 0, bytesDelta: 0 } },
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

// The Code pane's Monaco is replaced by a plain readout of the value it is handed, so "the Code view
// reflects each settings change live" is asserted against the real prop the editor passes down —
// not against a claim.
/** A hand edit typed into the Code pane — a document whose frontmatter differs from the base. */
const HAND_EDITED = SKILL_MD.replace("name: demo", "name: renamed-by-hand");

vi.mock("@elabs-ai/components-editor", () => ({
  CodeEditor: ({ value, onChange }: { value?: string; onChange?: (next: string) => void }) => (
    <div data-testid="code-pane">
      {value}
      <Button data-testid="code-hand-edit" onClick={() => onChange?.(HAND_EDITED)}>
        hand-edit (stub)
      </Button>
    </div>
  ),
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
  return {
    ...actual,
    SkillGraphCanvas: () => <div data-testid="canvas" />,
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

const renderStudio = (entry = "/skills/sk-1/studio?rail=settings") =>
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

const saveDraftPosts = () => posts.filter((post) => post.path === "/api/skills/sk-1/save-draft");

/**
 * The settings panel, once its draft has LOADED. The panel frame mounts immediately while
 * `getSkillFile` is still in flight, so every field legitimately reads empty for a tick — a test that
 * asserts or types before that is racing the load, not testing the panel.
 */
const openLoadedSettings = async () => {
  const panel = await screen.findByTestId("studio-settings");
  await waitFor(() =>
    expect((within(panel).getByLabelText("Name") as HTMLInputElement).value).toBe("demo"),
  );
  return panel;
};

beforeEach(() => {
  posts.length = 0;
  window.localStorage.clear();
});

describe("§I8 — bind a server, add a keyword and a command, save ONE version", () => {
  test("the settings panel opens from the URL and reads the draft's frontmatter", async () => {
    renderStudio();
    const panel = await openLoadedSettings();
    expect((within(panel).getByLabelText("Description") as HTMLTextAreaElement).value).toBe(
      "A demo skill.",
    );
  });

  test("a settings change shows in the Code view LIVE, with no save", async () => {
    renderStudio("/skills/sk-1/studio?rail=settings&file=SKILL.md");
    const panel = await openLoadedSettings();

    fireEvent.change(within(panel).getByLabelText("Description"), {
      target: { value: "Rewritten from the panel." },
    });

    // The value is written as a double-quoted YAML scalar — the WP 7.3a engine quotes anything a
    // plain scalar could read back differently (a space is enough). Valid, round-tripping YAML that
    // the author never had to type.
    await waitFor(() =>
      expect(screen.getByTestId("code-pane").textContent).toContain(
        'description: "Rewritten from the panel."',
      ),
    );
    expect(saveDraftPosts()).toHaveLength(0);
  });

  test("the sync runs BOTH ways: a hand edit in Code updates the settings fields", async () => {
    // The fields read the live document rather than holding a private copy, which is the only way
    // the two can't drift. Without it, an author who edits `name:` by hand in Code and then touches
    // any settings field would silently write their old name back over it.
    renderStudio("/skills/sk-1/studio?rail=settings&file=SKILL.md");
    const panel = await openLoadedSettings();

    fireEvent.click(await screen.findByTestId("code-hand-edit"));

    await waitFor(() =>
      expect((within(panel).getByLabelText("Name") as HTMLInputElement).value).toBe(
        "renamed-by-hand",
      ),
    );
    expect(saveDraftPosts()).toHaveLength(0);
  });

  test("bind + keyword + command, then ONE save → ONE new version carrying the written YAML", async () => {
    renderStudio();
    const panel = await openLoadedSettings();

    // 1 — bind a registered server through the picker (never hand-typed YAML).
    fireEvent.click(within(panel).getByTestId("settings-bind-server"));
    fireEvent.click(await screen.findByRole("button", { name: "Bind" }));

    // 2 — add a trigger keyword.
    const keywordInput = within(panel).getByLabelText("Trigger keywords");
    fireEvent.change(keywordInput, { target: { value: "summarize a file" } });
    fireEvent.keyDown(keywordInput, { key: "Enter" });

    // 3 — add a /command entry point.
    fireEvent.click(within(panel).getByTestId("settings-add-command"));
    const commandDialog = await screen.findByRole("dialog");
    fireEvent.change(within(commandDialog).getByLabelText(/Command/i), {
      target: { value: "/report" },
    });
    fireEvent.click(within(commandDialog).getByRole("button", { name: /Add command/i }));

    // ONE dirty flag over all three, and still nothing saved.
    const cluster = await screen.findByTestId("design-save-cluster");
    await waitFor(() => expect(cluster.textContent).toMatch(/3 unsaved changes/));
    expect(saveDraftPosts()).toHaveLength(0);

    // ONE save action, and it names the version it will create.
    fireEvent.click(within(cluster).getByRole("button", { name: /Save as v5/ }));
    const saveDialog = await screen.findByRole("dialog");
    fireEvent.click(within(saveDialog).getByRole("button", { name: /Save as v5/ }));

    await waitFor(() => expect(saveDraftPosts()).toHaveLength(1));
    const body = saveDraftPosts()[0]?.body as { content: string; baseVersionId: string };
    expect(body.baseVersionId).toBe("ver-4");
    // The YAML the author never typed.
    expect(body.content).toContain("servers:");
    expect(body.content).toContain("  - files");
    expect(body.content).toContain("keywords:");
    expect(body.content).toContain('  - "summarize a file"');
    // …and the command, which rode the op path into the same one save.
    expect(body.content).toContain("## /report");
    // The untouched frontmatter and body survived.
    expect(body.content).toContain("name: demo");
    expect(body.content).toContain("Body line.");
  });

  test("a FRONTMATTER-ONLY change is a real, reviewable, saveable change", async () => {
    // The case with no canvas op and no text edit at all. It is the one that breaks quietly: the
    // dirty chip, the save dialog's pending list and its `canSave` gate are three separate places
    // that each have to count the settings layer, and an op in the batch masks all three.
    renderStudio();
    const panel = await openLoadedSettings();

    fireEvent.click(within(panel).getByTestId("settings-bind-server"));
    fireEvent.click(await screen.findByRole("button", { name: "Bind" }));

    const cluster = await screen.findByTestId("design-save-cluster");
    await waitFor(() => expect(cluster.textContent).toMatch(/1 unsaved change/));

    fireEvent.click(within(cluster).getByRole("button", { name: /Save as v5/ }));
    const saveDialog = await screen.findByRole("dialog");
    // It is ITEMIZED, not just counted — an author reviews what they are about to save.
    expect(within(saveDialog).getByText(/Bind the server “files”/)).toBeTruthy();

    const confirm = within(saveDialog).getByRole("button", { name: /Save as v5/ });
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(confirm);

    await waitFor(() => expect(saveDraftPosts()).toHaveLength(1));
    const body = saveDraftPosts()[0]?.body as { content: string };
    expect(body.content).toContain("  - files");
  });

  test("staging then undoing a bind leaves the draft clean — no version to save", async () => {
    renderStudio();
    const panel = await openLoadedSettings();

    fireEvent.click(within(panel).getByTestId("settings-bind-server"));
    fireEvent.click(await screen.findByRole("button", { name: "Bind" }));
    const cluster = await screen.findByTestId("design-save-cluster");
    await waitFor(() => expect(cluster.textContent).toMatch(/1 unsaved change/));

    fireEvent.click(await screen.findByRole("button", { name: "Unbind server files" }));
    fireEvent.click(await screen.findByRole("button", { name: "Unbind" }));

    await waitFor(() => expect(cluster.textContent).toMatch(/No unsaved changes/));
    expect(saveDraftPosts()).toHaveLength(0);
  });
});
