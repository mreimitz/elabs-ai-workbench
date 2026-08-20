---
type: "Work Package Spec"
title: "Wave-0 contracts (published by A0)"
description: "Fixed names every later agent (A1, then Wave 1) consumes. Do not rename \u2014 A1 wires the density"
tags: ["roadmap", "RM-12"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# Wave-0 contracts (published by A0)

Fixed names every later agent (A1, then Wave 1) consumes. Do not rename — A1 wires the density
toggle to these exact attribute values, and Wave-1 screens build their density/visual-accept on the
token names below.

Owner of this file: **A0**. Source of the overrides: `apps/web/src/styles/app.css`.

---

## 1 · Density attribute (driven on `<html>`)

| Attribute | Values | Meaning |
|---|---|---|
| `data-density` | `comfortable` (DEFAULT when the attribute is absent) · `compact` | `comfortable` = upstream identity scale (pixel-stable). `compact` = the operator-dense scale below. |

- The attribute name **`data-density`** and the two values **`comfortable`** / **`compact`** are fixed.
  A1 toggles `<html data-density="…">` and persists the choice. When the attribute is absent the app
  renders at the upstream comfortable scale (no shift), so it is safe to ship before A1's toggle lands.
- Mechanism: `@elabs-ai/components-tokens/density.css` (already imported by `@elabs-ai/components-tokens/styles.css`) maps
  `[data-density]` → Tailwind's global `--spacing`. A0 re-declares the **compact** level harder, and adds
  the type-scale overrides (below) under `[data-density="compact"]`. Both reach every `@elabs-ai/components-*` package
  and all six themes because they are theme-invariant (`@theme`-style, not per-`[data-theme]`).
- `@elabs-ai/components-tokens` also ships a third level `spacious` (untouched by A0); A0 only owns the two values above.

---

## 2 · Token names introduced / overridden (compact only)

All under `[data-density="compact"]` in `apps/web/src/styles/app.css`. `comfortable`/default inherits the
upstream scale (no override). Values are rem (type scale), no colors.

### Spacing / row height
| Token | Compact value | Effect |
|---|---|---|
| `--spacing` | `0.205rem` (vs Tailwind `0.25rem` default / stock density.css `0.222rem`) | Rescales every `h-*`/`p*`/`gap-*`/`space-*` utility → padding-driven list/table rows land **~36–40px** (was ~53px); toolbars, sidebars, cards all tighten uniformly. |

> Note: `@elabs-ai/components-data` `DataTable` virtualized rows use a fixed JS prop `estimateRowHeight = 40` (not a
> CSS token) — already in target range, so no override needed there. Row compaction above applies to the
> padding-driven (`py-*`) rows.

### Type — raw Tailwind steps (the bulk of `@elabs-ai/components-*` component text: `text-sm`, `text-xs`, …)
| Token (+ companion `--…--line-height`) | Compact value | Target |
|---|---|---|
| `--text-xs` | `0.6875rem` / lh `1rem` | ~11px micro labels |
| `--text-sm` | `0.8125rem` / lh `1.15rem` (~1.42) | **13px** default app/body & table text |
| `--text-base` | `0.8125rem` / lh `1.15rem` | folds base → 13px |
| `--text-lg` | `0.9375rem` / lh `1.3rem` | ~15px section headings |
| `--text-xl` | `1rem` / lh `1.35rem` | 16px |
| `--text-2xl` | `1.125rem` / lh `1.45rem` | 18px |
| `--text-3xl` | `1.375rem` / lh `1.6rem` | **22px** (was the ~36px rung) |

### Type — semantic roles (`@elabs-ai/components-ui` `Text` / `Heading` / `MetricCard`)
| Token (+ companion `--…--line-height`) | Compact value | Role |
|---|---|---|
| `--text-body` | `0.8125rem` / lh `1.15rem` | **13px** body (default) |
| `--text-caption` | `0.75rem` / lh `1.05rem` | **12px** table / supporting |
| `--text-meta` | `0.6875rem` / lh `0.95rem` | ~11px eyebrow / timestamp |
| `--text-subtitle` | `0.875rem` / lh `1.2rem` | 14px sub-section |
| `--text-title` | `0.9375rem` / lh `1.25rem` | **15px** section / card / dialog heading |
| `--text-display` | `1.125rem` / lh `1.45rem` | 18px page / hero headline |
| `--text-kpi` | `1.375rem` / lh `1.6rem` | **22px** KPI numerals (was ~32–36px) |
| `--text-code` | `0.75rem` / lh `1.15rem` | 12px inline / block code |

Line-height is ~1.4 across the body rungs (per finding G1). Type roles map to utilities in `@elabs-ai/components-ui`:
`Text variant="kpi"` → `text-kpi tabular-nums`, `Heading` → `text-display`/`text-title`/`text-subtitle`,
default `Text` → `text-body`.

---

## 3 · `tabular-nums`

- KPI numerals already carry it: the `@elabs-ai/components-ui` `Text` `kpi` role renders `text-kpi tabular-nums`, and
  `MetricCard` uses the kpi role — so KPI tiles get tabular figures for free.
- For **any other comparing number** (token counts, deltas, before/after, history columns) add the
  Tailwind utility **`tabular-nums`** at the call site (on the cell / `Text`). A0 does NOT force it
  globally (it would harm prose); Wave-1 screens apply it on numeric columns/diffs.

---

## 4 · `sortParams` helper

- **Signature:** `sortParams(params: ToolParam[]): ToolParam[]`
- **Location:** `apps/web/src/lib/schema-params.ts` (additive — `parseParams` and the `ToolParam` /
  `ToolParamFlag` types are unchanged).
- **Behavior:** required params first, then optional, **preserving original order within each group**
  (stable). **Non-mutating** — returns a new array, does not reorder the input.
- **Consumers:** C3 (`ToolPlayground` run modal) and C2 (`ToolDetailPanel` Parameters tab) should
  `import { sortParams } from "@/lib/schema-params"` (or the relative path) and sort before render, so the
  required→optional ordering matches in both places without either agent editing the other's file.
