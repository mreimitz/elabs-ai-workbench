// The one holder for the pack in force, and the one accessor every consumer reads through
// (RM-38 WP 1.2). Modelled on `installPricingResolver` in `providers/pricing.ts`: a module-level
// slot, filled once at boot, ahead of anything that could observe it.
//
// WHY THIS IS LAZY, AND WHY THAT IS THE POINT
// -------------------------------------------
// `installPricingResolver`'s seam works because its consumers call `estimateCost()` at REQUEST
// time. The pack's consumers were not like that: `compatibility/dataset.ts` and `catalog.ts` read
// their JSON at MODULE LOAD. In ESM every `import` in `index.ts` is evaluated before the first
// statement of `index.ts` runs, so a module-load read cannot possibly observe an install performed
// in `index.ts`'s body — "install before the consumer" is not a thing that can be arranged, only a
// thing that can look arranged.
//
// So the ordering hazard is removed rather than documented:
//
//   * the readers resolve LAZILY, on first call, never at module load;
//   * `getDataPack()` performs the SAME resolution `index.ts` performs
//     (`resolveDataPackFromDisk`) if nothing has been installed yet, so whoever asks first gets the
//     same answer — including the DATA_DIR cache, not a quietly different bundled-only pack;
//   * the boot-time `installDataPackSource` still matters: it forces resolution at a known point,
//     surfaces a cache refusal in the log before the server accepts a request, and fails loudly on
//     a missing bundled snapshot instead of at the first heatmap.
//
// `apps/api/test/data-pack-seam.test.ts` pins both halves: that importing the readers resolves
// nothing, and that a pack installed AFTER those modules were imported is the one they return.

import { resolveDataPackFromDisk } from "./resolve.js";
import type { ResolvedDataPack } from "./loader.js";

let installed: ResolvedDataPack | null = null;

/**
 * Put a resolved pack in force. ONE assignment — a pack is applied whole or not at all (D-DP2), so
 * there is no window in which half of one pack and half of another are readable.
 */
export function installDataPackSource(pack: ResolvedDataPack): void {
  installed = pack;
}

/**
 * The pack in force. Resolves from disk on first call if boot has not installed one — see the
 * header. Throws only when the BUNDLED snapshot is missing or unusable, which is a broken build
 * artifact rather than a data problem (see `resolve.ts`).
 */
export function getDataPack(): ResolvedDataPack {
  if (installed) return installed;
  installed = resolveDataPackFromDisk().pack;
  return installed;
}

/** True once a pack is in force. Used by the seam tests to prove a reader resolved nothing. */
export function isDataPackInstalled(): boolean {
  return installed !== null;
}

/**
 * Clear the slot. For tests only — production code installs once and never uninstalls, and the
 * name says so loudly enough that a call site in `src/` reads as a mistake.
 */
export function resetDataPackSourceForTests(): void {
  installed = null;
}
