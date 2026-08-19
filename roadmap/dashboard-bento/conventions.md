# Conventions — dashboard-bento

Read with the repo rules in [`.claude/rules/`](../../.claude/rules/). These are the additions
specific to this plan.

## Gate

`pnpm typecheck && pnpm test && pnpm build && pnpm lint`, run **from the repo root**, all green.
Biome is the linter; there is no ESLint.

## Charts

- **The chart test blind spot is real.** Web suites `vi.mock` `@elabs-ai/components-charts` as
  no-ops (the barrel pulls a broken `@visx/gradient` subpath), so a wrong chart prop passes the
  gate silently. Any WP that touches chart props MUST add a **faithful-stub** test following
  `apps/web/src/features/dashboard/testing/time-axis-charts.test.tsx` — a stub that records the
  props it received and asserts on them.
- **Series colour must be a `var(--chart-N)` reference.** `isPaletteFill()` gates pattern
  generation and `ChartSeriesSpec.color` is *silently ignored* unless it is such a reference. A
  raw hex does not merely break the token rule, it does nothing.
- **The ramp is 12.** `--chart-1` … `--chart-12`; charts cycle all twelve before repeating.
- `status="loading"` exists only on `LineChart` / `AreaChart` / `BarChart` / `ComposedChart`.
  `RingChart`, `PieChart`, `Gauge`, `Sparkline` have no `status` — wrap them in a
  `ChartCard loading` / `ChartFrame loading` instead of inventing a spinner.

## Tailwind

Tailwind extracts class names **statically**. A template-literal class such as
`` `bg-chart-${n}` `` is never seen by the scanner and may not be generated at all. Prefer an
inline `style` with a `var(--chart-N)` value, or a lookup map of literal class strings.

## Both themes

Every visible change must read correctly in `light` and `dark`. Verify by looking at the running
app, not by assuming. Do not add `dark:` overrides — the tokens cover both.

## Reporting

Report honestly. Lead with what you could **not** verify (anything visual, any a11y claim, or
anything needing a provider key or the running app). Never mark your own WP done.
