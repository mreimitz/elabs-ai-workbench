# Dashboard bento — the homepage Overview

## Concepts

* [Conventions — dashboard-bento](conventions.md) - Read with the repo rules in .claude/rules/. These are the additions
* [Dashboard bento — the homepage Overview](item.md) - Rebuild the dashboard landing surface on the bento grid, using the metric-card delta and visual props, chart datapoint clicks and the full twelve-colour chart ramp the app already owns but never switched on.
* [Dashboard bento — work-package status ledger · PRIORITY: MEDIUM](STATUS.md) - Living state for the dashboard-bento plan, read and updated by /next-wp dashboard-bento. A
* [WP 0.1 — Series ramp cycles all 12 chart tokens](WP-0.1-series-ramp.md) - Finding F5. 18 call sites use var(--chart-${(i % 5) + 1}) and 2 use % 4, against a token
* [WP 0.2 — Enable onDatapointClick, retire the stale workaround](WP-0.2-datapoint-clicks.md) - Finding F4. RunsErrorRatePanel.tsx:18-20 and ScansStripPanel.tsx assert that
* [WP 0.3 — Metric tiles carry trend + sparkline + a featured tile](WP-0.3-metric-tile-deltas.md) - Findings F3 + F8. MetricCardProps exposes delta, deltaDirection, positiveIsGood,
* [WP 1.1 — use-overview-data (the Overview tab's data layer)](WP-1.1-data-hook.md) - Produce the OverviewData declared in
* [WP 1.2 — Hero footprint chart + KPI tiles](WP-1.2-hero-kpi-tiles.md) - Build the Overview's chart-bearing tiles against the committed contract
* [WP 1.3 — Attention, Movers and Advisor tiles](WP-1.3-list-tiles.md) - Build the Overview's list/text tiles against the committed contract
* [WP 1.4 — The bento shell + Overview becomes the default tab](WP-1.4-tab-shell.md) - Compose the tiles from WP 1.2/1.3 into a BentoGrid and make Overview the tab the Dashboard lands
* [WP 2.1 — Scan inventory tiles + the two tables as bento tiles](WP-2.1-scan-tiles.md) - Owner feedback 2026-08-20, item 3: "Overview and scans can be merged from my perspective. Bring the
* [WP 2.2 — One page-level toolbar, correct order, and Scans merged into Overview](WP-2.2-shell-restructure.md) - Owner feedback 2026-08-20, items 1–3. Depends on WP 2.1 (the four new tiles).
* [WP 2.3 — Fleet footprint plots every server, carried from its last successful scan](WP-2.3-footprint-population.md) - "fleet footprint shows only scanned MCP servers which have been scanned during the selected time
* [WP 2.4 — The footprint lines differentiate by stroke, not by colour alone (D-DB4)](WP-2.4-series-differentiation.md) - The --chart-1..12 ramp is not twelve distinguishable hues; seven plotted servers render as three near-identical limes, two near-identical blues and two greys.
