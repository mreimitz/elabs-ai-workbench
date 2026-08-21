import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@elabs-ai/components-ui";
import type { SkillFileNode } from "@mcp-token-footprint/shared";
import { SkillFileExplorer } from "../../SkillFileExplorer";

// ── RM-30 WP 7.4 acceptance — the debt WP 7.1 recorded on this WP ─────────────────────────────────
// WP 7.1's acceptance said "the Inspector shows no save bars anywhere" and it was met on seven of
// nine tabs. The Files tab kept its Discard / Save… bar deliberately: deleting it while the Studio's
// Files rail was read-only would have left no way to edit a file at all. Files are editable in the
// Studio now, so this pins the other half of that sentence — and its counterpart, that the Studio's
// own file editor carries no read-only badge (asserted in `files-one-save.test.tsx`).

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

vi.mock("../../skills-inspector-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../skills-inspector-api")>();
  return {
    ...actual,
    getSkillFile: vi.fn(async (_skillId: string, _versionId: string, path: string) => ({
      path,
      isBinary: false as const,
      text: `# ${path}\n`,
      tokenTotal: 10,
    })),
    getToolDiagnostics: vi.fn(async () => ({ diagnostics: [] })),
    getSkillVersion: vi.fn(async () => {
      throw new Error("the browse-only Files tab must not need version metadata to save with");
    }),
  };
});

// Any POST at all would be a save path — this tab must not have one.
const posts: string[] = [];
vi.mock("../../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/api")>();
  return {
    ...actual,
    apiGet: vi.fn(async () => []),
    apiPost: vi.fn(async (path: string) => {
      posts.push(path);
      throw new Error(`the Inspector's Files tab must not POST — it posted ${path}`);
    }),
  };
});

vi.mock("../../use-bound-tools", () => ({
  useBoundTools: () => ({ boundTools: [], loading: false, error: null }),
  registerBoundToolProviders: vi.fn(() => ({ dispose: vi.fn() })),
}));

vi.mock("@elabs-ai/components-editor", () => ({
  CodeEditor: ({ value, readOnly }: { value?: string; readOnly?: boolean }) => (
    <div data-testid="inspector-code" data-readonly={String(Boolean(readOnly))}>
      {value}
    </div>
  ),
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

const renderExplorer = () =>
  render(
    <MemoryRouter>
      <TooltipProvider>
        <SkillFileExplorer skillId="sk-1" versionId="ver-4" files={FILES} />
      </TooltipProvider>
    </MemoryRouter>,
  );

beforeEach(() => {
  posts.length = 0;
  window.localStorage.clear();
});

describe("the Inspector's Files tab is BROWSE-ONLY (RM-30 WP 7.4)", () => {
  test("the Discard / Save… bar is GONE — 7.1's recorded debt is paid", async () => {
    renderExplorer();
    await screen.findByTestId("inspector-code");

    expect(screen.queryByRole("button", { name: "Save…" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Discard/ })).toBeNull();
    expect(screen.queryByText(/unsaved change/)).toBeNull();
    expect(screen.queryByText("No unsaved changes")).toBeNull();
  });

  test("the mutation toolbar is gone with it — no create, upload, rename, move or delete", async () => {
    renderExplorer();
    await screen.findByTestId("inspector-code");

    for (const label of ["New file", "New folder", "Upload files", "Rename", "Move", "Delete"]) {
      expect(screen.queryByRole("button", { name: label })).toBeNull();
    }
  });

  test("the bindings strip is gone too — it was a THIRD save path onto the same skill", async () => {
    renderExplorer();
    await screen.findByTestId("inspector-code");
    expect(screen.queryByRole("button", { name: /Bind server/ })).toBeNull();
    expect(posts).toEqual([]);
  });

  test("the preview is read-only, badged, and offers 'Edit in Studio' for the OPEN file", async () => {
    renderExplorer();
    const code = await screen.findByTestId("inspector-code");
    expect(code).toHaveAttribute("data-readonly", "true");
    expect(screen.getByText("Read-only")).toBeInTheDocument();

    // The default selection is SKILL.md, the manifest — the link is the Studio's plain route.
    const link = screen.getByRole("link", { name: /Edit in Studio/ });
    expect(link).toHaveAttribute("href", "/skills/sk-1/studio");
  });

  test("picking another file deep-links the Studio AT that file", async () => {
    renderExplorer();
    await screen.findByTestId("inspector-code");

    fireEvent.click(screen.getByText("api.md"));

    await waitFor(() =>
      expect(screen.getByRole("link", { name: /Edit in Studio/ })).toHaveAttribute(
        "href",
        "/skills/sk-1/studio?file=references%2Fapi.md",
      ),
    );
  });

  test("the tree still browses — search narrows it, and a zero-match says so", async () => {
    renderExplorer();
    await screen.findByTestId("inspector-code");

    const search = screen.getByPlaceholderText("Search files…");
    fireEvent.change(search, { target: { value: "api" } });
    await waitFor(() => expect(screen.getByText("api.md")).toBeInTheDocument());

    fireEvent.change(search, { target: { value: "nothing-matches-this" } });
    await waitFor(() => expect(screen.getByText(/No files match/)).toBeInTheDocument());
  });
});

describe("the Studio's read-only badge is only in the INSPECTOR", () => {
  test("the badge text exists here and is scoped to this component's header", async () => {
    renderExplorer();
    await screen.findByTestId("inspector-code");
    // One badge, in the open-file header row — not a page-level banner.
    const badges = screen.getAllByText("Read-only");
    expect(badges).toHaveLength(1);
    expect(within(badges[0]?.closest("div") as HTMLElement).getByText("Read-only")).toBeTruthy();
  });
});
