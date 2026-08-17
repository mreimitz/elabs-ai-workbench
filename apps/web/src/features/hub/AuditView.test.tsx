import type { HubAgentRole, HubAuditEntry, HubAuditPage, HubCrew } from "@mcp-token-footprint/shared";
import { TooltipProvider } from "@elabs-ai/components-ui";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// AuditView imports `accentFor` (a pure function) from `workforce/AgentCard.tsx` for D-HUX8 crew-dot
// resolution; that module also imports `@elabs-ai/components-charts`' `Sparkline` for its OWN (unrendered-here)
// usage strip. `@visx/gradient`'s ESM export resolution breaks under vitest/node (the established
// `DirectoryTab.test.tsx` finding — @elabs-ai/components-charts can't render under jsdom), so it's mocked the same
// way even though this view never mounts a Sparkline itself.
vi.mock("@elabs-ai/components-charts", () => ({
  Sparkline: () => <div data-testid="sparkline" />,
}));
// AgentCard's RoleAvatar renders `@elabs-ai/components-ai`'s `Persona`, which pulls in heavy transitive deps
// (xterm/flow) that don't resolve under vitest/jsdom — the same `DirectoryTab.test.tsx` finding.
vi.mock("@elabs-ai/components-ai", () => import("./test-support/brand-ai-mock"));

// Spy on the download side-effect while keeping the pure `toCsv` real (mirrors `ExpandableTable.test.tsx`'s
// established posture for this exact helper pair).
vi.mock("../../lib/csv", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/csv")>();
  return { ...actual, downloadCsv: vi.fn() };
});

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    listHubAudit: vi.fn(),
    listHubAgentRoles: vi.fn(),
    listHubCrews: vi.fn(),
  };
});

import * as api from "../../lib/api";
import { downloadCsv } from "../../lib/csv";
import { AuditView } from "./AuditView";

/**
 * Assistant Hub UX WP3.2 (D-HUX2, D-HUX8, D-HUX14, §7.6) — the rebuilt Audit view: toolbar filter
 * grammar (ViewToolbar + FacetFilter/SearchInput/DateRangePicker), sticky day-group SectionHeaders,
 * mission-agent identity enrichment (crew dot + profile-Usage link), one EmptyState with reset, the
 * ONE status vocabulary for outcome chips, and the unchanged session-replay deep link.
 */

function entry(overrides: Partial<HubAuditEntry> = {}): HubAuditEntry {
  return {
    id: "tool_call:1",
    kind: "tool_call",
    at: "2026-07-18T10:00:00.000Z",
    sessionId: "s1",
    sessionKind: "chat",
    sessionTitle: "Scan comparison chat",
    rootSessionId: "s1",
    toolCallId: "1",
    toolName: "scan_server",
    state: "output-available",
    ...overrides,
  };
}

function role(overrides: Partial<HubAgentRole> = {}): HubAgentRole {
  return {
    id: "role-1",
    name: "Research Analyst",
    systemPrompt: "You research topics thoroughly.",
    defaultModel: "claude-sonnet-4-5",
    toolGrants: { servers: {}, builtins: [] },
    skills: [],
    target: "Investigate the assigned topic",
    expectedOutcome: "A structured report",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    archivedAt: null,
    ...overrides,
  };
}

function crew(overrides: Partial<HubCrew> = {}): HubCrew {
  return {
    id: "crew-1",
    name: "Research Team",
    color: "chart-2",
    topology: "parallel",
    members: [{ agentId: "role-1" }],
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

function page(entries: HubAuditEntry[], nextBefore?: string): HubAuditPage {
  return nextBefore ? { entries, nextBefore } : { entries };
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

function renderView() {
  return render(
    <TooltipProvider>
      <MemoryRouter initialEntries={["/assistant/audit"]}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <LocationProbe />
                <AuditView />
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
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-07-18T12:00:00.000Z"));
  // Best-effort identity lookup — empty by default (no enrichment) unless a test opts in.
  vi.mocked(api.listHubAgentRoles).mockResolvedValue([]);
  vi.mocked(api.listHubCrews).mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("AuditView (WP3.2, D-HUX2/D-HUX8/D-HUX14)", () => {
  test("shows a loading state, then an inline error with retry on a failed fetch", async () => {
    vi.mocked(api.listHubAudit).mockReturnValue(new Promise(() => {}));
    renderView();
    expect(screen.getAllByText("Loading the audit timeline…").length).toBeGreaterThan(0);
  });

  test("a failed fetch surfaces an inline error with retry, not a crash", async () => {
    vi.mocked(api.listHubAudit).mockRejectedValue(new Error("network down"));
    renderView();
    await waitFor(() => expect(screen.getByText("Couldn’t load the audit timeline")).toBeInTheDocument());
    expect(screen.getByText("network down")).toBeInTheDocument();

    vi.mocked(api.listHubAudit).mockResolvedValue(page([]));
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect(screen.getByText("No audit activity yet")).toBeInTheDocument());
  });

  test("zero rows and no filters: the empty state offers a way back to Assistant, not a reset", async () => {
    vi.mocked(api.listHubAudit).mockResolvedValue(page([]));
    renderView();

    await waitFor(() => expect(screen.getByText("No audit activity yet")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: /go to assistant/i })).toHaveAttribute(
      "href",
      "/assistant",
    );
    expect(screen.queryByRole("button", { name: /reset filters/i })).not.toBeInTheDocument();
  });

  test("rows group under sticky day-group headers (Today / Yesterday) and the replay deep link is intact", async () => {
    vi.mocked(api.listHubAudit).mockResolvedValue(
      page([
        entry({ id: "tool_call:today", at: "2026-07-18T09:00:00.000Z", toolName: "today_tool" }),
        entry({
          id: "tool_call:yesterday",
          at: "2026-07-17T09:00:00.000Z",
          toolName: "yesterday_tool",
          messageId: "msg-1",
        }),
      ]),
    );
    renderView();

    await waitFor(() => expect(screen.getByText("today_tool")).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Today" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Yesterday" })).toBeInTheDocument();
    expect(screen.getByText("yesterday_tool")).toBeInTheDocument();

    // The row's own action cell still deep-links into session replay (session + message).
    fireEvent.click(screen.getByRole("button", { name: /open yesterday_tool in session replay/i }));
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/assistant?session=s1&message=msg-1"),
    );
  });

  test("outcome renders through the shared status vocabulary (Completed/Failed/Denied)", async () => {
    vi.mocked(api.listHubAudit).mockResolvedValue(
      page([
        entry({ id: "tool_call:ok", toolName: "ok_tool", state: "output-available" }),
        entry({ id: "tool_call:bad", toolName: "bad_tool", state: "output-error", isError: true }),
        entry({ id: "tool_call:denied", toolName: "denied_tool", state: "output-denied" }),
      ]),
    );
    renderView();

    await waitFor(() => expect(screen.getByText("ok_tool")).toBeInTheDocument());
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Denied")).toBeInTheDocument();
  });

  test("mission-agent row resolved against the role library shows the crew dot + a profile Usage link", async () => {
    vi.mocked(api.listHubAgentRoles).mockResolvedValue([role()]);
    vi.mocked(api.listHubCrews).mockResolvedValue([crew()]);
    vi.mocked(api.listHubAudit).mockResolvedValue(
      page([
        entry({
          id: "tool_call:agent",
          sessionId: "agent-session-1",
          sessionKind: "agent",
          sessionTitle: "Research Analyst",
          rootSessionId: "parent-session",
          toolName: "web_search",
        }),
      ]),
    );
    renderView();

    await waitFor(() => expect(screen.getByText("web_search")).toBeInTheDocument());
    expect(screen.getAllByText("Research Analyst").length).toBeGreaterThan(0);
    expect(screen.getByText("Research Team")).toBeInTheDocument();

    const usageLink = screen.getByRole("link", { name: /open research analyst's usage/i });
    expect(usageLink).toHaveAttribute("href", "/assistant/agents/agent/role-1?settings=usage");
  });

  test("mission-agent row with NO role match degrades to the plain pre-WP3.2 look (no crash, no dot, no link)", async () => {
    vi.mocked(api.listHubAudit).mockResolvedValue(
      page([
        entry({
          id: "tool_call:adhoc",
          sessionId: "agent-session-2",
          sessionKind: "agent",
          sessionTitle: "Ad-hoc scout",
          rootSessionId: "parent-session",
          toolName: "fetch_page",
        }),
      ]),
    );
    renderView();

    await waitFor(() => expect(screen.getByText("fetch_page")).toBeInTheDocument());
    expect(screen.getByText("Ad-hoc scout")).toBeInTheDocument();
    expect(screen.getByText("agent")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /usage/i })).not.toBeInTheDocument();
  });

  // T10: a genuinely non-zero cost (a fraction of a cent — routine for a single model turn) must
  // never render identically to a free/unpriced call. `formatCostUsd`'s default 2dp rounds anything
  // under a cent down to "$0.00" — the audit's own cost label now special-cases that band. The cost
  // label only renders for `model_call` rows (see `AuditView.tsx`'s Outcome column), so these use
  // `kind: "model_call"` + `model` (not `toolName`) to find the row.
  test("a real but sub-cent cost renders '<$0.01 est.', never '$0.00 est.'", async () => {
    vi.mocked(api.listHubAudit).mockResolvedValue(
      page([entry({ id: "model_call:tiny", kind: "model_call", model: "tiny-cost-model", costUsd: 0.0003 })]),
    );
    renderView();

    await waitFor(() => expect(screen.getByText("tiny-cost-model")).toBeInTheDocument());
    expect(screen.getByText("<$0.01 est.")).toBeInTheDocument();
    expect(screen.queryByText("$0.00 est.")).not.toBeInTheDocument();
  });

  test("an ACTUAL zero cost still renders '$0.00 est.' (only a positive sub-cent value gets '<$0.01')", async () => {
    vi.mocked(api.listHubAudit).mockResolvedValue(
      page([entry({ id: "model_call:free", kind: "model_call", model: "free-model", costUsd: 0 })]),
    );
    renderView();

    await waitFor(() => expect(screen.getByText("free-model")).toBeInTheDocument());
    expect(screen.getByText("$0.00 est.")).toBeInTheDocument();
  });

  test("a sub-cent cost on a subscription basis renders '<$0.01 · subscription'", async () => {
    vi.mocked(api.listHubAudit).mockResolvedValue(
      page([
        entry({
          id: "model_call:tiny-sub",
          kind: "model_call",
          model: "tiny-sub-model",
          costUsd: 0.0007,
          costBasis: "subscription_reference",
        }),
      ]),
    );
    renderView();

    await waitFor(() => expect(screen.getByText("tiny-sub-model")).toBeInTheDocument());
    expect(screen.getByText("<$0.01 · subscription")).toBeInTheDocument();
  });

  // T10: `costBasis` previously compared against the string "subscription", which the real
  // `SessionCostBasis` type never produces (its member is `"subscription_reference"`) — so a
  // subscription-priced call always silently fell through to the "… est." label. Locks the fix.
  test("a subscription-basis cost renders '· subscription', not '… est.' (the real costBasis value)", async () => {
    vi.mocked(api.listHubAudit).mockResolvedValue(
      page([
        entry({
          id: "model_call:sub",
          kind: "model_call",
          model: "sub-model",
          costUsd: 0.42,
          costBasis: "subscription_reference",
        }),
      ]),
    );
    renderView();

    await waitFor(() => expect(screen.getByText("sub-model")).toBeInTheDocument());
    expect(screen.getByText("$0.42 · subscription")).toBeInTheDocument();
    expect(screen.queryByText("$0.42 est.")).not.toBeInTheDocument();
  });

  test("a single Kind facet selection sends `kind` to the server", async () => {
    vi.mocked(api.listHubAudit).mockResolvedValue(page([entry()]));
    renderView();
    await waitFor(() => expect(screen.getByText("scan_server")).toBeInTheDocument());

    // FacetFilter (@elabs-ai/components-data) is a DropdownMenu of DropdownMenuItems — Radix's trigger only listens
    // for pointerdown/keydown, not click (the established SessionsView.test.tsx precedent).
    fireEvent.keyDown(screen.getByRole("button", { name: /^kind$/i }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /tool call/i }));

    await waitFor(() =>
      expect(api.listHubAudit).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "tool_call" })),
    );
  });

  test("selecting two Kind facets narrows client-side instead of sending `kind`", async () => {
    vi.mocked(api.listHubAudit).mockResolvedValue(
      page([
        entry({ id: "tool_call:1", kind: "tool_call", toolName: "scan_server" }),
        entry({ id: "spawn:1", kind: "spawn", roleName: "Scout", model: "claude-sonnet-5" }),
        entry({ id: "approval:1", kind: "approval", toolName: "delete_file", resolution: "pending" }),
      ]),
    );
    renderView();
    await waitFor(() => expect(screen.getByText("scan_server")).toBeInTheDocument());

    fireEvent.keyDown(screen.getByRole("button", { name: /^kind$/i }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /tool call/i }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /agent spawn/i }));

    // Two kinds selected — the server call stays unfiltered on `kind` (the hybrid rule)…
    await waitFor(() => {
      const lastCall = vi.mocked(api.listHubAudit).mock.calls.at(-1)?.[0];
      expect(lastCall?.kind).toBeUndefined();
    });
    // …while the rendered rows narrow to exactly the two selected kinds, client-side.
    await waitFor(() => expect(screen.queryByText("delete_file")).not.toBeInTheDocument());
    expect(screen.getByText("scan_server")).toBeInTheDocument();
    expect(screen.getByText("Scout")).toBeInTheDocument();
  });

  test("reset clears filters and shows the full set again", async () => {
    const only = [entry({ id: "tool_call:1", kind: "tool_call", toolName: "scan_server" })];
    // A real server HONORS a single-kind selection (the hybrid rule) — simulate that here so the
    // "Agent spawn" selection genuinely comes back empty, proving reset restores the unfiltered set.
    vi.mocked(api.listHubAudit).mockImplementation(async (filter) =>
      page(filter?.kind ? only.filter((e) => e.kind === filter.kind) : only),
    );
    renderView();
    await waitFor(() => expect(screen.getByText("scan_server")).toBeInTheDocument());

    fireEvent.keyDown(screen.getByRole("button", { name: /^kind$/i }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /agent spawn/i }));
    // FacetFilter is a multi-select checklist — it stays open after a click (so several boxes can be
    // checked in one session) and keeps the rest of the page `aria-hidden` while its portal is open.
    // Close it before querying by role for anything outside the menu.
    fireEvent.keyDown(document.body, { key: "Escape" });

    await waitFor(() => expect(screen.getByText("No events match")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /reset filters/i }));

    await waitFor(() => expect(screen.getByText("scan_server")).toBeInTheDocument());
  });

  test("Export downloads a CSV of the currently loaded + filtered rows", async () => {
    vi.mocked(api.listHubAudit).mockResolvedValue(
      page([entry({ id: "tool_call:1", toolName: "scan_server" })]),
    );
    renderView();
    await waitFor(() => expect(screen.getByText("scan_server")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /export/i }));

    expect(downloadCsv).toHaveBeenCalledTimes(1);
    const [filename, csv] = vi.mocked(downloadCsv).mock.calls[0] as [string, string];
    expect(filename).toMatch(/^audit-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(csv).toContain("scan_server");
  });

  test("Load more appends the next page", async () => {
    vi.mocked(api.listHubAudit).mockResolvedValueOnce(
      page([entry({ id: "tool_call:1", toolName: "first_tool" })], "cursor-1"),
    );
    renderView();
    await waitFor(() => expect(screen.getByText("first_tool")).toBeInTheDocument());

    vi.mocked(api.listHubAudit).mockResolvedValueOnce(
      page([entry({ id: "tool_call:2", toolName: "second_tool", at: "2026-07-17T09:00:00.000Z" })]),
    );
    fireEvent.click(screen.getByRole("button", { name: /load more/i }));

    await waitFor(() => expect(screen.getByText("second_tool")).toBeInTheDocument());
    expect(api.listHubAudit).toHaveBeenLastCalledWith(
      expect.objectContaining({ before: "cursor-1" }),
    );
  });

  test("destructive/open-world annotations still render inline on the outcome cell", async () => {
    vi.mocked(api.listHubAudit).mockResolvedValue(
      page([
        entry({
          id: "tool_call:1",
          toolName: "delete_file",
          annotations: { destructiveHint: true, openWorldHint: true },
        }),
      ]),
    );
    renderView();

    await waitFor(() => expect(screen.getByText("delete_file")).toBeInTheDocument());
    expect(screen.getByText("Destructive")).toBeInTheDocument();
    expect(screen.getByText("External")).toBeInTheDocument();
  });
});
