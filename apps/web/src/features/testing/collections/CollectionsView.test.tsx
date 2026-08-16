import { MemoryRouter, useLocation } from "react-router-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@brand/ui";
import type { Collection } from "@mcp-token-footprint/shared";

// ── toolbar-reach WP 2.5 (C-7) ──────────────────────────────────────────────────────────────────
// Only the collections list needs mocking — `getCollectionStatus` is only invoked per BOUND
// collection (none of the fixtures below carry a `repoUrl`), so it's stubbed but never asserted on.
vi.mock("../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api")>();
  return {
    ...actual,
    listCollections: vi.fn(),
    getCollectionStatus: vi.fn(),
  };
});

import { listCollections } from "../../../lib/api";
import { CollectionsView } from "./CollectionsView";

const mockListCollections = vi.mocked(listCollections);

function makeCollection(over: Partial<Collection> = {}): Collection {
  return {
    id: "local",
    name: "Local",
    isDefault: true,
    repoUrl: null,
    repoPath: null,
    branch: null,
    hasPat: false,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    ...over,
  };
}

const LOCAL = makeCollection();
const BARC = makeCollection({
  id: "barc",
  name: "BARC-Benchmark",
  isDefault: false,
});

function renderView() {
  return render(
    <MemoryRouter initialEntries={["/testing/collections"]}>
      <TooltipProvider>
        <CollectionsView />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

/** Reflects the current route so a Review-card navigation target is observable (B-6). */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderWithLocation() {
  return render(
    <MemoryRouter initialEntries={["/testing/collections"]}>
      <TooltipProvider>
        <LocationProbe />
        <CollectionsView />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockListCollections.mockReset();
});

describe("CollectionsView — C-7 ragged action alignment", () => {
  test("every row's action cluster has the same footprint whether or not Delete renders", async () => {
    mockListCollections.mockResolvedValue([BARC, LOCAL]);
    renderView();

    // `ordered` always pins the reserved default (Local) first, so index 0 is Local (undeletable)
    // and index 1 is BARC-Benchmark (deletable) regardless of API order.
    const openButtons = await screen.findAllByRole("button", { name: "Open" });
    expect(openButtons).toHaveLength(2);

    for (const open of openButtons) {
      const actionsCluster = open.parentElement;
      // Open + (Delete button OR its size-matched invisible placeholder) — never just Open alone,
      // so the cluster's total width (and therefore the Open button's x) never depends on whether
      // this particular row is deletable.
      expect(actionsCluster?.children).toHaveLength(2);
    }

    // Local (undeletable): no Delete button — its slot is filled by an aria-hidden, size-8
    // placeholder that reserves the identical width.
    const [localOpen, barcOpen] = openButtons;
    const localActions = localOpen?.parentElement;
    expect(localActions?.querySelector("button[aria-label^='Delete']")).toBeNull();
    const placeholder = localActions?.querySelector('span[aria-hidden="true"]');
    expect(placeholder).not.toBeNull();
    expect(placeholder?.className).toContain("size-8");

    // BARC-Benchmark (deletable): the second slot is the real Delete button.
    const barcActions = barcOpen?.parentElement;
    expect(barcActions?.querySelector("button[aria-label='Delete BARC-Benchmark']")).not.toBeNull();
  });
});

describe("CollectionsView — C-7 monospace prose", () => {
  test("'not bound to a repository' renders in the body face (no font-mono)", async () => {
    mockListCollections.mockResolvedValue([LOCAL]);
    renderView();

    const notBound = await screen.findByText("not bound to a repository");
    expect(notBound.className).not.toContain("font-mono");
  });

  test("a real repo path stays monospace", async () => {
    mockListCollections.mockResolvedValue([
      makeCollection({
        id: "bound-1",
        name: "Bound collection",
        isDefault: false,
        repoUrl: "https://github.com/acme/tests",
        repoPath: "",
        branch: "main",
      }),
    ]);
    renderView();

    const repoMeta = await screen.findByText(/github\.com\/acme\/tests/);
    expect(repoMeta.className).toContain("font-mono");
  });

  // Interface Craft WP 2.1 (D-IC10, finding 10) — the composed repo/path/branch line truncates
  // at narrow widths with no recovery; it now carries its full text as a `title`.
  test("the bound-path line carries its full composed text as a `title` (D-IC10 recovery)", async () => {
    mockListCollections.mockResolvedValue([
      makeCollection({
        id: "bound-2",
        name: "Bound collection with a path",
        isDefault: false,
        repoUrl: "https://github.com/acme/very-long-org-name/very-long-repo-name",
        repoPath: "tests/fixtures/benchmarks",
        branch: "main",
      }),
    ]);
    renderView();

    const repoMeta = await screen.findByText(/github\.com\/acme\/very-long-org-name/);
    const expected =
      "https://github.com/acme/very-long-org-name/very-long-repo-name · tests/fixtures/benchmarks · main · never synced";
    expect(repoMeta).toHaveAttribute("title", expected);
    expect(repoMeta.textContent).toBe(expected);
  });
});

describe("CollectionsView — C-7 empty toolbar", () => {
  test("zero collections: no info tooltip, no search field (onboarding text moves to the empty card)", async () => {
    mockListCollections.mockResolvedValue([]);
    renderView();

    expect(await screen.findByText("No collections yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "About this view" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Search collections")).not.toBeInTheDocument();
    // The onboarding sentence that used to live only in the ⓘ tooltip is now on the card itself.
    expect(screen.getByText(/every test lives in a collection/i)).toBeInTheDocument();
  });

  test("non-empty list: the toolbar carries a real search field + count, not a lone tooltip", async () => {
    mockListCollections.mockResolvedValue([BARC, LOCAL]);
    renderView();

    await screen.findAllByRole("button", { name: "Open" });
    expect(screen.getByRole("button", { name: "About this view" })).toBeInTheDocument();
    const search = screen.getByLabelText("Search collections");
    expect(search).toBeInTheDocument();
    expect(screen.getByText("2 collections")).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "barc" } });
    await waitFor(() => expect(screen.getByText("1 collection")).toBeInTheDocument());
    expect(screen.queryByText("Local")).not.toBeInTheDocument();
    expect(screen.getByText("BARC-Benchmark")).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "nonexistent-name" } });
    expect(await screen.findByText("No collections match your search")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    await waitFor(() => expect(screen.getByText("BARC-Benchmark")).toBeInTheDocument());
    // "Local" now matches both the row's name and its badge label — assert it's back at all.
    expect(screen.getAllByText("Local").length).toBeGreaterThan(0);
  });
});

describe("CollectionsView — Review section (B-6)", () => {
  test("surfaces Review runs + Review rubrics as navigable entry points from the test home", async () => {
    mockListCollections.mockResolvedValue([LOCAL]);
    renderWithLocation();

    await screen.findByRole("button", { name: "Open" }); // the collections list has loaded

    const openReview = screen.getByRole("button", { name: "Open review" });
    const manageRubrics = screen.getByRole("button", { name: "Manage rubrics" });

    // The review SURFACE — reachable without knowing its `/testing/review` URL (design-remediation
    // T8 promoted it from the buried `/testing/runs/review` to its own top-level Testing route).
    fireEvent.click(openReview);
    expect(screen.getByTestId("location")).toHaveTextContent("/testing/review");

    // The rubric MANAGER — reachable without knowing its `/testing/observability/review-rubrics` URL.
    fireEvent.click(manageRubrics);
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/testing/observability/review-rubrics",
    );
  });

  test("the Review section is present even with zero collections", async () => {
    mockListCollections.mockResolvedValue([]);
    renderWithLocation();

    await screen.findByText("No collections yet");
    expect(screen.getByRole("button", { name: "Open review" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Manage rubrics" })).toBeInTheDocument();
  });
});
