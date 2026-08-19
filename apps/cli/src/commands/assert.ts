import fs from "node:fs";
import path from "node:path";
import {
  type AssertionDocument,
  assertionDocumentSchema,
  type AssertionReport,
  type AssertionRuleResult,
  MCPFP_ASSERT_FILE_NAME,
  MCPFP_EXIT,
  type McpfpExitCode,
} from "@mcp-token-footprint/shared";
import { findFileUpwards } from "../config.js";
import { CliError } from "../errors.js";
import { renderFields } from "../output.js";
import { type CommandContext, emitJson } from "./context.js";

/**
 * `mcpfp assert [file]` — evaluate a gate against a scan the workbench already holds.
 *
 * **This is the ONLY command in the repo that may exit `1`** (D-C7). The split it protects is the
 * whole point of the work package:
 *
 *   • `0` — every rule passed. Rules that could not be evaluated *yet* (there is no earlier scan to
 *     compare against) are `skipped`, warned about loudly on stderr, and still a `0`: a first-ever
 *     run must not fail a pipeline for having no history.
 *   • `1` — at least one rule **failed**. The gate said no.
 *   • `2` — the gate could not **run**: no file, a malformed or version-mismatched file, conflicting
 *     flags, an unreachable API, any non-2xx (including the two D-C8 error cases — a baseline that
 *     does not resolve, and two scans that are not on the same scale).
 *
 * **Nothing here decides pass or fail.** The API evaluates every rule and returns an
 * `AssertionReport`; this file reads `report.passed` / `report.counts` and renders. That is the
 * client invariant (`roadmap/ci/README.md`) — the same rules must produce the same verdict whether
 * they were run from a terminal, from CI, or (later) from the workbench's own UI, and a second
 * implementation in the CLI is exactly how that stops being true.
 *
 * **It never runs a scan** (D-C9). Scanning is `mcpfp scan`; a CI job chains the two, which is what
 * keeps the exit codes honest — a scan that could not run is *that* command's `2`.
 */
export type AssertOptions = {
  /** The directory the file search starts from (the process cwd in a real run). */
  cwd: string;
  /** A positional path or `--file`. When set it is used verbatim — a missing one is a `2`. */
  file: string | undefined;
  /** `--server` / `--scan` — a target override applied over the document's own. Mutually exclusive. */
  server: string | undefined;
  scan: string | undefined;
  /** `--baseline previous|<scanId>` — overrides the document's `baseline`. */
  baseline: string | undefined;
};

export async function runAssertCommand(
  context: CommandContext,
  options: AssertOptions,
): Promise<McpfpExitCode> {
  if (options.server !== undefined && options.scan !== undefined) {
    throw new CliError("`--server` and `--scan` name two different targets — pass only one.");
  }

  const filePath = locateDocument(options);
  const document = readDocument(filePath);

  context.emitter.narrate(`Evaluating ${filePath} against ${context.config.apiUrl}…`);

  const report = await context.client.json<AssertionReport>({
    method: "POST",
    path: "/api/assertions/evaluate",
    body: {
      document,
      // Only send an override when there IS one, so the API sees the document's own target
      // untouched in the normal case.
      ...(options.scan !== undefined ? { target: { scan: options.scan } } : {}),
      ...(options.scan === undefined && options.server !== undefined
        ? { target: { server: options.server } }
        : {}),
      ...(options.baseline !== undefined ? { baseline: options.baseline } : {}),
    },
    accept: "json",
    // The endpoint only reads, but it is a POST — and WP 1.1's guard maps scopes coarsely by method
    // (D-C10), so a REMOTE token needs an execute scope. `scan:run` is the one a footprint pipeline
    // already holds; naming it here is what turns a 403 into an actionable sentence.
    scope: "scan:run",
  });

  if (context.format === "json") {
    await emitJson(context, report);
  } else {
    await context.emitter.payload(renderReport(report));
  }

  // Skips are warned about on stderr, one line per rule, and deliberately NOT silenced by `--quiet`:
  // "this rule did not actually run" is the one thing a green pipeline must never hide.
  for (const result of report.results) {
    if (result.status !== "skipped") continue;
    context.emitter.warn(
      `Warning: ${result.rule} was skipped — ${result.skipReason ?? "it could not be evaluated."}`,
    );
  }

  if (report.passed) return MCPFP_EXIT.success;

  context.emitter.fail(
    `Assertions failed: ${report.counts.failed} of ${report.counts.total}.`,
  );
  return MCPFP_EXIT.assertionFailure;
}

// ── The document ────────────────────────────────────────────────────────────────────────────────

/**
 * A named path is used verbatim; otherwise `mcpfp.assert.json` is looked for from the cwd upward,
 * first hit wins — the SAME walk-up `mcpfp.config.json` uses, so a repository root works from any
 * subdirectory. Finding nothing is a `2` naming the file it looked for, never a silent success.
 */
function locateDocument(options: AssertOptions): string {
  if (options.file !== undefined) {
    const resolved = path.resolve(options.cwd, options.file);
    if (!fs.existsSync(resolved)) throw new CliError(`No assertions file at ${resolved}.`);
    return resolved;
  }

  const found = findFileUpwards(options.cwd, MCPFP_ASSERT_FILE_NAME);
  if (found === undefined) {
    throw new CliError(`No ${MCPFP_ASSERT_FILE_NAME} found in ${options.cwd} or any parent.`, {
      details: [
        `Create one, or name a file: \`mcpfp assert path/to/${MCPFP_ASSERT_FILE_NAME}\`.`,
        "See `mcpfp help assert` for the rule kinds.",
      ],
    });
  }
  return found;
}

/**
 * Read + validate LOCALLY, with the shared schema, before the network call. A malformed gate then
 * fails in milliseconds with a field path instead of after a round trip with a generic 400 — and,
 * because the schema is `.strict()` at every level, a typo'd key is a named error rather than a rule
 * that was quietly dropped from a gate somebody believes is protecting them.
 */
function readDocument(filePath: string): AssertionDocument {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    throw new CliError(
      `Could not read ${filePath}: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new CliError(
      `${filePath} is not valid JSON: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }

  const result = assertionDocumentSchema.safeParse(parsed);
  if (!result.success) {
    throw new CliError(`${filePath} is not a valid assertions document.`, {
      details: result.error.issues.map(
        (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
      ),
    });
  }
  return result.data;
}

// ── Human rendering ─────────────────────────────────────────────────────────────────────────────
// One padded line per rule, then the counts. No colour: a CI log is not a terminal, and a `FAIL`
// that is only distinguishable by an escape sequence is invisible in the place it matters most.

const STATUS_LABEL: Record<AssertionRuleResult["status"], string> = {
  pass: "PASS",
  fail: "FAIL",
  skipped: "SKIP",
};

function renderReport(report: AssertionReport): string {
  const header = renderFields([
    ["Server", `${report.subject.serverName} (${report.subject.serverId})`],
    ["Scan", `${report.subject.scanId} — ${report.subject.scannedAt}`],
    [
      "Baseline",
      report.baseline
        ? `${report.baseline.scan.scanId} — ${report.baseline.scan.scannedAt} (asked for "${report.baseline.requested}")`
        : "none",
    ],
  ]);

  const width = Math.max(...report.results.map((result) => result.rule.length), 0);
  const lines: string[] = [];
  for (const result of report.results) {
    lines.push(`${STATUS_LABEL[result.status]}  ${result.rule.padEnd(width)}  ${result.message}`);
    for (const detail of result.details ?? []) lines.push(`        ${detail}`);
    if (result.skipReason !== undefined) lines.push(`        ${result.skipReason}`);
  }

  const { passed, failed, skipped } = report.counts;
  // Last, so it survives a `| tail -1`.
  const summary = `${passed} passed · ${failed} failed · ${skipped} skipped`;

  return [header, "", ...lines, "", summary].join("\n");
}
