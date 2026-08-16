# Cross-server / tool-level compare — status (Wave 2, `ui-findings2`)

Closes audit **§C4** and **north-star #4** ("diff across servers, including tool-level"). Branch
**`ui-findings2`**. Quality gate green (`pnpm typecheck && pnpm test && pnpm build`); `pnpm test`
**42 pass** (16 new matcher tests); `brand-ui audit apps/web/src` → **0 issues**. Built
**contract-first** (`packages/shared` → `apps/api` → `apps/web`).

## What shipped

- **Contract (`packages/shared`):** `ScanComparison` / `ToolMatch` / `ComparedTool` /
  `ScanCompareRef` / `ToolMatchBasis` types, `compareQuerySchema`, `DEFAULT_COMPARE_THRESHOLD` (0.6).
- **API (`apps/api/src/compare/`):** `GET /api/compare?a=&b=&threshold=` — loads any two scans
  (same or different server) and returns a tool-level diff. Matching is three deterministic phases:
  **exact** tool name → **normalized** name (lowercase, strip non-alphanumeric: `get_user`↔`getUser`)
  → **fuzzy** (greedy best-first over **Jaccard** similarity of name+description tokens, ≥ threshold).
  Deltas are **B − A**. 404 on a missing scan id; 400 on an out-of-range threshold. Pure
  matcher/service, fully unit-tested.
- **Web (`apps/web/src/features/compare/CompareView.tsx`):** two independent pickers (Server A + Scan
  A, Server B + Scan B), one diff `DataTable` (Tool · **Match** · Before · After · Δ · Change), the Δ
  `MetricCard`, `SearchInput`, Change `FacetFilter`, and a **Fuzzy match** threshold select
  (Loose·0.4 / Balanced·0.6 / Strict·0.8). The **Match column** (basis + similarity %) shows for
  cross-server comparisons; a non-blocking **Alert** flags cross-token-profile comparisons. The old
  client-side `lib/compare.ts` was removed — the API is the single source of comparison logic.

## Live verification (seeded app on :8099, real stdio MCP servers)

- **API smoke:** cross-server everything↔filesystem at 0.6 → 0 matched / 13 only-in-A / 14 only-in-B,
  Δ +940 (64.3%); at 0.05 → 9 fuzzy matches (threshold-sensitive ✓). Same-server o200k↔cl100k → 13
  **exact** matches, Δ +77. 404 (bad scan id) ✓, 400 (threshold=2) ✓.
- **Browser (both themes):** (1) cross-server everything↔everything-2 → **Match column populated
  "Exact 100.0%"**, 13 matched / Δ 0; (2) cross-server everything↔filesystem → Match "—", 14 added /
  13 removed / Δ +940, FacetFilter + Search + threshold-select re-fetch all work; (3) same-server
  cross-profile → Match column **hidden**, cross-profile **Alert** shown, 13 Increased / Δ +77; (4)
  Qlik Dark renders cleanly with visible focus. All PASS.

## Notes / optional polish (not blocking)

- The **Fuzzy-match select stays visible in same-server mode**, where matching is exact and the
  control is a no-op. Optional: hide it (and relabel the count badges) when the loaded comparison is
  `sameServer`. Low priority.
- Fuzzy basis is demonstrable at low thresholds (API) but the offered UI presets (≥0.4) won't surface
  fuzzy pairs for *very* dissimilar servers (e.g. everything vs filesystem) — that is correct, not a bug.
- Destructive-confirm button still uses the primary (green) variant (carried over from Wave 1) — open polish.
