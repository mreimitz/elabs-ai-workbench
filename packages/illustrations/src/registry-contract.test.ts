// ==================================================================================================
// The registry version guard (D-IL12, amended 2026-08-21) — the rule, with teeth
// ==================================================================================================
// Until this file existed, "bump `REGISTRY_VERSION` when an entry's contract breaks" was a doc
// comment. NOTHING would have noticed a port being renamed and shipped, and the only person who
// would ever find out is whoever opened a saved scene six months later and found a connector
// attached to a port that no longer exists.
//
// The logic lives next door in `registry-contract.ts`; this file is the GUARD. It does three things:
//
//   1. compares the live catalog against the checked-in snapshot and fails on an unbumped break;
//   2. pins the CLASSIFICATION — including, at least as importantly, the cases that must stay
//      QUIET. A guard nobody has watched fail is a guard nobody knows works; a guard nobody has
//      watched stay quiet is a guard people learn to regenerate without reading;
//   3. holds the snapshot to watching the scene-visible contract and nothing cosmetic.
//
// REGENERATING. `ILLUS_UPDATE_REGISTRY_SNAPSHOT=1` rewrites the snapshot — but only when the diff is
// additive, or when the version really did move. It will NOT write over an unbumped breaking change:
// a guard you can silence by re-running it with a flag is not a guard.

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  type ContractEntry,
  type ContractSnapshot,
  contractBreaks,
  contractSnapshotOf,
  explainBreaks,
  isVersionAfter,
} from "./registry-contract.js";
import { ILLUSTRATION_REGISTRY, REGISTRY_VERSION } from "./registry.js";

const SNAPSHOT_PATH = fileURLToPath(new URL("./registry-contract.snapshot.json", import.meta.url));

const stored = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as ContractSnapshot;
const live = contractSnapshotOf(ILLUSTRATION_REGISTRY, REGISTRY_VERSION);
const breaks = contractBreaks(stored.entries, live.entries);
const bumped = isVersionAfter(REGISTRY_VERSION, stored.registryVersion);

if (process.env.ILLUS_UPDATE_REGISTRY_SNAPSHOT === "1" && (breaks.length === 0 || bumped)) {
  writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(live, null, 2)}\n`);
}

describe("the registry version guard (D-IL12, amended)", () => {
  it("has not broken an existing entry's contract without moving REGISTRY_VERSION", () => {
    if (breaks.length === 0 || bumped) return;
    assert.fail(explainBreaks(breaks, stored.registryVersion, REGISTRY_VERSION));
  });

  it("keeps the snapshot honest about what it was taken at", () => {
    assert.match(stored.registryVersion, /^\d+\.\d+\.\d+$/);
    assert.ok(
      !isVersionAfter(stored.registryVersion, REGISTRY_VERSION),
      "the snapshot claims a version the registry has never reached",
    );
  });
});

describe("the guard classifies a diff, rather than merely comparing bytes", () => {
  const base: ContractEntry[] = [
    { id: "thing", ports: ["in", "out"], variants: ["a"], states: ["idle"], sizes: ["m"] },
  ];
  const only = base[0] as ContractEntry;

  // ── The non-events. This is the half most snapshot guards get wrong: they fire, everybody
  // regenerates, and by the time a real break lands the regeneration is muscle memory.

  it("stays quiet when a whole entry is ADDED — a scene cannot reference an id that did not exist", () => {
    assert.deepEqual(
      contractBreaks(base, [
        ...base,
        { id: "newcomer", ports: ["in"], variants: [], states: ["idle"], sizes: ["m"] },
      ]),
      [],
    );
  });

  it("stays quiet when a port is ADDED to an existing entry", () => {
    assert.deepEqual(contractBreaks(base, [{ ...only, ports: ["in", "out", "side"] }]), []);
  });

  it("stays quiet when a variant, state or size is ADDED", () => {
    assert.deepEqual(
      contractBreaks(base, [
        { ...only, variants: ["a", "b"], states: ["error", "idle"], sizes: ["m", "s"] },
      ]),
      [],
    );
  });

  // ── The real breaks.

  it("FAILS when a port is renamed — the old name's loss is what a saved scene trips over", () => {
    assert.deepEqual(contractBreaks(base, [{ ...only, ports: ["in", "result"] }]), [
      { id: "thing", field: "ports", lost: ["out"] },
    ]);
  });

  it("FAILS when a variant is dropped", () => {
    assert.deepEqual(contractBreaks(base, [{ ...only, variants: [] }]), [
      { id: "thing", field: "variants", lost: ["a"] },
    ]);
  });

  it("FAILS when a state or a size is dropped", () => {
    assert.deepEqual(contractBreaks(base, [{ ...only, states: [], sizes: [] }]), [
      { id: "thing", field: "states", lost: ["idle"] },
      { id: "thing", field: "sizes", lost: ["m"] },
    ]);
  });

  it("FAILS when an entry disappears entirely", () => {
    assert.deepEqual(contractBreaks(base, []), [{ id: "thing", field: "entry", lost: ["thing"] }]);
  });

  it("names the entity, the field and what disappeared, and says what to do about it", () => {
    const message = explainBreaks([{ id: "mcp-server", field: "ports", lost: ["bus"] }], "0.1.0");
    assert.match(message, /"mcp-server" lost port "bus"/);
    assert.match(message, /REGISTRY_VERSION must move/);
    assert.match(message, /Adding an entity, port, variant or state is NOT breaking/);
  });

  it("treats a bump as a plain triple comparison", () => {
    assert.ok(isVersionAfter("0.2.0", "0.1.0"));
    assert.ok(isVersionAfter("1.0.0", "0.9.9"));
    assert.ok(isVersionAfter("0.1.1", "0.1.0"));
    assert.ok(!isVersionAfter("0.1.0", "0.1.0"));
    assert.ok(!isVersionAfter("0.1.0", "0.2.0"));
  });
});

describe("the snapshot watches the scene-visible contract, and deliberately nothing else", () => {
  it("records exactly id + ports + variants + states + sizes", () => {
    for (const entry of live.entries) {
      assert.deepEqual(Object.keys(entry).sort(), ["id", "ports", "sizes", "states", "variants"]);
    }
  });

  it("carries no cosmetic field, so improving a description cannot fire the guard", () => {
    const serialized = JSON.stringify(live.entries);
    for (const cosmetic of ["title", "description", "keywords", "tier", "entity", "since"]) {
      assert.ok(!serialized.includes(`"${cosmetic}":`), `the snapshot leaked ${cosmetic}`);
    }
  });

  it("covers every entry the catalog publishes", () => {
    assert.deepEqual(
      live.entries.map((entry) => entry.id),
      [...ILLUSTRATION_REGISTRY.map((entry) => entry.id)].sort(),
    );
  });
});
