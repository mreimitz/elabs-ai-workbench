import type {
  HubAgentRole,
  HubArtifact,
  HubArtifactVersion,
  HubReview,
} from "@mcp-token-footprint/shared";
import { TooltipProvider } from "@elabs-ai/components-ui";
import { fireEvent, render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";

// WP1.6 — mirrors AssistantView.test.tsx: stub the heavy `@elabs-ai/components-ai` surface with the shared,
// reusable stub (see `test-support/brand-ai-mock.tsx`'s doc comment).
vi.mock("@elabs-ai/components-ai", () => import("./test-support/brand-ai-mock"));

// WP3.5's Diff tab statically imports `@elabs-ai/components-editor`'s Monaco `DiffEditor` — far too heavy for jsdom
// (pulls in `@milkdown/kit`'s ProseMirror CSS, which vitest can't transform). Stub it the same way
// `AssistantDiffCard.test.tsx` / `design-chrome.test.tsx` do.
vi.mock("@elabs-ai/components-editor", () => ({ CodeEditor: () => null, DiffEditor: () => null }));

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    listHubArtifacts: vi.fn(),
    listHubArtifactVersions: vi.fn(),
    fetchHubArtifactShareHtml: vi.fn(),
    // Called unconditionally on mount (the Review tab's role picker, D-AH7) — default to an empty
    // roster so tests that never touch the Review tab don't need to know about it.
    listHubAgentRoles: vi.fn().mockResolvedValue([]),
    listHubArtifactReviews: vi.fn(),
    requestHubArtifactReview: vi.fn(),
    decideHubReview: vi.fn(),
    revertHubArtifactVersion: vi.fn(),
  };
});

import * as api from "../../lib/api";
import { ArtifactCanvas } from "./ArtifactCanvas";

// The version list's "Revert to version N" control is an `IconButton` (D-TB5), which wraps every
// control in a Radix `Tooltip` — that throws without an ancestor `TooltipProvider` (the app root
// mounts one; this file's many render() call sites don't get it automatically).
function render(ui: ReactElement) {
  return rtlRender(<TooltipProvider>{ui}</TooltipProvider>);
}

function artifact(overrides: Partial<HubArtifact> = {}): HubArtifact {
  return {
    id: "art-1",
    sessionId: "s1",
    kind: "markdown",
    title: "Findings report",
    latestVersion: 1,
    currentVersionId: "v-1",
    createdAt: "2026-07-17T09:00:00.000Z",
    updatedAt: "2026-07-17T09:00:00.000Z",
    ...overrides,
  };
}

function version(overrides: Partial<HubArtifactVersion> = {}): HubArtifactVersion {
  return {
    id: "v-1",
    artifactId: "art-1",
    version: 1,
    content: "# Hello\n\nBody.",
    authorKind: "assistant",
    createdAt: "2026-07-17T09:00:00.000Z",
    ...overrides,
  };
}

function review(overrides: Partial<HubReview> = {}): HubReview {
  return {
    id: "rev-1",
    artifactId: "art-1",
    baseVersion: 1,
    status: "open",
    reviewerKind: "agent",
    reviewerRef: "critic",
    comments: [],
    createdAt: "2026-07-17T09:05:00.000Z",
    updatedAt: "2026-07-17T09:05:00.000Z",
    ...overrides,
  };
}

beforeAll(() => {
  // ui-wave U2 — the expand modal is a REAL @elabs-ai/components-ui Dialog (Radix), which reads matchMedia +
  // ResizeObserver on open; jsdom lacks both (mirrors ExpandableTable.test.tsx's own polyfill).
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;
  }
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

afterEach(() => {
  vi.clearAllMocks();
});

/** Radix's `DropdownMenuTrigger` (real, unmocked — `@elabs-ai/components-ui`) only listens for pointerdown/keydown,
 *  not `click` — `fireEvent.click` alone never opens it in jsdom (mirrors AssistantDock.test.tsx's own
 *  verified pattern for the same component). */
function openExportMenu(): void {
  fireEvent.keyDown(screen.getByRole("button", { name: "Export" }), { key: "Enter" });
}

/** Radix `TabsTrigger` activates on mousedown (and keyboard) — click alone doesn't switch it (mirrors
 *  `design-chrome.test.tsx`'s own verified pattern for the same component). */
function activateTab(name: string): void {
  const tab = screen.getByRole("tab", { name });
  fireEvent.mouseDown(tab, { button: 0 });
  fireEvent.click(tab);
}

describe("ArtifactCanvas — empty state", () => {
  test("no artifacts shows an empty state, never a crash", async () => {
    vi.mocked(api.listHubArtifacts).mockResolvedValue([]);

    render(<ArtifactCanvas sessionId="s1" />);

    await waitFor(() => expect(screen.getByText("No artifacts yet")).toBeInTheDocument());
    expect(api.listHubArtifacts).toHaveBeenCalledWith({ session: "s1" });
  });
});

describe("ArtifactCanvas — single artifact", () => {
  function stubOne(): void {
    vi.mocked(api.listHubArtifacts).mockResolvedValue([artifact()]);
    vi.mocked(api.listHubArtifactVersions).mockResolvedValue([version()]);
  }

  test("renders the artifact title, kind/version description, and its markdown content", async () => {
    stubOne();
    render(<ArtifactCanvas sessionId="s1" />);

    await waitFor(() => expect(screen.getByText("Findings report")).toBeInTheDocument());
    expect(screen.getByText("Markdown · v1 of 1")).toBeInTheDocument();
    expect(screen.getByTestId("markdown-view")).toHaveTextContent("# Hello");
    // A single artifact/version needs neither the artifact picker nor a version list.
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByText("Versions")).not.toBeInTheDocument();
  });

  test("an html-kind artifact renders through WebPreviewBody's srcDoc, not MarkdownView", async () => {
    vi.mocked(api.listHubArtifacts).mockResolvedValue([artifact({ kind: "html" })]);
    vi.mocked(api.listHubArtifactVersions).mockResolvedValue([version({ content: "<p>hi</p>" })]);
    render(<ArtifactCanvas sessionId="s1" />);

    await waitFor(() => expect(screen.getByTestId("web-preview-body")).toBeInTheDocument());
    expect(screen.getByTestId("web-preview-body")).toHaveTextContent("<p>hi</p>");
    expect(screen.queryByTestId("markdown-view")).not.toBeInTheDocument();
  });

  test("the Close action calls onClose", async () => {
    stubOne();
    const onClose = vi.fn();
    render(<ArtifactCanvas sessionId="s1" onClose={onClose} />);

    await waitFor(() => expect(screen.getByText("Findings report")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("no onClose prop renders no Close action", async () => {
    stubOne();
    render(<ArtifactCanvas sessionId="s1" />);
    await waitFor(() => expect(screen.getByText("Findings report")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
  });
});

describe("ArtifactCanvas — versions", () => {
  test("multiple versions render a version list (newest first); selecting an older one swaps the shown content", async () => {
    vi.mocked(api.listHubArtifacts).mockResolvedValue([
      artifact({ latestVersion: 2, currentVersionId: "v-2" }),
    ]);
    vi.mocked(api.listHubArtifactVersions).mockResolvedValue([
      version({ id: "v-1", version: 1, content: "v1 body", authorKind: "user" }),
      version({ id: "v-2", version: 2, content: "v2 body", authorKind: "assistant" }),
    ]);

    render(<ArtifactCanvas sessionId="s1" />);

    await waitFor(() => expect(screen.getByText("Markdown · v2 of 2")).toBeInTheDocument());
    expect(screen.getByTestId("markdown-view")).toHaveTextContent("v2 body");

    const versionSection = screen.getByText("Versions").closest("div")!
      .parentElement as HTMLElement;
    fireEvent.click(within(versionSection).getByText("v1"));

    await waitFor(() => expect(screen.getByText("Markdown · v1 of 2")).toBeInTheDocument());
    expect(screen.getByTestId("markdown-view")).toHaveTextContent("v1 body");
  });
});

describe("ArtifactCanvas — multiple artifacts", () => {
  test("shows an artifact picker naming the selected artifact", async () => {
    vi.mocked(api.listHubArtifacts).mockResolvedValue([
      artifact({ id: "art-1", title: "First doc" }),
      artifact({ id: "art-2", title: "Second doc", currentVersionId: "v-2" }),
    ]);
    vi.mocked(api.listHubArtifactVersions).mockResolvedValue([version()]);

    render(<ArtifactCanvas sessionId="s1" />);

    await waitFor(() => expect(screen.getByRole("combobox")).toBeInTheDocument());
    expect(screen.getByRole("combobox")).toHaveTextContent("First doc");
  });
});

describe("ArtifactCanvas — export menu", () => {
  function stubOne(): void {
    vi.mocked(api.listHubArtifacts).mockResolvedValue([artifact()]);
    vi.mocked(api.listHubArtifactVersions).mockResolvedValue([version()]);
  }

  test("Export exposes md/html/json download/view links and a share.html download link", async () => {
    stubOne();
    render(<ArtifactCanvas sessionId="s1" />);
    await waitFor(() => expect(screen.getByText("Findings report")).toBeInTheDocument());

    openExportMenu();

    // Radix's `DropdownMenuItem asChild` merges its own `role="menuitem"` onto the anchor, overriding
    // the implicit "link" role a bare `<a href>` would otherwise carry — query by "menuitem".
    const md = await screen.findByRole("menuitem", { name: "Markdown (.md)" });
    expect(md).toHaveAttribute("href", "/api/hub/artifacts/art-1/export?format=md&version=1");
    expect(md).toHaveAttribute("download");

    const html = screen.getByRole("menuitem", { name: "HTML" });
    expect(html).toHaveAttribute("href", "/api/hub/artifacts/art-1/export?format=html&version=1");

    const json = screen.getByRole("menuitem", { name: "JSON" });
    expect(json).toHaveAttribute("href", "/api/hub/artifacts/art-1/export?format=json&version=1");

    const share = screen.getByRole("menuitem", { name: "Download share.html" });
    expect(share).toHaveAttribute("href", "/api/hub/artifacts/art-1/share?version=1");
    expect(share).toHaveAttribute("download");
  });

  test("Copy share.html fetches the share document and writes it to the clipboard", async () => {
    stubOne();
    vi.mocked(api.fetchHubArtifactShareHtml).mockResolvedValue("<!doctype html>...");
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<ArtifactCanvas sessionId="s1" />);
    await waitFor(() => expect(screen.getByText("Findings report")).toBeInTheDocument());

    openExportMenu();
    fireEvent.click(await screen.findByText("Copy share.html"));

    await waitFor(() => expect(api.fetchHubArtifactShareHtml).toHaveBeenCalledWith("art-1", 1));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("<!doctype html>..."));
  });
});

// ── ui-wave U2 — the expand modal (owner feedback: a NORMAL Dialog, never a raw fullscreen) ──────────

describe("ArtifactCanvas — expand modal (ui-wave U2)", () => {
  function stubOne(): void {
    vi.mocked(api.listHubArtifacts).mockResolvedValue([artifact()]);
    vi.mocked(api.listHubArtifactVersions).mockResolvedValue([version()]);
  }

  test("Expand opens a role=dialog titled with the ARTIFACT title, re-rendering the content, with Export inside", async () => {
    stubOne();
    render(<ArtifactCanvas sessionId="s1" />);
    await waitFor(() => expect(screen.getByText("Findings report")).toBeInTheDocument());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Expand" }));

    const dialog = screen.getByRole("dialog");
    // Requirement: a meaningful title — the artifact's own title.
    expect(within(dialog).getByText("Findings report")).toBeInTheDocument();
    // The same version content renders inside the modal (the canvas copy stays mounted behind it).
    expect(within(dialog).getByTestId("markdown-view")).toHaveTextContent("# Hello");
    // Requirement: the export/copy actions stay available INSIDE the dialog.
    expect(within(dialog).getByRole("button", { name: "Export" })).toBeInTheDocument();
  });

  test("Escape closes the expand dialog", async () => {
    stubOne();
    render(<ArtifactCanvas sessionId="s1" />);
    await waitFor(() => expect(screen.getByText("Findings report")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Radix's DismissableLayer listens for Escape at the document level (mirrors AuditView.test.tsx).
    fireEvent.keyDown(document.body, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // The canvas view is still there — closing the modal never loses the content.
    expect(screen.getByTestId("markdown-view")).toHaveTextContent("# Hello");
  });

  test("the markdown body switches Streamdown's raw table-fullscreen control OFF (copy/download stay)", async () => {
    stubOne();
    render(<ArtifactCanvas sessionId="s1" />);
    await waitFor(() => expect(screen.getByTestId("markdown-view")).toBeInTheDocument());

    // The shared brand-ai mock surfaces `controls` as a data attribute (jsdom can't render the real
    // Streamdown toolbar) — this pins the wiring that removes the `fixed inset-0` takeover.
    expect(screen.getByTestId("markdown-view")).toHaveAttribute(
      "data-controls",
      JSON.stringify({ table: { fullscreen: false } }),
    );
  });
});

// ── WP3.5 — Diff tab ─────────────────────────────────────────────────────────────────────────────────

describe("ArtifactCanvas — Diff tab", () => {
  test("with a single version, the Diff tab shows an empty state (nothing to diff yet)", async () => {
    vi.mocked(api.listHubArtifacts).mockResolvedValue([artifact()]);
    vi.mocked(api.listHubArtifactVersions).mockResolvedValue([version()]);
    vi.mocked(api.listHubArtifactReviews).mockResolvedValue([]);
    render(<ArtifactCanvas sessionId="s1" />);
    await waitFor(() => expect(screen.getByText("Findings report")).toBeInTheDocument());

    activateTab("Diff");

    expect(await screen.findByText("Nothing to diff yet")).toBeInTheDocument();
  });

  test("with two versions, the Diff tab compares the prior version against the selected one", async () => {
    vi.mocked(api.listHubArtifacts).mockResolvedValue([
      artifact({ latestVersion: 2, currentVersionId: "v-2" }),
    ]);
    vi.mocked(api.listHubArtifactVersions).mockResolvedValue([
      version({ id: "v-1", version: 1, content: "v1 body" }),
      version({ id: "v-2", version: 2, content: "v2 body" }),
    ]);
    vi.mocked(api.listHubArtifactReviews).mockResolvedValue([]);
    render(<ArtifactCanvas sessionId="s1" />);
    await waitFor(() => expect(screen.getByText("Markdown · v2 of 2")).toBeInTheDocument());

    activateTab("Diff");

    // `DiffEditor` itself is stubbed (jsdom can't run Monaco); the compare picker is real @elabs-ai/components-ui.
    await waitFor(() => expect(screen.getByText("→ v2")).toBeInTheDocument());
    expect(screen.getByRole("combobox", { name: "Compare" })).toHaveTextContent("v1");
  });
});

// ── WP3.5 — Review tab ───────────────────────────────────────────────────────────────────────────────

describe("ArtifactCanvas — Review tab", () => {
  function stubOne(extra: Partial<{ roles: HubAgentRole[]; reviews: HubReview[] }> = {}): void {
    vi.mocked(api.listHubArtifacts).mockResolvedValue([artifact()]);
    vi.mocked(api.listHubArtifactVersions).mockResolvedValue([version()]);
    vi.mocked(api.listHubAgentRoles).mockResolvedValue(extra.roles ?? []);
    vi.mocked(api.listHubArtifactReviews).mockResolvedValue(extra.reviews ?? []);
  }

  async function openReviewTab(): Promise<void> {
    await waitFor(() => expect(screen.getByText("Findings report")).toBeInTheDocument());
    activateTab("Review");
  }

  test("no review yet shows an empty state and a request form; submitting calls requestHubArtifactReview", async () => {
    stubOne();
    vi.mocked(api.requestHubArtifactReview).mockResolvedValue(review());
    render(<ArtifactCanvas sessionId="s1" />);
    await openReviewTab();

    expect(await screen.findByText("No review yet")).toBeInTheDocument();

    const modelInput = screen.getByLabelText("Model");
    fireEvent.change(modelInput, { target: { value: "claude-sonnet-4-6" } });
    fireEvent.click(screen.getByRole("button", { name: "Request review" }));

    await waitFor(() =>
      expect(api.requestHubArtifactReview).toHaveBeenCalledWith("art-1", {
        model: "claude-sonnet-4-6",
      }),
    );
  });

  test("a role picker appears when the role library is non-empty; picking a role hides the model field", async () => {
    stubOne({
      roles: [
        {
          id: "role-1",
          name: "Style critic",
          systemPrompt: "x",
          defaultModel: "gpt-4o",
          toolGrants: { servers: {}, builtins: [] },
          skills: [],
          target: "x",
          expectedOutcome: "x",
          createdAt: "t",
          updatedAt: "t",
        },
      ],
    });
    render(<ArtifactCanvas sessionId="s1" />);
    await openReviewTab();

    await waitFor(() => expect(screen.getByLabelText("Role")).toBeInTheDocument());
    expect(screen.getByLabelText("Model")).toBeInTheDocument(); // "No role" is the default selection

    fireEvent.click(screen.getByLabelText("Role"));
    fireEvent.click(await screen.findByText("Style critic"));

    await waitFor(() => expect(screen.queryByLabelText("Model")).not.toBeInTheDocument());
  });

  test("pending comments render as ChangeReview hunks; approving one accepts it", async () => {
    const openReview = review({
      comments: [
        {
          id: "cm-1",
          anchor: { quote: "March 1st" },
          body: "Confirm the date.",
          suggestedEdit: "March 3rd",
          decision: "pending",
          authorKind: "agent",
          authorRef: "critic",
          createdAt: "t",
        },
      ],
    });
    stubOne({ reviews: [openReview] });
    vi.mocked(api.decideHubReview).mockResolvedValue({ review: { ...openReview, comments: [] } });
    render(<ArtifactCanvas sessionId="s1" />);
    await openReviewTab();

    await waitFor(() => expect(screen.getByText("Confirm the date.")).toBeInTheDocument());
    // "March 1st" appears twice (the hunk title AND the before/after diff's struck-through line).
    expect(screen.getAllByText("March 1st").length).toBeGreaterThan(0);
    expect(screen.getByText("March 3rd")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Approve hunk: March 1st" }));

    await waitFor(() =>
      expect(api.decideHubReview).toHaveBeenCalledWith("rev-1", {
        decision: { commentId: "cm-1", decision: "accepted" },
      }),
    );
  });

  test("rejecting a pending comment calls decideHubReview with rejected", async () => {
    const openReview = review({
      comments: [
        {
          id: "cm-1",
          body: "General note, no anchor.",
          decision: "pending",
          authorKind: "agent",
          authorRef: "critic",
          createdAt: "t",
        },
      ],
    });
    stubOne({ reviews: [openReview] });
    vi.mocked(api.decideHubReview).mockResolvedValue({ review: { ...openReview, comments: [] } });
    render(<ArtifactCanvas sessionId="s1" />);
    await openReviewTab();

    await waitFor(() => expect(screen.getByText("General note, no anchor.")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));

    await waitFor(() =>
      expect(api.decideHubReview).toHaveBeenCalledWith("rev-1", {
        decision: { commentId: "cm-1", decision: "rejected" },
      }),
    );
  });

  test("decided comments render in a compact Decided list, not as ChangeReview hunks", async () => {
    stubOne({
      reviews: [
        review({
          comments: [
            {
              id: "cm-1",
              body: "Already handled.",
              decision: "accepted",
              authorKind: "agent",
              authorRef: "critic",
              createdAt: "t",
            },
          ],
        }),
      ],
    });
    render(<ArtifactCanvas sessionId="s1" />);
    await openReviewTab();

    await waitFor(() => expect(screen.getByText("Decided")).toBeInTheDocument());
    expect(screen.getByText("Already handled.")).toBeInTheDocument();
    expect(screen.getByText("accepted")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Approve hunk/ })).not.toBeInTheDocument();
  });
});

// ── WP3.5 — version revert (R-UX7 undo) ─────────────────────────────────────────────────────────────

describe("ArtifactCanvas — version revert", () => {
  test("a non-latest version shows a Revert action; confirming calls revertHubArtifactVersion", async () => {
    vi.mocked(api.listHubArtifacts).mockResolvedValue([
      artifact({ latestVersion: 2, currentVersionId: "v-2" }),
    ]);
    vi.mocked(api.listHubArtifactVersions).mockResolvedValue([
      version({ id: "v-1", version: 1, content: "v1 body" }),
      version({ id: "v-2", version: 2, content: "v2 body" }),
    ]);
    vi.mocked(api.listHubArtifactReviews).mockResolvedValue([]);
    vi.mocked(api.revertHubArtifactVersion).mockResolvedValue(
      version({ id: "v-3", version: 3, content: "v1 body", authorKind: "user" }),
    );
    render(<ArtifactCanvas sessionId="s1" />);
    await waitFor(() => expect(screen.getByText("Markdown · v2 of 2")).toBeInTheDocument());

    // Only the older (non-latest) version carries a revert action.
    expect(screen.queryByRole("button", { name: "Revert to version 2" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Revert to version 1" }));

    fireEvent.click(await screen.findByRole("button", { name: "Revert" }));

    await waitFor(() => expect(api.revertHubArtifactVersion).toHaveBeenCalledWith("art-1", 1));
  });
});
