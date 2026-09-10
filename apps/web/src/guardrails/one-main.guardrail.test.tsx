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
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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

const __dirname = dirname(fileURLToPath(import.meta.url));

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

/**
 * The shell WITH the assistant dock mounted — the arrangement the landmark rule below governs.
 *
 * The viewport must be WIDE. `SideDock` reads `useIsMobile(overlayBreakpoint)`, and below the dock's
 * own 1100px breakpoint it renders as an overlay sheet in a portal instead of a column — correct
 * behaviour, but a portal lives outside the render container and is trivially outside `main` anyway.
 * The nesting rule only has teeth on the COLUMN branch, so the harness forces it.
 */
function renderShellWithDock() {
  window.innerWidth = 1600;
  return render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <AppShell
        themePreference="light"
        onThemePreferenceChange={() => {}}
        dockAvailable
        dockOpen
        dockContent={<div data-testid="dock-content">Assistant</div>}
      >
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

  it('names the primary navigation landmark <nav aria-label="Sections">', () => {
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

describe("GUARDRAIL RM-39 WP 2.4 — the assistant dock is BESIDE <main>, never inside it", () => {
  /**
   * A `complementary` landmark nested inside the `main` landmark is the defect this closes. It
   * shipped for as long as the dock existed: the `<aside aria-label="App assistant">` was rendered
   * inside `SidebarInset`, which IS the app's single `<main>`. A screen-reader user moving by
   * landmark then finds the assistant *within* the page content rather than alongside it, and
   * "skip to main content" lands them in a region that contains the chat.
   *
   * brand-ui 4.1.0's flagship app-shell block — ported from THIS app — calls the mistake out at its
   * own dock call site, which is how it was found.
   */
  it("renders NO complementary landmark inside the main landmark", () => {
    const { container } = renderShellWithDock();
    const main = container.querySelector("main");
    expect(main, "the shell must still have its single <main>").not.toBeNull();

    // Component-agnostic on purpose. The first version of this looked for
    // `aside[aria-label="App assistant"]`, which was the hand-rolled dock's own markup; when the
    // dock moved onto the library's `SideDock` that selector stopped matching (it labels its aside
    // with `aria-labelledby`) and the guardrail went green for the wrong reason — it was asserting
    // about an element that no longer existed. The invariant was never about THAT aside: no
    // complementary landmark may sit inside the main landmark, whoever renders it.
    const asides = [...container.querySelectorAll("aside")];
    expect(
      asides.length,
      "the dock must be mounted when dockAvailable + dockContent are given",
    ).toBeGreaterThan(0);
    const nested = asides.filter((aside) => main?.contains(aside));
    expect(
      nested.length,
      "a complementary landmark (<aside>) is rendered inside <main> — it must be a sibling",
    ).toBe(0);
  });

  it("still has exactly one <main> once the dock is mounted", () => {
    const { container } = renderShellWithDock();
    expect(container.querySelectorAll("main").length).toBe(1);
  });

  it("keeps the dock content reachable — moving it out must not unmount it", () => {
    const { getByTestId } = renderShellWithDock();
    expect(getByTestId("dock-content")).toBeTruthy();
  });
});

describe("GUARDRAIL RM-39 WP 2.3 — the dock hands its content the whole column", () => {
  /**
   * `SideDock`'s body ships `p-4` and `overflow-y-auto`, which is right for the document-ish dock its
   * own demo shows (details, alerts, runbooks). It is wrong for this one: `AssistantDock` mounts a
   * `ChatShell` that already pads its conversation `p-4` and owns its own transcript scroll while
   * floating the composer over it.
   *
   * Left alone the two stacked: ~32px of padding on each side the transcript paid for twice — which
   * is what made its type look oversized for the column — and a second scroll container that could
   * scroll the composer out of view.
   *
   * WHAT THIS CAN AND CANNOT SEE. The overrides are arbitrary DESCENDANT variants on the dock's own
   * element, so they win by specificity ((0,2,0) — a class plus an attribute — against upstream's
   * (0,1,0) utility) rather than by rewriting the body's class list. The body still carries `p-4` in
   * its `className`; the rule simply beats it. jsdom applies no CSS, so this asserts the override is
   * DECLARED where it has to be. Whether it actually paints is a browser question, and it is on the
   * RM-39 ledger as one.
   */
  it("declares the padding and overflow overrides on the dock element", () => {
    const { container } = renderShellWithDock();
    const dock = container.querySelector<HTMLElement>('[data-slot="side-dock-container"]');
    const scope = dock?.closest("[class]") as HTMLElement | null;
    const declared = `${dock?.className ?? ""} ${scope?.className ?? ""}`;

    expect(dock, "the dock must render as a column at this viewport").not.toBeNull();
    // The conversation pads itself; the dock body must not pad it a second time.
    expect(declared).toContain("[&_[data-slot=side-dock-body]]:p-0");
    // ChatShell owns the transcript scroll — a second scroll port takes the composer with it.
    expect(declared).toContain("[&_[data-slot=side-dock-body]]:overflow-hidden");
  });

  it("keeps the dock content mounted through all of it", () => {
    const { getByTestId } = renderShellWithDock();
    expect(getByTestId("dock-content")).toBeTruthy();
  });
});

describe("GUARDRAIL RM-39 — the dock's top rows line up with the app's top rows", () => {
  /**
   * The dock sits beside the page, so its two chrome rows and the app's two chrome rows share a
   * horizontal rule across the window. They line up only if they use the SAME height utilities:
   * the dock header against `TopNav`, the thread bar against the page toolbar.
   *
   * This asserts the RELATIONSHIP, not a pixel value — it reads the utility off `TopNav` as rendered
   * and requires the dock's override to name that same one. A previous cut of this override used a
   * smaller ad-hoc padding, which left the dock's header a few pixels short of the bar beside it;
   * pinning a number would not have caught that, because the number was never the point.
   *
   * (Measured once, for the record: `h-14` paints 46px and `min-h-12` paints 39px at this app's
   * density. Those are consequences of the utilities, not inputs to this test.)
   */
  it("pins the dock header to the same height utility TopNav uses", () => {
    const { container } = renderShellWithDock();

    const header = container.querySelector("header");
    const topNavHeight = header?.className.toString().match(/\bh-\d+\b/)?.[0];
    expect(
      topNavHeight,
      "TopNav must carry an explicit height utility to match against",
    ).toBeTruthy();

    const dock = container.querySelector<HTMLElement>('[data-slot="side-dock-container"]');
    const scope = `${dock?.className ?? ""} ${(dock?.closest("[class]") as HTMLElement | null)?.className ?? ""}`;
    expect(
      scope,
      `the dock header must use TopNav's own height utility (${topNavHeight}) so the two rules align`,
    ).toContain(`[&_[data-slot=side-dock-header]]:${topNavHeight}`);
  });

  it("pins the dock's thread bar to the page toolbar's height utility", () => {
    // The bar lives inside the dock CONTENT, which this harness stubs, so the assertion is made
    // against the source that renders it rather than the DOM.
    const dockSource = readFileSync(
      join(__dirname, "..", "features", "assistant", "AssistantDock.tsx"),
      "utf8",
    );
    // The bar must mirror the page toolbar's BAND recipe, not just borrow one of its utilities:
    // an outer band with `border-b` + `py-2`, and a `min-h-12` row inside. Measured on the running
    // app, that is what makes the toolbar 53px — a 39px row plus 13px of padding. A bare `min-h-12`
    // band is 39px and leaves a visible 14px gap between the two rules; `h-14` makes it a second
    // header. Both of those shipped before this assertion existed.
    expect(
      dockSource,
      "the thread bar's outer band must carry `border-b` + `py-2`, like the page toolbar's band",
    ).toMatch(/className="shrink-0 border-b border-border px-3 py-2"/);
    expect(
      dockSource,
      "…with a `min-h-12` row inside it — the toolbar's own inner row height",
    ).toMatch(/className="flex min-h-12 items-center"/);
  });
});
