import { useMemo, useState, type ReactNode } from "react";
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Text,
  cn,
} from "@elabs-ai/components-ui";
import { SearchInput } from "@elabs-ai/components-data";
import { ChevronDown, Plus } from "lucide-react";

/**
 * The entity switcher that lives in the breadcrumb LEAF of a detail page
 * (planning/Roadmap/RM-32-overview-detail, D-OD5): `Home › MCP Servers › [barc-benchmark ▾]`.
 *
 * It is the replacement for the 288px master-detail rail: switching entities no longer costs the
 * detail pane a permanent column, it costs one click on a crumb that was already there. A page
 * contributes it through `useSetBreadcrumbSlot` (`components/breadcrumb-slot.tsx`), the channel the
 * Assistant workspace's session switcher already uses.
 *
 * This is the GENERIC form of `features/hub/SessionBreadcrumbSwitcher` — same trigger shape, same
 * popover layout, but grouped and over any entity. That one is deliberately left untouched (it is
 * shipped and tested); folding it onto this component is a recorded follow-up.
 */
export type BreadcrumbSwitcherItem = {
  id: string;
  label: string;
  /** Right-aligned chip on the row (a StatusBadge, a source Badge). */
  badge?: ReactNode;
  /** A muted second line — relative time, endpoint, repo. Truncates. */
  meta?: ReactNode;
};

export type BreadcrumbSwitcherGroup = {
  key: string;
  /** Empty ⇒ the rows render flat, with no header (the single-group case). */
  label: string;
  badge?: ReactNode;
  items: BreadcrumbSwitcherItem[];
};

export type BreadcrumbEntitySwitcherProps = {
  /** The same groups, in the same order, as the overview page (D-OD3 consistency). */
  groups: BreadcrumbSwitcherGroup[];
  activeId: string | null;
  /** The trigger's text. Falls back to the loading / nothing-selected copy. */
  triggerLabel?: string;
  /** A chip rendered in the trigger beside the label (e.g. the entity's status). */
  triggerBadge?: ReactNode;
  /** Accessible name for the trigger — "Switch server". */
  switchLabel: string;
  /** Noun for the search placeholder and the empty copy: `["server", "servers"]`. */
  noun: [singular: string, plural: string];
  loading?: boolean;
  onSelect: (id: string) => void;
  /** Footer create action. Omit to hide it. */
  onCreate?: () => void;
  createLabel?: string;
  /** Footer "View all →" — back to the overview. */
  onViewAll: () => void;
};

export function BreadcrumbEntitySwitcher(props: BreadcrumbEntitySwitcherProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [singular, plural] = props.noun;

  const activeItem = useMemo(() => {
    if (!props.activeId) return null;
    for (const group of props.groups) {
      const found = group.items.find((item) => item.id === props.activeId);
      if (found) return found;
    }
    return null;
  }, [props.groups, props.activeId]);

  // Filter INSIDE each group, then drop the groups that emptied — the same rule the overview follows,
  // so a search never leaves a header standing over nothing.
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return props.groups;
    return props.groups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => item.label.toLowerCase().includes(needle)),
      }))
      .filter((group) => group.items.length > 0);
  }, [props.groups, query]);

  const total = props.groups.reduce((sum, group) => sum + group.items.length, 0);
  const triggerLabel =
    props.triggerLabel ?? (props.loading ? `Loading ${plural}…` : `Select a ${singular}`);

  function select(id: string): void {
    props.onSelect(id);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          // Layout-only: sit flush in the breadcrumb row while keeping the ghost hover affordance so
          // it reads as an interactive crumb.
          className="-my-1 h-7 max-w-[16rem] gap-1.5 px-2 font-medium"
          aria-label={props.switchLabel}
        >
          <span className="min-w-0 truncate">{triggerLabel}</span>
          {props.triggerBadge}
          <ChevronDown aria-hidden className="size-3.5 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[22rem] p-0">
        <div className="flex flex-col" data-testid="entity-switcher-popover">
          <div className="flex flex-col gap-2 border-b border-border p-3">
            <Text variant="meta" tone="muted" className="uppercase tracking-wide">
              This {singular}
            </Text>
            {activeItem ? (
              <div className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">{activeItem.label}</span>
                {activeItem.badge}
              </div>
            ) : (
              <Text tone="muted">No {singular} selected.</Text>
            )}
          </div>

          <div className="p-2">
            <SearchInput
              value={query}
              onValueChange={setQuery}
              placeholder={`Search ${plural}…`}
              label={`Search ${plural}`}
            />
          </div>

          <div className="max-h-[18rem] min-h-0 overflow-y-auto px-2 pb-2">
            {props.loading ? (
              // Not an empty state: an empty list mid-fetch reads as "there are none", which is false.
              <Text tone="muted" className="px-2 py-6">
                Loading {plural}…
              </Text>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-2 py-6 text-center">
                <Text tone="muted">
                  {total === 0 ? `No ${plural} yet.` : `No ${plural} match “${query.trim()}”.`}
                </Text>
                {total > 0 ? (
                  <Button variant="outline" size="sm" onClick={() => setQuery("")}>
                    Clear filter
                  </Button>
                ) : null}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {filtered.map((group) => (
                  <SwitcherGroup
                    key={group.key}
                    group={group}
                    activeId={props.activeId}
                    onSelect={select}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-border p-2">
            {props.onCreate ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="gap-1.5"
                onClick={() => {
                  props.onCreate?.();
                  setOpen(false);
                }}
              >
                <Plus aria-hidden className="size-4" />
                <span>{props.createLabel ?? `New ${singular}`}</span>
              </Button>
            ) : (
              <span />
            )}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => {
                props.onViewAll();
                setOpen(false);
              }}
            >
              View all {plural} →
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SwitcherGroup(props: {
  group: BreadcrumbSwitcherGroup;
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  const rows = (
    <ul className="flex flex-col gap-0.5">
      {props.group.items.map((item) => {
        const isActive = item.id === props.activeId;
        return (
          <li key={item.id}>
            <Button
              type="button"
              variant="ghost"
              onClick={() => props.onSelect(item.id)}
              aria-current={isActive ? "true" : undefined}
              className={cn(
                "h-auto w-full flex-col items-stretch gap-1 rounded-md px-2 py-2 text-left font-normal",
                isActive && "bg-accent text-accent-foreground",
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.badge}
              </span>
              {item.meta ? (
                <span className="flex min-w-0 items-center gap-2 text-caption text-muted-foreground">
                  {item.meta}
                </span>
              ) : null}
            </Button>
          </li>
        );
      })}
    </ul>
  );

  // A single unlabelled group renders flat — a lone header over the whole list says nothing.
  if (!props.group.label) return rows;

  return (
    <section aria-label={props.group.label} className="flex flex-col gap-1">
      <div className="flex min-w-0 items-center gap-1.5 px-2">
        <Text
          variant="meta"
          tone="muted"
          className="min-w-0 truncate font-semibold uppercase tracking-wide"
        >
          {props.group.label}
        </Text>
        {props.group.badge}
        <Text variant="meta" tone="muted" className="ml-auto shrink-0 tabular-nums">
          {props.group.items.length}
        </Text>
      </div>
      {rows}
    </section>
  );
}
