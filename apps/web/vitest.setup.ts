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

// Unmount React trees between tests so component smoke tests don't leak DOM into each other.
afterEach(() => {
  cleanup();
});
