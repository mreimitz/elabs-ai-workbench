import fs from "node:fs/promises";
import path from "node:path";
import { API_TOKEN_PREFIX, API_TOKEN_PREFIX_LENGTH } from "@mcp-token-footprint/shared";
import { CliError } from "./errors.js";

/**
 * **D-C6 — stdout is the payload, stderr is the narration.**
 *
 * Everything a machine consumes goes to stdout (or, with `--output`, to a file): the JSON envelope,
 * the API's markdown, the human table. Everything a person reads while waiting goes to stderr:
 * progress lines, warnings, errors. That split is what makes
 *
 * ```
 * mcpfp report scan <id> --format json > report.json
 * ```
 *
 * produce a byte-exact parseable file with nothing else in it, on the first try, in a CI job where
 * nobody is watching.
 *
 * There is no colour, no spinner and no box drawing anywhere in this module — partly because that
 * would be a dependency (D-C5), mostly because a CI log is not a terminal.
 */

export const OUTPUT_FORMATS = ["human", "json", "markdown"] as const;

export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export function isOutputFormat(value: string): value is OutputFormat {
  return (OUTPUT_FORMATS as readonly string[]).includes(value);
}

/** The two raw sinks. Injected so a test captures exactly the bytes a real run would write. */
export type CliStreams = {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
};

/**
 * Anything that LOOKS like a workbench service token, wherever it came from — the configured
 * credential, an API error body that echoed it back, a `parseArgs` message that quoted a mistyped
 * `--token` argument. Matched on shape rather than on the one value we happen to hold, so this is a
 * net under every stream rather than a check at one call site.
 *
 * The tail is `{9,}` because {@link API_TOKEN_PREFIX_LENGTH} characters are safe to show and the
 * secret is longer than that — a shorter `mcpfp_…` string is not a token and is left alone.
 */
const TOKEN_SHAPED = new RegExp(
  `${API_TOKEN_PREFIX}[A-Za-z0-9_-]{${API_TOKEN_PREFIX_LENGTH + 1},}`,
  "g",
);

/**
 * Replace every token-shaped run in `text` with its display prefix. Applied to EVERY string this
 * process writes to stdout, stderr or a file, so "the plaintext token is never printed" is a
 * structural property of the output layer rather than a rule each command has to remember.
 */
export function redactTokens(text: string): string {
  return text.replace(
    TOKEN_SHAPED,
    (match) =>
      `${API_TOKEN_PREFIX}${match.slice(API_TOKEN_PREFIX.length, API_TOKEN_PREFIX.length + API_TOKEN_PREFIX_LENGTH)}…`,
  );
}

export type EmitterOptions = {
  streams: CliStreams;
  /** `--quiet` — silences progress narration. Warnings and errors are NOT affected. */
  quiet: boolean;
  /** `--output <file>` — the payload goes here instead of stdout. Parent directories are created. */
  outputFile: string | undefined;
};

export class Emitter {
  constructor(private readonly options: EmitterOptions) {}

  /**
   * The machine payload. Exactly one of these per successful command.
   *
   * With `--output` the bytes go to the file and a one-line confirmation goes to stderr, so the two
   * destinations are never both "the payload" and a shell redirect of a `--output` run still yields
   * an empty stdout rather than a duplicate.
   */
  async payload(text: string): Promise<void> {
    const body = redactTokens(text.endsWith("\n") ? text : `${text}\n`);
    const target = this.options.outputFile;
    if (target === undefined) {
      this.options.streams.stdout(body);
      return;
    }
    const resolved = path.resolve(target);
    try {
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await fs.writeFile(resolved, body, "utf8");
    } catch (error) {
      throw new CliError(
        `Could not write ${resolved}: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
    this.narrate(`Wrote ${Buffer.byteLength(body, "utf8")} bytes to ${resolved}`);
  }

  /** Progress narration on stderr. Silenced by `--quiet`. */
  narrate(line: string): void {
    if (this.options.quiet) return;
    this.options.streams.stderr(`${redactTokens(line)}\n`);
  }

  /**
   * A warning on stderr. Deliberately **not** silenced by `--quiet`: the only warning this WP emits
   * is "your token came out of a file that is easy to commit", and a flag that means "be less
   * chatty" must not be able to switch off a security nudge.
   */
  warn(line: string): void {
    this.options.streams.stderr(`${redactTokens(line)}\n`);
  }

  /** An error on stderr. Never silenced, never redirected into `--output`. */
  fail(line: string): void {
    this.options.streams.stderr(`${redactTokens(line)}\n`);
  }
}

// ── Human rendering ───────────────────────────────────────────────────────────────────────────────
// Plain text, aligned with spaces. Numbers are right-aligned so a column of token counts can be
// compared by eye, which is the whole reason `human` is the default format.

export type TableColumn<Row> = {
  header: string;
  align?: "left" | "right";
  value: (row: Row) => string;
};

export function renderTable<Row>(columns: TableColumn<Row>[], rows: Row[]): string {
  const cells = rows.map((row) => columns.map((column) => column.value(row)));
  const widths = columns.map((column, index) =>
    Math.max(column.header.length, ...cells.map((line) => line[index]?.length ?? 0), 0),
  );

  const pad = (text: string, index: number): string => {
    const width = widths[index] ?? text.length;
    return columns[index]?.align === "right" ? text.padStart(width) : text.padEnd(width);
  };

  const lines = [columns.map((column, index) => pad(column.header, index)).join("  ")];
  for (const line of cells) {
    lines.push(line.map((text, index) => pad(text, index)).join("  "));
  }
  // Trailing spaces on a right-aligned last column are noise in a diff or a log.
  return lines.map((line) => line.replace(/\s+$/, "")).join("\n");
}

/** A `label   value` block — the shape every "here is one thing" human rendering uses. */
export function renderFields(fields: [label: string, value: string][]): string {
  const width = Math.max(...fields.map(([label]) => label.length), 0);
  return fields.map(([label, value]) => `${label.padEnd(width)}  ${value}`).join("\n");
}
