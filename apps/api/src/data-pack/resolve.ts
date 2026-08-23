// Picks WHICH pack is in force (RM-38 WP 1.2, D-DP2 rungs one and two — the network fetch is
// WP 3.1).
//
//     bundled snapshot  →  DATA_DIR/data-pack/ cache, if it loads AND its packVersion is strictly
//                          higher than the bundled one
//
// The whole pack is built first and handed back in one piece; `source.ts` installs it in a single
// assignment. There is no per-file merge across sources and no partial application: if the cache
// refuses, the bundled pack serves unchanged (D-DP2/D-DP5).
//
// TWO FAILURE MODES, DELIBERATELY DIFFERENT:
//
//   * A bad CACHE is a data failure. It is refused as a VALUE, logged, and the bundled pack keeps
//     serving. Boot succeeds. That is D-DP4.
//   * A missing or unloadable BUNDLED snapshot is a broken build artifact, not data. There is
//     nothing left to fall back to — the model roster, the cross-cutting limits and the
//     compatibility catalog all live in the pack — so this THROWS. An app that cannot find its own
//     shipped data must say so, not serve an empty model list.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_PACK_MANIFEST_FILENAME, type DataPackRefusal } from "@mcp-token-footprint/shared";
import { config } from "../config/env.js";
import { type DataPackFs, nodeDataPackFs } from "./fs.js";
import { type DataPackOrigin, loadDataPack, type ResolvedDataPack } from "./loader.js";
import { verifyCandidatePack } from "./verify.js";

/**
 * The directory name the API build copies the pack into, beside the compiled code
 * (`apps/api/dist/data-pack-bundled/`). It is NOT `data-pack`, because `apps/api/src/data-pack/`
 * compiles to `apps/api/dist/data-pack/` — code and data in one directory is a name collision
 * waiting to be debugged at 2am.
 */
export const BUNDLED_PACK_DIRNAME = "data-pack-bundled";

/** The pack subdirectory under `DATA_DIR` that a refreshed pack is cached into (WP 3.1 writes it). */
export const CACHE_PACK_DIRNAME = "data-pack";

/**
 * Where a download is assembled before anything has verified it (RM-38 WP 3.1).
 *
 * A SIBLING of the cache directory, not a child of it, and that is a correction to the WP spec
 * rather than a preference. The spec says `DATA_DIR/data-pack/.staging/`, verified there and then
 * renamed into `DATA_DIR/data-pack/` — but `rename(2)` cannot move a directory into its own
 * ancestor (EINVAL), so that swap is not expressible. A sibling can be renamed into place; a child
 * cannot. The property the spec was buying is unchanged and is the one that matters: an
 * interrupted download lives somewhere `resolveDataPack` never looks, and `DATA_DIR/data-pack/`
 * only ever comes into existence through a single `rename` of an already-verified tree.
 */
export const STAGING_PACK_DIRNAME = "data-pack.staging";

/**
 * Where the OUTGOING pack is parked for the microsecond between the two renames of a swap.
 *
 * `rename(2)` onto a non-empty directory is ENOTEMPTY, so replacing the cache is two renames: old
 * out, new in. A crash between them leaves no cache at all — which resolves to the bundled pack on
 * the next boot, i.e. the D-DP4 answer, never a partial tree. The alternative (rename new over old
 * in one call) does not exist on POSIX.
 */
export const RETIRED_PACK_DIRNAME = "data-pack.retired";

export class DataPackUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataPackUnavailableError";
  }
}

/** A refusal, tagged with the rung it came from, so a log line says which pack was rejected. */
export type OriginRefusal = DataPackRefusal & { origin: DataPackOrigin; dir: string };

export type DataPackResolution = {
  pack: ResolvedDataPack;
  /**
   * The BUNDLED snapshot, always — even when a cache won and `pack` is something else.
   *
   * WP 3.1 needs it, and needs it to be this one specifically: D-DP6 anchors the append-only
   * security rule-id ledger on the registry that SHIPPED IN THE IMAGE. An anchor that moved with
   * each accepted pack would let a chain of packs walk the ledger anywhere, one small append at a
   * time. Returned here rather than re-resolved by the caller, because re-reading and re-parsing
   * ~2 MB of pack at boot to recover an object this function already built is waste with a second
   * failure mode attached.
   */
  bundled: ResolvedDataPack;
  /** Non-fatal refusals seen while resolving. Empty on a clean boot. */
  refusals: OriginRefusal[];
};

/**
 * Where the bundled snapshot lives, given the directory THIS module sits in.
 *
 * Two layouts, and exactly one candidate is tried in each — a fallback chain would be worse than
 * useless here: running `node apps/api/dist/index.js` inside a repository checkout, a missing
 * `dist/data-pack-bundled/` would silently fall through to the repository's own `data-pack/` and
 * the packaging bug would ship. So "am I compiled?" decides, and it decides alone.
 */
export function findBundledPackDir(
  moduleDir: string,
  fs: DataPackFs = nodeDataPackFs,
): { dir: string | null; searched: string[] } {
  const compiled = path.basename(path.dirname(moduleDir)) === "dist";
  const candidate = compiled
    ? // apps/api/dist/data-pack → apps/api/dist/data-pack-bundled
      path.resolve(moduleDir, "..", BUNDLED_PACK_DIRNAME)
    : // apps/api/src/data-pack → <repo root>/data-pack
      path.resolve(moduleDir, "..", "..", "..", "..", CACHE_PACK_DIRNAME);
  const searched = [candidate];
  const ok = fs.exists(path.join(candidate, DATA_PACK_MANIFEST_FILENAME));
  return { dir: ok ? candidate : null, searched };
}


export function resolveDataPack(args: {
  bundledDir: string | null;
  bundledSearched?: string[];
  cacheDir?: string | null;
  fs?: DataPackFs;
}): DataPackResolution {
  const fs = args.fs ?? nodeDataPackFs;
  const refusals: OriginRefusal[] = [];

  if (!args.bundledDir) {
    throw new DataPackUnavailableError(
      "The bundled reference data pack is missing. Looked for manifest.json in: " +
        `${(args.bundledSearched ?? []).join(", ") || "<nowhere>"}. ` +
        "A build produces it via `apps/api/scripts/copy-data-pack.mjs`; without it the model " +
        "roster, cross-cutting limits and compatibility catalog cannot be read at all.",
    );
  }

  const bundled = loadDataPack({ dir: args.bundledDir, origin: "bundled", fs });
  if (!bundled.ok) {
    throw new DataPackUnavailableError(
      `The bundled reference data pack at ${args.bundledDir} is unusable (${bundled.refusal.reason}): ` +
        bundled.refusal.detail,
    );
  }

  let pack = bundled.pack;

  const cacheDir = args.cacheDir ?? null;
  if (cacheDir && fs.exists(path.join(cacheDir, DATA_PACK_MANIFEST_FILENAME))) {
    // ONE verifier, shared with WP 3.1's fetch rung (see verify.ts). Everything this rung used to
    // do inline — load, the D-DP6/D-DP7 registry checks, then the version comparison, in that
    // order — now has exactly one implementation, so a cached pack and a fetched pack cannot be
    // judged by two subtly different rules.
    const verified = verifyCandidatePack({
      dir: cacheDir,
      origin: "cache",
      inForce: bundled.pack,
      bundled: bundled.pack,
      fs,
    });
    if (verified.ok) {
      pack = verified.pack;
    } else {
      refusals.push({ ...verified.refusal, origin: "cache", dir: cacheDir });
    }
  }

  return { pack, bundled: bundled.pack, refusals };
}

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * The resolution this process performs, from the real filesystem. Called once at boot by
 * `index.ts`, and — because ESM evaluates every import before any statement in `index.ts` — also
 * lazily by `source.ts` if some consumer asks for the pack first. Both paths run THIS function, so
 * the answer cannot depend on who asked first.
 */
export function resolveDataPackFromDisk(fs: DataPackFs = nodeDataPackFs): DataPackResolution {
  const bundled = findBundledPackDir(HERE, fs);
  return resolveDataPack({
    bundledDir: bundled.dir,
    bundledSearched: bundled.searched,
    cacheDir: path.join(config.dataDirectory, CACHE_PACK_DIRNAME),
    fs,
  });
}
