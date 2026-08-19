import {
  APP_SETTING_FEATURES_KEY,
  type AppFeatureFlags,
  type AppFeatureFlagsUpdate,
  featureForPath,
  resolveFeatureFlags,
} from "@mcp-token-footprint/shared";
import type { AppSettingsRepository } from "../grading/app-settings-repository.js";
import { normalizeRequestPath, requestPathCandidates } from "../utils/request-path.js";

/**
 * App feature flags (Settings › Features) over the existing `app_settings` KV — no table, no migration.
 *
 * The flag map is read on EVERY request by the `onRequest` guard, so it is cached in memory and
 * refreshed only when a write lands here. That keeps the guard to a property read rather than a
 * SQLite round-trip per request; the cache is authoritative because this process is the only writer
 * (single container, single DB — see the runtime boundary in `.claude/rules/architecture.md`).
 *
 * Failure posture: a store that cannot be read resolves to the DEFAULTS, i.e. everything ENABLED.
 * An off-switch whose backing store hiccups must never take the app's features down with it.
 */
export class FeatureFlagsService {
  private cache: AppFeatureFlags;

  constructor(private readonly settings: AppSettingsRepository) {
    this.cache = this.readFromStore();
  }

  private readFromStore(): AppFeatureFlags {
    try {
      return resolveFeatureFlags(this.settings.get(APP_SETTING_FEATURES_KEY));
    } catch {
      // A corrupt/unavailable store must not disable anything.
      return resolveFeatureFlags(undefined);
    }
  }

  /** The current flag map (cached). */
  getFlags(): AppFeatureFlags {
    return { ...this.cache };
  }

  /** Apply a PARTIAL patch; unmentioned features keep their current value. Returns the new map. */
  setFlags(patch: AppFeatureFlagsUpdate): AppFeatureFlags {
    const next = resolveFeatureFlags({ ...this.cache, ...patch });
    this.settings.put(APP_SETTING_FEATURES_KEY, next);
    this.cache = next;
    return { ...next };
  }

  /** Re-read the store into the cache (used by tests and by anything that writes the KV directly). */
  refresh(): AppFeatureFlags {
    this.cache = this.readFromStore();
    return { ...this.cache };
  }

  /**
   * The disabled feature that owns `url`, or `undefined` when the request is allowed. `url` may carry
   * a query string — only the path is matched. `/api/features` itself is never owned by a feature
   * (asserted in the shared tests), so the switch can always be flipped back on.
   *
   * The path is matched through `normalizeRequestPath`, over EVERY interpretation the router might
   * take (raw and percent-decoded). Fastify's router decodes before matching while `request.url`
   * stays raw, so matching the raw string alone let `/%61pi/assistant/...` (`%61` = `a`) read as
   * "no feature owns this" — the guard waved it through and the router then dispatched it to the
   * real assistant route. That defeats the whole point of this guard: a stale tab or a direct curl
   * COULD keep spending against a switched-off feature. See `utils/request-path.ts`.
   */
  blockingFeature(url: string): { id: string; label: string } | undefined {
    for (const candidate of requestPathCandidates(normalizeRequestPath(url))) {
      const meta = featureForPath(candidate, "api");
      if (meta && !this.cache[meta.id]) return { id: meta.id, label: meta.label };
    }
    return undefined;
  }
}
