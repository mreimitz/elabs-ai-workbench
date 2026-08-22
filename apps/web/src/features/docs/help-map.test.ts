/**
 * help-map.test.ts — RM-18 WP 1.2.
 *
 * The Help control is ONE control for ~40 routes, so the mapping table is the whole feature. Three
 * things are pinned here:
 *
 *   1. Every subject the map names really EXISTS in the shipped guide. A renamed or deleted DC
 *      folder turns this red instead of quietly sending an operator to a not-found page — and it is
 *      checked against `planning/user-guide` itself, through the generator, not against a copy.
 *   2. The main views resolve to the RIGHT subject, and specificity is respected (a longer prefix
 *      wins over a shorter one that also matches).
 *   3. Every real route in `ASSISTANT_ROUTE_MANIFEST` resolves to SOMETHING. The fallback is the
 *      point: an unmapped page gets the index, never nothing.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ASSISTANT_ROUTE_MANIFEST } from "@mcp-token-footprint/shared";
import { collectSubjects } from "../../../../../scripts/build-docs-bundle.mjs";
import { CHANGELOG_ROUTE, HELP_MAP, hasDedicatedHelp, resolveHelpTarget } from "./help-map";
import { DOCS_ROUTE_BASE } from "./docs-manifest";

const repoRoot = join(__dirname, "..", "..", "..", "..", "..");

/** The subject ids the generator will actually put in the manifest for this repository. */
const shippedSubjectIds = new Set(
  collectSubjects(join(repoRoot, "planning", "user-guide"))
    .filter((subject) => !subject.skipped)
    .map((subject) => subject.id),
);

describe("HELP_MAP", () => {
  it("names only subjects that really ship", () => {
    expect(shippedSubjectIds.size).toBeGreaterThan(0);
    const unknown = HELP_MAP.filter((entry) => !shippedSubjectIds.has(entry.subject));
    expect(
      unknown.map((entry) => `${entry.prefix} → ${entry.subject}`),
      "a help entry points at a subject the guide does not ship",
    ).toEqual([]);
  });

  it("is ordered most-specific-first, so a longer prefix is never shadowed", () => {
    HELP_MAP.forEach((entry, index) => {
      const shadowedBy = HELP_MAP.slice(0, index).find(
        (earlier) => entry.prefix.startsWith(`${earlier.prefix}/`) && earlier.subject !== entry.subject,
      );
      expect(
        shadowedBy?.prefix,
        `${entry.prefix} is unreachable — ${shadowedBy?.prefix} matches first`,
      ).toBeUndefined();
    });
  });
});

describe("resolveHelpTarget", () => {
  it.each([
    ["/dashboard", "/docs/getting-started"],
    ["/servers", "/docs/mcp-servers"],
    ["/servers/abc123", "/docs/mcp-servers"],
    ["/scans", "/docs/scans-and-footprint"],
    ["/scans/xyz", "/docs/scans-and-footprint"],
    ["/skills/abc/studio", "/docs/skills"],
    ["/compare/scans", "/docs/comparison"],
    ["/testing/runs", "/docs/testing-console"],
    ["/testing/runs/run_1", "/docs/testing-console"],
    ["/testing/compatibility", "/docs/compatibility"],
    ["/testing/suites/s1", "/docs/suites-and-benchmarks"],
    ["/testing/observability/rules", "/docs/observability"],
    ["/assistant/agents", "/docs/assistant-hub"],
    ["/settings/providers", "/docs/settings-and-features"],
  ])("%s → %s", (pathname, expected) => {
    expect(resolveHelpTarget(pathname)).toBe(expected);
  });

  it("specificity beats order of appearance: /testing/runs/compare is not the runs page", () => {
    expect(resolveHelpTarget("/testing/runs/compare")).toBe("/docs/testing-console");
    // …and the compatibility route is not swallowed by the bare /testing prefix.
    expect(resolveHelpTarget("/testing/compatibility")).toBe("/docs/compatibility");
  });

  it("falls back to the INDEX for an unmapped route rather than vanishing", () => {
    expect(resolveHelpTarget("/advisor")).toBe(DOCS_ROUTE_BASE);
    expect(resolveHelpTarget("/illustrations")).toBe(DOCS_ROUTE_BASE);
    expect(resolveHelpTarget("/nothing/like/this")).toBe(DOCS_ROUTE_BASE);
    expect(hasDedicatedHelp("/advisor")).toBe(false);
    expect(hasDedicatedHelp("/servers")).toBe(true);
  });

  it("does not send the reader from a docs page back to the same docs page", () => {
    expect(resolveHelpTarget("/docs")).toBe(DOCS_ROUTE_BASE);
    expect(resolveHelpTarget("/docs/skills")).toBe(DOCS_ROUTE_BASE);
    expect(CHANGELOG_ROUTE).toBe("/docs/changelog");
  });

  it("resolves EVERY real app route to a usable guide URL", () => {
    for (const entry of ASSISTANT_ROUTE_MANIFEST) {
      if (entry.surface === "redirect") continue;
      const concrete = entry.pattern
        .split("/")
        .map((segment) => (segment.startsWith(":") ? "sample-id" : segment))
        .join("/");
      const target = resolveHelpTarget(concrete === "*" ? "/does-not-exist" : concrete);
      expect(target.startsWith(DOCS_ROUTE_BASE), `${entry.pattern} → ${target}`).toBe(true);
    }
  });
});
