---
type: "Work Package Spec"
title: "WP 2.1 — Security UI: tabs on the scan and the skill, posture badges in the servers list, the diff view"
description: "Surface the posture analyzer in the app: a Security tab on the scan detail and in the skill inspector, a posture badge per server in the servers list, and a baseline-picker diff view — both themes, keyboard reachable, brand-ui only."
tags: ["roadmap", "RM-20"]
timestamp: "2026-08-20T17:10:00Z"
status: "final"
---

# WP 2.1 — Security UI: tabs, badges, diff view

**Phase:** 2 · **Size:** L · **Depends on:** 1.4

Ledger: [`STATUS.md`](./STATUS.md). Item: [`item.md`](./item.md). Shared rules: the
[testing conventions](/Roadmap/RM-26-testing/conventions.md) + the repo rules in `.claude/rules/`.

**Runs SOLO.** It owns `apps/api/src/index.ts` for this round; WP 2.2 follows after it merges.

---

## Objective

Everything Phase 1 built is currently reachable only over HTTP. Put it in front of the operator:

1. a **Security tab** on the scan detail (`/scans/:scanId`) and in the **skill inspector**
   (`/skills/:skillId`), each listing findings worst-first with their evidence, the score and the band;
2. a **posture badge per server** in the servers list, so a fleet-level problem is visible without
   drilling in;
3. a **diff view** inside each Security tab — pick a baseline, see what was added, resolved and
   unchanged since.

## Locked decisions this WP inherits

- **D-SP3/D-SP6** — the score, the band and the finding order come off the report. The UI **never**
  re-sorts findings, never recomputes a band, and never re-derives a count from `findings.length`
  (`counts` describes *all* findings; the list may be capped — render `truncated` honestly).
- **D-SP12** — a finding's anchor is one of `server` · `skill` · `tool` · `parameter` · `file`.
  Render each kind with its own label; do **not** print the word "server" on a skill finding.
- **D-SP19** — a diff can be refused (400) for four reasons. Those refusals are **information**, not
  crashes: show the API's own message in an `Alert`, keep the tab usable, and never blank the view.
- **`.claude/rules/brand-ui-only.md`** — every visible element is a `@elabs-ai/components-*` component.
  No hand-rolled table, badge, dialog or tab strip. No raw colors: severity and band tone come from
  semantic tokens via the existing `StatusBadge` / `apps/web/src/lib/status.ts` vocabulary.
- **`.claude/rules/styling-and-tokens.md`** — correct in **both** themes (`light`, `dark`), verified by
  looking, not assumed.
- **`.claude/rules/icon-affordances.md`** — any icon-only control is `IconButton` with one `label`.
- **`.claude/rules/interaction-guidelines.md`** — `tabular-nums` on every count and score column;
  `min-w-0` on flex children that truncate; a real `EmptyState` for a clean subject.
- **`.claude/rules/loading-states.md`** — `loading` means *no content yet* (skeleton shaped like the
  content), and an error renders only on a settled failure.

## Decisions to lock in this WP (record them in the ledger's decision log)

- **D-SP21 — the Security tab is a TAB, not a route, and the diff is URL state inside it.** Both
  Security tabs live inside routes that already exist (`/scans/:scanId`, `/skills/:skillId`), and the
  baseline selection is a query parameter (`?tab=security&baseline=<id>`) rather than a new route. This
  is deliberate on two counts. It satisfies `.claude/rules/routes-vs-dialogs.md` — the state is
  genuinely deep-linkable and it *is* addressable, without inventing a place that renders nothing with
  zero query params. And it means **no `<Route>` is added**, so
  `.claude/rules/assistant-operability.md`'s `ASSISTANT_ROUTE_MANIFEST` and its gate are untouched. If
  you find yourself adding a `<Route>`, stop: you have changed the shape of this WP and must add a
  manifest entry, which is a different (and owner-visible) decision.
- **D-SP22 — the servers-list badge reads ONE new endpoint, computed on read like every other posture
  answer.** `GET /api/security/summary` returns, for each server that has at least one `success` scan,
  the posture of its **latest** one: `{ serverId, serverName, scanId, scannedAt, score, counts }`. It
  re-projects `analyzeScan` (D-MCP4 — the list badge and the detail tab can never disagree), skips a
  server with no usable scan rather than inventing a neutral score for it, and persists nothing
  (D-SP8). One request for the whole list — never one request per row, which is what a naive badge
  would do to a fleet of forty servers.
- **D-SP23 — a clean subject gets a real answer, not an empty table.** Score 100 / band `clean` renders
  an `EmptyState` that *says* it is clean and names what was checked (the analyzer version and the rule
  count), because a blank panel is indistinguishable from a broken one. Same for a diff with three
  empty buckets: "nothing changed" is a result.

---

## What we're building

1. **`apps/api/src/security/service.ts`** — `summarizeFleetPosture(ports): SecurityFleetSummary[]`
   (D-SP22). Reuses `analyzeScan`; adds no repository method. A server whose latest scan is not
   `success` is **omitted**, not zero-scored.
2. **`apps/api/src/security/routes.ts`** — `GET /api/security/summary`.
3. **`apps/api/src/index.ts`** — no new port; the security routes already receive `scans`, `servers`,
   `oauth` and `skills`. If a repository method is genuinely missing, say so in your report rather than
   widening the ports quietly.
4. **`packages/shared/src/security-posture.ts`** — the `SecurityFleetSummary` type + its `.strict()`
   zod schema, additively (contract-first). **Zero removed lines**; no change to
   `SECURITY_ANALYZER_VERSION`, the rules, the score, the order, the redactor or the differ.
5. **`apps/web/src/features/security/`** — the new components, composed from `@elabs-ai/components-*`:
   - `SecurityPanel.tsx` — score + band + per-severity counts (`MetricCard`s), then the findings
     `DataTable` (severity · rule · anchor · message), with an expandable/inspectable evidence cell;
   - `FindingSeverityBadge.tsx` — `StatusBadge`, tone from the existing status vocabulary
     (`error` → danger, `warning` → warning, `info` → info);
   - `PostureScore.tsx` — the score + band chip, `tabular-nums`, one definition used by the tabs and
     the list badge alike;
   - `SecurityDiffPanel.tsx` — the baseline `Select`, then Added / Resolved / Unchanged sections;
   - `security-api.ts` — the fetchers, mirroring `skills-inspector-api.ts`'s shape.
6. **`apps/web/src/features/scans/ScansView.tsx`** — a `{ value: "security", label: "Security", count }`
   entry in the existing `TabPanel` `tabs={[…]}` array (line ~584) plus its `TabPanelContent`. The
   count is `counts.total` **off the report**, not the rendered row count.
7. **`apps/web/src/features/skills/SkillInspector.tsx`** — a `<TabsTrigger value="security">` beside
   Quality/Usage/Issues (line ~691) plus its `TabsContent`, following that file's existing pattern
   exactly (including how `Issues` renders its count suffix).
8. **`apps/web/src/features/servers/ServersView.tsx`** (and/or `ServerRail.tsx` — read them and put it
   where the list actually renders) — the posture badge column/cell from `GET /api/security/summary`,
   one request for the whole list.
9. **Tests** — `apps/web/src/features/security/*.test.tsx` (vitest + testing-library, following the
   house pattern in e.g. `SkillBindingsPanel.test.tsx`) and an api test for the summary endpoint.

### Explicitly NOT in this WP

Report-export integration (WP 2.2 — do **not** touch `apps/api/src/reports/**`) · a new `<Route>` or
any change to `packages/shared/src/assistant-route-manifest.ts` (D-SP21) · a new assistant starter
surface or read tool · a workbench MCP tool over posture · any new rule, matcher, severity or rule id ·
any change to the analyzers, the score, the order, the redactor or the differ · a migration · a new
runtime dependency · an environment variable · a feature flag · persisting anything (D-SP8).

---

## Design notes (follow the house patterns; do not invent)

- **Read the real component API before using it.** `pnpm exec brand-ui docs <Component>` is the
  authority — never memory. If `docs` lists anti-patterns for a component, follow them.
- **Evidence rendering is the delicate part.** An excerpt arrives already redacted and escaped by
  D-SP4: invisible characters appear as literal `​` text, credentials as `«redacted»`. Render it
  as **text in a monospace, wrapping container** — never `dangerouslySetInnerHTML`, never a tooltip
  only (the whole point of the invisible-unicode rule is that you can *see* it), and never re-escape
  it a second time. `truncated: true` gets a visible "…" affordance saying the excerpt was cut.
- **The anchor column** renders per kind: `server` → "This server"; `skill` → "This skill version";
  `tool` → the tool name; `parameter` → `tool · path`; `file` → the relative path. Long names truncate
  with `min-w-0` and stay readable.
- **The rule column** shows the rule's `title` from `SECURITY_RULES`, with its `rationale` reachable
  (a `Popover` or an expandable row — your call, but it must be keyboard reachable). The rationale is
  written for the person who has to fix it; do not paraphrase it in the UI.
- **The baseline `Select`** lists the subject's other scans (or the skill's other versions), newest
  first, excluding the current one, labelled by date + short id. Selecting one sets `?baseline=`;
  clearing it returns to the plain report. A refused diff (D-SP19) shows the API's message in an
  `Alert variant="destructive"` **above** the still-rendered current report.
- **The servers-list badge** is the band, not the raw number, with the score as the accessible detail;
  a server with no usable scan renders the same muted "not scanned" treatment that column already uses
  for missing data — read the file and match it rather than inventing a third state.

---

## Files

**New**
- `apps/web/src/features/security/{SecurityPanel,SecurityDiffPanel,FindingSeverityBadge,PostureScore}.tsx`
- `apps/web/src/features/security/security-api.ts`
- `apps/web/src/features/security/*.test.tsx`
- api test coverage for `GET /api/security/summary` (extend
  `apps/api/test/security-analyzer.test.ts`'s sibling files or add one — do **not** edit
  `apps/api/test/ci-assertions.test.ts`)

**Modified**
- `packages/shared/src/security-posture.ts` (+ its test) — the fleet-summary type + schema, additive
- `apps/api/src/security/{service,routes}.ts`
- `apps/web/src/features/scans/ScansView.tsx`
- `apps/web/src/features/skills/SkillInspector.tsx`
- `apps/web/src/features/servers/ServersView.tsx` (and/or `ServerRail.tsx`)
- `apps/web/src/lib/api.ts` if that is where fetchers belong — read it first

**Zero-line diff (verify each with `git diff main..HEAD -- <path>`)**
- `apps/api/src/reports/**` — WP 2.2's, not this WP's
- `apps/api/src/security/{analyzer,skill-analyzer,text-scan}.ts` and
  `packages/shared/src/security-posture.ts`'s rules / score / comparator / redactor / differ
- `apps/api/src/assertions/**`, `packages/shared/src/ci-assertions.ts`
- `packages/shared/src/assistant-route-manifest.ts` (D-SP21), `apps/api/src/mcp-server/**`
- `apps/api/src/db/**` — no migration · `pnpm-lock.yaml`, every `package.json` — no dependency
- `.env.example`, `apps/api/src/config/env.ts`
- `planning/**` — the orchestrator ticks the ledger and syncs the index, not you

---

## Acceptance

- **A1** — A scan with findings shows them in the Security tab, worst-first, in the report's own order,
  with the score, band and per-severity counts read off `counts` (never `findings.length`); a
  `truncated` report says so.
- **A2** — The skill inspector's Security tab does the same for a skill version, and a skill finding
  never renders the word "server".
- **A3 (D-SP23)** — A clean subject renders an `EmptyState` that says it is clean and names what was
  checked; a diff with three empty buckets says "nothing changed" rather than showing three blank
  tables.
- **A4 (diff)** — Selecting a baseline shows Added / Resolved / Unchanged with counts; the selection is
  in the URL (`?tab=security&baseline=<id>`) and survives a reload; clearing it restores the report.
- **A5 (D-SP19)** — Each of the four refusals renders the API's own message in an `Alert` with the
  current report still visible. No blank screen, no thrown error boundary.
- **A6 (D-SP22)** — The servers list shows a posture badge per server from **one** request to
  `GET /api/security/summary`; a server with no `success` scan is shown as not-scanned, not as a score.
  An api test pins the endpoint's shape, its omission rule and that it persists nothing.
- **A7 (D-SP21)** — **No `<Route>` was added.** `packages/shared/src/assistant-route-manifest.ts` is
  zero-diff and the `assistant-route-operability` tests pass untouched.
- **A8 (brand-ui)** — Every visible element is a `@elabs-ai/components-*` component; no raw
  `<button>`/`<input>`/`<table>`/`<dialog>`; no raw color literal; `className` is layout-only. The
  `enforce-brand-ui` hook stays silent and `pnpm exec brand-ui audit apps/web/src/features/security/`
  is clean.
- **A9 (evidence)** — A finding whose evidence contains an invisible character renders it visibly as
  `\uXXXX` text; one containing a credential renders `«redacted»`. Neither is passed through
  `dangerouslySetInnerHTML`, and neither is double-escaped.
- **A10 (a11y + both themes)** — Every control is keyboard reachable with visible focus; icon-only
  controls are `IconButton` with a `label`; counts and scores use `tabular-nums`. **Run the app and
  look at both themes** (`pnpm build && pnpm start`, then `http://localhost:8080/`) — state in your
  report exactly what you looked at and what you could not.
- **A11 (gate)** — From the repo root: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`, plus
  `pnpm --filter @mcp-token-footprint/web test` **separately**, plus `pnpm okf:validate`. Report exit
  codes and counts. These are **pre-existing** and must be reported as such, never fixed silently:
  7 failing api tests (5 `compatibility-runner`, 1 `compatibility-tool-findings`, 1
  `compatibility-session`) and 2 `pnpm lint` errors on the two oversized `all-models.json` files.
  Measure the baseline **before** you change anything.
- **A12 (no drive-by scope)** — Every zero-line-diff path is clean; no file outside the Files section
  changed; no new rule, route, dependency, migration or feature flag. You did **not** touch any file
  under `planning/`.
