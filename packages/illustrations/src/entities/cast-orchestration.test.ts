// ==================================================================================================
// The orchestration cast — its own census, beside its own module
// ==================================================================================================
// WP 1.2 and WP 1.3 both found the same leak in WP 1.1's cast-module seam, independently, and both
// declined to fix it mid-parallel-run: the seam's claim is "adding an entity touches its own file
// and its own cast module, and nothing else", and that was true of `registry.ts` and
// `entities/index.ts` — which name no entity — but false of ONE hand-written literal in
// `registry.test.ts` that listed every id in the catalog. Two work packages in parallel worktrees
// therefore collided there by construction, and they did (the WP 1.3 rebase conflicted on exactly
// that array).
//
// This file is the fix. The census still has to be written out by hand or it stops being a census,
// but it is now written out PER MODULE, beside the module it censuses — so a work package that adds
// entities edits its own entity files, its own cast module and its own census, and nothing shared.
// `registry.test.ts` keeps the whole-catalog check, but derives it from the four modules, which is
// what makes it a check on `registry.ts` (nothing dropped, nothing invented) rather than a second
// copy of these lists.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ILLUSTRATION_ORCHESTRATION_CAST } from "./cast-orchestration.js";

describe("the orchestration cast (WP 1.3)", () => {
  it("declares exactly these ids, and nothing else", () => {
    assert.deepEqual(
      ILLUSTRATION_ORCHESTRATION_CAST.map((member) => member.meta.id).sort(),
      [
        "assistant",
        "collection",
        "credentials-vault",
        "database",
        "diff-compare",
        "environment",
        "orchestrator",
        "owner",
        "suite",
      ],
    );
  });

  it("keeps every member's component keyed to its own entry", () => {
    for (const member of ILLUSTRATION_ORCHESTRATION_CAST) {
      assert.equal(typeof member.component, "function", `${member.meta.id} has no component`);
      assert.equal(
        typeof member.component.entityHeightUnits,
        "function",
        `${member.meta.id} does not expose entityHeightUnits`,
      );
    }
  });
});
