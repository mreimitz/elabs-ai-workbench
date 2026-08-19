import { createMcpfpOutput } from "@mcp-token-footprint/shared";
import type { WorkbenchClient } from "../client.js";
import type { ResolvedConfig } from "../config.js";
import { Emitter, type OutputFormat } from "../output.js";

/**
 * What every command is handed. Assembled once in `cli.ts` after config resolution, so no command
 * reads `process.env`, `process.argv` or `process.stdout` itself — which is exactly what makes the
 * whole surface testable in-process against a `node:http` stub instead of a real workbench.
 */
export type CommandContext = {
  config: ResolvedConfig;
  client: WorkbenchClient;
  emitter: Emitter;
  format: OutputFormat;
  /** The command's own words, e.g. `["scan", "everything"]` → `["everything"]`. */
  args: string[];
  /** The spelled-out command name that goes into the envelope: `"scan"`, `"report scan"`. */
  name: string;
};

/**
 * Emit one command's machine payload as the shared envelope. Centralized so `command`, `apiUrl` and
 * `outputVersion` are stamped identically everywhere and `data` is always **verbatim what the API
 * returned** — the client invariant, enforced by there being no other way for a command to print
 * JSON.
 */
export async function emitJson(context: CommandContext, data: unknown): Promise<void> {
  const envelope = createMcpfpOutput({
    command: context.name,
    apiUrl: context.config.apiUrl,
    data,
  });
  await context.emitter.payload(JSON.stringify(envelope, null, 2));
}
