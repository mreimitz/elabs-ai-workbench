---
type: "Work Package Spec"
title: "WP 2.2 — consistency and density sweep"
description: "Phase 2 of item.md. Ledger: STATUS.md. Six polish findings: the runs table encodes two columns two ways each, server cards repeat their group heading's chips, the run launcher's step 1 is mostly empty, a 404 is swallowed silently on /testing/environments, a skill-inspector card stretches to dead space, and three side-stripe accents remain."
tags: ["roadmap", "RM-36"]
timestamp: "2026-08-21T18:45:00Z"
status: "final"
---
# WP 2.2 — consistency and density sweep

Phase 2 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md).
Findings **P2-1** … **P2-6** in [`audit-report.md`](./audit-report.md).

**Depends on:** nothing. Six independent, small changes; each may be taken alone.

## The findings

### P2-1 · The runs table encodes the same column two different ways

`/testing/runs`, both themes. In one table, in adjacent rows:

- **Status** — suite-run parent rows render `⊙ Completed` (icon + badge); child run rows render
  `Completed` (badge, no icon).
- **Grade** — parent rows render plain text (`100.0% pass`); child rows render **badges**
  (`Judge 70%`, `Answered`).
- **Actions** — parent rows show `Open console`; child rows show `Open` plus an unlabeled
  strikethrough-bell glyph.

Two visual encodings in one column reads as two meanings. **Fix:** one encoding per column; let the
row indent and the expander carry the parent/child distinction, which they already do. Give the
strikethrough-bell glyph a real accessible name (it is an icon-only control — `IconButton`, per
D-TB5).

### P2-2 · Server cards repeat the chips their group heading already states

`/servers`, both themes. The group heading reads `QLIK-SAAS · [Production] · 2`, and then every card
inside repeats `[qlik-saas] [Production]`. By the reduction filter this is removable without loss:
the grouping **is** the statement. **Fix:** keep the risk chip (it varies within a group); drop the
type and status chips on cards sitting under a heading that names them.

Same surface: `mcp-assets` truncates to `mcp-ass…` (81px shown against 90px needed) because the
`Scan failed` + `Medium risk` chips take the row — the name is clipped exactly on the card whose name
most needs reading. **Fix:** let the title wrap, or move the chips to their own row.

### P2-3 · The run launcher's step 1 is mostly empty

`/testing/runs/new`, both themes. The wizard holds a fixed height; step 1 shows two radio cards and
then roughly **380px of empty space** above the footer. The step rail also truncates
`Tests & environme…` with room to spare. **Fix:** size the dialog to its step, or bring step 2's
first decision forward. Widen the rail or shorten the label.

### P2-4 · A failed request on `/testing/environments` is swallowed completely

`GET /api/servers/FInszS9xQ4Jvdpo0fUdML/latest-scan` returns **404** on every load — an environment
references a server id that no longer resolves. The page shows **no error text, no `role="alert"`, no
`role="status"`, and no toast**. The failure exists only in the browser console.

`.claude/rules/architecture.md` and `interaction-guidelines.md` both require connection/scan failures
to surface and never be swallowed; a dangling reference is exactly the data-integrity signal an
operator needs. **Fix:** surface it inline on the affected environment row — "server no longer
available" — rather than dropping it. A 404 on this endpoint is a **known state**, not an
exceptional one, so it should read as information, not as an error banner over the whole page.

### P2-5 · Card-height coupling leaves dead space on the skill inspector

`/skills/:skillId` → Overview, both themes. The Frontmatter card is grid-paired with the taller
Token-footprint card and carries ~130px of empty space below `metadata.tags`. **Fix:** let the
shorter card size to content (`items-start` on the grid) rather than stretching.

### P2-6 · Three side-stripe accents

`apps/web/src/features/hub/SourcesPanel.tsx:124`,
`apps/web/src/features/testing/ReportTab.tsx:603`,
`apps/web/src/features/testing/compare/flow/LaneCell.tsx:125` — `border-l-2` / `border-l-4` accent
stripes, a generic-UI tell flagged by the static pass. **Fix:** a full `border-border`, a `bg-muted`
tint, or a leading icon. Lowest stakes in this plan; drop it if it costs more than it returns.

## Out of scope

Any change to what the runs table means, to grading, to the launcher's two-path model (D-T7), to the
environments API, or to the skill inspector's tabs. This is presentation only. `LaneCell`'s stripe
may be load-bearing in the compare flow diff — check before changing it, and leave it if it is.

## Acceptance

- [ ] `/testing/runs`: Status, Grade and Actions each use **one** encoding across parent and child
      rows; the strikethrough-bell glyph has an accessible name and a tooltip that matches it.
- [ ] `/servers`: cards under a type/status group heading no longer repeat that heading's chips, and
      `mcp-assets` renders its full name.
- [ ] `/testing/runs/new`: step 1 has no large empty region; the step rail label is not truncated.
- [ ] `/testing/environments`: the dangling-server 404 is visible in the UI on the affected row,
      and a test covers it.
- [ ] `/skills/:skillId` Overview: the Frontmatter card no longer stretches to dead space.
- [ ] Every touched surface reads correctly in **both** themes, verified by looking at the running
      app.
- [ ] Gate green: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`.
