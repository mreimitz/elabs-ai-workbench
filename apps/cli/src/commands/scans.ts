import { formatNumber, type ScanSummary } from "@mcp-token-footprint/shared";
import { renderTable } from "../output.js";
import { type CommandContext, emitJson } from "./context.js";
import { listServers, resolveServerRef } from "./servers.js";

/**
 * `mcpfp scans [--server <server>]` — the newest-first scan list, so an operator can find the scan id
 * `mcpfp report scan` takes without opening a browser.
 *
 * Timestamps render as the raw ISO instant rather than a localized one: a CI log is grepped and
 * sorted, not read over coffee, and a locale-dependent string would make two runs of the same
 * command on two machines produce different bytes.
 */
export async function runScansCommand(
  context: CommandContext,
  serverRef: string | undefined,
): Promise<void> {
  const path = serverRef
    ? `/api/servers/${encodeURIComponent(resolveServerRef(await listServers(context), serverRef).id)}/scans`
    : "/api/scans";

  const scans = await context.client.json<ScanSummary[]>({
    method: "GET",
    path,
    accept: "json",
    scope: "read",
  });
  const rows = Array.isArray(scans) ? scans : [];

  if (context.format === "json") {
    await emitJson(context, rows);
    return;
  }

  if (rows.length === 0) {
    await context.emitter.payload(
      serverRef ? `No scans for "${serverRef}".` : "No scans have been run on this instance.",
    );
    return;
  }

  await context.emitter.payload(
    renderTable<ScanSummary>(
      [
        { header: "SCAN ID", value: (scan) => scan.id },
        { header: "SERVER", value: (scan) => scan.serverName },
        { header: "SCANNED AT", value: (scan) => scan.scannedAt },
        { header: "STATUS", value: (scan) => scan.status },
        { header: "TOOLS", align: "right", value: (scan) => formatNumber(scan.totalTools) },
        { header: "TOKENS", align: "right", value: (scan) => formatNumber(scan.totalTokens) },
      ],
      rows,
    ),
  );
}
