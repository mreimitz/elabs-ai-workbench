import { useEffect, useState } from "react";
import type { AssistantStarter } from "@mcp-token-footprint/shared";
import { getAssistantStarters } from "../../lib/api";
import { useFeatureEnabled } from "../feature-flags/feature-flags-context";

/** The subset of `AssistantContextEnvelope` a starters fetch needs — kept as loose primitive fields
 *  (not the envelope type itself) so a caller can pass values pulled straight off `useAssistant()`'s
 *  `currentEnvelope`, which is a FRESH object every render (see `AssistantDock.tsx`'s own
 *  `pinnedEntityKind`/`pinnedEntityId` primitives for the same discipline). */
export type AssistantStartersQuery = {
  entityKind?: string;
  entityId?: string;
  tab?: string;
  route?: string;
  /** Extra caller-side gate ANDed with the feature flag — pass false to suppress the fetch for a
   *  reason of the caller's own. The Settings › Features switch is NOT this: it is read by the hook
   *  itself (see below), so no caller can gate the dock's fetch on the wrong feature. Defaults to true. */
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
  // Settings › Features — the App-assistant DOCK's own switch (`app_assistant`), read HERE rather
  // than passed in, so a caller cannot gate this fetch on the full-page workspace's unrelated
  // `assistant` flag (which is exactly how turning the workspace off used to take the dock with it).
  // While it is off `/api/assistant/*` answers 403, so the fetch is skipped entirely.
  const featureEnabled = useFeatureEnabled("app_assistant");
  const shouldFetch = enabled && featureEnabled;
  const [starters, setStarters] = useState<AssistantStarter[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    if (!shouldFetch) {
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
  }, [entityKind, entityId, tab, route, shouldFetch]);

  return { starters, loading };
}
