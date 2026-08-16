# Phase 3 — Voice · Batch J · 3.1 solo → then 3.2a·3.2b·3.2c (3 parallel)

One notification timing, one error voice. Read [`conventions.md`](./conventions.md) — **§7 (copy
discipline) is load-bearing here.**

> **Why 3.1 is solo and first:** 3.1 and 3.2 both edit the same `toast.error(...)` lines. 3.1 is a
> **mechanical call-site rename** (`toast.error(` → `notifyError(`); 3.2 **rewrites the strings**.
> Running them concurrently, or 3.2 before 3.1, guarantees conflicts across ~180 sites. 3.1 lands and
> merges; then 3.2a/b/c split the message rewrite by **disjoint directory**.

---

## WP 3.1 — Notification timing  · **SOLO, runs first**

- **Findings covered:** 5 (HIGH — every error toast and the one actionable toast auto-dismiss at 4000ms).
- **Domain (contract):** `apps/web/src/main.tsx` (the `<Toaster>`), `apps/web/src/lib/notify.ts`
  (**new**) + its test, the **mechanical rename** of every `toast.error(` call site app-wide →
  `notifyError(` (rename only — **do not rewrite message text**; that is 3.2), and the action toast at
  `apps/web/src/features/watch/PromoteToTestDialog.tsx:76` (`action: { label: "Open collection" }`).
- **Depends:** Batch I merged · **Size:** M · **solo** · **Batch J** · **Model:** sonnet · medium.

**The work (D-IC7).** Errors and actionable notifications **do not auto-dismiss**; successes may.
- `lib/notify.ts` — a single `notifyError(message, options?)` that wraps `toast.error` and **forces
  `duration: Infinity`** (stays until dismissed), forwarding `description`/`action`/etc. It is the single
  authority; no call site sets its own error duration.
- `<Toaster>` in `main.tsx` — keep a finite `duration` for **successes** (e.g. 4000), but errors go
  through `notifyError` (Infinity). Keep `richColors closeButton position="top-right"` (manual dismissal
  stays).
- The **one action-bearing toast** (`PromoteToTestDialog`, "Open collection") gets `duration: Infinity`
  too (WCAG 2.2.1 — an actionable toast must not expire).
- **Mechanically** swap every `toast.error(` → `notifyError(` (import from `lib/notify`). **Text
  unchanged.** ~176 sites.

**Acceptance:**
1. `lib/notify.ts` exists; its test asserts `notifyError` **never passes a finite duration** (it calls
   the sonner API such that the toast stays until dismissed — assert `duration: Infinity` or equivalent).
2. Grep: **zero** remaining bare `toast.error(` call sites in `apps/web/src` (all → `notifyError(`).
   Report the swapped count (~176).
3. The `PromoteToTestDialog` action toast has `duration: Infinity`.
4. Successes still auto-dismiss (the `<Toaster>` finite default applies to non-error toasts).
5. Gate green; **no message text changed** by this WP (diff shows only the call-name rename + notify.ts +
   Toaster + the one action toast).

---

## WP 3.2 — One error voice  · 3.2a · 3.2b · 3.2c (parallel, after 3.1)

- **Findings covered:** 12 (MEDIUM — four error voices coexist), **D-IC8**.
- **Depends:** 3.1 merged · **Size:** M each · **parallel** (three disjoint directory slices) ·
  **Batch J** · **Model:** sonnet · medium each.
- **Split (disjoint domains):**
  - **3.2a** — `apps/web/src/components/**` + `apps/web/src/features/testing/**`
  - **3.2b** — `apps/web/src/features/hub/**` + `apps/web/src/features/skills/**`
  - **3.2c** — `apps/web/src/features/settings/**` + `features/servers/**` + `features/scans/**` +
    `features/review/**` + `features/watch/**` + `features/issues*/**`

**The work (all three slices).** One opener — **"Couldn't `<verb>` `<object>`."** with a **curly
apostrophe** — **plus a next step** in every error message (InlineError, `notifyError`, ErrorState,
ErrorBoundary). Today four openers coexist: "Couldn't" (28), "Could not" (~75), "Failed to" (~9),
"`<Noun>` failed" (~14, incl. "Action failed"). Rewrite them in your slice to the one voice, and
**rename the ones that name internals rather than user concepts**:
- "Couldn't load the org rail" → a user concept, not an internal widget.
- "Couldn't load quality" → name what the user sees.
- "Action failed", "Something went wrong", "Can't connect those" → say what failed and the next step.

**Preserve what is already right ([`conventions.md`](./conventions.md) §7):** zero user-blaming, zero
"Oops", zero exclamation marks — **do not introduce any**. The **target voice** to match is
`RunConsole.tsx:822` and `GradePanel.tsx:142`; also preserve `IconPicker.tsx:141`. Leave those three
alone.

**Acceptance (per slice):**
1. Every error message in the slice opens with **"Couldn't"** (curly apostrophe) **and** carries a **next
   step**. Report: openers normalized (count of "Could not"/"Failed to"/"`<Noun>` failed" → 0 in the
   slice).
2. The named internal-naming messages in the slice are rewritten to **user concepts**.
3. **Zero** exclamation marks / "Oops" / user-blaming introduced (grep the diff).
4. The target-voice sites (`RunConsole.tsx:822`, `GradePanel.tsx:142`, `IconPicker.tsx:141`) are
   **untouched**.
5. Gate green; snapshot/string tests updated in-slice as needed (in-domain only).

> **Cross-slice apostrophe consistency:** the review found curly-vs-straight inconsistent **inside one
> file** (`SettingsView.tsx:2435` vs `:2848`). Each slice uses the **curly** apostrophe uniformly. The PM
> spot-checks apostrophe consistency at J-integration across all three merges.

---

### Batch J exit → Batch K
3.1 merged, then 3.2a/b/c merged (PM checks apostrophe + opener consistency across the three). Gate
re-run, counts recorded. K enters — **4.1 solo**, then **4.2 (owner)**.
