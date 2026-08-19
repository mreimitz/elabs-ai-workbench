import { CliError } from "../errors.js";
import type { OutputFormat } from "../output.js";
import { type CommandContext, emitJson } from "./context.js";

/**
 * `mcpfp report <target> [id]` — fetch a report the API has already composed.
 *
 * **The CLI renders no report it did not receive from the API.** Both formats come off the same
 * endpoints the browser's export buttons use, so a report downloaded here and one downloaded from
 * the UI are the same document. `--format human` therefore serves the API's **markdown**: a report
 * already IS the human rendering, and inventing a second, thinner one in the CLI would be exactly
 * the "rendering it did not receive" the client invariant forbids.
 */
export const REPORT_TARGETS = ["scan", "server", "run", "fleet"] as const;

export type ReportTarget = (typeof REPORT_TARGETS)[number];

export function isReportTarget(value: string): value is ReportTarget {
  return (REPORT_TARGETS as readonly string[]).includes(value);
}

/** Whether a target takes an id. `fleet` is the whole install, so it takes none. */
export function reportTargetTakesId(target: ReportTarget): boolean {
  return target !== "fleet";
}

export async function runReportCommand(
  context: CommandContext,
  target: ReportTarget,
  id: string | undefined,
): Promise<void> {
  const path = reportPath(target, id, context.format);
  context.emitter.narrate(
    `Fetching ${context.name}${id ? ` ${id}` : ""} from ${context.config.apiUrl}…`,
  );

  if (context.format === "json") {
    await emitJson(
      context,
      await context.client.json<unknown>({
        method: "GET",
        path,
        accept: "json",
        scope: "read",
      }),
    );
    return;
  }

  // `human` and `markdown` are the same bytes here — the API's own markdown document, verbatim.
  const markdown = await context.client.text({
    method: "GET",
    path,
    accept: "markdown",
    scope: "read",
  });
  await context.emitter.payload(markdown);
}

/**
 * The endpoint for each target × format. Every one of these exists today — this WP adds **no API
 * route and no migration**.
 *
 * Note the asymmetry the API actually has: the server report's JSON form is `…/server/:scanId` with
 * **no** `/json` suffix, unlike scan/run/fleet. That is the real route table, not a typo.
 */
function reportPath(target: ReportTarget, id: string | undefined, format: OutputFormat): string {
  const json = format === "json";
  if (target === "fleet") return json ? "/api/reports/fleet/json" : "/api/reports/fleet/markdown";

  if (id === undefined) {
    // Guarded by the dispatcher; kept here so this function is total rather than trusting a caller.
    throw new CliError(`\`mcpfp report ${target}\` needs an id.`);
  }
  const encoded = encodeURIComponent(id);
  if (target === "scan") {
    return json ? `/api/reports/scan/${encoded}/json` : `/api/reports/scan/${encoded}/markdown`;
  }
  if (target === "server") {
    return json ? `/api/reports/server/${encoded}` : `/api/reports/server/${encoded}/markdown`;
  }
  return json ? `/api/reports/run/${encoded}/json` : `/api/reports/run/${encoded}/markdown`;
}
