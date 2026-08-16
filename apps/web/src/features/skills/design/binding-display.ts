// Server-types WP 3.2 (A) — the PURE classification behind each "Bound servers" chip in the Tools
// palette. It fuses three read-only sources — the skill's declared frontmatter `servers:` names (the
// chip list), the SERVER-RESOLVED bindings (`GET /api/skills/:id/bindings`, WP 3.1: `serverId` +
// additive `typeId`/`resolvedVia:"type"`), and the registered server-type + server directories — into
// one model per chip so the palette can render a TYPE binding distinctly (type name + lifecycle status
// + resolved representative) from a plain server binding, WITHOUT guessing. Pure + framework-free so
// the fusion logic is unit-tested without rendering.

import type { ServerType, ServerTypeStatus, SkillServerBinding } from "@mcp-token-footprint/shared";

/** The slim server slice the chip model needs (a `ServerConfig` always satisfies it). */
export type ChipServerInfo = { id: string; name: string };

/**
 * One rendered "Bound servers" chip. Every chip carries its declared `name` (the frontmatter entry)
 * and the resolved tool count (`null` ⇒ no completed scan / no registered match). `kind` drives the
 * chip variant:
 *  - `"server"` — a plain server binding (or an unresolved plain name): the existing chip, unchanged.
 *  - `"type"` — the frontmatter name is a server TYPE (WP 3.1 `resolvedVia:"type"`). Carries the
 *    matched type's `typeId`, its `typeName` + lifecycle `status` (from the type directory, `null`
 *    when the type row can't be found — honest degradation), and the resolved REPRESENTATIVE member:
 *    `representativeId`/`representativeName` when the type has a member with a completed scan, else
 *    BOTH `null` — the honest "no representative yet" state (NEVER a guessed server).
 */
export type BindingChip =
  | { kind: "server"; name: string; toolCount: number | null }
  | {
      kind: "type";
      name: string;
      typeId: string | null;
      typeName: string | null;
      status: ServerTypeStatus | null;
      representativeId: string | null;
      representativeName: string | null;
      toolCount: number | null;
    };

/**
 * Build the chip model for each declared frontmatter name (order preserved). `bindings` is the
 * server-resolved set (frontmatter order) — a name resolved through a server type (`resolvedVia ===
 * "type"`) becomes a `"type"` chip; every other name stays a `"server"` chip (identical to the prior
 * behaviour). `types` maps `typeId → {name,status}`; `servers` maps the representative id → its name.
 * `toolCountByServerName` is the bound-tools count keyed by the RESOLVED server's name — for a type
 * chip that is the representative's name (the group the tools land under), so the count still shows.
 */
export function buildBindingChips(
  declaredNames: readonly string[],
  bindings: readonly SkillServerBinding[],
  types: readonly ServerType[],
  servers: readonly ChipServerInfo[],
  toolCountByServerName: ReadonlyMap<string, number>,
): BindingChip[] {
  const bindingByName = new Map(bindings.map((binding) => [binding.serverName, binding] as const));
  const typeById = new Map(types.map((type) => [type.id, type] as const));
  const serverNameById = new Map(servers.map((server) => [server.id, server.name] as const));

  return declaredNames.map((name): BindingChip => {
    const binding = bindingByName.get(name);
    if (binding && binding.resolvedVia === "type") {
      const type = binding.typeId ? (typeById.get(binding.typeId) ?? null) : null;
      const representativeId = binding.serverId;
      const representativeName =
        representativeId !== null ? (serverNameById.get(representativeId) ?? null) : null;
      // The tools land under the representative's name — count them there, not under the type name.
      const toolCount =
        representativeName !== null ? (toolCountByServerName.get(representativeName) ?? null) : null;
      return {
        kind: "type",
        name,
        typeId: binding.typeId ?? null,
        typeName: type?.name ?? null,
        status: type?.status ?? null,
        representativeId,
        representativeName,
        toolCount,
      };
    }
    // A plain server binding (or an unresolved plain name): the count is keyed by the declared name.
    return { kind: "server", name, toolCount: toolCountByServerName.get(name) ?? null };
  });
}
