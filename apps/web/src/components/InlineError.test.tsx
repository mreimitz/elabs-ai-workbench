import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { InlineError } from "./InlineError";

// a11y (critique 2026-07-25T20-00-10Z, T9 item 7): InlineError is the app's one "a fetch failed"
// surface — it must announce as an alert (role=alert, via @brand/ui's Alert default) and its title
// must be a REAL, correctly-levelled heading (via AlertHeading, item 2), not always a bare <h5>.

describe("InlineError — alert association + heading level (a11y)", () => {
  test("announces as an alert region (role=alert) containing the title and detail", () => {
    render(<InlineError title="Couldn't load findings" detail="Network request failed" />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load findings");
    expect(alert).toHaveTextContent("Network request failed");
  });

  test("the title is a real heading, defaulting to level 5 (matches AlertTitle's own hardcoded level)", () => {
    render(<InlineError title="Couldn't load findings" />);
    const heading = screen.getByRole("heading", { name: "Couldn't load findings", level: 5 });
    expect(heading.tagName).toBe("H5");
  });

  test("a caller replacing a page's main content can promote the title (level={2})", () => {
    render(<InlineError title="Scan failed" level={2} />);
    const heading = screen.getByRole("heading", { name: "Scan failed", level: 2 });
    expect(heading.tagName).toBe("H2");
  });

  test("the Retry action has an accessible name and fires onRetry — reachable from the alert region", () => {
    const onRetry = vi.fn();
    render(<InlineError title="Couldn't load findings" onRetry={onRetry} />);
    const alert = screen.getByRole("alert");
    const retry = screen.getByRole("button", { name: /retry/i });
    expect(alert).toContainElement(retry);
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test("no Retry affordance when onRetry is absent (never a dead button)", () => {
    render(<InlineError title="Couldn't load findings" />);
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });
});
