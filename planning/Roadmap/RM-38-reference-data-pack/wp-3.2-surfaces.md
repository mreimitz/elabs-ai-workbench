---
type: "Work Package Spec"
title: "WP 3.2 — the data-pack routes, the Settings row, diagnostics, and the version stamp on every verdict"
description: "Phase 3 of item.md. Ledger: STATUS.md. A verdict that cannot name the data it was computed against is not reproducible."
tags: ["roadmap", "RM-38"]
timestamp: "2026-08-22T18:40:00Z"
status: "final"
---
# WP 3.2 — the routes, the Settings row, diagnostics, and the version stamp

Phase 3 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md). **Depends on WP 3.1.**

## Scope

1. **`GET /api/data-pack`** — the resolved pack's `packVersion`, `schemaVersion`, `asOf`, `source`
   (`bundled` | `cache` | `fetched`), `lastCheckedAt`, and `lastRefusal` (reason + when + the pack
   version that was refused), plus the security `analyzerVersion` in force. Contract in
   `packages/shared/src/data-pack.ts` first, then API, then web (contract-first rule).

2. **`POST /api/data-pack/refresh`** — run the WP 3.1 check on demand and answer with the same shape.
   It is a **read of remote data plus a local swap**; it takes no body and creates nothing, so it needs
   no new token scope — but confirm against `requiredScopesForMethod` that a `POST` from a
   token-authenticated caller resolves the way you intend, and if it needs relaxing, do it through
   `API_TOKEN_ROUTE_SCOPES` (which can only ever relax) rather than by loosening the coarse rule.

3. **Settings row** — in the existing Settings surface, alongside the pricing editor which is the
   closest precedent. Shows version, `asOf`, source, last check, the last refusal **in plain words**
   ("the published pack could not be verified — the app is still using the version it shipped with"),
   and a **Check now** button. `@elabs-ai/components-*` only; both themes; keyboard reachable; the
   IconButton rule if any control is icon-only.

4. **Diagnostics** — a `dataPack` group in `GET /api/diagnostics{,/markdown}`. It carries versions,
   source, timestamps and refusal reasons. **It must not carry `DATA_PACK_URL`'s value** — WP 1.3 of
   RM-18 made the environment group emit `{ name, status }` from a hard-coded catalogue precisely so no
   value can reach the document; add `DATA_PACK_URL` to that catalogue, do not special-case it.

5. **The stamp (D-DP8).** `packVersion` is recorded in: the security report JSON + its Markdown section,
   the security diff, the advisor report, the compatibility report, the CI assertion gate document
   (`renderAssertionMarkdown`), and the run/scan report exports where a threshold influenced a number.
   Additive fields only — the wire is versionless and additive during the MVP.

## Explicitly out of scope

No scheduled re-check. No pack authoring UI — a pack is edited in the repository, not in the app.
No new feature flag (this is not an optional capability; the pack is always resolved, only the *fetch*
is switchable, and that is an env var from WP 3.1).

## Acceptance

- [ ] Route contract lands in `packages/shared` first; both ends typecheck against it.
- [ ] `assistant-route-operability` gate stays green — if a web route is added, it carries a real
      surface or a reasoned exemption naming this WP.
- [ ] The Settings row reads correctly in **light and dark**, verified by looking at the running app
      (`http://localhost:8081/`), not a mock, and every control is keyboard reachable with visible focus.
- [ ] The refusal state renders as an honest sentence, not an empty success state — a failed check must
      never look like a successful one (the RM-17 lesson where an empty window reported as "recovered").
- [ ] A diagnostics sentinel sweep proves `DATA_PACK_URL`'s **value** never reaches the bundle.
- [ ] Every stamped document names the pack version; a test reads each document and fails on a missing
      stamp.
- [ ] Gate green.

## Teeth

1. Force a refusal, open Settings → the row says which pack was refused and why, and says the app is
   still on the previous one.
2. Put a secret-looking value in `DATA_PACK_URL` → the sentinel sweep goes red if it appears anywhere
   in the diagnostics document.
3. Remove the stamp from one report builder → its stamp test goes red.
