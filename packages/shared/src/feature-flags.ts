import { z } from "zod";

// ==================================================================================================
// App feature flags — the operator's on/off switches for whole app capabilities (Settings › Features)
// ==================================================================================================
// One registry, read by BOTH ends:
//
//   • `apps/api` persists the flag blob in the existing `app_settings` KV table under
//     `APP_SETTING_FEATURES_KEY` (no migration, no new table) and enforces `apiPrefixes` with a
//     single `onRequest` guard, so a disabled feature cannot be driven by a stale browser tab, a
//     bookmarked URL, or a direct `curl`.
//   • `apps/web` hides the feature's nav entries, its dock/page-hook entry points, and swaps its
//     routes' elements for a "turned off" panel that links back here.
//
// Design rules baked in on purpose:
//
//   1. **Absent means ENABLED.** A missing key, an unknown id, or a corrupt row resolves to the
//      default (`true`). A settings store that fails to read must never silently switch a capability
//      off — the failure mode of an off-switch has to be "stays on", not "everything vanished".
//   2. **The registry is the single source of truth.** A feature's label, description, the surfaces
//      it owns, and the API prefixes its guard covers are declared here ONCE. Adding feature #2 is
//      one entry here plus its web gate — not a new settings section, route, or table.
//   3. **Route prefixes never remove a `<Route>`.** `routePrefixes` tells the web app which routes
//      render the disabled panel; the `path="…"` literals in `App.tsx` stay exactly as they are, so
//      the `assistant-route-operability` gate (`.claude/rules/assistant-operability.md`) keeps its
//      byte-identical string-set equality with `ASSISTANT_ROUTE_MANIFEST`.

/** Every switchable feature id. Order here is the order the Settings › Features rows render in. */
export const APP_FEATURE_IDS = ["assistant"] as const;

export type AppFeatureId = (typeof APP_FEATURE_IDS)[number];

export function isAppFeatureId(value: string | null | undefined): value is AppFeatureId {
  return value != null && (APP_FEATURE_IDS as readonly string[]).includes(value);
}

/** What one feature is, and exactly what turning it off switches off. */
export type AppFeatureMeta = {
  id: AppFeatureId;
  /** Settings row label. */
  label: string;
  /** Settings row help text — one sentence, says what the feature IS. */
  description: string;
  /** Plain-language list of the surfaces that disappear while the feature is off (shown in the
   *  turn-off confirmation, so the operator sees the blast radius before committing). */
  surfaces: string[];
  /** URL path prefixes whose routes render the "turned off" panel while the feature is off. A path
   *  matches when it equals the prefix or continues with `/`. */
  routePrefixes: string[];
  /** API path prefixes the server-side guard rejects with 403 while the feature is off. */
  apiPrefixes: string[];
};

export const APP_FEATURE_META: Record<AppFeatureId, AppFeatureMeta> = {
  assistant: {
    id: "assistant",
    label: "Assistant",
    description:
      "The AI assistant: the full-page Assistant workspace with its agents, crews, projects and audit trail, plus the App-assistant dock that answers about the page you are on.",
    surfaces: [
      "The Assistant, Sessions, Agents & Crews, Projects and Audit items in the sidebar",
      "The App-assistant dock and its ⌘J shortcut",
      "The “Ask the assistant” buttons on pages that offer them",
      "The /api/assistant and /api/hub endpoints (they answer 403 while off)",
    ],
    routePrefixes: ["/assistant"],
    apiPrefixes: ["/api/assistant", "/api/hub"],
  },
};

/** The full flag map: one boolean per registered feature. */
export type AppFeatureFlags = Record<AppFeatureId, boolean>;

/** Every feature ships ON. A fresh install, an unreadable store, and a partial blob all land here. */
export const DEFAULT_APP_FEATURE_FLAGS: AppFeatureFlags = APP_FEATURE_IDS.reduce(
  (flags, id) => {
    flags[id] = true;
    return flags;
  },
  {} as AppFeatureFlags,
);

/** The `app_settings` key the flag blob lives under (a JSON object of `{ [featureId]: boolean }`). */
export const APP_SETTING_FEATURES_KEY = "app.features";

/** The wire shape of `GET`/`PUT /api/features`. */
export type AppFeatureFlagsResponse = { flags: AppFeatureFlags };

/** Full flag map on the wire — every id required, so a response is always complete. */
export const appFeatureFlagsSchema = z.object(
  APP_FEATURE_IDS.reduce(
    (shape, id) => {
      shape[id] = z.boolean();
      return shape;
    },
    {} as Record<AppFeatureId, z.ZodBoolean>,
  ),
) as z.ZodType<AppFeatureFlags>;

/** `PUT /api/features` body — a PARTIAL patch, so a caller flips one switch without having to echo
 *  back (and possibly clobber) the others. `.strict()` rejects an unknown feature id loudly rather
 *  than accepting a typo that would silently do nothing. */
export const appFeatureFlagsUpdateSchema = z
  .object(
    APP_FEATURE_IDS.reduce(
      (shape, id) => {
        shape[id] = z.boolean().optional();
        return shape;
      },
      {} as Record<AppFeatureId, z.ZodOptional<z.ZodBoolean>>,
    ),
  )
  .strict();

export type AppFeatureFlagsUpdate = Partial<AppFeatureFlags>;

/**
 * Merge an untrusted stored/received value over the defaults. Anything that is not an explicit
 * `false` for a KNOWN id resolves to enabled (rule 1 above): unknown keys are dropped, non-boolean
 * values are ignored, and a non-object (missing key, corrupt JSON already swallowed by the KV store)
 * yields the plain defaults.
 */
export function resolveFeatureFlags(value: unknown): AppFeatureFlags {
  const flags: AppFeatureFlags = { ...DEFAULT_APP_FEATURE_FLAGS };
  if (typeof value !== "object" || value === null || Array.isArray(value)) return flags;
  const record = value as Record<string, unknown>;
  for (const id of APP_FEATURE_IDS) {
    const stored = record[id];
    if (typeof stored === "boolean") flags[id] = stored;
  }
  return flags;
}

/** Whether `feature` is on. A `null`/`undefined` map (flags not loaded yet) reads as ON, so nothing
 *  flickers away during boot and a fetch failure never hides the app. */
export function isFeatureEnabled(
  flags: AppFeatureFlags | null | undefined,
  feature: AppFeatureId,
): boolean {
  if (!flags) return DEFAULT_APP_FEATURE_FLAGS[feature];
  return flags[feature];
}

/** Prefix match used by BOTH the API guard (`/api/hub` matches `/api/hub/sessions`) and the web
 *  route gate (`/assistant` matches `/assistant/agents`). An exact equal or a `/`-delimited
 *  continuation only — never a bare `startsWith`, which would also match `/assistant-foo`. */
export function pathMatchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * The feature that owns `path`, or `undefined` when no registered feature claims it.
 * `kind` picks which prefix list is consulted — `"route"` for browser URLs, `"api"` for server
 * request URLs.
 */
export function featureForPath(
  path: string,
  kind: "route" | "api",
): AppFeatureMeta | undefined {
  for (const id of APP_FEATURE_IDS) {
    const meta = APP_FEATURE_META[id];
    const prefixes = kind === "route" ? meta.routePrefixes : meta.apiPrefixes;
    if (prefixes.some((prefix) => pathMatchesPrefix(path, prefix))) return meta;
  }
  return undefined;
}

/** Machine-readable marker on the 403 body a disabled feature's API guard returns. */
export const FEATURE_DISABLED_ERROR_CODE = "feature_disabled";
