import { formatCostUsd, formatDuration, formatNumber } from "../../../../lib/format";
import type { SummaryFormatters } from "../summary-derive";

/** Real minus sign (U+2212) for signed figures — lines up with `tabular-nums` and reads as a minus,
 *  not a hyphen (micro-typography rule). */
const MINUS = "−";

/** A plain (unsigned) percentage: one decimal below 10%, whole numbers above (keeps the matrix tidy). */
function percent(value: number): string {
  const abs = Math.abs(value);
  return abs < 10 && abs > 0 ? `${value.toFixed(1)}%` : `${Math.round(value)}%`;
}

/** Signed percentage with a real minus (for a Δ). */
export function signedPercent(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? MINUS : "";
  return `${sign}${percent(Math.abs(value))}`;
}

/** Signed integer with a real minus (for a raw Δ when a % from a zero baseline isn't expressible). */
export function signedNumber(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? MINUS : "";
  return `${sign}${formatNumber(Math.abs(value))}`;
}

/** The single formatter bundle shared by the matrix, the delta bars, and the verdict decomposition. */
export function summaryFormatters(): SummaryFormatters {
  return {
    number: formatNumber,
    cost: (v) => formatCostUsd(v),
    duration: formatDuration,
    percent,
    signedPercent,
    signedNumber,
  };
}
