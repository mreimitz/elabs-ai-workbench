import type { ReactNode } from "react";
import type { HubMemory, HubMemoryKind } from "@mcp-token-footprint/shared";
import { Badge, EmptyState, Spinner, Text } from "@brand/ui";
import { DialogSection } from "../../../../components/dialogs";
import { InlineError } from "../../../../components/InlineError";
import { listHubMemory } from "../../../../lib/api";
import { loadableData, useLoadable } from "../../../../lib/loadable";
import { formatDateTime } from "../../../../lib/format";

const KIND_LABELS: Record<HubMemoryKind, string> = {
  profile: "Profile",
  preference: "Preference",
  instruction: "Instruction",
};

/**
 * Assistant Hub UX WP2.4 (D-HUX6/D-HUX11) — the crew profile modal's Memory section.
 *
 * ================================================================================================
 * CROSS-COMPONENT SLOT: `memorySection` (built in parallel by WP2.7, `features/hub/memory/*`)
 * ================================================================================================
 * WP2.7 owns the ONE shared card-list treatment for scoped memory (`ScopedMemoryList` — grouped,
 * provenance, inline edit, archive) reused everywhere memory renders (this modal, the agent profile,
 * the project detail Memory section, the workspace Context's effective stack). At Wave-2 integration,
 * pass `<ScopedMemoryList scope="crew" scopeId={crewId} />` as `memorySection` here to replace the
 * placeholder below. Until then, the DEFAULT is a read-only list straight off the WP1.5 memory API
 * (`listHubMemory({ scope: "crew", scopeId })`, the scope filter WP2.4 added to the route) — real
 * data, just no edit/archive affordance yet.
 */
export function MemorySection({
  crewId,
  memorySection,
}: {
  crewId: string;
  /** Slot name: `memorySection` — see the class doc above. */
  memorySection?: ReactNode;
}) {
  return (
    <DialogSection
      title="Memory"
      description="What this crew has learned or been told — injected into every session that runs it."
    >
      {memorySection ?? <DefaultCrewMemoryList crewId={crewId} />}
    </DialogSection>
  );
}

/** The WP2.4 placeholder default — read-only, crew-scoped, active memory only (a proposed/archived row
 *  isn't part of the effective injected stack, so it stays out of this read-only view). */
function DefaultCrewMemoryList({ crewId }: { crewId: string }) {
  const { state, reload } = useLoadable<HubMemory[]>(
    () => listHubMemory({ status: "active", scope: "crew", scopeId: crewId }),
    [crewId],
  );
  const entries = loadableData(state);

  if (state.status === "loading") {
    return (
      <div className="flex items-center gap-2 text-body text-muted-foreground">
        <Spinner className="size-4" aria-hidden />
        <span>Loading memory…</span>
      </div>
    );
  }
  if (state.status === "error") {
    return <InlineError title="Couldn’t load this crew's memory" detail={state.error} onRetry={reload} />;
  }
  if (!entries || entries.length === 0) {
    return (
      <EmptyState
        title="No memory yet"
        description="Nothing has been learned about this crew yet — the assistant proposes crew-scoped facts as sessions run."
      />
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {entries.map((memory) => (
        <li key={memory.id} className="flex flex-col gap-1 rounded-md border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <Badge variant="secondary" className="w-fit">
              {KIND_LABELS[memory.kind]}
            </Badge>
            <Text variant="meta" tone="muted" className="shrink-0">
              {formatDateTime(memory.updatedAt)}
            </Text>
          </div>
          <Text className="text-pretty break-words">{memory.content}</Text>
        </li>
      ))}
    </ul>
  );
}
