import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@elabs-ai/components-ai", () => import("./test-support/brand-ai-mock"));

import { EmptySessionIntro } from "./EmptySessionIntro";

// jsdom omits matchMedia; `useReducedMotion` (@elabs-ai/components-tokens) calls it unconditionally on mount (no
// `typeof window.matchMedia === "function"` guard before the call), so every test in this file
// needs a stub — not just the reduced-motion-specific ones. `reducedMotionMatches` lets each test
// control the OS `prefers-reduced-motion` result the hook resolves to.
let reducedMotionMatches = false;

beforeEach(() => {
  reducedMotionMatches = false;
  window.matchMedia = ((query: string) => ({
    matches: reducedMotionMatches,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

function fakeComposer(dockPosition: "centered" | "docked") {
  return <div data-testid="fake-composer">composer:{dockPosition}</div>;
}

describe("EmptySessionIntro (WP1.3, D-HUX13) — state selection", () => {
  test("a fresh session (dockState omitted) opens centered: greeting visible, composer told 'centered'", () => {
    render(<EmptySessionIntro onSelectStarter={vi.fn()} composer={fakeComposer} />);
    expect(screen.getByTestId("empty-session-intro")).toHaveAttribute(
      "data-dock-state",
      "centered",
    );
    const greeting = screen.getByTestId("empty-session-intro-greeting");
    expect(greeting).toHaveAttribute("aria-hidden", "false");
    expect(screen.getByText("What should we dig into?")).toBeInTheDocument();
    expect(screen.getByTestId("fake-composer")).toHaveTextContent("composer:centered");
    // The welcome emblem crowns the centered invitation and runs (not paused) while shown.
    const ring = screen.getByTestId("cognitive-ring");
    expect(ring).toBeInTheDocument();
    expect(ring).not.toHaveAttribute("data-paused");
  });

  test("the welcome emblem is paused once docked (so it costs nothing off-screen)", () => {
    render(
      <EmptySessionIntro onSelectStarter={vi.fn()} composer={fakeComposer} dockState="docked" />,
    );
    // Still mounted inside the (now hidden) greeting block, but its animations are halted.
    expect(screen.getByTestId("cognitive-ring")).toHaveAttribute("data-paused", "true");
  });

  test("a history session mounts directly docked (dockState='docked' from the first render): no centered frame, greeting hidden immediately", () => {
    render(
      <EmptySessionIntro onSelectStarter={vi.fn()} composer={fakeComposer} dockState="docked" />,
    );
    expect(screen.getByTestId("empty-session-intro")).toHaveAttribute("data-dock-state", "docked");
    expect(screen.getByTestId("empty-session-intro-greeting")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(screen.getByTestId("fake-composer")).toHaveTextContent("composer:docked");
    // The composer wrapper's rest transform is identity (translateY(0)) — no offset baked in from a
    // "centered" state it never passed through.
    const wrap = screen.getByTestId("empty-session-intro-composer-wrap");
    expect(wrap.style.transform).toBe("translateY(0px)");
  });

  test("custom title/subtitle/starters override the defaults", () => {
    render(
      <EmptySessionIntro
        title="Custom greeting"
        subtitle="Custom subtitle"
        starters={["Do the thing"]}
        onSelectStarter={vi.fn()}
        composer={fakeComposer}
      />,
    );
    expect(screen.getByText("Custom greeting")).toBeInTheDocument();
    expect(screen.getByText("Custom subtitle")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Do the thing" })).toBeInTheDocument();
  });

  test("clicking a starter chip fires onSelectStarter with its text", () => {
    const onSelectStarter = vi.fn();
    render(
      <EmptySessionIntro
        starters={["Summarize my last MCP scan"]}
        onSelectStarter={onSelectStarter}
        composer={fakeComposer}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Summarize my last MCP scan" }));
    expect(onSelectStarter).toHaveBeenCalledWith("Summarize my last MCP scan");
  });
});

describe("EmptySessionIntro (WP1.3, D-HUX13) — one-time choreography", () => {
  test("transitioning from centered to docked while mounted flips the composer + hides the greeting", () => {
    const { rerender } = render(
      <EmptySessionIntro onSelectStarter={vi.fn()} composer={fakeComposer} dockState="centered" />,
    );
    expect(screen.getByTestId("empty-session-intro")).toHaveAttribute(
      "data-dock-state",
      "centered",
    );

    rerender(
      <EmptySessionIntro onSelectStarter={vi.fn()} composer={fakeComposer} dockState="docked" />,
    );
    expect(screen.getByTestId("empty-session-intro")).toHaveAttribute("data-dock-state", "docked");
    expect(screen.getByTestId("empty-session-intro-greeting")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(screen.getByTestId("fake-composer")).toHaveTextContent("composer:docked");
  });

  test("runs ONCE per session: reverting the dockState prop back to 'centered' does not re-open the invitation", () => {
    const { rerender } = render(
      <EmptySessionIntro onSelectStarter={vi.fn()} composer={fakeComposer} dockState="centered" />,
    );
    rerender(
      <EmptySessionIntro onSelectStarter={vi.fn()} composer={fakeComposer} dockState="docked" />,
    );
    expect(screen.getByTestId("empty-session-intro")).toHaveAttribute("data-dock-state", "docked");

    // A caller bug (or a stale prop) reporting "centered" again must NOT reopen the greeting.
    rerender(
      <EmptySessionIntro onSelectStarter={vi.fn()} composer={fakeComposer} dockState="centered" />,
    );
    expect(screen.getByTestId("empty-session-intro")).toHaveAttribute("data-dock-state", "docked");
    expect(screen.getByTestId("empty-session-intro-greeting")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  test("the transform-transition class is applied to the composer wrapper while animating is allowed", () => {
    render(
      <EmptySessionIntro onSelectStarter={vi.fn()} composer={fakeComposer} dockState="centered" />,
    );
    const wrap = screen.getByTestId("empty-session-intro-composer-wrap");
    expect(wrap.className).toContain("transition-transform");
    expect(wrap.className).toContain("motion-reduce:transition-none");
  });
});

describe("EmptySessionIntro (WP1.3, D-HUX13, WP1.R-A) — reduced motion suppresses ANIMATION only, never content", () => {
  test("a fresh reduced-motion session still shows the greeting + starter chips — visible, interactive, not aria-hidden", () => {
    reducedMotionMatches = true;
    render(
      <EmptySessionIntro
        starters={["Summarize my last MCP scan"]}
        onSelectStarter={vi.fn()}
        composer={fakeComposer}
        dockState="centered"
      />,
    );
    // Content is NOT hidden — only the glide that would have carried it there is gone.
    expect(screen.getByTestId("empty-session-intro")).toHaveAttribute(
      "data-dock-state",
      "centered",
    );
    const greeting = screen.getByTestId("empty-session-intro-greeting");
    expect(greeting).toHaveAttribute("aria-hidden", "false");
    expect(screen.getByText("What should we dig into?")).toBeVisible();
    const chip = screen.getByRole("button", { name: "Summarize my last MCP scan" });
    expect(chip).toBeVisible();
    expect(chip).toBeEnabled();
    expect(screen.getByTestId("fake-composer")).toHaveTextContent("composer:centered");
  });

  test("a starter chip is still clickable under reduced motion", () => {
    reducedMotionMatches = true;
    const onSelectStarter = vi.fn();
    render(
      <EmptySessionIntro
        starters={["Summarize my last MCP scan"]}
        onSelectStarter={onSelectStarter}
        composer={fakeComposer}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Summarize my last MCP scan" }));
    expect(onSelectStarter).toHaveBeenCalledWith("Summarize my last MCP scan");
  });

  test("a history session (dockState='docked' from the first render) still starts docked instantly under reduced motion — unchanged", () => {
    reducedMotionMatches = true;
    render(
      <EmptySessionIntro onSelectStarter={vi.fn()} composer={fakeComposer} dockState="docked" />,
    );
    expect(screen.getByTestId("empty-session-intro")).toHaveAttribute("data-dock-state", "docked");
    expect(screen.getByTestId("empty-session-intro-greeting")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(screen.getByTestId("fake-composer")).toHaveTextContent("composer:docked");
  });

  test("no transition classes are applied under reduced motion (the glide itself is gone, not the content)", () => {
    reducedMotionMatches = true;
    render(
      <EmptySessionIntro onSelectStarter={vi.fn()} composer={fakeComposer} dockState="centered" />,
    );
    const wrap = screen.getByTestId("empty-session-intro-composer-wrap");
    expect(wrap.className).not.toContain("transition-transform");
  });

  test("a first-send transition (centered -> docked) under reduced motion still ends up docked, just without the transition class", () => {
    reducedMotionMatches = true;
    const { rerender } = render(
      <EmptySessionIntro onSelectStarter={vi.fn()} composer={fakeComposer} dockState="centered" />,
    );
    rerender(
      <EmptySessionIntro onSelectStarter={vi.fn()} composer={fakeComposer} dockState="docked" />,
    );
    expect(screen.getByTestId("empty-session-intro")).toHaveAttribute("data-dock-state", "docked");
    expect(screen.getByTestId("empty-session-intro-greeting")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(screen.getByTestId("empty-session-intro-composer-wrap").className).not.toContain(
      "transition-transform",
    );
  });
});

describe("EmptySessionIntro (WP1.3, D-HUX13) — the non-reduced-motion glide is unchanged", () => {
  test("a fresh (non-reduced-motion) session still animates: transition class present, composer offset centered", () => {
    render(
      <EmptySessionIntro onSelectStarter={vi.fn()} composer={fakeComposer} dockState="centered" />,
    );
    const wrap = screen.getByTestId("empty-session-intro-composer-wrap");
    expect(wrap.className).toContain("transition-transform");
    expect(wrap.style.transform).not.toBe("translateY(0px)");
  });
});

describe("EmptySessionIntro (WP4.2, WP1.R-C) — reports the docked composer's measured height", () => {
  // A controllable ResizeObserver: captures the callback so the test can drive a resize (the global
  // vitest-setup polyfill is a no-op that never fires). `offsetHeight` is stubbed per-element because
  // jsdom reports 0 for every layout metric.
  let roCallback: ResizeObserverCallback | null = null;
  const originalResizeObserver = globalThis.ResizeObserver;

  beforeEach(() => {
    roCallback = null;
    globalThis.ResizeObserver = class {
      constructor(cb: ResizeObserverCallback) {
        roCallback = cb;
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver;
  });

  function stubHeight(el: HTMLElement, px: number): void {
    Object.defineProperty(el, "offsetHeight", { configurable: true, value: px });
  }

  test("reports the composer wrap's height on mount and again on resize", () => {
    const onComposerHeightChange = vi.fn();
    render(
      <EmptySessionIntro
        onSelectStarter={vi.fn()}
        composer={fakeComposer}
        dockState="docked"
        onComposerHeightChange={onComposerHeightChange}
      />,
    );
    // The synchronous mount measurement fires once (jsdom offsetHeight defaults to 0).
    expect(onComposerHeightChange).toHaveBeenCalled();

    // Grow the composer (multi-line input + attachment chips + running Stop) and drive the observer.
    const wrap = screen.getByTestId("empty-session-intro-composer-wrap");
    stubHeight(wrap, 228);
    roCallback?.([], {} as ResizeObserver);
    expect(onComposerHeightChange).toHaveBeenLastCalledWith(228);
  });

  test("wires no observer (and never throws) when onComposerHeightChange is omitted", () => {
    expect(() =>
      render(
        <EmptySessionIntro onSelectStarter={vi.fn()} composer={fakeComposer} dockState="docked" />,
      ),
    ).not.toThrow();
    expect(roCallback).toBeNull();
  });

  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver;
  });
});
