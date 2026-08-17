# Phase 2 — Consistency · Batch I (4 parallel) · enter after Batch H merged

One meaning per color, one recovery per truncation, one elevation per card, one exit per dead-end. Read
[`conventions.md`](./conventions.md). Numbers, both themes.

> **PM note:** **WP 2.2 must run after WP 0.1** (already merged via Batch G) — `SuiteDeltas.tsx:245`'s
> `text-primary` is invisible **today only because `--primary ≡ --success`**; once 0.1 splits them it
> becomes a visible bug this WP fixes. Batch I inherits the split, so this holds by construction.

---

## WP 2.1 — Truncation recovery (remainder)

- **Findings covered:** 10 (MEDIUM — 249 non-recoverable truncations), **D-IC10**; **plus the Phase-0.b
  migration** (CrewCard's clamp had no `title`).
- **Domain (contract):** `apps/web/src/features/testing/runs/RunTableRow.tsx` (the Environment column),
  `apps/web/src/features/testing/collections/CollectionsView.tsx` (the bound-path line ~`:391-395`),
  `apps/web/src/features/hub/workforce/CrewCard.tsx` (the `line-clamp-2` at ~`:60`), a **title-carrying
  select-trigger wrapper** in `apps/web/src/components/`.
- **Depends:** Batch H merged · **Size:** M · **parallel** · **Batch I** · **Model:** sonnet · medium.

**The work.** Give clipped/clamped **user-authored** strings a recovery — a `title` at minimum, or the
in-repo `AgentBriefPreview.tsx:13-33` pattern (`line-clamp-2` + `title` + a `HoverCard` with the full
text):
- `RunTableRow.tsx` Environment cell (`max-w-[12rem] truncate`, no `title`) — add `title={value}` (the
  live-DOM confirmed clip was `the vendor assistant — ontime-assistant`).
- `CollectionsView.tsx` bound-path line — `title` on the clipped path (keep `font-mono` for bound paths).
- `CrewCard.tsx` `line-clamp-2` crew description — add `title` (recovery). **`AgentCard.tsx` already has
  `title`** (toolbar-reach touch-up, `:186`/`:234`) — **verify, do not re-apply, don't touch it** (out
  of domain).
- **Select values:** ship a title-carrying `<Select>` trigger wrapper (`SelectTrigger` ships
  `[&>span]:line-clamp-1` with no `title`, so every select clips silently, e.g. the composed
  `${server} · ${date} · ${n} tools`). Apply the wrapper to the clipping selects. Records upstream gap
  #4.

**Acceptance (live DOM, both themes):**
1. The `RunTableRow` Environment cell exposes its full value via `title` (query the attribute; the clip
   is `title`-recoverable).
2. `CrewCard`'s clamped description has a recovery (`title`/HoverCard); `AgentCard` unchanged.
3. The select-trigger wrapper sets `title` (or HoverCard) on the clipping selects — report which selects
   now recover their clipped value.
4. Report the app-wide recoverable/non-recoverable counts after (baseline 82 / 249) — it moves the right
   way; you are not required to hit every one of the 249, but every site in this Domain recovers.

---

## WP 2.2 — One delta convention

- **Findings covered:** 11 (the delta half — six surfaces disagree), **D-IC3** (reaffirms **D-UX9**).
- **Domain (contract):** `apps/web/src/lib/delta.ts` (**new**) + its test,
  `apps/web/src/features/scans/scanDelta.tsx`, `apps/web/src/features/compare/CompareView.tsx` (the delta
  region ~`:877-881`), `apps/web/src/features/compare/matrix/DeltaMatrix.tsx`,
  `apps/web/src/features/compare/matrix/DeltaBarPanel.tsx`,
  `apps/web/src/features/compare/suite/suite-data.ts`,
  `apps/web/src/features/testing/suites/SuiteDeltas.tsx`.
- **Depends:** 0.1 (token split — merged via G) · **Size:** M · **parallel** · **Batch I** ·
  **Model:** opus · medium.

**The work.** The convention already exists and is **locked** — **D-UX9**
([`roadmap/ux-overhaul/STATUS.md:143`](../ux-overhaul/STATUS.md)). You are not choosing a convention, you
are implementing the one you have, **once**:
- `lib/delta.ts` — the single authority mapping a delta's (sign × meaning: is-higher-better?) → a tone
  token (the D-UX9 convention; read `:143` and implement **that** — if it is ambiguous, **report to the
  PM**, don't invent).
- All six surfaces derive their tone from `lib/delta.ts`. **No view computes its own delta tone.** Today:
  "worse" is amber on Scans but red on all five Compare surfaces; "better" is `text-success` everywhere
  **except `text-primary` at `SuiteDeltas.tsx:245`** — converge them.
- `SuiteDeltas.tsx:245`'s `text-primary` → the convention's "better" tone (`text-success`). (An earlier
  pass flagged this at `research/full-validation/03-web-review.md:193-194` — still present.)

**Acceptance (measured, both themes):**
1. `lib/delta.ts` is the **only** place delta tone is decided — grep confirms no view maps a delta
   sign→color inline (report the grep).
2. All six surfaces import `lib/delta.ts`; the test asserts the mapping (better→one tone, worse→one tone,
   neutral→muted) per D-UX9.
3. "Worse" renders **one identical tone** across Scans **and** all five Compare surfaces — report the
   tone token and that it is the same on each. "Better" is `text-success` everywhere including
   `SuiteDeltas` (no `text-primary`).
4. With the 0.1 token split live, `SuiteDeltas`'s better-delta is visibly `--success`, not `--primary`.

---

## WP 2.3 — Filter and search empty states

- **Findings covered:** 13 (MEDIUM — filtered empty states name no query and offer no exit).
- **Domain (contract):** `apps/web/src/features/hub/projects/ProjectLibraryPanel.tsx`,
  `apps/web/src/features/hub/agents/CrewLibraryPanel.tsx`,
  `apps/web/src/features/hub/agents/RoleLibraryPanel.tsx`, **+ the 3 remaining filter/search empty-state
  sites** (enumerate at I-dispatch — grep `No .* match`/`match your filter` across `features/`).
- **Depends:** Batch H merged · **Size:** S · **parallel** · **Batch I** · **Model:** sonnet · low.

**The work.** Echo the query and offer the exit: `title = 'No projects match "quarterly"'` + a **Clear
filters** action. `EmptyState` already accepts `title` + `description` + `actions`. `CrewLibraryPanel`
explicitly sets `description: undefined` on the filtered branch — fix it. **Do not touch the other ~114
empty states** — they are already good (they explain what would appear and when); this is the one weak
set.

**Acceptance:**
1. Each of the 6 filter/search empty states **echoes the active query** and offers a **Clear
   filters** (or equivalent exit) action. Report the 6 sites.
2. The exit action actually clears the filter (wired, not decorative).
3. The ~114 non-filter empty states are untouched (grep/diff confirms the blast radius is the 6 sites).

---

## WP 2.4 — Card elevation consistency

- **Findings covered:** 14 (MEDIUM — 27 hand-rolled card surfaces flatter than real Cards; stacked
  meta-rail hairlines), **D-IC11**.
- **Domain (contract):** the 27 hand-rolled surfaces —
  `apps/web/src/features/settings/SettingsView.tsx`,
  `apps/web/src/features/hub/meta-rail/ProgressSection.tsx`,
  `apps/web/src/features/hub/meta-rail/OutputsSection.tsx`,
  `apps/web/src/features/review/RubricEditorDialog.tsx`,
  `apps/web/src/features/review/RunStepsPreview.tsx`, and the `features/skills/**` panels that hand-roll
  a card. (Enumerate the full 27 at I-dispatch via `grep "bg-card" | grep -v shadow`; the Domain is
  **only** hand-rolled card surfaces — do not restyle real `Card`s.)
- **Depends:** Batch H merged · **Size:** M · **parallel** · **Batch I** · **Model:** sonnet · medium.

**The work.** The tell is `rounded-lg border border-border bg-card p-3` with **no `shadow-sm`** — a Card
in intent, hand-rolled from a `div`, sitting visibly flatter than the real `Card` beside it. Use
`<Card>` so elevation comes from the **shared token** (`shadow-sm`), not a border standing in for a
shadow.
- **Meta rail stacked hairlines:** `ProgressSection.tsx:152` (a bordered panel) nests `:245` (another
  bordered row), giving two hairlines ~10px apart **inside** `RailSection`'s own `border-b` — three
  border weights within ~13px. Drop the inner border; a `bg-background` fill alone separates the nested
  row.
- **Settings radius split:** `SettingsView.tsx` uses both `rounded-lg` and `rounded-md` for the identical
  "muted inset panel" pattern within one file — pick one.
- **Do NOT chase concentric radius** — the review **rejected** it (`--radius` is 4px, max error 4px, not
  perceptible; [`conventions.md`](./conventions.md) §6). The visible issue is the doubled border, which
  is this WP.

**Acceptance (both themes):**
1. The hand-rolled card surfaces in the Domain use `<Card>` (elevation via the `shadow-sm` token); report
   the count converted (target 27).
2. The meta rail no longer stacks 3 border weights within ~13px — the inner border is gone, the nested
   row separated by fill. Verify by eye + DOM (no `border` on the nested `ProgressSection` row).
3. Settings uses **one** radius for the muted-inset pattern.
4. No concentric-radius changes introduced.

---

### Batch I exit → Batch J
All four merged, gate re-run, numbers recorded. J enters — **3.1 solo first**, then 3.2a/b/c.
