---
type: "Work Package Spec"
title: "WP 2.1 — Shell IA for 1440×900"
description: "Phase 2 of item.md. Ledger: STATUS.md. Sidebar reduced to ≤ 11 entries (8 + Settings with the Hub off), active item always visible, a footer with Help and the version, no empty header bands, the App-assistant dock on the app's own surface, and the eight app-wide information-hierarchy rules shipped as a rules file every later Phase 2 view follows."
tags: ["roadmap", "RM-37"]
timestamp: "2026-08-22T07:10:00Z"
status: "final"
---
# WP 2.1 — Shell IA for 1440×900

Phase 2 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md). First WP of the relayout
phase: it fixes the frame every other Phase 2 view sits in and writes down the rules they follow.

## Scope

The shell only: `apps/web/src/components/AppShell.tsx` (the six nav arrays at lines 108–183, the
`SidebarFooter` at 764–787, the dock `<aside>` at 820–839, the ⌘J toggle badge at 528–535),
`apps/web/src/components/PageShell.tsx` + `ViewToolbar.tsx` (the header-band rule),
`apps/web/src/App.tsx` (breadcrumb roots, `derivePageTitle` at 1745–1758),
`apps/web/src/features/notifications/NotificationBell.tsx`,
`apps/web/src/features/command-palette/CommandPalette.tsx`,
`apps/web/src/features/assistant/AssistantDock.tsx` (surface only, lines 623–635), and one new file
`.claude/rules/information-hierarchy.md`. Every route keeps resolving — deep links, breadcrumbs and
the command palette still reach `/scans`, `/testing/review`, `/testing/compatibility` and the two
observability pages; only their nav placement changes. **Out of scope:** the Hub flag default and
the "(preview)" decision (WP 0.1), the product name and version source (WP 0.2), `/docs` content
(WP 1.4), the dock's copy, starters and error surfaces (WP 2.10), Settings section content.
**Continues:** RM-32 WP 3.1 shell cleanup (`/Roadmap/RM-32-overview-detail/wp-3.1-shell-cleanup.md`)
and RM-36 WP 2.1 (`/Roadmap/RM-36-ui-ux-audit-remediation/wp-2.1-responsive-actions.md`, primary
actions reachable at 768px — unchanged here). RM-32's `EntityBrowser` is not touched by this WP.

## Target layout

Zones of the shell in reading order (sidebar top to bottom, then the page frame left to right):

| Zone | Component | Contents | Removed / merged / demoted |
|---|---|---|---|
| 1. Sidebar header | `SidebarHeader` | App icon + the one product name (WP 0.2 decides it) | Second wordmark line |
| 2. Sidebar nav | `SidebarGroup`s | The tree below; group labels MCP · Skills · Testing; Assistant (flag on) as ONE entry below Testing with four children collapsed unless an `/assistant/*` route is active | Scans, Review, Review rubrics, Compatibility, Watch rules, the unlabeled 5-item Assistant group, the Setup group |
| 3. Sidebar footer | `SidebarFooter` | Settings · Help (→ `/docs`, WP 1.4) · Report a problem (→ About) · version from the single source (WP 0.2) | "Local / dev mode" except under `import.meta.env.DEV` |
| 4. Top bar | `TopNav` | Search ⌘K · bell · theme menu · ⌘J toggle with a **dot** (tooltip carries the count) | The numeric badge that reads as unread |
| 5. Breadcrumb row | `route-crumb` + `BreadcrumbEntitySwitcher` | `Section › Entity ▾`; a single crumb when section == page; Assistant routes root at "Assistant"; a view's lone primary action may sit at the row's right end | "Skills › Skills"; the "Home" root on Assistant routes |
| 6. Header band | `PageShell header` / `ViewToolbar` | Rendered only when it carries search/filters, `results`, or ≥ 2 actions | Bands holding only ⓘ + one button (`hub/workforce/WorkforceView.tsx:157`, `hub/projects/ProjectsView.tsx:26`) — ⓘ sentence goes inline on the zero state (WP 3.3), the button to zone 5 |
| 7. Content region | `PageShell` content | Unchanged: the only scroll container (S22) | — |
| 8. App-assistant dock | `<aside>` in `AppShell.tsx` | Right column on the content surface (`bg-background text-foreground`, `border-l`), same tokens as the page in both themes | The `bg-sidebar` ground that renders a dark dock beside a light page |

**Navigation tree A — Hub flag on (9 entries + Settings, ≤ 11 rows with children collapsed):**

```
Dashboard
MCP        MCP Servers · Compare · Advisor
Skills     Skills
Testing    Tests (= /testing/collections) · Runs · Environments
Assistant (preview) ▾   children: Sessions · Agents & crews · Projects · Audit
Settings   (footer)
```

**Navigation tree B — Hub flag off, the announcement default (8 entries + Settings):**

```
Dashboard
MCP        MCP Servers · Compare · Advisor
Skills     Skills
Testing    Tests · Runs · Environments
Settings   General · Features · Providers · Pricing · Grading · Review & alerts · GitHub · API tokens · Storage · About
```

Where the demoted entries live: **Scans** → `/servers/:id` Scans tab + dashboard "Recent scan
activity" footer link "All scans" (route kept, WP 2.4 de-rails it); **Review** → the Runs toolbar's
existing "Review these…"; **Review rubrics** and **Watch rules** → Settings › Review & alerts;
**Compatibility** → the server-detail "Model limits" tab (WP 2.3) with a "Fleet view" link to the
kept route (WP 2.9). No primary action on the shell itself; per-view primary actions stay in their
`ViewToolbar` (right-most) or, for single-action views, in zone 5.

**App-wide information-hierarchy rules** — the content of `.claude/rules/information-hierarchy.md`,
binding for WP 2.2 – 2.10 and every later view:

1. **Outcome before configuration.** A surface about something that ran (run, suite, collection, environment, skill) leads with the last verdict and cost; configuration is a meta line or an Edit action.
2. **One number, one place, one name.** A quantity appears once per viewport and is named identically wherever it recurs; a second figure states its relation in its label ("peak", "incl. agent sessions").
3. **Never truncate the identifier; truncate the metadata.** Titles, tool names, model ids and crew names get the width and up to two lines; counts, URLs and timestamps yield first (`min-w-0 truncate` goes on the meta span, never the title span).
4. **Absent is not zero; failure is not a measurement.** Unknown → "—" or "Not measured"; a failed scan shows its error, never "0 tokens"; a 0-test session has no pass rate.
5. **Reading order of every card and header: identity → state → primary number → action → meta.** One state colour per line; severity words ("Blocker", "High risk") only for things the operator must act on — heuristic findings use warning/info.
6. **The first viewport answers "is anything wrong, and what does it cost?"** Attention, verdict and money precede trends, mixes and inventories; curiosity tiles never outrank action tiles.
7. **One shell grammar, no exceptions.** One toolbar row (D-TB2), tabs in the URL (D-TB10), the content region is the only scroll container (S22), one loading recipe, one empty-state recipe with a recovery action.
8. **Density earns space.** 32 px compact rows, `max-w-prose` for paragraphs, tables over big-numeral rows for lists of more than three, and no tile more than half empty at 1440×900.

## Actions

1. **P1 — Reduce the nav to trees A/B.** WHERE: every route · `apps/web/src/components/AppShell.tsx:108–183` (`NAV_ITEMS` … `SETUP_NAV_ITEMS`) and the group render at 623–762. TARGET STATE: the arrays match the trees; `SETUP_NAV_ITEMS` is deleted; the Assistant entry is one `NavMenuItem` with `children` (collapsed unless active) rendered **below** Testing; `AppShell.test.ts` pins ≤ 11 visible rows and the order.
2. **P1 — Active item always visible.** WHERE: `AppShell.tsx` `SidebarContent` (622). TARGET STATE: on route change the active item is `scrollIntoView`-ed; when the nav overflows, a bottom fade signals it; the collapsed-rail state persists in `localStorage`; the collapsed icon rail shows a separator per group with the group name as the first icon's tooltip prefix.
3. **P1 — Sidebar footer.** WHERE: `AppShell.tsx:764–787`. TARGET STATE: Settings · Help · Report a problem · version (zone 3); the "Local / dev mode" text renders only under `import.meta.env.DEV` (string ownership: WP 0.2).
4. **P1 — Dock adopts the app surface.** WHERE: `AppShell.tsx:820–839` (`bg-sidebar text-sidebar-foreground`), `features/assistant/AssistantDock.tsx:623–635`, `apps/web/src/styles/app.css` `.assistant-dock-shell` fades. TARGET STATE: the aside and its `ChatShell` sit on `bg-background`/`text-foreground` with `border-l border-border`; the alpha-mask fades are re-verified on the new ground; no dark panel beside a light page in either theme.
5. **P2 — ⌘J hint badge becomes a dot.** WHERE: `AppShell.tsx:528–535`. TARGET STATE: a 6 px dot when `dockHintCount > 0`; the count stays in the button's label/tooltip only.
6. **P2 — Header-band rule.** WHERE: `components/ViewToolbar.tsx` + `PageShell.tsx`; `hub/workforce/WorkforceView.tsx:157`, `hub/projects/ProjectsView.tsx:26`, and any other `<ViewToolbar>` whose only props are `info` and one action (grep). TARGET STATE: such views omit `header`; the action renders at the breadcrumb row's right end via the existing breadcrumb slot; the ⓘ sentence moves inline (WP 3.3 wording).
7. **P2 — Breadcrumb roots and loading title.** WHERE: `App.tsx:1125` (`Skills › Skills`), `:1163–1176` (Assistant routes), `derivePageTitle` 1745–1758. TARGET STATE: single crumb when section == page; Assistant routes root at "Assistant"; while breadcrumbs are empty the document title keeps the route's static name, never "Page not found".
8. **P2 — Notification bell.** WHERE: `features/notifications/NotificationBell.tsx` (`Mark all read` at 112, row title at 197). TARGET STATE: titles wrap to two lines (rule 3); "Mark all read" disabled when nothing is unread; focus lands on the popover heading, not the first row's tooltip.
9. **P2 — Command palette index.** WHERE: `features/command-palette/CommandPalette.tsx`. TARGET STATE: "Go to" and typed search cover servers, skills, environments, collections, suites, tests (+ sessions/agents when the Hub flag is on); word-prefix matching replaces loose fuzzy; the dialog keeps a fixed top position as results shrink.
10. **P2 — Toolbar trigger widths.** WHERE: `components/TitledSelectTrigger.tsx` and its consumers. TARGET STATE: content-sized minimum widths; placeholders ≤ 18 characters; no trigger truncates while its row has free space.
11. **P3 — Sidebar re-expand.** WHERE: `AppShell.tsx` sidebar width transition. TARGET STATE: labels fade in after the width transition; no "Dashbo…" mid-animation.
12. **P1 — Rules file.** WHERE: `.claude/rules/information-hierarchy.md` (new, repo root). TARGET STATE: the eight rules above, each with a one-line "how to check" (e.g. rule 2: count each number string in the first viewport); linked from the Phase 2 WPs' acceptance.

## Acceptance

- [ ] At 1440×900 with the Hub flag off, the sidebar shows exactly Dashboard · MCP Servers · Compare · Advisor · Skills · Tests · Runs · Environments plus the footer, with no sidebar scrollbar; on `/testing/runs` and `/testing/environments` the active item is inside the first sidebar viewport.
- [ ] With the Hub flag on, one extra entry "Assistant (preview)" sits below Testing; its children appear only while an `/assistant/*` route is active, and the sidebar still needs no scroll with them expanded.
- [ ] `/scans`, `/testing/review`, `/testing/compatibility`, `/testing/observability/rules` and `/testing/observability/review-rubrics` still load with correct breadcrumbs and are reachable from the places named under the trees.
- [ ] The footer reads Settings · Help · Report a problem · `v<version>`; "dev mode" does not appear in the Docker image.
- [ ] `/assistant/agents` and `/assistant/projects` render no header band whose only contents are ⓘ and one button.
- [ ] With the dock open, `getComputedStyle(aside).backgroundColor` equals the content region's in both themes.
- [ ] The ⌘J toggle shows a dot and no digit; its tooltip states the count.
- [ ] Typing the first word of a collection's name in ⌘K lists that collection, its suites and the environments sharing the word; the dialog's top edge does not move as results change.
- [ ] `.claude/rules/information-hierarchy.md` exists with the eight rules; `AppShell.test.ts` fails if the visible nav rows exceed 11.
- [ ] Gate green: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`.

## Effort

**M** (3–4 days): nav + footer S · dock surface S · header-band rule + breadcrumbs S · palette index M · rules file S.

## Sources

UX-35, UX-36, UX-38, PO-16, PO-17, PO-18, PO-19, PO-20, QA-34, QA-35, QA-37, QA-43, EU-25 (badge), UXC-35, WT (walkthrough shell notes: page-header band, dock dark-on-light, badge on ⌘J, sidebar overflow at Review rubrics).
