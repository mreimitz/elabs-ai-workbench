import {
  formatNumber,
  formatPercent,
  isSettledRatingState,
  MCPFP_EXIT,
  MCPFP_SUITE_RUN_MEMBER_ROWS,
  MCPFP_SUITE_RUN_POLL_INTERVAL_MS,
  type McpfpExitCode,
  type McpfpSuiteRunResult,
  type Suite,
  type SuiteRun,
  type SuiteRunMember,
  type SuiteRunStatus,
} from "@mcp-token-footprint/shared";
import { CliError } from "../errors.js";
import { renderFields, renderTable } from "../output.js";
import { type CommandContext, emitJson } from "./context.js";

/**
 * `mcpfp suite run <suite>` — start a saved suite's matrix run, wait for it, and summarize it.
 *
 * **The matrix runs in the API.** The CLI POSTs, re-reads a read endpoint until the run settles, and
 * formats what comes back; it never executes a test, never calls a provider and never counts a
 * token. That is the client invariant (`planning/Roadmap/RM-08-ci/item.md`) and it is why `apps/cli` can depend
 * on nothing but `shared`.
 *
 * ### D-C11 — waits by default, waits by POLLING, and maps the terminal status onto an exit code
 *
 *   • **Waits by default**, because a CI step that fires and forgets cannot gate anything.
 *     `--no-wait` returns straight after the `202` with the suite-run id (exit `0`) for the
 *     deliberate fire-and-poll case.
 *   • **By polling** `GET /api/suite-runs/:id`, *not* by consuming the SSE stream. The stream would
 *     need an event-stream parser in a CLI whose whole point is that it has no dependencies (D-C5),
 *     and it is the fragile half of the transport through proxies and CI runners. Polling a read
 *     endpoint is boring, resumable and correct; the run happens in the API either way.
 *   • **Exit codes**: `completed` → `0`; `error`, `capped` (the aggregate cost cap soft-stopped the
 *     matrix) and `stopped` (an operator halted it) → `2`; a wait budget exhausted while the status
 *     is still `pending`/`running` → `2`, naming the suite-run id so the operator can go and look at
 *     it. **Never `1`** — D-C7 reserves that for `mcpfp assert`, and WP 2.2's suite/grade assertions
 *     are what will legitimately emit it.
 *   • **Rating**: the wait ends on a terminal status **and** a settled `ratingState` — the same pair
 *     the suite SSE stream waits for, so the summary is not published while member grades are still
 *     landing. A budget that runs out with a terminal status but an unsettled rating is **not** a
 *     failure: the exit code comes from the terminal status and a loud warning says the grades may
 *     be incomplete. `--quiet` does not silence that warning (D-C8's posture).
 */

/**
 * The four statuses a suite run stops at. Declared locally, exactly as every other consumer of this
 * vocabulary does (`suite-run-manager.ts`, `use-suite-stream.ts`, `SuiteRunConsole.tsx`) — `shared`
 * exports the status tuple but no terminal subset, and `apps/cli` may not import from `apps/api`.
 */
const TERMINAL_SUITE_STATUSES: ReadonlySet<SuiteRunStatus> = new Set<SuiteRunStatus>([
  "completed",
  "capped",
  "stopped",
  "error",
]);

export type SuiteRunOptions = {
  /** `--no-wait` inverts this. Default true (D-C11). */
  wait: boolean;
  /** The total wait budget in milliseconds, from `--wait <seconds>` or the shared default. */
  waitMs: number;
};

export async function runSuiteRunCommand(
  context: CommandContext,
  ref: string,
  options: SuiteRunOptions,
): Promise<McpfpExitCode> {
  context.emitter.narrate(`Starting suite run for ${ref} on ${context.config.apiUrl}…`);

  const { suiteRun: started, suiteName } = await startSuiteRun(context, ref);

  if (!options.wait) {
    // `members: []` rather than an absent field: the run has produced none yet, and an empty array
    // is the honest answer a consumer does not have to special-case (D-C12).
    context.emitter.narrate(`Suite run ${started.id} started; not waiting for it (--no-wait).`);
    await emit(context, { suiteRun: started, members: [] }, suiteName);
    return MCPFP_EXIT.success;
  }

  const { suiteRun, exhausted } = await waitForSuiteRun(context, started, options.waitMs);
  const terminal = TERMINAL_SUITE_STATUSES.has(suiteRun.status);

  // Read the members even after an exhausted budget: a half-finished matrix's rows are exactly what
  // an operator opens the log for, and reporting zero of them would read as "the matrix ran
  // nothing". A failure here is an ordinary `CliError` → exit 2, for the same reason.
  const members = await listMembers(context, suiteRun.id);

  await emit(context, { suiteRun, members }, suiteName);

  if (!terminal) {
    context.emitter.fail(
      `Suite run ${suiteRun.id} was still ${suiteRun.status} when the ${formatSeconds(options.waitMs)} wait budget ran out — it is still going in the workbench.`,
    );
    return MCPFP_EXIT.error;
  }

  if (exhausted) {
    // A `warn` survives `--quiet` on purpose: "some grades may not be in this summary" is precisely
    // what a flag meaning "be less chatty" must not be able to hide (the D-C8 posture).
    context.emitter.warn(
      `Warning: suite run ${suiteRun.id} reached ${suiteRun.status} but its rating was still "${suiteRun.ratingState ?? "unsettled"}" when the ${formatSeconds(options.waitMs)} wait budget ran out — the grades in this summary may be incomplete.`,
    );
  }

  if (suiteRun.status !== "completed") {
    context.emitter.fail(`Suite run ${suiteRun.id} ended ${suiteRun.status}.`);
    return MCPFP_EXIT.error;
  }
  return MCPFP_EXIT.success;
}

// ── Starting ────────────────────────────────────────────────────────────────────────────────────

/**
 * Start the matrix. `<suite>` may be an id or an exact name; we try the id — `POST
 * /api/suites/:id/run` — and only fall back to `GET /api/suites` for name resolution on a **404**,
 * for the same two reasons `mcpfp scan` does it in that order:
 *
 *   • A CI token minted with `suites:run` alone (the D-C4 vocabulary makes exactly that token
 *     natural) may not be able to list suites. Listing first would 403 a token that is perfectly
 *     able to do the job it was minted for.
 *   • The common case — a pipeline passing a recorded id — then costs one request, not two.
 */
async function startSuiteRun(
  context: CommandContext,
  ref: string,
): Promise<{ suiteRun: SuiteRun; suiteName: string | undefined }> {
  try {
    return { suiteRun: await postSuiteRun(context, ref), suiteName: undefined };
  } catch (error) {
    if (!(error instanceof CliError) || error.status !== 404) throw error;
  }

  context.emitter.narrate(`No suite with id "${ref}" — resolving it as a name…`);
  const suite = resolveSuiteRef(await listSuites(context), ref);
  context.emitter.narrate(`Resolved "${ref}" to ${suite.id}.`);
  return { suiteRun: await postSuiteRun(context, suite.id), suiteName: suite.name };
}

function postSuiteRun(context: CommandContext, suiteId: string): Promise<SuiteRun> {
  return context.client.json<SuiteRun>({
    method: "POST",
    path: `/api/suites/${encodeURIComponent(suiteId)}/run`,
    body: {},
    accept: "json",
    scope: "suites:run",
  });
}

async function listSuites(context: CommandContext): Promise<Suite[]> {
  const suites = await context.client.json<Suite[]>({
    method: "GET",
    path: "/api/suites",
    accept: "json",
    scope: "read",
  });
  return Array.isArray(suites) ? suites : [];
}

/**
 * Resolve a `<suite>` argument — **a suite id OR its exact name** — to a suite.
 *
 * An ambiguous name (two saved suites sharing one) is a `2` listing the candidate ids, never a
 * silent "first match": running the wrong matrix and reporting a plausible mean grade is a worse
 * failure than not running it at all, and in CI nobody would notice. Written here rather than
 * generalized alongside `resolveServerRef` — one call site is not a shared helper.
 */
function resolveSuiteRef(suites: Suite[], ref: string): Suite {
  const byId = suites.find((suite) => suite.id === ref);
  if (byId) return byId;

  const byName = suites.filter((suite) => suite.name === ref);
  if (byName.length === 1) return byName[0] as Suite;
  if (byName.length > 1) {
    throw new CliError(`"${ref}" matches ${byName.length} saved suites — use an id instead.`, {
      details: byName.map((suite) => `  ${suite.id}  ${suite.name}`),
    });
  }

  throw new CliError(`No saved suite with the id or exact name "${ref}".`, {
    details:
      suites.length === 0
        ? ["No suites are saved on this instance."]
        : ["Saved:", ...suites.map((suite) => `  ${suite.id}  ${suite.name}`)],
  });
}

// ── Waiting ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Re-read the suite run until it settles or the budget runs out.
 *
 * "Settled" is a terminal status **and** a settled (or absent) `ratingState` — D-C11. The sleep is
 * capped at whatever is left of the budget, so `--wait 10` cannot overshoot by most of a poll
 * interval before noticing it is out of time.
 */
async function waitForSuiteRun(
  context: CommandContext,
  started: SuiteRun,
  waitMs: number,
): Promise<{ suiteRun: SuiteRun; exhausted: boolean }> {
  const deadline = Date.now() + waitMs;
  let lastCellsCompleted: number | undefined;

  for (;;) {
    const suiteRun = await getSuiteRun(context, started.id);

    // Narrate only when the number actually MOVES. A 40-minute matrix polled every five seconds
    // would otherwise put ~500 identical lines in a build log.
    const cellsCompleted = suiteRun.aggregates?.cellsCompleted;
    if (cellsCompleted !== undefined && cellsCompleted !== lastCellsCompleted) {
      lastCellsCompleted = cellsCompleted;
      context.emitter.narrate(describeProgress(suiteRun));
    }

    if (isSettled(suiteRun)) return { suiteRun, exhausted: false };

    const remaining = deadline - Date.now();
    if (remaining <= 0) return { suiteRun, exhausted: true };
    await sleep(Math.min(MCPFP_SUITE_RUN_POLL_INTERVAL_MS, remaining));
  }
}

function getSuiteRun(context: CommandContext, suiteRunId: string): Promise<SuiteRun> {
  return context.client.json<SuiteRun>({
    method: "GET",
    path: `/api/suite-runs/${encodeURIComponent(suiteRunId)}`,
    accept: "json",
    scope: "read",
  });
}

function listMembers(context: CommandContext, suiteRunId: string): Promise<SuiteRunMember[]> {
  return context.client
    .json<SuiteRunMember[]>({
      method: "GET",
      path: `/api/suite-runs/${encodeURIComponent(suiteRunId)}/members`,
      accept: "json",
      scope: "read",
    })
    .then((members) => (Array.isArray(members) ? members : []));
}

/** Terminal status AND a settled rating — the pair the suite SSE stream itself waits for (D-C11). */
function isSettled(suiteRun: SuiteRun): boolean {
  if (!TERMINAL_SUITE_STATUSES.has(suiteRun.status)) return false;
  return suiteRun.ratingState === undefined || isSettledRatingState(suiteRun.ratingState);
}

/** No dependency, no timer library: one `setTimeout` behind a promise (D-C5). */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function describeProgress(suiteRun: SuiteRun): string {
  const aggregates = suiteRun.aggregates;
  const cells =
    aggregates === undefined
      ? "—"
      : `${formatNumber(aggregates.cellsCompleted)}/${formatNumber(aggregates.cellsTotal)}`;
  const spend = aggregates === undefined ? "—" : formatUsd(totalCost(aggregates));
  return `Suite run ${suiteRun.id}: ${cells} cells, ${spend} so far…`;
}

// ── Human rendering ─────────────────────────────────────────────────────────────────────────────

async function emit(
  context: CommandContext,
  result: McpfpSuiteRunResult,
  suiteName: string | undefined,
): Promise<void> {
  if (context.format === "json") {
    // `data` is the two API reads verbatim — no field added, renamed, re-ordered or computed here
    // (D-C12). The member ordering below is presentation only and never touches this.
    await emitJson(context, result);
    return;
  }
  await context.emitter.payload(renderSuiteRun(result, suiteName));
}

function renderSuiteRun(result: McpfpSuiteRunResult, suiteName: string | undefined): string {
  const { suiteRun, members } = result;
  const aggregates = suiteRun.aggregates;

  const header = renderFields([
    ["Suite", describeSuite(suiteRun, suiteName)],
    ["Suite run", suiteRun.id],
    ["Source", suiteRun.source ?? "—"],
    ["Status", suiteRun.status],
    ["Started at", suiteRun.startedAt],
    ["Ended at", suiteRun.endedAt ?? "—"],
    ["Duration", describeDuration(suiteRun)],
    ["Rating", suiteRun.ratingState ?? "—"],
  ]);

  // Every aggregate can legitimately be absent or null — a matrix that produced no graded score has
  // no mean grade. That is an em dash, never a 0: a rendered zero would read as "everything failed".
  const rolled = renderFields([
    [
      "Cells",
      aggregates === undefined
        ? "—"
        : `${formatNumber(aggregates.cellsCompleted)}/${formatNumber(aggregates.cellsTotal)}`,
    ],
    ["Mean grade", formatScore(aggregates?.meanGrade ?? null)],
    ["Grade std-dev", formatScore(aggregates?.gradeStdDev ?? null)],
    [
      "Pass rate @0.5",
      aggregates?.passRateAt05 == null ? "—" : formatPercent(aggregates.passRateAt05 * 100),
    ],
    ["Total tokens", aggregates === undefined ? "—" : formatNumber(aggregates.totalTokens)],
    ["Execution cost", aggregates === undefined ? "—" : formatCost(aggregates.execCostUsd)],
    ["Judge cost", aggregates === undefined ? "—" : formatCost(aggregates.judgeCostUsd)],
  ]);

  const table = renderMembers(members);

  return [header, "", "Aggregates", rolled, "", table, "", renderVerdict(suiteRun)].join("\n");
}

function renderMembers(members: SuiteRunMember[]): string {
  if (members.length === 0) return "No member runs yet.";

  // Worst-scoring first, because that is what an operator opens the log for. An ungraded member has
  // no score rather than a bad one, so it sorts LAST — and `sort` is stable, so equal keys keep the
  // API's own order. Presentation only: `data` is untouched (D-C12).
  const ranked = [...members].sort((a, b) => {
    if (a.score === null && b.score === null) return 0;
    if (a.score === null) return 1;
    if (b.score === null) return -1;
    return a.score - b.score;
  });
  const shown = ranked.slice(0, MCPFP_SUITE_RUN_MEMBER_ROWS);

  const table = renderTable<SuiteRunMember>(
    [
      { header: "RUN", value: (member) => member.id },
      { header: "STATUS", value: (member) => member.status },
      { header: "SCORE", align: "right", value: (member) => formatScore(member.score) },
      {
        header: "TOKENS",
        align: "right",
        value: (member) => formatNumber(member.tokensIn + member.tokensOut),
      },
      { header: "COST", align: "right", value: (member) => formatCost(member.costUsd) },
    ],
    shown,
  );

  const hidden = members.length - shown.length;
  const heading = `Members, worst score first (${formatNumber(shown.length)} of ${formatNumber(members.length)})`;
  return hidden > 0
    ? [heading, table, `…and ${formatNumber(hidden)} more (--format json carries all of them)`].join(
        "\n",
      )
    : [heading, table].join("\n");
}

/** The one line an operator actually wants, last so it survives a `| tail -1`. */
function renderVerdict(suiteRun: SuiteRun): string {
  const aggregates = suiteRun.aggregates;
  if (aggregates === undefined) return `Suite run ${suiteRun.id} ${suiteRun.status}.`;
  return `Suite run ${suiteRun.id} ${suiteRun.status}: ${formatNumber(aggregates.cellsCompleted)}/${formatNumber(aggregates.cellsTotal)} cells, mean grade ${formatScore(aggregates.meanGrade)}, ${formatUsd(totalCost(aggregates))}.`;
}

function describeSuite(suiteRun: SuiteRun, suiteName: string | undefined): string {
  if (suiteRun.suiteId === undefined) return "— (ad-hoc)";
  return suiteName === undefined ? suiteRun.suiteId : `${suiteName} (${suiteRun.suiteId})`;
}

function describeDuration(suiteRun: SuiteRun): string {
  if (suiteRun.endedAt === undefined) return "—";
  const ms = Date.parse(suiteRun.endedAt) - Date.parse(suiteRun.startedAt);
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function totalCost(aggregates: { execCostUsd: number; judgeCostUsd: number }): number {
  return aggregates.execCostUsd + aggregates.judgeCostUsd;
}

/** Scores are `0..1` and nullable everywhere in the suite contract; two decimals, as the reports do. */
function formatScore(score: number | null): string {
  return score === null ? "—" : score.toFixed(2);
}

/** The per-figure cost, at the same four decimals the suite-run report's markdown uses. */
function formatCost(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

/** The at-a-glance total, rounded to cents — the narration line and the verdict sentence. */
function formatUsd(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

function formatSeconds(ms: number): string {
  return `${formatNumber(ms / 1000)}s`;
}
