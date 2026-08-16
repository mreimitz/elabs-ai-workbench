import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TOKEN_PROFILES } from "@mcp-token-footprint/shared";
import { describe, expect, it } from "vitest";
import { PAGESHELL_EXACT_ROUTES, isPageShellRoute, isTokenProfile } from "./App";

// H2 — `isTokenProfile` used to hard-code a 3-member union (`generic_o200k` | `generic_cl100k` |
// `raw_json_rough`), OMITTING the valid 4th `TOKEN_PROFILES` member `generic_estimate`. A persisted
// `generic_estimate` default profile therefore failed the guard and silently reset to
// `DEFAULT_TOKEN_PROFILE` on every reload. Locks the fix: the guard is derived from the shared
// `TOKEN_PROFILES` constant, so every current (and future) profile passes.

describe("isTokenProfile", () => {
  it("accepts every member of the shared TOKEN_PROFILES list", () => {
    expect(TOKEN_PROFILES).toContain("generic_estimate"); // sanity — the bug-triggering member exists
    for (const profile of TOKEN_PROFILES) {
      expect(isTokenProfile(profile)).toBe(true);
    }
  });

  it("rejects a bogus value", () => {
    expect(isTokenProfile("not_a_real_profile")).toBe(false);
  });

  it("rejects null", () => {
    expect(isTokenProfile(null)).toBe(false);
  });
});

// Assistant Hub UX WP0.2 (D-HUX1) — every CURRENT `/assistant/*` route that RENDERS A VIEW joins
// the PageShell registry as a `fullBleed` mount (App has no full-`<App>`-render test harness
// anywhere in this codebase — providers/network are heavy — so, like `isTokenProfile` above, the
// registry↔route mapping is exercised as a pure-function unit test via the exported
// `isPageShellRoute`/`PAGESHELL_EXACT_ROUTES`, plus a source-level "grep-proof" check that every
// entry corresponds to a real `<Route path>` — the KpiRail.test.tsx pattern for this repo's "no
// dead code" style checks.
//
// Assistant Hub UX WP3.1 (D-HUX15) — `/assistant/memory` and `/assistant/usage` are REMOVED from
// this list: nav consolidates 6 → 4, and both paths are now `<Navigate>` redirects (see the
// `describe("Assistant Hub UX WP3.1 ...")` block below) rather than routes that paint a view — a
// pure redirect never needs a PageShell mount.
const ASSISTANT_HUB_ROUTES = [
  "/assistant",
  "/assistant/agents",
  // Assistant Hub UX WP1.4 (D-HUX4) — session history table, added to the registry alongside its
  // `<Route>` declaration (App.tsx's WP1.4 seam: route add only).
  "/assistant/sessions",
  "/assistant/projects",
  "/assistant/audit",
] as const;

describe("isPageShellRoute — Assistant Hub UX WP0.2 (D-HUX1)", () => {
  it("mounts every current /assistant/* route full-bleed", () => {
    for (const route of ASSISTANT_HUB_ROUTES) {
      expect(isPageShellRoute(route)).toBe(true);
    }
  });

  it("still mounts full-bleed routes registered before this WP (no regression to the shared helper)", () => {
    expect(isPageShellRoute("/dashboard")).toBe(true);
    expect(isPageShellRoute("/scans")).toBe(true);
    expect(isPageShellRoute("/scans/abc123")).toBe(true); // prefix match
  });

  it("does not match a route that merely starts with /assistant (exact-route registry, no stray prefix)", () => {
    expect(isPageShellRoute("/assistant-not-a-real-route")).toBe(false);
  });

  it("Assistant Hub UX WP2.1 (D-HUX5) — matches the workforce section's agent/crew node routes via the /assistant/agents/ prefix", () => {
    expect(isPageShellRoute("/assistant/agents/agent/abc123")).toBe(true);
    expect(isPageShellRoute("/assistant/agents/crew/xyz789")).toBe(true);
  });

  it("rejects an arbitrary unregistered path", () => {
    expect(isPageShellRoute("/not-a-real-route")).toBe(false);
  });

  it("registers exactly the current /assistant/* routes — no dead or duplicate hub entries", () => {
    const hubEntries = [...PAGESHELL_EXACT_ROUTES].filter((route) => route.startsWith("/assistant"));
    expect(hubEntries.sort()).toEqual([...ASSISTANT_HUB_ROUTES].sort());
  });

  it("every PAGESHELL_EXACT_ROUTES entry corresponds to a declared <Route path> in App.tsx (grep-proof: no dead registry entries anywhere in the shared registry)", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(path.join(here, "App.tsx"), "utf8");
    const declaredRoutePaths = new Set(
      [...source.matchAll(/<Route\s+path="([^"]+)"/g)].map((match) => match[1]),
    );
    for (const route of PAGESHELL_EXACT_ROUTES) {
      expect(declaredRoutePaths.has(route)).toBe(true);
    }
  });

  it("neither legacy /assistant/memory nor /assistant/usage remains in the PageShell registry (WP3.1, D-HUX15 — both are now redirects, never a mount)", () => {
    expect(PAGESHELL_EXACT_ROUTES.has("/assistant/memory")).toBe(false);
    expect(PAGESHELL_EXACT_ROUTES.has("/assistant/usage")).toBe(false);
  });
});

// Assistant Hub UX WP3.1 (D-HUX15) — nav consolidates 6 → 4; `/assistant/memory` and
// `/assistant/usage` become `<Navigate replace>` redirects rather than routes to a retired view.
// Source-level (grep-proof) checks, same technique as the registry↔route check above — there is no
// full-`<App>`-render harness in this codebase to exercise the actual router navigation.
describe("legacy /assistant/{memory,usage} redirects — Assistant Hub UX WP3.1 (D-HUX15)", () => {
  const source = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "App.tsx"),
    "utf8",
  );

  it("declares /assistant/memory as a replace-redirect to /assistant?memory=profile (P3 — opens the profile-memory dialog, wired by AssistantView in WP2.7)", () => {
    // Layout-agnostic (Biome may wrap the <Route .../> across lines): just require path="..." and
    // the matching <Navigate .../> to appear within the same short window of source.
    expect(source).toMatch(
      /path="\/assistant\/memory"[\s\S]{0,80}<Navigate to="\/assistant\?memory=profile" replace \/>/,
    );
  });

  it("declares /assistant/usage as a replace-redirect to /assistant/agents?tab=usage (D-HUX10 — the workforce section's Usage tab, which WorkforceView reads off ?tab=)", () => {
    expect(source).toMatch(
      /path="\/assistant\/usage"[\s\S]{0,80}<Navigate to="\/assistant\/agents\?tab=usage" replace \/>/,
    );
  });

  it("no lazy import of the retired MemoryView/UsageView modules remains (WP3.4 deletes the source files next; a stale import would break that)", () => {
    expect(source).not.toMatch(/import\("\.\/features\/hub\/MemoryView"\)/);
    expect(source).not.toMatch(/import\("\.\/features\/hub\/UsageView"\)/);
  });
});

// WP 2.7 (audit B-4) — depth-1 list-root breadcrumbs used to root at a synthetic `{ label: "Home",
// to: "/dashboard" }` crumb that named no real page. They now root at the SIDEBAR SECTION label the
// operator already sees in `AppShell.tsx`'s nav ("MCP" / "Skills" / "Testing" / "Setup"), rendered
// with no `to` (a section has no single route). The breadcrumb builder is a `useMemo` inside the
// `App` component, not an exported pure function, and there is no full-`<App>`-render harness in
// this codebase (see the WP3.1 block above) — so this locks the fix the same source-level
// (grep-proof) way: match the route branch's returned crumb array in App.tsx's source text.
describe("breadcrumbs — WP 2.7 (audit B-4) section-label crumbs, not synthetic Home", () => {
  const source = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "App.tsx"),
    "utf8",
  );

  it.each([
    ["/testing/environments", "Setup"],
    ["/testing/compatibility", "Testing"],
    ["/testing/runs", "Testing"],
    ["/compare/scans", "MCP"],
    ["/scans", "MCP"],
    ["/servers", "MCP"],
    ["/skills", "Skills"],
    ["/testing/collections", "Testing"],
    // design-remediation T8 — Suites is a real list route (Testing); Review is a promoted Testing
    // peer; Watch rules + Review rubrics moved into the Setup nav group, so their crumbs root at Setup.
    ["/testing/suites", "Testing"],
    ["/testing/review", "Testing"],
    ["/testing/observability/rules", "Setup"],
    ["/testing/observability/review-rubrics", "Setup"],
  ])("%s roots its breadcrumb at the sidebar section label %s (no to, matching AppShell.tsx's SidebarGroupLabel)", (routePath, sectionLabel) => {
    const escapedPath = routePath.replace(/\//g, "\\/");
    const branch = new RegExp(
      `location\\.pathname === "${escapedPath}"[\\s\\S]{0,40}\\[\\{ label: "${sectionLabel}" \\}`,
    );
    expect(source).toMatch(branch);
  });

  it("does not root any of the migrated depth-1 routes at the old synthetic Home crumb", () => {
    for (const [routePath] of [
      ["/testing/environments"],
      ["/testing/compatibility"],
      ["/testing/runs"],
      ["/compare/scans"],
      ["/scans"],
      ["/servers"],
      ["/skills"],
      ["/testing/collections"],
      ["/testing/observability/rules"],
      ["/testing/observability/review-rubrics"],
    ]) {
      const escapedPath = (routePath as string).replace(/\//g, "\\/");
      const oldHomeBranch = new RegExp(
        `location\\.pathname === "${escapedPath}"[\\s\\S]{0,40}\\{ label: "Home", to: "/dashboard" \\}`,
      );
      expect(source).not.toMatch(oldHomeBranch);
    }
  });

  it("leaves the retracted Assistant/Agents & Crews/Projects/Audit IA on Home (B-4 explicitly does not resurrect that finding — those are unlabeled-group sidebar peers, not a labeled section)", () => {
    expect(source).toMatch(
      /location\.pathname === "\/assistant"\)[\s\S]{0,20}\{[\s\S]{0,10}return \[\{ label: "Home", to: "\/dashboard" \}, \{ label: "Assistant" \}\];/,
    );
    expect(source).toMatch(
      /location\.pathname\.startsWith\("\/assistant\/agents"\)[\s\S]{0,60}\{ label: "Home", to: "\/dashboard" \}, \{ label: "Agents & Crews" \}/,
    );
    expect(source).toMatch(
      /location\.pathname === "\/assistant\/projects"[\s\S]{0,40}\{ label: "Home", to: "\/dashboard" \}, \{ label: "Projects" \}/,
    );
    expect(source).toMatch(
      /location\.pathname === "\/assistant\/audit"[\s\S]{0,40}\{ label: "Home", to: "\/dashboard" \}, \{ label: "Audit" \}/,
    );
  });
});
