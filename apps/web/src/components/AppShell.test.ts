import { describe, expect, it } from "vitest";
import {
  ASSISTANT_NAV_ITEMS,
  SETUP_NAV_ITEMS,
  TESTING_NAV_ITEMS,
  isNavItemActive,
  isPathActive,
} from "./AppShell";

// Assistant Hub UX WP3.1 (D-HUX15) — nav consolidates 6 → 4: Assistant (+ a nested Sessions
// child), Agents & Crews, Projects, Audit. The standalone Memory/Usage nav entries are retired
// (Memory dissolves into workspace scopes, Usage into the workforce section's Usage tab — both
// legacy URLs now redirect, see `App.test.ts`). There is no render harness for the full `AppShell`
// tree anywhere in this codebase (heavy providers: sidebar, theme, notifications, the assistant
// dock) — so, matching `App.test.ts`'s `isPageShellRoute`/`isTokenProfile` precedent, the nav
// SHAPE is exercised as a pure-data unit test via the exported `ASSISTANT_NAV_ITEMS`/
// `isPathActive` rather than a DOM render.
describe("ASSISTANT_NAV_ITEMS — Assistant Hub UX WP3.1 (D-HUX15)", () => {
  it("has exactly 4 top-level entries", () => {
    expect(ASSISTANT_NAV_ITEMS).toHaveLength(4);
  });

  it("is Assistant, Agents & Crews, Projects, Audit — in that order", () => {
    expect(ASSISTANT_NAV_ITEMS.map((item) => item.label)).toEqual([
      "Assistant",
      "Agents & Crews",
      "Projects",
      "Audit",
    ]);
    expect(ASSISTANT_NAV_ITEMS.map((item) => item.path)).toEqual([
      "/assistant",
      "/assistant/agents",
      "/assistant/projects",
      "/assistant/audit",
    ]);
  });

  it("nests exactly one Sessions child under Assistant, at /assistant/sessions", () => {
    const assistant = ASSISTANT_NAV_ITEMS.find((item) => item.path === "/assistant");
    // `icon` is a lucide-react `forwardRef` component, not a plain function — assert its shape
    // loosely (defined, not undefined) rather than an exact reference.
    expect(assistant?.children).toEqual([
      { path: "/assistant/sessions", label: "Sessions", icon: expect.anything() },
    ]);
  });

  it("no OTHER top-level entry carries children (Sessions is the only nested item today)", () => {
    for (const item of ASSISTANT_NAV_ITEMS) {
      if (item.path === "/assistant") continue;
      expect(item.children).toBeUndefined();
    }
  });

  it("no dead Memory/Usage nav entry remains — neither as a top-level item nor nested", () => {
    const allPaths = ASSISTANT_NAV_ITEMS.flatMap((item) => [
      item.path,
      ...(item.children ?? []).map((child) => child.path),
    ]);
    const allLabels = ASSISTANT_NAV_ITEMS.flatMap((item) => [
      item.label,
      ...(item.children ?? []).map((child) => child.label),
    ]);
    expect(allPaths).not.toContain("/assistant/memory");
    expect(allPaths).not.toContain("/assistant/usage");
    expect(allLabels).not.toContain("Memory");
    expect(allLabels).not.toContain("Usage");
  });
});

// design-remediation T8 — the Testing nav is rebuilt from the real model (Collection → Test → Suite
// → Run, Environment as the harness): the top-level Testing group reads Collections · Runs · Review ·
// Compatibility, and the two previously-orphaned config surfaces (Watch rules, Review rubrics) join
// Environments in the settings-style Setup group so they're reachable from the nav (not URL-only).
describe("TESTING_NAV_ITEMS / SETUP_NAV_ITEMS — design-remediation T8", () => {
  it("the Testing group is Collections · Runs · Review · Compatibility, in that order", () => {
    expect(TESTING_NAV_ITEMS.map((item) => item.label)).toEqual([
      "Collections",
      "Runs",
      "Review",
      "Compatibility",
    ]);
    expect(TESTING_NAV_ITEMS.map((item) => item.path)).toEqual([
      "/testing/collections",
      "/testing/runs",
      "/testing/review",
      "/testing/compatibility",
    ]);
  });

  it("Review has a real nav home at its promoted top-level route (not the buried /testing/runs/review)", () => {
    const review = TESTING_NAV_ITEMS.find((item) => item.label === "Review");
    expect(review?.path).toBe("/testing/review");
    expect(TESTING_NAV_ITEMS.map((item) => item.path)).not.toContain("/testing/runs/review");
  });

  it("Setup holds Environments plus the formerly-orphaned Watch rules + Review rubrics config routes", () => {
    expect(SETUP_NAV_ITEMS.map((item) => item.label)).toEqual([
      "Environments",
      "Watch rules",
      "Review rubrics",
    ]);
    expect(SETUP_NAV_ITEMS.map((item) => item.path)).toEqual([
      "/testing/environments",
      "/testing/observability/rules",
      "/testing/observability/review-rubrics",
    ]);
  });

  it("Review is a top-level Testing peer, not a sub-route of Runs (single active nav item per route)", () => {
    // `/testing/review` must NOT be a prefix-child of `/testing/runs`, or the Runs item would also
    // light active on the review surface (the double-active defect isNavItemActive guards for hubs).
    expect(isPathActive("/testing/review", "/testing/runs")).toBe(false);
    const active = TESTING_NAV_ITEMS.filter((item) => isPathActive("/testing/review", item.path));
    expect(active.map((item) => item.label)).toEqual(["Review"]);
  });
});

describe("isPathActive", () => {
  it("matches the exact path", () => {
    expect(isPathActive("/assistant/sessions", "/assistant/sessions")).toBe(true);
  });

  it("matches a nested route under the item path", () => {
    expect(isPathActive("/assistant/agents/agent/abc123", "/assistant/agents")).toBe(true);
  });

  it("rejects an unrelated path", () => {
    expect(isPathActive("/assistant/projects", "/assistant/sessions")).toBe(false);
  });

  it("rejects a path that merely shares a prefix without a separator", () => {
    expect(isPathActive("/assistant-not-a-real-route", "/assistant")).toBe(false);
  });
});

// WP3.R-H1 — a parent nav item with children ("Assistant") must NOT prefix-match its SIBLING
// top-level sections (`/assistant/agents|projects|audit` are peers, not children), so exactly ONE
// top-level nav item lights active per route.
describe("isNavItemActive — exactly one active top-level item (WP3.R-H1)", () => {
  const activeLabels = (pathname: string) =>
    ASSISTANT_NAV_ITEMS.filter((item) => isNavItemActive(pathname, item)).map((item) => item.label);

  it("lights ONLY the section on /assistant/agents (Assistant parent stays off)", () => {
    expect(activeLabels("/assistant/agents")).toEqual(["Agents & Crews"]);
  });

  it("lights ONLY the section on a node route, /assistant/projects, and /assistant/audit", () => {
    expect(activeLabels("/assistant/agents/agent/abc")).toEqual(["Agents & Crews"]);
    expect(activeLabels("/assistant/projects")).toEqual(["Projects"]);
    expect(activeLabels("/assistant/audit")).toEqual(["Audit"]);
  });

  it("lights ONLY Assistant on its own exact path and on its Sessions child", () => {
    expect(activeLabels("/assistant")).toEqual(["Assistant"]);
    expect(activeLabels("/assistant/sessions")).toEqual(["Assistant"]);
  });
});
