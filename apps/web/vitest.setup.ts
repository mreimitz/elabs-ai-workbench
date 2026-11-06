import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom ships neither ResizeObserver nor Element.scrollIntoView, both of which cmdk (the command
// palette's listbox) touches on mount/keyboard-nav. Polyfill them once here so any cmdk-based
// component (the ⌘K CommandPalette today) renders under jsdom instead of throwing.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}
if (typeof Element !== "undefined" && typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = () => {};
}

// jsdom ships no `window.matchMedia`. Since design-system 5.x, more `@elabs-ai/components-ui` parts
// (anything on `useIsMobile`, e.g. the toolbar/filter controls the Hub tables use) read it on mount.
// Many suites already stubbed it locally with this exact guarded shape (a desktop viewport,
// `matches: false`); doing it once here keeps those local stubs valid — they see a function and skip.
// A suite that needs a narrow viewport still overrides `window.matchMedia` itself.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
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

// Unmount React trees between tests so component smoke tests don't leak DOM into each other.
afterEach(() => {
  cleanup();
});
