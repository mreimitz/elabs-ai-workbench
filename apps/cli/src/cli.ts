import fs from "node:fs";
import { parseArgs } from "node:util";
import {
  MCPFP_CONFIG_FILE_NAME,
  MCPFP_EXIT,
  MCPFP_OUTPUT_VERSION,
  type McpfpExitCode,
} from "@mcp-token-footprint/shared";
import { createClient } from "./client.js";
import { runConfigShowCommand } from "./commands/config-show.js";
import type { CommandContext } from "./commands/context.js";
import { isReportTarget, reportTargetTakesId, runReportCommand } from "./commands/report.js";
import { runScanCommand } from "./commands/scan.js";
import { runScansCommand } from "./commands/scans.js";
import { runServersCommand } from "./commands/servers.js";
import { resolveConfig } from "./config.js";
import { CliError, describeUnexpectedError } from "./errors.js";
import { renderCommandUsage, renderUsage } from "./help.js";
import { Emitter, isOutputFormat, type CliStreams, type OutputFormat } from "./output.js";

/**
 * The `mcpfp` entry point, as a plain function over injected argv/env/cwd/streams.
 *
 * Everything the process touches is a parameter, so the whole surface — exit codes, the
 * stdout/stderr split, the "the token never appears anywhere" property — is exercised in-process
 * against a `node:http` stub. `index.ts` is the eight-line shim that hands it the real process.
 *
 * **Argument parsing is `node:util`'s `parseArgs` (D-C5).** A four-command CLI is not a reason to
 * take on `commander` or `yargs`, so `apps/cli` has exactly one runtime dependency
 * (`@mcp-token-footprint/shared`) and `pnpm-lock.yaml` gains no package.
 */
export type CliContext = {
  argv: string[];
  env: Record<string, string | undefined>;
  cwd: string;
  streams: CliStreams;
};

/** Which `--format` values each command can actually produce. */
const SUPPORTED_FORMATS: Record<string, readonly OutputFormat[]> = {
  scan: ["human", "json"],
  report: ["human", "json", "markdown"],
  servers: ["human", "json"],
  scans: ["human", "json"],
  "config show": ["human", "json"],
};

export async function runCli(context: CliContext): Promise<McpfpExitCode> {
  const { streams } = context;

  // `pnpm mcpfp scan foo` expands the root script to `… exec tsx src/index.ts -- scan foo`, so the
  // separator arrives as our first argument. `parseArgs` would treat it as "everything after this is
  // a positional" and silently turn `--format json` into two positionals, so drop exactly one
  // leading `--`. A user who writes their own `--` after the command keeps its normal meaning.
  const argv = context.argv[0] === "--" ? context.argv.slice(1) : context.argv;

  let parsed: ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (error) {
    // `strict: true` throws on an unknown option or a missing option argument. Both are usage errors.
    streams.stderr(`${describeUnexpectedError(error)}\n\n`);
    streams.stderr(`${renderUsage()}\n`);
    return MCPFP_EXIT.error;
  }

  const { values, positionals } = parsed;

  if (values.version) {
    streams.stdout(`mcpfp ${readCliVersion()} (output envelope v${MCPFP_OUTPUT_VERSION})\n`);
    return MCPFP_EXIT.success;
  }

  const command = positionals[0];

  if (values.help || command === "help") {
    const topic = command === "help" ? positionals[1] : command;
    streams.stdout(`${topic ? renderCommandUsage(topic) : renderUsage()}\n`);
    return MCPFP_EXIT.success;
  }

  if (command === undefined) {
    streams.stderr("No command given.\n\n");
    streams.stderr(`${renderUsage()}\n`);
    return MCPFP_EXIT.error;
  }

  try {
    return await dispatch(context, command, positionals.slice(1), values);
  } catch (error) {
    // ONE place turns a thrown failure into a stderr message + an exit code, so no command has to
    // remember to, and the payload stream stays clean whatever went wrong.
    if (error instanceof CliError) {
      streams.stderr(`${error.message}\n`);
      for (const line of error.details) streams.stderr(`${line}\n`);
      return error.exitCode;
    }
    streams.stderr(`${describeUnexpectedError(error)}\n`);
    return MCPFP_EXIT.error;
  }
}

const OPTIONS = {
  url: { type: "string" },
  token: { type: "string" },
  timeout: { type: "string" },
  config: { type: "string" },
  format: { type: "string" },
  output: { type: "string" },
  server: { type: "string" },
  quiet: { type: "boolean" },
  help: { type: "boolean" },
  version: { type: "boolean" },
} as const;

type ParsedValues = {
  url?: string | undefined;
  token?: string | undefined;
  timeout?: string | undefined;
  config?: string | undefined;
  format?: string | undefined;
  output?: string | undefined;
  server?: string | undefined;
  quiet?: boolean | undefined;
};

async function dispatch(
  context: CliContext,
  command: string,
  args: string[],
  values: ParsedValues,
): Promise<McpfpExitCode> {
  // Resolve the command's spelled-out name and its format key FIRST, so an unknown command and an
  // unsupported `--format` are both refused before any config file is read or any socket is opened.
  const route = routeFor(command, args);

  const format = resolveFormat(values.format, route.formatKey);

  if (values.server !== undefined && command !== "scans") {
    throw new CliError("`--server` only applies to `mcpfp scans`.");
  }

  const config = resolveConfig({ flags: values, env: context.env, cwd: context.cwd });
  const emitter = new Emitter({
    streams: context.streams,
    quiet: values.quiet === true,
    outputFile: values.output,
  });

  if (config.tokenSource === "file") {
    // Supported, but a token in a file next to the code is a token that gets committed. `.gitignore`
    // carries the filename; this is the second line of defence, and `--quiet` deliberately does not
    // silence it.
    emitter.warn(
      `Warning: the service token came from ${config.configPath ?? MCPFP_CONFIG_FILE_NAME}. Prefer the MCPFP_TOKEN environment variable in CI.`,
    );
  }

  const commandContext: CommandContext = {
    config,
    client: createClient(config),
    emitter,
    format,
    args,
    name: route.name,
  };

  switch (route.kind) {
    case "scan":
      return runScanCommand(commandContext, route.serverRef);
    case "report":
      await runReportCommand(commandContext, route.target, route.id);
      return MCPFP_EXIT.success;
    case "servers":
      await runServersCommand(commandContext);
      return MCPFP_EXIT.success;
    case "scans":
      await runScansCommand(commandContext, values.server);
      return MCPFP_EXIT.success;
    case "config-show":
      await runConfigShowCommand(commandContext);
      return MCPFP_EXIT.success;
  }
}

type Route =
  | { kind: "scan"; name: string; formatKey: string; serverRef: string }
  | {
      kind: "report";
      name: string;
      formatKey: string;
      target: "scan" | "server" | "run" | "fleet";
      id: string | undefined;
    }
  | { kind: "servers"; name: string; formatKey: string }
  | { kind: "scans"; name: string; formatKey: string }
  | { kind: "config-show"; name: string; formatKey: string };

/** Map positionals to a command, or throw the usage error. `name` is what goes into the envelope. */
function routeFor(command: string, args: string[]): Route {
  if (command === "scan") {
    const serverRef = args[0];
    if (serverRef === undefined) {
      throw new CliError("`mcpfp scan` needs a server id or exact name.", {
        details: [renderCommandUsage("scan")],
      });
    }
    return { kind: "scan", name: "scan", formatKey: "scan", serverRef };
  }

  if (command === "report") {
    const target = args[0];
    if (target === undefined || !isReportTarget(target)) {
      throw new CliError(
        target === undefined
          ? "`mcpfp report` needs a target: scan, server, run or fleet."
          : `Unknown report target "${target}". Use scan, server, run or fleet.`,
        { details: [renderCommandUsage("report")] },
      );
    }
    const id = args[1];
    if (reportTargetTakesId(target) && id === undefined) {
      throw new CliError(`\`mcpfp report ${target}\` needs an id.`, {
        details: [renderCommandUsage("report")],
      });
    }
    return {
      kind: "report",
      name: `report ${target}`,
      formatKey: "report",
      target,
      id: reportTargetTakesId(target) ? id : undefined,
    };
  }

  if (command === "servers") return { kind: "servers", name: "servers", formatKey: "servers" };
  if (command === "scans") return { kind: "scans", name: "scans", formatKey: "scans" };

  if (command === "config") {
    if (args[0] !== "show") {
      throw new CliError(
        args[0] === undefined
          ? "`mcpfp config` needs a subcommand. The only one is `show`."
          : `Unknown config subcommand "${args[0]}". The only one is \`show\`.`,
      );
    }
    return { kind: "config-show", name: "config show", formatKey: "config show" };
  }

  throw new CliError(`Unknown command "${command}".`, { details: ["", renderUsage()] });
}

/**
 * Validate `--format` against what the command can produce. An unsupported format is a **`2` naming
 * the formats that command does support** — never a silent downgrade to `human`, which in CI would
 * quietly write a human table into the file a downstream step tried to parse as markdown.
 */
function resolveFormat(requested: string | undefined, formatKey: string): OutputFormat {
  const supported = SUPPORTED_FORMATS[formatKey] ?? (["human", "json"] as const);
  if (requested === undefined) return "human";
  if (!isOutputFormat(requested)) {
    throw new CliError(`Unknown --format "${requested}". Use human, json or markdown.`);
  }
  if (!supported.includes(requested)) {
    throw new CliError(
      `\`mcpfp ${formatKey}\` does not support --format ${requested}. It supports: ${supported.join(", ")}.`,
    );
  }
  return requested;
}

/**
 * The package version, read from the manifest next to the compiled entry point. Read lazily and
 * defensively — a `--version` that crashes because a build layout changed would be a silly way to
 * fail, and this is the only thing in the CLI that needs to know where it lives on disk.
 */
function readCliVersion(): string {
  try {
    const manifest = JSON.parse(
      fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version?: unknown };
    return typeof manifest.version === "string" ? manifest.version : "unknown";
  } catch {
    return "unknown";
  }
}
