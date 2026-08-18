import {
  type AppFeatureFlags,
  type AppFeatureFlagsUpdate,
  type AppFeatureId,
  DEFAULT_APP_FEATURE_FLAGS,
  isFeatureEnabled,
  resolveFeatureFlags,
} from "@mcp-token-footprint/shared";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { getFeatureFlags, updateFeatureFlags } from "../../lib/api";

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * Settings › Features — the web mirror of the API's feature-flag map.
 *
 * The API is the source of truth and ALSO enforces a disabled feature (403 `feature_disabled` on its
 * own endpoints). This context exists so the UI stops OFFERING what the server would refuse: the
 * feature's nav entries, its dock/page-hook entry points, and its routes (which swap to a "turned
 * off" panel rather than disappearing — see `FeatureDisabledView`).
 *
 * Two deliberate choices:
 *
 *   • **Unknown reads as ON.** Before the first fetch resolves — and if the fetch fails — every
 *     feature reads enabled. A settings fetch hiccup must never blank out the app's navigation.
 *   • **Last-known flags are mirrored to localStorage** and used as the initial value, so a reload
 *     with the Assistant off doesn't paint its five nav items for a frame and then yank them away.
 *     The mirror is a rendering hint only; the server's answer always overwrites it.
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

const FEATURE_FLAGS_STORAGE_KEY = "mcp-token-footprint.feature-flags";

/** Read the last-known map (best-effort; localStorage throws in private mode / when disabled). */
function readMirror(): AppFeatureFlags {
  try {
    const raw = window.localStorage.getItem(FEATURE_FLAGS_STORAGE_KEY);
    if (!raw) return DEFAULT_APP_FEATURE_FLAGS;
    return resolveFeatureFlags(JSON.parse(raw));
  } catch {
    return DEFAULT_APP_FEATURE_FLAGS;
  }
}

function writeMirror(flags: AppFeatureFlags): void {
  try {
    window.localStorage.setItem(FEATURE_FLAGS_STORAGE_KEY, JSON.stringify(flags));
  } catch {
    // A missing mirror only costs a one-frame flicker on the next reload.
  }
}

export type FeatureFlagsContextValue = {
  flags: AppFeatureFlags;
  /** False until the first successful fetch (the map is still the localStorage/default guess). */
  loaded: boolean;
  /** Apply a partial patch server-side, then adopt the returned map. Throws on failure. */
  setFeature: (patch: AppFeatureFlagsUpdate) => Promise<AppFeatureFlags>;
  /** Re-read from the API (e.g. after another surface changed a flag). */
  refresh: () => Promise<void>;
};

/** Default value: everything ON. A component rendered outside the provider (unit tests, Storybook)
 *  therefore behaves exactly like a stock install rather than throwing. */
const FeatureFlagsContext = createContext<FeatureFlagsContextValue>({
  flags: DEFAULT_APP_FEATURE_FLAGS,
  loaded: false,
  setFeature: async () => DEFAULT_APP_FEATURE_FLAGS,
  refresh: async () => {},
});

export function FeatureFlagsProvider({ children }: { children: ReactNode }) {
  const [flags, setFlags] = useState<AppFeatureFlags>(readMirror);
  const [loaded, setLoaded] = useState(false);

  const adopt = useCallback((next: AppFeatureFlags) => {
    setFlags(next);
    writeMirror(next);
    setLoaded(true);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const { flags: next } = await getFeatureFlags();
      adopt(resolveFeatureFlags(next));
    } catch {
      // Keep the last-known map. Never disable anything because a fetch failed — and stay silent:
      // a toast here would fire on every cold start with the API still booting.
    }
  }, [adopt]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setFeature = useCallback(
    async (patch: AppFeatureFlagsUpdate) => {
      const { flags: next } = await updateFeatureFlags(patch);
      const resolved = resolveFeatureFlags(next);
      adopt(resolved);
      return resolved;
    },
    [adopt],
  );

  const value = useMemo<FeatureFlagsContextValue>(
    () => ({ flags, loaded, setFeature, refresh }),
    [flags, loaded, setFeature, refresh],
  );

  return <FeatureFlagsContext.Provider value={value}>{children}</FeatureFlagsContext.Provider>;
}

export function useFeatureFlags(): FeatureFlagsContextValue {
  return useContext(FeatureFlagsContext);
}

/** Whether one feature is on. The hook every gate site uses. */
export function useFeatureEnabled(feature: AppFeatureId): boolean {
  const { flags } = useFeatureFlags();
  return isFeatureEnabled(flags, feature);
}
