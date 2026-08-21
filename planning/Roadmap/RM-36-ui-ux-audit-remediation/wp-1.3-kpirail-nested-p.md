---
type: "Work Package Spec"
title: "WP 1.3 — run console: remove the nested <p> React error"
description: "Phase 1 of item.md. Ledger: STATUS.md. The KPI cost tile passes a <Text> (a <p>) as MetricCard's description (also a <p>), producing invalid HTML and a React error on every run-console load in both themes."
tags: ["roadmap", "RM-36"]
timestamp: "2026-08-21T18:42:00Z"
status: "final"
---
# WP 1.3 — run console: remove the nested `<p>` React error

Phase 1 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md).
Finding **P1-4** in [`audit-report.md`](./audit-report.md).

**Depends on:** nothing. **Touches:** `apps/web/src/features/testing/KpiRail.tsx`.

## The finding

Captured from the running app at `/testing/runs/:runId`, in both themes:

```html
<p class="text-meta font-normal text-muted-foreground"><p class="text-meta text-muted-foreground">estimated</p></p>
```

`MetricCard` renders its `description` prop inside a `<p>`; the cost tile's call site passes a
`<Text>`, which is itself a `<p>`. Console output on **every** run-console load:

```
In HTML, <p> cannot be a descendant of <p>. This will cause a hydration error.
<p> cannot contain a nested <p>.
```

The word rendered is the cost tile's lead — `"estimated"` or `"subscription reference"`
(`KpiRail.tsx:175`, `costLead` / `costDescription`).

**Why it matters:** invalid HTML the browser silently re-parents, a latent hydration bug, and a
permanent React error in the console of the app's busiest screen — which is exactly how a real error
goes unnoticed.

## Scope

Pass `description` something that is not a block element: a plain string, or `<Text as="span">`.

Then check the **other** `MetricCard` call sites in the same file for the same shape — the audit
found one nested pair on this route, but the fix should not leave a sibling waiting to reappear.

Confirm `MetricCard`'s real `description` prop type with `pnpm exec brand-ui docs MetricCard` before
changing the call site.

## Out of scope

The KPI rail's figures, the cost basis, the `subscription reference` / `estimated` wording (D-CS4
governs that), the hotspots strip, and anything under `apps/api/`.

## Acceptance

- [ ] Loading `/testing/runs/:runId` for a real run produces **no** React console error, in both
      themes — verified by looking at the browser console on the running app.
- [ ] `document.querySelectorAll("p")` on that route yields **no** element containing another `<p>`.
- [ ] A test asserts the cost tile's description is not a block element, and is proved to bite by
      restoring the `<Text>` and watching it go red.
- [ ] The rendered wording is unchanged — still "estimated" / "subscription reference · of $X cap".
- [ ] Gate green: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`.
