import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  ASSISTANT_ENTITY_KINDS,
  ASSISTANT_ROUTE_MANIFEST,
  ASSISTANT_UI_VIEWS,
  resolveStarterSurface,
  type AssistantRouteManifestEntry,
} from "@mcp-token-footprint/shared";

// ==================================================================================================
// Assistant operability (WP 1.1, D-AO1) — the HARD gate over the route manifest
// ==================================================================================================
// "Every route a user can land on resolves to a real, page-appropriate assistant surface — or is a
// declared redirect/exemption" is a whole-repo invariant: a join across App.tsx's `<Routes>` table,
// the `resolveStarterSurface` resolver, `resolveEntityPin`, and the `ASSISTANT_UI_VIEWS` registry. A
// PostToolUse hook only sees one edited file and can't evaluate that join (D-AO1) — so the enforcement
// is THIS test, run inside `pnpm test`.
//
// The manifest (`packages/shared/src/assistant-route-manifest.ts`) is an assertion harness pinned to
// the live resolvers, not a generator. The resolvers are ground truth: if a check here fails, the
// manifest is wrong — re-derive it, never the resolver. This file covers the shared-side checks
// (A: coverage, B: operability, C-shared: surface conformance + addressable↔views). The pin
// conformance check (Test C-web) lives in `apps/web/.../assistant-route-operability.test.tsx` because
// `resolveEntityPin`/`deriveAssistantEnvelope` are a React `.tsx` in `apps/web` that a node-runner
// test may not import (architecture.md forbids api↔web source imports; the runner can't load `.tsx`).
//
// Modeled on `assistant-starters-catalog.test.ts` (node:test + node:assert/strict, pure over
// `@mcp-token-footprint/shared` exports; `packages/shared` has no test runner of its own).

// The single manifest-only pattern: `/settings/:section` is a deep-linkable settings MODAL (D-TB10)
// rendered as an overlay via `matchPath` in App.tsx, NOT a `<Route>` — so it is expected to appear in
// the manifest with no matching App.tsx `path="…"` literal.
const MANIFEST_ONLY_KNOWN_EXTRAS = new Set<string>(["/settings/:section"]);

/** Read App.tsx and extract every `path="…"` literal, defensively ignoring commented-out lines. */
function appTsxRoutePatterns(): Set<string> {
  const appSource = readFileSync(
    path.resolve(import.meta.dirname, "../../web/src/App.tsx"),
    "utf8",
  );
  // Strip block comments (incl. JSX `{/* … */}`) and whole-line `//` comments so a commented-out
  // `<Route path="/foo" …>` can never be miscounted as a live route (there are none today; this is
  // future-proofing so the gate can't be quietly defeated by commenting a route out).
  const stripped = appSource
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  const patterns = new Set<string>();
  for (const match of stripped.matchAll(/path="([^"]+)"/g)) {
    patterns.add(match[1] as string);
  }
  return patterns;
}

/** Replace each `:param` segment of a route pattern with a concrete sample id. */
function concretePath(pattern: string): string {
  return pattern
    .split("/")
    .map((segment) => (segment.startsWith(":") ? "__id__" : segment))
    .join("/");
}

const manifestPatterns = new Set(ASSISTANT_ROUTE_MANIFEST.map((e) => e.pattern));

// ── Test A — coverage: App.tsx routes ↔ manifest ────────────────────────────────────────────────────

test("Test A: every App.tsx path= literal has exactly one manifest entry (and vice versa, minus known-extras)", () => {
  const appPatterns = appTsxRoutePatterns();

  // Sanity: the manifest has no duplicate patterns (a duplicate would hide a coverage gap).
  assert.equal(
    manifestPatterns.size,
    ASSISTANT_ROUTE_MANIFEST.length,
    "duplicate `pattern` in ASSISTANT_ROUTE_MANIFEST",
  );

  const manifestCoveringRoutes = new Set(
    [...manifestPatterns].filter((p) => !MANIFEST_ONLY_KNOWN_EXTRAS.has(p)),
  );

  const missingFromManifest = [...appPatterns].filter((p) => !manifestCoveringRoutes.has(p)).sort();
  const extraInManifest = [...manifestCoveringRoutes].filter((p) => !appPatterns.has(p)).sort();

  assert.deepEqual(
    missingFromManifest,
    [],
    `App.tsx routes with NO manifest entry (add one with a real surface or a reasoned exempt/redirect): ${JSON.stringify(missingFromManifest)}`,
  );
  assert.deepEqual(
    extraInManifest,
    [],
    `manifest entries that are NOT an App.tsx route and NOT a documented known-extra (${JSON.stringify([...MANIFEST_ONLY_KNOWN_EXTRAS])}): ${JSON.stringify(extraInManifest)}`,
  );

  // And the direct set-equality the plan specifies: App.tsx set === manifest patterns − known-extras.
  assert.deepEqual(
    [...manifestCoveringRoutes].sort(),
    [...appPatterns].sort(),
    "App.tsx route set must equal the manifest patterns minus MANIFEST_ONLY_KNOWN_EXTRAS",
  );
});

// ── Test B — operability: no silent `global` fallback ─────────────────────────────────────────────

test("Test B: every entry is a redirect, OR a non-global surface, OR global WITH a non-empty exempt reason", () => {
  for (const entry of ASSISTANT_ROUTE_MANIFEST) {
    const ok =
      entry.surface === "redirect" ||
      entry.surface !== "global" ||
      (entry.exempt !== undefined && entry.exempt.trim().length > 0);
    assert.ok(
      ok,
      `${entry.pattern} is surface:"global" with no exempt reason — declare a real page-appropriate surface, a redirect, or a reasoned exempt (D-AO4).`,
    );
  }
});

// ── Test C-shared — surface conformance: the manifest agrees with the live resolver ──────────────────

test("Test C-shared: resolveStarterSurface agrees with every non-redirect entry's declared surface", () => {
  for (const entry of ASSISTANT_ROUTE_MANIFEST) {
    if (entry.surface === "redirect") continue;
    const resolved = resolveStarterSurface({
      entityKind: entry.pin,
      route: concretePath(entry.pattern),
    });
    assert.equal(
      resolved,
      entry.surface,
      `${entry.pattern}: resolveStarterSurface({entityKind:${JSON.stringify(entry.pin)}, route:${JSON.stringify(concretePath(entry.pattern))}}) === ${JSON.stringify(resolved)}, but the manifest declares ${JSON.stringify(entry.surface)}`,
    );
  }
});

// ── Test C-shared — addressable ↔ ASSISTANT_UI_VIEWS ────────────────────────────────────────────────

test("Test C-shared: the addressable entries' views reconcile 1:1 with ASSISTANT_UI_VIEWS", () => {
  const addressable = ASSISTANT_ROUTE_MANIFEST.filter((e) => e.addressable);

  // Every addressable entry must name a `view`, and that view must be a real registry member.
  for (const entry of addressable) {
    assert.ok(
      entry.view !== undefined,
      `${entry.pattern} is addressable but names no view (must map to an ASSISTANT_UI_VIEWS member)`,
    );
    assert.ok(
      (ASSISTANT_UI_VIEWS as readonly string[]).includes(entry.view as string),
      `${entry.pattern}: view "${entry.view}" is not in ASSISTANT_UI_VIEWS (${JSON.stringify(ASSISTANT_UI_VIEWS)})`,
    );
  }

  // The set of addressable views equals the full registry — every navigable view is reachable via
  // exactly one addressable route, and no addressable route names a view the registry doesn't own.
  const addressableViews = new Set(addressable.map((e) => e.view as string));
  assert.deepEqual(
    [...addressableViews].sort(),
    [...ASSISTANT_UI_VIEWS].sort(),
    "the addressable entries' views must exactly cover ASSISTANT_UI_VIEWS",
  );
});

// ── Test C-shared — every declared pin is a real entity kind ─────────────────────────────────────────

test("Test C-shared: every entry's pin (when set) is a member of ASSISTANT_ENTITY_KINDS", () => {
  for (const entry of ASSISTANT_ROUTE_MANIFEST) {
    if (entry.pin === undefined) continue;
    assert.ok(
      (ASSISTANT_ENTITY_KINDS as readonly string[]).includes(entry.pin),
      `${entry.pattern}: pin "${entry.pin}" is not in ASSISTANT_ENTITY_KINDS (${JSON.stringify(ASSISTANT_ENTITY_KINDS)})`,
    );
  }
});

// A tiny type-level assurance that the imported entry type is what the tests reason about.
const _typecheck: AssistantRouteManifestEntry = ASSISTANT_ROUTE_MANIFEST[0] as AssistantRouteManifestEntry;
void _typecheck;
