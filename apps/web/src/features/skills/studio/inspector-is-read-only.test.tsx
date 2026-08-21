import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@elabs-ai/components-ui";
import type { Skill, SkillGraph, SkillVersion } from "@mcp-token-footprint/shared";
import { SkillInspector } from "../SkillInspector";

// ── RM-30 WP 7.1 acceptance: "Inspector shows no save bars anywhere" (I2) ─────────────────────────
// Authoring moved to `/skills/:skillId/studio`. What this pins is the half of that move the
// inspector owns: its Design tab is a READ-ONLY flow preview, the SI13 header save cluster it used
// to host is gone, and the one authoring affordance is a link into the Studio.
//
// RM-30 WP 7.3 paid down half of 7.1's recorded debt: the Overview tab's keyword editor and its
// "Save as new version" button are gone, pinned by `../overview-is-read-only.test.tsx`. The Files
// tab's Save…/Discard bar is still there, by design — it is the only way to edit a file until WP 7.4
// makes files editable in the Studio, and that WP names its deletion as a step. So this suite still
// pins what is actually delivered rather than a claim it is not.

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

const VERSIONS = [makeVersion("ver-2", 2), makeVersion("ver-1", 1)];

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
      tokenTotal: 20,
    })),
    getSkillGraph: vi.fn(async () => ({ graph: GRAPH, projectorVersion: 1 })),
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
    apiPost: vi.fn(async () => {
      throw new Error("the inspector must not POST — it is read-only now");
    }),
    pullSkill: vi.fn(),
  };
});

vi.mock("../use-bound-tools", () => ({
  useBoundTools: () => ({ boundTools: [], loading: false, error: null }),
  registerBoundToolProviders: vi.fn(() => ({ dispose: vi.fn() })),
}));

// Neither the security posture nor the rating-issues registry is under test; both fetch at page
// level (to badge their tabs), so they are stubbed to a settled empty result.
vi.mock("../../security/SecurityPanel", () => ({
  SecurityPanel: () => null,
  useSecurityReport: () => ({ state: { status: "idle" }, reload: vi.fn() }),
}));
vi.mock("../../issues/use-rating-issues", () => ({
  useRatingIssues: () => ({ state: { status: "idle" }, reload: vi.fn(), openCount: 0 }),
}));

// The dock isn't under test; the inspector only reads its auth flag + active thread.
vi.mock("../../assistant/assistant-context", () => ({
  useAssistant: () => ({
    authConfigured: false,
    activeAssistantThreadId: null,
    openAssistant: vi.fn(),
    currentEnvelope: {},
  }),
}));

vi.mock("@elabs-ai/components-editor", () => ({ CodeEditor: () => null }));
vi.mock("../design/code-intel", () => ({
  registerCodeIntel: vi.fn(() => ({
    dispose: vi.fn(),
    setGraph: vi.fn(),
    setBoundTools: vi.fn(),
    setFilePaths: vi.fn(),
  })),
}));
vi.mock("../design/SkillGraphCanvas", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../design/SkillGraphCanvas")>();
  return { ...actual, SkillGraphCanvas: () => <div data-testid="canvas" /> };
});

// Sibling tabs that aren't under test.
vi.mock("../SkillOverview", () => ({ SkillOverview: () => null }));
vi.mock("../SkillUsageTab", () => ({ SkillUsageTab: () => null }));
vi.mock("../trace/SkillTraceView", () => ({ SkillTraceView: () => null }));
vi.mock("../quality/QualityView", () => ({ QualityView: () => null }));
vi.mock("../SkillFileExplorer", () => ({ SkillFileExplorer: () => null }));
vi.mock("../SkillVersions", () => ({ SkillVersions: () => null }));
vi.mock("../SkillDiffView", () => ({ SkillDiffView: () => null }));
vi.mock("../PublishGithubDialog", () => ({ PublishGithubDialog: () => null }));
vi.mock("../design/ToolRunnerSheet", () => ({ ToolRunnerSheet: () => null }));

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

beforeEach(() => {
  window.localStorage.clear();
});

describe("the inspector after the Studio move (RM-30 WP 7.1)", () => {
  test("the header carries an 'Edit in Studio' link to the Studio route, not a save cluster", async () => {
    renderInspector();
    const link = await screen.findByRole("link", { name: /Edit in Studio/ });
    expect(link).toHaveAttribute("href", "/skills/sk-1/studio");
    expect(screen.queryByTestId("design-save-cluster")).toBeNull();
  });

  test("Design is back as a tab, and it is a READ-ONLY preview", async () => {
    renderInspector();
    await screen.findByRole("tab", { name: "Design" });
    activateTab("Design");

    await screen.findByTestId("skill-flow-preview");
    // The read-only canvas is mounted…
    expect(await screen.findByTestId("canvas")).toBeInTheDocument();
    // …with none of the editing chrome: no palette, no node editor, no view toggle, no save bar.
    expect(screen.queryByTestId("design-save-cluster")).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "Editor view" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Add section/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Add command/ })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Tools" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Node details" })).toBeNull();
  });

  test("NO save/discard control exists on any inspector tab the Studio took over", async () => {
    renderInspector();
    await screen.findByRole("tab", { name: "Design" });

    for (const tab of ["Design", "Quality", "Usage", "Versions", "Diff"]) {
      activateTab(tab);
      await waitFor(() =>
        expect(screen.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true"),
      );
      expect(screen.queryByTestId("design-save-cluster")).toBeNull();
      expect(screen.queryByRole("button", { name: "Save…" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Discard unsaved changes" })).toBeNull();
    }
  });

  test("switching tabs never prompts to discard — the inspector can no longer hold a draft", async () => {
    renderInspector();
    await screen.findByRole("tab", { name: "Design" });
    activateTab("Design");
    await screen.findByTestId("skill-flow-preview");

    activateTab("Versions");
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Versions" })).toHaveAttribute(
        "aria-selected",
        "true",
      ),
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
