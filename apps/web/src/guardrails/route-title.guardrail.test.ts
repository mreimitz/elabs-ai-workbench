/**
 * route-title.guardrail.test.ts — design-remediation T5 (item 3) guardrail.
 *
 * `document.title` used to read the constant "AI Workbench" on all 40+ routes (the browser tab, the
 * window switcher, and a screen reader's page-title announcement were all identical and useless). It
 * is now derived per route from the breadcrumb leaf via the pure, exported `derivePageTitle` /
 * `formatDocumentTitle`. This proves two different routes yield two different, non-constant titles —
 * exercised as a pure-function unit test (App has no full-render harness; mirrors `isTokenProfile`
 * and `isPageShellRoute` in App.test.ts).
 */
import { describe, expect, it } from "vitest";
import { derivePageTitle, formatDocumentTitle } from "../App";

describe("GUARDRAIL — per-route document.title (not the constant 'AI Workbench')", () => {
  it("two different routes produce two different titles", () => {
    const runs = formatDocumentTitle(
      derivePageTitle({
        isSettings: false,
        breadcrumbs: [{ label: "Testing" }, { label: "Runs" }],
        pathname: "/testing/runs",
      }),
    );
    const scans = formatDocumentTitle(
      derivePageTitle({
        isSettings: false,
        breadcrumbs: [{ label: "MCP" }, { label: "Scans" }],
        pathname: "/scans",
      }),
    );
    expect(runs).not.toBe(scans);
    expect(runs).toBe("Runs · AI Workbench");
    expect(scans).toBe("Scans · AI Workbench");
  });

  it("no route reads the bare constant 'AI Workbench' — every title is suffixed with a page name", () => {
    const titles = [
      formatDocumentTitle(
        derivePageTitle({ isSettings: false, breadcrumbs: [], pathname: "/dashboard" }),
      ),
      formatDocumentTitle(
        derivePageTitle({ isSettings: true, breadcrumbs: [], pathname: "/settings" }),
      ),
      formatDocumentTitle(
        derivePageTitle({ isSettings: false, breadcrumbs: [], pathname: "/nonexistent-route" }),
      ),
    ];
    for (const title of titles) {
      expect(title).not.toBe("AI Workbench");
      expect(title.endsWith(" · AI Workbench")).toBe(true);
    }
    // Concretely: the two breadcrumb-less known cases + the catch-all each get their own name.
    expect(titles[0]).toBe("Dashboard · AI Workbench");
    expect(titles[1]).toBe("Settings · AI Workbench");
    expect(titles[2]).toBe("Page not found · AI Workbench");
  });

  it("names the current page from the resolved breadcrumb leaf (incl. the entity)", () => {
    expect(
      derivePageTitle({
        isSettings: false,
        breadcrumbs: [{ label: "MCP Servers", to: "/servers" }, { label: "acme-server" }],
        pathname: "/servers/abc",
      }),
    ).toBe("acme-server");
  });

  it("Settings (a modal over the current view) wins over the underlying page", () => {
    expect(
      derivePageTitle({
        isSettings: true,
        breadcrumbs: [{ label: "MCP" }, { label: "Scans" }],
        pathname: "/scans",
      }),
    ).toBe("Settings");
  });
});
