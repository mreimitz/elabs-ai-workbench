import { render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@brand/ui";

// `@brand/charts` barrel import triggers a broken deep `@visx/gradient` subpath under Vitest/jsdom
// (see `DashboardView.test.tsx`'s longer note) — `IssueSparkline` only needs `Sparkline` stubbed.
vi.mock("@brand/charts", () => ({
  Sparkline: ({ values, label }: { values: number[]; label?: string }) => (
    <svg role="img" aria-label={label} data-values={values.join(",")} />
  ),
}));

import { formatDateTime } from "../../lib/format";
import { ALL_FLEET_FIXTURES, OPEN_FLEET_ISSUE, REGRESSED_FLEET_ISSUE } from "./issue-fixtures";
import { IssueTriageTable } from "./IssueTriageTable";
import { issueAiAssisted } from "./issue-lib";

function renderTable(overrides: Partial<Parameters<typeof IssueTriageTable>[0]> = {}) {
  const onSelect = vi.fn();
  render(
    <TooltipProvider>
      <IssueTriageTable
        issues={ALL_FLEET_FIXTURES}
        selectedId={null}
        onSelect={onSelect}
        entityLabel={(id) => (id === "srv-1" ? "Acme-SaaS" : id === "skill-1" ? "Sales summary" : id)}
        {...overrides}
      />
    </TooltipProvider>,
  );
  return { onSelect };
}

describe("IssueTriageTable — rendering", () => {
  test("renders one row per issue with title, lifecycle, occurrences, first/last seen, bucket", () => {
    renderTable();
    for (const issue of ALL_FLEET_FIXTURES) {
      expect(screen.getByText(issue.title)).toBeInTheDocument();
    }
    // Lifecycle chips (own 3-state vocabulary, not the generic wire mapper).
    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.getByText("Regressed")).toBeInTheDocument();
    expect(screen.getByText("Resolved")).toBeInTheDocument();
    // Occurrence counts (fleet.occurrenceCount, not timesSeen).
    expect(screen.getByText("2")).toBeInTheDocument(); // OPEN_FLEET_ISSUE
    expect(screen.getByText("5")).toBeInTheDocument(); // REGRESSED_FLEET_ISSUE
    // Bucket chips (both OPEN_FLEET_ISSUE and SPARSE_RESOLVED_FLEET_ISSUE share bucket "mcp_server").
    expect(screen.getAllByText("MCP server").length).toBeGreaterThan(0);
    expect(screen.getByText("Skill")).toBeInTheDocument();
  });

  test("resolves affected entity ids to display names via entityLabel", () => {
    renderTable();
    expect(screen.getByText("Acme-SaaS")).toBeInTheDocument();
    expect(screen.getByText("Sales summary")).toBeInTheDocument();
  });

  test("marks an AI-assisted issue with the Sparkles provenance mark; a plain issue gets none", () => {
    const flagged = { ...OPEN_FLEET_ISSUE, aiAssisted: true } as typeof OPEN_FLEET_ISSUE;
    expect(issueAiAssisted(flagged)).toBe(true);
    renderTable({ issues: [flagged, REGRESSED_FLEET_ISSUE] });
    expect(screen.getAllByTestId("ai-assisted-mark")).toHaveLength(1);
    const rows = screen.getAllByRole("row");
    const flaggedRow = rows.find((row) => within(row).queryByText(flagged.title)) as HTMLElement;
    expect(within(flaggedRow).getByTestId("ai-assisted-mark")).toBeInTheDocument();
    const plainRow = rows.find((row) =>
      within(row).queryByText(REGRESSED_FLEET_ISSUE.title),
    ) as HTMLElement;
    expect(within(plainRow).queryByTestId("ai-assisted-mark")).not.toBeInTheDocument();
  });

  test("selecting a row fires onSelect with that issue", () => {
    const { onSelect } = renderTable();
    screen.getByRole("button", { name: `Open ${OPEN_FLEET_ISSUE.title}` }).click();
    expect(onSelect).toHaveBeenCalledWith(OPEN_FLEET_ISSUE);
  });

  test("empty issue list renders the table's empty message", () => {
    renderTable({ issues: [] });
    expect(screen.getByText("No issues match the current filters.")).toBeInTheDocument();
  });
});

describe("IssueTriageTable — Affected column empty state is accessible (critique 2026-07-25T20-00-10Z item 4)", () => {
  test("no affected servers/skills: the cell keeps its visible dash but announces 'None', not nothing", () => {
    const noneAffected = {
      ...OPEN_FLEET_ISSUE,
      id: "issue-none-affected",
      fleet: {
        ...OPEN_FLEET_ISSUE.fleet,
        affected: { servers: [], skills: [], tests: [], models: [] },
      },
    };
    renderTable({ issues: [noneAffected] });
    // Visible dash is unchanged (no visual regression) …
    expect(screen.getByText("—")).toBeInTheDocument();
    // … but it carries NO accessible text of its own (a bare "—" reads poorly/inconsistently).
    expect(screen.getByText("—")).toHaveAttribute("aria-hidden", "true");
    // "None" is the cell's real accessible content — present in the DOM, not aria-hidden.
    const none = screen.getByText("None");
    expect(none).not.toHaveAttribute("aria-hidden");
    expect(none).toHaveClass("sr-only");
  });

  test("with affected entities: renders the badges, no dash/None fallback", () => {
    renderTable({ issues: [OPEN_FLEET_ISSUE] });
    expect(screen.queryByText("—")).not.toBeInTheDocument();
    expect(screen.queryByText("None")).not.toBeInTheDocument();
  });
});

describe("IssueTriageTable — full-width redesign: truncation + nowrap dates", () => {
  test("a long title truncates (bounded + ellipsized) instead of overflowing the row", () => {
    const longTitle =
      "Tool `run_query` rejects an otherwise valid ISO-8601 date filter on every single invocation " +
      "no matter how the request is shaped, which keeps breaking the weekly reporting skill";
    const longIssue = { ...OPEN_FLEET_ISSUE, id: "issue-long-title", title: longTitle };
    renderTable({ issues: [longIssue] });

    // The full title is still reachable (a11y button name + hover tooltip), never dropped —
    // just visually clipped by a bounded max-width + `truncate` on its own span.
    const titleSpan = screen.getByTitle(longTitle);
    expect(titleSpan).toHaveClass("truncate");
    // A hard `max-width` (not just `min-w-0`) is what actually caps a table cell's rendered width —
    // see the component's own doc for why `min-w-0 truncate` alone doesn't do it in a `<table>`.
    const wrapper = titleSpan.parentElement as HTMLElement;
    expect(wrapper.className).toMatch(/max-w-\[/);
    expect(screen.getByRole("button", { name: `Open ${longTitle}` })).toBeInTheDocument();
  });

  test("First seen / Last seen render on a single line (nowrap), with the full timestamp on hover", () => {
    renderTable({ issues: [OPEN_FLEET_ISSUE] });
    const firstSeenFull = formatDateTime(OPEN_FLEET_ISSUE.fleet.firstSeenAt);
    const lastSeenFull = formatDateTime(OPEN_FLEET_ISSUE.fleet.lastSeenAt);
    const firstSeenCell = screen.getByTitle(firstSeenFull);
    const lastSeenCell = screen.getByTitle(lastSeenFull);
    expect(firstSeenCell).toHaveClass("whitespace-nowrap");
    expect(lastSeenCell).toHaveClass("whitespace-nowrap");
    // Never the old long absolute string as the VISIBLE text — that's what wrapped
    // character-by-character in a cramped column. The full string only shows on hover (asserted
    // above via `title=`); the visible text is the compact `formatRelativeTime` label instead.
    expect(screen.queryByText(firstSeenFull)).not.toBeInTheDocument();
    expect(firstSeenCell.textContent).not.toBe(firstSeenFull);
  });
});
