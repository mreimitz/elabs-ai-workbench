import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

// Interface-craft WP 0.3 (D-IC4 / interface-review finding 3) — the shell landmark + skip-link
// fixes, asserted against a real jsdom render of the WHOLE `AppShell` tree (the first render harness
// for it in the repo; the sibling `AppShell.test.ts` only exercises the nav SHAPE as pure data).
//
// jsdom has no layout engine and vitest runs with `css: false`, so this file asserts only what the
// DOM can settle: the landmark COUNT, the navigation landmark's accessible NAME, and the skip link's
// position in document order + its target. The VISUAL parts of the acceptance — the skip link being
// invisible until focused, its focus ring reading in both themes, and the true keyboard traversal
// count dropping 22 → 1 — are geometry/AT claims the PM measures against the running app (they are
// impossible under jsdom). See conventions §2.

// `NotificationBell` (rendered in the TopNav) loads notifications over `fetch` + opens an SSE stream
// on mount — neither exists under jsdom and neither is under test here. Stub it to an inert node so
// the render stays hermetic; it's a different region and does not touch the main/nav/skip-link
// structure this WP owns.
vi.mock("../features/notifications/NotificationBell", () => ({
  NotificationBell: () => null,
}));

// jsdom omits `matchMedia`, which `@brand/ui`'s `useIsMobile` (SidebarProvider) reads — mirrors the
// polyfill in ScansView.test / RunsView.test. `matches: false` + the default 1024px innerWidth keep
// the shell in its DESKTOP layout (the mobile Sheet branches don't render).
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

import { AppShell } from "./AppShell";

/** The standard focusable-element set, in document order, excluding programmatic-only (`tabindex=-1`)
 *  targets like the `<main>` skip destination and disabled controls. */
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

function renderShell() {
  return render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <AppShell themePreference="qlik-bright" onThemePreferenceChange={() => {}}>
        <div data-testid="page-content">Dashboard content</div>
      </AppShell>
    </MemoryRouter>,
  );
}

describe("AppShell — shell landmarks + skip link (WP 0.3 / D-IC4)", () => {
  it("renders exactly ONE <main> (was 2 — SidebarInset's + the inner app-shell-main)", () => {
    const { container } = renderShell();
    const mains = container.querySelectorAll("main");
    expect(mains.length).toBe(1);
    // The single <main> is the skip-link target and stays programmatically focusable.
    const main = mains[0] as HTMLElement;
    expect(main.id).toBe("main-content");
    expect(main).toHaveAttribute("tabindex", "-1");
    // The content region (formerly a nested <main>, now a <div>) still carries app-shell-main and
    // still contains the page.
    const contentRegion = container.querySelector("div.app-shell-main");
    expect(contentRegion).not.toBeNull();
    expect(main).toContainElement(contentRegion as HTMLElement);
  });

  it('names the primary navigation landmark <nav aria-label="Sections"> (was an unnamed <div>)', () => {
    const { getByRole } = renderShell();
    const nav = getByRole("navigation", { name: "Sections" });
    expect(nav.tagName).toBe("NAV");
    // The nav is the app's real navigation — it contains the section links (e.g. Dashboard).
    expect(nav.querySelector('a[href="/dashboard"]')).not.toBeNull();
  });

  it("makes the skip link the FIRST focusable element, targeting the single <main>", () => {
    const { container } = renderShell();
    const focusables = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    // There ARE focusables in the shell (sidebar links, TopNav controls) — the point is the skip
    // link precedes every one of them.
    expect(focusables.length).toBeGreaterThan(1);
    const first = focusables[0] as HTMLElement;
    expect(first.tagName).toBe("A");
    expect(first).toHaveTextContent("Skip to content");
    // It targets the single <main> by id.
    expect(first).toHaveAttribute("href", "#main-content");
    const main = container.querySelector("main");
    expect(main?.id).toBe("main-content");
    // "focusables before the first content element = 1": exactly the skip link precedes everything
    // reachable, i.e. ZERO focusables come before it in document order.
    expect(focusables.indexOf(first)).toBe(0);
    // …and the skip link sits BEFORE the sidebar's own nav links (a genuine bypass, not an
    // afterthought appended to the end): the first section link comes LATER in tab order.
    const firstNavLink = container.querySelector<HTMLElement>('nav[aria-label="Sections"] a[href]');
    expect(firstNavLink).not.toBeNull();
    expect(focusables.indexOf(firstNavLink as HTMLElement)).toBeGreaterThan(0);
  });

  it("the skip-link target <main> is programmatically focusable (activation moves focus into it)", () => {
    const { container } = renderShell();
    const main = container.querySelector<HTMLElement>("main#main-content");
    expect(main).not.toBeNull();
    // jsdom does not implement in-page fragment navigation, so exercise the equivalent: the target
    // accepts focus (tabindex=-1), which is what the browser does when the skip link is activated.
    (main as HTMLElement).focus();
    expect(main).toHaveFocus();
  });

  it("does not regress the skip link's token styling (branded, both-theme-safe, visible ring)", () => {
    const { container } = renderShell();
    const skip = container.querySelector<HTMLElement>('a[href="#main-content"]');
    expect(skip).not.toBeNull();
    // Hidden until focused, then revealed — the sr-only / focus:not-sr-only pair.
    expect(skip?.className).toContain("sr-only");
    expect(skip?.className).toContain("focus:not-sr-only");
    // Semantic tokens only (reads in both themes) + a visible focus ring. No raw color literals.
    expect(skip?.className).toContain("bg-primary");
    expect(skip?.className).toContain("text-primary-foreground");
    expect(skip?.className).toContain("focus-visible:ring-ring");
  });
});
