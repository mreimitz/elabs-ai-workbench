import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { RunFilter } from "@mcp-token-footprint/shared";
import { TooltipProvider } from "@elabs-ai/components-ui";
import { EMPTY_RUN_FILTER_OPTIONS, RunFilterBar } from "./RunFilterBar";
import { parseFilterFromSearchParams, writeFilterToSearchParams } from "./run-filter-url";

// jsdom omits matchMedia — Radix (Popover/DropdownMenu/Select) reads it. (ResizeObserver is already
// polyfilled globally in vitest.setup.ts.)
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

function renderBar(filter: RunFilter, onChange = vi.fn()) {
  render(
    <TooltipProvider>
      <RunFilterBar filter={filter} onChange={onChange} options={EMPTY_RUN_FILTER_OPTIONS} />
    </TooltipProvider>,
  );
  return { onChange };
}

/** Radix's `*Trigger` primitives only listen for pointerdown/keydown (not `click`) in jsdom — opening
 *  via `fireEvent.click` alone never works (see `AssistantDock.test.tsx`'s note). Items INSIDE an
 *  already-open overlay respond to a plain click. */
function openViaKeyboard(trigger: HTMLElement) {
  fireEvent.keyDown(trigger, { key: "Enter" });
}

describe("RunFilterBar — chips for active fields (acceptance #1)", () => {
  test("an active status filter renders as a labeled, removable chip", () => {
    renderBar({ status: ["completed", "error"] });
    expect(screen.getByText("Status")).toBeInTheDocument();
    expect(screen.getByText("Completed, Error")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Status filter" })).toBeInTheDocument();
  });

  test("an inactive field renders NO chip", () => {
    renderBar({ status: ["completed"] });
    expect(screen.queryByText("Outcome")).not.toBeInTheDocument();
    expect(screen.queryByText("Pinned")).not.toBeInTheDocument();
  });

  test("removing a chip clears JUST that field, preserving the rest", () => {
    const { onChange } = renderBar({ status: ["completed"], pinned: true });
    fireEvent.click(screen.getByRole("button", { name: "Remove Status filter" }));
    expect(onChange).toHaveBeenCalledWith({ status: undefined, pinned: true });
  });

  test("a boolean field's chip summarizes its value (Pinned only / Unpinned only)", () => {
    renderBar({ pinned: true });
    expect(screen.getByText("Pinned only")).toBeInTheDocument();
  });

  test("a date range's chip summarizes both bounds", () => {
    renderBar({ dateFrom: "2026-07-01T00:00:00.000Z", dateTo: "2026-07-10T00:00:00.000Z" });
    expect(screen.getByText("2026-07-01 – 2026-07-10")).toBeInTheDocument();
  });
});

describe("RunFilterBar — the + Filter add flow", () => {
  // design-remediation T8: the lifecycle synonyms collapsed to two (Status + Outcome). "Stop reason"
  // and "Phase" are no longer OFFERED in "+ Filter" (folded into Status), and the redundant "Kind"
  // (providerKind) filter is gone entirely (the toolbar's single/suite "Type" facet keeps that axis).
  test("every addable RunFilter field is offered when unset (T8: no Stop reason / Phase / Kind)", async () => {
    renderBar({});
    openViaKeyboard(screen.getByRole("button", { name: "Filter" }));
    for (const label of [
      "Status",
      "Outcome",
      "Model",
      "Server",
      "Environment",
      "Suite",
      "Skill",
      "Date",
      "Score",
      "Cost",
      "Duration",
      "Pinned",
      "Interactive",
      "Feedback",
    ]) {
      expect(await screen.findByRole("menuitem", { name: label })).toBeInTheDocument();
    }
    // The two collapsed lifecycle synonyms and the deleted "Kind" filter are NOT offered.
    expect(screen.queryByRole("menuitem", { name: "Stop reason" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Phase" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Kind" })).not.toBeInTheDocument();
  });

  // T8 — a preset (e.g. "Waiting for you") that sets `phase` still renders a REMOVABLE chip even
  // though "+ Filter" no longer offers Phase: a preset constraint must never filter invisibly.
  test("a preset-set phase still renders a removable chip (never a silent filter)", () => {
    const { onChange } = renderBar({ phase: ["waiting_input"] });
    expect(screen.getByText("Phase")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove Phase filter" }));
    expect(onChange).toHaveBeenCalledWith({ phase: undefined });
  });

  test("an ALREADY-active field is not offered again in + Filter", async () => {
    renderBar({ pinned: true });
    openViaKeyboard(screen.getByRole("button", { name: "Filter" }));
    expect(await screen.findByRole("menuitem", { name: "Interactive" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Pinned" })).not.toBeInTheDocument();
  });

  test("selecting a field from + Filter opens its editor as a new chip", async () => {
    renderBar({});
    openViaKeyboard(screen.getByRole("button", { name: "Filter" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Outcome" }));
    // The chip appears immediately (mid-add, no value yet) with its checklist editor visible.
    expect(await screen.findByRole("checkbox", { name: "Completed" })).toBeInTheDocument();
    expect(screen.getByText("Outcome")).toBeInTheDocument();
  });

  test("checking a multi-select option calls onChange with the field set", async () => {
    const { onChange } = renderBar({});
    openViaKeyboard(screen.getByRole("button", { name: "Filter" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Status" }));
    const completedCheckbox = await screen.findByRole("checkbox", { name: "Completed" });
    fireEvent.click(completedCheckbox);
    expect(onChange).toHaveBeenCalledWith({ status: ["completed"] });
  });
});

// Observability WP 2.5 (D-OB15) — the `feedback` field's editor was WIRED by WP 2.3 against the
// WP1.5 `RunFilter.feedback` contract before this WP's console UI existed to WRITE any feedback; this
// WP is the "verify end-to-end" the plan calls for — the field round-trips a real filter object.
describe("RunFilterBar — the feedback field (WP 2.5, D-OB15 — feed filter end-to-end)", () => {
  test("an active feedback filter renders a summarizing chip", () => {
    renderBar({ feedback: { key: "verdict", hasScore: true } });
    expect(screen.getByText("Feedback")).toBeInTheDocument();
    expect(screen.getByText("verdict, scored")).toBeInTheDocument();
  });

  test("hasScore alone (no key) summarizes as just 'scored'", () => {
    renderBar({ feedback: { hasScore: true } });
    expect(screen.getByText("scored")).toBeInTheDocument();
  });

  test("setting the key via the field editor calls onChange with RunFilter.feedback.key", async () => {
    const { onChange } = renderBar({});
    openViaKeyboard(screen.getByRole("button", { name: "Filter" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Feedback" }));
    const keyInput = await screen.findByLabelText("Feedback key (optional)");
    fireEvent.change(keyInput, { target: { value: "verdict" } });
    fireEvent.blur(keyInput);
    expect(onChange).toHaveBeenCalledWith({ feedback: { key: "verdict", hasScore: undefined } });
  });

  test("toggling 'Has a feedback score' calls onChange with RunFilter.feedback.hasScore", async () => {
    const { onChange } = renderBar({});
    openViaKeyboard(screen.getByRole("button", { name: "Filter" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Feedback" }));
    const scoreSwitch = await screen.findByLabelText("Has a feedback score");
    fireEvent.click(scoreSwitch);
    expect(onChange).toHaveBeenCalledWith({
      feedback: { key: undefined, hasScore: true },
    });
  });

  test("removing the Feedback chip clears JUST that field, preserving the rest", () => {
    const { onChange } = renderBar({
      feedback: { key: "verdict", hasScore: true },
      pinned: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "Remove Feedback filter" }));
    expect(onChange).toHaveBeenCalledWith({ feedback: undefined, pinned: true });
  });
});

// Owner-requested — "needs attention" is a FILTERABLE property (the removed feed card's replacement).
// The boolean chip mirrors `interactiveOnly`: adding it + toggling on sets `needsAttention:true`.
describe("RunFilterBar — the needsAttention field (owner-requested)", () => {
  test("an active needsAttention filter renders a labeled, removable chip", () => {
    renderBar({ needsAttention: true });
    expect(screen.getByText("Needs attention")).toBeInTheDocument();
    expect(screen.getByText("Only")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove Needs attention filter" }),
    ).toBeInTheDocument();
  });

  test("it is offered in + Filter when unset", async () => {
    renderBar({});
    openViaKeyboard(screen.getByRole("button", { name: "Filter" }));
    expect(await screen.findByRole("menuitem", { name: "Needs attention" })).toBeInTheDocument();
  });

  test("selecting it and toggling the switch sets needsAttention:true", async () => {
    const { onChange } = renderBar({});
    openViaKeyboard(screen.getByRole("button", { name: "Filter" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Needs attention" }));
    const toggle = await screen.findByLabelText("Needs attention only");
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith({ needsAttention: true });
  });

  test("removing the chip clears JUST that field, preserving the rest", () => {
    const { onChange } = renderBar({ needsAttention: true, pinned: true });
    fireEvent.click(screen.getByRole("button", { name: "Remove Needs attention filter" }));
    expect(onChange).toHaveBeenCalledWith({ needsAttention: undefined, pinned: true });
  });
});

// RM-17 Phase 6 (AM-OB12) — the auto-rating dimensions. The verdicts RM-06's always-on base graders
// record were reachable from a run's Report tab and nowhere else: they could not narrow the feed, and
// therefore could not be a chart's numerator either. These four chips are the reach.
describe("RunFilterBar — the auto-rating dimensions (AM-OB12)", () => {
  test("all four are offered in + Filter, under their own Rating group", async () => {
    renderBar({});
    openViaKeyboard(screen.getByRole("button", { name: "Filter" }));
    for (const label of ["Answer", "Insight", "Root cause", "Fix target"]) {
      expect(await screen.findByRole("menuitem", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByText("Rating")).toBeInTheDocument();
  });

  test("an active verdict filter renders a labeled, removable chip with its values spelled out", () => {
    renderBar({ answerVerdict: ["unanswered", "partial"] });
    expect(screen.getByText("Answer")).toBeInTheDocument();
    expect(screen.getByText("Unanswered, Partial")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Answer filter" })).toBeInTheDocument();
  });

  test("the id-shaped vocabularies get readable labels, not title-cased ids", () => {
    renderBar({ errorBucket: ["mcp_server", "provider_infra"], errorFixTarget: ["none"] });
    expect(screen.getByText("MCP server, Provider infra")).toBeInTheDocument();
    expect(screen.getByText("No actionable fix")).toBeInTheDocument();
    // The raw ids must not leak into the chip.
    expect(screen.queryByText(/mcp_server/)).not.toBeInTheDocument();
  });

  test("checking a verdict option sets the field on RunFilter", async () => {
    const { onChange } = renderBar({});
    openViaKeyboard(screen.getByRole("button", { name: "Filter" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Answer" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Unanswered" }));
    expect(onChange).toHaveBeenCalledWith({ answerVerdict: ["unanswered"] });
  });

  test("checking a root-cause option sets errorBucket with the underlying id", async () => {
    const { onChange } = renderBar({});
    openViaKeyboard(screen.getByRole("button", { name: "Filter" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Root cause" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "MCP server" }));
    expect(onChange).toHaveBeenCalledWith({ errorBucket: ["mcp_server"] });
  });

  test("removing a rating chip clears JUST that field", () => {
    const { onChange } = renderBar({ insightVerdict: ["noise"], pinned: true });
    fireEvent.click(screen.getByRole("button", { name: "Remove Insight filter" }));
    expect(onChange).toHaveBeenCalledWith({ insightVerdict: undefined, pinned: true });
  });

  test("the four are offered separately from Score — a verdict is not an expectation grade (AR6)", async () => {
    // `Score` filters the expectation graders' 0–1 scores; these filter the base-rating verdicts,
    // which AR6 keeps out of `meanGrade`/`passRateAt05` entirely. Two groups, deliberately.
    renderBar({});
    openViaKeyboard(screen.getByRole("button", { name: "Filter" }));
    expect(await screen.findByRole("menuitem", { name: "Score" })).toBeInTheDocument();
    expect(await screen.findByRole("menuitem", { name: "Answer" })).toBeInTheDocument();
  });

  test("a rating filter round-trips through the feed's ?filter= param unchanged", () => {
    // The chips are only useful if the resulting URL is shareable. This goes through the SAME codec
    // the feed uses, so a byte-stability regression here shows up as a failing round-trip rather
    // than as a link that silently drops the verdict.
    const filter: RunFilter = {
      answerVerdict: ["unanswered"],
      insightVerdict: ["noise", "valuable"],
      errorBucket: ["skill", "mcp_server"],
      errorFixTarget: ["skill"],
      status: ["completed"],
    };
    const params = writeFilterToSearchParams(new URLSearchParams(), filter);
    expect(parseFilterFromSearchParams(params)).toEqual(filter);
    // …and byte-stable regardless of key order, so two people building the same filter share the
    // same link.
    const reordered = writeFilterToSearchParams(new URLSearchParams(), {
      status: ["completed"],
      errorFixTarget: ["skill"],
      errorBucket: ["skill", "mcp_server"],
      insightVerdict: ["noise", "valuable"],
      answerVerdict: ["unanswered"],
    });
    expect(reordered.toString()).toBe(params.toString());
  });
});
