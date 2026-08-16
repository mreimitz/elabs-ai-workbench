# Remediation status — what shipped

Execution of [`04-execution-plan.md`](./04-execution-plan.md) on branch **`ui-remediation`**.
Quality gate (`pnpm typecheck && pnpm test && pnpm build`) green; `brand-ui audit apps/web/src` →
0 issues. Live-verified against a running build (`pnpm start`) seeded with two real stdio MCP
servers (`@modelcontextprotocol/server-everything`, `…/server-filesystem`) in **qlik-bright,
qlik-dark, blueprint**.

## Waves

- **Wave 0 — foundation**
  - **A0** density & type tokens (G1/P0.3): compact operator scale via `[data-density="compact"]`
    overriding `--spacing` + the type tokens in `apps/web/src/styles/app.css`; `sortParams()` added to
    `lib/schema-params.ts`; contract in [`_contracts.md`](./_contracts.md).
  - **A1** shell/IA/Settings/confirm (G2,G3,G4,G5,SE1–SE3): quick-settings modal deleted; **Settings
    pinned bottom-left**; breadcrumb only at depth ≥2; `window.confirm` → controlled `AlertDialog`
    (both delete paths); theme + density controls on the Settings page.
  - **Orchestrator integration:** app ships **compact by default**; density wired through the
    `@brand/tokens` `ThemeProvider` (`defaultDensity="compact"` + `useTheme().density/setDensity`) —
    the provider owns `data-density`, so the earlier hand-rolled attribute writer was removed.
- **Wave 1 — screens (7 parallel)**: **B1** Dashboard de-slop (D1–D5) · **B2** Compare → one diff
  table (C1–C5) · **B3** Scans resizable split + searchable history (SC1–SC3,G6) · **B4** server-rail
  calm-down (S2,S4,G6) · **C1** Servers smart layout — grouped findings, `@brand/charts` trend +
  KPI sparklines, merged token-distribution, resizable + dense **sans** Tools table, collapsing KPI
  band (doc03 §1–2; S1,S3,S4,S5) · **C2** tool-detail — sticky header, Monaco raw/instructions with
  Expand, optimization above instructions, **run tab removed** (doc03 §3; `CodeBlock` retired) ·
  **C3** run modal — draggable splitter ⅓∶⅔, required-first params, balanced footer (doc03 §4).
- **Wave 2 — Z1 (orchestrator)**: merge + full gate green; cross-theme live sweep; `brand-ui audit`
  → fixed 2 arbitrary-radius nits (→ `rounded-sm`), now 0 issues.

## Correction to the audit's "6 themes" premise

The vendored **`@brand/tokens` v1.5.0 ships only three themes** —
`qlik-bright`, `qlik-dark`, `blueprint` (`THEMES` / `ThemeName`). There is **no** `light`, `dark`, or
`high-contrast` theme in this version. So:
- **G4/SE1 "expose all 6 themes"** is satisfied by exposing all themes that exist (the Settings switcher
  lists all of `useTheme().themes`).
- Open item **H** / **P2.3** "verify high-contrast is genuinely high-contrast" is **moot** — that theme
  does not exist here. The theme/a11y pass is a **three-theme** pass.

## P2.4 — forward-looking (testing run-console)

When the planned agent **testing run-console** (roadmap docs 10/12, `testing/STATUS.md`) is built,
compose it from the **corrected** patterns shipped here — the Servers hub (sticky header, `Tabs`,
`ResizablePanelGroup`, dense `DataTable`, `MetricGrid`/sparklines, grouped findings), the Scan-detail
table, and the Add-server `Wizard` — **not** the card-grid patterns this remediation removed. Keep the
compact density tokens (P0.3) as the baseline.

## Verified vs not

- **Verified live (3 themes, real data):** Dashboard, Settings, Servers Overview (charts/findings/
  distribution/profile+trend), Servers Tools (resizable, dense table, KPI-band collapse, sticky tool
  detail, no run tab), Run modal (split/footer/optional subhead), Scans (split + searchable history +
  detail), Compare (toolbar + Δ KPI + diff-table structure), server rail; compact density applied by
  default; theme switching; `Esc` dismiss on the run modal.
- **Not exercised live:** a populated Compare diff (the seeded scans were identical → empty diff; the
  row-mapping is code-reviewed), the destructive `AlertDialog` end-to-end delete (wired + reviewed),
  and fine WCAG-contrast numbers. A future `brand-ui-audit` skill run (browser-driven, all themes)
  would cover the perceptual/contrast tells.
