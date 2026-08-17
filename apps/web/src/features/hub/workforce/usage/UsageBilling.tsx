import { DataTable, type ColumnDef } from "@elabs-ai/components-data";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, Text } from "@elabs-ai/components-ui";
import {
  PROVIDER_KIND_BILLING_LABELS,
  providerKindLabel,
  type HubUsageProviderCredentialBucket,
  type ProviderKindBilling,
} from "@mcp-token-footprint/shared";
import { formatCostUsd, formatNumber } from "../../../../lib/format";
import { sharePercent } from "./usage-derive";

/**
 * model-identity WP3.3 (D-MI10) — the Usage tab's "Billed to" panel: spend split by the provider
 * CREDENTIAL that actually ran each session, rolled up from `GET /api/hub/usage`'s
 * `byProviderCredential`.
 *
 * WHY this exists as its own panel rather than another `groupBy` value on the ranked table: the
 * rollup endpoint's five dimensions (agent/crew/project/model/mode) all answer "what was the spend
 * FOR"; this one answers "which key was BILLED" — the question that surfaced the defect this
 * workstream fixes. A Hub session on a `claude_subscription` credential used to report as plain
 * "Anthropic" because the provider was re-guessed from the model NAME by a heuristic whose return
 * type structurally excludes the subscription. Attribution now reads the session's persisted
 * `provider_credential_id`, so a subscription bucket reads **"Anthropic CLI"** and two API keys of the
 * same kind are two distinguishable rows.
 *
 * A bucket flagged `unpinned` is spend whose provider was INFERRED from the model name because no
 * credential was recorded (a pre-v55 session, or one whose credential was since deleted). It is
 * labelled as such rather than blended into a measured bucket — a guess and a fact must not read the
 * same. This is deliberately NOT `SubscriptionCostMarker`: that component's copy is run-scoped
 * ("this run's cost…") and says nothing about which key a rollup was billed to.
 */

/** Billing basis → `Badge` variant. Token-driven variants only (never a colour literal): the
 *  subscription/local/tenant bases read as "no per-token charge against a key", the metered one as the
 *  neutral default, so the row that costs real money per token is never the loud one by accident. */
const BILLING_BADGE_VARIANT: Record<
  ProviderKindBilling,
  "secondary" | "outline" | "info" | "success"
> = {
  metered_api_key: "outline",
  subscription: "info",
  local: "secondary",
};

export function UsageBilling({ buckets }: { buckets: HubUsageProviderCredentialBucket[] }) {
  // Share is computed against THESE buckets' own sum (every filtered session lands in exactly one, by
  // construction in `hub/usage.ts`) so the column always totals 100% — never against a KPI total drawn
  // from a different endpoint, which could silently disagree.
  const totalCostUsd = buckets.reduce((sum, bucket) => sum + bucket.costUsd, 0);

  const columns: ColumnDef<HubUsageProviderCredentialBucket>[] = [
    {
      id: "credential",
      accessorFn: (bucket) => bucket.label,
      enableSorting: true,
      header: () => <div className="min-w-0">Billed to</div>,
      cell: ({ row }) => {
        const bucket = row.original;
        const kindLabel = bucket.providerKind
          ? providerKindLabel(bucket.providerKind)
          : "Unknown provider";
        return (
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="min-w-0 max-w-[18rem] truncate font-medium" title={bucket.label}>
              {bucket.label}
            </span>
            <Text variant="caption" tone="muted">
              {bucket.unpinned
                ? `${kindLabel} — inferred from the model name; no credential recorded`
                : kindLabel}
            </Text>
          </div>
        );
      },
    },
    {
      id: "billing",
      accessorFn: (bucket) => bucket.billing ?? "",
      enableSorting: true,
      header: () => <div className="min-w-0">Billing</div>,
      cell: ({ row }) => {
        const bucket = row.original;
        return (
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {bucket.billing ? (
              <Badge variant={BILLING_BADGE_VARIANT[bucket.billing]}>
                {PROVIDER_KIND_BILLING_LABELS[bucket.billing]}
              </Badge>
            ) : (
              <Text variant="caption" tone="muted">
                —
              </Text>
            )}
            {bucket.unpinned ? <Badge variant="outline">Not pinned</Badge> : null}
          </div>
        );
      },
    },
    {
      id: "sessions",
      accessorFn: (bucket) => bucket.sessions,
      enableSorting: true,
      header: () => <div className="text-right">Sessions</div>,
      cell: ({ row }) => (
        <div className="text-right tabular-nums">{formatNumber(row.original.sessions)}</div>
      ),
    },
    {
      id: "cost",
      accessorFn: (bucket) => bucket.costUsd,
      enableSorting: true,
      header: () => <div className="text-right">Cost</div>,
      cell: ({ row }) => (
        <div className="text-right tabular-nums">{formatCostUsd(row.original.costUsd)}</div>
      ),
    },
    {
      id: "tokensIn",
      accessorFn: (bucket) => bucket.tokensIn,
      enableSorting: true,
      header: () => <div className="text-right">Tokens in</div>,
      cell: ({ row }) => (
        <div className="text-right tabular-nums">{formatNumber(row.original.tokensIn)}</div>
      ),
    },
    {
      id: "tokensOut",
      accessorFn: (bucket) => bucket.tokensOut,
      enableSorting: true,
      header: () => <div className="text-right">Tokens out</div>,
      cell: ({ row }) => (
        <div className="text-right tabular-nums">{formatNumber(row.original.tokensOut)}</div>
      ),
    },
    {
      id: "share",
      accessorFn: (bucket) => sharePercent(bucket.costUsd, totalCostUsd),
      enableSorting: true,
      header: () => <div className="text-right">Share</div>,
      cell: ({ row }) => (
        <div className="text-right tabular-nums">
          {sharePercent(row.original.costUsd, totalCostUsd)}%
        </div>
      ),
    },
  ];

  return (
    <Card className="min-w-0">
      <CardHeader className="space-y-0">
        <CardTitle>Billed to</CardTitle>
        <Text variant="meta" tone="muted">
          Spend by the provider credential each session actually ran on.
        </Text>
      </CardHeader>
      <CardContent>
        <div className="min-w-0 overflow-hidden rounded-lg border border-border">
          <DataTable
            data={buckets}
            columns={columns}
            initialView={{ sorting: [{ id: "cost", desc: true }] }}
            emptyMessage={
              <EmptyState
                title="No spend in this window"
                description="Widen the date range or clear the project filter to see which credentials were billed."
              />
            }
          />
        </div>
      </CardContent>
    </Card>
  );
}
