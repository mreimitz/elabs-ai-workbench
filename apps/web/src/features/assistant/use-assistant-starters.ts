import { useEffect, useState } from "react";
import type { AssistantStarter } from "@mcp-token-footprint/shared";
import { getAssistantStarters } from "../../lib/api";

/** The subset of `AssistantContextEnvelope` a starters fetch needs — kept as loose primitive fields
 *  (not the envelope type itself) so a caller can pass values pulled straight off `useAssistant()`'s
 *  `currentEnvelope`, which is a FRESH object every render (see `AssistantDock.tsx`'s own
 *  `pinnedEntityKind`/`pinnedEntityId` primitives for the same discipline). */
export type AssistantStartersQuery = {
  entityKind?: string;
  entityId?: string;
  tab?: string;
  route?: string;
  /** Settings › Features — when false the hook does not fetch at all and reports zero starters (the
   *  Assistant feature is switched off, so `/api/assistant/*` answers 403). Defaults to true. */
  enabled?: boolean;
};

/**
 * WP R3.2 — fetch the current page's session-starter chips (`GET /api/assistant/starters`, built in
 * WP R3.1) for the dock's empty state (`PendingPanel` in `AssistantDock.tsx`). Keyed on the query's
 * PRIMITIVE fields — not a single object — so the effect only re-fires on an actual page/entity/tab
 * change, never on an incidental parent re-render.
 *
 * Graceful by construction (the R3 plan's explicit requirement: "an empty/failed starters fetch must
 * never break the dock"): any fetch failure just yields `starters: []`, same as a genuinely empty
 * response — there is nothing for a caller to branch on beyond "were there starters to show." Errors
 * are swallowed here rather than surfaced as a toast because this is best-effort UI sugar layered on
 * top of an already-functional empty state, not a user-initiated action.
 */
export function useAssistantStarters(query: AssistantStartersQuery): {
  starters: AssistantStarter[];
  loading: boolean;
} {
  const { entityKind, entityId, tab, route, enabled = true } = query;
  const [starters, setStarters] = useState<AssistantStarter[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    if (!enabled) {
      setStarters([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    getAssistantStarters({ entityKind, entityId, tab, route })
      .then((response) => {
        if (active) setStarters(response.starters);
      })
      .catch(() => {
        if (active) setStarters([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [entityKind, entityId, tab, route, enabled]);

  return { starters, loading };
}
