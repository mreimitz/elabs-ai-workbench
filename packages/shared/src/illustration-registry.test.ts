import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ILLUSTRATION_CONNECTOR_KINDS,
  ILLUSTRATION_DETAIL_LEVELS,
  ILLUSTRATION_FACINGS,
  ILLUSTRATION_PORT_SIDES,
  ILLUSTRATION_REGISTRY_VERSION,
  ILLUSTRATION_SIZES,
  ILLUSTRATION_STATES,
  ILLUSTRATION_TIERS,
  type IllustrationRegistryEntry,
  illustrationRegistryEntrySchema,
  illustrationRegistrySchema,
  illustrationVersionSchema,
} from "./illustration-registry.js";

// WP 0.1's contract has no behavior to test — it draws nothing and registers nothing — so these
// tests are its TEETH instead: they pin the closed sets member by member (D-IL8), pin that
// `.strict()` actually rejects an unknown key, and pin the two invariants the schema adds beyond
// shape (`idle` is mandatory, at least one port exists). Deleting a member from any vocabulary below
// turns one of these red, which is the whole reason to write the members out a second time by hand.

/**
 * Written out by hand, deliberately not derived from the exported array. A closed grammar that is
 * only ever compared against itself is not pinned to anything — this is the second opinion.
 */
const FROZEN_STATES = ["idle", "active", "highlight", "dimmed", "error"];
const FROZEN_CONNECTOR_KINDS = ["flow", "read", "write", "publish", "loop", "signal"];
const FROZEN_SIZES = ["s", "m", "l"];
const FROZEN_DETAIL_LEVELS = ["silhouette", "standard", "cutaway"];
const FROZEN_FACINGS = ["upstream", "downstream"];
const FROZEN_PORT_SIDES = ["top", "bottom", "left", "right"];

/** A complete, valid entry — the fixture every rejection test below mutates one field of. */
const VALID_ENTRY: IllustrationRegistryEntry = {
  id: "mcp-server",
  title: "MCP Server",
  entity: "mcp_servers",
  tier: 1,
  keywords: ["server", "tools", "stdio", "http"],
  variants: ["stdio", "streamable-http"],
  states: ["idle", "active", "highlight", "dimmed", "error"],
  ports: {
    top: { title: "Top", side: "top" },
    bus: { title: "Tool bus", side: "right", offset: 1.5 },
  },
  sizes: ["s", "m", "l"],
  since: "0.1.0",
  description: "An MCP server rack: the tool surface an agent connects to.",
};

describe("illustration registry — closed vocabularies (D-IL8)", () => {
  it("freezes the five entity states, in order", () => {
    assert.deepEqual([...ILLUSTRATION_STATES], FROZEN_STATES);
  });

  it("freezes the six connector kinds, in order", () => {
    assert.deepEqual([...ILLUSTRATION_CONNECTOR_KINDS], FROZEN_CONNECTOR_KINDS);
  });

  it("freezes the three quantized sizes", () => {
    assert.deepEqual([...ILLUSTRATION_SIZES], FROZEN_SIZES);
  });

  it("freezes the three detail levels (D-IL16)", () => {
    assert.deepEqual([...ILLUSTRATION_DETAIL_LEVELS], FROZEN_DETAIL_LEVELS);
  });

  it("freezes the two facings, upstream first because it is the default (D-IL17)", () => {
    assert.deepEqual([...ILLUSTRATION_FACINGS], FROZEN_FACINGS);
    assert.equal(ILLUSTRATION_FACINGS[0], "upstream");
  });

  it("freezes the four port sides (D-IL7)", () => {
    assert.deepEqual([...ILLUSTRATION_PORT_SIDES], FROZEN_PORT_SIDES);
  });

  it("freezes the three tiers", () => {
    assert.deepEqual([...ILLUSTRATION_TIERS], [1, 2, 3]);
  });

  it("carries a parseable registry version (D-IL9)", () => {
    assert.equal(illustrationVersionSchema.safeParse(ILLUSTRATION_REGISTRY_VERSION).success, true);
  });
});

describe("illustrationRegistryEntrySchema — round trip", () => {
  it("parses a complete entry unchanged", () => {
    const parsed = illustrationRegistryEntrySchema.parse(VALID_ENTRY);
    assert.deepEqual(parsed, VALID_ENTRY);
  });

  it("accepts a null entity for an abstract component", () => {
    const parsed = illustrationRegistryEntrySchema.parse({ ...VALID_ENTRY, entity: null });
    assert.equal(parsed.entity, null);
  });

  it("accepts an entry with no variants", () => {
    assert.equal(
      illustrationRegistryEntrySchema.safeParse({ ...VALID_ENTRY, variants: [] }).success,
      true,
    );
  });
});

describe("illustrationRegistryEntrySchema — rejections", () => {
  it("rejects an unknown key (.strict())", () => {
    const result = illustrationRegistryEntrySchema.safeParse({
      ...VALID_ENTRY,
      colour: "green",
    });
    assert.equal(result.success, false);
  });

  it("accepts every frozen state and rejects one that is not in the set", () => {
    for (const state of FROZEN_STATES) {
      const states = state === "idle" ? ["idle"] : ["idle", state];
      assert.equal(
        illustrationRegistryEntrySchema.safeParse({ ...VALID_ENTRY, states }).success,
        true,
        `expected the frozen state ${state} to be accepted`,
      );
    }
    for (const state of ["pulsing", "Idle", "hover"]) {
      assert.equal(
        illustrationRegistryEntrySchema.safeParse({ ...VALID_ENTRY, states: ["idle", state] })
          .success,
        false,
        `expected the unknown state ${state} to be rejected`,
      );
    }
  });

  it("rejects an entry that does not implement the default idle state", () => {
    const result = illustrationRegistryEntrySchema.safeParse({
      ...VALID_ENTRY,
      states: ["active", "error"],
    });
    assert.equal(result.success, false);
  });

  it("rejects an entry with no ports (D-IL7)", () => {
    assert.equal(
      illustrationRegistryEntrySchema.safeParse({ ...VALID_ENTRY, ports: {} }).success,
      false,
    );
  });

  it("rejects an unknown port side", () => {
    const result = illustrationRegistryEntrySchema.safeParse({
      ...VALID_ENTRY,
      ports: { top: { title: "Top", side: "front" } },
    });
    assert.equal(result.success, false);
  });

  it("rejects a tier outside the closed set", () => {
    for (const tier of [0, 4, 1.5]) {
      assert.equal(
        illustrationRegistryEntrySchema.safeParse({ ...VALID_ENTRY, tier }).success,
        false,
        `expected tier ${tier} to be rejected`,
      );
    }
  });

  it("rejects a non-kebab component id", () => {
    for (const id of ["MCP-Server", "mcp_server", "mcp--server", "-mcp", ""]) {
      assert.equal(
        illustrationRegistryEntrySchema.safeParse({ ...VALID_ENTRY, id }).success,
        false,
        `expected the id ${JSON.stringify(id)} to be rejected`,
      );
    }
  });

  it("rejects a non-snake entity binding, but never touches ASSISTANT_ENTITY_KINDS", () => {
    assert.equal(
      illustrationRegistryEntrySchema.safeParse({ ...VALID_ENTRY, entity: "MCP Servers" }).success,
      false,
    );
    // A domain name this contract has never heard of still parses: the binding is by NAME, and the
    // frozen assistant write-scope vocabulary is deliberately not consulted (D-AO3).
    assert.equal(
      illustrationRegistryEntrySchema.safeParse({ ...VALID_ENTRY, entity: "future_table" }).success,
      true,
    );
  });

  it("rejects a since that is not a plain version triple", () => {
    assert.equal(
      illustrationRegistryEntrySchema.safeParse({ ...VALID_ENTRY, since: "0.1" }).success,
      false,
    );
  });

  it("rejects duplicate members in a closed-set list", () => {
    assert.equal(
      illustrationRegistryEntrySchema.safeParse({ ...VALID_ENTRY, sizes: ["s", "s"] }).success,
      false,
    );
  });

  it("rejects an empty description, because it is the a11y text", () => {
    assert.equal(
      illustrationRegistryEntrySchema.safeParse({ ...VALID_ENTRY, description: "" }).success,
      false,
    );
  });
});

describe("illustrationRegistrySchema", () => {
  it("accepts a catalog of distinct ids", () => {
    const result = illustrationRegistrySchema.safeParse([
      VALID_ENTRY,
      { ...VALID_ENTRY, id: "skill", entity: "skills" },
    ]);
    assert.equal(result.success, true);
  });

  it("rejects the same component id twice (D-IL9 — one catalog, one entry)", () => {
    const result = illustrationRegistrySchema.safeParse([VALID_ENTRY, { ...VALID_ENTRY }]);
    assert.equal(result.success, false);
  });

  it("accepts the empty catalog WP 0.1 ships — the first entries are WP 0.3", () => {
    assert.equal(illustrationRegistrySchema.safeParse([]).success, true);
  });
});
