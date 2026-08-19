import type {
  AssistantAuthSource,
  AssistantAuthStartResponse,
  AssistantAuthStatus,
  AssistantContextEnvelope,
  AssistantEntityKind,
  AssistantModelsResponse,
  AssistantPermissionDecisionInput,
  AssistantStartersResponse,
  AssistantStreamFrame,
  AssistantThread,
  AssistantThreadCreateInput,
  AssistantThreadDetail,
  AssistantThreadUpdateInput,
  AssistantWorkspaceFileContent,
  AssistantWorkspaceFilesResponse,
  ApiTokenCreateInput,
  ApiTokenCreateResponse,
  ApiTokenListResponse,
  AppFeatureFlagsResponse,
  AppFeatureFlagsUpdate,
  AvailableModelsResponse,
  Collection,
  CollectionInput,
  CollectionSyncResult,
  CollectionSyncState,
  CompatibilityHeatmap,
  CompatibilityTestReport,
  ConnectivityResponse,
  // Observability WP2.7 (custom chart composer) — the dashboard-charts CRUD/reorder/clone wire.
  DashboardChart,
  DashboardChartInput,
  DashboardChartPatch,
  GithubAccountStatus,
  GithubDevicePoll,
  GithubDeviceStart,
  GraderId,
  JudgeSettingsResolved,
  JudgeSettingsUpdate,
  MetricsBucket,
  Notification,
  NotificationListQuery,
  NotificationListResult,
  NotificationReadAllResult,
  RunFilter,
  RunMetricsGroupBy,
  RunMetricsMeasure,
  RunMetricsResponse,
  RunFeedback,
  RunFeedbackInput,
  RunPinResult,
  RunSummary,
  RunView,
  RunViewInput,
  RunViewPatch,
  // Observability WP4.5 (review queue lite) — the review-rubric CRUD wire; the review flow itself
  // writes THROUGH the existing RunFeedback wire above (never a new endpoint).
  ReviewRubric,
  ReviewRubricInput,
  ReviewRubricPatch,
  ScanMetricsResponse,
  ServerConfig,
  // Observability WP4.4 (rules UI) — the watch-rule CRUD/audit/preview/test-fire wire (WP4.1–4.3).
  WatchRule,
  WatchRuleEvent,
  WatchRuleInput,
  WatchRulePatch,
  WatchRuleEventResult,
  WatchWindowPreview,
  WatchWindowPreviewRequest,
  ServerReport,
  ServerTestResponse,
  ServerType,
  ServerTypeInput,
  ServerTypeUpdate,
  ToolFindingsReport,
  ProviderCredential,
  ProviderCredentialInput,
  ProviderCredentialUpdate,
  ModelPricingEntry,
  ModelPricingInput,
  ModelPricingPatch,
  RunDetail,
  RunEvent,
  RunGrade,
  RunPlanEstimate,
  RunPlanInput,
  RunRerunRequest,
  RunSkill,
  RunStartRequest,
  RunStartResponse,
  ScanComparison,
  ScanSummary,
  Scenario,
  ScenarioInput,
  Skill,
  SkillRepoProbe,
  SkillUsage,
  SkillVersion,
  Suite,
  SuiteAnalytics,
  SuiteDeltaRow,
  SuiteInput,
  SuiteReport,
  SuiteRun,
  SuiteRunEvent,
  SuiteRunMember,
  SuiteRunReportEmbed,
  Test,
  TestAttachment,
  TestAttachmentInput,
  TestInput,
  // Auto-Rating WP 3.1 (AR1) — the COMPOSED per-run rating+grading report served by the NEW
  // `GET /api/runs/:id/report`. Aliased so it never shadows the analytics-derive `RunReport` below
  // (a DIFFERENT shape — the run-EXPORT payload from `/api/reports/run/:id/json`).
  RunReport as RunRatingReport,
} from "@mcp-token-footprint/shared";
import { serializeRunFilter } from "@mcp-token-footprint/shared";
import type { RunReport } from "../features/testing/analytics-derive";

/**
 * Error thrown by the shared client on a non-2xx response — carries the HTTP `status` so callers can
 * distinguish an EXPECTED absence (e.g. a `404` for an optional resource) from a real failure
 * (network error / `5xx`) instead of swallowing every error to `null`. A thrown fetch/network error
 * (no response) stays a plain `Error` (no `status`).
 */
export class ApiError extends Error {
  readonly status: number;
  /**
   * Watch rules editor (Observability WP4.4) — the central handler's `ZodError -> 400` body carries
   * `{ error, issues }` (`apps/api/src/index.ts`'s `setErrorHandler`); `issues` is the raw
   * `ZodIssue[]` (each `{ path, message, ... }`). Captured here, additively, so a caller building an
   * inline "here's exactly what's wrong" surface (the rule editor's create/update) can render
   * field-level detail instead of the generic top-level message. `undefined` for every non-Zod
   * error (a plain `{ error }` body, a network failure, or a non-JSON response) — existing callers
   * that only read `.message`/`.status` are unaffected.
   */
  readonly issues?: { path: (string | number)[]; message: string }[];
  constructor(
    status: number,
    message: string,
    issues?: { path: (string | number)[]; message: string }[],
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.issues = issues;
  }
}

/** `signal` is optional and additive — pass an `AbortController`'s signal to cancel an in-flight
 *  request (e.g. a stale-response guard when the caller's target changes mid-fetch). Omit for the
 *  existing fire-and-forget behavior — the call shape (single-arg `fetch(path)`) is unchanged when no
 *  signal is passed, so existing callers/assertions are untouched. */
export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = signal ? await fetch(path, { signal }) : await fetch(path);
  return readResponse<T>(response);
}

/** Like {@link apiGet}, but reads the response body as raw TEXT — for a `…/markdown` report route
 *  the web renders inline (e.g. the digest view) rather than downloading. */
export async function apiGetText(path: string, signal?: AbortSignal): Promise<string> {
  const response = signal ? await fetch(path, { signal }) : await fetch(path);
  if (!response.ok) {
    await raiseResponseError(response);
  }
  return response.text();
}

/** Cross-server / tool-level scan comparison. Deltas are B − A. `threshold` (0..1) tunes fuzzy
 *  matching; omitted lets the API apply its default. */
export async function getComparison(
  a: string,
  b: string,
  threshold?: number,
): Promise<ScanComparison> {
  const params = new URLSearchParams({ a, b });
  if (threshold !== undefined) params.set("threshold", String(threshold));
  return apiGet<ScanComparison>(`/api/compare?${params.toString()}`);
}

// ── App feature flags (Settings › Features) ─────────────────────────────────────────────────────
// The operator's on/off switches for whole app capabilities. The API is the source of truth (it also
// ENFORCES a disabled feature server-side, 403 `feature_disabled`); the web mirrors the map into a
// context so the nav, the routes and the dock can hide the surfaces a disabled feature owns.

/** Every feature's current on/off state. */
export const getFeatureFlags = (signal?: AbortSignal): Promise<AppFeatureFlagsResponse> =>
  apiGet<AppFeatureFlagsResponse>("/api/features", signal);

/** Flip one or more switches. A PARTIAL patch — unmentioned features keep their current value. */
export const updateFeatureFlags = (
  patch: AppFeatureFlagsUpdate,
): Promise<AppFeatureFlagsResponse> => apiPut<AppFeatureFlagsResponse>("/api/features", patch);

// ── Service tokens (Settings › API tokens) ──────────────────────────────────────────────────────
// The credential a headless caller (CI, the mcpfp CLI, an external agent on the MCP mount) presents
// instead of a browser session. The API stores a SHA-256 digest and returns the plaintext exactly
// ONCE — from `createApiToken` — so the caller of that function is the last chance to show it. It is
// never persisted here, never put in localStorage, and never re-fetchable. See roadmap/ci/ WP 1.1.

/** Every service token, newest first — redacted (`ApiToken` has no field that could hold a secret). */
export const listApiTokens = (signal?: AbortSignal): Promise<ApiTokenListResponse> =>
  apiGet<ApiTokenListResponse>("/api/tokens", signal);

/**
 * Mint a service token. **The returned `secret` is the only time the plaintext exists** — show it to
 * the operator immediately and do not stash it anywhere.
 */
export const createApiToken = (input: ApiTokenCreateInput): Promise<ApiTokenCreateResponse> =>
  apiPost<ApiTokenCreateResponse>("/api/tokens", input);

/** Revoke a service token. Immediate — any caller still holding it starts getting 401s. */
export const deleteApiToken = (id: string): Promise<void> => apiDelete(`/api/tokens/${id}`);

// ── MCP server connectivity (reauth gate) ───────────────────────────────────────────────────────
// The reauth gate's throttled preflight. All MCP/secret work stays in the API; the web only ever
// sees the redacted ConnectivityResponse.

/** Lightweight connect→close preflight for a saved server (the gate's throttled check). */
export const checkConnectivity = (serverId: string): Promise<ConnectivityResponse> =>
  apiPost<ConnectivityResponse>(`/api/servers/${serverId}/connectivity`, {});

/** Full discover round-trip (the "Test" button + the reauth modal's post-sign-in verification). */
export const testServerConnection = (serverId: string): Promise<ServerTestResponse> =>
  apiPost<ServerTestResponse>(`/api/servers/${serverId}/test`, {});

export async function apiPost<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
  return readResponse<T>(response);
}

export async function apiPut<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
  return readResponse<T>(response);
}

export async function apiDelete(path: string, signal?: AbortSignal): Promise<void> {
  const response = await fetch(path, { method: "DELETE", ...(signal ? { signal } : {}) });
  if (!response.ok) {
    await raiseResponseError(response);
  }
}

/**
 * POST a single file as `multipart/form-data` (the skill upload flow — a `.zip` or a bare
 * `SKILL.md`). The file rides as the `file` part; extra string `fields` (e.g. `displayName`) travel
 * as text parts alongside it. `Content-Type` is intentionally NOT set — the browser sets it (with
 * the multipart boundary) from the `FormData` body. Mirrors `apiPost`'s error handling.
 */
export async function apiUpload<T>(
  path: string,
  file: File,
  fields: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<T> {
  const body = new FormData();
  body.append("file", file, file.name);
  for (const [key, value] of Object.entries(fields)) {
    if (value) body.append(key, value);
  }
  const response = await fetch(path, { method: "POST", body, ...(signal ? { signal } : {}) });
  return readResponse<T>(response);
}

// ── Server types (roadmap/server-types) ───────────────────────────────────────────────────────
// A server type is a first-class named group of MCP servers sharing one tool surface, carrying a
// lifecycle `status` (D-ST1) + a computed `memberCount`. The Servers rail groups + filters by type
// (WP 2.1); the wizard picker + Manage-types surface (WP 2.2) create/rename/restatus/delete them.
// A type carries NO secrets and NO connection config — it is a label + status (D-ST5).

/** Every server type (with member counts), for grouping/filtering the servers rail. */
export const listServerTypes = (): Promise<ServerType[]> =>
  apiGet<ServerType[]>("/api/server-types");

/** Create a server type. Rejects (409) a name already in use (case-insensitive — D-ST2). */
export const createServerType = (input: ServerTypeInput): Promise<ServerType> =>
  apiPost<ServerType>("/api/server-types", input);

/** Rename / restatus / edit-description a server type (PUT). `description: null` clears it. */
export const updateServerType = (id: string, update: ServerTypeUpdate): Promise<ServerType> =>
  apiPut<ServerType>(`/api/server-types/${id}`, update);

/** Delete a type — DETACHES its members (sets them Untyped), never deletes them (D-ST4). 204. */
export const deleteServerType = (id: string): Promise<void> => apiDelete(`/api/server-types/${id}`);

async function readResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    await raiseResponseError(response);
  }

  return (await response.json()) as T;
}

async function raiseResponseError(response: Response): Promise<never> {
  let message = `${response.status} ${response.statusText}`;
  let issues: { path: (string | number)[]; message: string }[] | undefined;
  try {
    const payload = (await response.json()) as {
      error?: string;
      message?: string;
      issues?: { path: (string | number)[]; message: string }[];
    };
    message = payload.error ?? payload.message ?? message;
    issues = payload.issues;
  } catch {
    // Keep the HTTP status message.
  }

  throw new ApiError(response.status, message, issues);
}

// ── Testing run engine: streaming + run control ───────────────────────────────────────────────
// The run console drives a run over three thin POSTs and observes it over a GET SSE stream.
// `EventSource` only does GET, which is why start/turn/stop are separate POSTs (matches WP 2.2).

/**
 * Subscribe to a run's server-sent `RunEvent` stream. Each message's `data` is one JSON-encoded
 * `RunEvent`; `on` is called per event in order.
 *
 * `onError`, if given, is invoked when the `EventSource` errors. This is fired both on a real
 * mid-run drop AND at end-of-run: the API ends a finished stream by simply closing the socket (no
 * HTTP error), which the browser reports as an `error`. A native `EventSource` auto-reconnects on
 * any such non-fatal disconnect — sending `Last-Event-ID` automatically once the stream has emitted
 * an `id:` line (WP2.1, D-US8), which resumes it from the right cursor — so to stop the run console
 * reconnecting into an endless re-replay of a FINISHED run's log, the CALLER must distinguish the
 * terminal end-of-run close from a real failure and call the returned cleanup (which `close()`s the
 * stream and halts the auto-reconnect). There is no built-in retry affordance in THIS function —
 * `useRunStream` (Unified Sessions WP2.2) owns both halves of reconnect: it closes on the terminal
 * `status` event (mirroring the above), AND it runs its own 45s staleness watchdog that calls this
 * function AGAIN (a fresh `EventSource`, via its own `connect()`) when neither a real event nor the
 * server's 15s ping has arrived in that window — the backstop for a silently hung connection that
 * never fires `onerror` at all. The cleanup also closes the stream on unmount.
 */
export function openRunStream(
  runId: string,
  on: (event: RunEvent) => void,
  onError?: (event: Event) => void,
): () => void {
  const es = new EventSource(`/api/runs/${runId}/stream`);
  es.onmessage = (message) => {
    on(JSON.parse(message.data) as RunEvent);
  };
  es.onerror = (event) => {
    // Notify the caller; the browser auto-reconnects unless the caller closes the stream via the
    // returned cleanup. `event` is the raw `EventSource` error Event (no useful detail beyond
    // "errored"), passed through for callers that want it.
    onError?.(event);
  };
  return () => es.close();
}

/** Start a run for a test × scenario. Returns the run id + its SSE stream URL. */
export const startRun = (body: RunStartRequest): Promise<RunStartResponse> =>
  apiPost<RunStartResponse>("/api/runs", body);

/**
 * Observability (WP3.3, D-OB18) — FORK a terminal run into a NEW derived run. `fromStepId` forks AT a
 * step (its conversation prefix is reconstructed + seeded); omitted ⇒ a whole-run re-launch. `overrides`
 * edit the launch params (prompt/model/temperature/skillVersionId). Returns the derived run id + stream
 * URL (same shape as {@link startRun}), so the console navigates to the new run and streams it.
 */
export const rerunRun = (runId: string, body: RunRerunRequest): Promise<RunStartResponse> =>
  apiPost<RunStartResponse>(`/api/runs/${runId}/rerun`, body);

/**
 * Launch an inline run PLAN (Testing IA WP 3.3) through the ONE execution engine — a `suite`,
 * `collection`, or `adhoc` plan (`RunPlanInput`) resolved server-side into a suite-run matrix
 * (`POST /api/run-plans`). Returns the running {@link SuiteRun} (202) whose id backs the suite-run
 * console (`/testing/suite-runs/:id`); matrix errors surface on that run's stream, never here. The
 * lightweight single-run path ({@link startRun} → `POST /api/runs`) stays separate for the
 * 1 test × 1 environment case (no repetition/matrix), so the run launcher only reaches here for ≥2 cells.
 */
export const createRunPlan = (body: RunPlanInput): Promise<SuiteRun> =>
  apiPost<SuiteRun>("/api/run-plans", body);

/**
 * UX overhaul WP 3.5 (G7) — the launcher's advisory cost preview. `GET /api/estimate/run-plan` reads
 * environment tool-definition footprints + the server-side pricing tables and returns a rough
 * low/mid/high token + USD band for the current selection (tests × environments × reps). Advisory
 * only — it blocks nothing; unpriced models are labeled and excluded from the $ range.
 */
export const estimateRunPlan = (
  testIds: string[],
  environmentIds: string[],
  repetitions: number,
): Promise<RunPlanEstimate> => {
  const params = new URLSearchParams({
    testIds: testIds.join(","),
    environmentIds: environmentIds.join(","),
    repetitions: String(repetitions),
  });
  return apiGet<RunPlanEstimate>(`/api/estimate/run-plan?${params.toString()}`);
};

/**
 * A finished run's full replay artifact — the `RunSummary` plus its ordered `steps` and the complete
 * ordered `events` log (WP 1.6 `GET /api/runs/:id`). Backs replay mode (WP 3.7): the as-of-step KPI
 * snapshots are reconstructed purely from `events` (the interleaved `kpi` events carry the exact
 * cumulative totals at each point), so scrubbing never hits the network.
 */
export const getRun = (runId: string): Promise<RunDetail> =>
  apiGet<RunDetail>(`/api/runs/${runId}`);

/**
 * The skills a run loaded — each attachment resolved to a concrete version, with its always-on
 * footprint (L1/L2/L3 tokens) and the realized read-only disclosure usage in that run (`GET
 * /api/runs/:id/skills`). Backs the Analytics → Skills panel: a lightweight fetch that answers "was it
 * loaded, was it used, what did it cost" without pulling the full step/event replay. Empty when the
 * scenario had no attached skills.
 */
export const getRunSkills = (runId: string): Promise<RunSkill[]> =>
  apiGet<RunSkill[]>(`/api/runs/${runId}/skills`);

/**
 * A finished run's report payload — run statistics + per-step cumulative KPIs (`GET
 * /api/reports/run/:id/json`, apps/api/src/reports/reports.ts `createRunJsonReport`). Backs the
 * Wave-2 Analytics dashboard's cost + statistics figures (findings/09 §4): the stream alone can't
 * compute cumulative cost, so the panel fetches this once a run id exists and degrades gracefully
 * (deriving what it can from the stream) when the fetch is partial/unavailable for a not-yet-finished
 * run. The API returns more fields (`run`, `test`, `scenario`); {@link RunReport} types only the
 * `statistics` + `stepKpis` slice the dashboard reads.
 */
export const getRunReport = (runId: string): Promise<RunReport> =>
  apiGet<RunReport>(`/api/reports/run/${runId}/json`);

/**
 * Auto-Rating WP 3.1 (AR1) — the COMPOSED per-run rating + grading report (`GET /api/runs/:id/report`,
 * apps/api/src/grading/routes.ts → `RunReportService.compose`): base rating (answer validation, insight
 * surplus, error forensics) + expectation grades + assertion results + KPIs + judge provenance, assembled
 * fresh on every read (no per-run table, AR1). This is a SEPARATE surface from {@link getRunReport} above
 * (the run-export payload) — its type is the SHARED {@link RunRatingReport}, not the analytics one. Backs
 * the run console's Report tab; the run must be terminal for the rating to be meaningful.
 */
export const getRunRatingReport = (runId: string): Promise<RunRatingReport> =>
  apiGet<RunRatingReport>(`/api/runs/${runId}/report`);

/** Send a user turn into an interactive run. */
export const sendTurn = (runId: string, text: string): Promise<void> =>
  apiPost<void>(`/api/runs/${runId}/turns`, { text });

/** Answer a live `ask_user` question, resuming the paused tool call. */
export const answerQuestion = (runId: string, questionId: string, answer: string): Promise<void> =>
  apiPost<void>(`/api/runs/${runId}/answers`, { questionId, answer });

/** Request that a running run stop. */
export const stopRun = (runId: string): Promise<void> =>
  apiPost<void>(`/api/runs/${runId}/stop`, {});

/**
 * Unified Sessions (WP3.3, D-US2) — End session: the operator's explicit "close this interactive
 * session" action (`POST /api/runs/:id/end`, WP1.6). Valid only for a LIVE INTERACTIVE run — the API
 * 409s (via {@link ApiError}) for a non-interactive, already-terminal, or otherwise not-live run; the
 * 409's `message` is the human reason (`RunBar`'s `EndSessionControl` surfaces it verbatim in a toast).
 * The session then settles as `ended`/`ended` (`stopReasonCode: "session_ended"`) — never a fake
 * `completed`, never `aborted`.
 */
export const endRun = (runId: string): Promise<void> => apiPost<void>(`/api/runs/${runId}/end`, {});

/**
 * Unified Sessions (WP3.3, D-US1) — mark a run opened/acknowledged by the operator (`POST
 * /api/runs/:id/seen`, WP1.6). Clears it from the Runs feed's "Needs attention" section
 * (`pendingInput || (unseen && !running)`) on next load. Idempotent; 404s only if the run itself is
 * unknown.
 */
export const markRunSeen = (runId: string): Promise<void> =>
  apiPost<void>(`/api/runs/${runId}/seen`, {});

/** Delete a run (cascades to its steps + events; a live run is aborted server-side first). */
export const deleteRun = (runId: string): Promise<void> => apiDelete(`/api/runs/${runId}`);

// ── Observability — runs feed upgrade (roadmap/observability/, WP2.3) ──────────────────────────
// The runs feed's RunFilter-bound query, saved views (WP1.4 CRUD), and retention pin (WP1.6) toggle.
// `filter=` is ALWAYS built via the shared `serializeRunFilter` helper (never hand-rolled JSON), per
// the WP1.1 contract every other RunFilter-bound caller in this file already follows.

/**
 * The RunFilter-bound `GET /api/runs?filter=…` query the Runs feed's filter bar + search drive
 * (WP2.3). `queryRuns({})` (the schema-normalized empty filter) is byte-identical to the plain
 * `GET /api/runs` this file's other callers use — see the API repository's `queryRuns` doc — so this
 * is safe to call UNCONDITIONALLY (no "is a filter active" branch needed at the call site). A hit
 * carries `searchSnippet`/`searchMatchKind` when `filter.q` is set (WP1.3 FTS).
 */
export function queryRunsFiltered(
  filter: RunFilter,
  opts?: { sort?: string; limit?: number; offset?: number },
  signal?: AbortSignal,
): Promise<RunSummary[]> {
  const params = new URLSearchParams();
  params.set("filter", serializeRunFilter(filter));
  if (opts?.sort) params.set("sort", opts.sort);
  if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
  if (opts?.offset !== undefined) params.set("offset", String(opts.offset));
  return apiGet<RunSummary[]>(`/api/runs?${params.toString()}`, signal);
}

/**
 * Observability (WP3.4) — the run console's in-run search REPLAY supplement: reuse the WP1.3 FTS
 * index (via {@link queryRunsFiltered} above) scoped as tightly as the `RunFilter` grammar allows —
 * `RunFilter` has no single-run `runId` field, so this scopes by the run's OWNING TEST (`testId`); the
 * caller (`run-search.ts#hitFromFtsSummary`) narrows the result set to the exact run by id. Bounded to
 * a handful of the test's most recent matching runs — plenty to find "this run's" hit without pulling
 * a test's whole history over the wire.
 */
export function searchRunScoped(
  testId: string,
  q: string,
  signal?: AbortSignal,
): Promise<RunSummary[]> {
  return queryRunsFiltered({ testId: [testId], q }, { limit: 25 }, signal);
}

/** Saved run views (`GET/POST /api/run-views`, `PATCH/DELETE /api/run-views/:id`, WP1.4) — name +
 *  reuse a RunFilter (+ opaque `columns`/`sort` presentation hints the WP2.3 feed owns). */
export const listRunViews = (): Promise<RunView[]> => apiGet<RunView[]>("/api/run-views");

export const createRunView = (input: RunViewInput): Promise<RunView> =>
  apiPost<RunView>("/api/run-views", input);

export const updateRunView = (id: string, patch: RunViewPatch): Promise<RunView> =>
  apiPatch<RunView>(`/api/run-views/${id}`, patch);

export const deleteRunView = (id: string): Promise<void> => apiDelete(`/api/run-views/${id}`);

/** Retention pin (`POST`/`DELETE /api/runs/:id/pin`, WP1.6) — pinning a run exempts it from every
 *  `prune-runs` retention policy regardless of status/age. Idempotent; 404s only for an unknown run. */
export const pinRun = (runId: string): Promise<RunPinResult> =>
  apiPost<RunPinResult>(`/api/runs/${runId}/pin`, {});

export async function unpinRun(runId: string): Promise<RunPinResult> {
  // `apiDelete` discards the response body (204-shaped callers); this endpoint returns the run's
  // resulting pin state, so it reads the body directly (mirrors `apiPost`/`apiPut`, DELETE method).
  const response = await fetch(`/api/runs/${runId}/pin`, { method: "DELETE" });
  return readResponse<RunPinResult>(response);
}

/**
 * Human feedback (`GET/POST /api/runs/:id/feedback`, `DELETE /api/runs/:id/feedback/:feedbackId`,
 * WP1.5 API — this WP is the console UI that writes it). ONE generic primitive, run- or step-scoped;
 * STRICTLY SEPARATE from grading (D-OB15/AR6) — never blended into a score. `putRunFeedback` is an
 * UPSERT keyed on (run, step, key, source='human'): a re-thumb on the SAME scope+key REPLACES the
 * prior row rather than appending (server-enforced).
 */
export const listRunFeedback = (runId: string): Promise<RunFeedback[]> =>
  apiGet<RunFeedback[]>(`/api/runs/${runId}/feedback`);

export const putRunFeedback = (runId: string, input: RunFeedbackInput): Promise<RunFeedback> =>
  apiPost<RunFeedback>(`/api/runs/${runId}/feedback`, input);

export const deleteRunFeedback = (runId: string, feedbackId: string): Promise<void> =>
  apiDelete(`/api/runs/${runId}/feedback/${feedbackId}`);

/**
 * Review rubrics (`GET/POST /api/review-rubrics`, `PATCH/DELETE /api/review-rubrics/:id`, WP4.5,
 * D-OB22) — a persisted, named checklist for structured human review. The review SURFACE (the run
 * queue + keyboard flow, `apps/web/src/features/review/`) writes every verdict through
 * {@link putRunFeedback} above (never a new endpoint) — these five calls only manage the rubric
 * DEFINITION itself.
 */
export const listReviewRubrics = (): Promise<ReviewRubric[]> =>
  apiGet<ReviewRubric[]>("/api/review-rubrics");

export const getReviewRubric = (id: string): Promise<ReviewRubric> =>
  apiGet<ReviewRubric>(`/api/review-rubrics/${id}`);

export const createReviewRubric = (input: ReviewRubricInput): Promise<ReviewRubric> =>
  apiPost<ReviewRubric>("/api/review-rubrics", input);

export const updateReviewRubric = (id: string, patch: ReviewRubricPatch): Promise<ReviewRubric> =>
  apiPatch<ReviewRubric>(`/api/review-rubrics/${id}`, patch);

export const deleteReviewRubric = (id: string): Promise<void> =>
  apiDelete(`/api/review-rubrics/${id}`);

// ── Testing authoring: scenario / test / provider-credential CRUD (WP 3.2) ─────────────────────
// Thin, typed wrappers over the additive `/api/{scenarios,tests,providers}` routes (apps/api/src/
// testing/routes.ts + providers/routes.ts). Wire shapes come from @mcp-token-footprint/shared — the
// web never redefines them. The provider API only ever returns `hasKey` (never the key value).

/** All configured MCP servers (redacted — no secret values). Used by the Testing dashboard's
 *  filter-bar catalog (WP 2.2) alongside {@link listScenarios}/{@link listSuites}. The optional
 *  `signal` is ADDITIVE (every existing caller passes nothing) — it lets a hook abort the fetch when
 *  its inputs change, the same contract {@link listIssues} and the metrics wrappers already offer. */
export const listServers = (signal?: AbortSignal): Promise<ServerConfig[]> =>
  apiGet<ServerConfig[]>("/api/servers", signal);

/** Every scan summary — `GET /api/scans` (newest first, as the API returns it). `App.tsx` already
 *  fetches this path inline for its app-wide `scans` state; this is the typed wrapper for callers
 *  that need it on their own (the Dashboard Overview's attention queue when it is not handed the
 *  app's copy). */
export const listScans = (signal?: AbortSignal): Promise<ScanSummary[]> =>
  apiGet<ScanSummary[]>("/api/scans", signal);

/** All scenarios (the run harness — provider/model/params/allow-list/guardrails/profiles). */
export const listScenarios = (): Promise<Scenario[]> => apiGet<Scenario[]>("/api/scenarios");

/** Create a scenario; the API assigns the id + timestamps. */
export const createScenario = (input: ScenarioInput): Promise<Scenario> =>
  apiPost<Scenario>("/api/scenarios", input);

/** Replace a scenario (PUT takes the full ScenarioInput, like the API route). */
export const updateScenario = (id: string, input: ScenarioInput): Promise<Scenario> =>
  apiPut<Scenario>(`/api/scenarios/${id}`, input);

/** Delete a scenario (204 No Content). */
export const deleteScenario = (id: string): Promise<void> => apiDelete(`/api/scenarios/${id}`);

/** All tests (reusable prompts + optional system override + attachments + added profiles). */
export const listTests = (): Promise<Test[]> => apiGet<Test[]>("/api/tests");

/** Create a test; attachments are uploaded separately via {@link addTestAttachment}. */
export const createTest = (input: TestInput): Promise<Test> => apiPost<Test>("/api/tests", input);

/** Replace a test (PUT takes the full TestInput; attachments persist separately). */
export const updateTest = (id: string, input: TestInput): Promise<Test> =>
  apiPut<Test>(`/api/tests/${id}`, input);

/** Delete a test (204 No Content). */
export const deleteTest = (id: string): Promise<void> => apiDelete(`/api/tests/${id}`);

/** Upload one attachment to a test. v1 carries the blob as base64-in-JSON (see WP 2.1). */
export const addTestAttachment = (
  testId: string,
  input: TestAttachmentInput,
): Promise<TestAttachment> => apiPost<TestAttachment>(`/api/tests/${testId}/attachments`, input);

/** All provider credentials — REDACTED (each carries `hasKey`, never the key value). */
export const listProviders = (): Promise<ProviderCredential[]> =>
  apiGet<ProviderCredential[]>("/api/providers");

/** Create a provider credential. The key is sent once and never returned afterwards. */
export const createProvider = (input: ProviderCredentialInput): Promise<ProviderCredential> =>
  apiPost<ProviderCredential>("/api/providers", input);

/** Patch a provider credential (PUT takes a partial update; omit `apiKey` to keep the stored one). */
export const updateProvider = (
  id: string,
  update: ProviderCredentialUpdate,
): Promise<ProviderCredential> => apiPut<ProviderCredential>(`/api/providers/${id}`, update);

/** Delete a provider credential (204 No Content). */
export const deleteProvider = (id: string): Promise<void> => apiDelete(`/api/providers/${id}`);

// --- Model pricing editor (Observability WP2.6, D-OB22) -----------------------------------------
// The DB-backed pricing map (USD per 1M tokens). `seed` rows are read-only; `user` rows override
// them. Editing a price only affects NEW run costs — a recorded run's cost is never recomputed.

/** Every pricing entry (seed + user). */
export const listPricing = (): Promise<ModelPricingEntry[]> =>
  apiGet<ModelPricingEntry[]>("/api/pricing");

/** Create a user pricing entry (an invalid regex is rejected 400 server-side). */
export const createPricing = (input: ModelPricingInput): Promise<ModelPricingEntry> =>
  apiPost<ModelPricingEntry>("/api/pricing", input);

/** Patch a user pricing entry (a seed row is read-only → 400). */
export const updatePricing = (id: string, patch: ModelPricingPatch): Promise<ModelPricingEntry> =>
  apiPatch<ModelPricingEntry>(`/api/pricing/${id}`, patch);

/** Delete a user pricing entry (204 No Content; a seed row is read-only → 400). */
export const deletePricing = (id: string): Promise<void> => apiDelete(`/api/pricing/${id}`);

/** Live model roster for one credential, pulled from the provider's own API (drives the scenario
 *  model picker). Returns only non-secret ids/labels; rejects when the provider can't be reached. */
export const listProviderModels = (id: string): Promise<AvailableModelsResponse> =>
  apiGet<AvailableModelsResponse>(`/api/providers/${id}/models`);

// ── Assistant — Claude sign-in (WP 0.2) ────────────────────────────────────────────────────────
// The status/token/fallback endpoints for the Settings "Assistant" card. Every response is REDACTED
// (an AssistantAuthStatus) — the token is never returned by the API.

/** Redacted auth status: signed-in? token age + expiry signal, fallback pointer. Never the token. */
export const getAssistantAuthStatus = (): Promise<AssistantAuthStatus> =>
  apiGet<AssistantAuthStatus>("/api/assistant/auth/status");

/** Begin the PTY sign-in flow → an authorization URL the owner opens + a single-flight flow id. */
export const startAssistantOauth = (): Promise<AssistantAuthStartResponse> =>
  apiPost<AssistantAuthStartResponse>("/api/assistant/auth/oauth/start", {});

/** Submit the pasted code for a flow; the API captures + stores the token, returns status. */
export const completeAssistantOauth = (
  flowId: string,
  code: string,
): Promise<AssistantAuthStatus> =>
  apiPost<AssistantAuthStatus>("/api/assistant/auth/oauth/complete", { flowId, code });

/** Cancel the active PTY sign-in flow (idempotent). */
export const cancelAssistantOauth = (flowId?: string): Promise<AssistantAuthStatus> =>
  apiPost<AssistantAuthStatus>("/api/assistant/auth/oauth/cancel", flowId ? { flowId } : {});

/** Manual paste path: store an `sk-ant-oat01-…` token (validated server-side), encrypted. */
export const storeAssistantToken = (token: string): Promise<AssistantAuthStatus> =>
  apiPost<AssistantAuthStatus>("/api/assistant/auth/token", { token });

/** Point the API-key fallback at an existing anthropic provider credential, or `null` to clear it. */
export const setAssistantFallback = (
  providerCredentialId: string | null,
): Promise<AssistantAuthStatus> =>
  apiPut<AssistantAuthStatus>("/api/assistant/auth/fallback", { providerCredentialId });

/** Sign out — delete the stored Claude credential; returns the (signed-out) status. */
export const signOutAssistant = (): Promise<AssistantAuthStatus> =>
  apiDelete("/api/assistant/auth").then(() => getAssistantAuthStatus());

// ── Assistant — threads, messaging, SSE stream (WP 1.3) ────────────────────────────────────────
// The dock's data layer: thread CRUD, sending a message (kicks the turn ASYNC — the reply streams
// over `openAssistantStream`, never in the POST response), stop, and the model roster. Every route
// below 409s until an auth source is configured (`AssistantSessionManager.assertConfigured`) — the
// dock only ever calls these once `AssistantProvider`'s `authConfigured` is true.

/** List threads, optionally filtered to the ones pinned to one entity (the dock's "pinned to this
 *  item" section). Most-recently-updated first (API-side `ORDER BY updated_at DESC`). */
export const listAssistantThreads = (entity?: {
  kind: AssistantEntityKind;
  id: string;
}): Promise<AssistantThread[]> =>
  apiGet<AssistantThread[]>(
    entity
      ? `/api/assistant/threads?entity=${encodeURIComponent(`${entity.kind}:${entity.id}`)}`
      : "/api/assistant/threads",
  );

/** Create a thread. Every field is optional — the API fills a generated title, the default model,
 *  and the currently-configured auth source when omitted. */
export const createAssistantThread = (
  input: AssistantThreadCreateInput = {},
): Promise<AssistantThread> => apiPost<AssistantThread>("/api/assistant/threads", input);

/** Thread + its full persisted replay log (settled events, seq-ascending) — hydrates a reopened
 *  thread before the live stream attaches. */
export const getAssistantThread = (id: string): Promise<AssistantThreadDetail> =>
  apiGet<AssistantThreadDetail>(`/api/assistant/threads/${id}`);

/** Patch client-writable thread fields (title / model / autoAccept — status/session are engine-owned). */
export const updateAssistantThread = (
  id: string,
  update: AssistantThreadUpdateInput,
): Promise<AssistantThread> => apiPut<AssistantThread>(`/api/assistant/threads/${id}`, update);

/** Send a user message. Returns once the API has accepted + queued it (202) — the reply (and every
 *  intermediate tool call) surfaces on the thread's SSE stream, never in this response. */
export const sendAssistantMessage = (
  id: string,
  text: string,
  envelope?: AssistantContextEnvelope,
): Promise<void> =>
  apiPost<{ ok: true }>(`/api/assistant/threads/${id}/messages`, { text, envelope }).then(
    () => undefined,
  );

/** Interrupt the in-flight turn (idempotent — the session stays warm for the next message). */
export const stopAssistantThread = (id: string): Promise<void> =>
  apiPost<{ ok: true }>(`/api/assistant/threads/${id}/stop`, {}).then(() => undefined);

/**
 * WP 3.3 (D-AS14) — the ONLY way a thread's auth source ever changes: an explicit owner action after a
 * `limit_error` banner's "Retry on …" button, never a silent fallback. 400 if `source` already matches
 * the thread's current one; 409 if the target source isn't configured. Returns the updated thread; the
 * retried turn's events (if the thread had a prior message) surface on the SSE stream as usual.
 */
export const retrySourceAssistantThread = (
  id: string,
  source: AssistantAuthSource,
): Promise<AssistantThread> =>
  apiPost<AssistantThread>(`/api/assistant/threads/${id}/retry-source`, { source });

/** Decide a pending gated-write approval (WP 2.1) — allow (optionally with owner-edited input) or
 *  deny. Resolves the agent's blocked tool call; the settled `permission_decision` arrives on the
 *  SSE stream, not in this response. 404 if no such request is still pending on the thread. */
export const sendAssistantPermissionDecision = (
  id: string,
  decision: AssistantPermissionDecisionInput,
): Promise<void> =>
  apiPost<{ ok: true }>(`/api/assistant/threads/${id}/permission`, decision).then(() => undefined);

/** The dock's model picker roster (`ASSISTANT_DEFAULT_MODEL_ROSTER`, env-overridable). */
export const getAssistantModels = (): Promise<AssistantModelsResponse> =>
  apiGet<AssistantModelsResponse>("/api/assistant/models");

/**
 * WP R3.2 — the dock empty-state's data-aware session-starter chips (`GET /api/assistant/starters`,
 * built in WP R3.1). Mirrors `estimateRunPlan`'s `URLSearchParams` construction: each field is
 * appended only when present (mirrors the query schema's all-optional fields — `assistantStartersQuerySchema`
 * in `packages/shared`), never sent as an empty string. Pass primitives (not the `AssistantContextEnvelope`
 * object itself), so a caller keying a fetch effect off this call's inputs can key off stable values
 * instead of a fresh object reference every render (see `AssistantDock.tsx`'s `useAssistantStarters`).
 */
export const getAssistantStarters = (envelope: {
  entityKind?: string;
  entityId?: string;
  tab?: string;
  route?: string;
}): Promise<AssistantStartersResponse> => {
  const params = new URLSearchParams();
  if (envelope.entityKind) params.set("entityKind", envelope.entityKind);
  if (envelope.entityId) params.set("entityId", envelope.entityId);
  if (envelope.tab) params.set("tab", envelope.tab);
  if (envelope.route) params.set("route", envelope.route);
  const qs = params.toString();
  return apiGet<AssistantStartersResponse>(`/api/assistant/starters${qs ? `?${qs}` : ""}`);
};

/**
 * Subscribe to a thread's server-sent {@link AssistantStreamFrame} stream — the durable persisted
 * event log (replayed first) followed by live frames: settled `AssistantEvent`s (each carrying a
 * monotonic `seq`) and transient, never-persisted `assistant_delta` text fragments. Mirrors
 * {@link openRunStream} exactly, with one protocol difference the caller must account for: an
 * assistant thread has **no terminal status** — the API keeps this stream open indefinitely (until
 * the client disconnects or the thread is deleted), unlike a run's stream, which the server itself
 * closes at the run's terminal `status`. `onError` fires both on a genuine drop and on the browser's
 * own reconnect-eligible close; see `use-assistant-stream.ts` for how it tells those apart.
 *
 * `onReplayComplete` (WP 3.1, D-AS8/D-AS16) fires once the server has finished writing the durable
 * replay and switched to forwarding live frames (a named `replay_complete` SSE event — NOT a member
 * of `AssistantStreamFrame`, so it never reaches `on`). It re-fires on every reconnect (each one
 * replays the persisted log again before resuming live) — callers that only care about the FIRST
 * replay/live boundary should track that themselves. This is the one signal a `ui_action` event needs
 * to tell "already-settled history" (render an inert chip) from "just happened" (navigate instantly).
 */
export function openAssistantStream(
  threadId: string,
  on: (frame: AssistantStreamFrame) => void,
  onError?: (event: Event) => void,
  onReplayComplete?: () => void,
): () => void {
  const es = new EventSource(`/api/assistant/threads/${threadId}/stream`);
  es.onmessage = (message) => {
    on(JSON.parse(message.data) as AssistantStreamFrame);
  };
  if (onReplayComplete) {
    es.addEventListener("replay_complete", () => onReplayComplete());
  }
  es.onerror = (event) => {
    onError?.(event);
  };
  return () => es.close();
}

// ── Assistant — live skill-workspace read routes (WP R1.3, consumed by WP R1.4) ────────────────
// The LIVE (on-disk) view of a skill workspace the agent has open on a thread — never the DB, never a
// secret, skill files only (see `assistant/workspace.ts`'s path-traversal discipline). Both 400 (no
// open workspace for this skill on this thread) and 404 (unknown thread / unknown file path) come back
// as a typed `ApiError`; the R1.4 Files-view hook (`features/skills/use-live-skill-workspace.ts`)
// treats a 400 here as the normal "not live" signal, never a hard error.

/** The live, possibly-agent-edited file tree for one skill's open workspace on this thread. */
export const getAssistantWorkspaceFiles = (
  threadId: string,
  skillId: string,
): Promise<AssistantWorkspaceFilesResponse> =>
  apiGet<AssistantWorkspaceFilesResponse>(
    `/api/assistant/threads/${threadId}/workspace/${skillId}/files`,
  );

/** One file's live content straight off the workspace directory (inline text, or a binary flag+size). */
export const getAssistantWorkspaceFile = (
  threadId: string,
  skillId: string,
  path: string,
): Promise<AssistantWorkspaceFileContent> =>
  apiGet<AssistantWorkspaceFileContent>(
    `/api/assistant/threads/${threadId}/workspace/${skillId}/file?path=${encodeURIComponent(path)}`,
  );

// ── MCP × Model compatibility heatmap (WP 5.4) ─────────────────────────────────────────────────
// Read-only views over the static compatibility engine (Phase 5). The model roster + the resolved
// heatmap come straight from the API (apps/api/src/compatibility/routes.ts); the web only ever picks
// columns + toggles and renders the result. `CompatibilityHeatmap` is the shared wire type; the model
// roster carries a richer column-picker shape than the heatmap's slim `CompatibilityModelRef`.

/** One model in the heatmap column picker (`GET /api/compatibility/models`). */
export type CompatibilityModelOption = {
  id: string;
  providerId: string;
  providerName: string;
  displayName: string;
  group: string;
  status: string | null;
  contextWindow: number | null;
};

/** The dataset model roster for the heatmap column picker — grouped by provider in the UI. */
export const getCompatibilityModels = (): Promise<{ models: CompatibilityModelOption[] }> =>
  apiGet<{ models: CompatibilityModelOption[] }>("/api/compatibility/models");

/** Optional heatmap query knobs. Omit `models` to let the API apply its default column set. */
export type CompatibilityHeatmapParams = {
  /** Dataset model ids for the columns; omit (or empty) → the server's default set. */
  models?: string[];
  /** Row subject: one server row, or one row per tool. Defaults to `server`. */
  view?: "server" | "tool";
  /** Server-cell roll-up over tool rows. Defaults to `worst-tool`. */
  rollup?: "worst-tool" | "average-tool";
  /** Optional host-client target enabling the client-layer tests (e.g. `cursor`). */
  client?: string;
  /** Extra scan ids folded into the aggregate "environment" totals. */
  envScans?: string[];
};

/** The resolved Server×Model / Tool×Model heatmap for one scan. */
export function getCompatibilityHeatmap(
  scanId: string,
  params: CompatibilityHeatmapParams = {},
): Promise<CompatibilityHeatmap> {
  const query = new URLSearchParams();
  if (params.models && params.models.length > 0) query.set("models", params.models.join(","));
  if (params.view) query.set("view", params.view);
  if (params.rollup) query.set("rollup", params.rollup);
  if (params.client) query.set("client", params.client);
  if (params.envScans && params.envScans.length > 0)
    query.set("envScans", params.envScans.join(","));
  const qs = query.toString();
  return apiGet<CompatibilityHeatmap>(`/api/scans/${scanId}/heatmap${qs ? `?${qs}` : ""}`);
}

// ── Per-test report (the "Tests" tab on a server / tool) ───────────────────────────────────────
// Grouped by test, each carrying its per-model outcome. Server-level tests for a server; tool-level
// tests for one tool. Omit `models` for the full roster.

function testsQuery(models?: string[]): string {
  return models && models.length > 0 ? `?models=${encodeURIComponent(models.join(","))}` : "";
}

export const getServerTests = (
  scanId: string,
  models?: string[],
): Promise<CompatibilityTestReport> =>
  apiGet<CompatibilityTestReport>(`/api/scans/${scanId}/tests${testsQuery(models)}`);

export const getToolTests = (
  scanId: string,
  toolName: string,
  models?: string[],
): Promise<CompatibilityTestReport> =>
  apiGet<CompatibilityTestReport>(
    `/api/scans/${scanId}/tools/${encodeURIComponent(toolName)}/tests${testsQuery(models)}`,
  );

/**
 * Tool-level findings aggregated for the server Overview (`byTest`, with the offending tools) and the
 * tool-list "Issues" column (`byTool` severity tally). One call powers both — the single test-driven
 * findings model, transposed.
 */
export const getToolFindings = (scanId: string, models?: string[]): Promise<ToolFindingsReport> =>
  apiGet<ToolFindingsReport>(`/api/scans/${scanId}/tool-findings${testsQuery(models)}`);

// ── Server-level Export Report (HTML → print-to-PDF) ───────────────────────────────────────────
// One aggregated payload (server profile + scan footprint + ALL server tests + tool findings + the
// per-tool report for every flagged tool) for the print-optimized report view. `models` is the
// user-selected set from the export dialog; `client` an optional host-client target.

export const getServerReport = (
  scanId: string,
  models?: string[],
  client?: string,
): Promise<ServerReport> => {
  const query = new URLSearchParams();
  if (models && models.length > 0) query.set("models", models.join(","));
  if (client) query.set("client", client);
  const qs = query.toString();
  return apiGet<ServerReport>(`/api/reports/server/${scanId}${qs ? `?${qs}` : ""}`);
};

// ── Skills registry: list + mutating client wrappers (WP 1.6) ──────────────────────────────────
// The list + create/probe/update/delete/pull helpers for the Skills view. The read-only inspector
// helpers (versions/files/file/export/upstream) live in features/skills/skills-inspector-api.ts
// (WP 1.7) to keep the two web work packages off each other's files; both reuse these fetch
// wrappers. All network/filesystem/git work + the GitHub PAT stay in the API — the web only ever
// sends a redacted request and receives the redacted `Skill` (GitHub binding carries `hasAuth`, no
// PAT). Wire shapes come from @mcp-token-footprint/shared; the web never redefines them.

/** Every registered skill (redacted). The rail sorts by display name. */
export const listSkills = (): Promise<Skill[]> => apiGet<Skill[]>("/api/skills");

/**
 * UX WP 3.3 (G11/S20) — a skill's usage across the app: the environments it is attached to + its
 * most-recent runs (`GET /api/skills/:id/usage`). Read-only over `scenario_skills` + `run_skills`;
 * powers the skill Overview usage panel + the one-click "Test this skill" launch.
 */
export const getSkillUsage = (id: string): Promise<SkillUsage> =>
  apiGet<SkillUsage>(`/api/skills/${id}/usage`);

/** Create a skill from an uploaded `.zip` or bare `SKILL.md` (multipart). Returns the new skill. */
export const createSkillFromUpload = (file: File, displayName?: string): Promise<Skill> =>
  apiUpload<Skill>("/api/skills", file, displayName ? { displayName } : {});

/** Probe a GitHub repo/ref for SKILL.md dirs before creating (no persistence). `token` = optional PAT. */
export const probeSkillRepo = (
  repoUrl: string,
  ref: string,
  token?: string,
): Promise<SkillRepoProbe> =>
  apiPost<SkillRepoProbe>("/api/skills/probe", {
    repoUrl,
    ref,
    ...(token ? { auth: { token } } : {}),
  });

/** Create a skill from a discovered GitHub subpath. The PAT (if any) is encrypted server-side. */
export const createSkillFromGithub = (input: {
  repoUrl: string;
  ref: string;
  subpath: string;
  token?: string;
  displayName?: string;
}): Promise<Skill> =>
  apiPost<Skill>("/api/skills", {
    source: "github",
    repoUrl: input.repoUrl,
    ref: input.ref,
    subpath: input.subpath,
    ...(input.token ? { auth: { token: input.token } } : {}),
    ...(input.displayName ? { displayName: input.displayName } : {}),
  });

/**
 * Create a skill from the wizard's Blank source (SkillFlow D3): a plain JSON body — `name` +
 * `description` (+ optional `displayName`) — no multipart. The API scaffolds a minimal, spec-valid
 * `SKILL.md` and registers it as version 1 through the same ingest path uploads use.
 */
export const createSkillFromBlank = (input: {
  name: string;
  description: string;
  displayName?: string;
}): Promise<Skill> =>
  apiPost<Skill>("/api/skills", {
    source: "blank",
    name: input.name,
    description: input.description,
    ...(input.displayName ? { displayName: input.displayName } : {}),
  });

/**
 * Rename a skill and/or (GitHub skills) edit its source config: retarget the repo URL / ref /
 * subpath, and set (`auth: { token }`) or clear (`auth: null`) the stored PAT. Retargeting only
 * changes what pull/upstream/push track — existing versions are untouched.
 */
export const updateSkill = (
  id: string,
  update: {
    displayName?: string;
    github?: {
      repoUrl?: string;
      ref?: string;
      subpath?: string;
      auth?: { token: string } | null;
    };
  },
): Promise<Skill> => apiPut<Skill>(`/api/skills/${id}`, update);

/** Delete a skill and all its versions (204 No Content). */
export const deleteSkill = (id: string): Promise<void> => apiDelete(`/api/skills/${id}`);

/**
 * Pull the tracked ref for a GitHub skill: `{ unchanged: true }` when the sha/tree matches, else a
 * newly-created `SkillVersion`. The API is the only side that touches git.
 */
export const pullSkill = (id: string): Promise<SkillVersion | { unchanged: true }> =>
  apiPost<SkillVersion | { unchanged: true }>(`/api/skills/${id}/pull`, {});

// ── App-wide GitHub account (Settings sign-in via the OAuth device flow) ────────────────────────
// The access token lives ONLY in the API (stored encrypted, never returned); the web only ever sees
// the redacted `GithubAccountStatus`, the human user code, and the opaque `flowId` poll handle.
// Skill GitHub operations use the account as the LAST token fallback: dialog → per-skill → account.

/** The redacted account state (identity + scopes — never the token). */
export const getGithubAccount = (): Promise<GithubAccountStatus> =>
  apiGet<GithubAccountStatus>("/api/github/account");

/** Configure the owner-registered GitHub OAuth App client id (public config, not a secret). */
export const setGithubClientId = (clientId: string): Promise<GithubAccountStatus> =>
  apiPut<GithubAccountStatus>("/api/github/client-id", { clientId });

/** Start a device flow: show `userCode` at `verificationUri`, then poll with the `flowId`. */
export const startGithubDeviceFlow = (): Promise<GithubDeviceStart> =>
  apiPost<GithubDeviceStart>("/api/github/device/start", {});

/** One poll of an in-flight device flow (wait the returned `interval` seconds between calls). */
export const pollGithubDeviceFlow = (flowId: string): Promise<GithubDevicePoll> =>
  apiPost<GithubDevicePoll>("/api/github/device/poll", { flowId });

/** Sign out of the app-wide GitHub account (keeps the configured client id). */
export const disconnectGithubAccount = async (): Promise<GithubAccountStatus> => {
  const response = await fetch("/api/github/account", { method: "DELETE" });
  return readResponse<GithubAccountStatus>(response);
};

// ── Benchmarks: run grades + default judge (WP 1.4) ────────────────────────────────────────────
// Thin, typed wrappers over the additive grading routes (apps/api/src/grading/routes.ts). All grading
// stays in the API — a re-grade only reads the persisted run + expectations and (for the LLM judge)
// makes one provider call; the web never grades. Wire shapes come from @mcp-token-footprint/shared.
// The judge settings carry references only (a provider-credential id + model), never key material.

/** A run's append-only grade history plus the newest row per grader (`GET /api/runs/:id/grades`). */
export const getRunGrades = (runId: string): Promise<{ grades: RunGrade[]; latest: RunGrade[] }> =>
  apiGet<{ grades: RunGrade[]; latest: RunGrade[] }>(`/api/runs/${runId}/grades`);

/** Re-grade a run (append-only). Omit `graderIds` to re-run every grader, or pass a subset. */
export const regradeRun = (
  runId: string,
  graderIds?: GraderId[],
): Promise<{ inserted: RunGrade[] }> =>
  apiPost<{ inserted: RunGrade[] }>(`/api/runs/${runId}/grade`, graderIds ? { graderIds } : {});

/**
 * The configured provider judge (references only) + the resolved judge source (Auto-Rating WP 2.3):
 * CLI availability, the resolved CLI model, and which source rates a run now. The subscription token is
 * never exposed.
 */
export const getJudgeSettings = (): Promise<JudgeSettingsResolved> =>
  apiGet<JudgeSettingsResolved>("/api/grading/judge-settings");

/**
 * Set the judge. The provider `settings` are stored (a 400 rejects an unpriced PROVIDER model, surfaced
 * as an `ApiError`); the optional `cliModel` persists the Claude-CLI judge model (a subscription, cost 0,
 * not pricing-guarded). Returns the refreshed resolved state.
 */
export const putJudgeSettings = (update: JudgeSettingsUpdate): Promise<JudgeSettingsResolved> =>
  apiPut<JudgeSettingsResolved>("/api/grading/judge-settings", update);

// ── Benchmarks: suites (WP 3.1/3.2/3.3) — CRUD + mass-run control + live SSE ────────────────────
// Thin, typed wrappers over the additive `/api/suites*` + `/api/suite-runs*` routes (apps/api/src/
// suites/routes.ts). Wire shapes come from @mcp-token-footprint/shared; the web never redefines them.
// The suite console (SuiteRunConsole) starts a run with `runSuite`, then observes its matrix over the
// SSE stream via `openSuiteRunStream` — the direct analogue of `startRun` + `openRunStream`.

/** Every suite (ordered member tests + default scenario set + execution config). */
export const listSuites = (): Promise<Suite[]> => apiGet<Suite[]>("/api/suites");

/** One suite by id (404s when unknown, surfaced via {@link ApiError}). */
export const getSuite = (id: string): Promise<Suite> => apiGet<Suite>(`/api/suites/${id}`);

/** Create a suite; the API assigns the id + timestamps and fills the config's bounded defaults. */
export const createSuite = (input: SuiteInput): Promise<Suite> =>
  apiPost<Suite>("/api/suites", input);

/** Replace a suite (PUT takes the full SuiteInput, like the API route). */
export const updateSuite = (id: string, input: SuiteInput): Promise<Suite> =>
  apiPut<Suite>(`/api/suites/${id}`, input);

/** Delete a suite (204 No Content). */
export const deleteSuite = (id: string): Promise<void> => apiDelete(`/api/suites/${id}`);

/**
 * Start a mass-run of a suite — snapshots the config, creates the `suite_runs` row (pending→running),
 * kicks the orchestrator off async, and returns the running {@link SuiteRun} immediately (202). Errors
 * during the matrix surface as cell/status events on the stream, never here.
 */
export const runSuite = (id: string): Promise<SuiteRun> =>
  apiPost<SuiteRun>(`/api/suites/${id}/run`, {});

/** Suite-run history (newest first), optionally scoped to one suite. */
export const listSuiteRuns = (suiteId?: string): Promise<SuiteRun[]> =>
  apiGet<SuiteRun[]>(`/api/suite-runs${suiteId ? `?suiteId=${encodeURIComponent(suiteId)}` : ""}`);

/** One suite run by id — the persisted snapshot (status + cached aggregates). */
export const getSuiteRun = (id: string): Promise<SuiteRun> =>
  apiGet<SuiteRun>(`/api/suite-runs/${id}`);

/** Request that a running suite run stop (halts scheduling + aborts in-flight children → `stopped`). */
export const stopSuiteRun = (id: string): Promise<void> =>
  apiPost<void>(`/api/suite-runs/${id}/stop`, {});

/** Delete a suite run (204). The child runs are kept — only the `suite_runs` row is removed. */
export const deleteSuiteRun = (id: string): Promise<void> => apiDelete(`/api/suite-runs/${id}`);

/**
 * A suite run's DERIVED analytics (WP 3.4, B9.2–B9.3) — the quality×cost `scatter` (one point per
 * test×scenario subject, repetitions averaged) + metadata `breakdowns` (category/difficulty/tag ×
 * scenario), computed fresh from the child runs + grades + test metadata (`GET
 * /api/suite-runs/:id/analytics`). `grader` selects the score dimension (omit for the default
 * primary-grader priority; the scatter's Y-axis selector re-fetches with a specific grader id). Honestly
 * empty (`{scatter:[],breakdowns:[]}`) when no child run has a grade yet.
 */
export const getSuiteAnalytics = (id: string, grader?: string): Promise<SuiteAnalytics> =>
  apiGet<SuiteAnalytics>(
    `/api/suite-runs/${id}/analytics${grader ? `?grader=${encodeURIComponent(grader)}` : ""}`,
  );

/**
 * A suite run's MEMBER runs (`GET /api/suite-runs/:id/members`) — one {@link SuiteRunMember} per
 * executed test × scenario × repetition, each a persisted child run enriched with its selected-grader
 * `score`. Materialises IDENTICALLY for a live and a FINISHED suite run (read from persisted state), so
 * the console can show what actually executed + seed the matrix even after the per-cell SSE stream is
 * gone. `grader` selects the score dimension (omit for the default primary-grader priority).
 */
export const getSuiteRunMembers = (id: string, grader?: string): Promise<SuiteRunMember[]> =>
  apiGet<SuiteRunMember[]>(
    `/api/suite-runs/${id}/members${grader ? `?grader=${encodeURIComponent(grader)}` : ""}`,
  );

/**
 * Trigger OPT-IN failure-bucket clustering (WP 3.5, B9.4) — ONE judge call that clusters the suite run's
 * low-score judge reasons into a failure taxonomy, persisted onto the suite run's DERIVED aggregates
 * (`POST /api/suite-runs/:id/failure-buckets`). This COSTS money (a judge call) and NEVER runs unprompted;
 * the cost lands on the grading-side aggregate `judgeCostUsd` (never a run's cost). Returns the updated
 * {@link SuiteRun} whose `aggregates.failureBuckets` now carry the taxonomy (an empty array = nothing
 * scored below the threshold). 400 if no priced default judge is configured.
 */
export const triggerFailureBuckets = (id: string): Promise<SuiteRun> =>
  apiPost<SuiteRun>(`/api/suite-runs/${id}/failure-buckets`, {});

/**
 * A skill-effect suite run's per-test DELTAS (WP 5.1, B14) — each variant's grade/tokens/cost MINUS the
 * `base` variant's, meaned over repetitions, DERIVED from the child runs + grades + the config-snapshot
 * variant definitions (`GET /api/suite-runs/:id/deltas?base=`). `base` names the base variant by label
 * (omit for the first variant). Honestly empty (`[]`) for a suite run with no variants; an unknown base
 * → 404 (surfaced via {@link ApiError}).
 */
export const getSuiteDeltas = (id: string, base?: string): Promise<SuiteDeltaRow[]> =>
  apiGet<SuiteDeltaRow[]>(
    `/api/suite-runs/${id}/deltas${base ? `?base=${encodeURIComponent(base)}` : ""}`,
  );

/**
 * Auto-Rating (WP 4.3, AR7) — the LATEST persisted cross-run {@link SuiteReport} for a suite run (`GET
 * /api/suite-runs/:id/report`), a pure read (never generates one). `null` when none has landed yet
 * (fewer than 2 members, AR7, or generation hasn't finished) — the API 404s in that case; this mirrors
 * {@link getSkillUpstreamSafe}'s "404 = an honest absence" convention (the caller only ever asks this
 * for an already-resolved suite run, so a 404 here can only mean "no report").
 */
export async function getSuiteReport(suiteRunId: string): Promise<SuiteReport | null> {
  try {
    return await apiGet<SuiteReport>(`/api/suite-runs/${suiteRunId}/report`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

/**
 * The `POST /api/suite-runs/:id/report` (regenerate) result. `report: null` is an HONEST no-op — the
 * AR7 ≥2-member gate wasn't met (`insufficient_members`) or generation otherwise produced nothing (e.g.
 * a raced delete mid-generation, `generation_failed`) — NEVER a thrown error (AR11: rating never fails
 * the suite run).
 */
export type SuiteReportRegenerateResult =
  | { report: SuiteReport }
  | { report: null; reason: "insufficient_members" | "generation_failed" };

/**
 * Regenerate the suite run's cross-run report. APPEND-ONLY (a fresh row is inserted; prior rows are
 * kept, the latest wins) — mirrors {@link regradeRun}. Never blocks/fails/mutates the suite run itself.
 */
export const regenerateSuiteReport = (suiteRunId: string): Promise<SuiteReportRegenerateResult> =>
  apiPost<SuiteReportRegenerateResult>(`/api/suite-runs/${suiteRunId}/report`, {});

/**
 * Download URLs for a finished suite run's report (plain `<a>` nav; the API sets content-disposition).
 * `embed` controls per-member depth: `summary` (default) carries every cell's tokens/cost/score;
 * `full` additionally embeds each member's complete run report (steps/events) — the "actual details".
 */
export const suiteRunReportMarkdownHref = (id: string, embed?: SuiteRunReportEmbed): string =>
  `/api/reports/suite-run/${id}/markdown${embed === "full" ? "?embed=full" : ""}`;
export const suiteRunReportJsonHref = (id: string, embed?: SuiteRunReportEmbed): string =>
  `/api/reports/suite-run/${id}/json${embed === "full" ? "?embed=full" : ""}`;

/**
 * Subscribe to a suite run's server-sent {@link SuiteRunEvent} stream — the direct analogue of
 * {@link openRunStream}. Each message's `data` is one JSON-encoded event; `on` is called per event in
 * order. `onError` fires both on a real mid-run drop AND at end-of-run (the API ends a finished stream
 * by simply closing the socket, which the browser reports as an `error`). The native `EventSource`
 * auto-reconnects on any such non-fatal disconnect, so the CALLER must distinguish the terminal
 * end-of-run close from a real failure and call the returned cleanup (which `close()`s the stream and
 * halts the auto-reconnect). The `useSuiteStream` hook does exactly this (closes on the terminal
 * `status` event, dedupes a reconnect's replay by `seq`) AND (Unified Sessions WP2.2, D-US8) runs its
 * own 45s staleness watchdog that calls this function again on a fresh `EventSource` if the stream
 * goes silent that long while pre-terminal — see that hook's `WATCHDOG_STALE_MS` doc for why this
 * stream's watchdog is message-aware rather than ping-aware (the suite SSE route, unlike the run
 * stream's, has no real `{type:"ping"}` event yet). The cleanup also closes the stream on unmount.
 */
export function openSuiteRunStream(
  suiteRunId: string,
  on: (event: SuiteRunEvent) => void,
  onError?: (event: Event) => void,
): () => void {
  const es = new EventSource(`/api/suite-runs/${suiteRunId}/stream`);
  es.onmessage = (message) => {
    on(JSON.parse(message.data) as SuiteRunEvent);
  };
  es.onerror = (event) => {
    onError?.(event);
  };
  return () => es.close();
}

// ── Benchmarks: collections + two-way git sync (WP 4.1/4.2/4.4, B10/B11/B13) ─────────────────────
// Thin, typed wrappers over the additive `/api/collections*` routes (apps/api/src/collections/
// routes.ts). CRUD returns REDACTED collections — `hasPat` boolean, NEVER the PAT value. The write-
// only `pat` rides in the CollectionInput body; the API encrypts it and never returns it. Sync /
// status / resolve drive the real-git engine and return CollectionSyncResult / CollectionSyncState.
// `Collection`/`CollectionInput`/`CollectionSyncState`/`CollectionSyncResult`/`SyncConflict` all live
// in @mcp-token-footprint/shared; only the two request-shaped types below are API-local.

/**
 * One conflicted-file resolution posted to `POST /api/collections/:id/resolve` (a WP-4.2 request-only
 * shape kept LOCAL to the API — the responses it produces, `SyncConflict`/`CollectionSyncResult`, are
 * in shared). `content` is required only for `edited`; `take-local`/`take-remote` read the staged
 * sides server-side.
 */
export type ConflictResolutionInput = {
  path: string;
  resolution: "take-local" | "take-remote" | "edited";
  content?: string;
};

/** The InsightBench import result (`POST /api/collections/import/insightbench`) — API-local shape. */
export type InsightBenchImportResult = {
  suiteId: string;
  /** ids of the tests CREATED by this import (empty on a fully-deduped re-import). */
  testIds: string[];
  created: number;
  skipped: number;
};

/** Every collection (redacted — `hasPat` only, never the PAT). Newest-updated first. */
export const listCollections = (): Promise<Collection[]> =>
  apiGet<Collection[]>("/api/collections");

/** One collection by id (404s when unknown, surfaced via {@link ApiError}). */
export const getCollection = (id: string): Promise<Collection> =>
  apiGet<Collection>(`/api/collections/${id}`);

/** Create/bind a collection. `input.pat` is write-only — encrypted server-side, never returned. */
export const createCollection = (input: CollectionInput): Promise<Collection> =>
  apiPost<Collection>("/api/collections", input);

/** Update a collection. Omitting `pat` keeps the stored one; an empty `pat` clears it. */
export const updateCollection = (id: string, input: CollectionInput): Promise<Collection> =>
  apiPut<Collection>(`/api/collections/${id}`, input);

/** Delete a collection (204). Its members become local-only (collection link + external key cleared). */
export const deleteCollection = (id: string): Promise<void> => apiDelete(`/api/collections/${id}`);

/** Attach a test to a collection (re-keys its cross-system identity); returns the redacted collection. */
export const assignTestToCollection = (collectionId: string, testId: string): Promise<Collection> =>
  apiPost<Collection>(`/api/collections/${collectionId}/tests/${testId}`, {});

/** Detach a test from a collection → local-only (204). The API keys removal off the test id. */
export const removeTestFromCollection = (collectionId: string, testId: string): Promise<void> =>
  apiDelete(`/api/collections/${collectionId}/tests/${testId}`);

/** Attach a suite to a collection (re-keys its cross-system identity); returns the redacted collection. */
export const assignSuiteToCollection = (
  collectionId: string,
  suiteId: string,
): Promise<Collection> =>
  apiPost<Collection>(`/api/collections/${collectionId}/suites/${suiteId}`, {});

/** Detach a suite from a collection → local-only (204). The API keys removal off the suite id. */
export const removeSuiteFromCollection = (collectionId: string, suiteId: string): Promise<void> =>
  apiDelete(`/api/collections/${collectionId}/suites/${suiteId}`);

/**
 * Run the two-way git sync for a collection: export members → commit → fetch → merge → reconcile →
 * push. On a merge conflict it returns `status: "conflicts"` with the per-file diff and does NOT
 * push — route the user to conflict resolution and call {@link resolveCollection} to finish.
 */
export const syncCollection = (id: string): Promise<CollectionSyncResult> =>
  apiPost<CollectionSyncResult>(`/api/collections/${id}/sync`, {});

/** Live sync state (ahead/behind/dirty + any in-progress conflicts) without mutating history. */
export const getCollectionStatus = (id: string): Promise<CollectionSyncState> =>
  apiGet<CollectionSyncState>(`/api/collections/${id}/status`);

/** Finish a conflicted sync with the chosen per-file resolutions (take-local/take-remote/edited). */
export const resolveCollection = (
  id: string,
  resolutions: ConflictResolutionInput[],
): Promise<CollectionSyncResult> =>
  apiPost<CollectionSyncResult>(`/api/collections/${id}/resolve`, { resolutions });

/**
 * Import a colleague's InsightBench `questions.json` (read + parsed client-side) into graded tests +
 * one suite, optionally assigned to `collectionId`. Idempotent server-side — an identical re-import
 * creates 0 tests and reuses the existing suite. `questions` is the parsed file content (array of app
 * groups, or a single group / wrapper); the API defensively normalizes it.
 */
export const importInsightBench = (
  collectionId: string | null,
  questions: unknown,
): Promise<InsightBenchImportResult> =>
  apiPost<InsightBenchImportResult>("/api/collections/import/insightbench", {
    ...(collectionId ? { collectionId } : {}),
    questions,
  });

// ── Rating Issues registry (auto-learning loop) ───────────────────────────────────────────────────
// Self-contained additive block (its OWN `import type` so a concurrent wave's edits to this module
// never collide — the same pattern skills-inspector-api.ts uses). Read routes + ONE manual lifecycle
// write (`PATCH /api/issues/:id` resolve / re-open); issue CREATION happens only in the API's
// post-rating hook, never from the web. Wire shapes come from @mcp-token-footprint/shared.
import type {
  RatingIssue,
  RatingIssueStatus,
  RatingIssueTargetKind,
} from "@mcp-token-footprint/shared";

/** PATCH helper — mirrors `apiPost`/`apiPut`; first consumer is the issue-status toggle. */
export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return readResponse<T>(response);
}

/** The skill's deduplicated rating issues (occurrences included) — `GET /api/skills/:id/issues`. */
export const getSkillIssues = (skillId: string): Promise<RatingIssue[]> =>
  apiGet<{ issues: RatingIssue[] }>(`/api/skills/${skillId}/issues`).then(
    (response) => response.issues,
  );

/** The server's deduplicated rating issues (occurrences included) — `GET /api/servers/:id/issues`. */
export const getServerIssues = (serverId: string): Promise<RatingIssue[]> =>
  apiGet<{ issues: RatingIssue[] }>(`/api/servers/${serverId}/issues`).then(
    (response) => response.issues,
  );

/**
 * Issues this run contributed an occurrence to — `GET /api/issues?runId=…` (the list route's
 * `runId` query filter). Backs the run console Report tab's "Issues filed by this run" section.
 */
export const listIssuesForRun = (runId: string): Promise<RatingIssue[]> =>
  apiGet<{ issues: RatingIssue[] }>(
    `/api/issues?${new URLSearchParams({ runId }).toString()}`,
  ).then((response) => response.issues);

/** Manual resolve / re-open (a resolved issue seen again re-opens automatically server-side). */
export const updateIssueStatus = (
  issueId: string,
  status: RatingIssueStatus,
): Promise<RatingIssue> =>
  apiPatch<RatingIssue>(`/api/issues/${encodeURIComponent(issueId)}`, { status });

/**
 * Download URL for ONE target's issues as a developer-facing attachment
 * (`GET /api/issues/export/{markdown,json}?targetKind=…&targetId=…`) — an `<a href download>` /
 * `<Button asChild>` target, so the browser handles the download natively.
 */
export const issuesExportUrl = (
  format: "markdown" | "json",
  targetKind: RatingIssueTargetKind,
  targetId: string,
): string => {
  const params = new URLSearchParams({ targetKind, targetId });
  return `/api/issues/export/${format}?${params.toString()}`;
};

// ── Fleet issues (roadmap/observability/, WP5.3 — the Issues tab) ─────────────────────────────────
// The WP5.1 fleet-aggregation surface on the SAME `/api/issues` routes above: an unfiltered list (the
// tab filters lifecycle/entity/date CLIENT-SIDE over the full set, same recipe the Testing dashboard
// uses for its own small catalogs) + the one-issue detail + the three lifecycle transitions. Issue
// CREATION/derivation stays server-side (the sweep) — nothing here writes a new issue.

/** Every issue (per-run AR issues AND fleet-clustered ones) — `GET /api/issues` with no filter. The
 *  Issues tab narrows to fleet issues (a `fleet` block present) itself; see `issue-lib.ts` `isFleetIssue`. */
export const listIssues = (signal?: AbortSignal): Promise<RatingIssue[]> =>
  apiGet<{ issues: RatingIssue[] }>("/api/issues", signal).then((response) => response.issues);

/** One issue incl. occurrences (+ its fleet block when clustered) — `GET /api/issues/:id`. */
export const getIssue = (issueId: string, signal?: AbortSignal): Promise<RatingIssue> =>
  apiGet<RatingIssue>(`/api/issues/${encodeURIComponent(issueId)}`, signal);

/** Fleet lifecycle: mark fixed (an optional operator note) — `POST /api/issues/:id/resolve`. A
 *  resolved cluster seen again auto-`regressed`s server-side (the sweep), independent of this call. */
export const resolveIssue = (issueId: string, note?: string): Promise<RatingIssue> =>
  apiPost<RatingIssue>(`/api/issues/${encodeURIComponent(issueId)}/resolve`, note ? { note } : {});

/** Fleet lifecycle: "won't fix" dismissal (an optional operator note) — `POST /api/issues/:id/ignore`. */
export const ignoreIssue = (issueId: string, note?: string): Promise<RatingIssue> =>
  apiPost<RatingIssue>(`/api/issues/${encodeURIComponent(issueId)}/ignore`, note ? { note } : {});

/** Fleet lifecycle: return to `open` (clears any resolution note) — `POST /api/issues/:id/reopen`. */
export const reopenIssue = (issueId: string): Promise<RatingIssue> =>
  apiPost<RatingIssue>(`/api/issues/${encodeURIComponent(issueId)}/reopen`, {});

/**
 * Observability WP5.4 — one issue⇆run VERIFICATION link (a fork re-run launched via the assistant loop
 * to prove a fix). apps/web-local type (SHARED-FREE — a structural mirror of the API's
 * `IssueVerificationRunView`; the assistant loop's wire is additive and doesn't touch `packages/shared`).
 * A verification run is a normal, gradeable run — this link is an annotation only (D-OB15/AR6).
 */
export type IssueVerificationRun = {
  runId: string;
  sourceRunId?: string;
  note?: string;
  at: string;
  /** The derived run's live status/outcome, hydrated server-side (absent when the run was deleted). */
  status?: string;
  outcome?: string;
};

/** An issue's verification runs — `GET /api/issues/:id/verification-runs` (empty until the assistant
 *  loop forks a linked run to prove a fix). Newest last, mirroring how they were recorded. */
export const listIssueVerificationRuns = (
  issueId: string,
  signal?: AbortSignal,
): Promise<IssueVerificationRun[]> =>
  apiGet<{ runs: IssueVerificationRun[] }>(
    `/api/issues/${encodeURIComponent(issueId)}/verification-runs`,
    signal,
  ).then((response) => response.runs);

// ── Observability — metrics (roadmap/observability/, WP 2.2) ───────────────────────────────────
// Thin, typed wrappers over the read-only `GET /api/metrics/{runs,scans}` endpoints (WP1.2, already
// merged — see apps/api/src/observability/{metrics,routes}.ts). The `filter=` param is ALWAYS built
// via the shared `serializeRunFilter` helper (never hand-rolled JSON) so the web's URL state and the
// API agree byte-for-byte, per the WP1.1 contract.

export type RunMetricsQuery = {
  filter: RunFilter;
  from?: string;
  to?: string;
  bucket: MetricsBucket;
  groupBy?: RunMetricsGroupBy;
  measures: RunMetricsMeasure[];
};

/** Time-bucketed, group-able run aggregates (`GET /api/metrics/runs`) — the Testing dashboard's
 *  chart data source. `measures` is comma-joined; `filter` is ALWAYS present (an empty `{}` is a
 *  valid, schema-normalized RunFilter — "no constraint"). */
export function getRunMetrics(
  query: RunMetricsQuery,
  signal?: AbortSignal,
): Promise<RunMetricsResponse> {
  const params = new URLSearchParams();
  params.set("filter", serializeRunFilter(query.filter));
  params.set("bucket", query.bucket);
  params.set("measures", query.measures.join(","));
  if (query.groupBy) params.set("groupBy", query.groupBy);
  if (query.from !== undefined) params.set("from", query.from);
  if (query.to !== undefined) params.set("to", query.to);
  return apiGet<RunMetricsResponse>(`/api/metrics/runs?${params.toString()}`, signal);
}

export type ScanMetricsQuery = {
  from?: string;
  to?: string;
  bucket: MetricsBucket;
  serverId?: string;
};

/** Per-server scan-footprint time series (`GET /api/metrics/scans`) — the dashboard's scans strip. */
export function getScanMetrics(
  query: ScanMetricsQuery,
  signal?: AbortSignal,
): Promise<ScanMetricsResponse> {
  const params = new URLSearchParams();
  params.set("bucket", query.bucket);
  if (query.from !== undefined) params.set("from", query.from);
  if (query.to !== undefined) params.set("to", query.to);
  if (query.serverId !== undefined) params.set("serverId", query.serverId);
  return apiGet<ScanMetricsResponse>(`/api/metrics/scans?${params.toString()}`, signal);
}

/**
 * The `limit` most expensive runs matching `filter` (`GET /api/runs?sort=costUsd:desc&limit=…`) —
 * the Testing dashboard's "most expensive runs" leaderboard (WP 2.2). Reuses the already-merged
 * WP1.1 runs-feed sort/filter contract; no new API surface.
 */
export function getMostExpensiveRuns(
  filter: RunFilter,
  limit: number,
  signal?: AbortSignal,
): Promise<RunSummary[]> {
  const params = new URLSearchParams();
  params.set("filter", serializeRunFilter(filter));
  params.set("sort", "costUsd:desc");
  params.set("limit", String(limit));
  return apiGet<RunSummary[]>(`/api/runs?${params.toString()}`, signal);
}

// ── Observability (WP4.3) — the notification center: the bell in the AppShell header ─────────────
// `notify` watch-action fires -> a persisted Notification -> listed here + live-pushed over SSE.

/** `GET /api/notifications` — filtered, paged, newest first. `unreadCount` is always the GLOBAL
 *  unread total (independent of the filter/page), so the bell's badge stays correct while a filtered
 *  page is showing. */
export function listNotifications(
  query: NotificationListQuery = {},
  signal?: AbortSignal,
): Promise<NotificationListResult> {
  const params = new URLSearchParams();
  if (query.unread !== undefined) params.set("unread", String(query.unread));
  if (query.severity !== undefined) params.set("severity", query.severity);
  if (query.since !== undefined) params.set("since", query.since);
  if (query.until !== undefined) params.set("until", query.until);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.offset !== undefined) params.set("offset", String(query.offset));
  const qs = params.toString();
  return apiGet<NotificationListResult>(`/api/notifications${qs ? `?${qs}` : ""}`, signal);
}

/** Flip one notification to read (the bell's click-to-open + deep-link action). */
export const markNotificationRead = (id: string): Promise<Notification> =>
  apiPost<Notification>(`/api/notifications/${id}/read`, {});

/** Flip every unread notification to read (the bell's "mark all read" footer action). */
export const markAllNotificationsRead = (): Promise<NotificationReadAllResult> =>
  apiPost<NotificationReadAllResult>("/api/notifications/read-all", {});

/**
 * Subscribe to newly-created notifications over SSE (`GET /api/notifications/stream`). No history
 * replay — the bell always loads its current page via {@link listNotifications} on mount/open, so this
 * only needs to push notifications created AFTER the tab connected. Mirrors {@link openRunStream}'s
 * shape (a plain `EventSource`, `onError` for the caller to react to a drop); the heartbeat is a
 * comment-only SSE line (invisible to `onmessage`), so every message here is a real notification.
 */
export function openNotificationStream(
  on: (notification: Notification) => void,
  onError?: (event: Event) => void,
): () => void {
  const es = new EventSource("/api/notifications/stream");
  es.onmessage = (message) => {
    on(JSON.parse(message.data) as Notification);
  };
  es.onerror = (event) => {
    onError?.(event);
  };
  return () => es.close();
}

// ── Observability (WP4.4) — watch rules: CRUD, audit, windowed preview, webhook test-fire ─────────
// Consumes the ALREADY-MERGED WP4.1 (CRUD + actions) / WP4.2 (preview) / WP4.3 (test-fire) API —
// this WP is web-only, no route is added here.

/** Every persisted watch rule (`GET /api/watch-rules`), created-at order. */
export const listWatchRules = (): Promise<WatchRule[]> => apiGet<WatchRule[]>("/api/watch-rules");

/** One rule by id (404s if unknown). */
export const getWatchRule = (id: string): Promise<WatchRule> =>
  apiGet<WatchRule>(`/api/watch-rules/${id}`);

/** Create a rule. A `webhook` action's `url` travels here in plaintext ONCE — the API mints an
 *  opaque `secretRef` and never returns the URL again. */
export const createWatchRule = (input: WatchRuleInput): Promise<WatchRule> =>
  apiPost<WatchRule>("/api/watch-rules", input);

/** Partial update — an omitted field keeps its stored value. Supplying `actions` REPLACES the whole
 *  set (and rotates any webhook secret) — callers should omit `actions` entirely when the Actions
 *  step of the editor was never touched, so an existing webhook secret survives an edit to just the
 *  trigger/filter. */
export const updateWatchRule = (id: string, patch: WatchRulePatch): Promise<WatchRule> =>
  apiPatch<WatchRule>(`/api/watch-rules/${id}`, patch);

/** Delete a rule (204; cascades its audit log + any webhook secret, per the API). */
export const deleteWatchRule = (id: string): Promise<void> => apiDelete(`/api/watch-rules/${id}`);

/** The rule's append-only audit log, newest first (`watch_rule_events`) — drives both the rule
 *  list's "last fired"/"fire count" glance and the editor's Audit tab. */
export const listWatchRuleEvents = (id: string): Promise<WatchRuleEvent[]> =>
  apiGet<WatchRuleEvent[]>(`/api/watch-rules/${id}/events`);

/** Score a windowed rule's config against history WITHOUT saving (`POST /api/watch-rules/preview`,
 *  WP4.2) — the editor's MANDATORY historical-preview step; drives the WP4.4 bar strip. Never
 *  persists anything. */
export const previewWatchWindow = (
  request: WatchWindowPreviewRequest,
): Promise<WatchWindowPreview> => apiPost<WatchWindowPreview>("/api/watch-rules/preview", request);

/** Send a sample payload to a SAVED rule's webhook action (`POST /api/watch-rules/:id/test-fire`,
 *  WP4.3) so an operator can verify the receiving endpoint before relying on it. 400s if the rule
 *  carries no webhook action. Recorded to the same audit log a real fire uses. */
export const testFireWatchRule = (id: string): Promise<WatchRuleEventResult> =>
  apiPost<WatchRuleEventResult>(`/api/watch-rules/${id}/test-fire`, {});

/**
 * Console "Promote to test" (D-OB21) — promotes ONE terminal run directly into a draft test in
 * `collectionId`, via the SAME domain logic WP4.1's `promote_to_test` watch action already uses
 * (`apps/api/src/watch/promote.ts`), reached here on-demand rather than via a recurring rule fire.
 *
 * ⚠️ STUBBED (WP4.4 is web-only; this WP does not touch `apps/api`): `POST /api/runs/:id/promote-
 * to-test` is not registered by any merged API route yet — a rule today only promotes a run
 * automatically, at the post-terminal choke point of a NEW run finishing, matching a saved
 * `on_terminal` rule's filter (it cannot reach back and act on an already-terminal historical run
 * on demand). Wiring this on-demand endpoint is a small API follow-up. The web-side flow (dialog,
 * this client call, the success toast + collection link) is built and tested against a MOCKED
 * fetch so the console affordance is ready the moment that route lands — see
 * `apps/web/src/features/watch/PromoteToTestDialog.test.tsx`.
 */
export const promoteRunToTest = (
  runId: string,
  collectionId: string,
): Promise<{ testId: string }> =>
  apiPost<{ testId: string }>(`/api/runs/${runId}/promote-to-test`, { collectionId });

// ── Observability (WP2.7, D-OB22) — custom chart composer: CRUD, clone, reorder ────────────────────
// Thin wrappers over `/api/dashboard-charts*` (apps/api/src/observability/{dashboard-charts,routes}.ts).
// A chart's LIVE PREVIEW is NOT a separate endpoint — the composer calls `getRunMetrics`/
// `getScanMetrics` directly with the draft config's own params (no second aggregation path).

/** Every persisted custom chart (`GET /api/dashboard-charts`), ordered by `position`. */
export const listDashboardCharts = (): Promise<DashboardChart[]> =>
  apiGet<DashboardChart[]>("/api/dashboard-charts");

export const createDashboardChart = (input: DashboardChartInput): Promise<DashboardChart> =>
  apiPost<DashboardChart>("/api/dashboard-charts", input);

/** A real partial update — an omitted field keeps its stored value. */
export const updateDashboardChart = (
  id: string,
  patch: DashboardChartPatch,
): Promise<DashboardChart> => apiPatch<DashboardChart>(`/api/dashboard-charts/${id}`, patch);

export const deleteDashboardChart = (id: string): Promise<void> =>
  apiDelete(`/api/dashboard-charts/${id}`);

/** A new chart with the SAME config as `id`, appended at the end of the display order. */
export const cloneDashboardChart = (id: string): Promise<DashboardChart> =>
  apiPost<DashboardChart>(`/api/dashboard-charts/${id}/clone`, {});

/** Apply a new display order — `orderedIds` must be exactly the current chart id set (a partial/
 *  foreign/duplicate list 400s server-side; never a silent partial reorder). */
export const reorderDashboardCharts = (orderedIds: string[]): Promise<DashboardChart[]> =>
  apiPost<DashboardChart[]>("/api/dashboard-charts/reorder", { orderedIds });

// ── Scheduled digest report (Observability WP5.5, D-OB22) ──────────────────────────────────────────
// Self-contained additive block (its OWN `import type`, same collision-avoidance pattern as the
// Rating Issues block above). Mirrors the `GET …/{json,markdown}` report-family route shape.
import type {
  DigestGenerateResult,
  DigestReport,
  DigestSchedule,
  DigestWindowKind,
} from "@mcp-token-footprint/shared";

/** Recent digests, newest first (`GET /api/reports/digest[?kind=&limit=]`). */
export const listDigests = (kind?: DigestWindowKind, limit?: number): Promise<DigestReport[]> => {
  const query = new URLSearchParams();
  if (kind) query.set("kind", kind);
  if (limit) query.set("limit", String(limit));
  const qs = query.toString();
  return apiGet<DigestReport[]>(`/api/reports/digest${qs ? `?${qs}` : ""}`);
};

/** One persisted digest, structured (`GET /api/reports/digest/:id/json`) — powers the routed digest view's KPI header. */
export const getDigestReport = (id: string): Promise<DigestReport> =>
  apiGet<DigestReport>(`/api/reports/digest/${id}/json`);

/** The SAME digest, rendered as Markdown text (`GET /api/reports/digest/:id/markdown`) — the digest
 *  view's body, rendered inline via the shared `ChatMarkdown` component. */
export const getDigestMarkdown = (id: string): Promise<string> =>
  apiGetText(`/api/reports/digest/${id}/markdown`);

/** Generate a digest on demand for the given cadence (`POST /api/reports/digest/generate?window=…`),
 *  never flagged `late` — an explicit operator action, not a catch-up. */
export const generateDigest = (window: DigestWindowKind): Promise<DigestGenerateResult> =>
  apiPost<DigestGenerateResult>(`/api/reports/digest/generate?window=${window}`, {});

/** The persisted schedule (`GET /api/reports/digest/schedule`) — off | daily | weekly + the UTC hour. */
export const getDigestSchedule = (): Promise<DigestSchedule> =>
  apiGet<DigestSchedule>("/api/reports/digest/schedule");

/** Save the schedule (`PUT /api/reports/digest/schedule`). */
export const putDigestSchedule = (schedule: DigestSchedule): Promise<DigestSchedule> =>
  apiPut<DigestSchedule>("/api/reports/digest/schedule", schedule);

// ── Assistant Hub (roadmap/assistant-hub/, WP1.2 routes; WP1.3 web client) ─────────────────────────
// Self-contained additive block (its OWN `import type`, mirroring the Digest block above) — sessions +
// SSE only (WP1.3's owned surface); projects/missions/artifacts/memory/library land in later WPs.
import type {
  HubApprovalResolution,
  HubAutonomyLevel,
  HubElicitationAction,
  HubEvent,
  HubSendMessageInput,
  HubSession,
  HubSessionCreateInput,
  HubSessionDetail,
  HubSessionKind,
  HubSessionPatch,
  HubSessionSkillsView,
  HubSkillAttachmentInput,
} from "@mcp-token-footprint/shared";

/**
 * A streaming text/reasoning delta forwarded live over a hub session's SSE stream but NEVER
 * persisted — mirrors the API's internal `HubStreamDeltaFrame` (`apps/api/src/hub/routes.ts`), which
 * isn't exported from `packages/shared` because it deliberately is NOT a `HubEvent` member (the
 * persisted event log holds settled events only — R-SES1). Declared locally here for the same reason.
 */
export type HubStreamDeltaFrame = {
  type: "stream_delta";
  messageId: string;
  channel: "text" | "reasoning";
  text: string;
};

/** One frame off a hub session's SSE stream: a persisted, seq-stamped {@link HubEvent}, or a
 *  transient {@link HubStreamDeltaFrame}. */
export type HubSseFrame = HubEvent | HubStreamDeltaFrame;

/** List sessions, optionally filtered by kind (`chat` for the top-level rail — `agent` child
 *  sessions belong to a mission board, not the rail) and/or project (WP3.1). Most-recently-updated
 *  first (API-side order). */
export const listHubSessions = (filter?: {
  kind?: HubSessionKind;
  projectId?: string;
}): Promise<HubSession[]> => {
  const params = new URLSearchParams();
  if (filter?.kind) params.set("kind", filter.kind);
  if (filter?.projectId) params.set("project", filter.projectId);
  const qs = params.toString();
  return apiGet<HubSession[]>(`/api/hub/sessions${qs ? `?${qs}` : ""}`);
};

/** WP1.4 (D-HUX4, P4) — list sessions for the `/assistant/sessions` table: top-level only
 *  (`parent_session_id IS NULL` — agent child sessions surface via missions/usage, never this table)
 *  and carrying the list-stats projection (`turns`/`lastError`/`archived` — already on `HubSession`,
 *  populated by `GET /api/hub/sessions?topLevelOnly=true`). `includeArchived` is always sent explicitly
 *  (mirrors `listHubAgentRoles`'s "Show archived" toggle) so archived rows show only when asked. */
export const listHubSessionsForTable = (options?: {
  includeArchived?: boolean;
}): Promise<HubSession[]> => {
  const params = new URLSearchParams({
    topLevelOnly: "true",
    includeArchived: options?.includeArchived ? "true" : "false",
  });
  return apiGet<HubSession[]>(`/api/hub/sessions?${params.toString()}`);
};

/** Create a session (mode + model required — `hubSessionCreateInputSchema`); 409 while no hub-eligible
 *  provider credential exists. */
export const createHubSession = (input: HubSessionCreateInput): Promise<HubSession> =>
  apiPost<HubSession>("/api/hub/sessions", input);

/** The session row + its full persisted replay event log (R-SES1) + its mission, if it started one —
 *  hydrates a reopened session before the live stream attaches. */
export const getHubSession = (id: string): Promise<HubSessionDetail> =>
  apiGet<HubSessionDetail>(`/api/hub/sessions/${id}`);

/** Patch client-writable fields (title/model/autonomy — lifecycle fields are engine-owned). */
export const updateHubSession = (id: string, patch: HubSessionPatch): Promise<HubSession> =>
  apiPatch<HubSession>(`/api/hub/sessions/${id}`, patch);

export const deleteHubSession = (id: string): Promise<void> => apiDelete(`/api/hub/sessions/${id}`);

/** Send a user message. Returns once the API has accepted + queued it (202) — the reply (and every
 *  intermediate tool call) surfaces on the session's SSE stream, never in this response. A message
 *  sent while a turn is already running queues durably as steering (R-SES3) instead of erroring. */
export const sendHubMessage = (
  id: string,
  input: HubSendMessageInput,
): Promise<{ sessionId: string; streamUrl: string }> =>
  apiPost<{ sessionId: string; streamUrl: string }>(`/api/hub/sessions/${id}/messages`, input);

/** Interrupt the in-flight turn — cancels the running step but preserves completed work with an
 *  explicit cut-off note (R-SES3); idempotent no-op when nothing is running. */
export const stopHubSession = (id: string): Promise<void> =>
  apiPost<{ ok: true }>(`/api/hub/sessions/${id}/stop`, {}).then(() => undefined);

/** End an idle/settled session (Unified Sessions "End session", D-US2). Refused (409) while a turn is
 *  currently running — Stop it first. */
export const endHubSession = (id: string): Promise<HubSession> =>
  apiPost<HubSession>(`/api/hub/sessions/${id}/end`, {});

export const markHubSessionSeen = (id: string): Promise<void> =>
  apiPost<{ ok: true }>(`/api/hub/sessions/${id}/seen`, {}).then(() => undefined);

// ── Assistant Hub — projects + pinned context (roadmap/assistant-hub/, WP3.1 routes + web client) ──
// Self-contained additive block (its OWN `import type`, mirroring the sibling Hub blocks): the
// D-AH11(c) project library (`hub_projects`) CRUD + a project's PINNED FILES (small user-typed/
// pasted text snippets — `apps/api/src/hub/routes.ts`'s `registerHubProjectRoutes` doc explains why
// this is narrower than a general upload surface). Every member session inherits a project's
// instructions + pinned files via the LAYER 6b prompt injection (`hub/turn-engine.ts`); this block
// is the Projects view's + the session ContextPanel's data surface.
import type {
  HubFile,
  HubFileWithContent,
  HubProject,
  HubProjectInput,
  HubProjectPatch,
  HubProjectPinnedFileInput,
} from "@mcp-token-footprint/shared";

/** The project library, most-recently-updated first (API-side order). */
export const listHubProjects = (): Promise<HubProject[]> =>
  apiGet<HubProject[]>("/api/hub/projects");

export const getHubProject = (id: string): Promise<HubProject> =>
  apiGet<HubProject>(`/api/hub/projects/${id}`);

export const createHubProject = (input: HubProjectInput): Promise<HubProject> =>
  apiPost<HubProject>("/api/hub/projects", input);

/** Also the archive toggle: `{ archived: true }` / `{ archived: false }`. */
export const updateHubProject = (id: string, patch: HubProjectPatch): Promise<HubProject> =>
  apiPatch<HubProject>(`/api/hub/projects/${id}`, patch);

/** Hard delete — sessions/artifacts that reference this project just lose the pin (`ON DELETE SET
 *  NULL`), they are never deleted themselves. */
export const deleteHubProject = (id: string): Promise<void> => apiDelete(`/api/hub/projects/${id}`);

/** Metadata only (no content — mirrors `HubFile`'s own "content is fetched via GET" contract). */
export const listHubProjectFiles = (projectId: string): Promise<HubFile[]> =>
  apiGet<HubFile[]>(`/api/hub/projects/${projectId}/files`);

/** Pin a text snippet to a project (`hubProjectPinnedFileInputSchema` caps filename/content length). */
export const createHubProjectFile = (
  projectId: string,
  input: HubProjectPinnedFileInput,
): Promise<HubFile> => apiPost<HubFile>(`/api/hub/projects/${projectId}/files`, input);

/** The pinned file's metadata WITH its decoded text content — the ContextPanel detail drill-in. */
export const getHubProjectFile = (projectId: string, fileId: string): Promise<HubFileWithContent> =>
  apiGet<HubFileWithContent>(`/api/hub/projects/${projectId}/files/${fileId}`);

export const deleteHubProjectFile = (projectId: string, fileId: string): Promise<void> =>
  apiDelete(`/api/hub/projects/${projectId}/files/${fileId}`);

// ── Live HITL: approvals, elicitation, the autonomy dial (WP2.3, R-MCP3/R-MCP4/D-AH6) ─────────────

/** Decide a pending approval-gated tool call (R-MCP3/R-UX1). 409 if nothing is pending for that id
 *  (a stale/duplicate click, or the turn already resolved it — e.g. a Stop). */
export const decideHubApproval = (
  sessionId: string,
  toolCallId: string,
  resolution: HubApprovalResolution,
): Promise<void> =>
  apiPost<{ ok: true }>(`/api/hub/sessions/${sessionId}/approvals`, {
    toolCallId,
    resolution,
  }).then(() => undefined);

/** Respond to a pending MCP elicitation (R-MCP4). `accept` carries flat-primitive `content`;
 *  `decline`/`cancel` carry none. 409 if nothing is pending for that id. */
export const respondHubElicitation = (
  sessionId: string,
  input: {
    elicitationId: string;
    action: HubElicitationAction;
    content?: Record<string, string | number | boolean | string[]>;
  },
): Promise<void> =>
  apiPost<{ ok: true }>(`/api/hub/sessions/${sessionId}/elicitation`, input).then(() => undefined);

/** Answer a pending agent-initiated `ask_user` question — the chosen option label or free-typed text.
 *  409 if nothing is pending for that id (a stale/duplicate click, or the turn already resolved it). */
export const answerHubQuestion = (
  sessionId: string,
  questionId: string,
  answer: string,
): Promise<void> =>
  apiPost<{ ok: true }>(`/api/hub/sessions/${sessionId}/answers`, { questionId, answer }).then(
    () => undefined,
  );

/** Set the session's autonomy dial (D-AH6) — governs live HITL tool-approval gating. */
export const setHubAutonomy = (id: string, autonomy: HubAutonomyLevel): Promise<HubSession> =>
  apiPatch<HubSession>(`/api/hub/sessions/${id}/autonomy`, { autonomy });

/** Download URL for a session's FULL transcript export
 *  (`GET /api/hub/sessions/:id/report/{json,markdown}`) — the complete ordered event log, every input
 *  and output in sequence. An `<a href download>` / `<Button asChild>` target; the server sets
 *  Content-Disposition so the browser downloads natively. */
export const hubSessionReportUrl = (sessionId: string, format: "json" | "markdown"): string =>
  `/api/hub/sessions/${sessionId}/report/${format}`;

// ── Declarative GenUI two-tier interactivity (WP2.6, R-GUI5) ─────────────────────────────────────

/** Persist a per-message generative-UI CLIENT-state snapshot (a filter/toggle/field edit that must NOT
 *  re-enter the model but MUST replay-rehydrate). Appended as a `ui_state` event; fire-and-forget (202).
 *  A to-ASSISTANT action (Form submit / send Button) instead calls {@link sendHubMessage} with a
 *  dual-audience text (built via the shared `buildGenuiSubmitMessage`). */
export const postHubUiState = (
  sessionId: string,
  input: { messageId: string; key?: string; state: unknown },
): Promise<void> =>
  apiPost<{ ok: true }>(`/api/hub/sessions/${sessionId}/ui-state`, input).then(() => undefined);

// ── Skill attachment (WP2.4, R-SK1…R-SK3/R-SK5/R-SK8) ───────────────────────────────────────────

/** The resolved attachments + the CURRENT L1 listing (budget + per-entry state) + session-true usage
 *  (R-SK5) — the session settings skill panel's one read. */
export const getHubSessionSkills = (id: string): Promise<HubSessionSkillsView> =>
  apiGet<HubSessionSkillsView>(`/api/hub/sessions/${id}/skills`);

/** Replace the session's whole skill-attachment list (delete-then-reinsert — `[]` detaches every
 *  skill). Returns the freshly-resolved view, same shape as the GET. */
export const replaceHubSessionSkills = (
  id: string,
  attachments: HubSkillAttachmentInput[],
): Promise<HubSessionSkillsView> =>
  apiPut<HubSessionSkillsView>(`/api/hub/sessions/${id}/skills`, attachments);

// ── Usage telemetry + context inspector (WP4.1, R-SES7/R-UX6/R-UX8) ────────────────────────────────
// Self-contained additive block, mirroring the Digest/Skills blocks above.
import type {
  HubContextInspector,
  HubUsageAggregates,
  HubUsageGroupBy,
  HubUsageRow,
  HubUsageSummary,
} from "@mcp-token-footprint/shared";

/** Spend/token rollups (by model/provider/mode/day) + the mission list + the R-UX6 plan-acceptance
 *  metric (`GET /api/hub/usage`) — the Usage view's one read. All filters optional. */
export const getHubUsage = (filter?: {
  from?: string;
  to?: string;
  projectId?: string;
}): Promise<HubUsageAggregates> => {
  const query = new URLSearchParams();
  if (filter?.from) query.set("from", filter.from);
  if (filter?.to) query.set("to", filter.to);
  if (filter?.projectId) query.set("projectId", filter.projectId);
  const qs = query.toString();
  return apiGet<HubUsageAggregates>(`/api/hub/usage${qs ? `?${qs}` : ""}`);
};

/** Workforce Usage tab (WP1.6/WP2.6, D-HUX10) — `GET /api/hub/usage/rollup`: one row per `groupBy`
 *  entity (agent/crew/model/project/mode) over `from`/`to`/`projectId`, plus — for agent/crew/
 *  project — an explicit `key:null, unattributed:true` "no agent/crew/project" row so the total is
 *  never silently short (D-HUX10). */
export const getHubUsageRollup = (
  groupBy: HubUsageGroupBy,
  filter?: { from?: string; to?: string; projectId?: string },
): Promise<HubUsageRow[]> => {
  const query = new URLSearchParams({ groupBy });
  if (filter?.from) query.set("from", filter.from);
  if (filter?.to) query.set("to", filter.to);
  if (filter?.projectId) query.set("projectId", filter.projectId);
  return apiGet<HubUsageRow[]>(`/api/hub/usage/rollup?${query.toString()}`);
};

/** A single entity's ROLLING usage (totals over the trailing `days` window ending today — never a
 *  lifetime/range total — plus a zero-filled daily strip) — `GET /api/hub/usage/summary`
 *  (WP1.6/WP2.6, D-HUX10). Backs the Directory card sparkline (WP2.2), each profile modal's Usage
 *  sub-page (WP2.3/2.4), and the Usage tab's stacked-over-time chart. `days` clamped server-side to
 *  [1, 90] (default 30). Object params — the one canonical signature (integration-unified). */
export const getHubUsageSummary = (params: {
  groupBy: HubUsageGroupBy;
  id: string;
  days?: number;
}): Promise<HubUsageSummary> => {
  const query = new URLSearchParams({ groupBy: params.groupBy, id: params.id });
  if (params.days !== undefined) query.set("days", String(params.days));
  return apiGet<HubUsageSummary>(`/api/hub/usage/summary?${query.toString()}`);
};

/** The per-session context inspector — the window itemized by layer with REAL measured token counts
 *  (`GET /api/hub/sessions/:id/context`, R-SES7's flagship dogfood surface). Mounted as an additional
 *  section of the meta rail's Context section (`meta-rail/ContextSection.tsx`, via
 *  `meta-rail/use-meta-rail-data.ts`) — the retired `SessionContextPanel.tsx` aside owned this call
 *  before D-HUX3 folded it into the rail. */
export const getHubSessionContext = (id: string): Promise<HubContextInspector> =>
  apiGet<HubContextInspector>(`/api/hub/sessions/${id}/context`);

/**
 * hub-fixes WP1.3 (RC3.4) — the Context section's per-server error chip's Retry action:
 * `POST /api/hub/servers/:id/reconnect` evicts that server's cached hub MCP session so the session's
 * NEXT turn opens a fresh connection instead of reusing a broken/stale one. Does not reopen the
 * connection synchronously — the caller (`ContextSection.tsx`) surfaces that as "will retry on your
 * next message," matching the route's own documented contract.
 */
export const reconnectHubMcpServer = (serverId: string): Promise<{ ok: boolean }> =>
  apiPost<{ ok: boolean }>(`/api/hub/servers/${serverId}/reconnect`, {});

/**
 * Stream a hub session's frames: durable replay (server-side, cursor-filtered by `Last-Event-ID` on a
 * browser reconnect) then live, FOREVER — a hub session is a long-lived thread across many turns (like
 * the Assistant dock's `openAssistantStream`), not a one-shot run with a server-closed terminal status
 * (unlike {@link openRunStream}). The stream stays open until the caller disconnects or the session
 * ends/is deleted (the server's `HubChannelRegistry.closeAll`, which ends the socket from its side).
 */
export function openHubSessionStream(
  sessionId: string,
  on: (frame: HubSseFrame) => void,
  onError?: (event: Event) => void,
): () => void {
  const es = new EventSource(`/api/hub/sessions/${sessionId}/stream`);
  es.onmessage = (message) => {
    on(JSON.parse(message.data) as HubSseFrame);
  };
  es.onerror = (event) => {
    onError?.(event);
  };
  return () => es.close();
}

/**
 * Fork a session at an event `seq` — the existing `/branch` route (WP1.2/1.7; see its own module doc
 * in `apps/api/src/hub/routes.ts`). WP2.5 (composer power features) reuses it, unmodified, for turn
 * regenerate: `ConversationPane.tsx` branches the session cut off just BEFORE the turn being redone,
 * then resends the SAME user text to the new sibling session for a fresh reply — `MessageBranch*`
 * renders the siblings (R-SES6: "a branch via R-SES1 lineage — same mechanics as WP2.5 variants").
 * `atSeq` omitted copies the full history so far; `label` defaults server-side to `"<title> (branch)"`.
 */
export const branchHubSession = (
  id: string,
  input?: { atSeq?: number; label?: string },
): Promise<HubSession> => apiPost<HubSession>(`/api/hub/sessions/${id}/branch`, input ?? {});

// ── Assistant Hub missions (roadmap/assistant-hub/, WP1.7 routes; fix-web WP1.R GAP-E) ─────────────
// Self-contained additive block (its OWN `import type`, mirroring the Sessions block above) — the
// propose -> approve -> run -> synthesize flow's client wrappers. Every route is 202/fire-and-forget
// or a synchronous DB write; the resulting `plan_proposed`/`plan_updated`/`plan_approved`/`agent_*`/
// `mission_synthesis` events all arrive on the PARENT session's existing SSE stream
// ({@link openHubSessionStream}) — never a second transport (mirrors `apps/api/src/hub/missions/
// routes.ts`'s module doc). `ConversationPane.tsx`'s `MissionHandlers` wires these into the
// `MissionPlanCard`/`MissionBoard` callbacks.
import type {
  HubMission,
  HubMissionPlan,
  HubMissionProposeInput,
} from "@mcp-token-footprint/shared";

/**
 * Propose a mission plan for a mission-mode session — the in-band planner turn
 * (`POST /api/hub/sessions/:id/mission`). Accepted (202); the `plan_proposed` event (or a planner
 * failure) arrives on the session's SSE stream, never in this response. 400 if the session isn't
 * `mode: "mission"`; 409 if a non-terminal mission already exists on this session.
 */
export const proposeHubMission = (
  sessionId: string,
  // model-identity WP6.1 (F7) — the composer renders its model-override chip on a mission session's
  // FIRST message, but this call posted only `{ text }` and the body schema is `.strict()`, so the
  // operator's explicit model + credential were dropped with no signal and the planner silently ran on
  // the session's own pair. Both are optional; omitting them is the unchanged behaviour.
  // (Attachments and `@`-mentions are still dropped on this path — a separate, reported gap.)
  input: Pick<HubMissionProposeInput, "text" | "model" | "providerCredentialId">,
): Promise<{ sessionId: string; streamUrl: string }> =>
  apiPost<{ sessionId: string; streamUrl: string }>(`/api/hub/sessions/${sessionId}/mission`, {
    text: input.text,
    ...(input.model ? { model: input.model } : {}),
    ...(input.providerCredentialId ? { providerCredentialId: input.providerCredentialId } : {}),
  });

/**
 * Approve a still-`proposed` mission and start it running (`POST /api/hub/missions/:id/approve`).
 * Accepted (202); every agent spawn/report and the final synthesis arrive on the parent session's SSE
 * stream. 409 once the mission is no longer `proposed`.
 */
export const approveHubMission = (
  missionId: string,
): Promise<{ missionId: string; streamUrl: string }> =>
  apiPost<{ missionId: string; streamUrl: string }>(`/api/hub/missions/${missionId}/approve`, {});

/**
 * Edit a still-`proposed` mission's plan (e.g. removing an agent, `PATCH /api/hub/missions/:id`) —
 * synchronous (no model call); emits `plan_updated` on the parent session's SSE stream. 409 once the
 * mission is approved (the plan is frozen).
 */
export const editHubMissionPlan = (missionId: string, plan: HubMissionPlan): Promise<HubMission> =>
  apiPatch<HubMission>(`/api/hub/missions/${missionId}`, { plan });

/**
 * Stop a mission (idempotent, `POST /api/hub/missions/:id/stop`) — cancels a still-`proposed` one, or
 * aborts a running one so it synthesizes PARTIALLY from whatever agents already reported. Also backs
 * the plan card's Cancel action (the same route handles both cases server-side).
 */
export const stopHubMission = (missionId: string): Promise<void> =>
  apiPost<{ ok: true }>(`/api/hub/missions/${missionId}/stop`, {}).then(() => undefined);

/** Stop ONE agent mid-flight (idempotent, `POST /api/hub/missions/:id/agents/:agentSessionId/stop`) —
 *  the mission continues with the rest, ending partial if that agent never reports. */
export const stopHubMissionAgent = (missionId: string, agentSessionId: string): Promise<void> =>
  apiPost<{ ok: true }>(`/api/hub/missions/${missionId}/agents/${agentSessionId}/stop`, {}).then(
    () => undefined,
  );

/** Steer ONE running agent (WP2.3, R-SES3/R-UX4) — inject a durable steering message into its child
 *  session (`POST /api/hub/missions/:id/agents/:agentSessionId/steer`). 409 if the agent isn't running. */
export const steerHubMissionAgent = (
  missionId: string,
  agentSessionId: string,
  text: string,
): Promise<void> =>
  apiPost<{ ok: true }>(`/api/hub/missions/${missionId}/agents/${agentSessionId}/steer`, {
    text,
  }).then(() => undefined);

// ── Assistant Hub artifacts (roadmap/assistant-hub/, WP1.6 routes + web client; R-UX13) ────────────
// Self-contained additive block (its OWN `import type`, mirroring the Sessions block above) — the
// canvas surface: list/create, versions (list + append — the direct-UI-edit path; the model's path is
// the `artifacts.create`/`.update` built-ins, unaffected by this block), and export (md/html/json are
// plain `<a href>` navigation like every other report export in this app — `hubArtifactExportUrl`/
// `hubArtifactShareUrl` are pure URL builders, not fetch wrappers, for exactly that reason). The one
// fetch-based helper, `fetchHubArtifactShareHtml`, exists only for the canvas's "Copy" action, which
// needs the share.html TEXT in hand to put on the clipboard (a `<a>` can only trigger navigation/
// download, not a clipboard write).
import type {
  HubArtifact,
  HubArtifactExportFormat,
  HubArtifactKind,
  HubArtifactVersion,
} from "@mcp-token-footprint/shared";

/** Request body for `POST /api/hub/artifacts` — a request-only shape (mirrors `hubArtifactCreateBodySchema`
 *  in `apps/api/src/hub/routes.ts`), so it isn't in `packages/shared` (nothing reads it back off the wire). */
export type HubArtifactCreateInput = {
  sessionId?: string;
  projectId?: string;
  kind: HubArtifactKind;
  title: string;
  content: string;
  note?: string;
};

/** Request body for `POST /api/hub/artifacts/:id/versions` (the direct-UI-edit "update" path). */
export type HubArtifactVersionCreateInput = { content: string; note?: string };

/** List artifacts, optionally scoped to a session or project (the canvas scopes to the open session). */
export const listHubArtifacts = (filter?: { session?: string; project?: string }): Promise<
  HubArtifact[]
> => {
  const params = new URLSearchParams();
  if (filter?.session) params.set("session", filter.session);
  if (filter?.project) params.set("project", filter.project);
  const qs = params.toString();
  return apiGet<HubArtifact[]>(`/api/hub/artifacts${qs ? `?${qs}` : ""}`);
};

export const createHubArtifact = (input: HubArtifactCreateInput): Promise<HubArtifact> =>
  apiPost<HubArtifact>("/api/hub/artifacts", input);

export const getHubArtifact = (id: string): Promise<HubArtifact> =>
  apiGet<HubArtifact>(`/api/hub/artifacts/${id}`);

export const listHubArtifactVersions = (id: string): Promise<HubArtifactVersion[]> =>
  apiGet<HubArtifactVersion[]>(`/api/hub/artifacts/${id}/versions`);

/** Append a new IMMUTABLE version — the canvas's "Save" action (the prior version is preserved). */
export const addHubArtifactVersion = (
  id: string,
  input: HubArtifactVersionCreateInput,
): Promise<HubArtifactVersion> =>
  apiPost<HubArtifactVersion>(`/api/hub/artifacts/${id}/versions`, input);

/** `GET .../export?format=md|html|json` as a plain URL — the caller renders `<a href={...}>` (mirrors
 *  every other report export in this app, e.g. `RunConsole.tsx`'s "Export session log"). `version`
 *  targets a historical version; omitted exports the current one. */
export function hubArtifactExportUrl(
  id: string,
  format: HubArtifactExportFormat,
  version?: number,
): string {
  const params = new URLSearchParams({ format });
  if (version !== undefined) params.set("version", String(version));
  return `/api/hub/artifacts/${id}/export?${params.toString()}`;
}

/** `GET .../share` as a plain URL — the canvas's "Download" action for the self-contained `share.html`
 *  (R-UX13); the server always forces this one as an attachment. */
export function hubArtifactShareUrl(id: string, version?: number): string {
  const params = new URLSearchParams();
  if (version !== undefined) params.set("version", String(version));
  const qs = params.toString();
  return `/api/hub/artifacts/${id}/share${qs ? `?${qs}` : ""}`;
}

/** Fetch the `share.html` document as TEXT — backs the canvas's "Copy" action (clipboard write needs the
 *  string in hand; a plain `<a>` can only navigate/download, see the module doc). */
export const fetchHubArtifactShareHtml = (id: string, version?: number): Promise<string> =>
  apiGetText(hubArtifactShareUrl(id, version));

// ── Assistant Hub reviews (roadmap/assistant-hub/, WP3.5 routes + web client; D-AH12, D-AH7) ────────
// Self-contained additive block (its OWN `import type`, mirroring every other Hub block above): the
// review workflow's data surface — spawn the critic, list/get, per-comment decisions (→ the
// `HubReviewDecisionResult` envelope, `resultingVersion` present only when an accept produced a new
// immutable version) — plus the version-revert undo (R-UX7), which is an artifact-version action, not a
// review one, but lives here since the canvas's review panel is its only caller.
import type { HubReview, HubReviewDecisionResult } from "@mcp-token-footprint/shared";

/** Request body for `POST /api/hub/artifacts/:id/reviews` — a request-only shape (mirrors
 *  `hubReviewRequestBodySchema` in `apps/api/src/hub/routes.ts`), so it isn't in `packages/shared`.
 *  model-identity WP6.1 (F9) added `providerCredentialId`: without it a free-text `model` could never
 *  name a credential, so a critic run with no `roleId` could not use the subscription at all. */
export type HubReviewRequestInput = {
  version?: number;
  roleId?: string;
  model?: string;
  providerCredentialId?: string;
};

/** Request body for `PATCH /api/hub/reviews/:id` — a request-only shape (mirrors
 *  `hubReviewPatchBodySchema`). Provide `status` and/or `decision`. */
export type HubReviewPatchInput = {
  status?: HubReview["status"];
  decision?: { commentId: string; decision: "accepted" | "rejected" };
};

export const listHubArtifactReviews = (artifactId: string): Promise<HubReview[]> =>
  apiGet<HubReview[]>(`/api/hub/artifacts/${artifactId}/reviews`);

export const getHubReview = (id: string): Promise<HubReview> =>
  apiGet<HubReview>(`/api/hub/reviews/${id}`);

/** Spawns the critic (D-AH7) against a version (default: current/latest) — comments come back
 *  `decision:"pending"`, `authorKind:"agent"`. 409s if no hub-eligible provider credential exists. */
export const requestHubArtifactReview = (
  artifactId: string,
  input: HubReviewRequestInput = {},
): Promise<HubReview> => apiPost<HubReview>(`/api/hub/artifacts/${artifactId}/reviews`, input);

/** Accept/reject one comment and/or change the review's status. An `accepted` decision on a comment
 *  carrying a `suggestedEdit` appends a new immutable artifact version — `resultingVersion` on the
 *  response, absent otherwise (a `rejected` decision, a status-only patch, or a `suggestedEdit`-less
 *  `accepted` note). */
export const decideHubReview = (
  id: string,
  input: HubReviewPatchInput,
): Promise<HubReviewDecisionResult> =>
  apiPatch<HubReviewDecisionResult>(`/api/hub/reviews/${id}`, input);

/** The R-UX7 undo pairing: revert to a historical version by APPENDING a new one with that version's
 *  content (history stays immutable — this is itself just another forward version). 400s reverting to
 *  the already-current version. */
export const revertHubArtifactVersion = (
  artifactId: string,
  version: number,
): Promise<HubArtifactVersion> =>
  apiPost<HubArtifactVersion>(`/api/hub/artifacts/${artifactId}/versions/${version}/revert`, {});

// ── Assistant Hub files/workspace/resources (roadmap/assistant-hub/, WP3.4 routes + web client) ─────
// Self-contained additive block (its OWN `import type`, mirroring every other Hub block above):
// content-addressed uploads (D-AH12), the session workspace FileTree + produced-asset promote
// (`hub/workspace.ts`), content-addressed snapshots (R-SES6), and MCP resource attachment (R-MCP9).
import type {
  HubFileLink,
  HubFileLinkRole,
  HubResourceAttachment,
  HubWorkspaceSnapshot,
} from "@mcp-token-footprint/shared";

/** Upload a file (mirrors the skills upload flow's `apiUpload`). `sessionId` links it to a session
 *  (role `"upload"` by default) and appends a `file_uploaded` event; `projectId` pins it instead
 *  (`"pinned"`); omitting both stores the file unlinked. */
export const uploadHubFile = (
  file: File,
  target?: { sessionId?: string; projectId?: string; role?: HubFileLinkRole },
): Promise<HubFile> => {
  const params = new URLSearchParams();
  if (target?.sessionId) params.set("sessionId", target.sessionId);
  if (target?.projectId) params.set("projectId", target.projectId);
  if (target?.role) params.set("role", target.role);
  const qs = params.toString();
  return apiUpload<HubFile>(`/api/hub/files${qs ? `?${qs}` : ""}`, file);
};

export const getHubFile = (id: string): Promise<HubFile> => apiGet<HubFile>(`/api/hub/files/${id}`);

/** The raw-bytes download/preview URL — the caller renders `<a href>`/`<img src>` (mirrors
 *  `hubArtifactExportUrl`'s "plain URL, not a fetch wrapper" pattern for a browser-native download). */
export function hubFileContentUrl(id: string): string {
  return `/api/hub/files/${id}/content`;
}

export const deleteHubFile = (id: string): Promise<void> => apiDelete(`/api/hub/files/${id}`);

/** A session's linked files (uploads + anything promoted/produced) — the composer's Attachments tray
 *  and the FileTree panel's "Uploads" section share this one read. */
export const listHubSessionFiles = (
  sessionId: string,
): Promise<Array<{ link: HubFileLink; file: HubFile }>> =>
  apiGet<Array<{ link: HubFileLink; file: HubFile }>>(`/api/hub/sessions/${sessionId}/files`);

/** Promote an uploaded (or produced) file to a first-class, versioned artifact (WP1.6 canvas). 400s
 *  for a non-text file (only text content can become an artifact). */
export const promoteHubFileToArtifact = (
  sessionId: string,
  fileId: string,
  title?: string,
): Promise<HubArtifact> =>
  apiPost<HubArtifact>(
    `/api/hub/sessions/${sessionId}/files/${fileId}/promote`,
    title ? { title } : {},
  );

// ── Workspace FileTree + promote + snapshots ────────────────────────────────────────────────────

export type HubWorkspaceEntry = { path: string; size: number; isDirectory: boolean };

export const getHubWorkspaceTree = (
  sessionId: string,
  subPath?: string,
): Promise<{ entries: HubWorkspaceEntry[] }> => {
  const qs = subPath ? `?path=${encodeURIComponent(subPath)}` : "";
  return apiGet<{ entries: HubWorkspaceEntry[] }>(
    `/api/hub/sessions/${sessionId}/workspace/tree${qs}`,
  );
};

export const getHubWorkspaceFile = (
  sessionId: string,
  filePath: string,
): Promise<{ path: string; content: string }> =>
  apiGet<{ path: string; content: string }>(
    `/api/hub/sessions/${sessionId}/workspace/file?path=${encodeURIComponent(filePath)}`,
  );

/** Promote a WORKSPACE file (e.g. something `files.write` produced — the `ProducedAssetTree`'s
 *  "promote" action) to a versioned artifact. */
export const promoteHubWorkspaceFile = (
  sessionId: string,
  filePath: string,
  title?: string,
): Promise<HubArtifact> =>
  apiPost<HubArtifact>(`/api/hub/sessions/${sessionId}/workspace/promote`, {
    path: filePath,
    ...(title ? { title } : {}),
  });

export const createHubWorkspaceSnapshot = (
  sessionId: string,
  label?: string,
): Promise<HubWorkspaceSnapshot> =>
  apiPost<HubWorkspaceSnapshot>(
    `/api/hub/sessions/${sessionId}/workspace/snapshots`,
    label ? { label } : {},
  );

export const listHubWorkspaceSnapshots = (sessionId: string): Promise<HubWorkspaceSnapshot[]> =>
  apiGet<HubWorkspaceSnapshot[]>(`/api/hub/sessions/${sessionId}/workspace/snapshots`);

/** Restore the workspace to a prior snapshot (a checkout — a file gained AFTER the snapshot is left
 *  alone, never implicitly pruned; see `hub/workspace.ts`'s doc). */
export const restoreHubWorkspaceSnapshot = (
  sessionId: string,
  snapshotId: string,
): Promise<{ restored: number }> =>
  apiPost<{ restored: number }>(
    `/api/hub/sessions/${sessionId}/workspace/snapshots/${snapshotId}/restore`,
    {},
  );

// ── MCP resource attachment (R-MCP9) ────────────────────────────────────────────────────────────

/** One resource on a granted server's latest SCAN — the @-mention/picker's catalog entry (the "scanned"
 *  half of "scanned + live"). `definitionTokens` is the scan's definition-only footprint; the real,
 *  MEASURED content cost only exists after attaching ({@link HubResourceAttachment.tokens}). */
export type HubResourceCatalogEntry = {
  uri: string;
  kind: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
  audience?: string[];
  priority?: number;
  lastModified?: string;
  definitionTokens: number;
};

export const getHubResourceCatalog = (
  serverId: string,
): Promise<{ serverId: string; serverName?: string; resources: HubResourceCatalogEntry[] }> =>
  apiGet(`/api/hub/resources/catalog?server=${encodeURIComponent(serverId)}`);

/** Attach a resource (re-fetches + MEASURES its actual content server-side — never trusts a
 *  client-supplied token count). Auto-inclusion into the model's context is OFF by default (R-MCP9) —
 *  attaching only makes the resource a visible, metered candidate. */
export const attachHubResource = (
  sessionId: string,
  input: { serverId: string; uri: string },
): Promise<HubResourceAttachment> =>
  apiPost<HubResourceAttachment>(`/api/hub/sessions/${sessionId}/resources`, input);

export const listHubResourceAttachments = (sessionId: string): Promise<HubResourceAttachment[]> =>
  apiGet<HubResourceAttachment[]>(`/api/hub/sessions/${sessionId}/resources`);

export const removeHubResourceAttachment = (sessionId: string, resourceId: string): Promise<void> =>
  apiDelete(`/api/hub/sessions/${sessionId}/resources/${resourceId}`);

// ── Assistant Hub — role library + saved crews (roadmap/assistant-hub/, WP2.1 routes + web client) ──
// Self-contained additive block (its OWN `import type`, mirroring the Digest/Hub blocks above): the
// D-AH7 role library (`hub_agents`) and saved crews (`hub_crews`) CRUD, the Agents view's data surface.
import type {
  HubAgentRole,
  HubAgentRoleInput,
  HubAgentRolePatch,
  HubCrew,
  HubCrewInput,
  HubCrewPatch,
} from "@mcp-token-footprint/shared";

/** The role library, most-recently-named first (API-side `ORDER BY name`). Archived roles are hidden
 *  unless `includeArchived` (the Agents view's "Show archived" toggle). */
export const listHubAgentRoles = (options?: { includeArchived?: boolean }): Promise<
  HubAgentRole[]
> => {
  const qs = options?.includeArchived ? "?includeArchived=true" : "";
  return apiGet<HubAgentRole[]>(`/api/hub/agents${qs}`);
};

export const getHubAgentRole = (id: string): Promise<HubAgentRole> =>
  apiGet<HubAgentRole>(`/api/hub/agents/${id}`);

export const createHubAgentRole = (input: HubAgentRoleInput): Promise<HubAgentRole> =>
  apiPost<HubAgentRole>("/api/hub/agents", input);

/** Also the archive/restore toggle: `{ archived: true }` / `{ archived: false }` (D-AH7 — a curated,
 *  user-editable library, not a hard delete by default). */
export const updateHubAgentRole = (id: string, patch: HubAgentRolePatch): Promise<HubAgentRole> =>
  apiPatch<HubAgentRole>(`/api/hub/agents/${id}`, patch);

/** Hard delete — irreversible, unlike archiving. The Agents view confirms before calling this. */
export const deleteHubAgentRole = (id: string): Promise<void> => apiDelete(`/api/hub/agents/${id}`);

export const listHubCrews = (): Promise<HubCrew[]> => apiGet<HubCrew[]>("/api/hub/crews");

export const getHubCrew = (id: string): Promise<HubCrew> => apiGet<HubCrew>(`/api/hub/crews/${id}`);

export const createHubCrew = (input: HubCrewInput): Promise<HubCrew> =>
  apiPost<HubCrew>("/api/hub/crews", input);

export const updateHubCrew = (id: string, patch: HubCrewPatch): Promise<HubCrew> =>
  apiPatch<HubCrew>(`/api/hub/crews/${id}`, patch);

/** Crews have no archive column (`HubCrew` carries no `archivedAt`) — delete is the only discard path. */
export const deleteHubCrew = (id: string): Promise<void> => apiDelete(`/api/hub/crews/${id}`);

// ── Assistant Hub — memory (roadmap/assistant-hub/, WP3.2 routes + web client; D-AH11a) ────────────────
// Self-contained additive block (its OWN `import type`, mirroring the block above): the Memory panel's
// CRUD surface, plus the propose→explicit-save accept action the ConversationPane's proposal chips use.
import type {
  HubMemory,
  HubMemoryInput,
  HubMemoryKind,
  HubMemoryPatch,
  HubMemoryScope,
  HubMemoryStatus,
} from "@mcp-token-footprint/shared";

/** `scope`/`scopeId` (WP2.4, D-HUX11) — filter to one memory layer (e.g. `scope:"crew", scopeId:
 *  <crewId>` for a crew profile's read-only Memory section) instead of fetching every scope and
 *  filtering client-side. Omitted ⇒ every scope, unchanged from before WP2.4. */
export const listHubMemory = (filter?: {
  status?: HubMemoryStatus;
  kind?: HubMemoryKind;
  scope?: HubMemoryScope;
  scopeId?: string;
}): Promise<HubMemory[]> => {
  const params = new URLSearchParams();
  if (filter?.status) params.set("status", filter.status);
  if (filter?.kind) params.set("kind", filter.kind);
  if (filter?.scope) params.set("scope", filter.scope);
  if (filter?.scopeId) params.set("scopeId", filter.scopeId);
  const qs = params.toString();
  return apiGet<HubMemory[]>(`/api/hub/memory${qs ? `?${qs}` : ""}`);
};

export const getHubMemory = (id: string): Promise<HubMemory> =>
  apiGet<HubMemory>(`/api/hub/memory/${id}`);

/** Always a direct-UI, `source:"user"` row — `status:"active"` immediately (D-AH11 needs no accept
 *  step for something the owner typed themselves). The model's only path to a memory row is the
 *  `memory.propose_save` built-in. */
export const createHubMemory = (input: HubMemoryInput): Promise<HubMemory> =>
  apiPost<HubMemory>("/api/hub/memory", input);

/** Also the accept action for a proposed row (`{ status: "active" }`) and the archive/restore toggle
 *  (`{ status: "archived" }` / `{ status: "active" }`). Pass `sessionId` (the CONVERSATION the
 *  proposal chip is showing in) so a proposed→active transition appends the durable `memory_saved`
 *  event to that session's log (`acceptHubMemoryProposal` below wraps exactly this case); omit it from
 *  the standalone Memory panel, where there is no session in view. */
export const updateHubMemory = (
  id: string,
  patch: HubMemoryPatch,
  options?: { sessionId?: string },
): Promise<HubMemory> => {
  const qs = options?.sessionId ? `?sessionId=${encodeURIComponent(options.sessionId)}` : "";
  return apiPatch<HubMemory>(`/api/hub/memory/${id}${qs}`, patch);
};

/** The transcript proposal chip's "Save to memory" action — flips a `assistant_proposed`/`proposed`
 *  row to `active` and appends the `memory_saved` event (§1.3) to `sessionId`'s log so the chip (and
 *  anything replaying the session from `hub_events` alone, R-SES1) sees the save inline. WP2.7
 *  (D-HUX11) — the chip's scope picker may override the model's default owner; passing `scope` (+
 *  `scopeId` for a `project`/`crew`/`agent` scope) moves the row in the SAME request, so the
 *  `memory_saved` event's own scope fields (`hub/routes.ts`'s accept handler) already reflect where it
 *  actually landed. Omitting `scope` accepts in place, at whatever scope the proposal already carries. */
export const acceptHubMemoryProposal = (
  sessionId: string,
  memoryId: string,
  scope?: { scope: HubMemoryScope; scopeId?: string },
): Promise<HubMemory> =>
  updateHubMemory(memoryId, { status: "active", ...scope }, { sessionId });

export const deleteHubMemory = (id: string): Promise<void> => apiDelete(`/api/hub/memory/${id}`);

// ── Assistant Hub — audit timeline (roadmap/assistant-hub/, WP4.2 routes + web client; D-AH13) ──────
// Self-contained additive block (its OWN `import type`, mirroring the memory block above): the global,
// filterable Audit timeline over `hub_events` (`hub/audit.ts`'s read-only projection).
import type { HubAuditEntry, HubAuditKind, HubAuditPage } from "@mcp-token-footprint/shared";

export type HubAuditFilter = {
  sessionId?: string;
  kind?: HubAuditKind;
  tool?: string;
  since?: string;
  until?: string;
  limit?: number;
  before?: string;
};

/** `GET /api/hub/audit` — newest-first, paginated via `filter.before` = the previous page's
 *  `HubAuditPage.nextBefore` (present only while more rows exist behind it). */
export const listHubAudit = (filter?: HubAuditFilter): Promise<HubAuditPage> => {
  const params = new URLSearchParams();
  if (filter?.sessionId) params.set("sessionId", filter.sessionId);
  if (filter?.kind) params.set("kind", filter.kind);
  if (filter?.tool) params.set("tool", filter.tool);
  if (filter?.since) params.set("since", filter.since);
  if (filter?.until) params.set("until", filter.until);
  if (filter?.limit) params.set("limit", String(filter.limit));
  if (filter?.before) params.set("before", filter.before);
  const qs = params.toString();
  return apiGet<HubAuditPage>(`/api/hub/audit${qs ? `?${qs}` : ""}`);
};

export type { HubAuditEntry };

// ── Advisor — evidenced recommendations (roadmap/advisor/, WP 1.2 routes + WP 1.3 web client) ───────
// Self-contained additive block (its OWN `import type`, mirroring the hub-audit block above). The
// advisor is a READ MODEL: one GET, no writes, no auto-apply — the report is a set of suggestions the
// operator acts on by hand (README invariant 1).
import type { AdvisorReport, AdvisorReportQuery } from "@mcp-token-footprint/shared";

/**
 * `GET /api/advisor/report?scope=server|scenario|fleet&id=…` — the deterministic advisor report for
 * one scope. `id` is REQUIRED for `server`/`scenario` and must be ABSENT for `fleet` (the API's zod
 * partner rejects both mistakes), so it is only appended when the caller supplies one.
 */
export const getAdvisorReport = (
  query: AdvisorReportQuery,
  signal?: AbortSignal,
): Promise<AdvisorReport> => {
  const params = new URLSearchParams({ scope: query.scope });
  if (query.id !== undefined) params.set("id", query.id);
  return apiGet<AdvisorReport>(`/api/advisor/report?${params.toString()}`, signal);
};
