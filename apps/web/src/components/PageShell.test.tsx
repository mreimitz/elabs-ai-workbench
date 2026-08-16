import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { Heading } from "@brand/ui";
import { PageShell } from "./PageShell";

// Locks the load-bearing contract of the page frame (audit §S22 scroll), so a later refactor can't
// silently break "the content region owns scroll". `PageHeader` is retired (D-TB8) — these cases
// pass a plain header node (a `Heading`) in its place; the `<h1>` assertions still lock the
// "the header's heading lives outside/inside the right region" contract for whatever `header` is.

describe("PageShell", () => {
  test("default (content) scroll: exactly one internal scroll container, header outside it", () => {
    const { container } = render(
      <PageShell header={<Heading level={1}>Catalog</Heading>}>
        <div data-testid="body">rows</div>
      </PageShell>,
    );
    const scrollers = container.querySelectorAll(".overflow-y-auto");
    expect(scrollers).toHaveLength(1);
    // The header (its h1) must NOT live inside the scroll container.
    expect(scrollers[0]?.contains(screen.getByRole("heading", { level: 1 }))).toBe(false);
    // The body content DOES live inside it.
    expect(scrollers[0]?.contains(screen.getByTestId("body"))).toBe(true);
  });

  test("body scroll (document exception): the whole column scrolls and the header is sticky", () => {
    const { container } = render(
      <PageShell scroll="body" header={<Heading level={1}>Settings</Heading>}>
        <div>cards</div>
      </PageShell>,
    );
    const scroller = container.querySelector(".overflow-y-auto");
    expect(scroller).not.toBeNull();
    // In body-scroll the header is inside the scroller but pinned with position: sticky.
    const heading = screen.getByRole("heading", { level: 1 });
    expect(scroller?.contains(heading)).toBe(true);
    expect(container.querySelector(".sticky")?.contains(heading)).toBe(true);
  });

  test("fill scroll: no outer scroll container — the header stays outside, the child owns scroll", () => {
    const { container } = render(
      <PageShell scroll="fill" header={<Heading level={1}>Server detail</Heading>}>
        <div data-testid="body">tab body</div>
      </PageShell>,
    );
    // Fill mode provides a fixed, viewport-filling frame — PageShell itself never scrolls; the child
    // (a TabPanel / SplitPane / table) owns the internal scroll.
    expect(container.querySelectorAll(".overflow-y-auto")).toHaveLength(0);
    // The content region hides its own overflow so nothing scrolls the frame away.
    const framed = container.querySelector(".overflow-hidden");
    expect(framed).not.toBeNull();
    // The header (its h1) lives OUTSIDE the filling content region; the body lives inside it.
    const heading = screen.getByRole("heading", { level: 1 });
    expect(framed?.contains(heading)).toBe(false);
    expect(framed?.contains(screen.getByTestId("body"))).toBe(true);
  });

  test("centered width constrains the content body; full width does not", () => {
    const { container: centered } = render(
      <PageShell width="centered">
        <div>x</div>
      </PageShell>,
    );
    expect(centered.querySelector(".max-w-\\[1400px\\]")).not.toBeNull();

    const { container: full } = render(
      <PageShell width="full">
        <div>x</div>
      </PageShell>,
    );
    expect(full.querySelector(".max-w-\\[1400px\\]")).toBeNull();
  });
});
