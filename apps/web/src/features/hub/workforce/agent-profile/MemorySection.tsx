import { type ReactNode, useEffect, useState } from "react";
import type { HubMemory } from "@mcp-token-footprint/shared";
import { Badge, EmptyState, Spinner, Text } from "@elabs-ai/components-ui";
import { Brain } from "lucide-react";
import { listHubMemory } from "../../../../lib/api";
import { getErrorMessage } from "../../../../lib/errors";

/**
 * Assistant Hub UX WP2.3 · Memory section (D-HUX6 "Memory" · D-HUX11 scopes).
 *
 * ┌─ INTEGRATION SLOT FOR WP2.7 ─────────────────────────────────────────────────────────────────┐
 * │ WP2.7 builds the reusable `ScopedMemoryList` (parameterized by scope). Until it lands, this   │
 * │ section renders a READ-ONLY list of this agent's scoped memory from the WP1.5 API. At          │
 * │ integration, WP2.7 replaces the default body with `<ScopedMemoryList scope="agent"             │
 * │ scopeId={agentId} />` in ONE of two ways:                                                       │
 * │   • pass the `slot` prop (surfaced up as the `AgentProfileModal` `memorySection?: ReactNode`   │
 * │     prop — the documented slot name), OR                                                        │
 * │   • swap the `<AgentScopedMemoryReadonly agentId={agentId} />` line below (agentId is in scope │
 * │     here) for `<ScopedMemoryList scope="agent" scopeId={agentId} />`.                           │
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * The read-only fallback filters the memory list to `scope === "agent" && scopeId === agentId` on
 * the client (the `GET /api/hub/memory` route filters by status/kind, not scope — no route change is
 * in this WP's scope), so it never mutates and never leaks another entity's memory.
 */
export function MemorySection({
  agentId,
  slot,
}: {
  agentId: string;
  slot?: ReactNode;
}) {
  if (slot != null) return <>{slot}</>;
  return <AgentScopedMemoryReadonly agentId={agentId} />;
}

function AgentScopedMemoryReadonly({ agentId }: { agentId: string }) {
  const [memory, setMemory] = useState<HubMemory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const all = await listHubMemory();
        if (!cancelled) {
          setMemory(all.filter((m) => m.scope === "agent" && m.scopeId === agentId));
        }
      } catch (err) {
        if (!cancelled) setError(getErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-body text-muted-foreground">
        <Spinner className="size-4" aria-hidden />
        <span>Loading memory…</span>
      </div>
    );
  }

  if (error) {
    return (
      <Text variant="meta" className="text-destructive" role="alert">
        Couldn’t load memory: {error}
      </Text>
    );
  }

  if (memory.length === 0) {
    return (
      <EmptyState
        icon={<Brain aria-hidden />}
        title="No agent-scoped memory"
        description="Facts and preferences saved specifically for this agent will appear here."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Text variant="caption" tone="muted">
        Memory scoped to this agent (read-only here — manage it from the Memory surface).
      </Text>
      <ul className="flex flex-col gap-2">
        {memory.map((entry) => (
          <li
            key={entry.id}
            className="flex flex-col gap-1.5 rounded-md border border-border bg-card px-3 py-2"
          >
            <div className="flex items-center gap-2">
              <Badge variant="outline">{entry.kind}</Badge>
              {entry.status !== "active" ? (
                <Badge variant="secondary">{entry.status}</Badge>
              ) : null}
            </div>
            <Text variant="body" className="whitespace-pre-wrap break-words">
              {entry.content}
            </Text>
          </li>
        ))}
      </ul>
    </div>
  );
}
