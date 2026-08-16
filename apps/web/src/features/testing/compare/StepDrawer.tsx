import { useLocation, useNavigate } from "react-router-dom";
import type { RunDetail } from "@mcp-token-footprint/shared";
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
  Text,
} from "@brand/ui";
import { ExternalLink } from "lucide-react";
import { formatNumber, safeJson } from "../../../lib/format";
import { deriveStatusView } from "../../../lib/status";
import { CodeSnippet } from "../CodeSnippet";
import { PacketTabs } from "../PacketInspector";
import { RunLetterBadge } from "./RunLetterBadge";
import { runChipLabel } from "./compare-runs";
import { resolveFocusedStep } from "./flow/focus-step";
import type { AlignedColumn, FlowLane } from "./flow/flow-types";

/**
 * The step drawer (audit §H5 — the lossless drill loop, level 2). Clicking any flow cell sets the
 * URL's `?focus=<letter>@<columnId>`; this right-side `Sheet` reads that token, resolves it to the
 * concrete run + node + backing `RunStep`s ({@link resolveFocusedStep}), and shows the SAME console
 * inspector content the run console uses — reused verbatim via the exported {@link PacketTabs}
 * (Overview / Request / Response / Tokens / Raw), NOT a fork — all **without leaving the comparison**.
 *
 * Because the drawer is driven purely by `?focus=`, it is URL-restorable: a reload or a shared link
 * with the focus token reopens it, and browser Back from the console (opened via "Open in console ↗",
 * which preserves the compare URL as `?returnTo=`) lands back here with the exact mode + focus + the
 * cell scrolled into view. No drill-down costs the user their comparison context.
 *
 * SECURITY (`mcp-and-security.md`): every payload shown here is untrusted, already-redacted tool
 * output rendered read-only as text (via `PacketTabs`/`CodeSnippet`) — never interpreted as markup.
 */
export function StepDrawer({
  focus,
  lanes,
  columns,
  details,
  onClose,
}: {
  focus: string | null;
  lanes: FlowLane[];
  columns: AlignedColumn[];
  details: Map<string, RunDetail>;
  /** Clear the focus token (closes the drawer). */
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();

  const resolved = resolveFocusedStep(focus, lanes, columns, details);
  const open = resolved !== null;

  const openInConsole = () => {
    if (!resolved) return;
    // Preserve the WHOLE compare URL (incl. `?focus=`) so the console can return exactly here, and so
    // browser Back restores the workspace. This pushes a history entry — Back walks console → compare.
    const returnTo = `${location.pathname}${location.search}`;
    navigate(`/testing/runs/${resolved.lane.run.id}?returnTo=${encodeURIComponent(returnTo)}`);
  };

  return (
    <Sheet open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-hidden sm:max-w-xl">
        {resolved ? <DrawerBody resolved={resolved} onOpenInConsole={openInConsole} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function DrawerBody({
  resolved,
  onOpenInConsole,
}: {
  resolved: NonNullable<ReturnType<typeof resolveFocusedStep>>;
  onOpenInConsole: () => void;
}) {
  const { lane, node, callStep, resultStep } = resolved;

  // The step feeding the reused inspector: prefer the RESULT packet (it carries the response + provider
  // usage + timing); fall back to the call packet. The args live on the CALL step, so when we inspect
  // the result we surface them separately above (see `argsAbove`).
  const primaryStep = resultStep ?? callStep;
  const argsAbove = resultStep !== null && node.argsJson ? prettyJson(node.argsJson) : null;

  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex min-w-0 flex-wrap items-center gap-2">
          <RunLetterBadge
            letter={lane.letter}
            color={lane.color}
            baseline={lane.isBaseline}
            size="md"
          />
          <span className="min-w-0 truncate font-mono">{node.title}</span>
          {node.serverId ? (
            <Badge variant="outline" className="font-normal">
              {node.serverId}
            </Badge>
          ) : null}
          {node.status ? (
            <StatusBadge
              status={
                node.status === "error" ? "failed" : node.status === "ok" ? "complete" : "running"
              }
              size="sm"
            >
              {deriveStatusView(node.status).label}
            </StatusBadge>
          ) : null}
        </SheetTitle>
        <SheetDescription className="flex min-w-0 flex-col gap-0.5">
          <span className="min-w-0 truncate">{runChipLabel(lane.run)}</span>
          <span>
            Params, result, raw events, and timings for this step — read-only, without leaving the
            comparison.
          </span>
        </SheetDescription>
      </SheetHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        <div className="flex min-w-0 flex-col gap-4">
          {/* D1 (compare-redesign §3.4) — content leads, never a "—" placeholder grid. When a backing
              RunStep exists, its payload (args + the reused `PacketTabs`, which already shows this
              node's Duration/Tokens on its own Overview tab) comes first with nothing redundant above
              it. When there's no backing RunStep (reasoning / answer / session start / terminal), the
              flow model's own captured detail leads, with its duration/tokens as a trailing footnote
              — only rendered when at least one of them is actually known. */}
          {primaryStep ? (
            <>
              {argsAbove ? (
                <CodeSnippet
                  label="Arguments (sent)"
                  value={argsAbove}
                  ariaLabel="Tool arguments sent"
                  maxHeightClassName="max-h-64"
                />
              ) : null}
              {/* The reused console inspector for the backing step. */}
              <PacketTabs step={primaryStep} />
            </>
          ) : (
            <>
              <NodeDetail node={node} />
              {(typeof node.tokens === "number" || typeof node.durationMs === "number") && (
                <Descriptions columns={2} layout="horizontal">
                  {typeof node.durationMs === "number" ? (
                    <DescriptionsItem label="Duration" numeric>
                      {formatNumber(Math.round(node.durationMs))} ms
                    </DescriptionsItem>
                  ) : null}
                  {typeof node.tokens === "number" ? (
                    <DescriptionsItem label="Tokens" numeric>
                      {formatNumber(node.tokens)}
                    </DescriptionsItem>
                  ) : null}
                </Descriptions>
              )}
            </>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-4 py-3">
        <Button variant="outline" size="sm" onClick={onOpenInConsole}>
          <ExternalLink aria-hidden />
          <span>Open in console</span>
        </Button>
      </div>
    </>
  );
}

/** The detail body for a node with no backing RunStep (reasoning, answer, session start, terminal). */
function NodeDetail({
  node,
}: { node: NonNullable<ReturnType<typeof resolveFocusedStep>>["node"] }) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {node.subtitle ? (
        <Text variant="meta" tone="muted" className="text-pretty">
          {node.subtitle}
        </Text>
      ) : null}
      {node.resultText ? (
        <CodeSnippet
          label={node.resultIsError ? "Error" : node.kind === "answer" ? "Final answer" : "Details"}
          value={node.resultText}
          ariaLabel="Step detail"
          maxHeightClassName="max-h-[28rem]"
        />
      ) : null}
      {!node.subtitle && !node.resultText ? (
        <Text variant="meta" tone="muted">
          This step has no recorded request or response payload to inspect. Open the run in the
          console for its full trace.
        </Text>
      ) : null}
    </div>
  );
}

/** Pretty-print a compact JSON string (the flow model stores stable, key-sorted JSON); raw on failure. */
function prettyJson(compact: string): string {
  try {
    return safeJson(JSON.parse(compact));
  } catch {
    return compact;
  }
}
