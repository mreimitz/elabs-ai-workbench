import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Collection } from "@mcp-token-footprint/shared";
import { Badge, Text } from "@elabs-ai/components-ui";
import { Lock } from "lucide-react";
import {
  BreadcrumbEntitySwitcher,
  type BreadcrumbSwitcherGroup,
} from "../../../components/BreadcrumbEntitySwitcher";
import { listCollections } from "../../../lib/api";
import { collectionBindingGroupBy, isBound, orderCollections } from "./collection-groups";

/**
 * The collection detail's breadcrumb leaf (RM-32 D-OD5): `Home › Collections › [Local ▾]`. Grouped by
 * binding, exactly as the overview is.
 *
 * It fetches the list itself, matching `CollectionDetail`'s self-contained posture. A failed fetch is
 * SWALLOWED down to "just this collection": the switcher is a convenience, and a page whose
 * breadcrumb disappears because a secondary list request failed would be a worse failure than a
 * switcher that can only offer the collection you are already on.
 */
export function CollectionBreadcrumbSwitcher(props: {
  collection: Collection;
  onCreate?: () => void;
}) {
  const navigate = useNavigate();
  const [collections, setCollections] = useState<Collection[] | null>(null);

  useEffect(() => {
    let active = true;
    listCollections()
      .then((list) => {
        if (active) setCollections(list);
      })
      .catch(() => {
        if (active) setCollections([props.collection]);
      });
    return () => {
      active = false;
    };
  }, [props.collection]);

  const groups = useMemo<BreadcrumbSwitcherGroup[]>(() => {
    const all = collections ?? [props.collection];
    const ordered = orderCollections(all);
    const groupBy = collectionBindingGroupBy();
    const rowOf = (collection: Collection) => ({
      id: collection.id,
      label: collection.name,
      ...(collection.isDefault
        ? {
            badge: (
              <Badge variant="secondary" className="shrink-0">
                <Lock aria-hidden className="size-3" />
                Local
              </Badge>
            ),
          }
        : {}),
      meta: (
        <Text variant="meta" tone="muted" className="min-w-0 truncate font-mono">
          {collection.repoUrl ?? "not bound to a repository"}
        </Text>
      ),
    });

    const result: BreadcrumbSwitcherGroup[] = [];
    for (const key of groupBy.groupOrder ?? []) {
      const members = ordered.filter(
        (collection) => (isBound(collection) ? "bound" : "local") === key,
      );
      if (members.length === 0) continue;
      const label = groupBy.groupOf(members[0] as Collection)?.label ?? "";
      result.push({ key, label, items: members.map(rowOf) });
    }
    // Nothing is bound yet — one group is not a grouping, so render the rows flat.
    if (result.length === 1) {
      return [{ key: "all", label: "", items: ordered.map(rowOf) }];
    }
    return result;
  }, [collections, props.collection]);

  return (
    <BreadcrumbEntitySwitcher
      groups={groups}
      activeId={props.collection.id}
      triggerLabel={props.collection.name}
      switchLabel="Switch collection"
      noun={["collection", "collections"]}
      loading={collections === null}
      onSelect={(id) => navigate(`/testing/collections/${id}`)}
      onViewAll={() => navigate("/testing/collections")}
      {...(props.onCreate ? { onCreate: props.onCreate, createLabel: "New collection" } : {})}
    />
  );
}
