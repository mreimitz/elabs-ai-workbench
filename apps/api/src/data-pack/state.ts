// What the last reference-data check DID, kept in memory so Settings and `/api/diagnostics` can say
// it (RM-38 WP 3.2).
//
// IN MEMORY, DELIBERATELY. No migration, no table, no column — the check runs at boot and on demand,
// and its result describes THIS process. Persisting it would answer a question nobody asks ("what
// did the container that died last Tuesday see?") while adding a schema version to a work package
// that needs none.
//
// TWO SLOTS, NOT ONE, AND THAT IS THE WHOLE POINT
// ----------------------------------------------
// `lastCheck` is the most recent outcome. `lastRefusal` is the most recent REFUSAL, and a later
// successful check does **not** clear it. An operator's question is not "what happened last time"
// but "is something out there this build will not trust", and a refusal that scrolled off behind a
// routine `up_to_date` would answer the first and hide the second. This is the RM-17 lesson stated
// as a data structure: an empty window there returned `breached:false`, so the not-breached branch
// wrote `window_recover` and a bench that went silent while a rule was firing reported as
// "recovered". A failed check must never be able to look like a successful one.
//
// The boot-time CACHE refusal (`resolveDataPack`'s `refusals`) lands in the same slot as a FETCH
// refusal, tagged by origin — both are "a pack was offered and this build would not trust it", and
// splitting them would give the UI two places to forget to look.

import type { DataPackFetchOutcome, DataPackRefusalRecord } from "@mcp-token-footprint/shared";

type CheckRecord = { at: string; outcome: DataPackFetchOutcome };

let lastCheck: CheckRecord | null = null;
let lastRefusal: DataPackRefusalRecord | null = null;

/** Record one completed check. Overwrites `lastCheck`; only ADDS to `lastRefusal`. */
export function recordDataPackCheck(outcome: DataPackFetchOutcome, now: Date = new Date()): void {
  const at = now.toISOString();
  lastCheck = { at, outcome };
  if (outcome.status === "refused" && outcome.refusal) {
    lastRefusal = {
      reason: outcome.refusal.reason,
      detail: outcome.refusal.detail,
      ...(outcome.refusal.paths ? { paths: outcome.refusal.paths } : {}),
      at,
      ...(outcome.remoteVersion ? { refusedVersion: outcome.remoteVersion } : {}),
      origin: "fetched",
    };
  }
}

/**
 * Record a refusal that did NOT come from a network check — the boot-time read of
 * `DATA_DIR/data-pack/`. It sets `lastRefusal` and deliberately leaves `lastCheck` alone: no remote
 * check has happened, and claiming one would be the fabrication this module exists to prevent.
 */
export function recordDataPackRefusal(
  refusal: { reason: DataPackRefusalRecord["reason"]; detail: string; paths?: string[] },
  origin: DataPackRefusalRecord["origin"],
  refusedVersion?: string,
  now: Date = new Date(),
): void {
  lastRefusal = {
    reason: refusal.reason,
    detail: refusal.detail,
    ...(refusal.paths ? { paths: refusal.paths } : {}),
    at: now.toISOString(),
    ...(refusedVersion ? { refusedVersion } : {}),
    origin,
  };
}

export function getLastDataPackCheck(): CheckRecord | null {
  return lastCheck;
}

export function getLastDataPackRefusal(): DataPackRefusalRecord | null {
  return lastRefusal;
}

/** For tests only — production records and never clears. */
export function resetDataPackStateForTests(): void {
  lastCheck = null;
  lastRefusal = null;
}
