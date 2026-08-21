---
type: "Work Package Spec"
title: "Hardening wave status \u2014 what shipped (Wave 1, ui-findings2)"
description: "Follow-on to 05-remediation-status.md. Branch ui-findings2"
tags: ["roadmap", "RM-12"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# Hardening wave status — what shipped (Wave 1, `ui-findings2`)

Follow-on to [`05-remediation-status.md`](./05-remediation-status.md). Branch **`ui-findings2`**
(off `ui-remediation`). Quality gate (`pnpm typecheck && pnpm test && pnpm build`) **green**;
`brand-ui audit apps/web/src` → **0 issues**. Live-verified against a running build (`pnpm start`,
port 8099) seeded with two real stdio MCP servers (`@modelcontextprotocol/server-everything`,
`…/server-filesystem`) in **light + dark**.

## Lanes

- **D1 — themes → two (owner decision).** The app now exposes **only `light` (default) and
  `dark`**; the shipped `blueprint` theme is filtered out of the Settings switcher, and any
  previously-persisted `blueprint` is coerced back to `light`. New `apps/web/src/lib/theme.ts`
  (`ALLOWED_THEMES`, `isAllowedTheme`, storage-key constant) + a pre-mount localStorage guard in
  `main.tsx` + a `useEffect` safety net in `SettingsView.tsx`. Stale "6 themes" copy corrected in
  `CLAUDE.md`, `.claude/rules/styling-and-tokens.md`, `.claude/rules/brand-ui-only.md`.
- **D2 — a11y hardening (code pass).** Surgical: added accessible names to the three
  `ResizableHandle`s (Servers Tools / Scans / Run modal); fixed `aria-current` from boolean →
  `"true" | undefined` on the server-rail and Tools-list rows (was emitting `aria-current="false"`
  on every inactive row). Verified-already-correct: no `outline-none` without a paired
  `focus-visible:ring`; `@elabs-ai/components-ui` Button/Dialog focus rings intact; no `div`-as-button; Radix
  Dialog/AlertDialog/Sheet keep default Esc/overlay dismissal.

## Live verification — the two items the remediation only code-reviewed are now exercised

- **Populated Compare diff ✅** — server *everything*, two scans (`generic_o200k` 1463 →
  `generic_cl100k` 1540 tok). The single diff `DataTable` renders 13 populated rows
  (Tool · Before · After · Δ · Change), Δ KPI **+77 ↑ 5.3%**, all rows *Increased*; `SearchInput`
  and the Change `FacetFilter` both filter; Δ sort toggles. Numerals are `tabular-nums` (via the
  `col` helper) and line up.
- **Destructive server-delete `AlertDialog` ✅** — a throwaway server deleted end-to-end through a
  themed Radix `AlertDialog` (not `window.confirm`): destructive copy, **Esc and Cancel dismiss
  without deleting**, overlay-click intentionally does *not* dismiss (correct for a destructive
  confirm), **Delete** removes it from the UI and from `GET /api/servers`.
- **Theme restriction ✅** — switcher shows exactly the two the vendor themes; setting
  `localStorage brand-ui-theme=blueprint` + reload resolves to `light` and the bad value is
  sanitized.
- **Cross-theme focus + contrast ✅** — visible green focus ring on dense rows / Compare table /
  Tools table in **both** themes; no broken/unstyled views; resizable handles reachable
  (`role=separator`, `tabindex=0`, aria-labelled).

## Notes / not done

- **Optional polish (not a defect):** the destructive-confirm button renders in the **primary
  (green)** style rather than a destructive/red variant — worth confirming the brand-ui
  `AlertDialogAction`/Button destructive variant in a later pass.
- WCAG contrast was assessed by **visual inspection of rendered screenshots** in both themes (no
  obvious failures); a numeric axe-core/oklch→sRGB audit was not run.
- **Cross-server / tool-level compare (north-star #4, audit §C4) is still OPEN** — Compare remains
  same-server scan-to-scan. That is Wave 2 (contract-first: `packages/shared` → `apps/api` → web).
