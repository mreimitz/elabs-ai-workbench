import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { useMetaRailNarrow } from "./use-meta-rail-narrow";

/** A minimal, controllable `matchMedia` stub — jsdom implements neither the API nor a real CSS
 *  viewport, so every listener fires from this fixture's own `change` dispatch (mirrors the
 *  `window.matchMedia = ((query) => ({...}))` stub already used across the app's test suites, e.g.
 *  `features/testing/AddServerModal.test.tsx`). */
function stubMatchMedia(initialMatches: boolean) {
  let matches = initialMatches;
  let listener: (() => void) | undefined;
  window.matchMedia = ((query: string) => ({
    // A GETTER (not a snapshot value) — the hook calls `window.matchMedia(query)` once per effect
    // run and then reads `.matches` again inside the `change` listener; a plain value property would
    // freeze at whatever `matches` was when the object was constructed.
    get matches() {
      return matches;
    },
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: (_: string, cb: () => void) => {
      listener = cb;
    },
    removeEventListener: () => {
      listener = undefined;
    },
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  return {
    setMatches: (next: boolean) => {
      matches = next;
      listener?.();
    },
  };
}

afterEach(() => {
  // @ts-expect-error — restoring jsdom's un-implemented default between tests
  window.matchMedia = undefined;
});

describe("useMetaRailNarrow (WP1.2, D-HUX3 Sheet-fallback breakpoint)", () => {
  test("reflects the initial matchMedia state", () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => useMetaRailNarrow(1460));
    expect(result.current).toBe(true);
  });

  test("false when the query does not match", () => {
    stubMatchMedia(false);
    const { result } = renderHook(() => useMetaRailNarrow(1460));
    expect(result.current).toBe(false);
  });

  test("updates live when the media query flips (a viewport resize)", () => {
    const stub = stubMatchMedia(false);
    const { result } = renderHook(() => useMetaRailNarrow(1460));
    expect(result.current).toBe(false);

    act(() => stub.setMatches(true));
    expect(result.current).toBe(true);
  });

  test("never throws when matchMedia is unavailable (defensive default: not narrow)", () => {
    // @ts-expect-error — simulate an environment without matchMedia
    window.matchMedia = undefined;
    const { result } = renderHook(() => useMetaRailNarrow(1460));
    expect(result.current).toBe(false);
  });
});
