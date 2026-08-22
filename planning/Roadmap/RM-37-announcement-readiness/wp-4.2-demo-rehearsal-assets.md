---
type: "Work Package Spec"
title: "WP 4.2 — Demo rehearsal: 10-minute path as a repeatable pre-flight, screenshots from the demo seed, comparison page, closed-loop example recorded"
description: "Phase 4 of item.md. Ledger: STATUS.md. Turns the presales rehearsal into a checked pre-flight (screen → what must be visible first → what must not be on screen) backed by an e2e spec over the demo seed, regenerates every README and guide screenshot from that seed, publishes a sourced capability-comparison page, and records one real failure → issue → drafted fix → re-run example."
tags: ["roadmap", "RM-37"]
timestamp: "2026-08-22T07:10:00Z"
status: "final"
---
# WP 4.2 — Demo rehearsal: 10-minute path as a repeatable pre-flight, screenshots from the demo seed, comparison page, closed-loop example recorded

Phase 4 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md).

## Scope

Demo and announcement assets, not product relayouts: a new `docs/demo/preflight.md`, a new
`e2e/demo-path.spec.ts`, `scripts/readme-screenshots.mjs` (hard-coded instance ids at `:16-22`) and
`scripts/guide-screenshots.mjs`, `docs/screenshots/` (the review copy holds only `_to_delete/`; the 11
PNGs the README embeds at lines 10–316 must be confirmed in the real repo), a new `docs/compare.md`, and
two small product changes for live demos. Every product fix the rehearsal depends on is filed elsewhere
and listed per row below; this WP only checks for them. Runs on the demo seed (wp-1.1) and the
pre-flight panel (wp-1.4), on the built image (wp-0.3). Out of scope: README/product-page copy
(wp-0.7), the Hub and dock (off the path; wp-0.1, wp-2.10), any talk track.

## Actions

1. **Pre-flight table** in `docs/demo/preflight.md` — the 10-minute path on the demo seed; each row is
   checked before a slot and is the acceptance walk of wp-4.1 action 4. **P0**

   | # | Screen | Must be visible first | Must not be on screen | Fix filed in |
   |---|---|---|---|---|
   | 1 | `/dashboard` Overview | Needs you = 1 open issue, dated, full title · top recommendation with its number · fleet total once · footprint table with both demo servers and a Δ | a failed or stale connection row · the same total twice · truncated titles · a range that empties the view | wp-2.2 (PS-01, PS-19, PO-35) |
   | 2 | `/servers` | two scanned cards · startup tokens as the large number · findings as a count | tenant hostnames, person names, tunnel URLs · "Scan failed" / "Not scanned" cards · a risk band from a heuristic finding | wp-0.5, wp-2.3 (PS-02, PS-10) |
   | 3 | `/servers/:id` Overview (demo-catalog) | startup tokens · top-3 share · recoverable · open issues · findings capped, limit language | "Blocker" on a model-limit finding · blank right column on scroll · uncapped chip walls | wp-0.5, wp-2.3 (PS-11, PS-12) |
   | 4 | `/advisor` | summary strip · first card = display-size saving + environment + server · Copy / Apply | scan ids in the basis line · two cards with one number · "data gaps" unexplained | wp-2.5 (PS-08, PS-09, PS-24) |
   | 5 | `/skills/:id` Overview (demo-catalog-analyst) | footprint tiles · security surface · open issues · "seen with demo-catalog · n runs" | "Not bound to any server yet" beside runs that used it · author metadata from the owner's instance · an editing control on the inspector | wp-2.6, wp-0.7 (PS-13, PO-10) |
   | 6 | `/testing/runs/:id` Chat (run A) | outcome tile first in the rail · the prompt · six rail numbers | `skill://` URI chips · GUID arguments in row summaries · "Running" steps in a completed run | wp-2.8 (PS-14, PS-15, ENG-12) |
   | 7 | same run › Report | the outcome chips (Answered · Valuable · error findings) · answer validation with cited steps · judge rationale | `<rating>n</rating>` in the rationale · a red ROUGE chip beside a passed judge | wp-2.8 (PS-03, PS-04) |
   | 8 | `/servers/:id` Issues (demo-catalog) | title · description · DRAFT FIX · "seen 2× · last <date>" | server ids in forensics text · expanded JSON occurrences · a duplicate of the same subject | wp-2.3 (PS-07) |
   | 9 | `/dashboard?tab=testing` | four KPI tiles · a window that contains the demo runs | six empty panels · "$0.00" on graded runs · a "0 tests × 0 environments" row if the feed is used | wp-2.2, wp-2.8 (PS-16, PS-05, PS-06) |
   | — | every screen | one product name · footer without "dev mode" · Light theme · Comfortable density · 1440×900 | "Soon" badge · "Never tested" · the Assistant group or the dock open · a sidebar that scrolls | wp-0.2, wp-2.1, wp-2.9 (PS-20) |

   Never opened during the slot: `/assistant` and the dock (PS-18), `/testing/compatibility` (PS-17),
   `/scans`, `/testing/collections`, the server-detail Advisor tab (EU-01). Before the slot, in order:
   `demo-snapshot.sh restore demo` or Load demo data → Settings › About › Pre-flight all green →
   top bar Light + Comfortable → open `/dashboard`.
2. **Make it repeatable**: `e2e/demo-path.spec.ts` boots the built image with the seed, visits rows 1–9
   and asserts every "must not be on screen" string is absent (`<rating>`, `192.168.`, `Local / dev mode`,
   `Soon`, `$0.00`, `Never tested`, `0 tests × 0 environments`, `Running` inside a completed run, the
   hostname/person-name regex from wp-1.1 action 8) and every "must be visible" element is present in the
   first viewport; runs in CI (wp-0.6) and is the gate for regenerating screenshots. **P0**
3. **Screenshots from the seed**: `readme-screenshots.mjs` resolves `demo-catalog`, `Demo — workbench`,
   `demo-catalog-analyst`, run A and the demo suite run by name through `/api` instead of the ids at
   `:16-22`; captures against the seeded container (`BASE_URL=http://localhost:8081`) in both themes;
   keeps `REDACTIONS` as a guard; `guide-screenshots.mjs` does the same for
   `planning/user-guide/DC-23-product-overview/images/`. Ordering: after wp-2.2, wp-0.5, wp-2.5 and
   wp-0.7 land. `compatibility.png` is not regenerated until wp-2.9 yields a green cell; `hub-agents.png`
   leaves the launch set with the Hub off by default. Confirm all embedded PNGs exist in the real repo. **P0**
4. **Comparison page** `docs/compare.md`: rows = capabilities (definition footprint · cross-server
   compare · definition-hygiene rules · skill registry/diff · run console · auto-grading · issue loop ·
   CI gate · local/no-account · providers · licence), columns = MCP Inspector · MCPJam · Snyk agent-scan
   / SkillSpector · PolicyLayer / Glama · Langfuse · LangSmith · Braintrust · promptfoo · first-party
   Claude tooling; each cell `has / partial / not found` with a source link and a "checked on" date; no
   ranking sentence. Linked from the README; a doc test asserts every non-empty cell has a link. **P1**
5. **Closed-loop example recorded**: on the seed, using the wp-4.1 action-3 run — failing test →
   issue with drafted fix → fix applied to the demo server (`DEMO_CATALOG_VERSION=3` returns the
   structured `already_shipped` result) → re-run → compare; captured with Playwright `recordVideo`
   (≤ 90 s) and six stills into `docs/screenshots/closed-loop/`, linked from the README's issues section.
   Until it exists, README wording stays "drafted fix / re-run to verify" (wp-0.7). **P1**
6. **Live-demo controls**: "Comfortable / Compact" added to the top-bar theme menu via
   `useTheme().setDensity` (today only in Settings › General); `Scan now` on `/servers/:id` asks for
   confirmation when the server uses OAuth and its last scan is < 24 h old. **P2**

## Acceptance

- [ ] `docs/demo/preflight.md` exists with the table above; every "Fix filed in" WP is a real file in
      this folder.
- [ ] `e2e/demo-path.spec.ts` passes on the seeded image in CI; each forbidden string is covered by an
      assertion (test names list them).
- [ ] All README and guide PNGs are regenerated from the seed in both themes; `git grep` of the
      screenshot set finds no owner hostname, person name or instance id (a pixel-level check is the
      owner's look during wp-4.1).
- [ ] `docs/compare.md` exists, every cell carries a source link and a date, and the README links it.
- [ ] The closed-loop recording and stills exist and are linked from the README.
- [ ] Density is switchable from the top bar; the OAuth `Scan now` confirm appears only under the
      stated condition (tests).
- [ ] Gate green: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`.

## Effort

**M** — one document, one e2e spec, two script changes, one comparison table, one recording session
and two small UI changes; the waiting time is on the Phase 0/2 WPs it screenshots.

## Sources

PS-01 … PS-20 (the rehearsal log and blocker checklist; fixes filed per row) · PS-18 · PS-21 (→ wp-1.1) ·
PS-28 · PS-29 · MK-04 · MK-08 · MK-11 · MK-15 · MK-18 · MK-19 · PO-25 · PO-35 · EU-01 (tab off the path).
