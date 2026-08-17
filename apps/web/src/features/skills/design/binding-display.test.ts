import { describe, expect, test } from "vitest";
import type { ServerType, SkillServerBinding } from "@mcp-token-footprint/shared";
import { buildBindingChips } from "./binding-display";

// Server-types WP 3.2 (A) — behaviour lock for the chip fusion: a type-resolved entry becomes a
// `type` chip carrying the type name/status + resolved representative; a plain server entry stays a
// `server` chip; a type with no scanned member surfaces a null representative (honest, never guessed);
// declared order is preserved and the tool count follows the RESOLVED server's name.

const saas: ServerType = {
  id: "t-saas",
  name: "Acme-SaaS",
  status: "production",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  memberCount: 2,
};

const stage: ServerType = {
  id: "t-stage",
  name: "acme-stage",
  status: "beta",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  memberCount: 1,
};

describe("buildBindingChips", () => {
  test("a type-resolved binding becomes a `type` chip with name, status, and representative", () => {
    const bindings: SkillServerBinding[] = [
      { serverName: "Acme-SaaS", serverId: "s-rep", typeId: "t-saas", resolvedVia: "type" },
    ];
    const chips = buildBindingChips(
      ["Acme-SaaS"],
      bindings,
      [saas],
      [{ id: "s-rep", name: "Acme Prod B" }],
      new Map([["Acme Prod B", 12]]),
    );
    expect(chips).toEqual([
      {
        kind: "type",
        name: "Acme-SaaS",
        typeId: "t-saas",
        typeName: "Acme-SaaS",
        status: "production",
        representativeId: "s-rep",
        representativeName: "Acme Prod B",
        toolCount: 12, // counted under the REPRESENTATIVE's name, not the type name
      },
    ]);
  });

  test("a type with NO scanned member → null representative (honest, never guessed)", () => {
    const bindings: SkillServerBinding[] = [
      { serverName: "acme-stage", serverId: null, typeId: "t-stage", resolvedVia: "type" },
    ];
    const chips = buildBindingChips(["acme-stage"], bindings, [stage], [], new Map());
    expect(chips).toEqual([
      {
        kind: "type",
        name: "acme-stage",
        typeId: "t-stage",
        typeName: "acme-stage",
        status: "beta",
        representativeId: null,
        representativeName: null,
        toolCount: null,
      },
    ]);
  });

  test("a plain server binding stays a `server` chip (unchanged), count keyed by its own name", () => {
    const bindings: SkillServerBinding[] = [{ serverName: "files", serverId: "s-files" }];
    const chips = buildBindingChips(
      ["files"],
      bindings,
      [saas],
      [{ id: "s-files", name: "files" }],
      new Map([["files", 5]]),
    );
    expect(chips).toEqual([{ kind: "server", name: "files", toolCount: 5 }]);
  });

  test("an unresolved plain name (no binding row / no match) stays a `server` chip with null count", () => {
    const chips = buildBindingChips(["ghost"], [], [saas], [], new Map());
    expect(chips).toEqual([{ kind: "server", name: "ghost", toolCount: null }]);
  });

  test("declared order is preserved across mixed server + type + unbound entries", () => {
    const bindings: SkillServerBinding[] = [
      { serverName: "files", serverId: "s-files" },
      { serverName: "Acme-SaaS", serverId: "s-rep", typeId: "t-saas", resolvedVia: "type" },
      { serverName: "ghost", serverId: null },
    ];
    const chips = buildBindingChips(
      ["files", "Acme-SaaS", "ghost"],
      bindings,
      [saas],
      [
        { id: "s-files", name: "files" },
        { id: "s-rep", name: "Acme Prod B" },
      ],
      new Map(),
    );
    expect(chips.map((chip) => `${chip.kind}:${chip.name}`)).toEqual([
      "server:files",
      "type:Acme-SaaS",
      "server:ghost",
    ]);
  });

  test("a type chip whose type row is missing degrades to null name/status (never throws)", () => {
    const bindings: SkillServerBinding[] = [
      { serverName: "Acme-SaaS", serverId: "s-rep", typeId: "t-gone", resolvedVia: "type" },
    ];
    const chips = buildBindingChips(
      ["Acme-SaaS"],
      bindings,
      [], // the type directory doesn't carry t-gone
      [{ id: "s-rep", name: "Rep" }],
      new Map(),
    );
    expect(chips[0]).toMatchObject({
      kind: "type",
      typeId: "t-gone",
      typeName: null,
      status: null,
      representativeName: "Rep",
    });
  });
});
