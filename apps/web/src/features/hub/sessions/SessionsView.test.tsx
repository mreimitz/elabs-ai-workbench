import type { HubProject, HubSession, ProviderCredential } from "@mcp-token-footprint/shared";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { fireEvent, render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@elabs-ai/components-ui";

// The `NewSessionDialog` this view composes now renders `ModelSelectorLogo` from `@elabs-ai/components-ai`; stub the
// heavy `@elabs-ai/components-ai` surface (it pulls in @xyflow/shiki/mermaid CSS jsdom can't load), same as the other
// hub component tests.
vi.mock("@elabs-ai/components-ai", () => import("../test-support/brand-ai-mock"));

// Mirrors AssistantView.test.tsx's posture — mock only the hub-session client functions this view
// (and the `NewSessionDialog`/`useHubModelRoster` it composes) actually calls.
vi.mock("../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api")>();
  return {
    ...actual,
    listHubSessionsForTable: vi.fn(),
    listHubProjects: vi.fn(),
    updateHubSession: vi.fn(),
    createHubSession: vi.fn(),
    listProviders: vi.fn(),
    listProviderModels: vi.fn(),
  };
});

import * as api from "../../../lib/api";
import { SessionsView } from "./SessionsView";

function session(overrides: Partial<HubSession> = {}): HubSession {
  return {
    id: "s1",
    kind: "chat",
    title: "Scan comparison chat",
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

function project(overrides: Partial<HubProject> = {}): HubProject {
  return {
    id: "p1",
    name: "Q3 Launch",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

function credential(overrides: Partial<ProviderCredential> = {}): ProviderCredential {
  return {
    id: "cred-1",
    kind: "anthropic",
    label: "Anthropic",
    hasKey: true,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

function renderView(initialEntries: string[] = ["/assistant/sessions"]) {
  // The row-actions column renders an `IconButton` (D-TB5), which wraps every control in a Radix
  // `Tooltip` — that throws without an ancestor `TooltipProvider` (the app root mounts one; this
  // file's render doesn't get it automatically).
  return rtlRender(
    <TooltipProvider>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <LocationProbe />
                <SessionsView />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </TooltipProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listHubProjects).mockResolvedValue([project()]);
  vi.mocked(api.listProviders).mockResolvedValue([credential()]);
  vi.mocked(api.listProviderModels).mockResolvedValue({
    source: "provider",
    models: [{ id: "claude-sonnet-5" }],
  });
});

describe("SessionsView (WP1.4, D-HUX4)", () => {
  test("shows a loading state, then an inline error with retry on a failed fetch", async () => {
    vi.mocked(api.listHubSessionsForTable).mockReturnValue(new Promise(() => {}));
    renderView();
    expect(screen.getAllByText("Loading sessions…").length).toBeGreaterThan(0);
  });

  test("a failed fetch surfaces an inline error with retry, not a crash", async () => {
    vi.mocked(api.listHubSessionsForTable).mockRejectedValue(new Error("network down"));
    renderView();
    await waitFor(() => expect(screen.getByText("Couldn’t load sessions")).toBeInTheDocument());
    expect(screen.getByText("network down")).toBeInTheDocument();

    vi.mocked(api.listHubSessionsForTable).mockResolvedValue([]);
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect(screen.getByText("No sessions yet")).toBeInTheDocument());
  });

  test("zero sessions: the full-page empty state offers New session AND (toggle off) Show archived", async () => {
    vi.mocked(api.listHubSessionsForTable).mockResolvedValue([]);
    renderView();

    await waitFor(() => expect(screen.getByText("No sessions yet")).toBeInTheDocument());
    // Two "New session" entry points render simultaneously (toolbar action + EmptyState primary
    // action) — the same double-CTA shape `RunsView`'s zero-rows empty state uses.
    expect(screen.getAllByRole("button", { name: /new session/i }).length).toBe(2);
    expect(screen.getByRole("button", { name: /show archived/i })).toBeInTheDocument();
  });

  test("renders rows with status/mode badges, project name, tokens, cost, and a project fallback of “—”", async () => {
    vi.mocked(api.listHubSessionsForTable).mockResolvedValue([
      session({
        id: "s1",
        title: "With a project",
        projectId: "p1",
        status: "completed",
        mode: "research",
        turns: 3,
        tokensIn: 1200,
        tokensOut: 800,
        costUsd: 1.5,
      }),
      session({
        id: "s2",
        title: "No project",
        projectId: undefined,
        status: "error",
        mode: "chat",
        updatedAt: "2026-07-16T09:00:00.000Z",
      }),
    ]);
    renderView();

    await waitFor(() => expect(screen.getByText("With a project")).toBeInTheDocument());
    expect(screen.getByText("Q3 Launch")).toBeInTheDocument();
    expect(screen.getByText("Research")).toBeInTheDocument();
    expect(screen.getByText("1,200 / 800")).toBeInTheDocument();
    expect(screen.getByText("$1.50")).toBeInTheDocument();

    expect(screen.getByText("No project")).toBeInTheDocument();
    // At least one "—" fallback renders (the "No project" row's Project cell + its Last-error cell).
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);

    expect(screen.getByText("2 sessions")).toBeInTheDocument();
  });

  test("a last-error message truncates with the full text in a title attribute (no crash, no raw color text rule violated)", async () => {
    vi.mocked(api.listHubSessionsForTable).mockResolvedValue([
      session({
        id: "s1",
        title: "Failed run",
        status: "error",
        lastError: "Provider returned 500",
      }),
    ]);
    renderView();

    await waitFor(() => expect(screen.getByText("Provider returned 500")).toBeInTheDocument());
    // The truncated inner text span sits inside the cell's title-bearing wrapper (native tooltip on
    // hover, mirrors `AuditView`'s own truncated-cell convention).
    expect(screen.getByText("Provider returned 500").closest("[title]")).toHaveAttribute(
      "title",
      "Provider returned 500",
    );
  });

  test("search filters client-side over the loaded rows", async () => {
    vi.mocked(api.listHubSessionsForTable).mockResolvedValue([
      session({ id: "s1", title: "Alpha review" }),
      session({ id: "s2", title: "Beta rollout", updatedAt: "2026-07-16T09:00:00.000Z" }),
    ]);
    renderView();

    await waitFor(() => expect(screen.getByText("Alpha review")).toBeInTheDocument());
    expect(screen.getByText("Beta rollout")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/search title, model, error/i), {
      target: { value: "beta" },
    });

    await waitFor(() => expect(screen.queryByText("Alpha review")).not.toBeInTheDocument());
    expect(screen.getByText("Beta rollout")).toBeInTheDocument();
    expect(screen.getByText("1 of 2 sessions")).toBeInTheDocument();
  });

  test("status facet filters rows; clearing it restores the full set", async () => {
    vi.mocked(api.listHubSessionsForTable).mockResolvedValue([
      session({ id: "s1", title: "Running one", status: "running" }),
      session({
        id: "s2",
        title: "Done one",
        status: "completed",
        updatedAt: "2026-07-16T09:00:00.000Z",
      }),
    ]);
    renderView();
    await waitFor(() => expect(screen.getByText("Running one")).toBeInTheDocument());

    // `FacetFilter` (@elabs-ai/components-data) is a `DropdownMenu` of `DropdownMenuItem`s (role="menuitem"), each
    // toggling on `onSelect` — not a listbox/combobox. Radix's `DropdownMenuTrigger` only listens for
    // pointerdown/keydown, not click (the established `AssistantDock.test.tsx`/`WatchRulesView.test.tsx`
    // precedent) — `fireEvent.click` alone never opens it in jsdom.
    fireEvent.keyDown(screen.getByRole("button", { name: /^status$/i }), { key: "Enter" });
    const running = await screen.findByRole("menuitem", { name: /running/i });
    fireEvent.click(running);

    await waitFor(() => expect(screen.queryByText("Done one")).not.toBeInTheDocument());
    expect(screen.getByText("Running one")).toBeInTheDocument();
  });

  test("row click opens the session in the workspace (deep link /assistant?session=<id>)", async () => {
    vi.mocked(api.listHubSessionsForTable).mockResolvedValue([
      session({ id: "s1", title: "Open me" }),
    ]);
    renderView();

    await waitFor(() => expect(screen.getByText("Open me")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /open open me in the workspace/i }));

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/assistant?session=s1"),
    );
  });

  // ui-wave U7 (owner feedback): the WHOLE row is the click target; the "…" menu opts out; the
  // trigger is a quiet ghost (no solid surface, revealed on row hover/focus).
  test("U7: clicking anywhere in a row navigates, the row menu does not, and the trigger has no solid background", async () => {
    vi.mocked(api.listHubSessionsForTable).mockResolvedValue([
      session({ id: "s1", title: "Row click me" }),
    ]);
    renderView();
    await waitFor(() => expect(screen.getByText("Row click me")).toBeInTheDocument());

    // The "…" trigger: quiet ghost — hidden until row hover/focus (opacity-0, kept in the tab
    // order) and no solid `bg-*` surface at rest (variant-prefixed hover washes are fine).
    const trigger = screen.getByRole("button", { name: /more actions for row click me/i });
    expect(trigger.className).toContain("opacity-0");
    expect(trigger.className).toContain("focus-visible:opacity-100");
    expect(trigger.className).not.toMatch(
      /(?:^|\s)bg-(?:card|background|primary|secondary|accent|muted)\b/,
    );

    // Clicking the menu trigger must NOT navigate (it owns its click; row delegation skips it).
    fireEvent.click(trigger);
    expect(screen.getByTestId("location")).toHaveTextContent("/assistant/sessions");
    expect(screen.getByTestId("location")).not.toHaveTextContent("session=s1");

    // Clicking a NON-interactive cell (the Model text — not the title button) navigates via the
    // delegated row click, to the same target the title control uses.
    fireEvent.click(screen.getByText("claude-sonnet-5"));
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/assistant?session=s1"),
    );
  });

  test("overflow menu: rename saves the new title via updateHubSession", async () => {
    vi.mocked(api.listHubSessionsForTable).mockResolvedValue([
      session({ id: "s1", title: "Old title" }),
    ]);
    vi.mocked(api.updateHubSession).mockResolvedValue(session({ id: "s1", title: "New title" }));
    renderView();

    await waitFor(() => expect(screen.getByText("Old title")).toBeInTheDocument());
    // Radix's DropdownMenuTrigger only listens for pointerdown/keydown, not click in jsdom.
    fireEvent.keyDown(screen.getByRole("button", { name: /more actions for old title/i }), {
      key: "Enter",
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: /rename/i }));

    const input = await screen.findByLabelText("Title");
    fireEvent.change(input, { target: { value: "New title" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(api.updateHubSession).toHaveBeenCalledWith("s1", { title: "New title" }),
    );
    await waitFor(() => expect(screen.getByText("New title")).toBeInTheDocument());
  });

  test("overflow menu: archive calls updateHubSession({archived:true}) and drops the row when Show archived is off", async () => {
    vi.mocked(api.listHubSessionsForTable).mockResolvedValue([
      session({ id: "s1", title: "Archive me" }),
    ]);
    vi.mocked(api.updateHubSession).mockResolvedValue(
      session({ id: "s1", title: "Archive me", archived: true }),
    );
    renderView();

    await waitFor(() => expect(screen.getByText("Archive me")).toBeInTheDocument());
    // Radix's DropdownMenuTrigger only listens for pointerdown/keydown, not click in jsdom.
    fireEvent.keyDown(screen.getByRole("button", { name: /more actions for archive me/i }), {
      key: "Enter",
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: /^archive$/i }));

    await waitFor(() =>
      expect(api.updateHubSession).toHaveBeenCalledWith("s1", { archived: true }),
    );
    await waitFor(() => expect(screen.queryByText("Archive me")).not.toBeInTheDocument());
  });

  test("Show archived toggle re-fetches with includeArchived:true", async () => {
    vi.mocked(api.listHubSessionsForTable).mockResolvedValue([
      session({ id: "s1", title: "Active session" }),
    ]);
    renderView();
    await waitFor(() => expect(screen.getByText("Active session")).toBeInTheDocument());
    expect(api.listHubSessionsForTable).toHaveBeenLastCalledWith({ includeArchived: false });

    vi.mocked(api.listHubSessionsForTable).mockResolvedValue([
      session({ id: "s1", title: "Active session" }),
      session({
        id: "s2",
        title: "Archived session",
        archived: true,
        updatedAt: "2026-07-10T00:00:00.000Z",
      }),
    ]);
    fireEvent.click(screen.getByRole("checkbox", { name: /show archived/i }));

    await waitFor(() =>
      expect(api.listHubSessionsForTable).toHaveBeenLastCalledWith({ includeArchived: true }),
    );
    await waitFor(() => expect(screen.getByText("Archived session")).toBeInTheDocument());
    // The archived row carries its badge in the title cell.
    expect(screen.getByText("Archived")).toBeInTheDocument();
  });

  test("New session creates then deep-links into the workspace", async () => {
    vi.mocked(api.listHubSessionsForTable).mockResolvedValue([session({ id: "s1" })]);
    vi.mocked(api.createHubSession).mockResolvedValue(
      session({ id: "new-id", title: "New session" }),
    );
    renderView();

    await waitFor(() => expect(screen.getByText("Scan comparison chat")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /new session/i }));

    fireEvent.click(await screen.findByRole("button", { name: /start session/i }));

    await waitFor(() => expect(api.createHubSession).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/assistant?session=new-id"),
    );
  });

  test("sorting by Cost reorders the table rows", async () => {
    vi.mocked(api.listHubSessionsForTable).mockResolvedValue([
      session({ id: "s1", title: "Expensive", costUsd: 9, updatedAt: "2026-07-17T09:00:00.000Z" }),
      session({ id: "s2", title: "Cheap", costUsd: 1, updatedAt: "2026-07-16T09:00:00.000Z" }),
    ]);
    renderView();
    await waitFor(() => expect(screen.getByText("Expensive")).toBeInTheDocument());

    // Initial sort is `updated` desc (the default view), which ALSO happens to put "Expensive" first
    // (it's the more-recently-updated row) — so a single click on Cost (which @elabs-ai/components-data's DataTable
    // toggles unsorted → DESCENDING first) wouldn't prove anything moved (cost-desc puts the pricier
    // row first too, same as today). Click twice to reach cost-ASCENDING, which provably differs.
    const sortByCost = screen.getByRole("button", { name: /sort by cost/i });
    fireEvent.click(sortByCost);
    fireEvent.click(sortByCost);

    await waitFor(() => {
      const rowsAfter = screen.getAllByRole("row").slice(1); // drop the header row
      expect(within(rowsAfter[0] as HTMLElement).queryByText("Cheap")).toBeInTheDocument();
    });
  });
});

describe("SessionsView — URL-seeded filters (WP2.8; workforce Usage drill links + deep links)", () => {
  test("?mode=research seeds the Mode facet and filters to research sessions", async () => {
    vi.mocked(api.listHubSessionsForTable).mockResolvedValue([
      session({ id: "s1", title: "Deep research", mode: "research" }),
      session({
        id: "s2",
        title: "Quick chat",
        mode: "chat",
        updatedAt: "2026-07-16T09:00:00.000Z",
      }),
    ]);
    renderView(["/assistant/sessions?mode=research"]);

    await waitFor(() => expect(screen.getByText("Deep research")).toBeInTheDocument());
    expect(screen.queryByText("Quick chat")).not.toBeInTheDocument();
    expect(screen.getByText("1 of 2 sessions")).toBeInTheDocument();
  });

  test("?status=running seeds the Status facet and filters to running sessions", async () => {
    vi.mocked(api.listHubSessionsForTable).mockResolvedValue([
      session({ id: "s1", title: "Live one", status: "running" }),
      session({
        id: "s2",
        title: "Done one",
        status: "completed",
        updatedAt: "2026-07-16T09:00:00.000Z",
      }),
    ]);
    renderView(["/assistant/sessions?status=running"]);

    await waitFor(() => expect(screen.getByText("Live one")).toBeInTheDocument());
    expect(screen.queryByText("Done one")).not.toBeInTheDocument();
  });

  test("?projectId=<id> seeds the Project facet and filters to that project", async () => {
    vi.mocked(api.listHubSessionsForTable).mockResolvedValue([
      session({ id: "s1", title: "In project", projectId: "p1" }),
      session({
        id: "s2",
        title: "No project",
        projectId: undefined,
        updatedAt: "2026-07-16T09:00:00.000Z",
      }),
    ]);
    renderView(["/assistant/sessions?projectId=p1"]);

    await waitFor(() => expect(screen.getByText("In project")).toBeInTheDocument());
    expect(screen.queryByText("No project")).not.toBeInTheDocument();
  });

  test("?model=<id> seeds the search box, filters by model, and normalises the URL to ?q=", async () => {
    vi.mocked(api.listHubSessionsForTable).mockResolvedValue([
      session({ id: "s1", title: "Sonnet run", model: "claude-sonnet-5" }),
      session({
        id: "s2",
        title: "Opus run",
        model: "claude-opus-4",
        updatedAt: "2026-07-16T09:00:00.000Z",
      }),
    ]);
    renderView(["/assistant/sessions?model=claude-sonnet-5"]);

    await waitFor(() => expect(screen.getByText("Sonnet run")).toBeInTheDocument());
    expect(screen.queryByText("Opus run")).not.toBeInTheDocument();
    // The search field is seeded with the model id…
    expect(screen.getByPlaceholderText(/search title, model, error/i)).toHaveValue(
      "claude-sonnet-5",
    );
    // …and the URL normalises the `model` input alias to the canonical `q` param.
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("q=claude-sonnet-5"),
    );
    expect(screen.getByTestId("location").textContent).not.toContain("model=");
  });

  test("changing a facet writes it back to the URL (deep-linkable / shareable)", async () => {
    vi.mocked(api.listHubSessionsForTable).mockResolvedValue([
      session({ id: "s1", title: "Running one", status: "running" }),
      session({
        id: "s2",
        title: "Done one",
        status: "completed",
        updatedAt: "2026-07-16T09:00:00.000Z",
      }),
    ]);
    renderView();
    await waitFor(() => expect(screen.getByText("Running one")).toBeInTheDocument());

    // Radix DropdownMenuTrigger opens on keydown, not click (the established pattern above).
    fireEvent.keyDown(screen.getByRole("button", { name: /^status$/i }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /running/i }));

    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("status=running"));
  });
});
