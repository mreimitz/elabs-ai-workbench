import { useEffect, useMemo, useState } from "react";
import type { SuiteDeltaRow, SuiteRunStatus, SuiteVariant } from "@mcp-token-footprint/shared";
import { Badge, EmptyState, Skeleton, Text } from "@brand/ui";
import { DataTable } from "@brand/data";
import { GitCompareArrows, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { getSuiteDeltas } from "../../../lib/api";
import { deltaTextTone } from "../../../lib/delta";
import { getErrorMessage } from "../../../lib/errors";
import { formatCostUsd, formatNumber } from "../../../lib/format";
import { KpiStat } from "../../../components/KpiStat";
import { SelectField } from "../../../components/SelectField";
import { InlineError } from "../../../components/InlineError";
import { col } from "../../../lib/table";

/**
 * Benchmarks (WP 5.1, B14) — the SKILL-EFFECT delta view. For a suite run with variants, shows per test
 * each variant's grade/tokens/cost MINUS the chosen base variant's (meaned over repetitions), so an
 * operator can see at a glance whether attaching a skill made the agent BETTER (↑ grade) and/or CHEAPER
 * (↓ tokens/cost). Server-derived: every row is a {@link SuiteDeltaRow} from `GET /api/suite-runs/:id/
 * deltas?base=`. Deltas are means — the spread is disclosed via the repetition count in the header.
 */
export type SuiteDeltasProps = {
  suiteRunId: string;
  /** The suite run's frozen variant definitions (config snapshot). Empty → the tab isn't shown. */
  variants: SuiteVariant[];
  /** Test id → name, for readable rows. */
  testName: Map<string, string>;
  /** Planned repetitions per cell — disclosed so the reader knows the deltas are means over N reps. */
  repetitions: number;
  /** Re-fetch when the suite run settles (grades land post-completion). */
  status: SuiteRunStatus;
};

type DeltaDisplayRow = SuiteDeltaRow & { testLabel: string };

export function SuiteDeltas({
  suiteRunId,
  variants,
  testName,
  repetitions,
  status,
}: SuiteDeltasProps) {
  const [base, setBase] = useState(() => variants[0]?.label ?? "");
  const [rows, setRows] = useState<SuiteDeltaRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Keep the base selection valid if the variant set changes.
  useEffect(() => {
    if (!variants.some((v) => v.label === base)) setBase(variants[0]?.label ?? "");
  }, [variants, base]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    getSuiteDeltas(suiteRunId, base || undefined)
      .then((result) => {
        if (active) setRows(result);
      })
      .catch((err) => {
        if (active) setError(getErrorMessage(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [suiteRunId, base, status, reloadKey]);

  const displayRows = useMemo<DeltaDisplayRow[]>(
    () =>
      (rows ?? []).map((row) => ({
        ...row,
        testLabel: testName.get(row.testId) ?? `#${row.testId.slice(0, 6)}`,
      })),
    [rows, testName],
  );

  // Roll-up across all rows: mean grade delta (over graded rows), mean token + cost delta.
  const rollup = useMemo(() => {
    const graded = displayRows.map((r) => r.gradeDelta).filter((d): d is number => d !== null);
    const meanGrade = graded.length > 0 ? graded.reduce((s, d) => s + d, 0) / graded.length : null;
    const meanTokens =
      displayRows.length > 0
        ? displayRows.reduce((s, r) => s + r.tokensDelta, 0) / displayRows.length
        : 0;
    const meanCost =
      displayRows.length > 0
        ? displayRows.reduce((s, r) => s + r.costDelta, 0) / displayRows.length
        : 0;
    return { meanGrade, meanTokens, meanCost, count: displayRows.length };
  }, [displayRows]);

  const columns = useMemo(
    () => [
      col<DeltaDisplayRow>({ id: "test", header: "Test", value: (r) => r.testLabel }),
      col<DeltaDisplayRow>({
        id: "variant",
        header: "Variant",
        value: (r) => r.variantLabel,
        cell: (r) => (
          <Badge variant="secondary" className="max-w-full truncate">
            {r.variantLabel}
          </Badge>
        ),
      }),
      col<DeltaDisplayRow>({
        id: "grade",
        header: "Δ grade",
        numeric: true,
        // Sort ungraded rows last by treating null as -Infinity for the sort key only.
        value: (r) => r.gradeDelta ?? Number.NEGATIVE_INFINITY,
        cell: (r) => (
          <DeltaCell value={r.gradeDelta} higherIsBetter format={(v) => signed(v.toFixed(2))} />
        ),
      }),
      col<DeltaDisplayRow>({
        id: "tokens",
        header: "Δ tokens",
        numeric: true,
        value: (r) => r.tokensDelta,
        cell: (r) => (
          <DeltaCell
            value={r.tokensDelta}
            higherIsBetter={false}
            format={(v) => signed(formatNumber(Math.round(Math.abs(v))), v)}
          />
        ),
      }),
      col<DeltaDisplayRow>({
        id: "cost",
        header: "Δ cost",
        numeric: true,
        value: (r) => r.costDelta,
        cell: (r) => (
          <DeltaCell
            value={r.costDelta}
            higherIsBetter={false}
            format={(v) => signed(formatCostUsd(Math.abs(v), { precision: 4 }), v)}
          />
        ),
      }),
    ],
    [],
  );

  const baseOptions = variants.map((v) => ({ value: v.label, label: v.label }));

  return (
    <div className="flex flex-col gap-4 pr-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-xs grow">
          <SelectField
            id="delta-base"
            label="Base variant"
            value={base}
            onChange={setBase}
            options={baseOptions}
          />
        </div>
        <Text variant="meta" tone="muted" className="text-pretty">
          Each variant vs the base, meaned over <span className="tabular-nums">{repetitions}</span>{" "}
          {repetitions === 1 ? "repetition" : "repetitions"}. ↑ grade is better; ↓ tokens/cost is
          cheaper.
        </Text>
      </div>

      {/* Roll-up header — the average effect of switching from the base across every test. */}
      {rollup.count > 0 ? (
        <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-md border border-border bg-card px-4 py-3">
          <KpiStat
            label="Mean Δ grade"
            value={rollup.meanGrade === null ? "—" : signed(rollup.meanGrade.toFixed(2))}
          />
          <KpiStat
            label="Mean Δ tokens"
            value={signed(formatNumber(Math.round(Math.abs(rollup.meanTokens))), rollup.meanTokens)}
          />
          <KpiStat
            label="Mean Δ cost"
            value={signed(
              formatCostUsd(Math.abs(rollup.meanCost), { precision: 4 }),
              rollup.meanCost,
            )}
          />
          <KpiStat label="Rows" value={String(rollup.count)} />
        </div>
      ) : null}

      {error && rows === null ? (
        <InlineError
          title="Couldn’t load deltas"
          detail={error}
          onRetry={() => setReloadKey((k) => k + 1)}
        />
      ) : loading && rows === null ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : displayRows.length === 0 ? (
        <EmptyState
          icon={<GitCompareArrows aria-hidden />}
          title="No deltas yet"
          description="Deltas compare each variant to the base per test, once both sides have graded runs. They appear as the suite's cells complete and are graded."
        />
      ) : (
        <DataTable
          data={displayRows}
          columns={columns}
          initialView={{ sorting: [{ id: "test", desc: false }] }}
          emptyMessage="No deltas to show."
        />
      )}
    </div>
  );
}

/**
 * One signed delta cell: the value with an explicit sign + a directional arrow tinted by whether the
 * change is an improvement. `higherIsBetter` flips the good/bad direction (grade: up is good; tokens/
 * cost: down is good). A null value renders a neutral em dash. The tone comes from the ONE delta
 * authority (`lib/delta.ts`, D-IC3/D-UX9): better → success-green, worse → warning-amber, tie → muted
 * — so a better delta here reads as `--success`, never `--primary`.
 */
function DeltaCell({
  value,
  higherIsBetter,
  format,
}: {
  value: number | null;
  higherIsBetter: boolean;
  format: (value: number) => string;
}) {
  if (value === null) {
    return (
      <span className="inline-flex items-center justify-end gap-1 text-muted-foreground">
        <Minus aria-hidden className="size-3" />
        <span className="tabular-nums">—</span>
      </span>
    );
  }
  const tone = deltaTextTone(value, higherIsBetter);
  const Icon = value > 0 ? TrendingUp : value < 0 ? TrendingDown : Minus;
  return (
    <span className={`inline-flex items-center justify-end gap-1 tabular-nums ${tone}`}>
      <Icon aria-hidden className="size-3" />
      <span>{format(value)}</span>
    </span>
  );
}

/** Prefix an explicit sign. Pass `magnitudeText` for a preformatted magnitude + the raw value for sign. */
function signed(text: string, raw?: number): string {
  if (raw !== undefined) {
    if (raw > 0) return `+${text}`;
    if (raw < 0) return `−${text}`;
    return text;
  }
  // `text` already carries its own numeric sign (e.g. a toFixed of a signed number).
  const num = Number.parseFloat(text);
  if (Number.isFinite(num) && num > 0) return `+${text}`;
  if (Number.isFinite(num) && num < 0) return text.replace(/^-/, "−");
  return text;
}
