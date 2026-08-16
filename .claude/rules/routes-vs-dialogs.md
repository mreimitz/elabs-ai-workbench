# Routes vs. dialogs (D-TB10)

Every new surface in this app is either a **route** or a **dialog** — never an ambiguous third
thing, and never picked by convenience. This closes audit findings **B-5** (two entry mechanisms
for the same kind of task, with no written rule to tell them apart) and its consequence, **A-2**
(`/testing/runs/new` used to be a route that dead-ended with no query params).

> **Locked owner decision D-TB10 (2026-07-25).** Anything an operator would **bookmark,
> deep-link, or share** is a **route**. Anything **transient** — a single action, a short-lived
> form, a confirmation — is a **dialog**. Every route must render something useful with **zero
> query params**. Written down in `toolbar-reach` WP 4.4 (audit findings D-5/B-5).

## The rule

- **Route it** when the surface is a *place*, not an *action* — an operator should be able to
  paste the URL into a chat message, refresh the page and land back where they were, or open it
  in a new tab. Examples already in this app: `/testing/runs/:runId` (a run console), `/scans`,
  `/compare/scans` (the compare workspace), `/settings/:section` (yes — even a modal can be a
  route; see below).
- **Dialog it** when the surface is a *task* with a start and an end — create this one thing, edit
  this one field, confirm this one destructive action — and there is nothing useful to come back
  to once it closes. Examples: the server wizard, "add a collection", "delete this scan?".
- **A dialog can still be a route.** `/settings/:section` is a real, deep-linkable URL that
  happens to render as a modal over the current page (`SettingsView.tsx`'s `SettingsDialog`) —
  that's fine, because *closing Settings* has an obvious place to return to (the page it was
  opened over), and the URL itself is genuinely shareable ("go to Settings → Providers"). The
  test is still: would sharing this URL make sense on its own? If yes, it's a route (even if it
  paints as an overlay); if the answer is "no, you'd just see today's empty wizard," it's a
  dialog.
- **Every route renders something useful with zero query params.** `/testing/runs/new` must show
  a real, usable run-launcher on its own — not a blank shell that only works after a wizard
  populates hidden state via query params nobody would think to type. If a route needs a param to
  mean anything, that's a sign it should be a dialog reached from the page that has the context
  (or the route needs a real default/empty state, not just a redirect target).
- **No new nav item just because something is a route.** Plenty of routes are reached by drilling
  in from a page (a run console from the runs feed, a scan detail from the scans list) rather than
  a top-level nav entry — that's still fine. The rule governs route-vs-dialog, not nav placement
  (see B-6 for the separate "which routes get a nav entry" question, which this rule does not
  answer).

## Applying it

When adding a new capability, ask **"would an operator ever want to bookmark, deep-link, or share
this exact state?"** — yes → give it a route (and make sure it works from a cold load with just
that URL); no → a dialog is correct and simpler. Don't reach for a route out of habit, and don't
cram a genuinely place-like surface (a comparison, a console, a report) into a dialog just because
it was quicker to wire up.

Related: [`architecture.md`](./architecture.md) (routing is `react-router-dom` v7 in
`apps/web/src/App.tsx`), [`brand-ui-only.md`](./brand-ui-only.md) (dialogs are `@brand/ui`
`Dialog`/`Sheet`, never hand-rolled).
