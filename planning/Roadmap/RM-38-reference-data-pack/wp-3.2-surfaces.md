---
type: "Work Package Spec"
title: "WP 3.2 — the data-pack routes, the Settings row, diagnostics, and the version stamp on every verdict"
description: "Phase 3 of item.md. Ledger: STATUS.md. A verdict that cannot name the data it was computed against is not reproducible."
tags: ["roadmap", "RM-38"]
timestamp: "2026-08-23T09:35:00Z"
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

6. **THE BROWSER MUST NOT LAG THE API — owner ruling 2026-08-23.** WP 2.2 left a real gap and
   handed it here: `apps/web` reads the **compiled floor** (`pack-defaults.generated.ts`,
   `BUNDLED_SECURITY_RULES`), not the pack in force, because `packages/shared` may not touch the
   filesystem. Once WP 3.1 can fetch a pack, the API's answers change while the browser's model list,
   compare default and security rule table stay on what shipped in the image. The owner was given the
   choice between fixing this here and stating it plainly, and **chose to fix it here.**

   **The consumer surface, measured on `main` at `ff7cf8b` — not assumed.** Six live sites, one of
   which the ledger never named:

   | Site | Reads | If the pack changes and the browser does not |
   | --- | --- | --- |
   | `features/testing/allow-list.ts:186,207` | `Object.keys(MODEL_CONTEXT_LIMITS)`, `hasOwnProperty` | the model picker offers the image's roster; a model the API accepts reads as unknown |
   | `features/testing/RunConsole.tsx:656` | `MODEL_CONTEXT_LIMITS[model] ?? 0` | **`0` disables the "% of context used" surface entirely** — a fabricated-looking answer, not an error |
   | `features/compare/CompareView.tsx:166` | `useState(DEFAULT_COMPARE_THRESHOLD)` | the compare view opens on the old default |
   | `features/testing/suites/FailureBuckets.tsx:53` | `FAILURE_BUCKET_SCORE_THRESHOLD` | the label says "50%" while the API buckets on another number |
   | `features/security/SecurityPanel.tsx:356,397,489` | `SECURITY_RULES` count + `title` + rule body | **not named in the ledger's statement of the gap.** A pack that adds a rule makes the panel's "N rules" wrong and renders the new finding's raw `ruleId`; a retitled rule shows the old title beside the API's verdict |
   | `features/reports/ServerReportDialog.tsx:35` | a hand-copied `DEFAULT_REPORT_MODELS` | already a second copy, already intersected with the live roster — **leave it**, and say so |

   **What to build.** Extend the WP 3.2 payload with a `values` block carrying exactly these — the
   context-limit map, the two thresholds, and a **display projection** of the rule registry (id →
   title, severity, and whatever `SecurityPanel` actually renders; not the whole rule bodies unless
   it needs them). It must be produced from **one** read of the resolved pack alongside the metadata,
   so the browser can never show values from one pack beside another's `packVersion`. Do **not** ship
   the model dataset — the browser needs a `Record<string, number>`, not `all-models.json`.

   **Then the actual work, which is not the route.** An imported `const` cannot be re-pointed, so
   hydration is invisible unless every site reads through an accessor. Add one store module
   (`apps/web/src/lib/pack-values.ts`) exposing accessors plus a hook, seeded with the compiled floor,
   and convert the six sites. Four rules on it, each of which is a way this goes wrong:

   1. **The floor is the initial value AND the fallback — the store is never empty.** A failed or
      pending hydration returns the compiled table, never `{}` and never `0`. `RunConsole`'s
      `?? 0` is the one to watch: an empty store there produces a confident, meaningless "0% of
      context used", which `.claude/rules/` forbids in the same breath as fake scan results.
   2. **`CompareView` is an INITIAL value, not a live one.** Re-pointing it after mount would yank a
      slider the operator has already moved. Seed at mount and leave it; do not make it reactive
      just because the others are.
   3. **The guard is a BAN, not a presence check.** Assert those symbols are **not** imported from
      `@mcp-token-footprint/shared` anywhere under `apps/web/src` except the store module and its
      test. This item's ledger records a guard that a *comment* satisfied; a ban fails the safe way —
      a comment naming the symbol causes a false **red**, which is annoying, not dangerous. Do not
      write a presence assertion here.
   4. **Prove it end to end, not through the store's own unit test.** Serve a pack whose
      compare default differs and whose context-limit map carries one id the image does not, then
      read both off the running app. A test that installs a value into the store and reads it back
      proves the store, not the seam.

## Explicitly out of scope

No scheduled re-check. No pack authoring UI — a pack is edited in the repository, not in the app.
`ServerReportDialog`'s hand-copied `DEFAULT_REPORT_MODELS` is **deliberately left alone** — it is
already intersected with the live roster on load, so it degrades rather than lies; note it in the DC
subject as a known second copy rather than converting it.
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
- [ ] **No pack-derived value in `apps/web` still comes from the compiled floor at runtime.** The six
      measured sites read through the store; a ban guard fails if any of them re-imports the symbol.
- [ ] **A changed pack changes the browser without an image rebuild**, proved on the running app:
      a differing compare default and a context-limit id the image does not carry, both visible.
- [ ] **A pending or failed hydration renders the compiled floor, never an empty table** — in
      particular `RunConsole` never shows a 0-derived "% of context used" it cannot justify.
- [ ] Gate green.

## Teeth

1. Force a refusal, open Settings → the row says which pack was refused and why, and says the app is
   still on the previous one.
2. Put a secret-looking value in `DATA_PACK_URL` → the sentinel sweep goes red if it appears anywhere
   in the diagnostics document.
3. Remove the stamp from one report builder → its stamp test goes red.
4. Empty the hydrated store mid-session → `RunConsole` still reads the compiled limit, not `0`.
5. Re-import `MODEL_CONTEXT_LIMITS` directly in `allow-list.ts` → the ban guard goes red.
