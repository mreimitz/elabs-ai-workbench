import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { Select, SelectContent, SelectItem, SelectValue } from "@elabs-ai/components-ui";
import { TitledSelectTrigger } from "./TitledSelectTrigger";

// Locks the D-IC10 fix (interface-craft WP 2.1, `roadmap/interface-craft/upstream-gaps.md` #4):
// @elabs-ai/components-ui's `SelectTrigger` clips its value with no recovery. `TitledSelectTrigger` derives the
// trigger's `title` from a single `selectedLabel` prop so the recovery can't be forgotten, and
// optionally pairs it with a `HoverCard` for a user-authored value (the `AgentBriefPreview`
// pattern).
//
// The trigger's own visible content ("Selected") is deliberately a SHORT, DIFFERENT string from
// `selectedLabel` (the long/composed value being recovered) so assertions on the recovery text
// can't accidentally match the trigger's own clamped display.
function renderSelect(selectedLabel: string | undefined, hoverCard = false) {
  return render(
    <Select value="a" onValueChange={() => {}}>
      <TitledSelectTrigger selectedLabel={selectedLabel} hoverCard={hoverCard}>
        <SelectValue placeholder="Choose…">Selected</SelectValue>
      </TitledSelectTrigger>
      <SelectContent>
        <SelectItem value="a">Option A</SelectItem>
      </SelectContent>
    </Select>,
  );
}

describe("TitledSelectTrigger — D-IC10 select-value recovery", () => {
  test("a selected value's full text is exposed via the trigger's `title`", () => {
    renderSelect("acme-server · 2026-07-01 · 42 tools");
    const trigger = screen.getByRole("combobox");
    expect(trigger).toHaveAttribute("title", "acme-server · 2026-07-01 · 42 tools");
  });

  test("no selection yet (`selectedLabel` undefined) sets no `title` — a placeholder needs no recovery", () => {
    renderSelect(undefined);
    const trigger = screen.getByRole("combobox");
    expect(trigger).not.toHaveAttribute("title");
  });

  test("hoverCard is OFF by default — the recovery text is never mounted as a popover", () => {
    renderSelect("A very long composed select label that clips");
    // The `title` attribute carries the recovery; no visible DOM text node repeats it.
    expect(
      screen.queryByText("A very long composed select label that clips"),
    ).not.toBeInTheDocument();
  });

  test("hoverCard=true reveals the full value in a HoverCard on hover (AgentBriefPreview pattern)", async () => {
    renderSelect("A very long user-authored value that clips in the trigger", true);
    const trigger = screen.getByRole("combobox");
    // Still recoverable via `title` even with the HoverCard also wired.
    expect(trigger).toHaveAttribute(
      "title",
      "A very long user-authored value that clips in the trigger",
    );
    fireEvent.pointerEnter(trigger);
    await waitFor(() =>
      expect(
        screen.getByText("A very long user-authored value that clips in the trigger"),
      ).toBeInTheDocument(),
    );
  });

  test("hoverCard=true with no selection yet wires no recovery at all (nothing to recover)", () => {
    renderSelect(undefined, true);
    const trigger = screen.getByRole("combobox");
    expect(trigger).not.toHaveAttribute("title");
    fireEvent.pointerEnter(trigger);
    // No crash and no stray popover content mounts for an empty selection.
    expect(trigger).toBeInTheDocument();
  });
});
