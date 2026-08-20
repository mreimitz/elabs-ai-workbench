import type { ReactNode } from "react";
import type { ColumnDef } from "@elabs-ai/components-data";

/**
 * The EntityBrowser kit (planning/Roadmap/RM-32-overview-detail, D-OD1–D-OD8) — the shared contract
 * for an overview page: a grouped card grid that switches to a grouped table, over any entity.
 *
 * The kit owns LAYOUT, GROUPING, SEARCH, VIEW MODE and the empty/loading states. It owns no entity
 * knowledge at all: the caller supplies the card composition (`renderCard`) and the table columns
 * (`columns`), so Servers, Skills and Collections share one implementation without the kit learning
 * what a server is.
 */

/** Which rendering the browser is in. Grid is the default (D-OD2). */
export type EntityViewMode = "grid" | "table";

/** The sentinel group-by id that means "don't group" — always offered when `groupBys` is non-empty. */
export const GROUP_BY_NONE = "none";

/** Where an item lands under one grouping dimension; `null` ⇒ the trailing fallback group. */
export type EntityGroupAssignment = {
  key: string;
  label: string;
  /** A chip rendered beside the group label (e.g. a server type's lifecycle status). */
  badge?: ReactNode;
};

/**
 * One grouping dimension (D-OD6). `groupOf` is pure and must not fetch: grouping is recomputed on
 * every search keystroke.
 */
export type EntityGroupBy<T> = {
  /** Stable id — persisted, so renaming one resets a stored preference. */
  id: string;
  /** Shown in the group-by picker. */
  label: string;
  groupOf: (item: T) => EntityGroupAssignment | null;
  /** Header for the trailing group of items `groupOf` returned `null` for ("Untyped", "Other"). */
  fallbackLabel: string;
  /**
   * Group keys in the order their sections must render. Keys absent from this list follow, sorted by
   * label; the fallback group is ALWAYS last regardless.
   */
  groupOrder?: string[];
};

/** A built section: a header plus the items visible under the current search. Never empty. */
export type EntityGroup<T> = {
  key: string;
  label: string;
  badge?: ReactNode;
  /** True for the trailing group of ungrouped items. */
  isFallback: boolean;
  items: T[];
};

/** The kit's public state, owned by the caller so its controls live in the view's ONE toolbar row. */
export type EntityBrowserState<T> = {
  search: string;
  setSearch: (value: string) => void;
  viewMode: EntityViewMode;
  setViewMode: (mode: EntityViewMode) => void;
  groupBy: EntityGroupBy<T> | null;
  groupById: string;
  setGroupById: (id: string) => void;
  /** Every offered grouping, plus the `none` sentinel — the picker's options. */
  groupByOptions: { id: string; label: string }[];
};

export type EntityBrowserProps<T> = {
  state: EntityBrowserState<T>;
  items: T[];
  itemKey: (item: T) => string;
  /** The free-text haystack the one search field filters on. */
  searchText: (item: T) => string;
  /** Noun for counts and the zero-match line: `["server", "servers"]`. */
  noun: [singular: string, plural: string];
  /** `hints.virtualizeHint` is true in a large group — forward it to `EntityCard`. */
  renderCard: (item: T, hints: { virtualizeHint: boolean }) => ReactNode;
  columns: ColumnDef<T>[];
  onOpen: (item: T) => void;
  /** Accessible name for a table row's activation control. */
  rowLabel: (item: T) => string;
  loading?: boolean;
  /** The zero-ENTITY state (caller-owned copy + create action). Not the zero-MATCH state. */
  empty: ReactNode;
  /** Rendered below the groups — e.g. the skills registry-wide trigger-collision report. */
  footer?: ReactNode;
};
