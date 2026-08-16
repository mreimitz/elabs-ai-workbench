import { useState } from "react";
import { Link } from "react-router-dom";
import type {
  HubEffectiveMemory,
  HubEffectiveMemoryEntry,
  HubEffectiveMemoryOverride,
  HubMemoryScope,
} from "@mcp-token-footprint/shared";
import { Badge, Button, Text, Tooltip, TooltipContent, TooltipTrigger } from "@brand/ui";
import { ChevronDown, ChevronRight, SquareArrowOutUpRight } from "lucide-react";
import { IconButton } from "../../../components/IconButton";

/**
 * Assistant Hub UX WP2.7 (D-HUX11, §7.1/§7.3) — the ORDERED/TAGGED/LINKED effective-memory stack for
 * the workspace Context section, replacing WP1.8's light `EffectiveMemoryList` read-only placeholder
 * now that the wire type is promoted to shared (`memory-resolver.ts`'s `HubEffectiveMemory`).
 *
 * `memory.entries` already arrives in INJECTION order (profile → project → crew → agent, least → most
 * specific — `resolveEffectiveMemory`'s own contract); this component renders that order literally
 * (a numbered badge doubles as the visual "injection order" cue) and tags every entry with its scope +
 * a link to where it's actually managed: `profile` opens `ProfileMemoryDialog` (via `onManageProfile` —
 * a dialog, not a route); `project`/`crew`/`agent` link to that entity's own page (D-HUX5's node routes
 * for crew/agent; Projects has no per-project deep link yet, so it lands on the library page).
 *
 * D-HUX11's conflict rule ("most-specific-wins, shown transparently") means an OVERRIDDEN entry must
 * stay reachable, never silently dropped — `memory.overridden` renders behind a disclosure toggle
 * (collapsed by default so the common empty-conflict case stays compact), each row naming which entry
 * shadowed it.
 */
export function EffectiveMemoryStack({
  memory,
  onManageProfile,
}: {
  memory: HubEffectiveMemory;
  /** Opens `ProfileMemoryDialog`. Absent ⇒ a profile-scoped entry's link renders inert (the WP1.3
   *  "honest not-yet-actionable" precedent). */
  onManageProfile?: () => void;
}) {
  const [showOverridden, setShowOverridden] = useState(false);

  if (memory.entries.length === 0 && memory.overridden.length === 0) {
    return (
      <Text variant="caption" tone="muted">
        No memory will inject into this session yet.
      </Text>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <ul data-testid="effective-memory-stack" className="flex min-w-0 flex-col gap-1.5">
        {memory.entries.map((entry, index) => (
          <EntryRow
            key={entry.id}
            entry={entry}
            order={index + 1}
            {...(onManageProfile ? { onManageProfile } : {})}
          />
        ))}
      </ul>

      {memory.overridden.length > 0 ? (
        <div className="flex min-w-0 flex-col gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-fit gap-1 px-1.5 text-muted-foreground"
            aria-expanded={showOverridden}
            onClick={() => setShowOverridden((current) => !current)}
          >
            {showOverridden ? (
              <ChevronDown aria-hidden className="size-3.5" />
            ) : (
              <ChevronRight aria-hidden className="size-3.5" />
            )}
            <span>
              {memory.overridden.length} overridden by a more specific scope
            </span>
          </Button>
          {showOverridden ? (
            <ul
              data-testid="effective-memory-overridden"
              className="flex min-w-0 flex-col gap-1.5 border-s-2 border-border ps-2"
            >
              {memory.overridden.map((entry) => (
                <OverriddenRow key={entry.id} entry={entry} />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const SCOPE_LABELS: Record<HubMemoryScope, string> = {
  profile: "Profile",
  project: "Project",
  crew: "Crew",
  agent: "Agent",
};

/** Where a scope's entry is actually managed — a route for `project`/`crew`/`agent` (D-HUX5's node
 *  routes for crew/agent; Projects has no per-project deep link yet), or `undefined` for `profile`
 *  (a dialog, not a route — handled via `onManageProfile` at the call site instead). */
function manageHref(scope: HubMemoryScope, scopeId: string | null): string | undefined {
  if (scope === "project") return "/assistant/projects";
  if (scope === "crew" && scopeId) return `/assistant/agents/crew/${scopeId}`;
  if (scope === "agent" && scopeId) return `/assistant/agents/agent/${scopeId}`;
  return undefined;
}

function ScopeTag({ scope, scopeId, ownerName }: { scope: HubMemoryScope; scopeId: string | null; ownerName?: string }) {
  return (
    <Badge variant="outline" className="w-fit shrink-0">
      {SCOPE_LABELS[scope]}
      {ownerName ? ` · ${ownerName}` : ""}
    </Badge>
  );
}

function EntryRow({
  entry,
  order,
  onManageProfile,
}: {
  entry: HubEffectiveMemoryEntry;
  order: number;
  onManageProfile?: () => void;
}) {
  const href = manageHref(entry.scope, entry.scopeId);
  return (
    <li className="flex min-w-0 items-start gap-2 rounded-md border border-border bg-card px-2 py-1.5">
      <Text variant="caption" tone="muted" className="w-4 shrink-0 tabular-nums" aria-hidden>
        {order}
      </Text>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <ScopeTag scope={entry.scope} scopeId={entry.scopeId} {...(entry.ownerName ? { ownerName: entry.ownerName } : {})} />
          {entry.source === "assistant_proposed" ? (
            <Text variant="caption" tone="muted">
              Assistant proposed
            </Text>
          ) : null}
        </div>
        <Text variant="caption" className="line-clamp-3 min-w-0 break-words" title={entry.content}>
          {entry.content}
        </Text>
      </div>
      {href ? (
        // IconButton doesn't accept `asChild` (D-TB5 — it would dissolve into a Slot and break the
        // icon-child composition), and this control needs to stay a REAL <Link> (SquareArrowOutUpRight
        // signals a genuine navigable link — ctrl/cmd-click, right-click "open in new tab" must keep
        // working). So it's the one call site that manually replicates IconButton's Tooltip mechanism
        // instead of using the component: one label, fed to both the Link's `aria-label` and the tooltip.
        <Tooltip>
          <TooltipTrigger asChild>
            <Button asChild variant="ghost" size="sm" className="size-6 shrink-0 p-0">
              <Link to={href} aria-label={`Open ${entry.ownerName ?? SCOPE_LABELS[entry.scope]} memory`}>
                <SquareArrowOutUpRight aria-hidden className="size-3.5" />
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent>{`Open ${entry.ownerName ?? SCOPE_LABELS[entry.scope]} memory`}</TooltipContent>
        </Tooltip>
      ) : entry.scope === "profile" ? (
        <IconButton
          type="button"
          variant="ghost"
          size="sm"
          className="size-6 shrink-0 p-0"
          disabled={!onManageProfile}
          disabledReason={
            onManageProfile ? undefined : "Profile memory management isn't available in this view"
          }
          label="Manage profile memory"
          onClick={() => onManageProfile?.()}
        >
          <SquareArrowOutUpRight aria-hidden className="size-3.5" />
        </IconButton>
      ) : null}
    </li>
  );
}

function OverriddenRow({ entry }: { entry: HubEffectiveMemoryOverride }) {
  return (
    <li className="flex min-w-0 flex-col gap-1 rounded-md border border-dashed border-border px-2 py-1.5 opacity-70">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <ScopeTag scope={entry.scope} scopeId={entry.scopeId} {...(entry.ownerName ? { ownerName: entry.ownerName } : {})} />
        <Text variant="caption" tone="muted">
          shadowed by {SCOPE_LABELS[entry.overriddenByScope]}
        </Text>
      </div>
      <Text variant="caption" tone="muted" className="line-clamp-2 min-w-0 break-words line-through">
        {entry.content}
      </Text>
    </li>
  );
}
