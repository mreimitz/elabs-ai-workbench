import type {
  AssistantWorkspaceChangeKind,
  AssistantWorkspaceFileNode,
} from "@mcp-token-footprint/shared";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

// `AdaptivePanelGroup` -> `useIsMobile` reads `matchMedia`, which jsdom omits — same stub as
// `TabPanel.test.tsx` / the skills design-tab tests.
beforeAll(() => {
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
});

// Stub Monaco (`@brand/editor`) — far too heavy for jsdom, and irrelevant to what this WP verifies
// (the diff-vs-base WIRING, not Monaco rendering itself). Capture the props each call received so
// tests can assert exactly what content/language reached the editor, mirroring
// `AssistantDiffCard.test.tsx` / `design-chrome.test.tsx`'s stubbing convention.
vi.mock("@brand/editor", () => ({
  CodeEditor: (props: { value: string; language: string; ariaLabel?: string }) => (
    <div data-testid="code-editor" data-language={props.language} aria-label={props.ariaLabel}>
      {props.value}
    </div>
  ),
  DiffEditor: (props: { original: string; modified: string; language: string }) => (
    <div
      data-testid="diff-editor"
      data-language={props.language}
      data-original={props.original}
      data-modified={props.modified}
    />
  ),
}));

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, getAssistantWorkspaceFile: vi.fn() };
});
vi.mock("./skills-inspector-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./skills-inspector-api")>();
  return { ...actual, getSkillFile: vi.fn() };
});

import { ApiError, getAssistantWorkspaceFile } from "../../lib/api";
import { getSkillFile } from "./skills-inspector-api";
import { LiveSkillWorkspaceView } from "./LiveSkillWorkspaceView";

const FILES: AssistantWorkspaceFileNode[] = [
  { path: "SKILL.md", size: 42, isBinary: false },
  { path: "references/NOTES.md", size: 10, isBinary: false },
  { path: "assets/logo.png", size: 999, isBinary: true },
];

function changed(
  ...entries: Array<[string, AssistantWorkspaceChangeKind]>
): ReadonlyMap<string, AssistantWorkspaceChangeKind> {
  return new Map(entries);
}

beforeEach(() => {
  vi.mocked(getAssistantWorkspaceFile).mockReset();
  vi.mocked(getSkillFile).mockReset();
});

describe("LiveSkillWorkspaceView", () => {
  test("shows an empty state when the live tree has no files yet", () => {
    render(
      <LiveSkillWorkspaceView
        threadId="thread-1"
        skillId="skill-1"
        baseVersionId="v1"
        files={[]}
        changedPaths={changed()}
        selectedPath={undefined}
        onSelectPath={vi.fn()}
        changeNonce={0}
      />,
    );
    expect(screen.getByText("No files yet")).toBeInTheDocument();
  });

  test("renders the live banner + file tree, badging changed files", () => {
    render(
      <LiveSkillWorkspaceView
        threadId="thread-1"
        skillId="skill-1"
        baseVersionId="v1"
        files={FILES}
        changedPaths={changed(["references/NOTES.md", "created"])}
        selectedPath={undefined}
        onSelectPath={vi.fn()}
        changeNonce={0}
      />,
    );
    expect(screen.getByText(/live, uncommitted files/)).toBeInTheDocument();
    expect(screen.getByText("SKILL.md")).toBeInTheDocument();
    expect(screen.getByText("NOTES.md")).toBeInTheDocument();
    expect(screen.getByText("new")).toBeInTheDocument(); // the "created" badge label
  });

  test("clicking a file in the tree reports its path", () => {
    const onSelectPath = vi.fn();
    render(
      <LiveSkillWorkspaceView
        threadId="thread-1"
        skillId="skill-1"
        baseVersionId="v1"
        files={FILES}
        changedPaths={changed()}
        selectedPath={undefined}
        onSelectPath={onSelectPath}
        changeNonce={0}
      />,
    );
    fireEvent.click(screen.getByText("SKILL.md"));
    expect(onSelectPath).toHaveBeenCalledWith("SKILL.md");
  });

  test("no selection shows the empty prompt in the content pane", () => {
    render(
      <LiveSkillWorkspaceView
        threadId="thread-1"
        skillId="skill-1"
        baseVersionId="v1"
        files={FILES}
        changedPaths={changed()}
        selectedPath={undefined}
        onSelectPath={vi.fn()}
        changeNonce={0}
      />,
    );
    expect(screen.getByText("No file selected")).toBeInTheDocument();
  });

  test("a text file with a base counterpart renders a live-vs-base DiffEditor", async () => {
    vi.mocked(getAssistantWorkspaceFile).mockResolvedValue({
      path: "SKILL.md",
      isBinary: false,
      text: "live body",
    });
    vi.mocked(getSkillFile).mockResolvedValue({
      path: "SKILL.md",
      isBinary: false,
      text: "base body",
      tokenTotal: 3,
    });

    render(
      <LiveSkillWorkspaceView
        threadId="thread-1"
        skillId="skill-1"
        baseVersionId="v1"
        files={FILES}
        changedPaths={changed(["SKILL.md", "modified"])}
        selectedPath="SKILL.md"
        onSelectPath={vi.fn()}
        changeNonce={0}
      />,
    );

    await waitFor(() => expect(screen.getByTestId("diff-editor")).toBeInTheDocument());
    const editor = screen.getByTestId("diff-editor");
    expect(editor.dataset.original).toBe("base body");
    expect(editor.dataset.modified).toBe("live body");
    expect(getAssistantWorkspaceFile).toHaveBeenCalledWith("thread-1", "skill-1", "SKILL.md");
    expect(getSkillFile).toHaveBeenCalledWith("skill-1", "v1", "SKILL.md");
    // The "modified" badge appears TWICE — once on the tree row, once in the pane header.
    expect(screen.getAllByText("edited")).toHaveLength(2);
  });

  test("a file that doesn't exist in the base version (a 404) renders as Added — single pane, no diff", async () => {
    vi.mocked(getAssistantWorkspaceFile).mockResolvedValue({
      path: "references/NOTES.md",
      isBinary: false,
      text: "brand new",
    });
    vi.mocked(getSkillFile).mockRejectedValue(new ApiError(404, "No such file"));

    render(
      <LiveSkillWorkspaceView
        threadId="thread-1"
        skillId="skill-1"
        baseVersionId="v1"
        files={FILES}
        changedPaths={changed(["references/NOTES.md", "created"])}
        selectedPath="references/NOTES.md"
        onSelectPath={vi.fn()}
        changeNonce={0}
      />,
    );

    await waitFor(() => expect(screen.getByTestId("code-editor")).toBeInTheDocument());
    expect(screen.getByTestId("code-editor")).toHaveTextContent("brand new");
    expect(screen.getByText(/Added · references\/NOTES\.md/)).toBeInTheDocument();
    expect(screen.queryByTestId("diff-editor")).not.toBeInTheDocument();
  });

  test("a binary file shows a binary note instead of an editor", async () => {
    vi.mocked(getAssistantWorkspaceFile).mockResolvedValue({
      path: "assets/logo.png",
      isBinary: true,
      size: 999,
    });

    render(
      <LiveSkillWorkspaceView
        threadId="thread-1"
        skillId="skill-1"
        baseVersionId="v1"
        files={FILES}
        changedPaths={changed()}
        selectedPath="assets/logo.png"
        onSelectPath={vi.fn()}
        changeNonce={0}
      />,
    );

    await waitFor(() => expect(screen.getByText("Binary file")).toBeInTheDocument());
    expect(screen.queryByTestId("diff-editor")).not.toBeInTheDocument();
    expect(screen.queryByTestId("code-editor")).not.toBeInTheDocument();
    // `getSkillFile` is never called once the LIVE side is already known binary — no point diffing.
    expect(getSkillFile).not.toHaveBeenCalled();
  });

  test("a genuine live-fetch failure surfaces inline, not as a silent empty pane", async () => {
    vi.mocked(getAssistantWorkspaceFile).mockRejectedValue(new Error("boom"));

    render(
      <LiveSkillWorkspaceView
        threadId="thread-1"
        skillId="skill-1"
        baseVersionId="v1"
        files={FILES}
        changedPaths={changed()}
        selectedPath="SKILL.md"
        onSelectPath={vi.fn()}
        changeNonce={0}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText(/Couldn’t load the live file/)).toBeInTheDocument(),
    );
  });

  test("changeNonce forces a refetch of the SAME selected file (a repeat edit isn't stale)", async () => {
    vi.mocked(getAssistantWorkspaceFile)
      .mockResolvedValueOnce({ path: "SKILL.md", isBinary: false, text: "v1" })
      .mockResolvedValueOnce({ path: "SKILL.md", isBinary: false, text: "v2" });
    vi.mocked(getSkillFile).mockResolvedValue({
      path: "SKILL.md",
      isBinary: false,
      text: "base",
      tokenTotal: 1,
    });

    const { rerender } = render(
      <LiveSkillWorkspaceView
        threadId="thread-1"
        skillId="skill-1"
        baseVersionId="v1"
        files={FILES}
        changedPaths={changed(["SKILL.md", "modified"])}
        selectedPath="SKILL.md"
        onSelectPath={vi.fn()}
        changeNonce={1}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("diff-editor")).toHaveAttribute("data-modified", "v1"),
    );

    rerender(
      <LiveSkillWorkspaceView
        threadId="thread-1"
        skillId="skill-1"
        baseVersionId="v1"
        files={FILES}
        changedPaths={changed(["SKILL.md", "modified"])}
        selectedPath="SKILL.md"
        onSelectPath={vi.fn()}
        changeNonce={2}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("diff-editor")).toHaveAttribute("data-modified", "v2"),
    );
    expect(getAssistantWorkspaceFile).toHaveBeenCalledTimes(2);
  });
});
