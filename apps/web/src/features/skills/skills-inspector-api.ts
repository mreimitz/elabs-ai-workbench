import type {
  RestoreSkillVersionRequest,
  RunSummary,
  SessionTrace,
  Skill,
  SkillDiff,
  SkillEditsRequest,
  SkillEditsResponse,
  SkillFileContent,
  SkillFileNode,
  SkillFlowTokensResponse,
  SkillGraphResponse,
  SkillSuggestionsResponse,
  SkillVersion,
  ToolDiagnostic,
  ToolDiagnosticsReport,
} from "@mcp-token-footprint/shared";
import { ApiError, apiGet, apiPost } from "../../lib/api";

/**
 * Both file contents for one path across the two versions — the payload of `GET /:id/diff/file`
 * (WP 1.5). Mirrors the API's `SkillFileDiff` shape; the web feeds `from.text`/`to.text` into the
 * Monaco `DiffEditor`, which computes the visual +/- line diff itself (no server line counts).
 */
export type SkillFileDiff = {
  path: string;
  from: SkillFileContent;
  to: SkillFileContent;
};

// ── Skills inspector: READ-ONLY api helpers ──────────────────────────────────────────────────────
// Thin, typed wrappers over the additive `/api/skills` read routes (apps/api/src/skills/routes.ts,
// WP 1.3). These live HERE (not in lib/api.ts) so the inspector work package never collides with
// WP 1.6's edits to lib/api.ts — but they still reuse the shared `apiGet` fetch wrapper. The API is
// the only side that touches the network/filesystem/git; the web only ever receives redacted data.
// Wire shapes come from @mcp-token-footprint/shared — the web never redefines them.

/** One skill (redacted — the GitHub binding only carries `hasAuth`, never the PAT). */
export const getSkill = (skillId: string): Promise<Skill> =>
  apiGet<Skill>(`/api/skills/${skillId}`);

/** All immutable versions of a skill, newest `seq` first is NOT guaranteed — the UI sorts. */
export const listSkillVersions = (skillId: string): Promise<SkillVersion[]> =>
  apiGet<SkillVersion[]>(`/api/skills/${skillId}/versions`);

/** One immutable version (footprint subtotals + manifest + file/byte counts). */
export const getSkillVersion = (skillId: string, versionId: string): Promise<SkillVersion> =>
  apiGet<SkillVersion>(`/api/skills/${skillId}/versions/${versionId}`);

/** The version's flat file list (the UI builds the nested tree). */
export const getSkillFiles = (skillId: string, versionId: string): Promise<SkillFileNode[]> =>
  apiGet<SkillFileNode[]>(`/api/skills/${skillId}/versions/${versionId}/files`);

/** One file's content: inline text for text files, or a `downloadPath` for binary files. */
export const getSkillFile = (
  skillId: string,
  versionId: string,
  path: string,
): Promise<SkillFileContent> =>
  apiGet<SkillFileContent>(
    `/api/skills/${skillId}/versions/${versionId}/file?path=${encodeURIComponent(path)}`,
  );

/**
 * The version's `SkillGraph` projection (SkillFlow WP 1.1/1.3 — `GET /:id/versions/:vid/graph`):
 * a deterministic, inference-first projection of the stored `SKILL.md` (D2/D5), stamped with the
 * `projectorVersion` that produced it. Recomputed on demand by the API — never persisted, never a
 * mutation. Empty/unparseable `SKILL.md` degrades to `{ nodes: [], edges: [], warnings }`, not a 404.
 */
export const getSkillGraph = (skillId: string, versionId: string): Promise<SkillGraphResponse> =>
  apiGet<SkillGraphResponse>(`/api/skills/${skillId}/versions/${versionId}/graph`);

/**
 * RM-30 WP 7.8 — what each graph node costs the model to READ, in tokens. The entry-point flow view
 * sums these over the reachability sets to answer "when this command fires, how much does the model
 * actually read?". Computed on read from the version's own token profile and the footprint's
 * already-persisted per-file totals — never a second counter, never persisted.
 */
export const getSkillFlowTokens = (
  skillId: string,
  versionId: string,
): Promise<SkillFlowTokensResponse> =>
  apiGet<SkillFlowTokensResponse>(`/api/skills/${skillId}/versions/${versionId}/flow-tokens`);

/**
 * The runs that RESOLVED this skill version (SkillFlow WP 2.1 — `GET /:id/versions/:vid/runs`,
 * joined via `run_skills`), newest first. The shared `RunSummary` shape the testing routes use.
 * Non-2xx responses throw an `ApiError` carrying the server's message (via `apiGet`).
 */
export const getSkillVersionRuns = (skillId: string, versionId: string): Promise<RunSummary[]> =>
  apiGet<RunSummary[]>(`/api/skills/${skillId}/versions/${versionId}/runs`);

/**
 * The full aligned `SessionTrace` for one run against this version (SkillFlow WP 2.2 —
 * `GET /:id/versions/:vid/trace?runId=…`): normalized events + the deterministic alignment
 * (nodeVisits / edgeTraversals / verdicts / unmatchedEvents). Non-2xx throws an `ApiError` whose
 * message IS the server's reason — notably the 409 "run did not run this version" text, which the
 * Trace tab surfaces inline (never a toastless failure).
 */
export const getSkillTrace = (
  skillId: string,
  versionId: string,
  runId: string,
): Promise<SessionTrace> =>
  apiGet<SessionTrace>(
    `/api/skills/${skillId}/versions/${versionId}/trace?runId=${encodeURIComponent(runId)}`,
  );

/**
 * The feedback loop (SkillFlow WP 5.2 — `GET /:id/versions/:vid/suggestions?runId=…`): deterministic
 * rule-derived suggestions for THIS trace's fracture/inferred verdicts, through the SAME source
 * resolution as {@link getSkillTrace} (same 400/404/409 semantics — a suggestion is only ever
 * computed against a trace that legitimately aligns to this version). Nothing here auto-applies; a
 * suggestion with a non-empty `ops` is only ever staged into the existing WP 4.1/4.2 save flow by
 * the caller.
 */
export const getSkillSuggestions = (
  skillId: string,
  versionId: string,
  ref: { runId: string },
): Promise<SkillSuggestionsResponse> =>
  apiGet<SkillSuggestionsResponse>(
    `/api/skills/${skillId}/versions/${versionId}/suggestions?runId=${encodeURIComponent(ref.runId)}`,
  );

/**
 * Save a batch of graph-level edit ops as a NEW immutable version (SkillFlow WP 4.1/4.2 —
 * `POST /:id/versions/:vid/edits`). `baseTreeSha` must be the version's `treeSha` at the moment the
 * client projected its graph — a mismatch (the version changed underneath) is a `409` ApiError; an
 * op that's unknown/conflicting/kind-mismatched against the projected graph is a `400` ApiError
 * (both carry the server's human-readable message, like {@link getSkillTrace}'s 409). `{ unchanged:
 * true }` means every op left `SKILL.md` byte-identical (empty batch, or every op degraded to a
 * warning + skip) — no version was created.
 */
export const postSkillEdits = (
  skillId: string,
  versionId: string,
  body: SkillEditsRequest,
): Promise<SkillEditsResponse> =>
  apiPost<SkillEditsResponse>(`/api/skills/${skillId}/versions/${versionId}/edits`, body);

/**
 * Restore an OLDER version as the new latest (`POST /:id/versions/:vid/restore`). A NON-destructive
 * re-point: the API copies the chosen version's exact tree into a NEW head version, leaving every
 * in-between version intact — nothing is deleted. Resolves to the new version + the diff vs the
 * previous latest, or `{ unchanged: true }` when the chosen version's content already matches the
 * current head (restoring the current version, or one identical to it) — no version was created.
 */
export const restoreSkillVersion = (
  skillId: string,
  versionId: string,
  body: RestoreSkillVersionRequest = {},
): Promise<SkillEditsResponse> =>
  apiPost<SkillEditsResponse>(`/api/skills/${skillId}/versions/${versionId}/restore`, body);

/**
 * Full-tree diff between two versions (WP 1.5 — `GET /:id/diff?from=&to=`): per-file entries +
 * a rollup of file counts / per-level token deltas + a manifest field diff. Computed on demand by
 * the API; the web renders it read-only.
 */
export const getSkillDiff = (skillId: string, from: string, to: string): Promise<SkillDiff> =>
  apiGet<SkillDiff>(
    `/api/skills/${skillId}/diff?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  );

/**
 * Both file contents for one path across the two versions (WP 1.5 — `GET /:id/diff/file`). Feeds
 * the client-side Monaco `DiffEditor` (original = from.text, modified = to.text). For binary files
 * each side is a `{ isBinary: true, downloadPath }` — the caller renders a "binary changed" note.
 */
export const getSkillFileDiff = (
  skillId: string,
  from: string,
  to: string,
  path: string,
): Promise<SkillFileDiff> =>
  apiGet<SkillFileDiff>(
    `/api/skills/${skillId}/diff/file?from=${encodeURIComponent(from)}&to=${encodeURIComponent(
      to,
    )}&path=${encodeURIComponent(path)}`,
  );

/**
 * Upstream update status for a GitHub-sourced skill (WP 1.4 — `GET /:id/upstream`). This route may
 * not exist yet (it ships in a later WP): callers tolerate a 404 by treating it as "no update info"
 * and hiding the badge — never hard-fail the inspector. But a network error / 5xx is a REAL failure
 * and must NOT masquerade as "no update", hence {@link getSkillUpstreamSafe} only swallows the 404.
 */
export type SkillUpstreamStatus = {
  /** True when the tracked ref has commits ahead of the skill's last imported sha. */
  updateAvailable: boolean;
  /** Optional short label of the upstream head (e.g. a short sha), when the API supplies it. */
  ahead?: number;
};

/**
 * Upstream check, routed through the shared {@link apiGet} client (not a raw `fetch`). Resolves to:
 *   - the parsed status when the route responds with a valid body;
 *   - `null` for a legitimate ABSENCE — a `404` (route not deployed yet / non-GitHub skill) or a
 *     200 whose body doesn't carry `updateAvailable`.
 * It RETHROWS on any hard failure (network error, `5xx`, …) so a genuine outage is not silently
 * hidden as "no update available"; the caller surfaces it (and still hides the badge).
 */
export async function getSkillUpstreamSafe(skillId: string): Promise<SkillUpstreamStatus | null> {
  try {
    const payload = await apiGet<Partial<SkillUpstreamStatus> | null>(
      `/api/skills/${skillId}/upstream`,
    );
    if (!payload || typeof payload.updateAvailable !== "boolean") return null;
    return { updateAvailable: payload.updateAvailable, ahead: payload.ahead };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

/** Absolute URL for the version-zip export route (an `<a href>`/`<Button asChild>` target). */
export const skillExportUrl = (skillId: string, versionId: string): string =>
  `/api/skills/${skillId}/versions/${versionId}/export`;

/** Absolute URL for one file's raw bytes (binary download / preview). */
export const skillRawUrl = (skillId: string, versionId: string, path: string): string =>
  `/api/skills/${skillId}/versions/${versionId}/raw?path=${encodeURIComponent(path)}`;

// ── Skill IDE WP 5.2 — MCP tool-reference diagnostics (read-only over WP 5.1) ─────────────────────
// Self-contained additive block (kept away from the other appended helpers so a concurrent wave's
// addition to this file can't collide). The surfaces that mark author-facing SKILL.md — the Design
// tab's body editor + canvas badges (NodeDetailPanel / SkillGraphCanvas) and the Files tab's SKILL.md
// editor (WorkspaceEditor) — all read the SAME deterministic report from WP 5.1's route. No MCP call,
// no scan is triggered by fetching it (the route validates backticked tool references against the
// LATEST persisted server scans). Wire shape (`ToolDiagnosticsReport`) comes from shared.

/**
 * The version's MCP tool-reference validation report (Skill IDE WP 5.1 —
 * `GET /:id/versions/:vid/tool-diagnostics`): `unknown_tool` / `stale_tool` diagnostics anchored back
 * to SKILL.md lines, each with up to three close-match candidates, plus the `toolValidationVersion`
 * stamp and any `unscannedServers`. Read-only over persisted scans; never opens an MCP connection.
 */
export const getToolDiagnostics = (
  skillId: string,
  versionId: string,
): Promise<ToolDiagnosticsReport> =>
  apiGet<ToolDiagnosticsReport>(`/api/skills/${skillId}/versions/${versionId}/tool-diagnostics`);

/**
 * A one-line human message for a tool-reference diagnostic — the text of its Monaco marker AND the
 * heading of its panel entry. Appends up to the diagnostic's (already ≤3) close-match candidates
 * ("server/tool (confidence)") so the author sees the suggested fix in the hover without opening the
 * panel. Pure; shared by every WP 5.2 surface so the wording never drifts.
 */
export function formatToolDiagnosticMessage(diagnostic: ToolDiagnostic): string {
  const lead =
    diagnostic.kind === "stale_tool"
      ? `Stale tool reference \`${diagnostic.name}\` — it was removed from its server since the last scan.`
      : `Unknown tool reference \`${diagnostic.name}\` — no scanned server exposes it.`;
  if (diagnostic.candidates.length === 0) return lead;
  const suggestions = diagnostic.candidates
    .map((candidate) => `${candidate.server}/${candidate.tool} (${candidate.confidence})`)
    .join(", ");
  return `${lead} Did you mean: ${suggestions}?`;
}

// ── Publish to GitHub (WP 7.2, I6) ────────────────────────────────────────────────────────────────
// Self-contained append (a concurrent wave also appends here) — its own type import so it never
// collides with the module's top import block. The API (WP 7.1) owns ALL git/secret work + the full
// refusal matrix (no-token 400, already-bound / non-empty-remote 409, REST 401/409/502, all
// redacted); the client only POSTs the body and surfaces the typed `ApiError.status` inline.
import type { PublishToGithubInput, PublishToGithubResult } from "@mcp-token-footprint/shared";

/**
 * Create a NEW GitHub repo from one version + initial push (I6 —
 * `POST /:id/versions/:vid/publish-github`). `body.token` is a write-only PAT: sent in the request,
 * never returned or logged — the API stores it encrypted ONLY when `bindAsSource` is set (then pull/
 * upstream work immediately) and never persists it otherwise. Non-2xx throws an `ApiError` whose
 * `status`/`message` the wizard renders inline (no client-side refusal logic).
 */
export const publishSkillToGithub = (
  skillId: string,
  versionId: string,
  body: PublishToGithubInput,
): Promise<PublishToGithubResult> =>
  apiPost<PublishToGithubResult>(
    `/api/skills/${skillId}/versions/${versionId}/publish-github`,
    body,
  );

// ── Push to the bound source repo (direct commit or PR) ───────────────────────────────────────────
// Self-contained append (its own type import so it never collides with the module's top import
// block). The API owns ALL git/secret work + the refusal matrix (not-bound 400, no-token 400,
// upstream-moved / PR-exists 409, auth 401, all redacted); the client only POSTs the body and
// surfaces the typed `ApiError.status` inline.
import type { SkillPushToGithubInput, SkillPushToGithubResult } from "@mcp-token-footprint/shared";

/**
 * Push THIS version back to the skill's bound GitHub source
 * (`POST /:id/versions/:vid/push-github`). `mode: "direct"` commits onto the tracked branch and
 * pushes it (never force); `mode: "pr"` pushes a new head branch and opens a pull request against
 * the tracked ref. `body.token` is a write-only PAT override: sent in the request, never returned
 * or logged — omitted, the API uses the skill's stored token. `unchanged: true` means the version's
 * tree is identical to upstream (nothing committed or pushed).
 */
export const pushSkillToGithub = (
  skillId: string,
  versionId: string,
  body: SkillPushToGithubInput,
): Promise<SkillPushToGithubResult> =>
  apiPost<SkillPushToGithubResult>(
    `/api/skills/${skillId}/versions/${versionId}/push-github`,
    body,
  );

// ── Skill IDE WP 4.3 — Quality tab data (read-only over WP 4.1 + WP 4.2) ──────────────────────────
// Self-contained additive block (its OWN `import type` so a concurrent wave's append to this file
// can't collide). Both routes are deterministic + read-only over the persisted, immutable version —
// no MCP call, no scan, no mutation. `SkillSuggestionsResponse` is already imported at the top of this
// module, so this block only pulls in the two shapes the top import block doesn't already carry.
import type { QualityReport, SkillStaticSuggestion } from "@mcp-token-footprint/shared";

/**
 * The version's deterministic quality report (Skill IDE WP 4.1 — `GET /:id/versions/:vid/quality`):
 * scored `findings` (each a `ruleId` + severity + message + optional SKILL.md `anchor` + optional
 * `fix` `SkillEditOp[]`), the 0–100 `score`, a per-rule `ruleCounts` tally, and the
 * `qualityEngineVersion` stamp (never silently compare reports across engine versions). Recomputed on
 * demand from the persisted version; never persisted, never a mutation. A `fix` is only ever applied
 * by the caller through the SAME `postSkillEdits` route as every other edit — never auto-applied here.
 */
export const getQualityReport = (skillId: string, versionId: string): Promise<QualityReport> =>
  apiGet<QualityReport>(`/api/skills/${skillId}/versions/${versionId}/quality`);

/**
 * The version's STATIC (trace-less) optimization suggestions (Skill IDE WP 4.2 —
 * `GET /:id/versions/:vid/suggestions` WITHOUT a `runId`): the response's `staticSuggestions` (trace
 * `suggestions` is empty on this path — see {@link getSkillSuggestions} for the runId/trace variant).
 * Each carries a reviewable `SkillEditOp[]` (or `ops: []` for an advisory) that applies through the
 * SAME edits route as every other edit. Reuses the shared `SkillSuggestionsResponse` shape (imported
 * at the top of this module); `undefined`/absent `staticSuggestions` degrades to an empty list.
 */
export const getStaticSuggestions = (
  skillId: string,
  versionId: string,
): Promise<SkillStaticSuggestion[]> =>
  apiGet<SkillSuggestionsResponse>(`/api/skills/${skillId}/versions/${versionId}/suggestions`).then(
    (response) => response.staticSuggestions ?? [],
  );

// ── Skill IDE WP 6.1 — trigger-surface manager + cross-skill collision report (I7) ────────────────
// Self-contained append (its own type import so it never collides with the module's top import block
// or a concurrent wave's append). Both routes are READ-ONLY over persisted skill versions — the API
// projects the graph deterministically; no MCP call, nothing executed. Wire shapes from shared.
import type { TriggerCollision, TriggerSurface } from "@mcp-token-footprint/shared";

/**
 * One version's trigger surface (Skill IDE WP 6.1 — `GET /:id/versions/:vid/triggers`): its
 * frontmatter description, keyword triggers, and `/command` entry points (each with its owning
 * node/flow so the UI can deep-link into the Design tab). Empty/unparseable SKILL.md → an empty
 * surface, never a 404.
 */
export const getSkillTriggers = (skillId: string, versionId: string): Promise<TriggerSurface> =>
  apiGet<TriggerSurface>(`/api/skills/${skillId}/versions/${versionId}/triggers`);

/**
 * Cross-skill trigger collisions across the WHOLE registry (Skill IDE WP 6.1 —
 * `GET /api/skills/trigger-collisions`): every value (of a kind) claimed by ≥ 2 skills, reported once
 * with both skill ids. Command collisions are errors, keyword overlaps are warnings; an empty array
 * means a clean catalog. Read-only over persisted skills — fetching it never triggers a scan.
 */
export const getRegistryTriggerCollisions = (): Promise<TriggerCollision[]> =>
  apiGet<TriggerCollision[]>("/api/skills/trigger-collisions");

// ── Skill IDE WP 8.2 — bound-tools from the bound servers' scans (I9.3) ────────────────────────────
// Self-contained additive block (its OWN `import type` so a concurrent wave's append here can't
// collide). Read-only over PERSISTED scans — fetching it never triggers a scan or opens an MCP
// connection. The editor turns the list into Monaco completion items + a hover popup. Wire shape
// (`BoundTool`) comes from shared.
import type { BoundTool } from "@mcp-token-footprint/shared";

/**
 * The version's bound-tools list (Skill IDE WP 8.2 — `GET /:id/versions/:vid/bound-tools`): for each
 * RESOLVED server binding, the server's LATEST completed scan's tools ({@link BoundTool} — name,
 * owning server, description, a compact schema-param summary, and the definition token cost). An
 * unbound skill (or a resolved server with no completed scan) yields `[]` — the caller registers no
 * editor providers in that case (honest degradation). Never opens an MCP connection.
 */
export const getBoundTools = (skillId: string, versionId: string): Promise<BoundTool[]> =>
  apiGet<BoundTool[]>(`/api/skills/${skillId}/versions/${versionId}/bound-tools`);

// ── Skill IDE WP 8.4 — scaffold a new skill from a server's tool surface (I9.4) ────────────────────
// Self-contained additive block (its OWN `import type` so a concurrent wave's append here can't
// collide). The API reads the server's LATEST completed scan itself (persisted reads only — never
// opens an MCP connection), composes the SKILL.md, creates the skill (v1) + the source-server binding,
// and returns the created skill + its resolved bindings. Wire shapes come from shared. A slug/name
// collision is a 409 `ApiError` the wizard surfaces inline.
import type {
  ScaffoldFromServerInput,
  ScaffoldFromServerResult,
} from "@mcp-token-footprint/shared";

/**
 * Scaffold a NEW skill from a registered server's tool surface (Skill IDE WP 8.4 —
 * `POST /api/skills/scaffold-from-server`): `input.tools` are the selected tool names from the
 * server's latest completed scan. Resolves to the created {@link ScaffoldFromServerResult} (the v1
 * skill + its resolved source-server binding). Non-2xx throws an `ApiError` whose `status`/`message`
 * the wizard renders inline (notably the 409 slug/name collision).
 */
export const scaffoldSkillFromServer = (
  input: ScaffoldFromServerInput,
): Promise<ScaffoldFromServerResult> =>
  apiPost<ScaffoldFromServerResult>("/api/skills/scaffold-from-server", input);

// ── Server-types WP 3.2 — the skill's RESOLVED server bindings (type-aware) ────────────────────────
// Self-contained additive block (its OWN `import type` so a concurrent wave's append here can't
// collide). Read-only over the persisted skill + the registered-server/type registries — fetching it
// never opens an MCP connection. Unlike the frontmatter `servers:` list the palette parses locally,
// this is the SERVER-RESOLVED view: each frontmatter name mapped to a registered server id (or `null`
// unbound), and — WP 3.1 (D-ST3) — the additive `typeId`/`resolvedVia:"type"` fields when the name is
// a server TYPE (resolved to its representative member). The palette uses it to render a type-bound
// entry distinctly (the type's name + status + resolved representative) from a plain server binding.
import type { SkillServerBinding } from "@mcp-token-footprint/shared";

/**
 * The skill's resolved server bindings (`GET /api/skills/:id/bindings`), in frontmatter `servers:`
 * order. Each entry carries the resolved `serverId` (or `null` unbound) and, when it resolved through
 * a server TYPE, the additive `typeId` + `resolvedVia: "type"`. Read-only; never opens a connection.
 */
export const fetchSkillBindings = (skillId: string): Promise<SkillServerBinding[]> =>
  apiGet<SkillServerBinding[]>(`/api/skills/${skillId}/bindings`);
