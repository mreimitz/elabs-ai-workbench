import {
  MCPFP_CONFIG_FILE_NAME,
  MCPFP_DEFAULT_API_URL,
  MCPFP_DEFAULT_TIMEOUT_MS,
} from "@mcp-token-footprint/shared";

/**
 * Usage text. Plain, wrapped by hand, no dependency and no colour — a CI log is not a terminal.
 *
 * It documents what this WP actually ships and, at the end, what it deliberately does not, naming
 * the work packages that will: `assert` (WP 1.3), `suite run` (WP 2.1), the baseline-delta PR
 * comment (WP 2.2). A CLI that silently lacks the command someone read about is worse than one that
 * says "not built yet".
 */
export function renderUsage(): string {
  return `mcpfp — a thin client for a running AI Workbench (MCP Token Footprint) API.

Usage
  mcpfp <command> [subcommand] [args] [options]

Commands
  scan <server>              Run a discovery scan. <server> is a server id OR its exact name.
  report scan <scanId>       The scan (token-footprint) report.
  report server <scanId>     The server-level report for that scan.
  report run <runId>         The run report.
  report fleet               The fleet report (the whole install).
  servers                    List registered servers (id, name, transport).
  scans [--server <server>]  List scans, newest first; optionally one server's.
  config show                The resolved config, with the token redacted to its prefix.
  help [command]             This text, or one command's.

Global options
  --url <url>          Workbench base URL.        env MCPFP_URL        default ${MCPFP_DEFAULT_API_URL}
  --token <token>      Service token (mcpfp_…).   env MCPFP_TOKEN      default none
  --timeout <ms>       Per-request timeout.       env MCPFP_TIMEOUT_MS default ${MCPFP_DEFAULT_TIMEOUT_MS}
  --config <path>      Use this ${MCPFP_CONFIG_FILE_NAME} instead of searching for one.
  --format <fmt>       human (default) | json | markdown. Not every command supports every format.
  --output <file>      Write the payload to a file instead of stdout (parent dirs are created).
  --quiet              Suppress progress narration on stderr. Errors and warnings still print.
  --help               This text.
  --version            The CLI version and the output-envelope version.

Configuration
  Precedence is flag > environment > ${MCPFP_CONFIG_FILE_NAME} > default. The config file is found by
  walking UP from the current directory; the first one wins. Keys: "url", "token", "timeoutMs".
  Storing a token in the file works but is discouraged — prefer MCPFP_TOKEN in CI.

  A loopback instance is open and needs no token unless it runs with API_AUTH_REQUIRED=true; a
  remote one always does. \`scan\` needs a token with the \`scan:run\` scope; everything else needs \`read\`.

Output
  stdout carries the payload; stderr carries progress, warnings and errors. So
    mcpfp report scan <id> --format json > report.json
  writes a file containing nothing but the JSON envelope.

Exit codes
  0  success
  1  assertion failure — reserved for \`mcpfp assert\` (WP 1.3); nothing in this build emits it
  2  execution, config or transport error (bad flags, unreachable API, non-2xx response, failed scan)

Not built yet
  assert (WP 1.3) · suite run (WP 2.1) · the baseline-delta PR-comment artifact (WP 2.2).`;
}

/** Per-command detail for `mcpfp help <command>`. Falls back to the full usage text. */
export function renderCommandUsage(command: string): string {
  const topic = COMMAND_HELP[command];
  return topic ?? renderUsage();
}

const COMMAND_HELP: Record<string, string> = {
  scan: `mcpfp scan <server> [--format human|json]

Runs a discovery scan against a registered MCP server and prints its token footprint. <server> is a
server id or its exact name; an ambiguous name lists the candidate ids and exits 2. The scan itself
runs in the API — the CLI never connects to an MCP server.

Needs a token with the \`scan:run\` scope (and \`read\`, if <server> is a name that has to be resolved).
Exits 2 if the scan itself fails, so a broken server cannot pass a CI step.`,
  report: `mcpfp report scan <scanId>   [--format human|json|markdown]
mcpfp report server <scanId> [--format human|json|markdown]
mcpfp report run <runId>     [--format human|json|markdown]
mcpfp report fleet           [--format human|json|markdown]

Fetches a report the API has already composed. \`human\` and \`markdown\` are the same document — the
API's own markdown, verbatim; \`json\` wraps the API's JSON report in the machine envelope.

Needs a token with the \`read\` scope.`,
  servers: `mcpfp servers [--format human|json]

Lists the registered MCP servers: id, name, transport, and the command or URL behind them. Secrets
are never returned by the API, so nothing here is redacted a second time.`,
  scans: `mcpfp scans [--server <server>] [--format human|json]

Lists scans newest first, optionally just one server's. <server> is a server id or its exact name.`,
  config: `mcpfp config show [--format human|json]

Prints the resolved configuration: which instance, which timeout, which ${MCPFP_CONFIG_FILE_NAME} was
read, and whether a token is configured — as its \`mcpfp_ab12cd34…\` display prefix and where it came
from. The token itself is never printed by this or any other command.`,
};
