/**
 * touch-target.guardrail.test.tsx — P0 mobile audit T4 guardrail
 * (`.impeccable/critique/2026-07-25T20-00-10Z__127-0-0-1.md`).
 *
 * Locks the pointer-coarse 44×44 touch-target floor on `IconButton` — the one shared icon-only
 * control primitive (D-TB5, `icon-affordances.md`). Measured live at 390px: 270 of 465 interactive
 * elements were under 44×44, 94 of those under even the WCAG 2.2 24×24 AA floor (the shell's own
 * "Toggle Sidebar" measured 23×23 — that one is a sibling task's fix in `AppShell.tsx`, out of scope
 * here).
 *
 * jsdom has no layout engine (per conventions §2 — only DOM-settleable facts belong in a guardrail),
 * so this asserts the CLASS CONTRACT rather than a measured pixel box: every `IconButton` — regardless
 * of its `size` prop, and regardless of any caller-supplied `className` — carries the
 * `[@media(pointer:coarse)]:min-h-11` / `min-w-11` pair. `min-height`/`min-width` always win over a
 * smaller `width`/`height` per the CSS box model, so a rendered box is provably ≥44×44 CSS px whenever
 * the OS reports a coarse (touch) pointer, no live layout measurement needed to prove the contract.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { TooltipProvider } from "@elabs-ai/components-ui";
import { RefreshCw } from "lucide-react";
import { IconButton } from "../components/IconButton";

function renderIconButton(ui: React.ReactNode) {
  return render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);
}

describe("GUARDRAIL P0-T4 — IconButton floors to 44×44 under a coarse (touch) pointer", () => {
  test("the default (icon, 36px base) size carries the pointer-coarse min-h-11/min-w-11 pair", () => {
    renderIconButton(
      <IconButton label="Refresh">
        <RefreshCw aria-hidden />
      </IconButton>,
    );
    const btn = screen.getByRole("button", { name: "Refresh" });
    expect(btn.className).toContain("[@media(pointer:coarse)]:min-h-11");
    expect(btn.className).toContain("[@media(pointer:coarse)]:min-w-11");
  });

  test("the smaller icon-sm size (32px base) ALSO carries the floor", () => {
    renderIconButton(
      <IconButton label="Refresh" size="icon-sm">
        <RefreshCw aria-hidden />
      </IconButton>,
    );
    const btn = screen.getByRole("button", { name: "Refresh" });
    expect(btn.className).toContain("[@media(pointer:coarse)]:min-h-11");
    expect(btn.className).toContain("[@media(pointer:coarse)]:min-w-11");
  });

  test("a caller-supplied className merges alongside the floor rather than replacing it", () => {
    renderIconButton(
      <IconButton label="Refresh" className="shrink-0">
        <RefreshCw aria-hidden />
      </IconButton>,
    );
    const btn = screen.getByRole("button", { name: "Refresh" });
    expect(btn.className).toContain("shrink-0");
    expect(btn.className).toContain("[@media(pointer:coarse)]:min-h-11");
    expect(btn.className).toContain("[@media(pointer:coarse)]:min-w-11");
  });

  test("a disabled button (still a real touch target via the wrapper span) also carries the floor", () => {
    renderIconButton(
      <IconButton label="Export" disabled disabledReason="Add a second run first.">
        <RefreshCw aria-hidden />
      </IconButton>,
    );
    const btn = screen.getByRole("button", { name: "Export" });
    expect(btn.className).toContain("[@media(pointer:coarse)]:min-h-11");
    expect(btn.className).toContain("[@media(pointer:coarse)]:min-w-11");
  });
});
