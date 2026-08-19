import type { ServerConfig } from "@mcp-token-footprint/shared";
import { CliError } from "../errors.js";
import { renderTable } from "../output.js";
import { type CommandContext, emitJson } from "./context.js";

/**
 * `mcpfp servers` — the minimum listing needed to FIND the id every other command takes. A CLI that
 * only accepts opaque ids is not usable from a terminal, so this exists even though it is a thin
 * projection of `GET /api/servers`.
 *
 * The API returns redacted configs (`hasEnvSecrets` / `hasHeaderSecrets` booleans, never values —
 * `.claude/rules/mcp-and-security.md`), so there is nothing here to redact a second time.
 */
export async function runServersCommand(context: CommandContext): Promise<void> {
  const servers = await listServers(context);

  if (context.format === "json") {
    await emitJson(context, servers);
    return;
  }

  if (servers.length === 0) {
    await context.emitter.payload("No MCP servers are registered.");
    return;
  }

  await context.emitter.payload(
    renderTable<ServerConfig>(
      [
        { header: "ID", value: (server) => server.id },
        { header: "NAME", value: (server) => server.name },
        { header: "TRANSPORT", value: (server) => server.transport },
        { header: "TARGET", value: (server) => server.url ?? server.command ?? "" },
      ],
      servers,
    ),
  );
}

/** `GET /api/servers`. One place, so `scan` and `scans --server` resolve names identically. */
export async function listServers(context: CommandContext): Promise<ServerConfig[]> {
  const servers = await context.client.json<ServerConfig[]>({
    method: "GET",
    path: "/api/servers",
    accept: "json",
    scope: "read",
  });
  return Array.isArray(servers) ? servers : [];
}

/**
 * Resolve a `<server>` argument — **a server id OR its exact name** — to an id.
 *
 * An ambiguous name (two registered servers sharing one) is a `2` listing the candidate ids, never a
 * silent "first match": scanning the wrong server and reporting a plausible number is a worse
 * failure than not scanning at all, and in CI nobody would notice.
 */
export function resolveServerRef(servers: ServerConfig[], ref: string): ServerConfig {
  const byId = servers.find((server) => server.id === ref);
  if (byId) return byId;

  const byName = servers.filter((server) => server.name === ref);
  if (byName.length === 1) return byName[0] as ServerConfig;
  if (byName.length > 1) {
    throw new CliError(
      `"${ref}" matches ${byName.length} registered servers — use an id instead.`,
      {
        details: byName.map((server) => `  ${server.id}  ${server.name} (${server.transport})`),
      },
    );
  }

  throw new CliError(`No registered server with the id or exact name "${ref}".`, {
    details:
      servers.length === 0
        ? ["No MCP servers are registered on this instance."]
        : ["Registered:", ...servers.map((server) => `  ${server.id}  ${server.name}`)],
  });
}
