import {
  ILLUSTRATION_REGISTRY_VERSION,
  ILLUSTRATION_SIZES,
  illustrationRegistryEntrySchema,
  illustrationRegistrySchema,
} from "@mcp-token-footprint/shared";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ILLUSTRATION_CAST_MODULES,
  ILLUSTRATION_COMPONENTS,
  ILLUSTRATION_REGISTRY,
  REGISTRY_VERSION,
  assertCastIdsUnique,
  castIdCollisions,
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

  it("publishes exactly the cast the four modules declare, and nothing else", () => {
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

// ── The cast-module seam (WP 1.1) ────────────────────────────────────────────────────────────────
// The sentence the seam exists to make true: ADDING AN ENTITY TOUCHES ITS OWN FILE AND ITS OWN CAST
// MODULE, AND NOTHING ELSE. Written here as three assertions, because a sentence in a comment is not
// a guard — and because the whole reason for the seam is that WP 1.2 and WP 1.3 run in parallel
// worktrees, where the first thing a shared file does is collide.

describe("the cast-module seam — one way to be in the catalog (WP 1.1)", () => {
  const REGISTRY_SOURCE = readFileSync(fileURLToPath(new URL("./registry.ts", import.meta.url)));

  it("declares the four cast modules the plan names, and only those", () => {
    assert.deepEqual(Object.keys(ILLUSTRATION_CAST_MODULES).sort(), [
      "assets",
      "orchestration",
      "pilot",
      "runtime",
    ]);
  });

  it("keeps WP 1.2's and WP 1.3's modules committed and exported, even while empty", () => {
    // Empty is the point. A module that already exists and is already imported is what makes two
    // branches conflict-free; a module each of them CREATES is the same conflict, one file over.
    assert.ok(Array.isArray(ILLUSTRATION_CAST_MODULES.assets));
    assert.ok(Array.isArray(ILLUSTRATION_CAST_MODULES.orchestration));
  });

  it("derives BOTH exports from the concatenation, so neither can drift from the cast", () => {
    const cast = Object.values(ILLUSTRATION_CAST_MODULES).flat();
    assert.deepEqual(
      ILLUSTRATION_REGISTRY.map((entry) => entry.id).sort(),
      cast.map((member) => member.meta.id).sort(),
    );
    assert.deepEqual(
      Object.keys(ILLUSTRATION_COMPONENTS).sort(),
      cast.map((member) => member.meta.id).sort(),
    );
    for (const member of cast) {
      assert.equal(
        ILLUSTRATION_COMPONENTS[member.meta.id],
        member.component,
        `${member.meta.id} resolves to a component its cast module did not supply`,
      );
    }
  });

  it("names no entity of its own — a new component never edits this file", () => {
    // The mechanical form of the sentence above. `registry.ts` may import cast modules and support
    // types; the moment it imports `./entities/Something.js` it is a shared file again.
    const entityImports = [...REGISTRY_SOURCE.toString().matchAll(/from "\.\/entities\/([^"]+)"/g)]
      .map((match) => match[1] as string)
      .filter((specifier) => !/^(cast-|entity-)/.test(specifier));
    assert.deepEqual(entityImports, [], "registry.ts imports an entity file directly");
  });
});

describe("the cast-module seam — a duplicate id fails LOUDLY at load (WP 1.1)", () => {
  const member = ILLUSTRATION_CAST_MODULES.pilot?.[0];
  assert.ok(member, "the pilot cast is empty, so there is nothing to duplicate");

  it("finds no collision in the shipped cast", () => {
    assert.deepEqual(castIdCollisions(ILLUSTRATION_CAST_MODULES), []);
    assert.doesNotThrow(() => assertCastIdsUnique(ILLUSTRATION_CAST_MODULES));
  });

  it("reports WHICH two modules claimed an id, not merely that one repeated", () => {
    // The scenario this exists for: two work packages, in two worktrees, independently pick `run`.
    // Zod's own duplicate-id refinement would reject it too, but it can only say an id appeared
    // twice — the module names are what tells the second branch whose id it is standing on.
    const clash = { runtime: [member], orchestration: [member] };
    assert.deepEqual(castIdCollisions(clash), [
      { id: member.meta.id, modules: ["runtime", "orchestration"] },
    ]);
    assert.throws(() => assertCastIdsUnique(clash), {
      message: new RegExp(`"${member.meta.id}" is claimed by runtime and orchestration`),
    });
  });

  it("would let one component silently win the component map if it did not throw", () => {
    // Why this guard is not redundant with the schema's uniqueness refinement: the COMPONENT map is
    // an object, and an object keyed by a repeated id keeps exactly one entry with no error at all.
    const map = Object.fromEntries(
      [member, { ...member, component: ILLUSTRATION_COMPONENTS.agent }].map((candidate) => [
        candidate.meta.id,
        candidate.component,
      ]),
    );
    assert.equal(Object.keys(map).length, 1, "a duplicate id is invisible to a Record");
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
