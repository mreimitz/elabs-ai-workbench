import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, test, vi } from "vitest";
import type { RunSummary } from "@mcp-token-footprint/shared";
import { Table, TableBody, TooltipProvider } from "@elabs-ai/components-ui";
import { RunTableRow } from "./RunTableRow";
import { SESSION_TABLE_COLUMNS, toVisibleColumnSet } from "./run-columns";

// Run rows are links, not buttons (P1) — the Name/Open controls are now real react-router `Link`s
// (cmd-click / copy-link / middle-click), so every render needs a Router context or `<Link>` throws.

/**
 * Claude subscription (planning/Roadmap/RM-09-claude-subscription/, WP 3.1, D-CS4) — the Runs feed marks a
 * `claude_subscription` run's cost "est. · subscription" (its `costUsd` is a shadow-price estimate,
 * marginal cost $0), reusing the shared `SubscriptionCostMarker`. An ordinary API-metered run shows the
 * cost number ALONE, with no marker. This locks both directions on the single-run feed row.
 */

function makeRun(over: Partial<RunSummary> = {}): RunSummary {
  return {
    id: "run-1",
    testId: "test-1",
    scenarioId: "scn-1",
    mode: "automated",
    status: "completed",
    outcome: "completed",
    startedAt: "2026-07-13T00:00:00.000Z",
    durationMs: 4200,
    turns: 2,
    toolCalls: 1,
    peakContextTokens: 500,
    tokensIn: 100,
    tokensOut: 20,
    costUsd: 0.5,
    ratingState: "rated",
    ...over,
  };
}

function renderRow(run: RunSummary, scenarioName: string | undefined = "Baseline") {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <Table>
          <TableBody>
            <RunTableRow
              run={run}
              testName="List files"
              scenarioName={scenarioName}
              grades={[]}
              showGrade={false}
              selected={false}
              onToggleSelected={vi.fn()}
              onOpen={vi.fn()}
              onRerun={vi.fn()}
            />
          </TableBody>
        </Table>
      </TooltipProvider>
    </MemoryRouter>,
  );
}

describe("RunTableRow — subscription cost marker (WP 3.1)", () => {
  test("a subscription-reference run shows the 'est.' marker next to its cost", () => {
    renderRow(makeRun({ costBasis: "subscription_reference" }));

    // The cost value still renders…
    expect(screen.getByText("$0.50")).toBeInTheDocument();
    // …with the shared "est." marker beside it (its a11y label names the subscription reference).
    const marker = screen.getByText("est.");
    expect(marker).toBeInTheDocument();
    expect(marker.getAttribute("aria-label")).toMatch(/subscription reference/i);
  });

  test("an ordinary (api_exact / absent) run shows the cost with NO marker", () => {
    renderRow(makeRun({ costBasis: undefined }));

    expect(screen.getByText("$0.50")).toBeInTheDocument();
    expect(screen.queryByText("est.")).not.toBeInTheDocument();
  });

  test("an explicit api_exact basis is treated as an ordinary run (no marker)", () => {
    renderRow(makeRun({ costBasis: "api_exact" }));

    // Scope to the row so no incidental "est." elsewhere would pass this by accident.
    const row = screen.getByRole("row");
    expect(within(row).queryByText("est.")).not.toBeInTheDocument();
  });
});

/**
 * Retention pin (Observability WP1.6 API, wired into the Runs feed by WP2.3) — the row's OWN pin
 * toggle. Omitting `pinned`/`onTogglePinned` (the block above) hides the control entirely, so this is
 * additive: existing rows/tests are unaffected.
 */
describe("RunTableRow — retention pin toggle (WP 2.3)", () => {
  function renderPinnableRow(run: RunSummary, onTogglePinned = vi.fn()) {
    render(
      <MemoryRouter>
        <TooltipProvider>
          <Table>
            <TableBody>
              <RunTableRow
                run={run}
                testName="List files"
                scenarioName="Baseline"
                grades={[]}
                showGrade={false}
                selected={false}
                onToggleSelected={vi.fn()}
                onOpen={vi.fn()}
                onRerun={vi.fn()}
                pinned={run.pinned ?? false}
                onTogglePinned={onTogglePinned}
              />
            </TableBody>
          </Table>
        </TooltipProvider>
      </MemoryRouter>,
    );
    return { onTogglePinned };
  }

  test("an unpinned run shows a 'Pin' control", () => {
    renderPinnableRow(makeRun({ pinned: false }));
    const pin = screen.getByRole("button", { name: "Pin List files" });
    expect(pin).toHaveAttribute("aria-pressed", "false");
  });

  test("a pinned run shows an 'Unpin' control", () => {
    renderPinnableRow(makeRun({ pinned: true }));
    const unpin = screen.getByRole("button", { name: "Unpin List files" });
    expect(unpin).toHaveAttribute("aria-pressed", "true");
  });

  test("clicking the pin control calls onTogglePinned with the FLIPPED state, and does not open the run", () => {
    const onOpen = vi.fn();
    const onTogglePinned = vi.fn();
    render(
      <MemoryRouter>
        <TooltipProvider>
          <Table>
            <TableBody>
              <RunTableRow
                run={makeRun({ pinned: false })}
                testName="List files"
                scenarioName="Baseline"
                grades={[]}
                showGrade={false}
                selected={false}
                onToggleSelected={vi.fn()}
                onOpen={onOpen}
                onRerun={vi.fn()}
                pinned={false}
                onTogglePinned={onTogglePinned}
              />
            </TableBody>
          </Table>
        </TooltipProvider>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Pin List files" }));
    expect(onTogglePinned).toHaveBeenCalledWith(true);
    expect(onOpen).not.toHaveBeenCalled();
  });

  test("omitting pinned/onTogglePinned hides the control entirely (the pre-pin test above)", () => {
    renderRow(makeRun());
    expect(screen.queryByRole("button", { name: /^Pin |^Unpin /i })).not.toBeInTheDocument();
  });
});

/** The column chooser's expandable preview row (Observability WP 2.3). */
describe("RunTableRow — preview disclosure", () => {
  function renderWithPreview(run: RunSummary) {
    const onTogglePreview = vi.fn();
    const view = render(
      <MemoryRouter>
        <TooltipProvider>
          <Table>
            <TableBody>
              <RunTableRow
                run={run}
                testName="List files"
                scenarioName="Baseline"
                grades={[]}
                showGrade={false}
                selected={false}
                onToggleSelected={vi.fn()}
                onOpen={vi.fn()}
                onRerun={vi.fn()}
                previewMode="cost"
                previewOpen={false}
                onTogglePreview={onTogglePreview}
              />
            </TableBody>
          </Table>
        </TooltipProvider>
      </MemoryRouter>,
    );
    return { ...view, onTogglePreview };
  }

  test("previewMode='none' (the default) renders no expand affordance", () => {
    renderRow(makeRun());
    expect(screen.queryByRole("button", { name: /expand preview/i })).not.toBeInTheDocument();
  });

  test("a non-'none' previewMode renders an expand toggle that calls onTogglePreview", () => {
    const { onTogglePreview } = renderWithPreview(makeRun());
    const toggle = screen.getByRole("button", { name: "Expand preview for List files" });
    fireEvent.click(toggle);
    expect(onTogglePreview).toHaveBeenCalledTimes(1);
  });
});

/**
 * Observability WP 2.5 (D-OB15) — the feed's "chip in the row" (read-only, RUN-level only), rendered
 * alongside the Status badge so it never needs its own column. Distinct in shape from the Grade cell's
 * chips (a `Badge variant="outline"` + thumb icon, not `GradeChip`'s `StatusBadge` or
 * `BaseVerdictChip`'s solid-variant `Badge`).
 */
describe("RunTableRow — feedback chip (WP 2.5, D-OB15)", () => {
  test("a run with a thumbs-up 'verdict' shows the 'Your verdict' chip next to Status", () => {
    renderRow(makeRun({ feedback: [{ key: "verdict", score: 1 }] }));
    expect(screen.getByText("Your verdict")).toBeInTheDocument();
  });

  test("a run with no feedback shows no chip at all (honest empty, no clutter)", () => {
    renderRow(makeRun({ feedback: undefined }));
    expect(screen.queryByText("Your verdict")).not.toBeInTheDocument();
  });
});

/**
 * Sessions lens (Observability WP 2.4) — the session column set (kind chip, active/waiting duration
 * split, last activity, seen marker) rendered when the "Sessions" preset's column preference is
 * active. WP 2.4 acceptance #1: waiting-time math, `seen`, and phase chips render from fixtures;
 * legacy runs (no durations) degrade HONESTLY (wall-only, marked).
 */
const SESSION_VISIBLE = toVisibleColumnSet(SESSION_TABLE_COLUMNS);

function renderSessionRow(run: RunSummary, scenarioModel?: string) {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <Table>
          <TableBody>
            <RunTableRow
              run={run}
              testName="List files"
              scenarioName="Baseline"
              scenarioModel={scenarioModel}
              grades={[]}
              showGrade={false}
              selected={false}
              onToggleSelected={vi.fn()}
              onOpen={vi.fn()}
              onRerun={vi.fn()}
              visible={SESSION_VISIBLE}
            />
          </TableBody>
        </Table>
      </TooltipProvider>
    </MemoryRouter>,
  );
}

describe("RunTableRow — Sessions lens column set (WP 2.4)", () => {
  test("a fully-instrumented session renders active duration, waiting time (total − active), and its model as the Kind chip", () => {
    renderSessionRow(
      makeRun({
        mode: "interactive",
        activeDurationMs: 30_000,
        totalDurationMs: 100_000,
      }),
      "claude-sonnet-4-5",
    );
    // Active duration shown, no "(wall)" fallback marker.
    expect(screen.getByText("30.0 s")).toBeInTheDocument();
    expect(screen.queryByText("(wall)")).not.toBeInTheDocument();
    // Waiting time = 100_000 − 30_000 = 70_000ms.
    expect(screen.getByText("1m 10s")).toBeInTheDocument();
    // Kind chip — no `capabilities.identity`, so the plain scenario model shows.
    expect(screen.getByText("claude-sonnet-4-5")).toBeInTheDocument();
  });

  test("phase chip: a live run waiting on the operator renders 'Waiting for you'", () => {
    renderSessionRow(
      makeRun({ mode: "interactive", status: "running", outcome: undefined, phase: "waiting_input" }),
    );
    expect(screen.getByText("Waiting for you")).toBeInTheDocument();
  });

  test("phase chip: an operator-ended session renders 'Ended' (D-US2, per the unified status module)", () => {
    renderSessionRow(makeRun({ mode: "interactive", status: "ended", outcome: undefined }));
    expect(screen.getByText("Ended")).toBeInTheDocument();
  });

  test("seen:false renders the unseen 'New' marker (D-US2 — unseen finished sessions surface first)", () => {
    renderSessionRow(makeRun({ mode: "interactive", seen: false }));
    expect(screen.getByText("New")).toBeInTheDocument();
  });

  test("seen:true renders no unseen marker", () => {
    renderSessionRow(makeRun({ mode: "interactive", seen: true }));
    expect(screen.queryByText("New")).not.toBeInTheDocument();
  });


  describe("legacy degrade — a pre-Unified-Sessions run (no activeDurationMs/totalDurationMs/endedAt/seen)", () => {
    test("active duration falls back to wall-clock durationMs, MARKED '(wall)' — never silently passed off as active", () => {
      renderSessionRow(
        makeRun({
          mode: "interactive",
          activeDurationMs: undefined,
          totalDurationMs: undefined,
          durationMs: 4200,
        }),
      );
      expect(screen.getByText("4.20 s")).toBeInTheDocument();
      expect(screen.getByText("(wall)")).toBeInTheDocument();
    });

    test("waiting time renders an honest dash — never a fabricated figure from a missing pair", () => {
      const { container } = renderSessionRow(
        makeRun({ mode: "interactive", activeDurationMs: undefined, totalDurationMs: undefined }),
      );
      // At least one cell in the row is the honest "—" (waiting, and — since no endedAt — potentially
      // last-activity/seen too); scoped to the row so this doesn't collide with unrelated dashes.
      const row = within(container).getByRole("row");
      expect(within(row).getAllByText("—").length).toBeGreaterThan(0);
    });

    test("no `seen` bookkeeping ⇒ no unseen marker (never a false 'unseen' claim)", () => {
      renderSessionRow(makeRun({ mode: "interactive", seen: undefined }));
      expect(screen.queryByText("New")).not.toBeInTheDocument();
    });
  });
});

/**
 * Interface Craft WP 2.1 (D-IC10, finding 10) — the Environment cell truncates
 * (`max-w-[12rem] truncate`) with no recovery; add `title` so the full value is reachable on
 * hover even when clipped. Confirmed live-DOM clip in the review was
 * "Acme Answers — ontime-assistant".
 */
describe("RunTableRow — Environment cell truncation recovery (WP 2.1, D-IC10)", () => {
  test("a long/clipped environment name is fully recoverable via `title`", () => {
    renderRow(makeRun(), "Acme Answers — ontime-assistant");
    const cell = screen.getByText("Acme Answers — ontime-assistant");
    expect(cell).toHaveAttribute("title", "Acme Answers — ontime-assistant");
  });

  test("an unknown environment (scenario deleted) still carries a title for its fallback text", () => {
    // Renders directly (not via the `renderRow` helper) so an explicit `undefined` scenarioName
    // reaches the component as-is, rather than falling through the helper's own default param.
    render(
      <MemoryRouter>
        <TooltipProvider>
          <Table>
            <TableBody>
              <RunTableRow
                run={makeRun()}
                testName="List files"
                scenarioName={undefined}
                grades={[]}
                showGrade={false}
                selected={false}
                onToggleSelected={vi.fn()}
                onOpen={vi.fn()}
                onRerun={vi.fn()}
              />
            </TableBody>
          </Table>
        </TooltipProvider>
      </MemoryRouter>,
    );
    const cell = screen.getByText("Unknown environment");
    expect(cell).toHaveAttribute("title", "Unknown environment");
  });
});

/**
 * Run rows are links, not buttons (design-remediation T11, P1) — the Name-cell and right-side "Open"
 * controls used to be plain `<button>`s wired only to an `onClick` callback, so a queue of 200 runs had
 * no cmd-click / copy-link / middle-click. Both are now real `<a href>`s to the run console route
 * (`/testing/runs/:runId`); a plain left click still defers to the `onOpen` callback so any caller-side
 * guard logic (e.g. RunsView's "test/environment still exists" check) keeps running exactly as before.
 */
describe("RunTableRow — run rows are links, not buttons (T11)", () => {
  test("the Name-cell control is a real anchor with an href to the run console", () => {
    renderRow(makeRun({ id: "run-42" }));
    const link = screen.getByRole("link", { name: "Open List files run console" });
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/testing/runs/run-42");
  });

  test("the right-side 'Open' control is ALSO a real anchor to the same href (no duplicate accessible name)", () => {
    renderRow(makeRun({ id: "run-42" }));
    const link = screen.getByRole("link", { name: "Open" });
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/testing/runs/run-42");
  });

  test("a plain left click on the Name link still calls onOpen (the existing open behavior)", () => {
    const onOpen = vi.fn();
    render(
      <MemoryRouter>
        <TooltipProvider>
          <Table>
            <TableBody>
              <RunTableRow
                run={makeRun({ id: "run-42" })}
                testName="List files"
                scenarioName="Baseline"
                grades={[]}
                showGrade={false}
                selected={false}
                onToggleSelected={vi.fn()}
                onOpen={onOpen}
                onRerun={vi.fn()}
              />
            </TableBody>
          </Table>
        </TooltipProvider>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("link", { name: "Open List files run console" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  test("a modified click (⌘/Ctrl-click) does NOT call onOpen — it's left to the browser's native anchor handling", () => {
    const onOpen = vi.fn();
    render(
      <MemoryRouter>
        <TooltipProvider>
          <Table>
            <TableBody>
              <RunTableRow
                run={makeRun({ id: "run-42" })}
                testName="List files"
                scenarioName="Baseline"
                grades={[]}
                showGrade={false}
                selected={false}
                onToggleSelected={vi.fn()}
                onOpen={onOpen}
                onRerun={vi.fn()}
              />
            </TableBody>
          </Table>
        </TooltipProvider>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("link", { name: "Open List files run console" }), {
      metaKey: true,
    });
    expect(onOpen).not.toHaveBeenCalled();
  });
});
