/**
 * active-nav-contrast.guardrail — the active sidebar item must carry an ACCENT cue, not a grey wash.
 *
 * THE DEFECT THIS GUARDS. The library's default active state was `bg-sidebar-accent` with unchanged
 * label ink: 1.17:1 in light, 1.29:1 in dark. WCAG 1.4.11 wants ≥3:1 for a non-text state indicator,
 * and a same-grey wash gives a keyboard or low-vision operator nothing to lock onto in a 16-item
 * rail. This app added a token-driven accent left-bar plus a semibold label to fix it.
 *
 * WHY THIS TEST CHANGED SHAPE (RM-39 WP 2.5). It used to import this app's own
 * `ACTIVE_NAV_INDICATOR_CLASS` constant and assert strings on it. That constant is gone: brand-ui
 * 4.1.0 took the repair upstream — `SidebarMenuButton` and `SidebarMenuSubButton` now ship the
 * `before:` accent bar and `font-semibold` themselves, filed upstream as defect R1 *with this app's
 * own contrast measurement as the stated reason*. Keeping a local copy would have meant two
 * definitions of one fix.
 *
 * So the assertion moved from a STRING THIS APP OWNS to the CLASS LIST THAT ACTUALLY RENDERS. That
 * is strictly stronger: it now fails if the library ever drops the bar, which the old version could
 * not see, as well as if this app reverts to a wash.
 *
 * Measured, not assumed: `--sidebar-primary` and `--primary` resolve to the SAME value
 * (`oklch(87.5% .148 116.5)`) in both `light` and `dark`, against a sidebar at 30% / 18% lightness —
 * so the upstream bar paints exactly the colour the local one did. That measurement is why the local
 * constant could be deleted rather than merely retired.
 *
 * jsdom has no layout or contrast engine (see `AppShell.test.tsx`'s note), so this asserts the cue
 * STRUCTURALLY, on the rendered element's classes.
 */
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("../features/notifications/NotificationBell", () => ({ NotificationBell: () => null }));

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

import { AppShell } from "../components/AppShell";

/** The rendered class list of the nav item for the current route. */
function activeNavClassName(): string {
  const { container } = render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <AppShell themePreference="light" onThemePreferenceChange={() => {}}>
        <div>content</div>
      </AppShell>
    </MemoryRouter>,
  );
  const active = container.querySelector<HTMLElement>('[data-active="true"]');
  expect(active, "no nav item rendered with data-active=true").not.toBeNull();
  return active?.className ?? "";
}

describe("GUARDRAIL — active nav uses an ACCENT cue, not a grey wash (WCAG 1.4.11)", () => {
  it("marks the active state on the data-attribute the sidebar sets", () => {
    expect(activeNavClassName()).toContain("data-[active=true]:");
  });

  it("draws an accent BAR as the non-text state indicator, anchored to the button", () => {
    const className = activeNavClassName();
    // The bar itself — an accent token, never a second grey.
    expect(className).toMatch(/data-\[active=true\]:before:bg-(sidebar-)?primary/);
    // …with real geometry, so "before:" is not present but invisible.
    expect(className).toMatch(/data-\[active=true\]:before:w-1\b/);
    expect(className).toMatch(/data-\[active=true\]:before:absolute\b/);
    // Anchored: an absolutely-positioned bar needs a positioned ancestor to land on.
    expect(className).toMatch(/\brelative\b/);
  });

  it("weights the active label as a SECOND, non-colour cue", () => {
    expect(activeNavClassName()).toMatch(/data-\[active=true\]:font-(semibold|bold)/);
  });

  it("does not rely on the same-grey wash alone (the 1.17:1 default this replaced)", () => {
    const className = activeNavClassName();
    // The wash may still be present as a supporting cue — what must NOT happen is the wash being
    // the ONLY thing that changes. The accent-bar assertion above is what enforces that; this pins
    // the complementary half: a wash without a bar is the regression.
    const hasWash = /data-\[active=true\]:bg-sidebar-accent/.test(className);
    const hasBar = /data-\[active=true\]:before:bg-(sidebar-)?primary/.test(className);
    expect(hasWash && !hasBar, "active state fell back to a grey wash with no accent bar").toBe(
      false,
    );
  });
});
