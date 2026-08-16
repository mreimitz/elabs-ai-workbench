# Modes & interaction — how the skill engages the user

The skill runs **before** building. The flow is: **detect the mode** (what situation
you're in) → the **classification gate** (professional/consumer/marketing) → mode-specific
work. Governing principle: **infer first, ask least** — state your inferences, ask only
genuine unknowns, ≤4 questions per round (use `AskUserQuestion`), offer sensible defaults,
and never re-ask what's already known or stated.

## The four modes

| Mode                    | You're in it when…                                               | Goal                                                             | Hands off to                                                                                                          |
| ----------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Create** (greenfield) | "build / new / scaffold X"; empty or fresh repo                  | classify → archetype → baseline → screens                        | `brand-ui-new-app` (scaffold — **feed it the picked archetype: A tool/workspace or B enterprise admin**) + `brand-ui` |
| **Extend**              | existing brand-ui app + "add a page / view / feature"            | match the app; add the surface consistently                      | `brand-ui` (compose)                                                                                                  |
| **Audit & fix**         | existing app + "review / fix / looks off / a11y / issues"        | assess vs baseline + principles → report → remediate             | `brand-ui-audit` (score — **register = product/professional**)                                                        |
| **Retrofit**            | UI exists but **not** on brand-ui + "migrate / make it brand-ui" | map to `@brand/*`, stand up baseline, replace surface-by-surface | `brand-ui` + `brand-ui-theme`                                                                                         |

**Advise** is the read-only stop of _Audit & fix_: produce findings + recommendations and
stop, making no edits. Use it when the user wants an opinion, not changes.

## Step 0 — detect the mode (infer; ask only if unclear)

- Empty/fresh repo, or "build / new / create / scaffold" → **Create**.
- `@brand/*` already in `package.json` + "add / new surface / another view" → **Extend**.
- App exists + "audit / review / fix / improve / looks wrong / accessibility" → **Audit & fix**.
- UI present but no `@brand/*` (raw Tailwind / another kit) + "move to brand-ui" → **Retrofit**.
- Genuinely ambiguous → **one** `AskUserQuestion`: which mode (Create / Extend / Audit / Retrofit).

Detect by looking: check `package.json` for `@brand/*`, scan for an existing shell
(`AppShell`/`SidebarProvider`), themes, and routes before deciding.

## The universal gate — classify + register (every mode)

Usually **inferred and stated**, not asked — e.g. "This is a professional admin surface →
calm register." Only ask when the surface is genuinely ambiguous (a bare "a page for our
product" could be an app screen or a marketing page). Details + the trap:
`professional-vs-marketing.md`.

## Question sets (ask only the unknowns; ≤4 per round; offer defaults)

### Create — the interview (mirrors `brand-ui-new-app`)

1. **Intent** — what is it, who uses it, rough scale? (confirms professional; narrows the archetype)
2. **Archetype** — tool/workspace vs enterprise admin (or finer: dashboard · data app · AI
   assistant · flow · settings). Offer a rendered preview when possible.
3. **Brand & feel** — theme (qlik-bright default · qlik-dark · a client brand) and density.
4. **Surfaces & entities** — the main screens, the main objects + key fields (→ nav, tables, forms).

Skippable with "defaults are fine" — record the defaults chosen. Then hand the spec to
`brand-ui-new-app` (scaffold) — **feed it the shell archetype this skill picked (A
tool/workspace or B enterprise admin)** so the scaffold starts from the right shell — or
build from `assets/` + `enterprise-app-baseline.md`.

### Extend

First **detect and state** the existing shell archetype, theme, nav pattern, and register.

1. **Confirm** the detected shell + theme (or correct them).
2. **What to add** — the surface/entity + its key fields/actions.
3. **Where it slots** — a new top-level nav item vs a sub-tab vs a detail panel.

Reuse the app's existing conventions; defer component mechanics to `brand-ui`. Don't
introduce a second shell or theme.

### Audit & fix

1. **Scope & depth** — the whole app, or one surface/route? a quick baseline check, or a full review?
2. **Fix vs report-only** — remediate now, or produce findings for someone else (finder vs
   fixer)? any files that are off-limits / risk limits?

Then: scan → **prioritized findings (P0–P3)** across:

- **Baseline gaps** — missing shell / collapsible app icon / favicon / theme switcher /
  settings modal / Toaster / right-side detail panel (checklist: `enterprise-app-baseline.md` §3).
- **Register violations** — marketing slop in a professional surface (hero/landing layout,
  3-equal-card walls, gradient accents, fake-perfect stats, "Acme/Jane Doe" content).
- **Missing states** — empty/loading/error/overflow; **a11y** (contrast in qlik-bright +
  qlik-dark, focus rings, labels); **wrong shell/nav** for the app's job.

→ confirm scope → fix (or file issues) → route the scored review to `brand-ui-audit`
(register = _product/professional_). **Finder vs fixer:** report and get approval before editing.

### Retrofit

1. **Scope & order** — which screens first; incremental (surface-by-surface) vs big-bang.
2. **Constraints** — keep routes/behavior? which theme? what is allowed to change?

Then: map the current UI → `@brand/*` components, stand up the baseline, replace
surface-by-surface, strip raw colors / ad-hoc components (lean on tokens), verify per theme.

## Interaction principles (all modes)

- **Infer first, ask least.** State inferences; ask only genuine unknowns; ≤4 questions per
  round; offer defaults; never re-ask. Don't interrogate the obvious (an "admin console"
  is professional — say so and move on).
- **Classification-first**, but usually satisfied by inference.
- **Visual-feedback ladder** (use the highest available): Storybook / live preview →
  generated HTML preview → `AskUserQuestion` option previews → plain text. Never decide a
  visual on prose when a render is possible.
- **Finder vs fixer** in Audit: surface and route problems; get approval before changing
  product code.
- **Honest verification:** say what you did and did **not** visually verify (compiled ≠
  looked at); route scoring to `brand-ui-audit`.
- **Always defer:** real props → `brand-ui` (`brand-ui docs`); scoring → `brand-ui-audit`;
  scaffolding → `brand-ui-new-app`; tokens/themes → `brand-ui-theme`.

## Hand-offs (who owns what)

State both load-bearing facts every time a hand-off is mentioned:

- → **`brand-ui-new-app`** (greenfield scaffold): **feed it the shell archetype this skill picked
  (A tool/workspace or B enterprise admin)** so the scaffold starts from the right shell.
- → **`brand-ui-audit`** (scored UX/a11y review): **set its register = product/professional** so
  it judges this as a professional product surface, not marketing.
- → **`brand-ui`** for real component props/composition; → **`brand-ui-theme`** for tokens/themes.

Per mode:

- **Create:** this skill decides (classify → archetype → register → baseline) → `brand-ui-new-app`
  scaffolds (fed the picked archetype A/B) → `brand-ui` composes screens → `brand-ui-audit` scores
  (register = product/professional).
- **Extend / Retrofit:** `brand-ui` for component mechanics; `brand-ui-theme` for tokens/themes.
- **Audit & fix:** `brand-ui-audit` owns the scored rubric (register = product/professional); this
  skill owns the enterprise/register judgment and the remediation plan.
