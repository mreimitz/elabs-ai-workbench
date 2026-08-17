/**
 * one-main.guardrail.test.tsx — interface-craft WP 4.1 guardrail (D-IC4).
 *
 * The CI guardrail that keeps the shell to EXACTLY ONE `<main>` landmark. It renders the real
 * `AppShell` (the same harness the WP 0.3 phase test uses) and asserts the landmark invariant that
 * finding 3 fixed: one `<main>`, a NAMED primary navigation landmark, and the skip link as the very
 * first focusable element. A second `<main>` (the exact regression D-IC4 closed — `SidebarInset`'s
 * `<main>` nested inside the app-shell `<main>`) makes `querySelectorAll('main').length` return 2 and
 * this guardrail goes RED.
 *
 * This is additive to `apps/web/src/components/AppShell.test.tsx` (the WP 0.3 phase deliverable this
 * WP may not edit); the phase test locks the fix, this guardrail keeps it from drifting back.
 * jsdom has no layout engine, so — per conventions §2 — only DOM-settleable facts are asserted here
 * (landmark counts, nav name, focus ORDER); the visual/keyboard-traversal claims are PM live-app work.
 */
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

// NotificationBell (in the TopNav) fetches + opens an SSE stream on mount — neither exists under
// jsdom and neither is under test here. Stub it to an inert node so the render stays hermetic; it is
// a different region and does not touch the main/nav/skip-link structure this guardrail asserts.
vi.mock("../features/notifications/NotificationBell", () => ({
  NotificationBell: () => null,
}));

// jsdom omits matchMedia, which @elabs-ai/components-ui's useIsMobile (SidebarProvider) reads. matches:false + the
// default 1024px innerWidth keep the shell in DESKTOP layout (the mobile Sheet branches don't render).
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

/** Standard focusable set in document order, excluding programmatic-only (`tabindex=-1`) targets
 *  such as the `<main>` skip destination and disabled controls. */
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
      <AppShell themePreference="light" onThemePreferenceChange={() => {}}>
        <div data-testid="page-content">Dashboard content</div>
      </AppShell>
    </MemoryRouter>,
  );
}

describe("GUARDRAIL D-IC4 — the shell renders exactly one <main>", () => {
  it("has precisely ONE <main> landmark (a second nested <main> is the regression this catches)", () => {
    const { container } = renderShell();
    const mains = container.querySelectorAll("main");
    expect(mains.length, `expected exactly 1 <main>, found ${mains.length}`).toBe(1);
  });

  it("that single <main> is the skip-link target (#main-content, programmatically focusable)", () => {
    const { container } = renderShell();
    const main = container.querySelector<HTMLElement>("main");
    expect(main?.id).toBe("main-content");
    expect(main).toHaveAttribute("tabindex", "-1");
  });

  it("names the primary navigation landmark <nav aria-label=\"Sections\">", () => {
    const { getByRole } = renderShell();
    const nav = getByRole("navigation", { name: "Sections" });
    expect(nav.tagName).toBe("NAV");
  });

  it("the skip link is the FIRST focusable element and targets the single <main>", () => {
    const { container } = renderShell();
    const focusables = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    expect(focusables.length).toBeGreaterThan(1);
    const first = focusables[0] as HTMLElement;
    expect(first.tagName).toBe("A");
    expect(first).toHaveTextContent("Skip to content");
    expect(first).toHaveAttribute("href", "#main-content");
    expect(focusables.indexOf(first)).toBe(0);
  });
});
