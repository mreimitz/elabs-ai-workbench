---
type: "Work Package Spec"
title: "WP 2.3 \u2014 Web scenario editor (Allowed skills + AddSkillModal)"
description: "Phase: 2 \u00b7 Size: M \u00b7 Depends on: 2.2"
tags: ["roadmap", "RM-24"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 2.3 — Web scenario editor (Allowed skills + AddSkillModal)

**Phase:** 2 · **Size:** M · **Depends on:** 2.2

## Objective
Let users attach skills to a scenario in the editor — mirroring "Allowed servers & tools" — with a
Latest/pinned version picker and the eager toggle, and show the attached-skill token contribution in
the live footprint.

## Why / references
`../../research/skill-registry/08-scenario-attachment.md` (`../../research/skill-registry/08-scenario-attachment.md`)
(web UI) + mockup `#6`. Clone `features/testing/{ScenarioEditor,AddServerModal}.tsx`.

## Files
- `apps/web/src/features/testing/ScenarioEditor.tsx` *(modify)* — an "Allowed skills" panel beneath
  "Allowed servers & tools": list attachments with a version chip (Latest / v-n) + eager indicator +
  per-skill token footprint; add/remove.
- `apps/web/src/features/testing/AddSkillModal.tsx` *(create)* — Step 1 pick a skill; Step 2 choose
  Latest or a specific version (from `GET /api/skills/:id/versions`) + eager toggle → append an
  `AllowedSkill`.
- `apps/web/src/lib/api.ts` *(modify)* — reuse skill list/versions helpers (add only if missing).

## Acceptance
- [ ] The scenario editor can attach/detach skills; each attachment shows Latest or a pinned version +
      the eager flag; the scenario's live footprint sum includes the attached-skill L1 (and eager L2)
      tokens alongside servers.
- [ ] Saving persists `allowedSkills`; reopening restores them; pinning a specific version works and a
      later attempt to delete that version is blocked (surfaced honestly).
- [ ] `@elabs-ai/components-*` + tokens only; both themes correct; hooks clean; repo gate green.
- [ ] **Owner-verify (localhost:8080):** attach latest + pinned, run a scenario, see the footprint +
      the disclosure-tool reads in the run console; two-theme walk.

## Notes
Completes Phase 2. Shares `ScenarioEditor.tsx`/`api.ts` with the Testing surface — run solo among web
WPs. Depends on the run-engine wiring (2.2) so the footprint/labels reflect real behavior.
