import { MemoryRouter, Route, Routes } from "react-router-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@brand/ui";

// `CollectionDetail` statically imports `CollectionGit` -> `ConflictResolution`, which pulls in
// `@brand/editor`'s Monaco/Milkdown `CodeEditor`/`DiffEditor` — same stubbing convention as
// `LiveSkillWorkspaceView.test.tsx` (a `.css` deep-import there doesn't resolve under vitest's ESM
// loader). Never rendered by the branches under test (both return before the Tabs mount).
vi.mock("@brand/editor", () => ({
  CodeEditor: () => null,
  DiffEditor: () => null,
}));

// ── toolbar-reach WP 2.5 (D-8) ──────────────────────────────────────────────────────────────────
// `StatePanel` renders `data-kind="empty" | "error" | "loading"` and only `kind="error"` carries
// `role="alert"` (see the vendored `state-panel.tsx`) — that is the reliable, non-visual hook this
// suite uses to prove a bad/deleted collection id renders the dashed EMPTY card (not the pink
// `ErrorState`), which is reserved for a genuine fetch failure. Only `getCollection` needs mocking —
// both branches under test return before the Tabs (CollectionTests/Suites/Git) ever mount.
vi.mock("../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api")>();
  return {
    ...actual,
    getCollection: vi.fn(),
  };
});

import { ApiError, getCollection } from "../../../lib/api";
import { CollectionDetail } from "./CollectionDetail";

const mockGetCollection = vi.mocked(getCollection);

function renderDetail(id = "col-1") {
  return render(
    <MemoryRouter initialEntries={[`/testing/collections/${id}`]}>
      <TooltipProvider>
        <Routes>
          <Route path="/testing/collections/:collectionId" element={<CollectionDetail />} />
          <Route path="/testing/collections" element={<div data-testid="collections-list" />} />
        </Routes>
      </TooltipProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockGetCollection.mockReset();
});

describe("CollectionDetail — D-8 error vs empty state", () => {
  test("a 404 (bad/deleted id) renders an EMPTY state, not the pink ErrorState", async () => {
    mockGetCollection.mockRejectedValue(new ApiError(404, "Collection not found"));
    const { container } = renderDetail("nope");

    expect(await screen.findByText("Collection not found")).toBeInTheDocument();
    expect(container.querySelector('[data-kind="empty"]')).not.toBeNull();
    expect(container.querySelector('[data-kind="error"]')).toBeNull();
    // "alert" is the error-only role — its absence proves this is the dashed empty card.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    // The resolving action (per the acceptance: "dashed card + the action that resolves it").
    fireEvent.click(screen.getByRole("button", { name: /Back to collections/ }));
    await waitFor(() => expect(screen.getByTestId("collections-list")).toBeInTheDocument());
  });

  test("a genuine fetch failure still renders the pink ErrorState", async () => {
    mockGetCollection.mockRejectedValue(new Error("network error"));
    const { container } = renderDetail("col-1");

    expect(await screen.findByText("Couldn’t load this collection.")).toBeInTheDocument();
    expect(container.querySelector('[data-kind="error"]')).not.toBeNull();
    expect(container.querySelector('[data-kind="empty"]')).toBeNull();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
