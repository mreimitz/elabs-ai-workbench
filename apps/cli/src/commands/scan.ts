import {
  formatBytes,
  formatNumber,
  formatPercent,
  MCPFP_EXIT,
  type McpfpExitCode,
  type ScanDetail,
  type ToolScan,
} from "@mcp-token-footprint/shared";
import { CliError } from "../errors.js";
import { renderFields, renderTable } from "../output.js";
import { type CommandContext, emitJson } from "./context.js";
import { listServers, resolveServerRef } from "./servers.js";

/** How many tools the human rendering lists. The full ranking is in `--format json`. */
const TOP_TOOLS = 5;

/**
 * `mcpfp scan <server>` — run a real discovery scan and render the footprint.
 *
 * **The scan happens in the API.** The CLI POSTs and formats what comes back; it never connects to
 * an MCP server, never spawns a stdio child, never counts a token. That is the client invariant
 * (`roadmap/ci/README.md`) and it is why `apps/cli` can depend on nothing but `shared`.
 *
 * ### Why the POST goes first
 *
 * `<server>` may be an id or an exact name. We try the id — `POST /api/servers/:id/scan` — and only
 * fall back to `GET /api/servers` for name resolution on a **404**. Two reasons, both practical:
 *
 *   • A CI token scoped to `scan:run` alone (the D-C4 vocabulary makes exactly that token natural)
 *     may not read `/api/servers`. Listing first would 403 a token that is perfectly able to do the
 *     job it was minted for.
 *   • The common case — a pipeline passing a recorded id — then costs one request, not two.
 */
export async function runScanCommand(context: CommandContext, ref: string): Promise<McpfpExitCode> {
  context.emitter.narrate(`Scanning ${ref} on ${context.config.apiUrl}…`);

  const scan = await runScanFor(context, ref);

  if (context.format === "json") {
    await emitJson(context, scan);
  } else {
    await context.emitter.payload(renderScan(scan));
  }

  if (scan.status === "failed") {
    // The request succeeded; the SCAN did not. That is an execution error (`2`), not an assertion
    // failure (`1` is reserved for WP 1.3) — and it must not be a `0`, or a CI step whose MCP server
    // is broken would go green while reporting zero tools.
    context.emitter.fail(
      `Scan ${scan.id} failed: ${scan.errorMessage ?? "the server could not be scanned."}`,
    );
    return MCPFP_EXIT.error;
  }
  return MCPFP_EXIT.success;
}

async function runScanFor(context: CommandContext, ref: string): Promise<ScanDetail> {
  try {
    return await postScan(context, ref);
  } catch (error) {
    if (!(error instanceof CliError) || error.status !== 404) throw error;
  }

  // Not an id. Resolve it as an exact name, which surfaces a real "no such server" (or an ambiguous
  // name) instead of the bare 404 the POST produced.
  context.emitter.narrate(`No server with id "${ref}" — resolving it as a name…`);
  const server = resolveServerRef(await listServers(context), ref);
  context.emitter.narrate(`Resolved "${ref}" to ${server.id}.`);
  return postScan(context, server.id);
}

function postScan(context: CommandContext, serverId: string): Promise<ScanDetail> {
  return context.client.json<ScanDetail>({
    method: "POST",
    path: `/api/servers/${encodeURIComponent(serverId)}/scan`,
    body: {},
    accept: "json",
    scope: "scan:run",
  });
}

function renderScan(scan: ScanDetail): string {
  const header = renderFields([
    ["Server", `${scan.serverName} (${scan.serverId})`],
    ["Scan", scan.id],
    ["Scanned at", scan.scannedAt],
    ["Status", scan.status + (scan.errorMessage ? ` — ${scan.errorMessage}` : "")],
    ["Tools", formatNumber(scan.totalTools)],
    ["Total tokens", formatNumber(scan.totalTokens)],
    ["Raw payload", formatBytes(scan.totalRawBytes)],
    [
      "Resources",
      `${formatNumber(scan.totalResources + scan.totalResourceTemplates)} (${formatNumber(scan.totalResourceTokens)} tokens)`,
    ],
    [
      "Prompts",
      `${formatNumber(scan.totalPrompts)} (${formatNumber(scan.totalPromptTokens)} tokens)`,
    ],
  ]);

  const top = [...(scan.tools ?? [])]
    .sort((a, b) => b.totalTokens - a.totalTokens)
    .slice(0, TOP_TOOLS);

  const table =
    top.length === 0
      ? "No tools were discovered."
      : renderTable<ToolScan>(
          [
            { header: "TOKENS", align: "right", value: (tool) => formatNumber(tool.totalTokens) },
            {
              header: "SHARE",
              align: "right",
              value: (tool) => formatPercent(tool.contributionPercent),
            },
            { header: "TOOL", value: (tool) => tool.toolName },
          ],
          top,
        );

  // The one line an operator actually wants, last so it survives a `| tail -1`.
  const verdict = `${formatNumber(scan.totalTokens)} definition tokens across ${formatNumber(
    scan.totalTools,
  )} tools (${scan.tokenProfile}, counting version ${scan.countingVersion}).`;

  return [
    header,
    "",
    `Top ${Math.min(TOP_TOOLS, Math.max(top.length, 1))} tools by contribution`,
    table,
    "",
    verdict,
  ].join("\n");
}
