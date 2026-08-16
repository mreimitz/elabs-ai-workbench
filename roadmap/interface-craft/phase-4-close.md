# Phase 4 — Close · Batch K · 4.1 solo → then 4.2 (owner)

Assert the six new rules in CI so they can't drift back, then re-run the review and prove it with
numbers. Read [`conventions.md`](./conventions.md).

---

## WP 4.1 — Guardrails  · **SOLO, runs last**

- **Findings covered:** — (this WP asserts the rules the plan established: D-IC1/D-IC2/D-IC4/D-IC6/D-IC7 +
  D-IC9).
- **Domain (contract):** `.claude/hooks/` (new hook(s) if needed), **new test files only** (do not edit
  existing tests; do not touch feature code — the guardrails assert the state the earlier phases already
  shipped).
- **Depends:** 0.1, 0.2, 0.3, 3.1 merged (the state each guardrail asserts must exist) · **Size:** M ·
  **solo, last** · **Batch K** · **Model:** opus · medium.

> **Note:** the kickoff's "if toolbar-reach WP 4.1 hasn't run yet, merge these into it" is **moot** —
> toolbar-reach WP 4.1 is **shipped** (its four guardrails are in `main`: bare-`enablePagination`,
> `SelectField`-in-toolbar, `no-title-on-icon-button` hook, retired-components). This WP adds **new,
> separate** interface-craft guardrails alongside them; it does not modify toolbar-reach's.

**The work.** Each guardrail is **demonstrated to FAIL on the pre-fix pattern, then pass** (the
toolbar-reach 4.1 method — inject the bad pattern, watch it go red, revert, watch it go green):
1. **D-IC1 — token contrast.** A test asserting every `--<role>`⇄`--<role>-foreground` pair ≥ 4.5:1 in
   **both** themes (may extend / share `tokens-contrast.test.ts` from 0.1; ensure it runs in the gate and
   covers all five roles × two themes).
2. **D-IC2 — token identity.** A test asserting `--success !== --primary` **and** `--ring !== --info` in
   both themes.
3. **D-IC4 — one `<main>`.** A live-DOM (or render) test asserting the shell renders **exactly one**
   `<main>` (and, if cheap, the named sidebar `nav` + skip-link-first-focusable).
4. **D-IC6 — field error association.** A test asserting `FieldRow` emits `aria-describedby` (pointing at
   the error id) + `aria-invalid` when given an error.
5. **D-IC7 — notification timing.** A test asserting `notifyError` **never** passes a finite duration.
6. **D-IC9 — prose measure.** A lint rule (or hook/test) flagging a **prose container with no `max-w`**
   — scoped so it does not false-positive on tables/dense rows. (If a Biome rule can't express this,
   ship a `.claude/hooks/` check or a test that scans the known prose components for a measure cap.)

**Acceptance:**
1. All six guardrails exist and run **in the gate** (`pnpm test` / the hook set).
2. Each is shown to **fail on the injected pre-fix pattern** and pass after revert — paste the red→green
   evidence for each.
3. The prose-measure guardrail does **not** false-positive on a legitimate full-width table (show it
   passes on one).
4. **No existing test edited; no feature code touched.** New files only.
5. Gate green.

---

## WP 4.2 — Re-run the review  · **owner acceptance**

- **Findings covered:** — (the acceptance criterion for the whole plan).
- **Domain (contract):** `roadmap/interface-craft/verification-report.md` (**new**).
- **Depends:** 4.1 merged · **Size:** L · **owner (PM)** · **Batch K** · **Model:** opus · high.

**Substitute-skill mechanism (owner decision, 2026-07-25).** The `better-interface` skill that produced
the original review is **not installed here**. The re-run **substitutes**: the installed
**`brand-ui-audit`** + **`brand-ui-visual-ux-reviewer`** agents (rendered cross-theme + WCAG-contrast +
static token pass) **plus manual live probing** against the running app at `http://127.0.0.1:8080` in
**both** themes, using the **same measurements** the review used:

- contrast ratios per `--<role>`⇄`-foreground` pair, per theme (oklch→sRGB + WCAG);
- `document.querySelectorAll('main').length`;
- focusable-stops-before-content;
- `scrollWidth` vs `clientWidth` on the Runs filter row at 1100px;
- characters-per-line on the Compatibility callout at 1600px;
- token identity (`--success` vs `--primary`, `--ring` vs `--info`);
- `getComputedStyle(document.body).webkitFontSmoothing`.

**Record `verification-report.md`** as a **before/after diff of numbers, not adjectives**, e.g.:

| Metric | Review (before) | Now (after) | Pass |
|---|---|---|---|
| bright `--primary`⇄`-fg` | 4.31 | _≥4.5_ | ✓ |
| bright `--info`⇄`-fg` | 3.76 | _≥4.5_ | ✓ |
| dark `--destructive`⇄`-fg` | 3.02 | _≥4.5_ | ✓ |
| `<main>` count | 2 | 1 | ✓ |
| focusables before content | 22 | 1 | ✓ |
| Runs row hidden @1100px | 338px (68%) | 0 | ✓ |
| Compatibility callout | 190 ch | _≤75_ | ✓ |
| `--success` vs `--primary` | identical | distinct | ✓ |
| body font-smoothing | auto | antialiased | ✓ |

**Acceptance / plan pass condition.** The review closed at **Block (5 HIGH)**. This plan passes when the
substitute re-run returns **Approve** — or **Needs changes with only findings this plan deliberately
deferred** (owner-acceptance items needing a provider key / a real screen reader / a live run; the
rejected candidates; any explicitly-out-of-scope drift). The report **leads with what could not be
verified** (SR announcement, live-run streaming, provider-gated surfaces) and states each as such —
never claims an unmeasured pass.

---

### Program close
When 4.2 records **Approve** (or the only-deferred equivalent), the plan is complete on
`ui/interface-craft`. **Owner merges `ui/interface-craft → main`** (owner call; nothing pushed to origin
by this plan). Tick the last box in [`STATUS.md`](./STATUS.md) with the report link.
