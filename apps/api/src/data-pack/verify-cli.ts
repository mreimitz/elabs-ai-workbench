// CLI: judge a STAGED pack directory with the app's own verifier, before anybody publishes it
// (RM-38 WP 3.3).
//
//     tsx src/data-pack/verify-cli.ts <staged-pack-dir> [--baseline <dir>]
//
// WHY THIS EXISTS. `pnpm build:data-pack` seals a pack — it writes the manifest and its digests. It
// does not, and should not, know whether a RUNNING container would accept the result. Those are two
// different questions, and the second one is the only one that matters at publish time: publishing
// a pack the fleet refuses is the failure this whole work package exists to make impossible to ship
// unnoticed.
//
// So this runs the real thing. Not a re-implementation, not a subset: `verifyCandidatePack` is the
// same function `resolve.ts` calls for a cached pack and `fetcher.ts` calls for a downloaded one,
// with the same `bundled` anchor for the D-DP6 rule-id ledger. If it says no here, every install
// says no.
//
// TWO OUTCOMES, AND ONLY ONE OF THEM IS A FAILURE
// -----------------------------------------------
//   - REFUSED for a data reason (digest, schema, layout version, rule-id ledger) → exit 1. The pack
//     is broken and must not be published.
//   - REFUSED as `version_regression` → exit 0 with a NOTE. It is not broken; it is simply not
//     newer than the baseline pack, so a container running that pack would answer
//     `up_to_date` and never download it. That is the normal state of a re-seal with no bump, and
//     treating it as a failure would make the script cry wolf on the most common invocation.
//
// The distinction is drawn on the refusal's own typed `reason`, never on a string match against its
// detail sentence.

import path from "node:path";
import { loadDataPack } from "./loader.js";
import { findBundledPackDir } from "./resolve.js";
import { verifyCandidatePack } from "./verify.js";

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function main(): void {
  const args = process.argv.slice(2);
  const target = args[0];
  if (!target || target.startsWith("--")) fail("usage: verify-cli.ts <staged-pack-dir> [--baseline <dir>]");
  const dir = path.resolve(target);

  const flagIndex = args.indexOf("--baseline");
  const baselineArg = flagIndex === -1 ? undefined : args[flagIndex + 1];
  if (flagIndex !== -1 && !baselineArg) fail("--baseline needs a directory");

  // THE BASELINE IS THE POINT OF THIS TOOL, AND GETTING IT WRONG MAKES THE TOOL LIE.
  //
  // Two of the checks below — the D-DP6 rule-id ledger and the version ordering — are COMPARISONS.
  // Compared against the tree the candidate was just sealed from, both are vacuous: a pack always
  // has the same rule ids as itself and is never newer than itself. The first cut of this CLI did
  // exactly that (it defaulted to `<repo root>/data-pack`) and reported "not newer than 1.2.0"
  // about the very bytes it had just staged — a true sentence about a meaningless comparison.
  //
  // So the caller passes the baseline explicitly: `publish-data-pack.sh` materializes the pack as
  // COMMITTED AT HEAD, which is what the last built image ships and therefore what an installed
  // container is actually running. Without `--baseline` this falls back to `findBundledPackDir`,
  // which under `tsx` from a checkout is the working tree — useful only for a structural check, and
  // it says so rather than pretending the comparison meant something.
  let baselineDir: string;
  let baselineIsSelf = false;
  if (baselineArg) {
    baselineDir = path.resolve(baselineArg);
  } else {
    const found = findBundledPackDir(import.meta.dirname);
    if (!found.dir) fail(`no baseline pack found; looked in: ${found.searched.join(", ")}`);
    baselineDir = found.dir;
    baselineIsSelf = path.resolve(baselineDir) === dir;
  }

  const bundled = loadDataPack({ dir: baselineDir, origin: "bundled" });
  if (!bundled.ok) {
    fail(`the BASELINE pack at ${baselineDir} is itself invalid: ${bundled.refusal.detail}`);
  }
  if (baselineIsSelf) {
    process.stdout.write(
      "note: the baseline IS the staged tree, so the ledger and version comparisons below cannot " +
        "fail. Pass --baseline <committed-pack-dir> for a meaningful comparison.\n",
    );
  }

  const verified = verifyCandidatePack({
    dir,
    origin: "fetched",
    inForce: bundled.pack,
    bundled: bundled.pack,
  });

  if (verified.ok) {
    const m = verified.pack.manifest;
    process.stdout.write(
      `pack ${m.packVersion} (schema ${m.schemaVersion}, as-of ${m.asOf}, ${m.files.length} files) ` +
        `VERIFIED by the app's own verifier — a container on this build would install it\n`,
    );
    return;
  }

  if (verified.refusal.reason === "version_regression") {
    process.stdout.write(
      `pack staged and structurally valid, but NOT NEWER than the baseline pack ` +
        `${bundled.pack.manifest.packVersion}: ${verified.refusal.detail}\n` +
        "  → a container on this build would answer `up_to_date` and never download it.\n" +
        "  → bump the version (--bump patch|minor|major) if this pack is meant to go live.\n",
    );
    return;
  }

  fail(
    `pack REFUSED (${verified.refusal.reason}): ${verified.refusal.detail}\n` +
      "This pack must not be published — every install would refuse it for the same reason.",
  );
}

main();
