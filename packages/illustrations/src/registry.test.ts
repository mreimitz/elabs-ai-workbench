import {
  ILLUSTRATION_REGISTRY_VERSION,
  ILLUSTRATION_SIZES,
  illustrationRegistryEntrySchema,
  illustrationRegistrySchema,
} from "@mcp-token-footprint/shared";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ILLUSTRATION_COMPONENTS,
  ILLUSTRATION_REGISTRY,
  REGISTRY_VERSION,
  findIllustration,
  findIllustrationComponent,
  illustrationViewBox,
  searchIllustrations,
} from "./registry.js";

// D-IL9 in two halves. The ENTRY is data — portable to the API and the assistant, validated against
// the WP 0.1 schema. The COMPONENT is a second map keyed by the same id, because the entry shape
// lives in a package that must not import React. "No component ships without an entry" is therefore
// a set equality, checked in both directions, rather than a promise in a comment.

describe("registry v0.1 — the catalog", () => {
  it("is stamped at the shared registry version, not at a second copy of it", () => {
    assert.equal(REGISTRY_VERSION, ILLUSTRATION_REGISTRY_VERSION);
    assert.equal(REGISTRY_VERSION, "0.1.0");
  });

  it("publishes the three pilot entities WP 0.3 ships, and nothing else", () => {
    assert.deepEqual(ILLUSTRATION_REGISTRY.map((entry) => entry.id).sort(), [
      "agent",
      "mcp-server",
      "skill",
    ]);
  });

  it("validates against the WP 0.1 schema — every entry, and the catalog as a whole", () => {
    // The module already parsed at load; re-parsing here is what makes THIS FILE the thing that
    // goes red when an entry is edited, rather than an import somewhere far away.
    assert.doesNotThrow(() => illustrationRegistrySchema.parse(ILLUSTRATION_REGISTRY));
    for (const entry of ILLUSTRATION_REGISTRY) {
      assert.doesNotThrow(
        () => illustrationRegistryEntrySchema.parse(entry),
        `${entry.id} does not satisfy the registry-entry schema`,
      );
    }
  });

  it("orders by tier, then by title — the order the gallery lists them in", () => {
    const keys = ILLUSTRATION_REGISTRY.map((entry) => `${entry.tier}:${entry.title}`);
    assert.deepEqual(keys, [...keys].sort());
  });

  it("binds every entry to a real component, and every component to a real entry", () => {
    assert.deepEqual(
      Object.keys(ILLUSTRATION_COMPONENTS).sort(),
      ILLUSTRATION_REGISTRY.map((entry) => entry.id).sort(),
    );
  });

  it("gives every component a height function covering every size it claims", () => {
    for (const entry of ILLUSTRATION_REGISTRY) {
      const component = ILLUSTRATION_COMPONENTS[entry.id];
      assert.ok(component, `${entry.id} has no component`);
      for (const size of entry.sizes) {
        const height = component.entityHeightUnits(size);
        assert.ok(Number.isFinite(height) && height > 0, `${entry.id}/${size} has no drawn height`);
      }
    }
  });

  it("declares every entity as structure, so nothing lifts itself above the connectors (D-IL16)", () => {
    for (const entry of ILLUSTRATION_REGISTRY) {
      assert.equal(ILLUSTRATION_COMPONENTS[entry.id]?.illusLayer, "structure");
    }
  });
});

describe("registry v0.1 — the schema really is load-bearing", () => {
  // A guard nobody has watched fail is a guard nobody knows works. These are the three mistakes the
  // catalog is most likely to make, each rejected by the shape rather than by a reviewer.
  const valid = ILLUSTRATION_REGISTRY[0];

  it("rejects an entry with no ports — an entity nothing can reach is a dead end (D-IL7)", () => {
    assert.throws(() => illustrationRegistryEntrySchema.parse({ ...valid, ports: {} }));
  });

  it("rejects an entry that cannot render the default `idle` state (D-IL8)", () => {
    assert.throws(() =>
      illustrationRegistryEntrySchema.parse({ ...valid, states: ["active", "error"] }),
    );
  });

  it("rejects a stray key rather than dropping it silently (.strict())", () => {
    assert.throws(() => illustrationRegistryEntrySchema.parse({ ...valid, colour: "lime" }));
  });

  it("rejects a duplicate id across the catalog", () => {
    assert.throws(() => illustrationRegistrySchema.parse([valid, valid]));
  });
});

describe("registry v0.1 — lookups answer, never throw", () => {
  it("finds an entry and its component by id", () => {
    assert.equal(findIllustration("agent")?.title, "Agent / LLM");
    assert.ok(findIllustrationComponent("agent"));
  });

  it("returns undefined for an id it has never heard of, so a stale scene can be reported", () => {
    assert.equal(findIllustration("not-a-real-component"), undefined);
    assert.equal(findIllustrationComponent("not-a-real-component"), undefined);
    assert.equal(illustrationViewBox("not-a-real-component", "m"), undefined);
  });

  it("frames a bigger footprint in a bigger box, and always leaves the origin inside", () => {
    let previous = 0;
    for (const size of ILLUSTRATION_SIZES) {
      const box = illustrationViewBox("agent", size);
      assert.ok(box, `no view box for ${size}`);
      assert.ok(box.width > previous, "a larger footprint must get a larger frame");
      previous = box.width;
      assert.ok(box.x < 0 && box.x + box.width > 0, "the world origin fell outside the frame");
      assert.ok(box.y < 0 && box.y + box.height > 0);
      assert.equal(box.viewBox, `${box.x} ${box.y} ${box.width} ${box.height}`);
    }
  });
});

describe("registry v0.1 — catalog search (one answer for the gallery and the assistant)", () => {
  it("returns everything for an empty query", () => {
    assert.equal(searchIllustrations("   ").length, ILLUSTRATION_REGISTRY.length);
  });

  it("matches on id, title, keyword and the domain binding, case-insensitively", () => {
    assert.deepEqual(
      searchIllustrations("STDIO").map((entry) => entry.id),
      ["mcp-server"],
    );
    assert.deepEqual(
      searchIllustrations("mcp_servers").map((entry) => entry.id),
      ["mcp-server"],
    );
    assert.deepEqual(
      searchIllustrations("robot").map((entry) => entry.id),
      ["agent"],
    );
    assert.deepEqual(
      searchIllustrations("Skill").map((entry) => entry.id),
      ["skill"],
    );
  });

  it("returns nothing for a term the catalog does not carry", () => {
    assert.deepEqual(searchIllustrations("kubernetes"), []);
  });
});
