import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { RunView } from "@mcp-token-footprint/shared";
import { TooltipProvider } from "@brand/ui";

// jsdom omits matchMedia — Radix (Dialog/DropdownMenu/AlertDialog) reads it.
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

vi.mock("../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api")>();
  return {
    ...actual,
    listRunViews: vi.fn(),
    createRunView: vi.fn(),
    updateRunView: vi.fn(),
    deleteRunView: vi.fn(),
  };
});

import { createRunView, deleteRunView, listRunViews, updateRunView } from "../../../lib/api";
import { DEFAULT_RUN_COLUMNS_PREFERENCE, SESSION_COLUMNS_PREFERENCE } from "./run-columns";
import { RunSavedViews, type AppliedRunView } from "./RunSavedViews";

const SAVED_VIEW: RunView = {
  id: "view-1",
  name: "My failing runs",
  filter: { hasError: true },
  columns: { visible: ["status", "cost"], previewMode: "error" },
  sort: { key: "started", dir: "desc" },
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

function openViaKeyboard(trigger: HTMLElement) {
  fireEvent.keyDown(trigger, { key: "Enter" });
}

function renderPicker(activeId: string | null = null) {
  const onApply = vi.fn<(view: AppliedRunView) => void>();
  render(
    <TooltipProvider>
      <RunSavedViews
        activeId={activeId}
        currentFilter={{ pinned: true }}
        currentColumns={DEFAULT_RUN_COLUMNS_PREFERENCE}
        currentSort={{ key: "started", dir: "desc" }}
        onApply={onApply}
      />
    </TooltipProvider>,
  );
  return { onApply };
}

beforeEach(() => {
  vi.mocked(listRunViews).mockResolvedValue([SAVED_VIEW]);
  vi.mocked(createRunView).mockResolvedValue(SAVED_VIEW);
  vi.mocked(updateRunView).mockResolvedValue(SAVED_VIEW);
  vi.mocked(deleteRunView).mockResolvedValue(undefined);
});

describe("RunSavedViews — presets (no DB row)", () => {
  test("every named preset is offered without any listRunViews data", async () => {
    vi.mocked(listRunViews).mockResolvedValue([]);
    renderPicker();
    openViaKeyboard(screen.getByRole("button", { name: /views/i }));
    for (const name of ["All", "Sessions", "Failures", "Guardrail stops", "Waiting for you", "Pinned"]) {
      expect(await screen.findByRole("menuitem", { name: new RegExp(`^${name}$`) })).toBeInTheDocument();
    }
  });

  test("applying a preset calls onApply with its filter, preserving the current columns/sort", async () => {
    const { onApply } = renderPicker();
    openViaKeyboard(screen.getByRole("button", { name: /views/i }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Pinned" }));
    expect(onApply).toHaveBeenCalledWith({
      id: "preset:pinned",
      name: "Pinned",
      filter: { pinned: true },
      columns: DEFAULT_RUN_COLUMNS_PREFERENCE,
      sort: { key: "started", dir: "desc" },
    });
  });

  /** Observability WP 2.4 — the ONE preset that also switches columns wholesale, regardless of
   *  whatever the operator currently has visible (never merged with `currentColumns`). */
  test("applying the 'Sessions' preset switches to the session column set, NOT the current columns", async () => {
    const { onApply } = renderPicker();
    openViaKeyboard(screen.getByRole("button", { name: /views/i }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Sessions" }));
    expect(onApply).toHaveBeenCalledWith({
      id: "preset:sessions",
      name: "Sessions",
      filter: { interactiveOnly: true },
      columns: SESSION_COLUMNS_PREFERENCE,
      sort: { key: "started", dir: "desc" },
    });
    // Sanity: the applied columns are NOT the picker's current (DEFAULT) columns — proves the
    // preset's own `columns` won, rather than falling through to `currentColumns`.
    expect(SESSION_COLUMNS_PREFERENCE).not.toEqual(DEFAULT_RUN_COLUMNS_PREFERENCE);
  });
});

describe("RunSavedViews — persisted views (WP1.4 CRUD)", () => {
  test("applying a saved view restores its filter AND normalized columns/sort", async () => {
    const { onApply } = renderPicker();
    openViaKeyboard(screen.getByRole("button", { name: /views/i }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "My failing runs" }));
    expect(onApply).toHaveBeenCalledWith({
      id: "view-1",
      name: "My failing runs",
      filter: { hasError: true },
      columns: { visible: ["status", "cost"], previewMode: "error" },
      sort: { key: "started", dir: "desc" },
    });
  });

  test("saving the current view POSTs name+filter+columns+sort and applies the created view", async () => {
    // A realistic response echoes back exactly what was posted (filter/columns/sort), with a
    // server-assigned id — NOT the unrelated SAVED_VIEW fixture's own columns.
    const created: RunView = {
      ...SAVED_VIEW,
      id: "view-2",
      name: "New view",
      filter: { pinned: true },
      columns: DEFAULT_RUN_COLUMNS_PREFERENCE,
      sort: { key: "started", dir: "desc" },
    };
    vi.mocked(createRunView).mockResolvedValue(created);
    const { onApply } = renderPicker();
    openViaKeyboard(screen.getByRole("button", { name: /views/i }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Save current view…" }));
    const nameInput = await screen.findByLabelText("View name");
    fireEvent.change(nameInput, { target: { value: "New view" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onApply).toHaveBeenCalled());
    expect(createRunView).toHaveBeenCalledWith({
      name: "New view",
      filter: { pinned: true },
      columns: DEFAULT_RUN_COLUMNS_PREFERENCE,
      sort: { key: "started", dir: "desc" },
    });
    expect(onApply).toHaveBeenCalledWith({
      id: "view-2",
      name: "New view",
      filter: created.filter,
      columns: DEFAULT_RUN_COLUMNS_PREFERENCE,
      sort: created.sort,
    });
  });

  test("updating the active saved view PATCHes the current filter/columns/sort onto it", async () => {
    renderPicker("view-1");
    openViaKeyboard(screen.getByRole("button", { name: /views/i }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /^Update/ }));
    await waitFor(() =>
      expect(updateRunView).toHaveBeenCalledWith("view-1", {
        filter: { pinned: true },
        columns: DEFAULT_RUN_COLUMNS_PREFERENCE,
        sort: { key: "started", dir: "desc" },
      }),
    );
  });

  test("deleting the active saved view confirms, then DELETEs it and falls back to the All preset", async () => {
    const { onApply } = renderPicker("view-1");
    openViaKeyboard(screen.getByRole("button", { name: /views/i }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /^Delete/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete view" }));
    await waitFor(() => expect(deleteRunView).toHaveBeenCalledWith("view-1"));
    await waitFor(() =>
      expect(onApply).toHaveBeenCalledWith(
        expect.objectContaining({ id: "preset:all", name: "All", filter: {} }),
      ),
    );
  });
});
