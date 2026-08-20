import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { GROUP_BY_NONE, type EntityBrowserState, type EntityGroupBy, type EntityViewMode } from "./types";

/**
 * The EntityBrowser's public state (RM-32 D-OD2). The caller owns it — not the browser — so the
 * search field, the group-by picker and the view-mode toggle can live in the view's ONE `ViewToolbar`
 * row (D-TB2: exactly one toolbar row per view; a browser that rendered its own would be a second).
 *
 * View-mode precedence is `?view=` → stored preference → grid. The URL param makes a view shareable
 * without ever being REQUIRED (D-OD1: every route renders something useful with zero query params),
 * and an unrecognised value is ignored rather than treated as an error.
 */
const STORAGE_PREFIX = "mcp-token-footprint.entity-browser";
const VIEW_PARAM = "view";

function viewStorageKey(storageKey: string): string {
  return `${STORAGE_PREFIX}.${storageKey}.view`;
}
function groupStorageKey(storageKey: string): string {
  return `${STORAGE_PREFIX}.${storageKey}.group-by`;
}

function isViewMode(value: string | null): value is EntityViewMode {
  return value === "grid" || value === "table";
}

/** Best-effort read — `localStorage` throws in some private-browsing modes (the `theme.ts` posture). */
function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Preference is a convenience, never a requirement — a failed write must not break the toggle.
  }
}

export function useEntityBrowserState<T>(params: {
  /** Namespaces the stored preferences: "servers" | "skills" | "collections". */
  storageKey: string;
  /** The offered grouping dimensions. Empty ⇒ no picker and no grouping at all. */
  groupBys: EntityGroupBy<T>[];
  /** Which grouping to start on when nothing is stored. Defaults to the first one. */
  defaultGroupById?: string;
}): EntityBrowserState<T> {
  const { storageKey, groupBys, defaultGroupById } = params;
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");

  // The stored fallbacks are read ONCE (lazy initial state): re-reading every render would let a
  // write from another tab yank the mode out from under an interaction mid-session.
  const [storedView, setStoredView] = useState<EntityViewMode>(() => {
    const raw = readStored(viewStorageKey(storageKey));
    return isViewMode(raw) ? raw : "grid";
  });
  const [storedGroupById, setStoredGroupById] = useState<string>(() => {
    const raw = readStored(groupStorageKey(storageKey));
    if (raw) return raw;
    return defaultGroupById ?? groupBys[0]?.id ?? GROUP_BY_NONE;
  });

  const paramView = searchParams.get(VIEW_PARAM);
  const viewMode: EntityViewMode = isViewMode(paramView) ? paramView : storedView;

  const setViewMode = useCallback(
    (mode: EntityViewMode) => {
      setStoredView(mode);
      writeStored(viewStorageKey(storageKey), mode);
      // `replace` so flipping the toggle a few times doesn't bury the page the user arrived from
      // under a stack of history entries.
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          next.set(VIEW_PARAM, mode);
          return next;
        },
        { replace: true },
      );
    },
    [storageKey, setSearchParams],
  );

  const groupByOptions = useMemo(
    () =>
      groupBys.length > 0
        ? [...groupBys.map((g) => ({ id: g.id, label: g.label })), { id: GROUP_BY_NONE, label: "None" }]
        : [],
    [groupBys],
  );

  // Keep the selection valid if the stored grouping no longer exists (a dimension was renamed or
  // removed) — the `effectiveFilter` guard the server rail used, generalised.
  const groupById = useMemo(() => {
    if (storedGroupById === GROUP_BY_NONE) return GROUP_BY_NONE;
    if (groupBys.some((g) => g.id === storedGroupById)) return storedGroupById;
    return defaultGroupById && groupBys.some((g) => g.id === defaultGroupById)
      ? defaultGroupById
      : (groupBys[0]?.id ?? GROUP_BY_NONE);
  }, [storedGroupById, groupBys, defaultGroupById]);

  const setGroupById = useCallback(
    (id: string) => {
      setStoredGroupById(id);
      writeStored(groupStorageKey(storageKey), id);
    },
    [storageKey],
  );

  const groupBy = useMemo(
    () => (groupById === GROUP_BY_NONE ? null : (groupBys.find((g) => g.id === groupById) ?? null)),
    [groupById, groupBys],
  );

  return {
    search,
    setSearch,
    viewMode,
    setViewMode,
    groupBy,
    groupById,
    setGroupById,
    groupByOptions,
  };
}
