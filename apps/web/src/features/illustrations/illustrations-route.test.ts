import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ASSISTANT_ROUTE_MANIFEST } from "@mcp-token-footprint/shared";
import { describe, expect, test } from "vitest";
import { PAGESHELL_EXACT_ROUTES, isPageShellRoute } from "../../App";

// ==================================================================================================
// `/illustrations` must be present in BOTH route registries (RM-14 WP 0.3, spec §4 + §4b)
// ==================================================================================================
// The two are gated very differently, which is the whole reason this file exists.
//
//   ASSISTANT_ROUTE_MANIFEST — hard-gated in both directions by `assistant-route-operability`. A
//     route with no entry fails; an entry with no route fails. Nothing extra is needed here, and the
//     assertion below is a signpost rather than the guard.
//
//   PAGESHELL_EXACT_ROUTES — gated in ONE direction only. `App.test.ts`'s grep-proof check catches a
//     DEAD entry (a registry line naming a route that no longer exists). The opposite direction — a
//     route with no entry — is not gated anywhere: the page simply mounts padded and scrolling
//     instead of edge-to-edge, and nothing goes red. That is exactly the silent failure this WP was
//     warned about, so the missing-entry direction is asserted here, for this route, explicitly.
//
// Note what this file does NOT claim: that the page LOOKS right. A registry entry is necessary for
// the full-bleed mount and not sufficient to prove it — that was confirmed by looking at the running
// app, and the screenshots are recorded in the ledger.

const ROUTE = "/illustrations";

const APP_SOURCE = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "App.tsx"),
  "utf8",
);

describe("/illustrations — route registration", () => {
  test("App.tsx declares the route exactly as both registries spell it", () => {
    expect(APP_SOURCE).toContain(`<Route path="${ROUTE}"`);
  });

  test("the assistant route manifest carries exactly one entry for it, with a reasoned exemption", () => {
    const entries = ASSISTANT_ROUTE_MANIFEST.filter((entry) => entry.pattern === ROUTE);
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    // Catalog page, no app entity to operate — so it is a `global` surface, which the operability
    // rule only permits WITH a reason (D-AO4). The reason must name the WP that retires it.
    expect(entry?.surface).toBe("global");
    expect(entry?.exempt).toMatch(/WP 4\.1/);
    // D-AO3: the write-scope vocabulary is a security boundary. A catalog page pins no entity.
    expect(entry?.pin).toBeUndefined();
  });

  test("the PageShell registry mounts it full-bleed — the direction NO test gates (spec §4b)", () => {
    expect(PAGESHELL_EXACT_ROUTES.has(ROUTE)).toBe(true);
    expect(isPageShellRoute(ROUTE)).toBe(true);
  });

  test("it is registered as an EXACT route, not as a prefix nobody reconciles", () => {
    // `PAGESHELL_ROUTE_PREFIXES` is ungated in both directions, and a trailing-slash prefix does not
    // cover its own bare path (`"/illustrations".startsWith("/illustrations/")` is false), so a
    // prefix registration would leave this very route unmounted with nothing to notice it.
    expect(isPageShellRoute("/illustrations-not-a-real-route")).toBe(false);
  });
});
