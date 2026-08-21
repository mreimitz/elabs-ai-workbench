// ==================================================================================================
// The registry version contract (D-IL12, amended 2026-08-21) — what a scene can actually reference
// ==================================================================================================
// `REGISTRY_VERSION` is a FLAG-DON'T-BREAK compatibility marker, stamped into every authored scene
// spec, doing for scenes what `TOKEN_COUNTING_VERSION` does for scans. It answers one question: can a
// scene written against version V still be trusted against the registry as it stands today?
//
// Which makes "when does it move" a question about what a scene can REFERENCE BY VALUE — and that is
// exactly five things per entry: its id, its port names, its variants, its states and its sizes.
// Lose or rename one of those and a saved scene resolves against something that is not there. Add
// one and nothing that already exists can possibly notice.
//
// This module is that reasoning as pure functions, so `registry-contract.test.ts` can be the GUARD
// rather than also being the logic. Nothing here reads a file or knows about the test runner.
//
// Deliberately NOT watched: title, description, keywords, tier, entity, since. They are cosmetic —
// a guard that fired when somebody improved a description is a guard people learn to silence, and a
// flag that fires on non-events is a flag nobody reads. That is the whole argument of the amendment.

import { ILLUSTRATION_REGISTRY_VERSION, type IllustrationRegistryEntry } from "@mcp-token-footprint/shared";

/** The four member sets a scene spec can reference by value, beside the entry's id. */
export const CONTRACT_FIELDS = ["ports", "variants", "states", "sizes"] as const;
export type ContractField = (typeof CONTRACT_FIELDS)[number];

export type ContractEntry = { id: string } & Record<ContractField, string[]>;

export type ContractSnapshot = {
  /** A pointer for whoever opens the JSON first. Not read by the guard. */
  about?: string;
  /** The `REGISTRY_VERSION` the snapshot was taken at. */
  registryVersion: string;
  entries: ContractEntry[];
};

export type ContractBreak = {
  id: string;
  field: ContractField | "entry";
  lost: string[];
};

/**
 * One entry's scene-visible contract.
 *
 * Sorted everywhere, so a diff is a real change and never an author reordering a literal. `ports` is
 * reduced to its KEYS, because the key is the name a connector writes (`nodeId.port`); a port's
 * `title` is a label and its `side` is a routing hint, and a scene names neither.
 */
export function contractOf(entry: IllustrationRegistryEntry): ContractEntry {
  return {
    id: entry.id,
    ports: Object.keys(entry.ports).sort(),
    variants: [...entry.variants].sort(),
    states: [...entry.states].sort(),
    sizes: [...entry.sizes].sort(),
  };
}

/** The whole catalog's contract, in id order — the shape held in the checked-in snapshot. */
export function contractSnapshotOf(
  registry: readonly IllustrationRegistryEntry[],
  registryVersion: string,
): ContractSnapshot {
  return {
    about:
      "The scene-visible contract of every registry entry, guarded by registry-contract.test.ts. " +
      "Losing or renaming an id/port/variant/state/size here without moving REGISTRY_VERSION fails " +
      "the gate; adding one is quiet. Regenerate with ILLUS_UPDATE_REGISTRY_SNAPSHOT=1. See " +
      "CHANGELOG.md.",
    registryVersion,
    entries: registry.map(contractOf).sort((left, right) => left.id.localeCompare(right.id)),
  };
}

/** `0.1.0` < `0.2.0` < `1.0.0`. A registry version is a plain, comparable triple by construction. */
export function isVersionAfter(candidate: string, baseline: string): boolean {
  const parse = (value: string) => value.split(".").map(Number);
  const [a = 0, b = 0, c = 0] = parse(candidate);
  const [x = 0, y = 0, z = 0] = parse(baseline);
  if (a !== x) return a > x;
  if (b !== y) return b > y;
  return c > z;
}

/**
 * Everything the live catalog LOST relative to the snapshot.
 *
 * Additions are not returned at all — not as a second list, not as a "note". They are not findings,
 * and collecting them would only invite somebody to report them, which is how a guard starts firing
 * on non-events. An ENTRY that disappeared is reported as `field: "entry"`, because removing a
 * component breaks a saved scene exactly as thoroughly as removing one of its ports.
 *
 * A RENAME needs no special handling and gets none: it is a removal plus an addition, and the
 * removal is the half a stale scene trips over.
 */
export function contractBreaks(
  before: readonly ContractEntry[],
  after: readonly ContractEntry[],
): ContractBreak[] {
  const live = new Map(after.map((entry) => [entry.id, entry]));
  const breaks: ContractBreak[] = [];

  for (const previous of before) {
    const current = live.get(previous.id);
    if (!current) {
      breaks.push({ id: previous.id, field: "entry", lost: [previous.id] });
      continue;
    }
    for (const field of CONTRACT_FIELDS) {
      const present = new Set(current[field]);
      const lost = previous[field].filter((member) => !present.has(member));
      if (lost.length > 0) breaks.push({ id: previous.id, field, lost });
    }
  }
  return breaks;
}

/** The sentence somebody who has never read any of this needs in order to act on a red gate. */
export function explainBreaks(
  breaks: readonly ContractBreak[],
  snapshotVersion: string,
  liveVersion: string = ILLUSTRATION_REGISTRY_VERSION,
): string {
  const detail = breaks
    .map(({ id, field, lost }) =>
      field === "entry"
        ? `  • the entry "${id}" was REMOVED from the catalog`
        : `  • "${id}" lost ${field.replace(/s$/, "")}${lost.length > 1 ? "s" : ""} ${lost
            .map((member) => `"${member}"`)
            .join(", ")}`,
    )
    .join("\n");

  return [
    "an EXISTING registry entry's scene-visible contract moved, and REGISTRY_VERSION did not:",
    detail,
    "",
    `The snapshot was taken at ${snapshotVersion}; the registry still says ${liveVersion}.`,
    "A scene authored earlier resolves these by value, so one of two things is true:",
    "",
    "  1. the change is wrong — restore the name (a rename reads here as a loss plus an addition,",
    "     and the loss is the half a saved scene trips over); or",
    "  2. the change is intended, and REGISTRY_VERSION must move in",
    "     packages/shared/src/illustration-registry.ts, so every stored scene is FLAGGED rather",
    "     than silently mis-rendered.",
    "",
    "Adding an entity, port, variant or state is NOT breaking and needs no bump — regenerate with",
    "  ILLUS_UPDATE_REGISTRY_SNAPSHOT=1 pnpm --filter @mcp-token-footprint/illustrations test",
    "(which refuses to write while a break like the above is unresolved).",
  ].join("\n");
}
