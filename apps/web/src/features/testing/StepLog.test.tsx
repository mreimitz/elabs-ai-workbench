import type { RunStep, SessionCostBasis } from "@mcp-token-footprint/shared";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { StepLog, type StepLogProps } from "./StepLog";
import type { StepCumulativeKpi } from "./analytics-derive";

function step(over: Partial<RunStep> & Pick<RunStep, "id" | "type">): RunStep {
  return {
    runId: "run",
    index: 0,
    label: over.type,
    status: "ok",
    profileTokens: {},
    payload: {},
    ...over,
  } as RunStep;
}

function renderLog(props: Partial<StepLogProps> & Pick<StepLogProps, "steps">) {
  return render(
    <StepLog selectedStepId={null} onSelectStep={() => {}} {...props} />,
  );
}

/** Fire a click on the row's OWN chevron (not the row body) — toggles expand WITHOUT selecting. */
function clickChevron(container: HTMLElement, labelTitle: string): void {
  const labelEl = screen.getByTitle(labelTitle);
  const treeitem = labelEl.closest('[role="treeitem"]');
  expect(treeitem).not.toBeNull();
  const chevronIcon = treeitem!.querySelector(".lucide-chevron-right");
  expect(chevronIcon).not.toBeNull();
  const chevronSpan = chevronIcon!.closest("span[aria-hidden]");
  expect(chevronSpan).not.toBeNull();
  fireEvent.click(chevronSpan!);
  void container;
}

describe("StepLog — FLAT legacy run renders the ORIGINAL DataTable branch, byte-stable (acceptance 1)", () => {
  test("no step carries parentStepId -> the flat DataTable columns render exactly as before", () => {
    const steps = [
      step({ id: "s0", index: 0, type: "user_message", label: "hello", payload: { text: "hi" } }),
      step({ id: "s1", index: 1, type: "llm_response", label: "Assistant reply" }),
    ];
    renderLog({ steps });

    // The flat DataTable's own column headers — untouched code path. Scoped to the table itself:
    // "Type" ALSO labels the toolbar's FacetFilter button, so an unscoped query is ambiguous.
    const table = screen.getByRole("table");
    expect(within(table).getByText("Type")).toBeInTheDocument();
    expect(within(table).getByText("Step")).toBeInTheDocument();
    expect(within(table).getByText("Status")).toBeInTheDocument();
    expect(within(table).getByText("Tokens ↑")).toBeInTheDocument();
    expect(within(table).getByText("Tokens ↓")).toBeInTheDocument();
    expect(within(table).getByText("Duration")).toBeInTheDocument();
    expect(within(table).getByText("Weight")).toBeInTheDocument();
    // No tree affordances leak into the flat branch.
    expect(screen.queryByRole("tree")).not.toBeInTheDocument();
    expect(screen.queryByRole("treeitem")).not.toBeInTheDocument();
  });

  // NOTE: the flat branch's row-level click interaction (`onSelectStep`) is UNCHANGED source (not
  // touched by this WP) but can't be exercised here: `@brand/data` `DataTable`'s row virtualizer
  // (`enableRowVirtualization`, pre-existing — not introduced by this WP) needs real layout
  // measurement that jsdom doesn't provide, so the body renders an empty placeholder row instead of
  // actual cells in this test environment (confirmed via a throwaway debug render — the SAME behavior
  // the ORIGINAL pre-WP3.2 code exhibits). The header-level assertion above is what proves the
  // untouched branch is selected and mounts; its row-click wiring is identical to before this WP.
});

describe("StepLog — tree mode: tool_call -> tool_io (default collapsed) + span-kind icons", () => {
  const engine = step({
    id: "run:step:1",
    index: 1,
    type: "tool_call",
    toolName: "search",
    status: "ok",
    payload: { toolCallId: "c1", args: { q: "x" } },
  });
  const mcp = step({
    id: "run:mcp:1",
    index: 2,
    type: "tool_call",
    toolName: "search",
    status: "ok",
    durationMs: 120,
    payload: { toolCallId: "c1", isError: false },
  });
  const io = step({
    id: "run:mcp:1:io",
    index: 3,
    type: "context_event",
    spanKind: "tool_io",
    parentStepId: "run:mcp:1", // MCP-sink id — StepLog must reparent onto the surviving engine row
    // toolName intentionally OMITTED so its rendered label ("search · MCP I/O") stays distinguishable
    // from the parent's ("search") in these assertions — a real tool_io step DOES carry toolName too.
    label: "search · MCP I/O",
    status: "ok",
    durationMs: 120,
  });
  const steps = [engine, mcp, io];

  test("the tool_call row renders; its tool_io child is HIDDEN by default (collapsed)", () => {
    renderLog({ steps });
    expect(screen.getByTitle("search")).toBeInTheDocument();
    expect(screen.queryByTitle("search · MCP I/O")).not.toBeInTheDocument();
  });

  test("the tool_call row carries the Wrench TYPE icon (no spanKind override — redundant with `type`)", () => {
    const { container } = renderLog({ steps });
    const treeitem = screen.getByTitle("search").closest('[role="treeitem"]')!;
    expect(treeitem.querySelector(".lucide-wrench")).not.toBeNull();
    void container;
  });

  test("expanding the tool_call row (chevron click) reveals the tool_io child, carrying the tool_io span-kind icon", () => {
    const { container } = renderLog({ steps });
    clickChevron(container, "search");
    const childEl = screen.getByTitle("search · MCP I/O");
    expect(childEl).toBeInTheDocument();
    const childTreeitem = childEl.closest('[role="treeitem"]')!;
    expect(childTreeitem.querySelector(".lucide-arrow-left-right")).not.toBeNull();
    // Depth: the child's treeitem carries aria-level 2 (root tool_call is level 1).
    expect(childTreeitem.getAttribute("aria-level")).toBe("2");
  });
});

describe("StepLog — tree mode: rating -> judge_call (default collapsed)", () => {
  const rating = step({
    id: "rating-1",
    index: 5,
    type: "context_event",
    spanKind: "rating",
    label: "Run review",
    status: "ok",
  });
  const judge = step({
    id: "judge-1",
    index: 6,
    type: "context_event",
    spanKind: "judge_call",
    parentStepId: "rating-1",
    label: "judge-model-x",
    status: "ok",
    payload: { judgeTokensIn: 400, judgeTokensOut: 120, judgeCostUsd: 0.03 },
  });
  const steps = [rating, judge];

  test("the rating row renders with its ClipboardCheck icon; the judge_call child is hidden by default", () => {
    renderLog({ steps });
    const treeitem = screen.getByTitle("Run review").closest('[role="treeitem"]')!;
    expect(treeitem.querySelector(".lucide-clipboard-check")).not.toBeNull();
    expect(screen.queryByTitle("judge-model-x")).not.toBeInTheDocument();
  });

  test("expanding the rating row reveals the judge_call child with its Gavel icon", () => {
    const { container } = renderLog({ steps });
    clickChevron(container, "Run review");
    const childEl = screen.getByTitle("judge-model-x");
    expect(childEl).toBeInTheDocument();
    const childTreeitem = childEl.closest('[role="treeitem"]')!;
    expect(childTreeitem.querySelector(".lucide-gavel")).not.toBeNull();
  });

  test("the rating row's ROLLED-UP cost chip surfaces the judge_call's OWN judge-ledger cost ($0.03), not the run's main (zero) ledger", () => {
    renderLog({ steps, kpiByStepId: new Map(), costBasis: "api_exact" });
    expect(screen.getByText("$0.03")).toBeInTheDocument();
  });
});

describe("StepLog — per-step economics chips match hand-computed deltas + subtree rollups (acceptance 2)", () => {
  // llm0 cumulative jumps from {0,0,0} -> {1000,200,0.10}: its OWN delta is exactly that jump.
  const llm0 = step({
    id: "llm0",
    index: 0,
    type: "llm_response",
    label: "Assistant reply",
    durationMs: 500,
  });
  // The engine tool_call row (post StepLog's OWN dedupe, merged with the mcp sink's durationMs=120).
  const engine = step({
    id: "run:step:1",
    index: 1,
    type: "tool_call",
    toolName: "search",
    payload: { toolCallId: "c1", args: {} },
  });
  const mcp = step({
    id: "run:mcp:1",
    index: 2,
    type: "tool_call",
    toolName: "search",
    durationMs: 120,
    payload: { toolCallId: "c1", isError: false },
  });
  // tool_io reparents onto "run:step:1" (the surviving engine row) — its cumulative jumps again by
  // {300, 50, 0.05}, which is ALSO the tool_call parent's ROLLUP (its own delta is zero — the engine
  // row's cumulative snapshot is unchanged from llm0's).
  const io = step({
    id: "run:mcp:1:io",
    index: 3,
    type: "context_event",
    spanKind: "tool_io",
    parentStepId: "run:mcp:1",
    durationMs: 120,
  });
  const steps = [llm0, engine, mcp, io];
  const kpiByStepId: ReadonlyMap<string, StepCumulativeKpi> = new Map([
    ["llm0", { tokensIn: 1000, tokensOut: 200, costUsd: 0.1 }],
    ["run:step:1", { tokensIn: 1000, tokensOut: 200, costUsd: 0.1 }],
    ["run:mcp:1:io", { tokensIn: 1300, tokensOut: 250, costUsd: 0.15 }],
  ]);

  test("a ROOT leaf's chips show its OWN hand-computed delta (first step diffs against zero)", () => {
    renderLog({ steps, kpiByStepId, costBasis: "api_exact" });
    expect(screen.getByText("1,000↑")).toBeInTheDocument();
    expect(screen.getByText("200↓")).toBeInTheDocument();
    expect(screen.getByText("$0.10")).toBeInTheDocument();
    expect(screen.getByText("500 ms")).toBeInTheDocument();
  });

  test("the tool_call parent's chips show the SUBTREE ROLLUP (its own delta is zero; the child's is not), with the parent's OWN duration (not summed)", () => {
    renderLog({ steps, kpiByStepId, costBasis: "api_exact" });
    // Rollup = own(0,0,0,dur=120) + tool_io child(300,50,0.05,dur=120) => 300↑ / 50↓ / $0.05 / 120 ms.
    expect(screen.getByText("300↑")).toBeInTheDocument();
    expect(screen.getByText("50↓")).toBeInTheDocument();
    expect(screen.getByText("$0.05")).toBeInTheDocument();
    expect(screen.getByText("120 ms")).toBeInTheDocument();
  });

  test("costBasis:\"none\" suppresses the cost-delta chip entirely (no cost figure at all)", () => {
    renderLog({ steps, kpiByStepId, costBasis: "none" as SessionCostBasis });
    expect(screen.queryByText("$0.10")).not.toBeInTheDocument();
    expect(screen.queryByText("$0.05")).not.toBeInTheDocument();
    // Token/duration chips are unaffected by cost-basis gating.
    expect(screen.getByText("1,000↑")).toBeInTheDocument();
  });

  test("a null kpiByStepId (still-live run) shows duration only — never a guessed token/cost delta", () => {
    renderLog({ steps, kpiByStepId: null, costBasis: "api_exact" });
    expect(screen.getByText("500 ms")).toBeInTheDocument();
    expect(screen.queryByText("1,000↑")).not.toBeInTheDocument();
    expect(screen.queryByText("$0.10")).not.toBeInTheDocument();
  });
});

describe("StepLog — a dangling/unresolvable parentStepId never crashes (defensive tree building)", () => {
  test("an orphaned child (parent id doesn't exist anywhere) renders as its own root", () => {
    const orphan = step({
      id: "orphan",
      index: 0,
      type: "context_event",
      spanKind: "tool_io",
      parentStepId: "does-not-exist",
      label: "orphan step",
    });
    expect(() => renderLog({ steps: [orphan] })).not.toThrow();
    expect(screen.getByTitle("orphan step")).toBeInTheDocument();
  });
});

describe("StepLog — console-header search integration: highlight + filter-to-matches toggle (WP3.4)", () => {
  // Two tree-hierarchy-eligible steps (one carries a `parentStepId` so `hasStepHierarchy` selects the
  // TREE branch) — one matches "widgets", the other doesn't.
  const matching = step({
    id: "s-match",
    index: 0,
    type: "tool_call",
    toolName: "search_widgets",
    label: "search_widgets",
    payload: { toolCallId: "c1", args: { query: "widgets" } },
  });
  const nonMatching = step({
    id: "s-other",
    index: 1,
    type: "context_event",
    spanKind: "tool_io",
    parentStepId: "s-match",
    label: "unrelated step",
  });

  test("no highlightQuery: the toggle is absent and every row renders (default behavior untouched)", () => {
    renderLog({ steps: [matching, nonMatching] });
    expect(screen.queryByText("Filtered only")).not.toBeInTheDocument();
    expect(screen.queryByText("Show all")).not.toBeInTheDocument();
    expect(screen.getByTitle("search_widgets")).toBeInTheDocument();
  });

  test('"filtered" (default) mode hides non-matching rows and highlights the match in the visible label', () => {
    renderLog({ steps: [matching, nonMatching], highlightQuery: "widgets" });
    expect(screen.getByText("Filtered only")).toBeInTheDocument();
    expect(screen.getByText("Show all")).toBeInTheDocument();
    // The matching row's label is present, with the query wrapped in a <mark>.
    const label = screen.getByTitle("search_widgets");
    expect(label.querySelector("mark")).not.toBeNull();
    expect(label.querySelector("mark")?.textContent?.toLowerCase()).toBe("widgets");
    // The non-matching child never made it into the tree at all in "filtered" mode.
    expect(screen.queryByTitle("unrelated step")).not.toBeInTheDocument();
  });

  test('"Show all" mode keeps every row visible and only highlights the match', () => {
    const onModeChange = vi.fn();
    const { rerender, container } = renderLog({
      steps: [matching, nonMatching],
      highlightQuery: "widgets",
      matchFilterMode: "filtered",
      onMatchFilterModeChange: onModeChange,
    });
    fireEvent.click(screen.getByText("Show all"));
    expect(onModeChange).toHaveBeenCalledWith("all");

    // Simulate the caller lifting the mode change into state (controlled usage).
    rerender(
      <StepLog
        selectedStepId={null}
        onSelectStep={() => {}}
        steps={[matching, nonMatching]}
        highlightQuery="widgets"
        matchFilterMode="all"
        onMatchFilterModeChange={onModeChange}
      />,
    );
    // Both rows are present once the parent (matching) is expanded — the non-matching row is its
    // tool_io child, default-collapsed; expand it via the chevron to prove it's still THERE at all
    // (Show all never removed it from the tree, unlike "filtered").
    clickChevron(container, "search_widgets");
    expect(screen.getByTitle("unrelated step")).toBeInTheDocument();
  });

  test('a query with no visible-label match but a PAYLOAD match shows the "matches elsewhere" indicator instead of a fabricated highlight', () => {
    const payloadOnly = step({
      id: "s-payload",
      index: 0,
      type: "tool_call",
      toolName: "process_data",
      label: "process_data",
      payload: { toolCallId: "c9", args: { secretParam: "zzzneedle" } },
    });
    const child = step({
      id: "s-payload-io",
      index: 1,
      type: "context_event",
      spanKind: "tool_io",
      parentStepId: "s-payload",
      label: "io detail",
    });
    renderLog({
      steps: [payloadOnly, child],
      highlightQuery: "zzzneedle",
      matchFilterMode: "all",
    });
    const label = screen.getByTitle("process_data");
    // No <mark> in the visible label — the query never literally appears there.
    expect(label.querySelector("mark")).toBeNull();
    // But the row still carries the "matches elsewhere" indicator (its title names the icon's purpose).
    const treeitem = label.closest('[role="treeitem"]') as HTMLElement;
    expect(treeitem).not.toBeNull();
    expect(within(treeitem).getByTitle("Matches the search in its payload")).toBeInTheDocument();
  });

  test("an uncontrolled toggle (no onMatchFilterModeChange) still flips its OWN local mode on click", () => {
    renderLog({ steps: [matching, nonMatching], highlightQuery: "unrelated" });
    // "unrelated" only matches the second (non-matching-named) step's label — filtered mode hides the
    // first step entirely.
    expect(screen.queryByTitle("search_widgets")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Show all"));
    // Now both are visible again (Show all never hides on membership).
    expect(screen.getByTitle("search_widgets")).toBeInTheDocument();
  });
});
