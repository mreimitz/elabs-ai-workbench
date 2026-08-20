import type { AssistantStarterSurface } from "./assistant-starters.js";
import type { AssistantEntityKind } from "./types.js";

// ==================================================================================================
// Assistant operability (WP 1.1, D-AO1/D-AO2/D-AO4) — the route manifest (single source of truth)
// ==================================================================================================
// ONE declared entry per react-router `<Route>` in `apps/web/src/App.tsx` (plus one documented
// known-extra, `/settings/:section` — a deep-linkable settings MODAL rendered via `matchPath`, not an
// App.tsx `<Route>`; see D-TB10). This is the one declaration a developer touches when adding a route:
// give the new route a real, page-appropriate `surface` (forcing the dock to be context-aware) — or a
// reasoned `redirect` / `exempt`, the operability analogue of `brand-ui-allow:` (D-AO4).
//
// The manifest is an ASSERTION HARNESS pinned to the live resolvers, NOT a generator. The resolvers
// (`resolveStarterSurface` in `./assistant-starters.js`, `resolveEntityPin` /
// `deriveAssistantEnvelope` in `apps/web/src/features/assistant/assistant-context.tsx`, and the
// `ASSISTANT_UI_VIEWS` registry in `./assistant-ui-registry.js`) are ground truth; the operability
// gate (`apps/api/test/assistant-route-operability.test.ts` + the web sibling
// `apps/web/src/features/assistant/assistant-route-operability.test.tsx`) proves this manifest agrees
// with all three. If an assertion fails, the manifest is wrong — re-derive it against the resolver,
// never the reverse.
//
// The gate has four checks:
//   A (coverage)     — every `path="…"` literal in App.tsx has exactly one manifest entry, and the
//                      only manifest entry WITHOUT an App.tsx route is `/settings/:section`.
//   B (operability)  — every entry is `redirect`, OR its surface is non-`global`, OR it is
//                      `global` WITH a non-empty `exempt` reason. No silent `global` fallback.
//   C (surface)      — for every non-redirect entry, `resolveStarterSurface({entityKind: pin, route})`
//                      on the concrete path equals `surface`.
//   C (addressable)  — the `view`s of the `addressable` entries reconcile 1:1 with `ASSISTANT_UI_VIEWS`.

/**
 * One route → the assistant surface it resolves to, plus the entity pin / addressable-view / exemption
 * metadata the operability gate cross-checks against the live resolvers.
 */
export type AssistantRouteManifestEntry = {
  /** Byte-identical to the `path="…"` literal in `apps/web/src/App.tsx` (or a documented known-extra). */
  pattern: string;
  /** The surface the dock resolves for this route, OR `"redirect"` for a `<Navigate>` route. */
  surface: AssistantStarterSurface | "redirect";
  /** Set when the URL names one entity — the {@link AssistantEntityKind} `resolveEntityPin` returns. */
  pin?: AssistantEntityKind;
  /** True when an agent can `ui_navigate` to this route (maps 1:1 to an `ASSISTANT_UI_VIEWS` member). */
  addressable?: boolean;
  /** The `ASSISTANT_UI_VIEWS` member this addressable route maps to (only on addressable entries). */
  view?: string;
  /** Non-empty reason REQUIRED whenever `surface === "global"` and this is not a redirect (D-AO4). */
  exempt?: string;
};

/**
 * The manifest: exactly one entry per App.tsx `path="…"` literal, plus the `/settings/:section`
 * known-extra. Grouped by kind for readability — the gate treats it as one flat set.
 */
export const ASSISTANT_ROUTE_MANIFEST: readonly AssistantRouteManifestEntry[] = [
  // ── Redirects (`<Navigate>` routes — nothing to be context-aware ABOUT; they hand the router a new
  //    location before painting) ────────────────────────────────────────────────────────────────────
  { pattern: "/", surface: "redirect" }, // → /dashboard
  { pattern: "/compare", surface: "redirect" }, // → /compare/scans
  { pattern: "/assistant/memory", surface: "redirect" }, // → /assistant?memory=profile
  { pattern: "/assistant/usage", surface: "redirect" }, // → /assistant/agents?tab=usage
  { pattern: "/testing", surface: "redirect" }, // → /testing/collections
  { pattern: "/testing/scenarios", surface: "redirect" }, // → /testing/environments
  { pattern: "/testing/compare", surface: "redirect" }, // → /testing/runs/compare
  { pattern: "/testing/runs/review", surface: "redirect" }, // → /testing/review

  // ── Entity-pinned (the URL names one entity → the surface IS that entity kind) ──────────────────────
  { pattern: "/servers/:serverId", surface: "server", pin: "server", addressable: true, view: "server" },
  { pattern: "/scans/:scanId", surface: "scan", pin: "scan", addressable: true, view: "scan" },
  { pattern: "/skills/:skillId", surface: "skill", pin: "skill", addressable: true, view: "skill" },
  { pattern: "/testing/runs/:runId", surface: "run", pin: "run", addressable: true, view: "run" },
  {
    pattern: "/testing/suite-runs/:suiteRunId",
    surface: "suite_run",
    pin: "suite_run",
    addressable: true,
    view: "suite_run",
  },
  // Collection is pinned (has a `collection` entity kind + write scope) but is NOT in the addressable
  // `ASSISTANT_UI_VIEWS` registry — the dock can't `ui_navigate` to a collection today.
  { pattern: "/testing/collections/:collectionId", surface: "collection", pin: "collection" },
  // Scan-report page (assistant-operability WP 4.2, D-AO4 upgrade from the Phase 1 `global`+exempt
  // baseline): names the SAME scan id a `/scans/:scanId` detail page would, so it pins to the EXISTING
  // `scan` entity kind (D-AO3 — no new entity kind). Not addressable — the dock can't `ui_navigate` to
  // the report route (only to `/scans/:scanId`, which already owns the `scan` view).
  { pattern: "/reports/scans/:scanId", surface: "scan", pin: "scan" },

  // ── Compare (a real surface with no single-entity pin — a comparison names no one entity, by
  //    design; see `resolveEntityPin`'s doc + `COMPARE_ROUTES`) ─────────────────────────────────────
  { pattern: "/compare/scans", surface: "compare" },
  { pattern: "/testing/runs/compare", surface: "compare", addressable: true, view: "compare" },

  // ── Compatibility (a real surface scoring a scan against models — no `AssistantEntityKind` of its
  //    own; see `COMPATIBILITY_ROUTE`) ────────────────────────────────────────────────────────────
  { pattern: "/testing/compatibility", surface: "compatibility" },

  // ── Global + reasoned exemption (D-AO4) — pages whose operable surface is a drill-in detail, a
  //    management/config surface with no single pin, a launcher with no entity yet, or the canonical
  //    global home. Every one carries an honest, specific reason. ────────────────────────────────────
  {
    pattern: "/dashboard",
    surface: "global",
    exempt: "Canonical global surface — the intended home of the global starter set.",
  },
  {
    pattern: "/servers",
    surface: "global",
    exempt: "List page; the operable surface is the drill-in /servers/:serverId detail.",
  },
  {
    pattern: "/scans",
    surface: "global",
    exempt: "List page; the operable surface is the drill-in /scans/:scanId detail.",
  },
  {
    pattern: "/skills",
    surface: "global",
    exempt: "List page; the operable surface is the drill-in /skills/:skillId detail.",
  },
  {
    pattern: "/testing/runs",
    surface: "global",
    exempt: "Runs feed; the operable surface is the drill-in /testing/runs/:runId console.",
  },
  {
    pattern: "/testing/suites",
    surface: "global",
    exempt: "List page; drill-in is /testing/suites/:suiteId.",
  },
  {
    pattern: "/testing/collections",
    surface: "global",
    exempt: "List page; the operable surface is /testing/collections/:collectionId.",
  },
  {
    pattern: "/testing/environments",
    surface: "global",
    exempt:
      "Selection held in React state, not the URL (no per-entity pin yet — see resolveStarterSurface doc); deferred until it URL-encodes its selection (out of WP 4.2's scan-pin-only scope).",
  },
  {
    pattern: "/testing/runs/new",
    surface: "global",
    exempt: "Run launcher — no entity exists yet.",
  },
  {
    pattern: "/testing/suites/:suiteId",
    surface: "global",
    exempt: "No `suite` entity kind (frozen write-scope vocabulary, D-AS7/D-AO3).",
  },
  {
    pattern: "/testing/review",
    surface: "global",
    exempt: "Management/config surface, no single entity to pin.",
  },
  {
    pattern: "/testing/observability/rules",
    surface: "global",
    exempt: "Management/config surface, no single entity to pin.",
  },
  {
    pattern: "/testing/observability/review-rubrics",
    surface: "global",
    exempt: "Management/config surface, no single entity to pin.",
  },
  {
    pattern: "/reports/digest/:id",
    surface: "global",
    exempt: "Report route, no single-entity dock surface.",
  },
  {
    // Advisor (planning/Roadmap/RM-01-advisor/ WP 1.3). A report ROUTE whose subject is chosen in the URL query
    // (`?scope=server|scenario|fleet&id=…`), not the path — so `resolveEntityPin` (which reads the
    // PATHNAME only) names no entity here, exactly as for `/reports/digest/:id` above. The operable
    // per-entity surfaces already exist and are pinned: `/servers/:serverId` (which carries the
    // inline advisor panel) and, once environments URL-encode their selection, the environment
    // detail. A dedicated `advisor` starter surface would need advisor-aware assistant read tools,
    // which are not in WP 1.3's scope — this exemption is the visible record of that.
    pattern: "/advisor",
    surface: "global",
    exempt:
      "Advisor report route; the subject is a URL QUERY (?scope=&id=), not a path param, so there is no single entity to pin. The operable per-entity surface is /servers/:serverId (which hosts the inline advisor panel); a dedicated `advisor` starter surface needs advisor-aware assistant read tools, out of advisor WP 1.3's scope.",
  },
  { pattern: "*", surface: "global", exempt: "404 catch-all." },

  // ── Hub routes — real, route-keyed surfaces (assistant-operability WP 2.1, D-AO3). Flipped from the
  //    Phase 1 `global`+exempt baseline: `resolveStarterSurface` now resolves `/assistant/agents*` to
  //    `"agents"` and the other 4 hub routes to `"hub"` (Test C-shared proves the resolver agrees), so
  //    the dock shows page-relevant chips instead of the generic global set. Neither surface is an
  //    `AssistantEntityKind` — no `pin` here, same as `compare`/`compatibility` above. ────────────────
  { pattern: "/assistant", surface: "hub" },
  { pattern: "/assistant/sessions", surface: "hub" },
  { pattern: "/assistant/projects", surface: "hub" },
  { pattern: "/assistant/audit", surface: "hub" },
  { pattern: "/assistant/agents", surface: "agents" },
  { pattern: "/assistant/agents/agent/:agentId", surface: "agents" },
  { pattern: "/assistant/agents/crew/:crewId", surface: "agents" },

  // ── Known-extra (in the manifest, NOT an App.tsx `<Route>`) ─────────────────────────────────────────
  // `/settings/:section` is a deep-linkable settings MODAL (D-TB10) rendered as an overlay via
  // `matchPath` in App.tsx, not a `<Route>` — so Test A allows it as the one manifest-only pattern.
  // It is addressable (`ui_navigate` view=settings) but has no entity to pin, so it stays `global`.
  {
    pattern: "/settings/:section",
    surface: "global",
    addressable: true,
    view: "settings",
    exempt:
      "Deep-linkable settings modal (D-TB10) rendered as an overlay via matchPath, not an App.tsx <Route>; reachable via ui_navigate view=settings.",
  },
];
