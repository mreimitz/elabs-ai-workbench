/**
 * palette-nav-parity.guardrail.test.ts — design-remediation T2 guardrail (critique §"Consistency
 * and Standards": "the command palette's 'Go to' list is hand-maintained and misses 5 of 16
 * destinations, though the nav arrays are ALREADY exported from AppShell.tsx").
 *
 * The command palette's jump-to list is now DERIVED from AppShell's exported nav arrays
 * (`buildNavDestinations()` in `CommandPalette.tsx`) rather than hand-kept, so drift is structurally
 * impossible. This guardrail proves that: it flattens every nav group here as an INDEPENDENT oracle
 * (children — only Assistant → Sessions today — included) and asserts the palette reaches every one,
 * plus Settings (the one destination that lives in the shell footer, not a nav group). If a future
 * nav change adds a destination, the palette gains it automatically and this stays green; if the
 * derivation ever regressed to a hand-kept copy that dropped one, this goes RED.
 */
import { describe, expect, it } from "vitest";
import {
  ASSISTANT_NAV_ITEMS,
  MCP_NAV_ITEMS,
  NAV_ITEMS,
  SETUP_NAV_ITEMS,
  SKILL_NAV_ITEMS,
  TESTING_NAV_ITEMS,
} from "../components/AppShell";
import { buildNavDestinations } from "../features/command-palette/CommandPalette";

/** Minimal structural shape for flattening — `NavItem` is not exported from AppShell. */
type FlatNav = { path: string; children?: FlatNav[] };

/** Flatten a nav group into its paths, recursing into `children` (Assistant → Sessions). */
function collectPaths(items: readonly FlatNav[], acc: string[] = []): string[] {
  for (const item of items) {
    acc.push(item.path);
    if (item.children) collectPaths(item.children, acc);
  }
  return acc;
}

const NAV_GROUPS: readonly (readonly FlatNav[])[] = [
  NAV_ITEMS,
  ASSISTANT_NAV_ITEMS,
  MCP_NAV_ITEMS,
  SKILL_NAV_ITEMS,
  TESTING_NAV_ITEMS,
  SETUP_NAV_ITEMS,
];

// Independent oracle: the flattened nav paths, computed here without touching the palette's derivation.
const navPaths = NAV_GROUPS.flatMap((group) => collectPaths(group));
const palettePaths = new Set(buildNavDestinations().map((dest) => dest.path));

describe("GUARDRAIL — the command palette reaches every nav destination", () => {
  it("includes every nav destination (children flattened) — no destination is unreachable", () => {
    const missing = navPaths.filter((path) => !palettePaths.has(path));
    expect(missing, `command palette is missing nav destinations: ${missing.join(", ")}`).toEqual(
      [],
    );
  });

  it("includes Settings (a real destination that lives in the shell footer, not a nav group)", () => {
    expect(palettePaths.has("/settings")).toBe(true);
  });

  it("reaches the five destinations the old hand-kept 'Go to' list dropped", () => {
    const previouslyMissed = [
      "/assistant",
      "/assistant/sessions",
      "/assistant/agents",
      "/assistant/projects",
      "/assistant/audit",
    ];
    for (const path of previouslyMissed) {
      expect(palettePaths.has(path), `command palette should reach ${path}`).toBe(true);
    }
  });

  it("invents no destinations — every palette entry is a real nav path or Settings", () => {
    const known = new Set([...navPaths, "/settings"]);
    for (const path of palettePaths) {
      expect(known.has(path), `command palette has an unknown destination: ${path}`).toBe(true);
    }
  });
});
