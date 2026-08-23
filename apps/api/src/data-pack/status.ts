// The one projection behind `GET /api/data-pack`, `POST /api/data-pack/refresh` and the
// diagnostics `dataPack` group (RM-38 WP 3.2).
//
// ONE READ OF THE PACK, AND THAT IS THE INVARIANT
// -----------------------------------------------
// `buildDataPackStatus` calls `getDataPack()` exactly once and derives BOTH halves of its answer —
// the metadata (version, `asOf`, origin, file count, analyzer version) and the `values` block the
// browser renders — from that one object. A second `getDataPack()` for the values would be a seam
// through which a startup refresh landing between the two calls could produce a payload naming one
// pack's version beside another pack's model limits, which is precisely the failure the browser fix
// exists to remove. `modelContextLimitsFor(pack)` exists for this reason.
//
// WHAT THE VALUES BLOCK IS FOR
// ----------------------------
// `packages/shared` may not read the filesystem, so `apps/web` imports a COMPILED FLOOR
// (`pack-defaults.generated.ts`, `BUNDLED_SECURITY_RULES`) that is frozen at image-build time. Once
// WP 3.1 could fetch a pack, the API's answers moved and the browser's did not. This block is what
// the browser hydrates from; `apps/web/src/lib/pack-values.ts` is the only module that consumes it.
//
// It carries no model DATASET — the browser needs a `Record<string, number>`, not the ~1.8 MB
// `generated/all-models.json` that map is derived from.

import {
  type DataPackSecurityRuleView,
  type DataPackStatus,
  type DataPackValues,
  type DiagnosticsDataPack,
} from "@mcp-token-footprint/shared";
import { config } from "../config/env.js";
import type { ResolvedDataPack } from "./loader.js";
import { getDataPack } from "./source.js";
import { getLastDataPackCheck, getLastDataPackRefusal } from "./state.js";
import { modelContextLimitsFor } from "./thresholds.js";

/** True when a remote check is configured at all. A BOOLEAN — the URL itself never leaves here. */
export function dataPackCheckConfigured(): boolean {
  return config.dataPackCheckOnStart && config.dataPackUrl.trim().length > 0;
}

/**
 * The display projection of the pack's security rule registry.
 *
 * Four fields, because four is what `SecurityPanel` renders: it counts the registry, shows a rule's
 * `title` in the findings table, and its `rationale` verbatim in the popover. `category` / `subject`
 * / `deprecated` are analyzer-side facts with no rendered surface, so they stay on this side.
 */
function securityRuleViews(pack: ResolvedDataPack): Record<string, DataPackSecurityRuleView> {
  const views: Record<string, DataPackSecurityRuleView> = {};
  for (const [id, rule] of Object.entries(pack.documents.securityTables.rules)) {
    views[id] = {
      id: rule.id,
      severity: rule.severity,
      title: rule.title,
      rationale: rule.rationale,
    };
  }
  return views;
}

function valuesFor(pack: ResolvedDataPack): DataPackValues {
  const quality = pack.documents.qualityThresholds;
  return {
    modelContextLimits: modelContextLimitsFor(pack),
    defaultCompareThreshold: quality.default_compare_threshold,
    failureBucketScoreThreshold: quality.failure_bucket_score_threshold,
    securityRules: securityRuleViews(pack),
  };
}

/** The full status payload. `pack` is injectable so a test can build one over a fixture pack. */
export function buildDataPackStatus(pack: ResolvedDataPack = getDataPack()): DataPackStatus {
  const check = getLastDataPackCheck();
  const refusal = getLastDataPackRefusal();
  return {
    packVersion: pack.manifest.packVersion,
    schemaVersion: pack.manifest.schemaVersion,
    asOf: pack.manifest.asOf,
    source: pack.origin,
    files: pack.manifest.files.length,
    analyzerVersion: pack.documents.securityTables.analyzerVersion,
    checkConfigured: dataPackCheckConfigured(),
    ...(check ? { lastCheckedAt: check.at, lastCheck: check.outcome } : {}),
    ...(refusal ? { lastRefusal: refusal } : {}),
    values: valuesFor(pack),
  };
}

/**
 * The diagnostics group — the same facts, minus the `values` block (a bug report does not need
 * ~200 model context windows) and minus anything the check's URL could ride in on.
 *
 * **No free text, structurally.** `DATA_PACK_URL` is operator-configured text, so it appears in the
 * bundle's Environment group as `{ name, status }` and its VALUE reaches nothing here. That rules
 * out the refusal's `detail` as well: `fetcher.ts` composes refusal sentences with the checked URL
 * inside them ("The manifest served at ${url} …"), so quoting one would carry the configured URL
 * into a pasted bug report through the back door. What travels is the refusal's `reason` — a member
 * of the frozen `DATA_PACK_REFUSAL_REASONS` tuple — plus the version that was refused. The full
 * sentence is shown in Settings, on the operator's own screen.
 *
 * `apps/api/test/diagnostics.test.ts`'s sentinel sweep proves it by seeding a secret-shaped
 * `DATA_PACK_URL`, driving a real refusal through this module, and failing on any appearance.
 */
export function buildDiagnosticsDataPackGroup(
  pack: ResolvedDataPack = getDataPack(),
): DiagnosticsDataPack {
  const check = getLastDataPackCheck();
  const refusal = getLastDataPackRefusal();
  return {
    packVersion: pack.manifest.packVersion,
    schemaVersion: pack.manifest.schemaVersion,
    asOf: pack.manifest.asOf,
    source: pack.origin,
    files: pack.manifest.files.length,
    analyzerVersion: pack.documents.securityTables.analyzerVersion,
    checkConfigured: dataPackCheckConfigured(),
    lastCheckedAt: check?.at ?? null,
    lastCheckStatus: check?.outcome.status ?? null,
    lastRefusal: refusal
      ? {
          reason: refusal.reason,
          at: refusal.at,
          refusedVersion: refusal.refusedVersion ?? null,
          origin: refusal.origin,
        }
      : null,
  };
}
