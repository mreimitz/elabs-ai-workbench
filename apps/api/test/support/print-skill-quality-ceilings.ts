// A spawned probe: prints the RESOLVED skill-quality ceilings as JSON on stdout (RM-38 WP 2.2).
//
// It exists because `config` in `apps/api/src/config/env.ts` is built once, at module load, from
// `process.env`. A test cannot change an env override after the fact and observe it — mutating
// `process.env` inside the runner is read by nobody, and re-importing `env.js` under a cache-busting
// query yields a DIFFERENT module instance that `thresholds.ts` does not hold.
//
// So `data-pack-thresholds.test.ts` runs this in a child process with the variables set, which is
// the only way to prove the env rung behaviourally rather than by reading the source. That is worth
// one `tsx` spawn: the alternative is a guard that asserts a `??` is spelled a certain way, and this
// item's own ledger is a record of what happens when a guard measures the wrong quantity.

import { skillQualityCeilings } from "../../src/data-pack/thresholds.js";

process.stdout.write(`${JSON.stringify(skillQualityCeilings())}\n`);
