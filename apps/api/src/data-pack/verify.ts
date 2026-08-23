// The five D-DP5 refusals, in ONE place, applied to a CANDIDATE pack against the pack in force
// (RM-38 WP 3.1).
//
// WHY THIS FILE EXISTS AT ALL. Before WP 3.1 there was exactly one candidate — the `DATA_DIR` cache
// — and `resolve.ts` ran the checks inline. WP 3.1 adds a second candidate (a freshly downloaded
// pack, staged on disk), and the one thing that must NOT happen is a second, slightly different
// answer to "is this pack acceptable?". A fetched pack that a cached pack would have been refused
// for is a hole in D-DP5 that no test would name, because both sides would be green against their
// own copy of the rule. So the checks moved here and BOTH rungs call this. `resolve.ts` is now a
// caller, not a second implementation.
//
// THE FIVE REFUSALS, AND WHERE EACH ONE IS ACTUALLY DECIDED
// --------------------------------------------------------
//   1. `unsupported_schema_version` — `loadDataPack`, step 2.
//   2. `digest_mismatch`           — `loadDataPack`, step 3 (`verifyManifestDigests`, both directions).
//   3. `schema_violation`          — `loadDataPack`, steps 1/4/5/6 (JSON Schema, the compiled-in zod
//                                    contracts, and the D-DP9 regex compilation).
//   4. `version_regression`        — HERE, `comparePackVersions` against the pack in force.
//   5. `rule_ledger_not_append_only` — HERE, `checkSecurityRuleLedger` against the BUNDLED registry.
//
// So this module owns 4 and 5 and DELEGATES 1–3 rather than re-deriving them. That split is the
// point: a refusal has one implementation wherever it lives.
//
// A NAMING NOTE, because the WP spec and the code disagree and the code is right. The spec's teeth
// call these `schema_invalid`, `downgrade` and `rule_ledger_regression`. The wire names are
// `schema_violation`, `version_regression` and `rule_ledger_not_append_only` — frozen in
// `DATA_PACK_REFUSAL_REASONS` since WP 1.1 and consumed by WP 1.2 and WP 2.1. Renaming a frozen
// contract tuple to match a prose shorthand would be a breaking change bought with nothing.
//
// ORDER. Refusals 1–3 run first (they are `loadDataPack`'s, and an unreadable pack has no version
// to compare). Then the rule-ledger check, then the version comparison — deliberately in THAT
// order, which WP 2.1 chose and this module preserves byte-for-byte: a pack that renames a security
// rule id is refused whether or not it is newer, and reporting it as "not newer" would name the
// wrong problem to the operator who has to fix it.

import {
  checkSecurityRuleLedger,
  checkSecurityRuleSet,
  checkSecuritySeverityBump,
  comparePackVersions,
  type DataPackRefusal,
} from "@mcp-token-footprint/shared";
import type { DataPackFs } from "./fs.js";
import { type DataPackOrigin, loadDataPack, type ResolvedDataPack } from "./loader.js";

/** The one path every security-registry refusal names, so a log line points at the file to fix. */
const SECURITY_RULES_PATH = "security/rules.json";

export type CandidateVerification =
  | { ok: true; pack: ResolvedDataPack }
  | { ok: false; refusal: DataPackRefusal };

/**
 * The three cross-pack security checks a CANDIDATE must pass before it can replace the registry
 * shipped in the image (RM-38 WP 2.1, D-DP6/D-DP7). Returns a refusal, or `null` when it is safe.
 *
 * WHAT THEY ARE FOR, in one sentence: the `no-new-security-findings` CI gate identifies a finding by
 * `(ruleId, anchor)` and decides pass or fail on a severity floor, so a fetched file that renamed an
 * id or lowered a severity would change somebody else's pipeline verdict with no code change
 * anywhere.
 *
 * WHAT THEY CANNOT SEE: anything about the SIGNATURE lists. A pack that removes an injection phrase
 * is not refused — that is a legitimate reason to publish a pack, and it is why the ledger and the
 * severity rule guard the rule REGISTRY specifically rather than the pack as a whole.
 */
export function checkCandidateSecurityRegistry(
  candidate: ResolvedDataPack,
  bundled: ResolvedDataPack,
): DataPackRefusal | null {
  const doc = candidate.documents.securityRulesDoc;
  const bundledTables = bundled.documents.securityTables;

  const ledger = checkSecurityRuleLedger(doc.idLedger, bundledTables.idLedger);
  if (ledger) {
    return {
      reason: "rule_ledger_not_append_only",
      detail: ledger.reason,
      paths: [SECURITY_RULES_PATH],
    };
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

/**
 * Verify one candidate pack directory, whole, against the pack in force.
 *
 * `inForce` is what the candidate must be strictly NEWER than (refusal 4). `bundled` is what the
 * security rule-id ledger is compared against (refusal 5) — and those are deliberately two
 * parameters rather than one. D-DP6 anchors the ledger on the registry that SHIPPED IN THE IMAGE,
 * which is a fixed, code-reviewed baseline; anchoring it on whatever happens to be in force would
 * let a chain of packs walk the ledger anywhere one small append at a time. On the cache rung the
 * two arguments happen to be the same object; on the fetch rung, after a cache has already been
 * installed, they are not, and that is exactly when the distinction earns its keep.
 */
export function verifyCandidatePack(args: {
  dir: string;
  origin: DataPackOrigin;
  inForce: ResolvedDataPack;
  bundled: ResolvedDataPack;
  fs?: DataPackFs;
}): CandidateVerification {
  const loaded = loadDataPack({ dir: args.dir, origin: args.origin, fs: args.fs });
  if (!loaded.ok) return { ok: false, refusal: loaded.refusal };

  const registryRefusal = checkCandidateSecurityRegistry(loaded.pack, args.bundled);
  if (registryRefusal !== null) return { ok: false, refusal: registryRefusal };

  const order = comparePackVersions(
    loaded.pack.manifest.packVersion,
    args.inForce.manifest.packVersion,
  );
  if (order !== 1) {
    return {
      ok: false,
      refusal: {
        reason: "version_regression",
        detail:
          `Candidate pack ${loaded.pack.manifest.packVersion} is not newer than the ` +
          `${args.inForce.origin} pack ${args.inForce.manifest.packVersion}` +
          `${order === null ? " (and one of the two versions is unorderable)" : ""}; ` +
          `keeping the ${args.inForce.origin} pack.`,
      },
    };
  }

  return { ok: true, pack: loaded.pack };
}
