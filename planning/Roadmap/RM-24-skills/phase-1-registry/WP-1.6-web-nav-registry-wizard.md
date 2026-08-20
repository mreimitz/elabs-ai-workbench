---
type: "Work Package Spec"
title: "WP 1.6 \u2014 Web: nav section + registry + add-skill wizard"
description: "Phase: 1 \u00b7 Size: L \u00b7 Depends on: 1.3, 1.4"
tags: ["roadmap", "RM-24"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 1.6 — Web: nav section + registry + add-skill wizard

**Phase:** 1 · **Size:** L · **Depends on:** 1.3, 1.4

## Objective
Add the **Skills** nav section (order MCP → Skills → Testing), the `SkillsView` + searchable
`SkillRail`, and the add-skill wizard (upload **and** GitHub-discovery flows).

## Why / references
`../../research/skill-registry/07-ui-plan.md` (`../../research/skill-registry/07-ui-plan.md`) §1–§3,
mockups `#1`,`#2`. Mirror `features/servers/{ServerRail,ServerWizard}.tsx` + `AppShell.tsx` nav
groups. `@elabs-ai/components-*` only, two themes.

## Files
- `apps/web/src/components/AppShell.tsx` *(modify)* — `ViewKey += "skills"`; new `SKILL_NAV_ITEMS`
  `SidebarGroup` ("Skills") between MCP and Testing groups.
- `apps/web/src/App.tsx` *(modify)* — render `SkillsView`; `selectedSkillId` state +
  `mcp-token-footprint.selected-skill` persistence; skill CRUD handlers + toasts.
- `apps/web/src/lib/api.ts` *(modify)* — skill client wrappers + `apiUpload(path, file, fields)`.
- `apps/web/src/features/skills/SkillsView.tsx`, `SkillRail.tsx`, `SkillWizard.tsx` *(create)*.

## Acceptance
- [ ] Sidebar shows three sections in order **MCP analyzer → Skills → Testing**; "Skills" selects the
      new view with a `SkillRail` list (search, source badge, version count) — no regression to
      existing nav.
- [ ] Add-skill wizard: **Upload** (drop `.zip` or `SKILL.md` → `POST /api/skills` multipart) and
      **GitHub** (repo+ref+PAT → `POST /probe` → pick a discovered subpath → create) both register a
      skill and select it, with success/error toasts.
- [ ] All UI is `@elabs-ai/components-*` + semantic tokens; reads correctly in `light` and `dark`;
      `enforce-brand-ui`/`check-tokens` hooks clean.
- [ ] Repo gate green. **Owner-verify (cite localhost:8080):** live register-upload + register-GitHub
      round trips + two-theme walk.

## Notes
Shares `App.tsx`/`AppShell.tsx`/`api.ts` — run **solo among web WPs** (do not parallel with 1.7/1.8).
Inspector body is WP 1.7; this WP can render an empty inspector placeholder for the selected skill.
