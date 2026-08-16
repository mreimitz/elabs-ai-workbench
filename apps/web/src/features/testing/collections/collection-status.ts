import type { Collection, CollectionSyncState } from "@mcp-token-footprint/shared";

/** A sync-state chip: a label + a Badge variant (semantic tokens only — never a raw color). */
export type SyncChip = {
  key: string;
  label: string;
  variant: "success" | "warning" | "info" | "destructive" | "secondary";
};

/**
 * Derive the sync-state chips shown on a collection (list + detail) from its live
 * {@link CollectionSyncState}. Conflicts dominate (destructive); otherwise ahead (local commits to
 * push → info), behind (remote commits to pull → warning) and dirty (uncommitted local member edits →
 * warning) each surface their own chip. A fully-converged clean state shows a single "in sync" chip.
 * Color is ALWAYS paired with text (accessibility — never status by color alone).
 */
export function syncChips(state: CollectionSyncState): SyncChip[] {
  const chips: SyncChip[] = [];
  if (state.conflicts.length > 0) {
    chips.push({
      key: "conflicts",
      label: `${state.conflicts.length} conflict${state.conflicts.length === 1 ? "" : "s"}`,
      variant: "destructive",
    });
  }
  if (state.behind > 0) {
    chips.push({ key: "behind", label: `${state.behind} behind`, variant: "warning" });
  }
  if (state.ahead > 0) {
    chips.push({ key: "ahead", label: `${state.ahead} ahead`, variant: "info" });
  }
  if (state.dirty) {
    chips.push({ key: "dirty", label: "uncommitted", variant: "warning" });
  }
  if (chips.length === 0) {
    chips.push({ key: "clean", label: "in sync", variant: "success" });
  }
  return chips;
}

/** Whether the state has anything the user can act on with a sync (push/pull/commit or resolve). */
export function hasPendingWork(state: CollectionSyncState): boolean {
  return state.ahead > 0 || state.behind > 0 || state.dirty || state.conflicts.length > 0;
}

/** A short "never synced" / "last synced …" descriptor from the collection's converged commit. */
export function lastSyncedLabel(collection: Collection): string {
  return collection.lastSyncedSha
    ? `synced · ${collection.lastSyncedSha.slice(0, 7)}`
    : "never synced";
}
