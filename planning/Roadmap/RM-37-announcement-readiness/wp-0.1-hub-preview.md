---
type: "Work Package Spec"
title: "WP 0.1 — Hub as preview: flags off on fresh installs, one nav entry below Testing"
description: "Phase 0 of item.md. Ledger: STATUS.md. Owner decision on the default state of the Assistant-workspace and App-assistant flags for fresh installs, a first-boot stamp that leaves existing installs untouched, one 'Assistant (preview)' sidebar entry placed after Testing, preview labelling in Settings › Features and README §9, and entry points that state which assistant does what."
tags: ["roadmap", "RM-37"]
timestamp: "2026-08-22T07:10:00Z"
status: "final"
---
# WP 0.1 — Hub as preview: flags off on fresh installs, one nav entry below Testing

Phase 0 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md).

## Scope

Surfaces and files: the feature-flag contract and store (`packages/shared/src/feature-flags.ts:80-139`,
`apps/api/src/features/service.ts`, boot order in `apps/api/src/index.ts`), the sidebar Assistant group
(`apps/web/src/components/AppShell.tsx:129-139` and its render block at `:636-705`, which today sits
above the MCP group at `:707`), Settings › Features (`apps/web/src/features/settings/FeaturesSection.tsx`),
the switched-off panel (`apps/web/src/features/feature-flags/FeatureDisabledView.tsx`), the Hub's
unconfigured state (`apps/web/src/features/hub/AssistantView.tsx:667-680`), the dock
(`apps/web/src/features/assistant/AssistantDock.tsx`), the "New session" modal
(`apps/web/src/features/hub/NewSessionDialog.tsx`) and README §9 (`README.md:228-241`). Out of scope: the
Hub's own surfaces once the flag is on (start surface, sessions table, agents, audit — WP 2.10), the
full shell IA and nav count (WP 2.1), the research-server presets in the add-server wizard (WP 1.2), the
compose `HUB_TOOL_LOADING_DEFAULT` override (WP 0.3), README restructuring beyond §9 (WP 0.7), and any
repository split. Rule 1 of the flag contract ("absent = on", `resolveFeatureFlags`) is not changed, so
an upgraded install with no stored blob keeps every feature on.

## Actions

1. **Owner decision needed:** default flag state for a fresh install. Options: (a) `assistant: false,
   app_assistant: false` — both assistants off, labelled preview; (b) `assistant: false,
   app_assistant: true` — Hub off, dock on; (c) both on as today. Actions 2–3 implement (a) or (b);
   actions 4–9 apply under every option. Record the choice in `STATUS.md`. — P0
2. First-boot stamp: in `apps/api/src/index.ts` directly after `applyMigrations` (or in the
   `FeatureFlagsService` constructor), when the database was created in this boot (`PRAGMA user_version`
   was 0 before migrating) and `app_settings` holds no `app.features` key, write the decided map
   `{ assistant, app_assistant, mcp_server: true }` through `settings.put(APP_SETTING_FEATURES_KEY, …)`.
   `DEFAULT_APP_FEATURE_FLAGS` stays all-on. Tests in `apps/api/test/`: fresh DB → stamped map; DB at
   schema > 0 without the key → all on; stored `false` survives restart. — P0
3. Fixtures that assume an on-by-default Hub (`e2e/smoke.spec.ts`, `apps/api/test/*feature*`,
   `apps/web/src/**/*.test.tsx` that render the Assistant group) set the flag explicitly instead of
   relying on the default, so the suite passes under options (a), (b) and (c). — P1
4. One nav entry: `ASSISTANT_NAV_ITEMS` (`AppShell.tsx:129-139`) becomes a single item
   `{ path: "/assistant", label: "Assistant (preview)" }` with `children` Sessions · Agents & crews ·
   Projects · Audit; children render collapsed unless `pathname` starts with `/assistant`; the group's
   render block moves from before the MCP group (`:636-705`) to after the Testing group (`:735-747`)
   and before Setup; `AppShell.test.ts` asserts position and entry count; the group stays hidden while
   `assistant` is off. — P1
5. Settings › Features labels (`feature-flags.ts:80-110`): `assistant.label` → "Assistant workspace
   (preview)", `app_assistant.label` → "App assistant (preview)"; each description gains the sentence
   "Off on new installs — turn it on here." — P1
6. Switched-off panel (`FeatureDisabledView.tsx`): title keeps "<label> is turned off"; the description
   says it is a preview feature and the action links to `/settings/features`; `/assistant/*` routes
   keep answering with this panel (no 404, no redirect). — P2
7. Hub unconfigured state with the flag on (`AssistantView.tsx:667-680`): the "Open Settings" button
   targets `/settings/providers`; the copy names the accepted credential kinds. — P2
8. Dock entry point with the flag on (`AssistantDock.tsx` empty state + TopNav toggle): empty state
   opens with one line naming the dock and its scope ("App assistant — reads this page and your servers,
   scans, runs and skills; for research or multi-agent missions use Assistant (preview)"); the ⌘J badge
   no longer shows the starter count (dot or nothing); a new dock opens on the page's starters, never on
   the last errored thread. — P2
9. "New session" modal with the flag on (`NewSessionDialog.tsx`): the Model row shows which credential
   or subscription bills the session ("Runs on: …"); the Research mode line states that it needs a
   search server. Inline start without the modal is WP 2.10. — P2
10. README §9 (`README.md:228-241`) shrinks to one paragraph: what the dock and the Hub are, that both
    are a preview, off on new installs, switched on in Settings › Features. The product page
    (`planning/user-guide/DC-23-product-overview/product-page.md`) does not describe the Hub today and
    stays that way. `.env.example` groups the `HUB_*`/`ASSISTANT_*` variables under one heading stating
    they apply only while the flags are on. — P1

## Acceptance

- [ ] Fresh volume, `docker compose up --build`: `GET /api/features` returns the decided map; under
      option (a) the sidebar shows no Assistant entry and no ⌘J toggle; `/assistant` shows the
      switched-off panel whose link lands on `/settings/features`.
- [ ] A database at schema > 0 with no `app.features` row boots with every flag on (API test).
- [ ] Flag on: exactly one sidebar entry labelled "Assistant (preview)", rendered after the Testing
      group; its children are collapsed on `/dashboard` and expanded on `/assistant/sessions`;
      `AppShell.test.ts` covers order and count.
- [ ] Settings › Features shows "(preview)" on both assistant rows and the new sentence.
- [ ] `/assistant` with no credential: the button opens `/settings/providers`.
- [ ] Dock empty state names the dock and the sidebar Assistant in one sentence; the ⌘J badge shows no
      number; opening the dock on `/testing/runs` never lands on an errored thread.
- [ ] README §9 is one paragraph and states the default-off state; no other README section describes
      the Hub.
- [ ] `pnpm test:e2e` passes with the flags off and with them on.
- [ ] Gate green: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`.

## Effort

**M** — the stamp and its tests are a day; the nav collapse, fixture updates, copy and README are two
to three more.

## Sources

`PO-01, PO-16, PO-20, PO-30, UX-35, MK-09, EU-25, EU-26, WT (Shell; App-assistant dock; /assistant)`
