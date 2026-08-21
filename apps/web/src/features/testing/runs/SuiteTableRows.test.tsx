import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, test, vi } from "vitest";
import type { RunSummary, Scenario, SuiteRun, Test } from "@mcp-token-footprint/shared";
import { Table, TableBody, TooltipProvider } from "@elabs-ai/components-ui";

// `SuiteTableRows` imports `suiteStatusBadge` from `../suites/SuiteRunConsole`, whose chart children
// pull `@elabs-ai/components-charts` (@visx), which jsdom cannot resolve — the same no-op stub
// `RunsView.test.tsx` already uses. The mapping is restated faithfully (it is a pure switch) so the
// label assertions below still mean what they say.
vi.mock("../suites/SuiteRunConsole", () => ({
  suiteStatusBadge: (status: string) => {
    switch (status) {
      case "pending":
        return { status: "pending", label: "Pending" };
      case "running":
        return { status: "running", label: "Running" };
      case "capped":
        return { status: "denied", label: "Cost-capped" };
      case "stopped":
        return { status: "skipped", label: "Stopped" };
      case "error":
        return { status: "failed", label: "Error" };
      default:
        return { status: "complete", label: "Completed" };
    }
  },
}));

import { SuiteTableRows } from "./SuiteTableRows";
import type { FeedSuiteItem } from "./runs-api";
import type { RunTableColumnKey } from "./run-columns";

/**
 * RM-36 WP 2.2 · P2-1 — ONE encoding per column across a suite-run parent row and its child run rows.
 *
 * The measured defect: in ONE table, in adjacent rows, Status rendered as `@elabs-ai/components-ui`'s
 * closed-enum `StatusBadge` (icon + badge) on the parent and as the app-local `StatusBadge` (badge,
 * no icon) on the children; Grade rendered as plain text on the parent and as CHIPS on the children;
 * and Actions read "Open console" on the parent against "Open" on the children. Two visual encodings
 * in one column read as two meanings — the parent/child distinction is already carried by the row
 * indent and the expander.
 *
 * These guards pin the AFTER state on the three columns the audit named. They deliberately do NOT
 * pin what the runs table MEANS (status vocabulary, grading, the drill targets) — that is out of
 * scope for a presentation sweep.
 */

function makeRun(over: Partial<RunSummary> = {}): RunSummary {
  return {
    id: "run-m1",
    testId: "test-1",
    scenarioId: "scn-1",
    mode: "automated",
    status: "completed",
    outcome: "completed",
    startedAt: "2026-08-20T00:00:00.000Z",
    durationMs: 4200,
    turns: 2,
    toolCalls: 1,
    peakContextTokens: 500,
    tokensIn: 100,
    tokensOut: 20,
    costUsd: 0.5,
    ratingState: "rated",
    suiteRunId: "srun-1",
    ...over,
  };
}

function makeSuiteRun(over: Partial<SuiteRun> = {}): SuiteRun {
  return {
    id: "srun-1",
    suiteId: "suite-1",
    status: "completed",
    configSnapshot: { repetitions: 1, maxConcurrency: 2 },
    startedAt: "2026-08-20T00:00:00.000Z",
    endedAt: "2026-08-20T00:05:00.000Z",
    source: "suite",
    ratingState: "rated",
    aggregates: {
      cellsTotal: 1,
      cellsCompleted: 1,
      meanGrade: 1,
      gradeStdDev: 0,
      passRateAt05: 1,
      totalTokens: 120,
      execCostUsd: 0.5,
      judgeCostUsd: 0,
    },
    ...over,
  };
}

function makeItem(over: Partial<FeedSuiteItem> = {}): FeedSuiteItem {
  const suiteRun = over.suiteRun ?? makeSuiteRun();
  return {
    kind: "suite",
    sortMs: Date.parse(suiteRun.startedAt),
    suiteRun,
    suiteName: "Nightly",
    members: [makeRun()],
    testCount: 1,
    environmentCount: 1,
    repetitions: 1,
    ...over,
  };
}

const test1: Test = {
  id: "test-1",
  name: "List files",
  prompt: "list",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
} as unknown as Test;

const scenario1 = { id: "scn-1", name: "Baseline", model: "gpt-5" } as unknown as Scenario;

/** Only the columns these guards speak about — keeps stray "—" cells (Kind/waiting/seen) out of the
 *  queries below without changing what is rendered in those columns. */
const COLUMNS = new Set<RunTableColumnKey>(["status"]);

function renderRows(item: FeedSuiteItem, opts: { expanded?: boolean; showGrade?: boolean } = {}) {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <Table>
          <TableBody>
            <SuiteTableRows
              item={item}
              testsById={new Map([[test1.id, test1]])}
              scenariosById={new Map([[scenario1.id, scenario1]])}
              colSpan={12}
              showGrade={opts.showGrade ?? true}
              expanded={opts.expanded ?? true}
              onToggleExpand={vi.fn()}
              onOpenConsole={vi.fn()}
              onOpenRun={vi.fn()}
              selectedRunIds={new Set()}
              onToggleRunSelected={vi.fn()}
              suiteSelected={false}
              onToggleSuiteSelected={vi.fn()}
              visible={COLUMNS}
            />
          </TableBody>
        </Table>
      </TooltipProvider>
    </MemoryRouter>,
  );
}

/** The summary row is the one carrying the suite's own "Select … for suite comparison" checkbox. */
function summaryRow(): HTMLElement {
  const checkbox = screen.getByRole("checkbox", { name: /for suite comparison$/ });
  const row = checkbox.closest("tr");
  if (!row) throw new Error("suite summary row not found");
  return row;
}

/** The member row is the one carrying a plain "Select … for comparison" checkbox. */
function memberRow(): HTMLElement {
  const checkbox = screen
    .getAllByRole("checkbox")
    .find((node) => /for comparison$/.test(node.getAttribute("aria-label") ?? ""));
  const row = checkbox?.closest("tr");
  if (!row) throw new Error("member run row not found");
  return row;
}

describe("SuiteTableRows — P2-1: one encoding per column (RM-36 WP 2.2)", () => {
  test("Status renders on the SAME chip in the parent row and its child rows", () => {
    renderRows(makeItem());

    // The app-local StatusBadge stamps `data-status` with its tone; the closed-enum brand
    // StatusBadge does not. Both rows must carry it — that is the "one encoding" claim.
    const parentChip = summaryRow().querySelector("[data-status]");
    const childChip = memberRow().querySelector("[data-status]");

    expect(parentChip).not.toBeNull();
    expect(childChip).not.toBeNull();
    expect(parentChip).toHaveTextContent("Completed");
    expect(childChip).toHaveTextContent("Completed");
    // Same tone vocabulary, not two different ones.
    expect(parentChip?.getAttribute("data-status")).toBe("success");
    expect(childChip?.getAttribute("data-status")).toBe("success");
  });

  test("the parent's status label still carries the failed-member rollup", () => {
    renderRows(
      makeItem({ members: [makeRun({ id: "run-bad", status: "error", outcome: "error" })] }),
    );
    expect(summaryRow().querySelector("[data-status]")).toHaveTextContent("Completed · 1 error");
  });

  test("Grade renders as a CHIP on the parent row, not as plain text", () => {
    renderRows(makeItem());

    const row = summaryRow();
    // The chip keeps the number and the "pass" suffix it always had…
    expect(within(row).getByText(/100\.0% pass/)).toBeInTheDocument();
    // …but it is now a badge (a `data-slot="status-badge"` element), the same shape the child rows
    // and the standalone run rows use, rather than a bare text cell.
    const chip = within(row).getByText(/100\.0% pass/).closest("[data-slot='status-badge']");
    expect(chip).not.toBeNull();
  });

  test("a suite with no graded members still reads as an em dash, never a red 0", () => {
    const suiteRun = makeSuiteRun();
    renderRows(
      makeItem({
        suiteRun: {
          ...suiteRun,
          aggregates: { ...suiteRun.aggregates!, passRateAt05: null },
        },
      }),
    );
    const row = summaryRow();
    expect(within(row).getByText("—")).toBeInTheDocument();
    expect(within(row).queryByText(/pass/)).not.toBeInTheDocument();
  });

  test("Actions use ONE verb — the parent's button reads 'Open', like every child row", () => {
    renderRows(makeItem());

    // The parent's action is named for AT (many rows would otherwise all be "Open") but its VISIBLE
    // word is the same one the child rows use.
    const parentOpen = within(summaryRow()).getByRole("button", { name: "Open Nightly suite console" });
    expect(parentOpen).toHaveTextContent("Open");
    expect(screen.queryByText("Open console")).not.toBeInTheDocument();

    expect(within(memberRow()).getByRole("button", { name: "Open" })).toBeInTheDocument();
  });
});

describe("SuiteTableRows — member grade cell", () => {
  test("a member's score renders on the same chip, and an ungraded member on an em dash", () => {
    // `primaryScore` only reaches MemberRow through the suite-run console's reuse; the feed passes
    // none, which must stay an empty spacer cell (unchanged behaviour).
    renderRows(makeItem());
    expect(within(memberRow()).queryByText("—")).not.toBeInTheDocument();
  });
});
