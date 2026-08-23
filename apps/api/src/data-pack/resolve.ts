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
import {
  checkSecurityRuleLedger,
  checkSecurityRuleSet,
  checkSecuritySeverityBump,
  comparePackVersions,
  type DataPackRefusal,
} from "@mcp-token-footprint/shared";
import { config } from "../config/env.js";
import { type DataPackFs, nodeDataPackFs } from "./fs.js";
import { type DataPackOrigin, loadDataPack, type ResolvedDataPack } from "./loader.js";

/**
 * The directory name the API build copies the pack into, beside the compiled code
 * (`apps/api/dist/data-pack-bundled/`). It is NOT `data-pack`, because `apps/api/src/data-pack/`
 * compiles to `apps/api/dist/data-pack/` — code and data in one directory is a name collision
 * waiting to be debugged at 2am.
 */
export const BUNDLED_PACK_DIRNAME = "data-pack-bundled";

/** The pack subdirectory under `DATA_DIR` that a refreshed pack is cached into (WP 3.1 writes it). */
export const CACHE_PACK_DIRNAME = "data-pack";

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
  const ok = fs.exists(path.join(candidate, "manifest.json"));
  return { dir: ok ? candidate : null, searched };
}

/**
 * The three cross-pack security checks a CANDIDATE pack must pass before it can replace the one
 * shipped in the image (RM-38 WP 2.1). Returns a refusal, or `null` when the candidate is safe.
 *
 * WHY THESE LIVE HERE AND NOT IN THE LOADER: each one compares a candidate against the BUNDLED
 * registry, and `loadDataPack` only ever sees one pack. This function is the only place that holds
 * both, which is also why WP 3.1's fetcher will call exactly this rather than growing its own copy.
 *
 * WHAT THEY ARE FOR, in one sentence: the `no-new-security-findings` CI gate identifies a finding by
 * `(ruleId, anchor)` and decides pass or fail on a severity floor, so a fetched file that renamed an
 * id or lowered a severity would change somebody else's pipeline verdict with no code change
 * anywhere. D-DP6 and D-DP7 exist for exactly that, and they are load-time refusals rather than
 * documentation.
 *
 * WHAT THEY CANNOT SEE: anything about the SIGNATURE lists. A pack that removes an injection phrase
 * is not refused — that is a legitimate reason to publish a pack, and it is why the ledger and the
 * severity rule guard the rule REGISTRY specifically rather than the pack as a whole.
 */
function checkCandidateSecurityRegistry(
  candidate: ResolvedDataPack,
  bundled: ResolvedDataPack,
): DataPackRefusal | null {
  const doc = candidate.documents.securityRulesDoc;
  const bundledTables = bundled.documents.securityTables;

  const ledger = checkSecurityRuleLedger(doc.idLedger, bundledTables.idLedger);
  if (ledger) {
    return { reason: "rule_ledger_not_append_only", detail: ledger.reason, paths: [SECURITY_RULES_PATH] };
  }
  const ruleSet = checkSecurityRuleSet(doc, bundledTables.rules);
  if (ruleSet) {
    return { reason: "schema_violation", detail: ruleSet.reason, paths: [SECURITY_RULES_PATH] };
  }
  const severities = checkSecuritySeverityBump(
    doc,
    bundledTables.rules,
    bundledTables.analyzerVersion,
  );
  if (severities) {
    return { reason: "schema_violation", detail: severities.reason, paths: [SECURITY_RULES_PATH] };
  }
  return null;
}

/** The one path every security-registry refusal names, so a log line points at the file to fix. */
const SECURITY_RULES_PATH = "security/rules.json";

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
  if (cacheDir && fs.exists(path.join(cacheDir, "manifest.json"))) {
    const cached = loadDataPack({ dir: cacheDir, origin: "cache", fs });
    // RM-38 WP 2.1 — the security-registry checks come BEFORE the version comparison, on purpose. A
    // pack that renames a rule id is refused whether or not it is newer, and reporting it as a
    // version regression would name the wrong problem.
    const registryRefusal = cached.ok
      ? checkCandidateSecurityRegistry(cached.pack, bundled.pack)
      : null;
    if (!cached.ok) {
      refusals.push({ ...cached.refusal, origin: "cache", dir: cacheDir });
    } else if (registryRefusal !== null) {
      refusals.push({ ...registryRefusal, origin: "cache", dir: cacheDir });
    } else {
      const order = comparePackVersions(
        cached.pack.manifest.packVersion,
        bundled.pack.manifest.packVersion,
      );
      if (order === 1) {
        pack = cached.pack;
      } else {
        refusals.push({
          reason: "version_regression",
          detail:
            `Cached pack ${cached.pack.manifest.packVersion} is not newer than the bundled pack ` +
            `${bundled.pack.manifest.packVersion}${order === null ? " (and one of the two versions is unorderable)" : ""}; ` +
            "keeping the bundled pack.",
          origin: "cache",
          dir: cacheDir,
        });
      }
    }
  }

  return { pack, refusals };
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
