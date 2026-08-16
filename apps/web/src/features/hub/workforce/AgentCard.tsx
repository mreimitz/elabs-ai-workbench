import type { KeyboardEvent, MouseEvent, Ref } from "react";
import type { HubAgentRole, HubCrew, HubServerToolGrant } from "@mcp-token-footprint/shared";
import { Sparkline } from "@brand/charts";
import {
  Badge,
  Card,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Skeleton,
  Text,
  cn,
} from "@brand/ui";
import { Archive, ArchiveRestore, MoreHorizontal } from "lucide-react";
import { IconButton } from "../../../components/IconButton";
import { getHubUsageSummary } from "../../../lib/api";
import { loadableData, useLoadable } from "../../../lib/loadable";
import { RoleAvatar } from "../agents/RoleAvatar";
import { crewAccentClasses } from "../lib/hub-ux";

/**
 * Assistant Hub UX WP2.2 (D-HUX5 §7.3 Tab 1) — one agent's "employee record at a glance": identity
 * (avatar + crew accent, displayName/title fallback, one-line description), assignment summary
 * (model chip, tool/skill counts), and a 30-day usage strip (runs + cost) — so utilization is visible
 * right in the directory. Interaction contract (D-HUX5): a plain click SELECTS (local, non-navigating
 * state the caller owns — `selected`/`onSelect`); double-click, Enter, or the card's own ⋯ menu OPENS
 * the profile (`onOpen` — the caller navigates to the D-HUX5 node route). This card never navigates or
 * fetches roles/crews itself beyond its OWN 30-day usage summary (a small, best-effort enrichment —
 * mirrors `useHubModelRoster`'s "best effort, ignore fetch errors" posture, since a stalled/failed
 * strip must never block the rest of an otherwise-usable card).
 */

/** Best-effort tool-grant summary for the card's assignment line. A server granted `"all"` its tools
 *  contributes an UNKNOWN (at-least) count without a per-card scan fetch (N+1 cost for a card grid) —
 *  rendered as "N+ tools" so the "+" honestly signals "at least this many", never a fabricated exact
 *  number (interaction-guidelines: never fake a measured value). The precise, scan-measured per-tool
 *  breakdown lives in the Access sub-page (D-HUX7, WP2.3) — this is a cheap summary, not that surface. */
export function summarizeToolGrants(grants: HubAgentRole["toolGrants"]): {
  count: number;
  approximate: boolean;
} {
  let count = 0;
  let approximate = false;
  for (const grant of Object.values(grants.servers)) {
    const serverGrant = grant as HubServerToolGrant;
    if (serverGrant === "all") approximate = true;
    else count += serverGrant.length;
  }
  return { count, approximate };
}

/** The crew(s) whose color should accent this card, per D-HUX8: a single crew gets the full ring +
 *  top-border + dot treatment; 2+ crews (only possible in a non-crew-scoped grid) drop the ring/border
 *  (no single color would be honest) and show stacked dots instead, each paired with its crew's name. */
export function accentFor(memberOfCrews: HubCrew[]): {
  ring: string;
  borderTop: string;
  dots: { crewId: string; name: string; dot: string }[];
} {
  if (memberOfCrews.length === 1) {
    const crew = memberOfCrews[0];
    if (!crew) return { ring: "", borderTop: "", dots: [] };
    const accent = crewAccentClasses(crew.color);
    return {
      ring: accent.ring,
      borderTop: accent.borderTop,
      dots: [{ crewId: crew.id, name: crew.name, dot: accent.dot }],
    };
  }
  return {
    ring: "",
    borderTop: "",
    dots: memberOfCrews.map((crew) => ({
      crewId: crew.id,
      name: crew.name,
      dot: crewAccentClasses(crew.color).dot,
    })),
  };
}

export function AgentCard(props: {
  role: HubAgentRole;
  /** The crew(s) this agent belongs to IN THE CURRENT CONTEXT — a single crew (the scope's own) when
   *  rendered inside a crew's member grid, or every crew it belongs to when rendered in the
   *  all-agents/unassigned/archived grid (D-HUX8's "local crew's color inside a crew scope, stacked
   *  dots in All agents"). Empty for an unassigned agent. */
  memberOfCrews: HubCrew[];
  /** Mouse-click "select" state (D-HUX5) — a visual highlight only; keyboard users get the browser's
   *  own focus ring on Tab (every card is independently `tabIndex=0`, mirroring `OrgRail`'s
   *  `RailItem` — no roving-tabindex/listbox composite widget, which real semantic-HTML elements
   *  (`<option>`/`<select>`) can't represent for rich card content anyway). */
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onArchiveToggle: (archived: boolean) => void;
  archiveBusy?: boolean;
  cardRef?: Ref<HTMLDivElement>;
  /** Grid virtualization for large directories (WP2.2 workstep 5, >50 cards): a native,
   *  dependency-free stand-in for row/list virtualization — `@brand/data`'s `DataTable` owns THAT
   *  for tabular data, but neither it nor `@brand/ai`'s `Gallery` (image-only) fits a card grid, so
   *  every card gets `content-visibility: auto` (the browser then skips layout/paint work for
   *  whichever ones are actually off-screen) instead of mounting a new virtualizer dependency. */
  virtualizeHint?: boolean;
}) {
  const { role, memberOfCrews, selected, onSelect, onOpen, onArchiveToggle } = props;
  const accent = accentFor(memberOfCrews);
  const tools = summarizeToolGrants(role.toolGrants);
  const skillCount = role.skills.length;
  const title = role.displayName ?? role.name;
  const subtitle = role.displayName ? role.name : undefined;

  const { state } = useLoadable(
    () => getHubUsageSummary({ groupBy: "agent", id: role.id, days: 30 }),
    [role.id],
  );
  const usage = loadableData(state);

  function handleClick(event: MouseEvent<HTMLDivElement>) {
    // WP2.R-B fix: select on a click ANYWHERE on the card's visible content (name, description,
    // avatar, model chip, …) — D-HUX5's "click = select" covers the whole card, not just the bare
    // root div. The one thing that must NOT select/open is the ⋯ menu: its trigger already calls
    // `stopPropagation()` on its own click (below) so it never reaches here at all, but its
    // MENU CONTENT renders into a Radix portal — React still bubbles a portaled item's click up
    // through the REACT tree to this handler (Card is its React ancestor even though the DOM node
    // lives elsewhere, e.g. under `document.body`), so `target !== currentTarget` alone can't catch
    // it. Radix marks every menu's content `role="menu"` (and each item `role="menuitem"`) as a core,
    // stable part of its own ARIA implementation — walking UP from the real click target (which stays
    // correctly nested inside the portal's own DOM subtree) to look for that role reliably identifies
    // "this click originated in our dropdown," regardless of where the portal physically renders.
    if (event.target instanceof Element && event.target.closest('[role="menu"]')) return;
    event.preventDefault();
    onSelect();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Only react to Enter pressed while the CARD ITSELF has focus — a descendant's own keydown
    // (the ⋯ menu trigger, a future menu item) bubbles here too, and must not double-fire `onOpen`.
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter") {
      event.preventDefault();
      onOpen();
    }
  }

  return (
    <Card
      ref={props.cardRef}
      interactive
      // biome-ignore lint/a11y/useSemanticElements: a real <button> can't contain another
      // interactive control (this card's own ⋯ menu trigger below) — the standard "card is a big
      // button with a nested secondary action" pattern (GitHub repo cards, Notion pages). Assistive
      // tech still reaches the inner button independently via Tab; mirrors OrgRail's `RailItem`
      // (a real Button) for the parts that CAN be a real element and reserves this escape hatch for
      // the one part that structurally can't.
      role="button"
      aria-current={selected ? "true" : undefined}
      aria-label={`${title}${role.archivedAt ? " (archived)" : ""}`}
      tabIndex={0}
      onClick={handleClick}
      onDoubleClick={onOpen}
      onKeyDown={handleKeyDown}
      style={
        props.virtualizeHint
          ? { contentVisibility: "auto", containIntrinsicSize: "0 220px" }
          : undefined
      }
      className={cn(
        "flex min-w-0 flex-col gap-3 border-t-[3px] p-4",
        accent.borderTop || "border-t-transparent",
        selected && "bg-accent/40",
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <RoleAvatar
          id={role.id}
          icon={role.icon}
          model={role.defaultModel}
          className={cn(
            "size-10 shrink-0 rounded-full",
            accent.ring && cn("ring-2 ring-offset-2 ring-offset-card", accent.ring),
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <Text className="min-w-0 truncate font-medium" title={title}>
              {title}
            </Text>
            {role.archivedAt ? (
              <Badge variant="outline" className="shrink-0">
                Archived
              </Badge>
            ) : null}
          </div>
          {subtitle ? (
            <Text variant="caption" tone="muted" className="min-w-0 truncate">
              {subtitle}
            </Text>
          ) : null}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              type="button"
              variant="ghost"
              size="icon-sm"
              className="shrink-0"
              label={`${title} actions`}
              onClick={(event) => event.stopPropagation()}
            >
              <MoreHorizontal aria-hidden />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onOpen}>Open profile</DropdownMenuItem>
            <DropdownMenuItem
              disabled={props.archiveBusy}
              onSelect={() => onArchiveToggle(!role.archivedAt)}
            >
              {role.archivedAt ? (
                <ArchiveRestore aria-hidden className="size-4" />
              ) : (
                <Archive aria-hidden className="size-4" />
              )}
              <span>{role.archivedAt ? "Restore" : "Archive"}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {role.description ? (
        // D-10 (toolbar-reach WP 2.8): the 2-line clamp hides the text that distinguishes similar
        // agents — carry the full description as a `title` so it's recoverable on hover.
        <Text variant="caption" tone="muted" className="line-clamp-2 min-w-0" title={role.description}>
          {role.description}
        </Text>
      ) : null}

      {accent.dots.length > 0 ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {accent.dots.map((d) => (
            <span key={d.crewId} className="flex min-w-0 items-center gap-1">
              <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", d.dot)} />
              <Text variant="meta" tone="muted" className="min-w-0 truncate">
                {d.name}
              </Text>
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <Badge variant="secondary" className="min-w-0 max-w-full truncate">
          {role.defaultModel || "No model set"}
        </Badge>
        <Text variant="meta" tone="muted" className="shrink-0 tabular-nums">
          {tools.count}
          {tools.approximate ? "+" : ""} tool{tools.count === 1 && !tools.approximate ? "" : "s"} ·{" "}
          {skillCount} skill{skillCount === 1 ? "" : "s"}
        </Text>
      </div>

      <div className="mt-auto flex min-w-0 items-center justify-between gap-2 border-t border-border pt-2">
        {state.status === "loading" ? (
          <Skeleton className="h-6 w-24" />
        ) : usage ? (
          <>
            <Sparkline
              values={usage.strip.map((day) => day.costUsd)}
              variant="bar"
              width={64}
              height={20}
              label={`Spend trend, last ${usage.strip.length} days`}
            />
            <Text variant="meta" tone="muted" className="shrink-0 tabular-nums">
              {usage.totals.sessions} run{usage.totals.sessions === 1 ? "" : "s"} · $
              {usage.totals.costUsd.toFixed(2)} · 30d
            </Text>
          </>
        ) : (
          // The strip is a secondary enrichment (WP1.6's usage summary) — a fetch failure must never
          // block the rest of an otherwise-usable card (mirrors `useHubModelRoster`'s "best effort"),
          // but it stays honestly distinct from a genuine zero-usage reading (which renders the
          // sparkline + "0 runs" above, not this branch).
          <Text variant="meta" tone="muted">
            Usage unavailable
          </Text>
        )}
      </div>
    </Card>
  );
}
