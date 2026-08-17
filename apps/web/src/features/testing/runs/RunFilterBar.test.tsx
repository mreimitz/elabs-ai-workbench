import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { RunFilter } from "@mcp-token-footprint/shared";
import { TooltipProvider } from "@elabs-ai/components-ui";
import { EMPTY_RUN_FILTER_OPTIONS, RunFilterBar } from "./RunFilterBar";

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
