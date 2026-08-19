import {
  ASSERTION_RULE_KINDS,
  ASSERTION_RULE_META,
  ASSERTIONS_VERSION,
  MCPFP_ASSERT_FILE_NAME,
  MCPFP_CONFIG_FILE_NAME,
  MCPFP_DEFAULT_API_URL,
  MCPFP_DEFAULT_TIMEOUT_MS,
} from "@mcp-token-footprint/shared";

/**
 * Usage text. Plain, wrapped by hand, no dependency and no colour — a CI log is not a terminal.
 *
 * It documents what is actually shipped and, at the end, what deliberately is not, naming the work
 * packages that will: `suite run` (WP 2.1), the baseline-delta PR comment (WP 2.2). A CLI that
 * silently lacks the command someone read about is worse than one that says "not built yet".
 *
 * The `assert` topic's rule table is GENERATED from {@link ASSERTION_RULE_META} rather than typed
 * out here, so the prose an operator reads cannot drift from the schema that validates their file.
 */
export function renderUsage(): string {
  return `mcpfp — a thin client for a running AI Workbench (MCP Token Footprint) API.

Usage
  mcpfp <command> [subcommand] [args] [options]

Commands
  scan <server>              Run a discovery scan. <server> is a server id OR its exact name.
  assert [file]              Evaluate ${MCPFP_ASSERT_FILE_NAME} against a scan. Exits 1 if a rule fails.
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
  --file <path>        assert: use this gate file instead of searching for one (same as [file]).
  --scan <scanId>      assert: assert against this exact scan, overriding the document's target.
  --baseline <ref>     assert: "previous" or a scan id, overriding the document's baseline.
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

  In CI, invoke the built entry point (\`node apps/cli/dist/index.js …\`) rather than the
  \`pnpm mcpfp\` convenience script: pnpm prints its own banner on stdout, and silencing it with
  \`--silent\` makes pnpm collapse every non-zero exit to 1 — the code reserved for assertions.

Exit codes
  0  success — every assertion passed (a rule that could not be evaluated yet is a loud SKIP, still 0)
  1  assertion failure — \`mcpfp assert\` said no. Nothing else in this CLI can return it.
  2  execution, config or transport error (bad flags, unreachable API, non-2xx response, failed scan)

Not built yet
  suite run (WP 2.1) · the baseline-delta PR-comment artifact (WP 2.2).`;
}

/** Per-command detail for `mcpfp help <command>`. Falls back to the full usage text. */
export function renderCommandUsage(command: string): string {
  const topic = COMMAND_HELP[command];
  return topic ?? renderUsage();
}

/**
 * The rule table, GENERATED from the shared `ASSERTION_RULE_META` so `mcpfp help assert` lists
 * exactly the kinds the schema accepts — a rule added in WP 2.2 or 3.1 appears here with no edit,
 * and a rule described here that does not exist is impossible.
 */
function renderRuleTable(): string {
  const width = Math.max(...ASSERTION_RULE_KINDS.map((kind) => kind.length));
  return ASSERTION_RULE_KINDS.map((kind) => {
    const meta = ASSERTION_RULE_META[kind];
    const marker = meta.needsBaseline ? " (needs a baseline)" : "";
    return `  ${kind.padEnd(width)}  ${meta.summary}${marker}`;
  }).join("\n");
}

const COMMAND_HELP: Record<string, string> = {
  assert: `mcpfp assert [file] [--file <path>] [--server <id|name>] [--scan <scanId>]
             [--baseline previous|<scanId>] [--format human|json] [--output <path>]

Evaluates a versioned gate file against a scan this workbench has ALREADY measured. The rules are
evaluated by the app, not here — the CLI posts the document and renders the itemized report, so the
same gate gives the same verdict from a terminal, from CI, or from anywhere else.

It never runs a scan. Chain the two in CI: \`mcpfp scan <server>\` then \`mcpfp assert\`.

The file
  Named as a positional or with --file, otherwise ${MCPFP_ASSERT_FILE_NAME} is looked for by walking UP
  from the current directory (first hit wins). Finding none exits 2. Every key is strict, so a typo
  is a named error rather than a rule that quietly disappears from your gate.

  {
    "version": ${ASSERTIONS_VERSION},
    "target": { "server": "github" },        // or { "scan": "<scanId>" }
    "baseline": "previous",                  // optional: "previous" or a scan id
    "rules": [
      { "rule": "max-server-tokens", "max": 3000 },
      { "rule": "max-tool-tokens", "max": 400 },
      { "rule": "no-new-tools" },
      { "rule": "max-scan-delta", "maxTokens": 250, "maxPercent": 10 }
    ]
  }

Rules
${renderRuleTable()}

Baselines
  "previous" resolves to the newest earlier completed scan OF THE SAME SERVER; a scan id is used as
  given. Either way the report echoes the concrete scan it compared against, so the artifact records
  what actually happened and the same comparison can be re-run later.

  If there is no earlier scan yet, the baseline rules report SKIP with a reason, a warning goes to
  standard error, and the exit code is 0 — a first-ever scan does not fail a pipeline. But a baseline
  you NAMED that does not resolve, and two scans that are not on the same scale (different token
  profile or counting version, where every delta would read as zero), are both errors: exit 2.

Exit codes
  0  every rule passed (skips allowed)   1  at least one rule failed   2  the gate could not run

Needs no token on a loopback instance. A remote caller needs a token with an execute scope (e.g.
Run scans) — the endpoint is a POST, and this build maps scopes by method.`,
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
