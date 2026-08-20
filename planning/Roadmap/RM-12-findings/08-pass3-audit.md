---
type: "Work Package Spec"
title: "Pass-3 audit + compare-depth live verification (Round 3, ui-findings3)"
description: "Round 3 picks up after PR 1 merged (origin/main @ 5da8228, which also carries the concurrent"
tags: ["roadmap", "RM-12"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# Pass-3 audit + compare-depth live verification (Round 3, `ui-findings3`)

Round 3 picks up after PR #1 merged (`origin/main` @ `5da8228`, which also carries the concurrent
Testing-subsystem work). Branch **`ui-findings3`** (off `origin/main`). This round shipped two lanes —
**compare depth** (`ui/cmp`) and a **destructive-confirm fix** (`ui/confirm-fix`) — and ran the
browser-driven Pass-3 audit the queue called for. Combined gate on `ui-findings3`:
`typecheck` + `test` (**102/102**, +4 new) + `build` all green; `brand-ui audit apps/web/src`
unchanged from baseline (see §4).

## How this was verified (not a mock)

A production build was served by the API on **`:8099`** (`DATA_DIR=/tmp/ui-verify-data`), seeded with
**real stdio MCP servers** — two `@modelcontextprotocol/server-everything` (one for a cross-server
**exact**-match demo) and `@modelcontextprotocol/server-filesystem /tmp`. Scans: `everything`
×2 (`generic_o200k` 1463 tok, `generic_cl100k` 1540 tok) for a same-server diff, `everything-2`
(o200k, 1463), `filesystem` (o200k, 2403). Driven with `agent-browser`; **screenshots were
eyeballed**, and rendered colors were read out of `getComputedStyle` (not trusted by appearance alone).

## 1. Compare depth — what shipped (lane `ui/cmp`)

Contract-first (`packages/shared` → `apps/api` → `apps/web`), additive only:

- **Contract:** `ToolMatch.definitionDelta: { descriptionChanged, schemaChanged, annotationsChanged }`
  (booleans), plus `annotationsTokens` added to `ComparedTool` (completes the 4-facet projection).
- **API (`apps/api/src/compare/service.ts`):** per matched pair, computes the three flags by
  canonical compare — description by trimmed text; schema/annotations by `stableStringify` (reusing
  `apps/api/src/utils/json.ts`), with `undefined` collapsed to `""` so `undefined↔undefined` is
  *unchanged* and `undefined↔value` is *changed*. Matcher (`matching.ts`) untouched — `inputSchema`/
  `annotations` pass through as generic fields, then are stripped off the wire `ComparedTool` (the
  existing no-leak test was extended to assert `inputSchema`/`annotations` don't leak either).
- **Web (`CompareView.tsx`):** new always-present **Definition** column (outline `Badge` per changed
  facet: Desc/Schema/Annot; muted em-dash when nothing changed or the row is added/removed); new
  **"Very loose · 0.2"** fuzzy preset; the **Fuzzy-match select is hidden in same-server mode** (it's a
  no-op there — matching is exact/normalized).
- **Tests:** +4 (`description`-only / `schema` / `annotations` change → correct flag; identical
  definitions → all false, via deep-equal-but-distinct objects to exercise canonicalization).

### Live verification (`:8099`, both themes)

- **API responses** confirm the contract end-to-end: same-server o200k↔cl100k → 13 **exact**, all
  `definitionDelta` false, `sameServer:true`, `annotationsTokens` present; cross-server
  everything↔everything-2 → 13 exact, no def change, `sameServer:false`; cross-server
  everything↔filesystem @ 0.2 → 0 matched / 13 / 14.
- **Browser (light + dark):** cross-server shows Tool · **Match** · Before · After · Δ ·
  Change · **Definition**, fuzzy select **visible**, the new **Very loose · 0.2** preset present and
  re-fetches. Same-server (everything o200k↔cl100k) drops the **Match** column, **hides** the Fuzzy
  select (verified: 0 occurrences in the DOM), shows the cross-profile Alert, 13 matched / Δ +77, and
  Definition **"—"** on every row (defs identical, only the tokenizer changed). Both themes render
  cleanly with visible focus.

> **Not live-demonstrable with these servers:** a *populated* Definition badge needs a matched pair
> whose definition actually differs. `everything` and `filesystem` are too dissimilar to pair even at
> 0.2 (Jaccard < 0.2 for all cross-pairs — correct, not a bug; mirrors the findings/07 fuzzy caveat),
> and same-server scans have identical defs. The populated-badge path is covered by the 4 unit tests
> and the API canonicalization, **not** by a live screenshot.

## 2. AUDIT FINDING (real, fixed) — destructive delete-confirm rendered GREEN

The server-delete confirm button (`App.tsx` AlertDialog) was **already coded** `variant="destructive"`
(carried in from a prior session), yet **rendered green** in the running app — `bg-primary`, computed
`oklch(0.7 0.16 150)` (green), **no `bg-destructive`**. Findings/06–07 had listed this as "open
polish, code looks done"; the live pass shows the code was *inert*.

**Root cause (verified against the vendored source):** `@elabs-ai/components-ui`'s `AlertDialogAction` hardcodes
`className: cn(buttonVariants(), className)` — i.e. it injects the **primary** button classes. With
`asChild` + a child `<Button variant="destructive">`, that primary `className` flows into the child,
and `tailwind-merge` (inside `Button`'s own `cn(buttonVariants({variant}), className)`) resolves the
`bg-*` conflict in favor of the **later** `bg-primary`, silently dropping `bg-destructive`.

**Fix (lane `ui/confirm-fix`):** put the variant on `AlertDialogAction`'s **own** `className`
(`className={buttonVariants({ variant: "destructive" })}`), which merges *last* and wins — the same
shape `AlertDialogCancel` uses internally for its `outline` variant. `buttonVariants` is a first-class
`@elabs-ai/components-ui` export (token-based, no raw colors); the static audit count is unchanged by the edit.

**Re-verified live (both themes):** `bg-destructive`, no `bg-primary`; computed **`oklch(0.58 0.22 27)`
(bright)** / **`oklch(0.62 0.2 25)` (dark)** — red, white text legible, with **Cancel focused** as the
safe default (per the AlertDialog anti-pattern guidance). The scan-delete path does **not** exist
(server-delete is the only destructive confirm in the app), so nothing else to change here.

> **Reusable gotcha for the owner:** `<AlertDialogAction asChild><Button variant="…">` will always be
> overridden by `AlertDialogAction`'s primary `buttonVariants()`. Use
> `<AlertDialogAction className={buttonVariants({ variant })}>`. Worth promoting to
> `.claude/rules/styling-and-tokens.md` (left out this round to avoid colliding with the concurrent
> session's rule edits).

## 3. Perceptual / cross-theme sweep (core screens) — clean

Eyeballed in **both** themes (bright + dark): Dashboard (KPI band, Operational-state + Latest-footprint
tables), MCP Servers (server rail, sticky header + red destructive trash, KPI band, Overview/Tools/Scans
tabs, Findings + Token-distribution), Scans (split history/detail + resizable handle + empty state),
Settings (Appearance/Token-profile/Local-app-info/Provider-credentials), Compare (both modes). No
contrast failures, no broken/unstyled views, numerals are `tabular-nums`, focus rings visible. The
theme switcher exposes exactly **Vendor Bright + Vendor Dark** (no blueprint). Compact density on by default.

## 4. Static `brand-ui audit` triage — 3 issue(s) + 14 advisory (all PRE-EXISTING, out of this round's lane)

`brand-ui audit apps/web/src` reports the **same** 3 issues + 14 advisory on the baseline
(`origin/main`) as on `ui-findings3` — both edited lanes added **zero** findings (diff is identical).
Every finding sits in files this round did not own:

- **3 issues — `space-y-x`** in `features/testing/{ArtifactPreview.tsx:153, ConversationPane.tsx:103,153}`.
  These belong to the **Testing subsystem** (Phase 3, *in progress*, driven by the concurrent
  `/next-wp testing` workstream). **Out of scope** for the analyzer-UI round — flagged for that
  workstream, not fixed here (touching them risks colliding with the active owner session).
- **Advisories — `em-dash-overuse`** in testing files + `components/AppShell.tsx:64,92` +
  `features/settings/SettingsView.tsx:199`. The three in core files are all inside **code comments**
  (`//` / JSDoc), **not** user-visible copy — false positives for UI register; **not** worth editing.
- **Advisories — `outline-none`** in `features/testing/AddServerModal.tsx:123,169` — line-based check;
  testing subsystem, out of scope.

## 5. What was NOT verified / explicitly out of scope

- A **populated** Definition badge live (see §1 caveat) — unit-tested, not screenshotted.
- A **numeric** axe-core / oklch→sRGB WCAG sweep — contrast was assessed by rendered inspection +
  reading computed oklch in both themes (no failures seen), not by an automated contrast tool.
- The **Testing subsystem** UI (`features/testing/*`) — its static-audit issues are the concurrent
  owner workstream's; deliberately untouched.
- Nothing pushed; `main` untouched. `ui-findings3` is local only, pending owner review.
