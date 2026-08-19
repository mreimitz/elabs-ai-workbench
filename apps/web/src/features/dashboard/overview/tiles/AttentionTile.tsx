import { Link } from "react-router-dom";
import { BentoGridItem, Button, Skeleton, Text } from "@elabs-ai/components-ui";
import { CheckCircle2, Play } from "lucide-react";
import type { AttentionData, AttentionItem, SectionEnvelope } from "../overview-contract";
import { isEmptySection } from "../overview-contract";
import { CountBadge, StatusBadge } from "../../../../components/StatusBadge";
import { IconButton } from "../../../../components/IconButton";
import { InlineError } from "../../../../components/InlineError";
import { SectionCardTitle } from "../../../../components/SectionCardTitle";
import {
  deriveIssueLifecycleView,
  deriveStatusView,
  type StatusView,
} from "../../../../lib/status";
import { formatNumber } from "../../../../lib/format";

/**
 * AttentionTile — the Overview bento's "what needs you" queue (dashboard-bento WP 1.3).
 * =============================================================================================
 * A 1×2 tile (`size="sm"` + `span={{ row: 2 }}`) listing the failed scans, unscanned servers and
 * regressed/open issues the hook put in `OverviewData.attention`, each with the real `href` the
 * contract carries and — for a server row — an inline "Scan now".
 *
 * PRESENTATION IS MIRRORED, NOT REINVENTED. `features/dashboard/ScansTab.tsx`'s "Needs attention"
 * card already shipped this list: a `CountBadge` in the header, a divided `<ul>`, a truncating name
 * beside the app's ONE status chip, a muted "why it needs you" line, and an inline scan CTA. This
 * tile reproduces that grammar so the operator meets one queue, not two subtly different ones. The
 * one deliberate divergence is the scan CTA's form (see INLINE ACTION below) — the tile is a single
 * bento column (~1/4 of the grid on `lg`), where ScansTab's text button would wrap every row.
 *
 * ── THE EMPTY DECISION (WP 1.3 hard requirement 1) ────────────────────────────────────────────────
 * Every other Overview tile self-hides when its section is empty — the bento must never be a grid of
 * empty boxes. This tile is the deliberate exception, but only HALF of it, because "empty" covers two
 * genuinely different situations that a single `null` would blur:
 *
 *   • `state === "empty"` (or `ready` with `data === null`) — the section produced NOTHING. There are
 *     no servers, no issues, nothing was measured. → **self-hide**, exactly like every other tile.
 *     This is also what keeps WP 1.4's first-run "add your first MCP server" CTA honest: a brand-new
 *     install must not be told "nothing needs you", because nothing was ever looked at.
 *
 *   • `state === "ready"` with an EMPTY `items` list — the section RAN and found nothing wrong.
 *     → **render the all-clear.** That is a measured, positive result and it is the single most
 *     useful thing this tile can say. Hiding it would make the tile's absence ambiguous: an operator
 *     could not tell "nothing needs me" from "the attention section failed" or "that feature is off",
 *     and the whole point of an attention queue is that you can trust its silence. ScansTab already
 *     states this out loud ("All configured servers have a successful latest scan."); so does this.
 *
 * An `error` never renders as "all clear" — a failed load is surfaced through `InlineError`, never
 * swallowed into a reassuring empty state.
 *
 * ── INLINE ACTION ─────────────────────────────────────────────────────────────────────────────────
 * The scan CTA is an {@link IconButton} (tooltip == `aria-label`, never a native `title` — D-TB5)
 * carrying the server's own name ("Scan Alpha now"), so a screen-reader user hears WHICH server the
 * button scans rather than four identical "Scan now"s. It is rendered only when the row names a
 * server AND the host passed `onRunScan`.
 *
 * Every visible element is `@elabs-ai/components-*`; tones come from the app's ONE status vocabulary
 * (`lib/status.ts`) so both themes read correctly; `className` is layout-only.
 */
export type AttentionTileProps = {
  /** The contract's attention section. Owns its own load state — see the module doc. */
  section: SectionEnvelope<AttentionData>;
  /** Run a scan for a server inline. Omit to render the rows without the scan CTA. */
  onRunScan?: (serverId: string) => void;
  /** Retry the section's fetch. Renders the `InlineError` retry affordance when given. */
  onRetry?: () => void;
};

/** How many rows the tile lists before it stops and states the remainder. The list scrolls inside
 *  the tile (a `BentoGridItem` is `overflow-hidden`), so this is a *reading* budget, not a clip. */
const MAX_ROWS = 8;

/**
 * Kind → the chip the row leads with, resolved through the app's existing authorities:
 * scan/server kinds through {@link deriveStatusView} (the same table ScansTab's rows use — an
 * unscanned server is the dashed "Pending" chip), issue kinds through
 * {@link deriveIssueLifecycleView} (the fleet-issue registry's own 3-state dimension). No new tone
 * mapping is invented here; `StatusBadge` stays the one place a status is painted.
 */
function attentionChipView(kind: AttentionItem["kind"]): StatusView {
  switch (kind) {
    case "scan_failed":
      return deriveStatusView("failed");
    case "server_unscanned":
      return deriveStatusView("unscanned");
    case "issue_regressed":
      return deriveIssueLifecycleView("regressed");
    case "issue_open":
      return deriveIssueLifecycleView("open");
    default: {
      // Defensive: an unknown kind renders a calm neutral chip rather than crashing the tile.
      return deriveStatusView(kind);
    }
  }
}

export function AttentionTile({ section, onRunScan, onRetry }: AttentionTileProps) {
  // Nothing was measured → the tile removes itself (see THE EMPTY DECISION above).
  if (isEmptySection(section)) return null;

  return (
    <BentoGridItem size="sm" span={{ row: 2 }} className="gap-3 p-4">
      <header className="flex items-center justify-between gap-2">
        <SectionCardTitle className="min-w-0 truncate">Needs you</SectionCardTitle>
        {section.state === "ready" && section.data ? (
          <CountBadge value={section.data.total} tone="warning" />
        ) : null}
      </header>
      <AttentionBody section={section} onRunScan={onRunScan} onRetry={onRetry} />
    </BentoGridItem>
  );
}

function AttentionBody({ section, onRunScan, onRetry }: AttentionTileProps) {
  if (section.state === "loading") {
    // Layout-shaped placeholder, not a spinner (.claude/rules/loading-states.md): three row-sized
    // bars where the rows will land, so the tile does not resize when the data arrives.
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3" aria-busy="true">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (section.state === "error") {
    // A failed load is NEVER shown as "nothing needs you".
    return (
      <InlineError
        level={3}
        title="Couldn’t load what needs you"
        detail={section.error ?? undefined}
        onRetry={onRetry}
        className="flex-col items-stretch"
      />
    );
  }

  const data = section.data;
  // `isEmptySection` already removed the "nothing was measured" case; a `null` here would be a
  // contract violation, so bail out rather than paint a misleading all-clear.
  if (!data) return null;

  if (data.items.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-start gap-2">
        <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-success-text" />
        <Text variant="meta" tone="muted" className="text-pretty">
          Nothing needs you. No failed scans, no unscanned servers, and no open issues in this
          window.
        </Text>
      </div>
    );
  }

  const shown = data.items.slice(0, MAX_ROWS);
  const hidden = Math.max(data.total - shown.length, 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <ul aria-label="Items that need your attention" className="min-h-0 flex-1 overflow-y-auto">
        {shown.map((item) => (
          <AttentionRow
            key={`${item.kind}:${item.href}:${item.label}`}
            item={item}
            onRunScan={onRunScan}
          />
        ))}
      </ul>
      {hidden > 0 ? (
        <Text variant="meta" tone="muted" className="shrink-0 tabular-nums">
          {`+${formatNumber(hidden)} more`}
        </Text>
      ) : null}
    </div>
  );
}

/** One queue row: chip + truncating name link + (for a server row) the inline scan action. */
function AttentionRow({
  item,
  onRunScan,
}: {
  item: AttentionItem;
  onRunScan: AttentionTileProps["onRunScan"];
}) {
  const { serverId } = item;

  return (
    <li className="flex flex-col gap-1 border-border border-b py-2 first:pt-0 last:border-b-0 last:pb-0">
      <div className="flex items-center gap-2">
        <StatusBadge view={attentionChipView(item.kind)} className="shrink-0" />
        {/* A real router link, so the row is keyboard reachable, middle-clickable, and carries the
            contract's own `href` — the Button only supplies the affordance + focus ring. */}
        <Button
          asChild
          variant="link"
          size="sm"
          className="h-auto min-w-0 flex-1 justify-start p-0"
        >
          <Link to={item.href}>
            <span className="min-w-0 truncate">{item.label}</span>
          </Link>
        </Button>
        {serverId !== null && onRunScan ? (
          <IconButton
            size="icon-sm"
            variant="ghost"
            label={`Scan ${item.label} now`}
            className="shrink-0"
            onClick={() => onRunScan(serverId)}
          >
            <Play aria-hidden />
          </IconButton>
        ) : null}
      </div>
      {item.detail ? (
        <Text variant="meta" tone="muted" className="line-clamp-2 break-words text-pretty">
          {item.detail}
        </Text>
      ) : null}
    </li>
  );
}
