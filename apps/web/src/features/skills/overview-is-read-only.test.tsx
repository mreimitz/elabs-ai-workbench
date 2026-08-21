import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@elabs-ai/components-ui";
import type { SkillFileNode, SkillVersion, TriggerSurface } from "@mcp-token-footprint/shared";
import { SkillOverview } from "./SkillOverview";

// ── RM-30 WP 7.3 acceptance: "Overview mutation-free" ─────────────────────────────────────────────
// WP 7.1 deliberately left Overview's keyword editor and its "Save as new version" button in place,
// because deleting them before this WP's settings panel existed would have removed the only way to
// edit a skill's keywords at all. This WP deletes them, and this suite is what stops them coming
// back: the Inspector is the read/analyze register (D-UX17), so the Overview tab must render NO
// control that can write a new version — not a disabled one, not one behind a confirm.

const SKILL_MD = [
  "---",
  "name: demo",
  "description: A demo skill.",
  "servers:",
  "  - files",
  "keywords:",
  "  - read a file",
  "---",
  "",
  "# Demo skill",
  "",
  "Body line.",
  "",
].join("\n");

const TRIGGERS: TriggerSurface = {
  description: "A demo skill.",
  keywords: ["read a file", "open a doc"],
  commands: [{ value: "/report", nodeId: "entry-1", flowId: "entry-1" }],
};

const VERSION: SkillVersion = {
  id: "ver-4",
  skillId: "sk-1",
  seq: 4,
  versionLabel: "v4",
  treeSha: "sha-4",
  sourceKind: "upload",
  manifest: { name: "demo", description: "A demo skill." },
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
};

const FILES: SkillFileNode[] = [
  { path: "SKILL.md", isSkillMd: true, isBinary: false, size: 64, kind: "skill_md", tokenTotal: 20 },
];

vi.mock("./skills-inspector-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./skills-inspector-api")>();
  return {
    ...actual,
    getSkillTriggers: vi.fn(async () => TRIGGERS),
    getSkillFile: vi.fn(async () => ({
      path: "SKILL.md",
      isBinary: false as const,
      text: SKILL_MD,
      tokenTotal: 20,
    })),
    fetchSkillBindings: vi.fn(async () => []),
    getBoundTools: vi.fn(async () => []),
    // A POST from this tab is the defect under test — make it loud rather than silent.
    postSkillEdits: vi.fn(async () => {
      throw new Error("the Overview tab must not write a version");
    }),
  };
});

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    apiGet: vi.fn(async () => []),
    listServerTypes: vi.fn(async () => []),
    apiPost: vi.fn(async () => {
      throw new Error("the Overview tab must not POST");
    }),
  };
});

vi.mock("@elabs-ai/components-ai", () => ({
  MessageResponse: ({ children }: { children?: string }) => <div>{children}</div>,
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

const renderOverview = () =>
  render(
    <MemoryRouter>
      <TooltipProvider>
        <SkillOverview skillId="sk-1" version={VERSION} files={FILES} isHeadVersion />
      </TooltipProvider>
    </MemoryRouter>,
  );

beforeEach(() => vi.clearAllMocks());

describe("the Overview tab is mutation-free (RM-30 WP 7.3)", () => {
  test("the keyword CHIP EDITOR is gone — keywords render as a read-only list", async () => {
    renderOverview();
    await screen.findByText("read a file");
    expect(screen.getByText("open a doc")).toBeTruthy();
    // The editor's text field is what made it an editor (the section keeps its aria-label, which is
    // a heading for the list, not a control).
    expect(screen.queryByRole("textbox", { name: "Keyword triggers" })).toBeNull();
    expect(screen.queryByPlaceholderText(/Add a keyword phrase/)).toBeNull();
  });

  test("the 'Save as new version' button is gone", async () => {
    renderOverview();
    await screen.findByText("read a file");
    expect(screen.queryByRole("button", { name: /Save as new version/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Save/ })).toBeNull();
  });

  test("the Servers card is a report — no picker, no unbind ×", async () => {
    renderOverview();
    await waitFor(() => expect(screen.getByText("files")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Bind server…" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Unbind/ })).toBeNull();
  });

  test("the tab's only authoring affordances are LINKS into the Studio settings panel", async () => {
    renderOverview();
    const links = await screen.findAllByRole("link", { name: /Edit in Studio/ });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).toHaveAttribute("href", "/skills/sk-1/studio?rail=settings");
    }
  });

  test("NOTHING on the tab can submit — no button writes a version", async () => {
    renderOverview();
    await screen.findByText("read a file");
    // Every remaining button is inert-by-design (a link rendered `asChild`, or a disclosure).
    // A regression that reintroduces a save shows up as a button whose name says so.
    const buttons = screen.queryAllByRole("button");
    for (const button of buttons) {
      expect(button.textContent ?? "").not.toMatch(/Save|Bind|Unbind|Apply/i);
    }
  });
});
