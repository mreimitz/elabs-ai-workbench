/**
 * active-nav-contrast.guardrail.test.ts — design-remediation T5 (item 4) guardrail.
 *
 * The active sidebar item used to be a 1.17:1 grey wash in qlik-bright (1.29:1 in dark) with the
 * SAME text color as inactive items — WCAG 1.4.11 wants ≥3:1 for a non-text state indicator, and a
 * same-grey wash gives a keyboard / low-vision operator nothing to lock onto in a 16-item rail. The
 * fix layers a token-driven ACCENT left-bar (`bg-primary` against `bg-sidebar` — high-contrast in
 * BOTH themes) plus a semibold label, via the exported `ACTIVE_NAV_INDICATOR_CLASS`.
 *
 * This asserts the cue STRUCTURALLY (jsdom has no layout/contrast engine — see AppShell.test.tsx's
 * note): the class rides the active data-attribute, uses an accent (primary) border cue, and does
 * NOT lean on another grey wash. If a future change reverted the active state to a grey-only wash,
 * this goes RED.
 */
import { describe, expect, it } from "vitest";
import { ACTIVE_NAV_INDICATOR_CLASS } from "../components/AppShell";

describe("GUARDRAIL — active nav uses an ACCENT cue, not a grey wash (WCAG 1.4.11)", () => {
  it("marks only the active state (rides the SidebarMenuButton `data-active` attribute)", () => {
    expect(ACTIVE_NAV_INDICATOR_CLASS).toContain("data-[active=true]:");
  });

  it("uses an accent (primary) border bar as the non-text state indicator", () => {
    // The accent left-bar: bg-primary is high-contrast against bg-sidebar in BOTH themes — this is
    // the WCAG-1.4.11-satisfying non-text indicator, not a same-grey background.
    expect(ACTIVE_NAV_INDICATOR_CLASS).toContain("before:bg-primary");
    // It must be anchored (relative) so the absolutely-positioned bar lands on the button.
    expect(ACTIVE_NAV_INDICATOR_CLASS).toContain("relative");
  });

  it("does not lean on a same-grey wash (the 1.17:1 default this replaced)", () => {
    for (const wash of ["bg-sidebar-accent", "bg-muted", "bg-accent"]) {
      expect(ACTIVE_NAV_INDICATOR_CLASS).not.toContain(wash);
    }
  });

  it("weights the active label as a secondary, non-color cue", () => {
    expect(ACTIVE_NAV_INDICATOR_CLASS).toContain("font-semibold");
  });
});
