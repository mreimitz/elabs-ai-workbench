import { describe, expect, test } from "vitest";
import { ASSISTANT_ROUTE_MANIFEST } from "@mcp-token-footprint/shared";
import { deriveAssistantEnvelope } from "./assistant-context";

// ==================================================================================================
// Assistant operability (WP 1.1, D-AO1) — the WEB half of the operability gate (Test C-web)
// ==================================================================================================
// Pin conformance: for every route in the manifest, the client-side envelope resolver
// (`deriveAssistantEnvelope` → `resolveEntityPin`, in `assistant-context.tsx`) must agree with the
// manifest's `pin`. This lives in `apps/web` (not the node-runner api gate) because
// `deriveAssistantEnvelope` is a React `.tsx` module a node:test file may not import (architecture.md
// forbids api↔web source imports; the runner can't load `.tsx`). Together with the api gate's Test C
// (surface conformance via `resolveStarterSurface`), the manifest is pinned to BOTH live resolvers.
//
// The resolvers are ground truth — if this fails, the manifest is wrong, re-derive it.

// The one manifest-only pattern — a settings MODAL (matchPath overlay), not an App.tsx `<Route>`, so
// there is no landable route for `deriveAssistantEnvelope` to resolve against; skipped like redirects.
const MANIFEST_ONLY_KNOWN_EXTRAS = new Set<string>(["/settings/:section"]);

const SAMPLE_ID = "__id__";

/** Replace each `:param` segment of a route pattern with a concrete sample id. */
function concretePath(pattern: string): string {
  return pattern
    .split("/")
    .map((segment) => (segment.startsWith(":") ? SAMPLE_ID : segment))
    .join("/");
}

describe("Test C-web: deriveAssistantEnvelope pin conformance vs. the route manifest", () => {
  for (const entry of ASSISTANT_ROUTE_MANIFEST) {
    // A `<Navigate>` route never lands on a paintable surface; the settings modal has no `<Route>`.
    if (entry.surface === "redirect" || MANIFEST_ONLY_KNOWN_EXTRAS.has(entry.pattern)) continue;

    const route = concretePath(entry.pattern);

    if (entry.pin !== undefined) {
      test(`${entry.pattern} pins to {kind: ${entry.pin}, id: ${SAMPLE_ID}}`, () => {
        const envelope = deriveAssistantEnvelope(route, "");
        expect(envelope.entityKind).toBe(entry.pin);
        expect(envelope.entityId).toBe(SAMPLE_ID);
      });
    } else {
      // A non-redirect entry with no pin (global-exempt list/config pages, compare, compatibility,
      // hub, and the run launcher/compare siblings the pin resolver deliberately leaves unpinned via
      // NON_RUN_ID_SEGMENTS) must carry NO entity pin — a fabricated pin would silently widen the
      // dock's write scope.
      test(`${entry.pattern} carries no entity pin`, () => {
        const envelope = deriveAssistantEnvelope(route, "");
        expect(envelope.entityKind).toBeUndefined();
        expect(envelope.entityId).toBeUndefined();
      });
    }
  }
});
