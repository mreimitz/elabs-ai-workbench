// ==================================================================================================
// Reading a scene fixture — one path resolution, used by both scene tests
// ==================================================================================================
// Test-only, and deliberately NOT exported from `scene/index.ts`: `node:fs` has no business in the
// package's public surface, which `apps/web` bundles.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HERE = new URL(".", import.meta.url);

/** The positive scene fixtures this package ships, by file stem. */
export function readSceneFixture(name: string): unknown {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`fixtures/${name}.scene.json`, HERE)), "utf8"));
}

/**
 * The band-grammar exemplar from the roadmap item, read from `planning/` rather than copied here.
 *
 * It is a NEGATIVE fixture and its own `$comment` says why: it is a draft, written before the
 * catalog existed, and it names nine components that were never built. Copying it into the package
 * would let the copy drift from the document the roadmap reviews, and the whole point of the test is
 * that THAT file — the one somebody edits when the loop grammar changes — still reports exactly the
 * nine things it is known to get wrong.
 */
export function readRunFlowExemplar(): unknown {
  return JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL(
          "../../../../planning/Roadmap/RM-14-illustrations/examples/run-flow.scene.json",
          HERE,
        ),
      ),
      "utf8",
    ),
  );
}
