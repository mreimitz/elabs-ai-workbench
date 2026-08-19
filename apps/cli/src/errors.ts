import { MCPFP_EXIT, type McpfpExitCode } from "@mcp-token-footprint/shared";

/**
 * Everything the CLI refuses to do is thrown as one of these, caught once at the top of
 * {@link import("./cli.js").runCli}, printed to **stderr** and turned into a process exit code.
 *
 * `exitCode` defaults to {@link MCPFP_EXIT.error} (`2`) because that is what every failure in WP 1.2
 * is: a config, execution or transport problem. **`1` is reserved for WP 1.3's assertion failures and
 * nothing here may emit it** (D-C7) — the constructor takes the code so WP 1.3 can throw
 * `new CliError(msg, MCPFP_EXIT.assertionFailure)` without a second error class, but no call site in
 * this WP passes anything.
 */
export class CliError extends Error {
  readonly exitCode: McpfpExitCode;

  /**
   * Optional extra lines printed under the message — the candidate ids of an ambiguous server name,
   * the formats a command actually supports. Kept separate from `message` so the first stderr line
   * stays a single readable sentence.
   */
  readonly details: string[];

  /**
   * The HTTP status behind this error, when it came from a response. Present so a command can react
   * to one specific status without re-parsing the message — `mcpfp scan` treats a 404 from
   * `POST /api/servers/:id/scan` as "that was not an id, try resolving it as a name" rather than as
   * a dead end. Absent for config/transport errors.
   */
  readonly status: number | undefined;

  constructor(
    message: string,
    options: { exitCode?: McpfpExitCode; details?: string[]; status?: number } = {},
  ) {
    super(message);
    this.name = "CliError";
    this.exitCode = options.exitCode ?? MCPFP_EXIT.error;
    this.details = options.details ?? [];
    this.status = options.status;
  }
}

/** Narrow an unknown thrown value to a readable sentence without ever leaking a stack trace. */
export function describeUnexpectedError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
}
