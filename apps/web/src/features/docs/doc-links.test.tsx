/**
 * doc-links.test.tsx — RM-18 WP 1.2.
 *
 * WHY THIS TEST EXISTS: measured against the running container, the guide's ~124 cross-references
 * rendered as `<button data-streamdown="link">` with NO href — Streamdown's link-SAFETY behaviour for
 * AI-generated markdown, which is exactly wrong for a manual the app itself shipped. They looked like
 * links and did nothing, and no unit test would have noticed, because the assertion everyone writes
 * ("the markdown renders") was true.
 *
 * The fix is the `a` override in `DOC_MD_COMPONENTS`. This asserts the override's behaviour directly
 * — rendering the component the map declares, rather than driving the whole Streamdown pipeline
 * through jsdom — so a regression that drops it turns this red.
 */
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { DOC_MD_COMPONENTS } from "./DocProse";

/** `extra` mimics what the markdown pipeline injects onto a link node (it adds `target="_blank"`). */
function renderLink(href: string, text: string, extra: Record<string, unknown> = {}) {
  const Anchor = DOC_MD_COMPONENTS.a;
  if (!Anchor) throw new Error("DOC_MD_COMPONENTS must override `a` — see the module doc.");
  return render(
    <MemoryRouter initialEntries={["/docs/getting-started"]}>
      {createElement(Anchor as never, { href, ...extra }, text)}
    </MemoryRouter>,
  );
}

describe("the guide's markdown links", () => {
  it("renders an in-app guide reference as a real, navigable anchor", () => {
    renderLink("/docs/settings-and-features#13-settings", "Settings");
    const link = screen.getByRole("link", { name: "Settings" });
    expect(link).toHaveAttribute("href", "/docs/settings-and-features#13-settings");
    // The whole defect this test guards: it must not be a control with no destination.
    expect(link.tagName).toBe("A");
  });

  it("keeps a same-page anchor as an anchor", () => {
    renderLink("#01-key-concepts", "Key concepts");
    expect(screen.getByRole("link", { name: "Key concepts" })).toHaveAttribute(
      "href",
      "/docs/getting-started#01-key-concepts",
    );
  });

  it("keeps an in-app link IN the app even when the pipeline injects target=_blank", () => {
    // Measured in the container: the renderer sets `target="_blank"` on every link it emits, so
    // spreading its props onto the router `Link` opened the next page of the manual in a new tab.
    renderLink("/docs/skills#08-skills", "Skills", { target: "_blank", rel: "noreferrer" });
    const link = screen.getByRole("link", { name: "Skills" });
    expect(link.getAttribute("target")).toBeNull();
  });

  it("opens an external link in a new tab, safely", () => {
    renderLink("https://agentskills.io", "Agent Skills");
    const link = screen.getByRole("link", { name: "Agent Skills" });
    expect(link).toHaveAttribute("href", "https://agentskills.io");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.getAttribute("rel")).toContain("noreferrer");
  });

  it("does NOT colour link text with the brand lime, which fails contrast in the light theme", () => {
    // Measured against the running container: `--primary` renders link text at 1.36:1 on the light
    // theme's page surface (WCAG 1.4.3 asks 4.5:1) and at 12.41:1 in dark — so testing one theme
    // hides it entirely. `--foreground` measures 13.1:1 / 15.31:1, and the underline is what marks
    // the link. This pins the decision; deleting it silently reintroduces a known failure.
    renderLink("/docs/skills", "Skills");
    const cls = screen.getByRole("link", { name: "Skills" }).className;
    expect(cls).not.toContain("text-primary");
    expect(cls).toContain("text-foreground");
    expect(cls).toContain("underline");
  });

  it("keeps the shared table mapping, so a guide table is not a fullscreen takeover", () => {
    // `MD_TABLE_COMPONENTS` is the app's one markdown-table recipe; spreading it is what stops
    // Streamdown's own table block (with its chrome-less "View fullscreen" portal) from rendering.
    for (const tag of ["table", "thead", "tbody", "tr", "th", "td"] as const) {
      expect(DOC_MD_COMPONENTS[tag], `${tag} must come from MD_TABLE_COMPONENTS`).toBeTruthy();
    }
  });
});
