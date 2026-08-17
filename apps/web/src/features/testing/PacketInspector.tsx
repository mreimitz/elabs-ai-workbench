import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import type {
  ContextSegment,
  RunStep,
  TokenProfileRef,
  TokenUsageActual,
} from "@mcp-token-footprint/shared";
import { CONTEXT_SEGMENTS } from "@mcp-token-footprint/shared";
import {
  Badge,
  Button,
  Descriptions,
  DescriptionsItem,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsTrigger,
  Text,
  toast,
} from "@elabs-ai/components-ui";
import { Check, Copy } from "lucide-react";
import { ScrollableTabsList } from "../../components/ScrollableTabsList";
import { SegmentedBar } from "../../components/TokenViz";
import { CodeSnippet } from "./CodeSnippet";
import { formatBytes, formatNumber, safeJson } from "../../lib/format";
import { deriveStatusView } from "../../lib/status";
import { firstProfileTokens, stepBrandStatus, stepTypeMeta, tokensDown, tokensUp } from "./StepLog";
import { notifyError } from "../../lib/notify";

/**
 * The packet inspector (WP 3.6, UI §5 / doc 12 §3.5): a right-side `Sheet` over the monitoring pane
 * that opens when a step is selected in the `StepLog` (or a tool card on the left). It is the
 * "see in detail" surface — Overview / Request / Response / Tokens / Raw tabs over the selected
 * `RunStep`.
 *
 * SECURITY (`mcp-and-security.md`): every payload here is UNTRUSTED tool output / a redacted request.
 * It is rendered read-only **as text** only — via `CodeSnippet` (a token-styled `<pre>`) or a `Text`
 * node — never `dangerouslySetInnerHTML`, never `eval`, never parsed into markup. Secrets are already
 * redacted server-side (the `payload` is redacted); we make no attempt to un-redact. The copy button
 * copies plain text to the clipboard only.
 */

export type PacketInspectorProps = {
  /** The currently-selected step id, lifted to `RunConsole`. `null` ⇒ the sheet is closed. */
  selectedStepId: string | null;
  /** All run steps — the selected step is resolved from this by id. */
  steps: RunStep[];
  /**
   * Suppress the slide-in Sheet even when a step is selected (Task C3 #1). The **Application** tab
   * owns its own in-pane detail surface (a `Tree` + `ArtifactPreview`), so when it is active this
   * global Sheet must stay closed — selecting a node still drives the shared `selectedStepId` (which
   * fills the in-pane preview and cross-highlights the conversation), it just doesn't pop this Sheet
   * over it. Network + Console leave this `false` and keep the Sheet.
   */
  suppressed?: boolean;
  /** Close the inspector (clears the shared selection). */
  onClose: () => void;
};

export function PacketInspector({
  selectedStepId,
  steps,
  suppressed = false,
  onClose,
}: PacketInspectorProps) {
  const step = useMemo(
    () =>
      selectedStepId ? (steps.find((candidate) => candidate.id === selectedStepId) ?? null) : null,
    [selectedStepId, steps],
  );

  const open = !suppressed && selectedStepId !== null && step !== null;
  const meta = step ? stepTypeMeta(step.type) : null;

  return (
    <Sheet open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-hidden sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex min-w-0 flex-wrap items-center gap-2">
            {step ? (
              <>
                <span className="tabular-nums text-muted-foreground">#{step.index + 1}</span>
                {meta ? (
                  <Badge variant="outline" className="font-normal">
                    {meta.label}
                  </Badge>
                ) : null}
                <span className="min-w-0 truncate font-mono">{step.toolName ?? step.label}</span>
                <StatusBadge status={stepBrandStatus(step.status)} size="sm">
                  {deriveStatusView(step.status).label}
                </StatusBadge>
              </>
            ) : (
              "Packet inspector"
            )}
          </SheetTitle>
          <SheetDescription>
            The exact request, response, and token accounting for the selected step. Payloads are
            read-only and already redacted.
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
          {step ? <PacketTabs step={step} /> : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * The selected step's detail surface (Overview / Request / Response / Tokens / Raw). Rendered inside
 * the right-side `Sheet` here, and reused standalone as the right pane of the Trace tab's expand modal
 * (`TraceLeafDetail`) — so "the detail panel that opens in the sheet" is the same component there.
 */
export function PacketTabs({ step }: { step: RunStep }) {
  return (
    <Tabs defaultValue="overview" className="flex min-w-0 flex-col gap-4">
      <ScrollableTabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="request">Request</TabsTrigger>
        <TabsTrigger value="response">Response</TabsTrigger>
        <TabsTrigger value="tokens">Tokens</TabsTrigger>
        <TabsTrigger value="raw">Raw</TabsTrigger>
      </ScrollableTabsList>

      <TabsContent value="overview" className="min-w-0">
        <OverviewTab step={step} />
      </TabsContent>
      <TabsContent value="request" className="min-w-0">
        <RequestTab step={step} />
      </TabsContent>
      <TabsContent value="response" className="min-w-0">
        <ResponseTab step={step} />
      </TabsContent>
      <TabsContent value="tokens" className="min-w-0">
        <TokensTab step={step} />
      </TabsContent>
      <TabsContent value="raw" className="min-w-0">
        <RawTab step={step} />
      </TabsContent>
    </Tabs>
  );
}

// ── Overview ──────────────────────────────────────────────────────────────────────────────────────

function OverviewTab({ step }: { step: RunStep }) {
  const meta = stepTypeMeta(step.type);
  const isTool = step.type === "tool_call" || step.type === "tool_result";
  const up = tokensUp(step);
  const down = tokensDown(step);
  const actual = step.usageActual;
  const lensTotal = firstProfileTokens(step);
  // The estimate-vs-actual delta on the headline summary (primary lens input+output vs provider actual).
  const actualTotal = actual ? actual.inputTokens + actual.outputTokens : null;
  const delta = actualTotal !== null && lensTotal > 0 ? lensTotal - actualTotal : null;
  const bytes = payloadBytes(step);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Descriptions columns={2} layout="horizontal">
        <DescriptionsItem label="Type">{meta.label}</DescriptionsItem>
        <DescriptionsItem label="Status">
          <StatusBadge status={stepBrandStatus(step.status)} size="sm">
            {deriveStatusView(step.status).label}
          </StatusBadge>
        </DescriptionsItem>
        {isTool ? (
          <DescriptionsItem label="Tool">
            <span className="font-mono">{step.toolName ?? step.label}</span>
          </DescriptionsItem>
        ) : (
          <DescriptionsItem label="Model">
            <span className="font-mono">{step.label}</span>
          </DescriptionsItem>
        )}
        {step.serverId ? <DescriptionsItem label="Server">{step.serverId}</DescriptionsItem> : null}
        <DescriptionsItem label="Duration" numeric>
          {step.durationMs === undefined ? "—" : `${formatNumber(step.durationMs)} ms`}
        </DescriptionsItem>
        <DescriptionsItem label="Bytes" numeric>
          {bytes === null ? "—" : formatBytes(bytes)}
        </DescriptionsItem>
        <DescriptionsItem label="Tokens ↑" numeric>
          {up > 0 ? formatNumber(up) : "—"}
        </DescriptionsItem>
        <DescriptionsItem label="Tokens ↓" numeric>
          {down > 0 ? formatNumber(down) : "—"}
        </DescriptionsItem>
      </Descriptions>

      <Descriptions columns={1} layout="horizontal">
        <DescriptionsItem label="Estimate (primary lens)" numeric>
          {lensTotal > 0 ? `${formatNumber(lensTotal)} tok` : "—"}
        </DescriptionsItem>
        <DescriptionsItem label="Provider-actual" numeric>
          {actualTotal !== null ? `${formatNumber(actualTotal)} tok` : "—"}
        </DescriptionsItem>
        <DescriptionsItem label="Delta (est − actual)" numeric>
          {delta === null ? "—" : <DeltaText value={delta} />}
        </DescriptionsItem>
      </Descriptions>
    </div>
  );
}

// ── Request ───────────────────────────────────────────────────────────────────────────────────────

function RequestTab({ step }: { step: RunStep }) {
  // The prompt-composition split (system / tool_defs / history / tool_results / output) from the
  // step's context snapshot — "what is eating the budget", directly on-thesis. Present on the llm /
  // context steps that carry a `context` snapshot.
  const segments = step.context
    ? CONTEXT_SEGMENTS.map((key) => ({
        label: SEGMENT_LABELS[key],
        value: step.context!.segments[key],
      }))
    : null;

  // The exact payload sent for a tool call is its `args`; the LLM request body itself is not persisted
  // (it is redacted server-side and never stored), so for llm steps we attribute composition instead.
  const args = toolArgs(step);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {segments ? (
        <div className="flex min-w-0 flex-col gap-2">
          <Text variant="meta" tone="muted">
            Prompt composition (primary lens)
          </Text>
          <SegmentedBar segments={segments} ariaLabel="Prompt token composition" />
        </div>
      ) : null}

      {args !== null ? (
        <CodeSnippet
          label="Tool arguments (sent)"
          value={args}
          ariaLabel="Tool arguments sent"
          maxHeightClassName="max-h-80"
        />
      ) : null}

      {!segments && args === null ? (
        <Text variant="meta" tone="muted">
          No request payload is recorded for this step. The exact model request body is redacted
          server-side and never stored; tool-call arguments and the composition split appear here
          when available.
        </Text>
      ) : null}
    </div>
  );
}

// ── Response ──────────────────────────────────────────────────────────────────────────────────────

function ResponseTab({ step }: { step: RunStep }) {
  const result = toolResult(step);
  const reasoningTokens = step.usageActual?.reasoningTokens;
  const overflow = overflowMessage(step);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {overflow !== null ? (
        <CodeSnippet
          label="Context overflow"
          value={overflow}
          ariaLabel="Context overflow message"
        />
      ) : null}

      {result !== null ? (
        <CodeSnippet
          label={result.isError ? "Error result" : "Result (structured)"}
          value={result.value}
          ariaLabel="Tool result"
          maxHeightClassName="max-h-96"
        />
      ) : null}

      {typeof reasoningTokens === "number" && reasoningTokens > 0 ? (
        <Descriptions columns={1} layout="horizontal">
          <DescriptionsItem label="Reasoning tokens" numeric>
            {formatNumber(reasoningTokens)}
          </DescriptionsItem>
        </Descriptions>
      ) : null}

      {result === null && overflow === null && (reasoningTokens ?? 0) === 0 ? (
        <Text variant="meta" tone="muted">
          This step has no separate response payload. Streamed assistant text and reasoning appear
          in the conversation pane; tool results show here.
        </Text>
      ) : null}
    </div>
  );
}

// ── Tokens ────────────────────────────────────────────────────────────────────────────────────────

/** One per-lens row: the estimator profile and its estimated input/output (if recorded in deltas). */
type LensRow = {
  profile: TokenProfileRef;
  estTotal: number;
  estIn: number | null;
  estOut: number | null;
};

function TokensTab({ step }: { step: RunStep }) {
  const lensRows = useMemo<LensRow[]>(() => buildLensRows(step), [step]);
  const actual = step.usageActual ?? null;

  if (lensRows.length === 0 && actual === null) {
    return (
      <Text variant="meta" tone="muted">
        No token accounting is recorded for this step.
      </Text>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {lensRows.length > 0 ? (
        <div className="flex flex-col gap-2">
          <Text variant="meta" tone="muted">
            Estimator lenses
          </Text>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Profile</TableHead>
                <TableHead className="text-right">Input</TableHead>
                <TableHead className="text-right">Output</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lensRows.map((row) => (
                <TableRow key={row.profile}>
                  <TableCell className="font-mono">{row.profile}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.estIn === null ? "—" : formatNumber(row.estIn)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.estOut === null ? "—" : formatNumber(row.estOut)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(row.estTotal)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}

      {actual ? <ActualUsageTable actual={actual} lensRows={lensRows} /> : null}
    </div>
  );
}

function ActualUsageTable({ actual, lensRows }: { actual: TokenUsageActual; lensRows: LensRow[] }) {
  const actualTotal = actual.inputTokens + actual.outputTokens;
  // Estimate-vs-actual delta against the FIRST (primary) lens row, if any.
  const primary = lensRows[0] ?? null;
  const delta = primary ? primary.estTotal - actualTotal : null;

  return (
    <div className="flex flex-col gap-2">
      <Text variant="meta" tone="muted">
        Provider-actual
      </Text>
      <Descriptions columns={2} layout="horizontal">
        <DescriptionsItem label="Input" numeric>
          {formatNumber(actual.inputTokens)}
        </DescriptionsItem>
        <DescriptionsItem label="Output" numeric>
          {formatNumber(actual.outputTokens)}
        </DescriptionsItem>
        <DescriptionsItem label="Cached input" numeric>
          {actual.cachedInputTokens === undefined ? "—" : formatNumber(actual.cachedInputTokens)}
        </DescriptionsItem>
        <DescriptionsItem label="Reasoning" numeric>
          {actual.reasoningTokens === undefined ? "—" : formatNumber(actual.reasoningTokens)}
        </DescriptionsItem>
        <DescriptionsItem label="Actual total" numeric>
          {formatNumber(actualTotal)}
        </DescriptionsItem>
        <DescriptionsItem label="Δ vs primary lens" numeric>
          {delta === null ? "—" : <DeltaText value={delta} />}
        </DescriptionsItem>
      </Descriptions>
    </div>
  );
}

// ── Raw ───────────────────────────────────────────────────────────────────────────────────────────

function RawTab({ step }: { step: RunStep }) {
  const json = useMemo(() => safeJson(step.payload), [step.payload]);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      // Copy plain TEXT only (never interpreted) — the untrusted payload is treated as data.
      await navigator.clipboard.writeText(json);
      setCopied(true);
      toast.success("Copied raw payload");
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      notifyError("Couldn’t copy to the clipboard.", {
        description: "Select and copy the text manually instead.",
      });
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <Text variant="meta" tone="muted">
          Full redacted payload (read-only)
        </Text>
        <Button variant="outline" size="sm" onClick={() => void copy()}>
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </Button>
      </div>
      <CodeSnippet value={json} ariaLabel="Raw step payload" maxHeightClassName="max-h-[28rem]" />
    </div>
  );
}

// ── Small shared pieces ─────────────────────────────────────────────────────────────────────────

/** Signed delta with a tabular figure; tone via the `destructive` token when the estimate overshoots. */
function DeltaText({ value }: { value: number }): ReactNode {
  const sign = value > 0 ? "+" : "";
  return (
    <span className={value < 0 ? "tabular-nums text-destructive" : "tabular-nums"}>
      {sign}
      {formatNumber(value)}
    </span>
  );
}

const SEGMENT_LABELS: Record<ContextSegment, string> = {
  system: "System",
  tool_defs: "Tool defs",
  history: "History",
  tool_results: "Tool results",
  output: "Output",
};

// ── Payload extractors (all defensive: payload is redacted `unknown`) ───────────────────────────

function asObject(payload: unknown): Record<string, unknown> | null {
  return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
}

/** The tool-call arguments (`{ args }`), JSON-formatted, or null. */
function toolArgs(step: RunStep): string | null {
  const obj = asObject(step.payload);
  if (obj && "args" in obj) return safeJson(obj.args);
  return null;
}

/** The tool result/error (`{ result }` | `{ error }`), with an error flag, or null. */
function toolResult(step: RunStep): { value: string; isError: boolean } | null {
  const obj = asObject(step.payload);
  if (!obj) return null;
  if ("result" in obj) return { value: safeJson(obj.result), isError: step.status === "error" };
  if ("error" in obj) return { value: String(obj.error), isError: true };
  return null;
}

/** A context-overflow message (`{ overflow, message }`), or null. */
function overflowMessage(step: RunStep): string | null {
  const obj = asObject(step.payload);
  if (obj && obj.overflow === true && typeof obj.message === "string") return obj.message;
  return null;
}

/** Byte size of the redacted payload (stable-stringified) — an honest "size" surrogate, or null. */
function payloadBytes(step: RunStep): number | null {
  if (step.payload === null || step.payload === undefined) return null;
  try {
    return new TextEncoder().encode(safeJson(step.payload)).length;
  } catch {
    return null;
  }
}

/**
 * Per-lens rows from the step's recorded `deltas` (the `llm_response` payload carries
 * `{ deltas: [{ profile, estimatedInputTokens, estimatedOutputTokens, … }], snapshot }`), falling
 * back to the flat `profileTokens` map (input+output total only) for non-llm steps.
 */
function buildLensRows(step: RunStep): LensRow[] {
  const obj = asObject(step.payload);
  const rawDeltas = obj && Array.isArray(obj.deltas) ? obj.deltas : null;
  if (rawDeltas) {
    const rows: LensRow[] = [];
    for (const entry of rawDeltas) {
      const d = asObject(entry);
      if (!d || typeof d.profile !== "string") continue;
      const estIn = typeof d.estimatedInputTokens === "number" ? d.estimatedInputTokens : null;
      const estOut = typeof d.estimatedOutputTokens === "number" ? d.estimatedOutputTokens : null;
      rows.push({
        profile: d.profile as TokenProfileRef,
        estIn,
        estOut,
        estTotal: (estIn ?? 0) + (estOut ?? 0),
      });
    }
    if (rows.length > 0) return rows;
  }
  // Fallback: the flat lens map (only a combined total per profile is known).
  return Object.entries(step.profileTokens)
    .filter(([, value]) => typeof value === "number")
    .map(([profile, value]) => ({
      profile: profile as TokenProfileRef,
      estIn: null,
      estOut: null,
      estTotal: value as number,
    }));
}
