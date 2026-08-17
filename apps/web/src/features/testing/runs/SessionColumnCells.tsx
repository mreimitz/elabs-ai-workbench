import type { RunSummary, SessionCapabilities } from "@mcp-token-footprint/shared";
import { Badge, Text, Tooltip, TooltipContent, TooltipTrigger } from "@brand/ui";
import { formatDateTime, formatDuration, formatRelativeTime } from "../../../lib/format";
import { activeOrWallDuration, lastActivityAt, waitingTimeMs } from "./session-columns";

/**
 * Sessions lens cell renderers (Observability WP 2.4). Each is a small, reusable presentational
 * component so `RunTableRow` and `SuiteTableRows`'s `MemberRow` render the SAME session-column cells —
 * never two competing implementations of "what does a waiting-time cell look like". Return plain
 * inline content (never their own `<TableCell>`) — the caller supplies the cell's alignment/className.
 */

/**
 * Model/kind chip — capability-GATED (D-US4), never a `providerKind` fork: a backend with a
 * first-class named assistant (`capabilities.identity`, today only Acme) shows its identity name;
 * every other kind shows the scenario's plain model string. `model` is threaded in by the caller (the
 * scenario's `model` field — not carried on `RunSummary` itself).
 */
export function SessionKindChip({
  capabilities,
  model,
}: {
  capabilities: SessionCapabilities | undefined;
  model: string | undefined;
}) {
  const label = model ?? "—";
  return (
    <Badge variant="outline" className="max-w-[10rem] truncate font-normal">
      {label}
    </Badge>
  );
}

/**
 * Active duration cell — defaults to `activeDurationMs` (D-US3); a legacy run with no active figure
 * degrades HONESTLY to its wall-clock `durationMs`, MARKED "(wall)" so it is never mistaken for the
 * real active figure.
 */
export function ActiveDurationCell({
  run,
}: { run: Pick<RunSummary, "activeDurationMs" | "durationMs"> }) {
  const { ms, wallOnly } = activeOrWallDuration(run);
  if (ms == null) return "—";
  if (!wallOnly) return formatDuration(ms);
  return (
    <span className="inline-flex items-center gap-1">
      <span>{formatDuration(ms)}</span>
      <Text as="span" variant="meta" tone="muted">
        (wall)
      </Text>
    </span>
  );
}

/**
 * Waiting-time cell — `totalDurationMs - activeDurationMs` (D-US3). Never invents a figure from a
 * partial pair: renders "—" unless BOTH durations are known.
 */
export function WaitingCell({
  run,
}: { run: Pick<RunSummary, "activeDurationMs" | "totalDurationMs"> }) {
  const ms = waitingTimeMs(run);
  if (ms == null) return "—";
  return formatDuration(ms);
}

/**
 * Last-activity cell — `endedAt` when known; a still-open/legacy run (no `endedAt`) falls back to
 * `startedAt`, marked "(from start)" so a live session's start time is never mistaken for a genuine
 * last-touched marker (`RunSummary` carries no independent "last event at" timestamp). The exact
 * instant is always available on hover.
 */
export function LastActivityCell({
  run,
}: { run: Pick<RunSummary, "endedAt" | "startedAt"> }) {
  const { at, approx } = lastActivityAt(run);
  const relative = formatRelativeTime(at) || "—";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help">
          {relative}
          {approx ? (
            <Text as="span" variant="meta" tone="muted" className="ml-1">
              (from start)
            </Text>
          ) : null}
        </span>
      </TooltipTrigger>
      <TooltipContent>{formatDateTime(at)}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Unseen marker (D-US2 — unseen finished sessions surface first). `seen === false` is the only state
 * that renders anything (a small "New" badge); `true`/`undefined` (seen, or a pre-D-US1 legacy run
 * with no `seen` bookkeeping) render a plain dash — never a false "unseen" claim.
 */
export function SeenMarker({ seen }: { seen: boolean | undefined }) {
  if (seen === false) {
    return (
      <Badge variant="secondary" className="font-normal">
        New
      </Badge>
    );
  }
  return "—";
}
