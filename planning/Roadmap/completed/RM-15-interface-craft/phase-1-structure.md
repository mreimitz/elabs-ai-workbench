---
type: "Work Package Spec"
title: "Phase 1 \u2014 Structure \u00b7 Batch H (4 parallel) \u00b7 enter after Batch G merged"
description: "Semantic structure the visual layer already implies: headings, live regions, focus, measure. Read"
tags: ["roadmap", "RM-15"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# Phase 1 — Structure · Batch H (4 parallel) · enter after Batch G merged

Semantic structure the visual layer already implies: headings, live regions, focus, measure. Read
[`conventions.md`](./conventions.md) (§2 measurement, §5 known drift). Numbers, both themes.

> **PM collision notes for Batch H (resolve at H-dispatch, after G merges — re-grep the current tree):**
> - **`SkillOverview.tsx` is assigned to WP 1.4 only** (not 1.1). Finding 6's evidence cites only
>   `ScansTab.tsx` + `ServersView.tsx`; finding 9 explicitly cites `SkillOverview.tsx:550-553` (the
>   SKILL.md prose block). One file, one owner → 1.4. If 1.4's agent finds SkillOverview has bare-`div`
>   section titles that D-IC5 should fix, it **reports drift** (out of its prose scope) rather than
>   fixing — a follow-up, not a parallel edit.
> - **Result-count call sites (WP 1.2) may overlap 1.1's files.** If a `ViewToolbar results=` count site
>   lives in `ScansTab.tsx` or `ServersView.tsx` (1.1's domain), the PM **region-scopes** (1.1 = the
>   section-title regions, 1.2 = the count-readout call site) or resequences. Enumerate the actual count
>   sites at H-dispatch before spawning.

---

## WP 1.1 — Section titles are semantic headings

- **Findings covered:** 6 (MEDIUM — `CardTitle` is a `<div>`; Dashboard's 5 sections have no heading
  semantics), **D-IC5**.
- **Domain (contract):** `apps/web/src/components/SectionCardTitle.tsx` (**new**) + its test,
  `apps/web/src/features/dashboard/ScansTab.tsx`, `apps/web/src/features/servers/ServersView.tsx`.
  *(SkillOverview.tsx is 1.4's — see the collision note.)*
- **Depends:** Batch G merged · **Size:** M · **parallel** · **Batch H** · **Model:** opus · medium.

**The work.** `CardTitle` renders `<div className="text-title leading-none">` — never a heading — so the
busiest screens return exactly one heading each (the `sr-only` h1 that WP 1.2/PageHeader removal left).
Ship a wrapper and apply it where a card titles a **genuine section**:
- `apps/web/src/components/SectionCardTitle.tsx` — a thin wrapper over the `@elabs-ai/components-ui` card title that
  renders a real `h2`/`h3` (level via an `as`/`level` prop) **carrying the `text-title` visual** (same
  look as `CardTitle`). Records upstream gap #3 (already in [`upstream-gaps.md`](./upstream-gaps.md)).
- Apply it to the section-titling cards on the Dashboard Scans tab (`ScansTab.tsx` — the five sections:
  "Since your last visit", "Needs attention", "Biggest movers", "Latest server footprint", "Recent scan
  activity") and Servers (`ServersView.tsx`). **AgentTranscript.tsx:62-64 is NOT the model** (that's
  1.2's `role="log"`). **Decorative** card titles stay `div`/`CardTitle` — only real sections get a
  heading. Keep a single, non-skipping level order under the page's `h1`.

**Acceptance (live DOM query, not JSX reading; both themes):**
1. Dashboard (Scans tab): outline is `h1` (the page's, may be `sr-only`) → `h2`s that **name the five
   visible sections**. Report the heading list.
2. Servers: the section-titling cards contribute `h2`/`h3`; no skipped levels. Report the heading list.
3. `SectionCardTitle` renders a real heading element at the chosen level with the `text-title` visual
   (test asserts `role="heading"` + `aria-level`).
4. Runs (`/testing/runs`) is checked for a **coherent** outline (one `h1`, no orphaned/skipped levels).
   `RunsView.tsx` is **out of domain** — if Runs needs section `h2`s, **report drift** (don't reach).
5. No visual change to the titles by eye (same `text-title`), verified in both themes.

---

## WP 1.2 — Live regions for streaming + counts

- **Findings covered:** 7 (MEDIUM — SSE stream + filtered counts announced to nobody).
- **Domain (contract):** `apps/web/src/features/testing/RunConsole.tsx` (**transcript region only** — not
  the tab strip, not the KPI rail), `apps/web/src/components/ResultCount.tsx` (**new**, a stable
  `role="status"`) **+ its call sites** (the current `ViewToolbar results=` count readouts — enumerate
  at H-dispatch; the review's "TableToolbar 6 sites" is stale, see §5 drift).
- **Depends:** Batch G merged (0.4 settles the Runs toolbar for a clean rebase) · **Size:** M ·
  **parallel** · **Batch H** · **Model:** sonnet · medium.

**The work.**
- **Stream (copy the working pattern).** `features/hub/AgentTranscript.tsx:62-64` already wraps its
  transcript in `role="log" aria-live="polite"` — **copy it** onto the `RunConsole` transcript region so
  streamed turns/tool-calls/status transitions are announced. **Do not** announce mid-stream transients:
  respect the loading/streaming discipline (`use-run-stream.ts` terminal-swallow, `.claude/rules/
  loading-states.md`) — the region builds content up, it does not flash a half-parsed error.
- **Counts (stable region).** `ResultCount.tsx` — a small `role="status"` component that is **always
  mounted** and updates its **text** (e.g. "12 of 90 rows"). Every `role="alert"` in the app today is
  conditionally mounted (unreliable across AT/browser pairs); this is the opposite. Use it at the count
  readouts. If the count already sits in a `ViewToolbar` `results` slot, render `ResultCount` **there
  once** rather than duplicating.

**Acceptance:**
1. The `RunConsole` transcript region has `role="log" aria-live="polite"` (structural — **SR
   announcement not tested**; state so).
2. `ResultCount` is a **stable, always-present** `role="status"` whose text updates on filter change
   (test: the node stays mounted across a count change; its text updates). Report the call sites it
   replaced.
3. No regression to streaming discipline: no mid-stream error flash, terminal-swallow intact
   (`use-run-stream` behaviour unchanged; run-console tests green).
4. Live-run announcement is **owner-acceptance** (needs a provider key) — build structurally, note it.

---

## WP 1.3 — Focus visibility + `inert`

- **Findings covered:** 8 (MEDIUM — validation focus targets are `outline-none` with no ring; MetaRail
  keeps focusables while `aria-hidden`).
- **Domain (contract):** `apps/web/src/features/testing/run-launcher/RunLauncher.tsx`,
  `apps/web/src/features/testing/suites/SuiteEditor.tsx`, `apps/web/src/features/hub/meta-rail/MetaRail.tsx`.
- **Depends:** Batch G merged · **Size:** M · **parallel** · **Batch H** · **Model:** sonnet · medium.

**The work.**
- **Visible focus on validation targets.** `RunLauncher.tsx` (~`:726-730`, `:804-808`, `:441`) and
  `SuiteEditor.tsx` (~`:551`) move focus to elements styled `outline-none` with **no** replacement —
  validation says "fix the highlighted fields" then hides the cursor. Add
  `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` (token-driven; reads in
  both themes) to the three focus targets so programmatic focus is **visible**.
- **`inert` on the closed rail.** `MetaRail.tsx` (~`:135-146`) stays mounted when closed via
  `aria-hidden + pointer-events-none`, but its "Hide the rail" `Button` and section tree remain in the
  tab order (focus can enter a region the a11y tree says doesn't exist). Replace the pattern with the
  **`inert`** attribute when closed (removes pointer **and** tab access in one attribute; drop the
  `aria-hidden` on focusable content).

**Acceptance (live DOM, both themes):**
1. Each of the three validation focus targets shows a **visible ring** when focused programmatically
   (screenshot in both themes + confirm the `focus-visible` classes resolve).
2. When the MetaRail is **closed**: `inert` is present and **focusables inside the closed rail = 0**
   (enumerate). No `aria-hidden` on a focusable element anywhere in the rail.
3. When **open**: the rail's controls are focusable and visibly ringed as before (no regression).

---

## WP 1.4 — Prose measure caps

- **Findings covered:** 9 (MEDIUM — 190 characters per line), **D-IC9**.
- **Domain (contract):** `apps/web/src/features/compatibility/CompatibilityView.tsx` (**the "Not
  everything is automated" callout only**), `apps/web/src/features/assistant/AssistantMessageBody.tsx`,
  `apps/web/src/features/skills/SkillOverview.tsx` (**the rendered SKILL.md block**), a measure-capped
  **`CardDescription` app wrapper** in `apps/web/src/components/`.
- **Depends:** Batch G merged · **Size:** S · **parallel** · **Batch H** · **Model:** sonnet · low.

**The work.** Cap **genuine prose** at ~65–75ch (`max-w-[68ch]`). `max-w-prose` appears zero times; the
worst line is 190ch (Compatibility callout at 1600px, 13px). Apply to: the Compatibility callout body,
the assistant message body, the rendered SKILL.md block, and via a thin measure-capped `CardDescription`
usage/wrapper (`components/`, records upstream gap #5). **Tables and dense rows stay full-width** — this
is prose only.

**Acceptance (character-width probe at 1600px, both themes):**
1. Compatibility callout: **≤ ~75 ch/line** (was 190). Report the measured number.
2. Assistant message body, rendered SKILL.md block, and capped `CardDescription`: each **≤ ~75 ch/line**.
   Report each.
3. A **table/dense row** adjacent to a capped surface is still **full-width** (measure it — the cap must
   not leak onto non-prose).
4. `max-w-prose`/`max-w-[68ch]` (or equivalent) present on each capped container; no raw color, both
   themes read correctly.

---

### Batch H exit → Batch I
All four merged, gate re-run by the PM, numbers recorded. I enters (2.2 needs 0.1's token split, already
in via G).
