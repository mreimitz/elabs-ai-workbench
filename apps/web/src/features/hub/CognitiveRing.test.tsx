import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test } from "vitest";

import { CognitiveRing } from "./CognitiveRing";

// jsdom omits matchMedia; `useReducedMotion` (@brand/tokens) calls it unconditionally on mount, so
// every test needs a stub. `reducedMotionMatches` lets a test control the OS preference the hook
// resolves to.
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

describe("CognitiveRing", () => {
  test("renders as a decorative, non-focusable emblem (aria-hidden, no role, no tabindex)", () => {
    render(<CognitiveRing />);
    const ring = screen.getByTestId("cognitive-ring");
    expect(ring).toHaveAttribute("aria-hidden", "true");
    expect(ring).not.toHaveAttribute("role");
    expect(ring).not.toHaveAttribute("tabindex");
    expect(ring).toHaveClass("cognitive-ring");
  });

  test("renders the full layered structure (concept-faithful element counts)", () => {
    const { container } = render(<CognitiveRing />);
    // Concentric processing tracks.
    expect(container.querySelector(".cr-telemetry")).not.toBeNull();
    expect(container.querySelector(".cr-reasoning")).not.toBeNull();
    expect(container.querySelector(".cr-memory")).not.toBeNull();
    expect(container.querySelector(".cr-scanner")).not.toBeNull();
    expect(container.querySelector(".cr-core")).not.toBeNull();
    // Instanced element counts match the concept.
    expect(container.querySelectorAll(".cr-cardinal")).toHaveLength(8);
    expect(container.querySelectorAll(".cr-node")).toHaveLength(12);
    expect(container.querySelectorAll(".cr-packet-track")).toHaveLength(3);
    expect(container.querySelectorAll(".cr-synapse")).toHaveLength(6);
    expect(container.querySelectorAll(".cr-particle")).toHaveLength(17);
    // The imperative-spark layer is present and starts empty.
    const sparks = container.querySelector(".cr-sparks");
    expect(sparks).not.toBeNull();
    expect(sparks?.childElementCount).toBe(0);
  });

  test("angles + colours ride CSS custom properties (no baked geometry/hex)", () => {
    const { container } = render(<CognitiveRing />);
    const firstNode = container.querySelector(".cr-node") as HTMLElement;
    expect(firstNode.style.getPropertyValue("--angle")).toBe("0deg");
    // Every 3rd node is green via the CSS `nth-child`; the packet colours are token refs, never hex.
    const greenPacket = container.querySelectorAll(".cr-packet")[1] as HTMLElement;
    expect(greenPacket.style.getPropertyValue("--packet-color")).toBe("var(--ring-green)");
  });

  test("a numeric size prop sets --ring-size in pixels; a string is used verbatim", () => {
    const { rerender } = render(<CognitiveRing size={180} />);
    expect(screen.getByTestId("cognitive-ring").style.getPropertyValue("--ring-size")).toBe(
      "180px",
    );
    rerender(<CognitiveRing size="clamp(120px, 22vmin, 188px)" />);
    expect(screen.getByTestId("cognitive-ring").style.getPropertyValue("--ring-size")).toBe(
      "clamp(120px, 22vmin, 188px)",
    );
  });

  test("paused adds the data-paused hook the CSS halts on", () => {
    const { rerender } = render(<CognitiveRing />);
    expect(screen.getByTestId("cognitive-ring")).not.toHaveAttribute("data-paused");
    rerender(<CognitiveRing paused />);
    expect(screen.getByTestId("cognitive-ring")).toHaveAttribute("data-paused", "true");
  });

  test("still renders its content under reduced motion (motion is dropped, the emblem is not)", () => {
    reducedMotionMatches = true;
    const { container } = render(<CognitiveRing />);
    // Content stays — reduced motion suppresses ANIMATION (via CSS), never the DOM.
    expect(screen.getByTestId("cognitive-ring")).toBeInTheDocument();
    expect(container.querySelectorAll(".cr-node")).toHaveLength(12);
  });

  test("accepts a layout className without dropping its own base class", () => {
    render(<CognitiveRing className="mb-2" />);
    const ring = screen.getByTestId("cognitive-ring");
    expect(ring).toHaveClass("cognitive-ring");
    expect(ring).toHaveClass("mb-2");
  });
});
