import {
  SKILLFLOW_EDIT_SOURCE_REF,
  SKILLFLOW_PROJECTOR_VERSION,
  qualityReportSchema,
  skillEditsRequestSchema,
  skillFlowTokensResponseSchema,
  skillSuggestionsResponseSchema,
  type QualityReport,
  type RunSummary,
  type RunTraceResponse,
  type SkillEditsResponse,
  type SkillFlowTokensResponse,
  type SkillGraph,
  type SkillGraphResponse,
  type SkillSuggestionsResponse,
} from "@mcp-token-footprint/shared";
import type { FastifyInstance } from "fastify";
import { config } from "../config/env.js";
import { DEFAULT_INGEST_CAPS, type IngestCaps } from "../skills/caps.js";
import { SkillDiffService } from "../skills/diff-service.js";
import { countLevels, type SkillFootprintFile } from "../skills/footprint.js";
import { parseSkillManifest } from "../skills/manifest.js";
import {
  isBinary,
  type CreateVersionMeta,
  type SkillFileInput,
  type SkillRepository,
} from "../skills/repository.js";
import type { RunRepository } from "../testing/run-repository.js";
import { httpError } from "../utils/errors.js";
import { validateEditOps } from "./edit-ops.js";
import { computeFlowNodeCosts } from "./flow-tokens.js";
import { projectSkillGraph } from "./projector.js";
import { analyzeSkillQuality } from "./quality.js";
import { applyOpsToContent } from "./roundtrip.js";
import { applyTreeOps } from "./tree-ops.js";
import { traceFromRun } from "./run-trace.js";
// WP 2.2 imports — kept as separate statements so the parallel-WP merge stays trivial.
import { sessionTraceSchema, type SessionTrace } from "@mcp-token-footprint/shared";
import { alignTrace } from "./aligner.js";
// WP 5.2 imports — the deterministic suggestion engine (route lives in the end hunk below).
// Skill IDE WP 4.2 — `buildStaticSuggestions` powers the SAME route WITHOUT a runId (trace-less).
import { buildStaticSuggestions, buildSuggestions } from "./suggestions.js";
// Skill IDE WP 5.1 imports — tool-reference validation vs the latest persisted MCP scans (route in the
// GET end-hunk below). Reads persisted scans through the existing ScanRepository; opens no MCP session.
import {
  toolDiagnosticsReportSchema,
  type ToolDiagnosticsReport,
} from "@mcp-token-footprint/shared";
import type { AppDatabase } from "../db/database.js";
import { ScanRepository } from "../scans/repository.js";
import {
  validateToolReferences,
  type ServerScanHistory,
  type ToolScanSnapshot,
} from "./tool-validation.js";
// Skill IDE WP 6.1 imports (I7) — the trigger-surface manager + cross-skill collision report. Kept as
// a self-contained block so the two GET routes below merge cleanly next to a concurrent wave's edits.
import {
  triggerCollisionSchema,
  triggerSurfaceSchema,
  type TriggerCollision,
  type TriggerSurface,
} from "@mcp-token-footprint/shared";
import { getTriggerCollisions, getTriggerSurface } from "./triggers.js";
// Skill IDE WP 9.1 imports (I10) — the live-draft engine's two STATELESS, PURE preview endpoints
// (apply-preview: content + ops → content'; project-preview: content → graph). Self-contained block so
// it merges cleanly next to a concurrent wave's edits. Both persist NOTHING and read no skill state
// beyond the request body (no model call, no MCP, no scan/DB read).
import {
  applyPreviewRequestSchema,
  applyPreviewResponseSchema,
  projectPreviewRequestSchema,
  projectPreviewResponseSchema,
  type ApplyPreviewResponse,
  type ProjectPreviewResponse,
  type SkillFileNode,
} from "@mcp-token-footprint/shared";

/**
 * SkillFlow read routes (WP 1.1 landed the graph route; WP 2.1 adds the run→trace routes). Everything
 * here is READ-ONLY over persisted data: the graph is a projection of `SKILL.md` (D5, never persisted),
 * and the trace is a projection of `run_steps` (D6, never mutated). No route registers or executes a
 * tool — the never-execute invariant (D4) is untouched.
 */
export async function registerSkillflowRoutes(
  app: FastifyInstance,
  repo: SkillRepository,
  runs: RunRepository,
  // Ingest caps for the edits route's tree ops (the zip-bomb / oversized-tree guard). Defaults to the
  // shared-constant caps; `index.ts` threads the env-configurable `skillCaps` (config.skillMax*) so a
  // low `SKILL_MAX_*` override actually caps a tree op through the edits route (closes 3.1 finding 3).
  caps: IngestCaps = DEFAULT_INGEST_CAPS,
): Promise<void> {
  // GET /api/skills/:id/versions/:vid/graph → project the version's SKILL.md into a SkillGraph.
  // 404 on an unknown skill/version; a version whose SKILL.md is missing/unparseable degrades to an
  // empty graph + warnings (per WP acceptance), never a 500.
  app.get("/api/skills/:id/versions/:vid/graph", async (request): Promise<SkillGraphResponse> => {
    const { id, vid } = request.params as { id: string; vid: string };

    repo.getPublic(id); // 404 if the skill is missing
    const version = repo.getVersion(vid); // 404 if the version is missing
    if (version.skillId !== id) throw httpError(404, "Skill version not found");

    const files = repo.listFiles(vid);
    const skillMd = loadSkillMd(repo, vid);
    const graph: SkillGraph = projectSkillGraph(skillMd, files);

    return { graph, projectorVersion: SKILLFLOW_PROJECTOR_VERSION };
  });

  // RM-30 WP 7.8 — GET /api/skills/:id/versions/:vid/flow-tokens → what each graph node costs the
  // model to READ. The entry-point flow view sums these over the reachability sets to answer "when
  // this command fires, how much does the model actually read?" — the deliverable of the work
  // package. Read-only, computed on read, persisted nowhere: no migration, no table, no column.
  // Reuses the version's own token profile and the footprint's already-persisted per-file totals, so
  // there is exactly one counter in the app (see `flow-tokens.ts`'s header).
  app.get(
    "/api/skills/:id/versions/:vid/flow-tokens",
    async (request): Promise<SkillFlowTokensResponse> => {
      const { id, vid } = request.params as { id: string; vid: string };

      repo.getPublic(id); // 404 if the skill is missing
      const version = repo.getVersion(vid); // 404 if the version is missing
      if (version.skillId !== id) throw httpError(404, "Skill version not found");

      const files = repo.listFiles(vid);
      const skillMd = loadSkillMd(repo, vid);
      const graph = projectSkillGraph(skillMd, files);
      const nodes = await computeFlowNodeCosts(graph, skillMd, files, version.tokenProfile);

      return skillFlowTokensResponseSchema.parse({
        tokenProfile: version.tokenProfile,
        projectorVersion: SKILLFLOW_PROJECTOR_VERSION,
        nodes,
      } satisfies SkillFlowTokensResponse);
    },
  );

  // GET /api/skills/:id/versions/:vid/runs → the runs that RESOLVED this skill version (joined via
  // run_skills), newest first. 404 on an unknown skill/version (validated the same way as the graph
  // route). Returns the shared RunSummary shape the testing routes already use.
  app.get("/api/skills/:id/versions/:vid/runs", async (request): Promise<RunSummary[]> => {
    const { id, vid } = request.params as { id: string; vid: string };

    repo.getPublic(id); // 404 if the skill is missing
    const version = repo.getVersion(vid); // 404 if the version is missing
    if (version.skillId !== id) throw httpError(404, "Skill version not found");

    return runs.listRunsForSkillVersion(vid);
  });

  // GET /api/runs/:runId/trace → the normalized run→trace event stream (no alignment yet — WP 2.1).
  // The response's `skillVersionId` comes from run_skills: with one resolved skill it's implied; with
  // several, `?skillVersionId=` disambiguates (400 if ambiguous / not part of the run). A run with no
  // recorded skill versions (an old run predating WP 2.1, or one with no attached skills) 404s with a
  // clear reason — there is no skill version to align its trace against.
  app.get("/api/runs/:runId/trace", async (request): Promise<RunTraceResponse> => {
    const { runId } = request.params as { runId: string };
    const query = request.query as { skillVersionId?: string };

    runs.getSummary(runId); // 404 if the run itself doesn't exist

    const runSkills = runs.getRunSkills(runId);
    if (runSkills.length === 0) {
      throw httpError(404, "Run has no recorded skill versions to align a trace against");
    }
    const versions = [...new Set(runSkills.map((row) => row.skill_version_id))];

    const requested = query.skillVersionId?.trim();
    let skillVersionId: string;
    if (requested) {
      if (!versions.includes(requested)) {
        throw httpError(400, `skillVersionId "${requested}" was not resolved by this run`);
      }
      skillVersionId = requested;
    } else if (versions.length === 1) {
      skillVersionId = versions[0] as string;
    } else {
      throw httpError(
        400,
        "Run resolved multiple skill versions — pass ?skillVersionId= to select which to align against",
      );
    }

    const events = traceFromRun({ runs }, runId);
    return { source: "run", ref: runId, skillVersionId, events };
  });

  // ── WP 2.2 — trace-alignment route (keep this block contiguous; parallel WPs append after it) ──
  // GET /api/skills/:id/versions/:vid/trace?runId=… → the full aligned SessionTrace: project the
  // version's graph (WP 1.1), normalize the run's events (an internal run → WP 2.1), and align
  // deterministically (aligner.ts — pure, no model calls / network / fs). Trace Mode sources are ONLY
  // this app's own test runs (owner decision 2026-07-03) — `runId` is required (missing → 400).
  // 404 on unknown skill/version/run; 409 when the run's recorded skill version differs from :vid —
  // aligning a trace against a version it didn't run is a surfaced user error, never silently
  // accepted. Response validated against sessionTraceSchema (stamped with both versions).
  app.get("/api/skills/:id/versions/:vid/trace", async (request): Promise<SessionTrace> => {
    const { id, vid } = request.params as { id: string; vid: string };
    const { runId } = request.query as { runId?: string };

    repo.getPublic(id); // 404 if the skill is missing
    const version = repo.getVersion(vid); // 404 if the version is missing
    if (version.skillId !== id) throw httpError(404, "Skill version not found");

    const graph = projectSkillGraph(loadSkillMd(repo, vid), repo.listFiles(vid));
    const trace = resolveRunTrace(runs, vid, graph, { runId });
    return sessionTraceSchema.parse(trace);
  });
  // ── end WP 2.2 ────────────────────────────────────────────────────────────────────────────────

  // ── WP 5.2 (+ Skill IDE WP 4.2) — the suggestions route ─────────────────────────────────────────
  // GET /api/skills/:id/versions/:vid/suggestions[?runId=…]
  //  · WITH runId (WP 5.2): the feedback loop. Reuses the EXACT same project + normalize + align
  //    composition as the trace route above (`resolveRunTrace`, one shared helper, no copy-paste) and
  //    hands the result to the deterministic `buildSuggestions` engine (D7: no model calls anywhere).
  //    Same validation/404/409 semantics as the trace route — a trace suggestion is only ever computed
  //    against a trace that legitimately aligns to `:vid`.
  //  · WITHOUT runId (WP 4.2): STATIC optimization. No run/alignment needed — the graph + file tree +
  //    L1/L2 footprint (`countLevels`, the SAME inputs the quality engine loads) drive
  //    `buildStaticSuggestions`. Returned in `staticSuggestions` (with `suggestions` empty and
  //    `alignerVersion` 0 — no aligner ran). Both branches are pure/deterministic and NEVER execute
  //    skill content or apply an op.
  app.get(
    "/api/skills/:id/versions/:vid/suggestions",
    async (request): Promise<SkillSuggestionsResponse> => {
      const { id, vid } = request.params as { id: string; vid: string };
      const { runId } = request.query as { runId?: string };

      repo.getPublic(id); // 404 if the skill is missing
      const version = repo.getVersion(vid); // 404 if the version is missing
      if (version.skillId !== id) throw httpError(404, "Skill version not found");

      const skillMd = loadSkillMd(repo, vid);
      const files = repo.listFiles(vid);
      const graph = projectSkillGraph(skillMd, files);

      // WP 4.2 — no runId → static (trace-less) optimization suggestions.
      if (!runId?.trim()) {
        const parsed = parseSkillManifest(skillMd);
        const footprintFiles: SkillFootprintFile[] = repo
          .getVersionFiles(vid)
          .map((file) =>
            isBinary(file.bytes)
              ? { path: file.path, isBinary: true }
              : { path: file.path, isBinary: false, text: file.bytes.toString("utf8") },
          );
        const levels = await countLevels(
          footprintFiles,
          parsed.manifest,
          parsed.body,
          version.tokenProfile,
        );
        const staticSuggestions = buildStaticSuggestions({
          skillMd,
          manifest: parsed.manifest,
          graph,
          files,
          footprint: { l1: levels.l1, l2: levels.l2 },
          l1Ceiling: config.skillQualityL1TokenCeiling,
          l2Ceiling: config.skillQualityL2TokenCeiling,
        });
        return skillSuggestionsResponseSchema.parse({
          suggestions: [],
          staticSuggestions,
          projectorVersion: SKILLFLOW_PROJECTOR_VERSION,
          alignerVersion: 0,
        } satisfies SkillSuggestionsResponse);
      }

      // WP 5.2 — runId → trace-based suggestions (unchanged).
      const trace = resolveRunTrace(runs, vid, graph, { runId });
      const suggestions = buildSuggestions(skillMd, graph, trace.alignment, trace.events);
      return skillSuggestionsResponseSchema.parse({
        suggestions,
        projectorVersion: trace.alignment.projectorVersion,
        alignerVersion: trace.alignment.alignerVersion,
      } satisfies SkillSuggestionsResponse);
    },
  );
  // ── end WP 5.2 / WP 4.2 ─────────────────────────────────────────────────────────────────────────

  // ── Skill IDE WP 4.1 — the deterministic quality engine (I4) (NEW end hunk) ─────────────────────
  // GET /api/skills/:id/versions/:vid/quality → project the version's graph (WP 1.1), parse its
  // manifest, list its files, count L1/L2 (`countLevels`), and run the PURE, versioned quality engine
  // (`analyzeSkillQuality`). Returns a schema-validated `QualityReport` (findings + 0–100 score +
  // per-rule tally + `qualityEngineVersion` stamp). READ-ONLY over persisted data; the engine emits
  // and shape-validates `fix` ops but NEVER applies or executes anything (D4 untouched). 404 on an
  // unknown skill/version; a version with a missing/unparseable SKILL.md degrades to an empty-graph
  // report (like the graph route), never a 500.
  app.get("/api/skills/:id/versions/:vid/quality", async (request): Promise<QualityReport> => {
    const { id, vid } = request.params as { id: string; vid: string };

    repo.getPublic(id); // 404 if the skill is missing
    const version = repo.getVersion(vid); // 404 if the version is missing
    if (version.skillId !== id) throw httpError(404, "Skill version not found");

    const files = repo.listFiles(vid);
    const skillMd = loadSkillMd(repo, vid);
    const graph = projectSkillGraph(skillMd, files);
    const parsed = parseSkillManifest(skillMd);

    const footprintFiles: SkillFootprintFile[] = repo
      .getVersionFiles(vid)
      .map((file) =>
        isBinary(file.bytes)
          ? { path: file.path, isBinary: true }
          : { path: file.path, isBinary: false, text: file.bytes.toString("utf8") },
      );
    const levels = await countLevels(
      footprintFiles,
      parsed.manifest,
      parsed.body,
      version.tokenProfile,
    );

    const report = analyzeSkillQuality({
      skillMd,
      manifest: parsed.manifest,
      files,
      graph,
      footprint: { l1: levels.l1, l2: levels.l2 },
      l1Ceiling: config.skillQualityL1TokenCeiling,
      l2Ceiling: config.skillQualityL2TokenCeiling,
    });
    return qualityReportSchema.parse(report);
  });
  // ── end WP 4.1 ────────────────────────────────────────────────────────────────────────────────

  // ── Skill IDE WP 5.1 — MCP tool-reference validation vs the latest persisted scans (I5) ─────────
  // GET /api/skills/:id/versions/:vid/tool-diagnostics → extract the version's backticked tool
  // references (conservative: shape + a "tool"/"call"/"invoke"/"use" context signal) and validate them
  // against the LATEST completed scan of each registered server (`<!-- skillflow:servers … -->` narrows
  // the set). READ-ONLY over persisted scans via the existing ScanRepository — no MCP connection is
  // opened and no scan is triggered (the never-execute invariant, D4, is untouched; the matching logic
  // lives in `tool-validation.ts`, which imports no MCP client). Returns a schema-validated
  // `ToolDiagnosticsReport` (diagnostics + `toolValidationVersion` + optional `unscannedServers`). 404
  // on an unknown skill/version; an empty/unparseable SKILL.md degrades to an empty report, never a 500.
  app.get(
    "/api/skills/:id/versions/:vid/tool-diagnostics",
    async (request): Promise<ToolDiagnosticsReport> => {
      const { id, vid } = request.params as { id: string; vid: string };

      repo.getPublic(id); // 404 if the skill is missing
      const version = repo.getVersion(vid); // 404 if the version is missing
      if (version.skillId !== id) throw httpError(404, "Skill version not found");

      const skillMd = loadSkillMd(repo, vid);
      const servers = loadRegisteredServerScans(repo);
      return toolDiagnosticsReportSchema.parse(validateToolReferences(skillMd, servers));
    },
  );
  // ── end WP 5.1 ────────────────────────────────────────────────────────────────────────────────

  // ── Skill IDE WP 6.1 — trigger-surface manager + cross-skill collision report (I7) ──────────────
  // GET /api/skills/:id/versions/:vid/triggers → the version's trigger surface (frontmatter
  // description + keyword triggers + `/command` entry points, each with its owning node/flow). Derived
  // from the DETERMINISTIC projected graph (`triggers.ts`) — read-only over the stored version, no MCP
  // call, nothing executed. 404 on an unknown skill/version; an empty/unparseable SKILL.md degrades to
  // an empty surface (like the graph route), never a 500.
  app.get("/api/skills/:id/versions/:vid/triggers", async (request): Promise<TriggerSurface> => {
    const { id, vid } = request.params as { id: string; vid: string };

    repo.getPublic(id); // 404 if the skill is missing
    const version = repo.getVersion(vid); // 404 if the version is missing
    if (version.skillId !== id) throw httpError(404, "Skill version not found");

    return triggerSurfaceSchema.parse(getTriggerSurface(repo, vid));
  });

  // GET /api/skills/trigger-collisions → every skill's CURRENT version projected, its keyword +
  // command triggers collected, and any value (of a kind) claimed by ≥ 2 DISTINCT skills reported
  // exactly once (exact + normalized via the compare helper + a documented plural fold; command
  // collision = error, keyword overlap = warning). Static `trigger-collisions` outranks the parametric
  // `/api/skills/:id` in find-my-way, so it is not shadowed. Pure over persisted skills — never scans,
  // never executes a skill (D4 untouched).
  app.get("/api/skills/trigger-collisions", async (): Promise<TriggerCollision[]> => {
    return getTriggerCollisions(repo).map((collision) => triggerCollisionSchema.parse(collision));
  });
  // ── end WP 6.1 ────────────────────────────────────────────────────────────────────────────────

  // POST /api/skills/:id/versions/:vid/edits (WP 4.1 + WP 3.1) → the WRITE half of Design Mode +
  // the file/folder workspace. Applies a MIXED batch of graph-level TEXT ops (spliced into SKILL.md
  // through the projected anchors) AND tree-level FILE ops (`add_file`/`update_file`/`rename_file`/
  // `delete_file` over the version's file tree, I3) and submits the result as ONE new immutable
  // version via the existing ingest write path (`SkillRepository.createVersion`, like the WP 1.2
  // blank branch: parseSkillManifest → countLevels → createVersion). Text ops apply FIRST (SKILL.md),
  // then tree ops over a tree carrying the text-edited SKILL.md — one save, one version. Guarantees:
  // - 404 unknown skill/version; 409 when `baseTreeSha` ≠ the version's `tree_sha` (stale anchors —
  //   the document changed since the client projected its graph; never a best-effort guess);
  // - 400 when an op is semantically invalid (graph ops: unknown ids/kind mismatches/conflicting
  //   pairs against the graph; file ops: unknown/colliding paths + conflicting pairs against the file
  //   list; SKILL.md rename/delete; path traversal; ingest caps; a batch that both text-edits AND
  //   `update_file`s SKILL.md) — validated BEFORE anything is persisted;
  // - `{ unchanged: true }` when SKILL.md is byte-identical AND there are no tree ops (empty batch /
  //   every text op degraded to a warning), with `createVersion`'s tree_sha dedupe as the backstop;
  // - otherwise a new version whose tree is the old tree with the text/file ops applied (every
  //   untouched file carried over byte-identical from the stored blobs — no in-place mutation; a
  //   rename preserves the blob so the diff shows a rename, not add+remove), plus the WP 1.5 diff
  //   base → new for review. D4 untouched: nothing here executes skill content.
  app.post(
    "/api/skills/:id/versions/:vid/edits",
    async (request, reply): Promise<SkillEditsResponse> => {
      const { id, vid } = request.params as { id: string; vid: string };

      repo.getPublic(id); // 404 if the skill is missing
      const version = repo.getVersion(vid); // 404 if the version is missing
      if (version.skillId !== id) throw httpError(404, "Skill version not found");

      const input = skillEditsRequestSchema.parse(request.body);
      if (input.baseTreeSha !== version.treeSha) {
        throw httpError(
          409,
          "Stale anchors: the version's tree changed since the graph was projected (baseTreeSha mismatch). Re-project and retry.",
        );
      }

      // Project the graph exactly like the GET graph route — the ops' anchors must match it.
      const files = repo.listFiles(vid);
      const skillMd = loadSkillMd(repo, vid);
      const graph = projectSkillGraph(skillMd, files);

      // Validate the WHOLE batch first — graph ops against the projected graph, tree/file ops
      // against the version's file list (unknown paths list the valid ones; conflicting pairs 400).
      const errors = validateEditOps(graph, input.ops, files);
      if (errors.length > 0) throw httpError(400, errors.join(" "));

      // Partition the batch: text/graph ops splice SKILL.md; tree ops mutate the file tree. A batch
      // that BOTH text-edits SKILL.md AND `update_file`s it is conflicting (two writers of one file,
      // ambiguous order) → 400. Any other command/keyword/asset op was already rejected above.
      const treeOpTypes = new Set(["add_file", "update_file", "rename_file", "delete_file"]);
      const treeOps = input.ops.filter((op) => treeOpTypes.has(op.op));
      const textOps = input.ops.filter((op) => !treeOpTypes.has(op.op));
      const updatesSkillMd = treeOps.some(
        (op) => op.op === "update_file" && op.path === "SKILL.md",
      );
      if (updatesSkillMd && textOps.length > 0) {
        throw httpError(
          400,
          "Conflicting SKILL.md edits: the batch mixes text/section ops with an update_file on SKILL.md. Use one or the other.",
        );
      }

      // Text ops FIRST (splice SKILL.md through its anchors), then tree ops over a tree whose SKILL.md
      // is the (possibly text-edited) version — one createVersion covers both. The splice runs through
      // the SHARED `applyOpsToContent` (WP 9.1) — the SAME code apply-preview calls — passing the graph
      // already projected + validated above (deterministic → identical to a re-projection), so the live
      // preview and this real save are byte-identical by construction.
      const applied = applyOpsToContent(skillMd, files, textOps, graph);
      const baseTree = repo
        .getVersionFiles(vid)
        .map((file) =>
          file.path === "SKILL.md"
            ? { path: file.path, content: Buffer.from(applied.skillMd, "utf8") }
            : { path: file.path, content: file.bytes },
        );
      const treeResult = applyTreeOps(baseTree, treeOps, caps);
      const warnings = [...applied.warnings, ...treeResult.warnings];

      // Unchanged when NEITHER half changed anything: SKILL.md byte-identical AND no tree ops. Any
      // residual identity (e.g. an update_file writing identical bytes) is caught by createVersion's
      // own tree_sha dedupe below.
      if (applied.skillMd === skillMd && treeOps.length === 0) {
        return { unchanged: true, warnings };
      }

      // Same manifest → footprint → createVersion sequence as the blank branch (WP 1.2), now over the
      // FULL new tree. Kind + binary + footprint are recomputed from bytes (createVersion re-classifies
      // kinds; untouched files keep identical bytes → identical content-addressed blob shas).
      const tree: SkillFileInput[] = treeResult.files.map((file) => ({
        path: file.path,
        bytes: file.content,
      }));
      const parsed = parseSkillManifest(applied.skillMd);
      const footprintFiles: SkillFootprintFile[] = tree.map((file) =>
        isBinary(file.bytes)
          ? { path: file.path, isBinary: true }
          : { path: file.path, isBinary: false, text: file.bytes.toString("utf8") },
      );
      const levels = await countLevels(
        footprintFiles,
        parsed.manifest,
        parsed.body,
        version.tokenProfile,
      );
      const byPath = new Map<string, number>();
      for (const file of levels.files) byPath.set(file.path, file.tokenTotal);

      const meta: CreateVersionMeta = {
        sourceKind: "upload",
        importedFrom: "upload",
        sourceRef: SKILLFLOW_EDIT_SOURCE_REF,
        manifest: parsed.manifest,
        manifestValid: parsed.valid,
        manifestErrors: parsed.errors,
        tokenProfile: levels.tokenProfile,
        note: input.note,
        footprint: { l1: levels.l1, l2: levels.l2, l3: levels.l3, total: levels.total, byPath },
      };
      const result = repo.createVersion(id, tree, meta);
      if (result.unchanged) {
        // tree_sha dedupe backstop: the edited tree matches the current version exactly.
        return { unchanged: true, warnings };
      }

      const diffService = new SkillDiffService(repo);
      reply.code(201);
      return {
        version: result.version,
        diff: diffService.diffVersions(vid, result.version.id),
        warnings,
      };
    },
  );

  // ── Skill IDE WP 9.1 — the live-draft engine's two STATELESS, PURE preview endpoints (I10) ───────
  // Neither persists anything, reads any skill state beyond the request body, calls a model, opens an
  // MCP connection, or reads a scan. They exist so the flow canvas and the (future) code editor are
  // always in sync: the draft SKILL.md text is canonical, and BOTH views are projections of it.

  // POST /api/skillflow/apply-preview (I10.1) → `{ content, ops, files? }` → `{ content', warnings }`.
  // The stateless splice: project the graph from `content`+`files` the SAME way the persisted edits
  // route does, VALIDATE the ops against it (an op whose anchors don't resolve is a 400-with-reason —
  // there is no persisted version to 409 against here), then splice through the SHARED
  // `applyOpsToContent` — the EXACT code the persisted edits route calls, so `content'` is byte-
  // identical to what a real save would write.
  app.post("/api/skillflow/apply-preview", async (request): Promise<ApplyPreviewResponse> => {
    const input = applyPreviewRequestSchema.parse(request.body);
    const files = (input.files ?? []) as SkillFileNode[];
    const graph = projectSkillGraph(input.content, files);
    const errors = validateEditOps(graph, input.ops, files);
    if (errors.length > 0) throw httpError(400, errors.join(" "));
    const applied = applyOpsToContent(input.content, files, input.ops, graph);
    return applyPreviewResponseSchema.parse({
      content: applied.skillMd,
      warnings: applied.warnings,
    });
  });

  // POST /api/skillflow/project-preview (I10.2) → `{ content, files? }` → `{ graph, warnings }`.
  // Wraps the SAME projector the persisted graph route (`GET …/graph`) uses — stamped with
  // `SKILLFLOW_PROJECTOR_VERSION`. The projector never throws (an empty/unparseable SKILL.md degrades
  // to an empty graph + a warning), so this endpoint is total.
  app.post("/api/skillflow/project-preview", async (request): Promise<ProjectPreviewResponse> => {
    const input = projectPreviewRequestSchema.parse(request.body);
    const files = (input.files ?? []) as SkillFileNode[];
    const graph = projectSkillGraph(input.content, files);
    return projectPreviewResponseSchema.parse({
      graph,
      warnings: graph.warnings,
      projectorVersion: SKILLFLOW_PROJECTOR_VERSION,
    });
  });
}

/**
 * Load a version's raw `SKILL.md` text. A missing file, a missing blob, or a binary blob all
 * degrade to `""` — the projector then returns an empty-graph-plus-warning (not an error).
 */
function loadSkillMd(repo: SkillRepository, versionId: string): string {
  try {
    const content = repo.getFileContent(versionId, "SKILL.md");
    return content.isBinary ? "" : content.text;
  } catch {
    return "";
  }
}

/**
 * Skill IDE WP 5.1 — load every registered server with its COMPLETED scans (newest-first, each carrying
 * just its tool names) for `validateToolReferences`. READ-ONLY over persisted data: `getLatestForServer`
 * is intentionally not used (it ignores status), so we take the server's scan summaries and keep only
 * `success` scans, newest-first — `[0]` is the latest completed scan, `[1..]` the history for the stale
 * lookup. Reuses the existing `ScanRepository`; opens no MCP session and triggers no scan.
 *
 * The `registerSkillflowRoutes(app, repo, runs)` signature is frozen for merge-safety with a concurrent
 * WP, so the one canonical `AppDatabase` is reached from the injected `SkillRepository` (both repos hold
 * it as `db`) rather than opening a second connection per request. The server list is a secret-free
 * `SELECT id, name` — no `ServerRepository`/secret decryption is needed just to enumerate servers.
 */
function loadRegisteredServerScans(repo: SkillRepository): ServerScanHistory[] {
  const db = skillflowDatabase(repo);
  const scans = new ScanRepository(db);
  const rows = db
    .prepare("SELECT id, name FROM mcp_servers ORDER BY name ASC, id ASC")
    .all() as Array<{ id: string; name: string }>;

  return rows.map((row) => {
    const completed = scans
      .listSummariesByServer(row.id)
      .filter((summary) => summary.status === "success");
    const snapshots: ToolScanSnapshot[] = completed.map((summary) => ({
      scanId: summary.id,
      toolNames: scans.getDetail(summary.id).tools.map((tool) => tool.toolName),
    }));
    return { serverId: row.id, serverName: row.name, scans: snapshots };
  });
}

/** The one canonical `AppDatabase`, reached from an injected repository (see {@link loadRegisteredServerScans}). */
function skillflowDatabase(repo: SkillRepository): AppDatabase {
  return (repo as unknown as { db: AppDatabase }).db;
}

/**
 * The project + normalize + align composition shared by the WP 2.2 trace route AND the WP 5.2
 * suggestions route (extracted so the two never drift). Trace Mode sources are ONLY this app's own
 * test runs (owner decision 2026-07-03), so `runId` is required (400 when missing/blank), the run is
 * resolved + validated (404 unknown run; 409 when the run's recorded skill version differs from
 * `vid` — aligning against a version it didn't run would be misleading), its events are normalized,
 * and aligned against the ALREADY-PROJECTED `graph` (the caller projects it once so a route needing
 * the raw `skillMd` too, like suggestions, doesn't project twice). Pure aside from the repository
 * reads; throws typed `httpError`s.
 */
function resolveRunTrace(
  runs: RunRepository,
  vid: string,
  graph: SkillGraph,
  query: { runId?: string },
): SessionTrace {
  const rid = query.runId?.trim();
  if (!rid) {
    throw httpError(400, "Provide a runId (the test run to align against this version)");
  }

  runs.getSummary(rid); // 404 if the run itself doesn't exist
  const resolvedVersions = runs.getRunSkills(rid).map((row) => row.skill_version_id);
  if (!resolvedVersions.includes(vid)) {
    const recorded =
      resolvedVersions.length > 0 ? resolvedVersions.join(", ") : "no skill versions at all";
    throw httpError(
      409,
      `Run "${rid}" did not run skill version "${vid}" (it recorded ${recorded}) — aligning a trace against a version it didn't run would be misleading`,
    );
  }

  const events = traceFromRun({ runs }, rid);
  const alignment = alignTrace(graph, events, { projectorVersion: SKILLFLOW_PROJECTOR_VERSION });
  return { source: "run", ref: rid, skillVersionId: vid, events, alignment };
}
