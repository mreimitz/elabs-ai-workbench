import type { HubProject, HubSession } from "@mcp-token-footprint/shared";
import { TooltipProvider } from "@elabs-ai/components-ui";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api")>();
  return {
    ...actual,
    listHubProjects: vi.fn(),
    createHubProject: vi.fn(),
    updateHubProject: vi.fn(),
    deleteHubProject: vi.fn(),
    listHubProjectFiles: vi.fn(),
    // ui-wave U6 — the rail rows' session counts + the header's "N sessions" link fetch the same
    // dataset the sessions table renders.
    listHubSessionsForTable: vi.fn(),
    // WP2.7 (D-HUX11) — ProjectEditor's Memory section (`ScopedMemoryList`) fetches on mount.
    listHubMemory: vi.fn(),
  };
});

import * as api from "../../../lib/api";
import { ProjectLibraryPanel } from "./ProjectLibraryPanel";

// The detail header links to `/assistant/sessions?projectId=` via `react-router-dom`'s `Link` —
// every render needs a Router ancestor. The detail pane (ProjectEditor/PinnedFilesEditor/
// ScopedMemoryList) also renders `IconButton`s (D-TB5), which wrap every control in a Radix
// `Tooltip` — that throws without an ancestor `TooltipProvider` (the app root mounts one).
function renderPanel() {
  return render(
    <TooltipProvider>
      <MemoryRouter>
        <ProjectLibraryPanel />
      </MemoryRouter>
    </TooltipProvider>,
  );
}

function project(overrides: Partial<HubProject> = {}): HubProject {
  return {
    id: "proj-1",
    name: "Q3 Launch",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    archivedAt: null,
    ...overrides,
  };
}

/** Minimal top-level session — the panel only reads `projectId`, but the mock must satisfy the
 *  full wire type (mirrors `SessionsView.test.tsx`'s factory). */
function session(overrides: Partial<HubSession> = {}): HubSession {
  return {
    id: "s1",
    kind: "chat",
    title: "A session",
    titleState: "auto",
    mode: "chat",
    model: "claude-sonnet-5",
    status: "completed",
    costUsd: 0,
    tokensIn: 0,
    tokensOut: 0,
    turns: 0,
    archived: false,
    createdAt: "2026-07-17T09:00:00.000Z",
    updatedAt: "2026-07-17T09:00:00.000Z",
    seen: true,
    ...overrides,
  };
}

/** Select a rail row, then wait for the detail header to hydrate. */
async function selectProject(name: string): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(name) }));
  await screen.findByRole("heading", { name, level: 2 });
}

/** Radix's DropdownMenuTrigger only listens for pointerdown/keydown, not click, in jsdom (the
 *  established `SessionsView.test.tsx` pattern). */
function openProjectActions(): void {
  fireEvent.keyDown(screen.getByRole("button", { name: "Project actions" }), { key: "Enter" });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listHubProjectFiles).mockResolvedValue([]);
  vi.mocked(api.listHubMemory).mockResolvedValue([]);
  vi.mocked(api.listHubSessionsForTable).mockResolvedValue([]);
});

describe("ProjectLibraryPanel — empty state", () => {
  test("shows the rail empty state and a centered Select-a-project pane with a New project action", async () => {
    vi.mocked(api.listHubProjects).mockResolvedValue([]);
    renderPanel();
    await waitFor(() => expect(screen.getByText("No projects yet")).toBeInTheDocument());
    expect(screen.getByText("Select a project")).toBeInTheDocument();

    // The empty pane's primary action opens the same create draft as the rail's "+ New".
    fireEvent.click(screen.getByRole("button", { name: "New project" }));
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
  });
});

describe("ProjectLibraryPanel — filtered empty state (finding 13)", () => {
  test("a filter with no matches echoes the query and its Clear filter action restores the rail", async () => {
    vi.mocked(api.listHubProjects).mockResolvedValue([project({ name: "Q3 Launch" })]);
    renderPanel();

    await waitFor(() => expect(screen.getByText("Q3 Launch")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Filter projects"), {
      target: { value: "quarterly" },
    });
    expect(screen.getByText("No projects match “quarterly”")).toBeInTheDocument();
    expect(screen.queryByText("Q3 Launch")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(screen.getByText("Q3 Launch")).toBeInTheDocument();
    expect(screen.queryByText(/No projects match/)).not.toBeInTheDocument();
  });
});

describe("ProjectLibraryPanel — create", () => {
  test("filling the name and submitting creates a project", async () => {
    vi.mocked(api.listHubProjects).mockResolvedValue([]);
    vi.mocked(api.createHubProject).mockResolvedValue(project({ id: "new-project" }));
    renderPanel();

    await waitFor(() => expect(screen.getByText("No projects yet")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "New" }));

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Q3 Launch" } });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));

    await waitFor(() => expect(api.createHubProject).toHaveBeenCalledTimes(1));
    expect(api.createHubProject).toHaveBeenCalledWith({ name: "Q3 Launch" });
    // The created project becomes the selection — its identity header replaces the draft form.
    await screen.findByRole("heading", { name: "Q3 Launch", level: 2 });
  });

  test("submitting with an empty name shows an inline error and never calls the API", async () => {
    vi.mocked(api.listHubProjects).mockResolvedValue([]);
    renderPanel();

    await waitFor(() => expect(screen.getByText("No projects yet")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "not empty" } });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));

    await waitFor(() => expect(screen.getByText("Name is required.")).toBeInTheDocument());
    expect(api.createHubProject).not.toHaveBeenCalled();
  });
});

describe("ProjectLibraryPanel — select, edit, dirty guard", () => {
  test("selecting a project loads it; editing then switching selection prompts to discard", async () => {
    const projectA = project({ id: "pa", name: "Project A" });
    const projectB = project({ id: "pb", name: "Project B" });
    vi.mocked(api.listHubProjects).mockResolvedValue([projectA, projectB]);
    renderPanel();

    await waitFor(() => expect(screen.getByText("Project A")).toBeInTheDocument());
    await selectProject("Project A");

    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "edited" } });
    fireEvent.click(screen.getByRole("button", { name: /Project B/ }));

    expect(screen.getByText("Discard unsaved changes?")).toBeInTheDocument();
    // Still on A with the edit intact — the guard blocks the switch until the user decides. (Role
    // queries can't see behind the modal — Radix aria-hides the background — so assert the value.)
    expect(screen.getByLabelText("Description")).toHaveValue("edited");

    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    await screen.findByRole("heading", { name: "Project B", level: 2 });
  });

  test("Save stays disabled until something actually changed", async () => {
    vi.mocked(api.listHubProjects).mockResolvedValue([project()]);
    renderPanel();

    await waitFor(() => expect(screen.getByText("Q3 Launch")).toBeInTheDocument());
    await selectProject("Q3 Launch");

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "now dirty" } });
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    // A whitespace-only "change" round-trips to a no-op on the wire — Save must not arm for it.
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  test("saving an edit sends a PATCH with explicit nulls for cleared optional fields", async () => {
    const existing = project({ description: "Old description" });
    vi.mocked(api.listHubProjects).mockResolvedValue([existing]);
    vi.mocked(api.updateHubProject).mockResolvedValue({ ...existing, description: undefined });
    renderPanel();

    await waitFor(() => expect(screen.getByText(existing.name)).toBeInTheDocument());
    await selectProject(existing.name);

    expect(screen.getByLabelText("Description")).toHaveValue("Old description");
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.updateHubProject).toHaveBeenCalledTimes(1));
    const [id, patch] = vi.mocked(api.updateHubProject).mock.calls[0]!;
    expect(id).toBe(existing.id);
    expect(patch.description).toBeNull();
  });

  test("Cmd/Ctrl+S saves when dirty and does nothing when clean", async () => {
    const existing = project();
    vi.mocked(api.listHubProjects).mockResolvedValue([existing]);
    vi.mocked(api.updateHubProject).mockResolvedValue({ ...existing, description: "via shortcut" });
    renderPanel();

    await waitFor(() => expect(screen.getByText(existing.name)).toBeInTheDocument());
    await selectProject(existing.name);

    // Clean: the shortcut must not fire a no-op PATCH.
    fireEvent.keyDown(window, { key: "s", metaKey: true });
    expect(api.updateHubProject).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "via shortcut" } });
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await waitFor(() => expect(api.updateHubProject).toHaveBeenCalledTimes(1));
    const [, patch] = vi.mocked(api.updateHubProject).mock.calls[0]!;
    expect(patch.description).toBe("via shortcut");
  });
});

describe("ProjectLibraryPanel — click-to-edit rename", () => {
  test("the pencil swaps the heading for an input; committing arms Save and the PATCH carries the new name", async () => {
    const existing = project();
    vi.mocked(api.listHubProjects).mockResolvedValue([existing]);
    vi.mocked(api.updateHubProject).mockResolvedValue({ ...existing, name: "Q3 Launch v2" });
    renderPanel();

    await waitFor(() => expect(screen.getByText(existing.name)).toBeInTheDocument());
    await selectProject(existing.name);

    fireEvent.click(screen.getByRole("button", { name: "Rename project" }));
    const input = screen.getByLabelText("Project name");
    expect(input).toHaveValue("Q3 Launch");

    fireEvent.change(input, { target: { value: "Q3 Launch v2" } });
    fireEvent.blur(input);

    // Committed into the FORM (heading updates, Save arms) — nothing hit the API yet.
    expect(screen.getByRole("heading", { name: "Q3 Launch v2", level: 2 })).toBeInTheDocument();
    expect(api.updateHubProject).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.updateHubProject).toHaveBeenCalledTimes(1));
    const [, patch] = vi.mocked(api.updateHubProject).mock.calls[0]!;
    expect(patch.name).toBe("Q3 Launch v2");
  });

  test("committing an empty name silently reverts instead of arming an invalid save", async () => {
    vi.mocked(api.listHubProjects).mockResolvedValue([project()]);
    renderPanel();

    await waitFor(() => expect(screen.getByText("Q3 Launch")).toBeInTheDocument());
    await selectProject("Q3 Launch");

    fireEvent.click(screen.getByRole("button", { name: "Rename project" }));
    const input = screen.getByLabelText("Project name");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input);

    expect(screen.getByRole("heading", { name: "Q3 Launch", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});

describe("ProjectLibraryPanel — sections and meta", () => {
  test("an existing (saved) project shows the pinned-files section; a new draft does not", async () => {
    const existing = project();
    vi.mocked(api.listHubProjects).mockResolvedValue([existing]);
    renderPanel();

    await waitFor(() => expect(screen.getByText(existing.name)).toBeInTheDocument());
    await selectProject(existing.name);
    await waitFor(() => expect(screen.getByText("Pinned files")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "New" }));
    expect(screen.queryByText("Pinned files")).not.toBeInTheDocument();
    expect(screen.getByText("Create the project first, then pin files to it.")).toBeInTheDocument();
  });

  // WP2.7 (D-HUX11, §7.4) — the project detail's Memory section (`ScopedMemoryList scope="project"`).
  test("an existing project shows its own Memory section, scoped to that project's id; a new draft does not", async () => {
    const existing = project();
    vi.mocked(api.listHubProjects).mockResolvedValue([existing]);
    renderPanel();

    await waitFor(() => expect(screen.getByText(existing.name)).toBeInTheDocument());
    await selectProject(existing.name);
    await waitFor(() => expect(screen.getByText("Memory")).toBeInTheDocument());
    await waitFor(() => expect(api.listHubMemory).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "New" }));
    expect(screen.queryByText("Memory")).not.toBeInTheDocument();
  });

  test("the header meta line links the session count to the sessions view filtered to this project", async () => {
    const existing = project({ id: "proj-42" });
    vi.mocked(api.listHubProjects).mockResolvedValue([existing]);
    vi.mocked(api.listHubSessionsForTable).mockResolvedValue([
      session({ id: "s1", projectId: "proj-42" }),
      session({ id: "s2", projectId: "proj-42" }),
      session({ id: "s3", projectId: undefined }),
    ]);
    renderPanel();

    await waitFor(() => expect(screen.getByText(existing.name)).toBeInTheDocument());
    await selectProject(existing.name);

    const sessionsLink = await screen.findByRole("link", { name: "2 sessions" });
    expect(sessionsLink).toHaveAttribute("href", "/assistant/sessions?projectId=proj-42");

    fireEvent.click(screen.getByRole("button", { name: "New" }));
    expect(screen.queryByRole("link", { name: /sessions/ })).not.toBeInTheDocument();
  });

  test("a failed session-count fetch degrades to a plain View sessions link, not an error", async () => {
    vi.mocked(api.listHubProjects).mockResolvedValue([project({ id: "proj-9" })]);
    vi.mocked(api.listHubSessionsForTable).mockRejectedValue(new Error("boom"));
    renderPanel();

    await waitFor(() => expect(screen.getByText("Q3 Launch")).toBeInTheDocument());
    await selectProject("Q3 Launch");

    const sessionsLink = await screen.findByRole("link", { name: "View sessions" });
    expect(sessionsLink).toHaveAttribute("href", "/assistant/sessions?projectId=proj-9");
  });

  test("rail rows carry the muted per-project session count", async () => {
    vi.mocked(api.listHubProjects).mockResolvedValue([
      project({ id: "pa", name: "Project A" }),
      project({ id: "pb", name: "Project B" }),
    ]);
    vi.mocked(api.listHubSessionsForTable).mockResolvedValue([
      session({ id: "s1", projectId: "pa" }),
      session({ id: "s2", projectId: "pa" }),
    ]);
    renderPanel();

    const rowA = await screen.findByRole("button", { name: /Project A/ });
    await waitFor(() => expect(within(rowA).getByText("2")).toBeInTheDocument());
    expect(
      within(screen.getByRole("button", { name: /Project B/ })).getByText("0"),
    ).toBeInTheDocument();
  });
});

describe("ProjectLibraryPanel — archive + delete", () => {
  test("the Show archived toggle reveals archived rows (dimmed, badged); selecting one shows the Archived status", async () => {
    const archived = project({ archivedAt: "2026-07-18T00:00:00.000Z" });
    vi.mocked(api.listHubProjects).mockResolvedValue([archived]);
    renderPanel();

    // Hidden by default, with an honest hint instead of a fake "no projects".
    await waitFor(() => expect(screen.getByText("All projects are archived")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("checkbox", { name: "Show archived" }));
    const row = await screen.findByRole("button", { name: /Q3 Launch/ });
    expect(within(row).getByText("Archived")).toBeInTheDocument();

    await selectProject(archived.name);
    // Badge in the rail row AND in the detail header — a regression dropping either fails this.
    await waitFor(() => expect(screen.getAllByText("Archived")).toHaveLength(2));
  });

  test("archiving hides the rail row but keeps the detail open with one-click Unarchive", async () => {
    const existing = project();
    vi.mocked(api.listHubProjects).mockResolvedValue([existing]);
    vi.mocked(api.updateHubProject).mockResolvedValue({
      ...existing,
      archivedAt: "2026-07-18T00:00:00.000Z",
    });
    renderPanel();

    await waitFor(() => expect(screen.getByText(existing.name)).toBeInTheDocument());
    await selectProject(existing.name);

    openProjectActions();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Archive" }));

    await waitFor(() =>
      expect(api.updateHubProject).toHaveBeenCalledWith(existing.id, { archived: true }),
    );
    // U6 repair: the row leaves the (non-archived) rail, but the project must NOT be deselected —
    // the still-open header is where the undo lives. Pre-U6 this dropped state entirely, so the
    // "Show archived" toggle had nothing left to reveal.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Q3 Launch/ })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("heading", { name: "Q3 Launch", level: 2 })).toBeInTheDocument();
    expect(screen.getByText("All projects are archived")).toBeInTheDocument();

    vi.mocked(api.updateHubProject).mockResolvedValue({ ...existing, archivedAt: null });
    openProjectActions();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Unarchive" }));
    await waitFor(() =>
      expect(api.updateHubProject).toHaveBeenLastCalledWith(existing.id, { archived: false }),
    );
    await screen.findByRole("button", { name: /Q3 Launch/ });
  });

  test("deleting a project confirms, then removes it from the list", async () => {
    const existing = project();
    vi.mocked(api.listHubProjects).mockResolvedValue([existing]);
    vi.mocked(api.deleteHubProject).mockResolvedValue(undefined);
    renderPanel();

    await waitFor(() => expect(screen.getByText(existing.name)).toBeInTheDocument());
    await selectProject(existing.name);

    openProjectActions();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete project" }));

    await waitFor(() => expect(api.deleteHubProject).toHaveBeenCalledWith(existing.id));
    await waitFor(() => expect(screen.getByText("No projects yet")).toBeInTheDocument());
    expect(screen.getByText("Select a project")).toBeInTheDocument();
  });
});
