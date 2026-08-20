import { Fragment, useMemo } from "react";
import { Button, Text } from "@elabs-ai/components-ui";
import { buildEntityGroups } from "./group";
import { EntityGrid, EntityGridSkeleton, shouldHintVirtualize } from "./EntityGrid";
import { EntityGroupSection } from "./EntityGroupSection";
import { EntityTable } from "./EntityTable";
import type { EntityBrowserProps } from "./types";

/**
 * The overview body (planning/Roadmap/RM-32-overview-detail): a grouped card grid that switches to a
 * grouped table, over any entity.
 *
 * It renders ONLY the body. The search field, the group-by picker and the view-mode toggle are the
 * caller's to place in its single `ViewToolbar` row (D-TB2 — a browser that rendered its own toolbar
 * would be the second row that rule forbids), which is why the state lives in
 * `useEntityBrowserState` and arrives here as `state`.
 *
 * Three distinct empty situations, kept distinct:
 *   • still loading            → layout-shaped skeletons (no CLS)
 *   • no entities at all       → the caller's `empty` (its own copy + create action)
 *   • entities, but no matches → a zero-match line naming the query, with a Clear control
 */
export function EntityBrowser<T>(props: EntityBrowserProps<T>) {
  const { state } = props;

  const groups = useMemo(
    () =>
      buildEntityGroups({
        items: props.items,
        search: state.search,
        searchText: props.searchText,
        groupBy: state.groupBy,
      }),
    [props.items, props.searchText, state.search, state.groupBy],
  );

  if (props.loading) {
    return <EntityGridSkeleton />;
  }

  if (props.items.length === 0) {
    return <>{props.empty}</>;
  }

  const [, plural] = props.noun;

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-start gap-2">
        <Text tone="muted">
          No {plural} match “{state.search.trim()}”.
        </Text>
        {/* "Clear filter", not "Clear search": `SearchInput` already renders its own clear control
            named "Clear search", and two buttons with one accessible name in the same view is a
            genuine ambiguity for anyone navigating by name. */}
        <Button variant="outline" size="sm" onClick={() => state.setSearch("")}>
          Clear filter
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {groups.map((group) => (
        <EntityGroupSection
          key={group.key}
          label={group.label}
          count={group.items.length}
          {...(group.badge !== undefined ? { badge: group.badge } : {})}
        >
          {state.viewMode === "grid" ? (
            <EntityGrid>
              {group.items.map((item) => (
                <Fragment key={props.itemKey(item)}>
                  {props.renderCard(item, {
                    virtualizeHint: shouldHintVirtualize(group.items.length),
                  })}
                </Fragment>
              ))}
            </EntityGrid>
          ) : (
            <EntityTable
              items={group.items}
              columns={props.columns}
              onOpen={props.onOpen}
              rowLabel={props.rowLabel}
              caption={group.label || plural}
            />
          )}
        </EntityGroupSection>
      ))}
      {props.footer}
    </div>
  );
}
