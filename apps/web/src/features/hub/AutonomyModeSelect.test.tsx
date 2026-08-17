import type { HubAutonomyLevel } from "@mcp-token-footprint/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

// The trigger is a `@elabs-ai/components-ai` `PromptInputButton` (footer styling); mock the heavy `@elabs-ai/components-ai`
// barrel exactly as every other hub suite does. The `@elabs-ai/components-ui` `Popover`/`Button` stay REAL — the
// real Radix Popover renders fine under jsdom (proven by FeedbackControl/NotificationBell tests).
vi.mock("@elabs-ai/components-ai", () => import("./test-support/brand-ai-mock"));

import { AUTONOMY_TOOLTIP, AutonomyModeSelect } from "./AutonomyModeSelect";

function renderSelect(
  value: HubAutonomyLevel,
  onChange = vi.fn<(next: HubAutonomyLevel) => void>(),
) {
  render(<AutonomyModeSelect value={value} onChange={onChange} />);
  return onChange;
}

describe("AutonomyModeSelect", () => {
  // hub-fixes WP6.2 (RC7) — the trigger's accessible name carries an explicit "Autonomy:" prefix (never
  // a bare "Threshold"/"Auto"/…), so it can't be misread as the SESSION mode. owner-feedback
  // (2026-07-26): the chip is ICON-ONLY now — the level lives in the aria-label + tooltip, not visible
  // text — so these assert the accessible NAME, which is the query handle the composer/view tests use.
  test("the trigger's accessible name carries the 'Autonomy:' prefix + the current level", () => {
    renderSelect("threshold");
    expect(
      screen.getByRole("button", { name: "Autonomy: Ask above a threshold" }),
    ).toBeInTheDocument();
  });

  test("the trigger's accessible name updates with the active level (auto)", () => {
    renderSelect("auto");
    expect(screen.getByRole("button", { name: "Autonomy: Auto" })).toBeInTheDocument();
  });

  // hub-fixes WP6.2 — the hover tooltip now enumerates all three levels (not a one-line summary), so
  // hovering alone (without opening the popover) already disambiguates this chip from the mode chip.
  test("the tooltip describes all three autonomy levels", () => {
    expect(AUTONOMY_TOOLTIP).toMatch(/Ask every time/);
    expect(AUTONOMY_TOOLTIP).toMatch(/Ask above a threshold/);
    expect(AUTONOMY_TOOLTIP).toMatch(/Auto/);
    // And the actual per-level explanations, not just the labels bare.
    expect(AUTONOMY_TOOLTIP).toMatch(/every tool that can change something/i);
    expect(AUTONOMY_TOOLTIP).toMatch(/read-only tools on trusted servers/i);
  });

  test("opening the menu lists all three levels with the active one marked current", async () => {
    renderSelect("auto");
    fireEvent.click(screen.getByRole("button", { name: "Autonomy: Auto" }));

    // The active level (auto) is marked aria-current; the others are not. `\b` after the label keeps
    // the auto row's name (`/^Auto\b/`) from matching the trigger's "Autonomy: Auto".
    expect(await screen.findByRole("button", { name: /^Auto\b/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByRole("button", { name: /^Ask every time\b/ })).not.toHaveAttribute(
      "aria-current",
    );
    // Each row surfaces its one-line hint, and the hard-cap invariant is always shown.
    expect(screen.getByText(/Every tool that can change something/)).toBeInTheDocument();
    expect(screen.getByText(/Hard budget caps are always enforced/)).toBeInTheDocument();
  });

  test("selecting a different level fires onChange with that level — NO functional change from the relabel", async () => {
    const onChange = renderSelect("always_ask");
    fireEvent.click(screen.getByRole("button", { name: "Autonomy: Ask every time" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Ask above a threshold\b/ }));
    expect(onChange).toHaveBeenCalledWith("threshold");
  });

  test("disabled disables the trigger", () => {
    render(<AutonomyModeSelect value="auto" onChange={vi.fn()} disabled />);
    expect(screen.getByRole("button", { name: "Autonomy: Auto" })).toBeDisabled();
  });
});
