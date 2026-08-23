// THE one answer to "which reference data pack was this verdict computed against?" (RM-38 WP 3.2,
// D-DP8).
//
// Every document a verdict travels in — a security report, a posture diff, an advisor report, a
// fleet report, a compatibility heatmap or test report, a CI gate document, a server export, a run
// report — gains exactly ONE call to `dataPackStamp()`. None of them assembles the field itself, and
// `apps/api/test/data-pack-stamp.test.ts` bans the field literal from `apps/api/src` outright so it
// cannot start.
//
// WHY THIS IS A CORRECTNESS REQUIREMENT AND NOT TIDINESS: a document that names its data version is
// worthless if two builders can disagree about the version. The stamp exists so a reader can
// reproduce a verdict; a stamp that might name the wrong pack is worse than no stamp, because it
// invites exactly the trust it cannot honour.
//
// It reads `getDataPack()`, which is the same accessor every other consumer of the pack goes through
// (`source.ts`), so a startup refresh that swaps the pack mid-process is reflected here on the next
// call — a report composed after the swap names the pack that produced it, not the one that booted.

import { stampDataPackVersion, type DataPackStamp } from "@mcp-token-footprint/shared";
import { getDataPack } from "./source.js";

/**
 * The stamp for a document being built RIGHT NOW, against the pack in force right now.
 *
 * Spread it into the returned object literal (`...dataPackStamp()`); never destructure and re-assign
 * the field, which is the thing the ban guard exists to stop.
 */
export function dataPackStamp(): DataPackStamp {
  return stampDataPackVersion(getDataPack().manifest.packVersion);
}
