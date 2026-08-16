import type { HubMemory } from "@mcp-token-footprint/shared";
import { TooltipProvider } from "@brand/ui";
import { fireEvent, render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api")>();
  return {
    ...actual,
    listHubMemory: vi.fn(),
    createHubMemory: vi.fn(),
    updateHubMemory: vi.fn(),
    deleteHubMemory: vi.fn(),
  };
});

import * as api from "../../../lib/api";
import { ScopedMemoryList } from "./ScopedMemoryList";

// The Edit/Delete memory controls are `IconButton`s (D-TB5), which wrap every control in a Radix
// `Tooltip` — that throws without an ancestor `TooltipProvider` (the app root mounts one; this
// file's many render() call sites don't get it automatically).
function render(ui: ReactElement) {
  return rtlRender(<TooltipProvider>{ui}</TooltipProvider>);
}

function memory(overrides: Partial<HubMemory> = {}): HubMemory {
  return {
    id: "mem-1",
    kind: "preference",
    content: "Prefers concise answers.",
    source: "user",
    status: "active",
    scope: "profile",
    scopeId: null,
    createdAt: "2026-07-17T12:00:00.000Z",
    updatedAt: "2026-07-17T12:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ScopedMemoryList — client-side scope filtering (D-HUX11)", () => {
  test("shows only rows matching the given scope/scopeId; rows from another project or profile are excluded", async () => {
    vi.mocked(api.listHubMemory).mockResolvedValue([
      memory({ id: "m-profile", content: "Global fact." }),
      memory({ id: "m-this-project", scope: "project", scopeId: "proj-1", content: "This project's rule." }),
      memory({ id: "m-other-project", scope: "project", scopeId: "proj-2", content: "Other project's rule." }),
    ]);
    render(<ScopedMemoryList scope="project" scopeId="proj-1" />);

    await waitFor(() => expect(screen.getByText("This project's rule.")).toBeInTheDocument());
    expect(screen.queryByText("Global fact.")).not.toBeInTheDocument();
    expect(screen.queryByText("Other project's rule.")).not.toBeInTheDocument();
  });

  test("shows an empty state when nothing matches the scope", async () => {
    vi.mocked(api.listHubMemory).mockResolvedValue([memory({ scope: "profile" })]);
    render(<ScopedMemoryList scope="crew" scopeId="crew-1" />);
    await waitFor(() => expect(screen.getByText("No memory saved yet")).toBeInTheDocument());
  });

  test("groups entries by kind with a count header", async () => {
    vi.mocked(api.listHubMemory).mockResolvedValue([
      memory({ id: "m1", kind: "preference", content: "Pref one." }),
      memory({ id: "m2", kind: "preference", content: "Pref two." }),
      memory({ id: "m3", kind: "instruction", content: "Always cite sources." }),
    ]);
    render(<ScopedMemoryList scope="profile" />);
    await waitFor(() => expect(screen.getByText("Preference · 2")).toBeInTheDocument());
    expect(screen.getByText("Instruction · 1")).toBeInTheDocument();
  });

  test("archived rows are hidden by default and revealed by Show archived", async () => {
    vi.mocked(api.listHubMemory).mockResolvedValue([
      memory({ id: "m-active", content: "Active row." }),
      memory({ id: "m-archived", content: "Archived row.", status: "archived" }),
    ]);
    render(<ScopedMemoryList scope="profile" />);
    await waitFor(() => expect(screen.getByText("Active row.")).toBeInTheDocument());
    expect(screen.queryByText("Archived row.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: /show archived/i }));
    await waitFor(() => expect(screen.getByText("Archived row.")).toBeInTheDocument());
  });
});

describe("ScopedMemoryList — add", () => {
  test("adding to a profile scope posts kind/content with NO scope fields", async () => {
    vi.mocked(api.listHubMemory).mockResolvedValue([]);
    vi.mocked(api.createHubMemory).mockResolvedValue(memory({ id: "mem-new", content: "New note." }));
    render(<ScopedMemoryList scope="profile" />);

    await waitFor(() => expect(screen.getByText("No memory saved yet")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.change(screen.getByLabelText("Content"), { target: { value: "New note." } });
    fireEvent.click(screen.getByRole("button", { name: "Add memory" }));

    await waitFor(() =>
      expect(api.createHubMemory).toHaveBeenCalledWith({ kind: "preference", content: "New note." }),
    );
    await waitFor(() => expect(screen.getByText("New note.")).toBeInTheDocument());
  });

  test("adding to a project scope posts scope + scopeId alongside kind/content", async () => {
    vi.mocked(api.listHubMemory).mockResolvedValue([]);
    vi.mocked(api.createHubMemory).mockResolvedValue(
      memory({ id: "mem-new", scope: "project", scopeId: "proj-1", content: "Project note." }),
    );
    render(<ScopedMemoryList scope="project" scopeId="proj-1" />);

    await waitFor(() => expect(screen.getByText("No memory saved yet")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.change(screen.getByLabelText("Content"), { target: { value: "Project note." } });
    fireEvent.click(screen.getByRole("button", { name: "Add memory" }));

    await waitFor(() =>
      expect(api.createHubMemory).toHaveBeenCalledWith({
        kind: "preference",
        content: "Project note.",
        scope: "project",
        scopeId: "proj-1",
      }),
    );
  });
});

describe("ScopedMemoryList — accept / archive / edit / delete", () => {
  test("Accept flips a proposed row to active via updateHubMemory", async () => {
    const proposed = memory({ status: "proposed", source: "assistant_proposed", content: "Proposed row." });
    vi.mocked(api.listHubMemory).mockResolvedValue([proposed]);
    vi.mocked(api.updateHubMemory).mockResolvedValue({ ...proposed, status: "active" });
    render(<ScopedMemoryList scope="profile" />);

    await waitFor(() => expect(screen.getByText("Awaiting your review")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));

    await waitFor(() =>
      expect(api.updateHubMemory).toHaveBeenCalledWith(proposed.id, { status: "active" }),
    );
  });

  test("Archive then Restore toggles status via updateHubMemory", async () => {
    const active = memory({ content: "Toggle me." });
    vi.mocked(api.listHubMemory).mockResolvedValue([active]);
    vi.mocked(api.updateHubMemory).mockResolvedValue({ ...active, status: "archived" });
    render(<ScopedMemoryList scope="profile" />);

    await waitFor(() => expect(screen.getByText("Toggle me.")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));

    await waitFor(() =>
      expect(api.updateHubMemory).toHaveBeenCalledWith(active.id, { status: "archived" }),
    );
  });

  test("inline edit saves new content via updateHubMemory", async () => {
    const existing = memory({ content: "Old content." });
    vi.mocked(api.listHubMemory).mockResolvedValue([existing]);
    vi.mocked(api.updateHubMemory).mockResolvedValue({ ...existing, content: "New content." });
    render(<ScopedMemoryList scope="profile" />);

    await waitFor(() => expect(screen.getByText("Old content.")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Edit memory" }));
    fireEvent.change(screen.getByLabelText("Edit memory content"), {
      target: { value: "New content." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(api.updateHubMemory).toHaveBeenCalledWith(existing.id, { content: "New content." }),
    );
  });

  test("Delete opens an AlertDialog confirm; confirming deletes and removes the row", async () => {
    const existing = memory({ content: "Delete me." });
    vi.mocked(api.listHubMemory).mockResolvedValue([existing]);
    vi.mocked(api.deleteHubMemory).mockResolvedValue(undefined);
    render(<ScopedMemoryList scope="profile" />);

    await waitFor(() => expect(screen.getByText("Delete me.")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Delete memory" }));

    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Delete this memory?")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete memory" }));

    await waitFor(() => expect(api.deleteHubMemory).toHaveBeenCalledWith(existing.id));
    await waitFor(() => expect(screen.queryByText("Delete me.")).not.toBeInTheDocument());
  });
});
