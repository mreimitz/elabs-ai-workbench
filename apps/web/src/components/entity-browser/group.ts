import type { EntityGroup, EntityGroupBy } from "./types";

/**
 * The kit's pure search-then-group step (RM-32 D-OD3) — kept out of React so the ordering rules are
 * unit-testable without rendering anything.
 *
 * Order of operations matters: SEARCH FIRST, then group. Grouping first and filtering inside each
 * group would leave a header standing over nothing, which is the exact defect the rails avoided
 * ("empty sections are dropped so search never leaves a bare header").
 */
export function buildEntityGroups<T>(params: {
  items: T[];
  search: string;
  searchText: (item: T) => string;
  /** `null` ⇒ one unlabelled group holding everything (the `none` grouping). */
  groupBy: EntityGroupBy<T> | null;
}): EntityGroup<T>[] {
  const visible = filterEntities(params.items, params.search, params.searchText);
  if (visible.length === 0) return [];

  const groupBy = params.groupBy;
  if (!groupBy) {
    return [{ key: "all", label: "", isFallback: false, items: visible }];
  }

  // Insertion order is not the render order (see the sort below), but a Map keeps the first-seen
  // label/badge for a key — so a grouping whose `groupOf` returns a per-item badge can't make the
  // same group render two different headers.
  const buckets = new Map<string, EntityGroup<T>>();
  const fallback: T[] = [];
  for (const item of visible) {
    const assignment = groupBy.groupOf(item);
    if (!assignment) {
      fallback.push(item);
      continue;
    }
    const existing = buckets.get(assignment.key);
    if (existing) {
      existing.items.push(item);
      continue;
    }
    buckets.set(assignment.key, {
      key: assignment.key,
      label: assignment.label,
      isFallback: false,
      items: [item],
      ...(assignment.badge !== undefined ? { badge: assignment.badge } : {}),
    });
  }

  const order = groupBy.groupOrder ?? [];
  const rank = new Map(order.map((key, index) => [key, index] as const));
  const groups = [...buckets.values()].sort((left, right) => {
    const leftRank = rank.get(left.key);
    const rightRank = rank.get(right.key);
    // A key named in `groupOrder` always precedes one that isn't; two unnamed keys sort by label so
    // the section order is stable across renders rather than following Map insertion.
    if (leftRank !== undefined && rightRank !== undefined) return leftRank - rightRank;
    if (leftRank !== undefined) return -1;
    if (rightRank !== undefined) return 1;
    return left.label.localeCompare(right.label);
  });

  // The fallback group is ALWAYS last — "Untyped" is a tail, never a peer that could sort into the
  // middle of the named groups.
  if (fallback.length > 0) {
    groups.push({
      key: `${groupBy.id}:__fallback__`,
      label: groupBy.fallbackLabel,
      isFallback: true,
      items: fallback,
    });
  }
  return groups;
}

/** The one search predicate: case-insensitive substring over the caller's haystack. */
export function filterEntities<T>(
  items: T[],
  search: string,
  searchText: (item: T) => string,
): T[] {
  const query = search.trim().toLowerCase();
  if (!query) return items;
  return items.filter((item) => searchText(item).toLowerCase().includes(query));
}
