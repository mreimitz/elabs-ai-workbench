import type { Collection } from "@mcp-token-footprint/shared";
import type { EntityGroupBy } from "../../../components/entity-browser";

/**
 * Grouping collections by BINDING (RM-32 D-OD6): `Unbound` first, then `Git-bound`.
 *
 * The unbound group is labelled "Unbound", NOT "Local", even though a local collection is exactly
 * what it holds — the reserved default collection is itself NAMED "Local", and a group header
 * reading "Local" above a card reading "Local" makes two different things look like one.
 *
 * The reserved default collection is pinned first WITHIN the Local group — that ordering comes from
 * the caller's item order (`orderCollections` below), because grouping preserves the order items
 * arrive in. A collection has no other dimension worth grouping by today: sync state is live and
 * churns, which would make sections appear and disappear under the operator mid-read.
 */
export const COLLECTION_GROUP_LOCAL = "local";
export const COLLECTION_GROUP_BOUND = "bound";

export function isBound(collection: Collection): boolean {
  return Boolean(collection.repoUrl);
}

/** The reserved default first, then everything else by name — the order the list has always used. */
export function orderCollections(collections: Collection[]): Collection[] {
  const local = collections.filter((collection) => collection.isDefault);
  const rest = [...collections]
    .filter((collection) => !collection.isDefault)
    .sort((left, right) => left.name.localeCompare(right.name));
  return [...local, ...rest];
}

export function collectionBindingGroupBy(): EntityGroupBy<Collection> {
  return {
    id: "binding",
    label: "Binding",
    // Unreachable — every collection is either bound or not — but a group-by must answer for every
    // item, and an honest fallback beats a cast.
    fallbackLabel: "Other",
    groupOrder: [COLLECTION_GROUP_LOCAL, COLLECTION_GROUP_BOUND],
    groupOf: (collection) =>
      isBound(collection)
        ? { key: COLLECTION_GROUP_BOUND, label: "Git-bound" }
        : { key: COLLECTION_GROUP_LOCAL, label: "Unbound" },
  };
}
