import fastifyMultipart from "@fastify/multipart";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  SKILL_MAX_TOTAL_BYTES,
  SKILL_RESTORE_SOURCE_REF,
  SKILLFLOW_EDIT_SOURCE_REF,
  publishToGithubInputSchema,
  restoreSkillVersionRequestSchema,
  saveSkillDraftRequestSchema,
  scaffoldFromServerSchema,
  skillBindingsInputSchema,
  skillImportSchema,
  skillPushToGithubInputSchema,
  skillRepoProbeSchema,
  skillUpdateSchema,
  type BlankSkillImportInput,
  type BoundTool,
  type BoundToolParam,
  type PublishToGithubResult,
  type ScaffoldFromServerResult,
  type Skill,
  type SkillDiff,
  type SkillEditsResponse,
  type SkillFileContent,
  type SkillFileNode,
  type SkillPushToGithubResult,
  type SkillRepoProbe,
  type SkillServerBinding,
  type SkillUsage,
  type SkillVersion,
} from "@mcp-token-footprint/shared";
import type { ScanRepository } from "../scans/repository.js";
import type { ServerTypeRepository } from "../server-types/repository.js";
import type { ServerRepository } from "../servers/repository.js";
import { SkillBindingRepository } from "./binding-repository.js";
import {
  assertFileCap,
  assertFileCountCap,
  assertTotalCap,
  DEFAULT_INGEST_CAPS,
  type IngestCaps,
} from "./caps.js";
import { SkillDiffService, type SkillFileDiff } from "./diff-service.js";
import { countLevels, type SkillFootprintFile } from "./footprint.js";
import type { SkillGitService } from "./git-service.js";
import type { SkillIngestService } from "./ingest-service.js";
import { parseSkillManifest } from "./manifest.js";
import type { SkillPublishService } from "./publish-service.js";
import type { SkillPushService } from "./push-service.js";
import {
  isBinary,
  type CreateVersionMeta,
  type CreateVersionResult,
  type SkillFileInput,
  type SkillRepository,
} from "./repository.js";
// Skill IDE WP 9.1 (I10.3) — the content-canonical save applies pending tree ops to the base tree
// through the SAME `applyTreeOps` the op-canonical edits route uses (single implementation).
import { applyTreeOps } from "../skillflow/tree-ops.js";
import {
  buildBlankSkillTree,
  buildServerScaffoldTree,
  normalizeBlankSkillName,
  type BlankSkillFile,
  type ServerScaffoldTool,
} from "./scaffold.js";
import { httpError } from "../utils/errors.js";

/** Slug/name derived from an upload filename when the manifest has none yet. */
type MultipartUpload = { buffer: Buffer; filename: string; displayName?: string };

export type RegisterSkillRoutesOptions = {
  /** Multipart body-size cap; defaults to the shared total-bytes constant. */
  maxUploadBytes?: number;
  /**
   * Push-back service (push a version to the skill's bound source repo — direct or PR). Optional so
   * pre-existing test callers that only exercise other routes need no wiring; the push route answers
   * 500 when unwired. Production (`index.ts`) always supplies it.
   */
  push?: SkillPushService;
  /**
   * The app-wide GitHub account token (Settings sign-in) — the LAST fallback in the push/publish
   * token resolution: explicit dialog token → the skill's stored PAT → this. A provider function so
   * sign-in/out applies immediately; the value stays in-process (never returned or logged).
   */
  githubAccountToken?: () => string | undefined;
  /**
   * Ingest caps (the zip-bomb / oversized-tree guard) for the save-draft tree-op apply and the
   * scaffold-from-blank/scaffold-from-server create paths. Defaults to the shared-constant caps when
   * omitted; `index.ts` threads the env-configurable `skillCaps` (config.skillMax*) here so a
   * tightened `SKILL_MAX_*` override actually applies to these two paths — previously they always
   * fell back to the compiled-in `DEFAULT_INGEST_CAPS` regardless of env, even though both accept
   * caller-supplied file content (H-4). Mirrors how `registerSkillflowRoutes` already receives
   * `skillCaps`.
   */
  caps?: IngestCaps;
};

/**
 * Register the UPLOAD + shared Skills routes (WP 1.3). GitHub creation/pull (WP 1.4) and diff
 * (WP 1.5) plug into this same module later — the create/version handlers branch cleanly on source
 * so those WPs can slot their github branch in without reshaping this registration.
 */
export async function registerSkillRoutes(
  app: FastifyInstance,
  repo: SkillRepository,
  ingest: SkillIngestService,
  git: SkillGitService,
  publish: SkillPublishService,
  // Skill IDE WP 8.1 (I9.1) — the per-skill server-binding store + the registered-server list (name →
  // id, redacted, no secrets) the binding routes resolve against.
  bindings: SkillBindingRepository,
  servers: ServerRepository,
  // Skill IDE WP 8.2 (I9.3) — persisted scan reads for the bound-tools route (editor completion/hover).
  // Read-only; never opens an MCP connection. Positioned after `servers` and before `options` so the
  // pre-8.2 test callers (which omit trailing params) pass it as `undefined`; the bound-tools route
  // guards for that. Production (`index.ts`) always supplies the real `ScanRepository`.
  scans: ScanRepository,
  // Server-types WP 3.1 (D-ST3) — the server-type registry so `resolveBindings` can map a frontmatter
  // name that is a TYPE (not a server) to the type's representative member server. Optional + trailing
  // (before `options`, mirroring the `scans` precedent): a test caller that omits it leaves type
  // resolution inert (a type-named entry stays honest-unbound) rather than throwing. Production
  // (`index.ts`) always supplies the real `ServerTypeRepository`. Pure persisted reads — no MCP, no
  // secrets (a type carries neither).
  serverTypes?: ServerTypeRepository,
  options: RegisterSkillRoutesOptions = {},
): Promise<void> {
  await app.register(fastifyMultipart, {
    limits: { fileSize: options.maxUploadBytes ?? SKILL_MAX_TOTAL_BYTES, files: 1 },
  });

  // H-4 — the caller-supplied ingest caps (env-overridable via `index.ts`'s `skillCaps`), used by the
  // save-draft tree-op apply and the blank/server-scaffold create paths below instead of the
  // compiled-in `DEFAULT_INGEST_CAPS`.
  const caps = options.caps ?? DEFAULT_INGEST_CAPS;

  // Diffs are derived on demand from two immutable versions — never stored (planning/Research/RS-02-skill-registry/outputs/04-versioning-and-diff.md).
  const diffService = new SkillDiffService(repo);

  // --- GitHub discovery -------------------------------------------------------------------------

  // Probe a repo/ref for SKILL.md dirs before creating a skill (no persistence). PAT (if any) is
  // used only in-process for this clone and never stored.
  app.post("/api/skills/probe", async (request): Promise<SkillRepoProbe> => {
    const input = skillRepoProbeSchema.parse(request.body);
    return git.probe(input.repoUrl, input.ref, input.auth);
  });

  // --- Skills CRUD ------------------------------------------------------------------------------

  app.get("/api/skills", async (): Promise<Skill[]> => repo.list());

  app.post("/api/skills", async (request, reply): Promise<Skill> => {
    if (!request.isMultipart()) {
      // JSON-body creation: GitHub (`source:"github"`) or blank (`source:"blank"`, SkillFlow D3).
      const input = skillImportSchema.parse(request.body);

      if (input.source === "blank") {
        return createBlankSkill(repo, input, reply, caps);
      }

      if (input.source === "upload") {
        // The `upload` member exists only for the multipart form's sibling `displayName` field —
        // multipart requests never reach this zod parse (handled below); a JSON body claiming
        // `source:"upload"` has no file part to ingest.
        throw httpError(400, "Uploading a skill requires a multipart file upload.");
      }

      // GitHub creation: JSON body (`source:"github"`, chosen subpath). The PAT is encrypted via
      // SecretStore inside `importSkill` and never returned (the redacted view exposes `hasAuth`).
      const result = await git.importSkill({
        repoUrl: input.repoUrl,
        ref: input.ref,
        subpath: input.subpath,
        token: input.auth?.token,
        displayName: input.displayName,
      });
      reply.code(201);
      return repo.getPublic(result.skillId);
    }

    const upload = await readMultipart(request);
    // The skill shell is created with a filename-derived placeholder name; the canonical name comes
    // from the SKILL.md manifest, which is only parsed during ingest (below).
    const name = deriveNameFromFilename(upload.filename);
    const skill = repo.create({
      name,
      displayName: upload.displayName,
      sourceType: "upload",
    });

    try {
      const result = await ingest.ingestUpload(skill.id, upload.buffer, upload.filename);
      // Canonicalize identity from the parsed manifest: the skill's name is its SKILL.md `name`
      // (e.g. `pdf-processing`), not the upload filename (`pdf-v1`).
      const manifestName = result.version?.manifest?.name;
      if (manifestName) repo.applyManifestIdentity(skill.id, manifestName, upload.displayName);
    } catch (err) {
      // No partial rows: a first-version ingest failure removes the just-created skill shell.
      repo.delete(skill.id);
      throw err;
    }

    reply.code(201);
    return repo.getPublic(skill.id);
  });

  app.get("/api/skills/:id", async (request): Promise<Skill> => {
    const { id } = request.params as { id: string };
    return repo.getPublic(id);
  });

  // UX WP 3.3 (G11/S20) — a skill's usage across the app: the environments it is attached to
  // (`scenario_skills`) + its most-recent runs (`run_skills`, newest first, capped). Read-only over
  // persisted data; opens no MCP connection, mutates nothing. 404 if the skill is missing.
  app.get("/api/skills/:id/usage", async (request): Promise<SkillUsage> => {
    const { id } = request.params as { id: string };
    return repo.getUsage(id);
  });

  app.put("/api/skills/:id", async (request): Promise<Skill> => {
    const { id } = request.params as { id: string };
    const input = skillUpdateSchema.parse(request.body);
    if (input.github) {
      // GitHub source config only applies to a github-bound skill — an honest 400 instead of
      // silently writing tracking fields an upload skill will never use.
      const existing = repo.getPublic(id); // 404 if the skill is missing
      if (existing.sourceType !== "github") {
        throw httpError(400, "This skill is not bound to a GitHub repository.");
      }
    }
    return repo.update(id, {
      displayName: input.displayName,
      github: input.github
        ? {
            repoUrl: input.github.repoUrl,
            ref: input.github.ref,
            subpath: input.github.subpath,
            token: input.github.auth === null ? null : input.github.auth?.token,
          }
        : undefined,
    });
  });

  app.delete("/api/skills/:id", async (request, reply): Promise<void> => {
    const { id } = request.params as { id: string };
    repo.delete(id);
    reply.code(204);
  });

  // --- Versions ---------------------------------------------------------------------------------

  app.get("/api/skills/:id/versions", async (request): Promise<SkillVersion[]> => {
    const { id } = request.params as { id: string };
    return repo.listVersions(id);
  });

  app.post(
    "/api/skills/:id/versions",
    async (request, reply): Promise<SkillVersion | { unchanged: true }> => {
      const { id } = request.params as { id: string };
      repo.getPublic(id); // 404 if the skill is missing

      if (!request.isMultipart()) {
        throw httpError(400, "Adding a version requires a multipart file upload.");
      }
      const upload = await readMultipart(request);
      const result = await ingest.ingestUpload(id, upload.buffer, upload.filename);
      return respondVersion(reply, result);
    },
  );

  // --- GitHub pull / upstream (WP 1.4) ----------------------------------------------------------

  // Re-clone the tracked ref: `{ unchanged: true }` when the sha/tree matches, else a new version.
  app.post(
    "/api/skills/:id/pull",
    async (request, reply): Promise<SkillVersion | { unchanged: true }> => {
      const { id } = request.params as { id: string };
      const result = await git.pull(id);
      if (result.unchanged) return { unchanged: true };
      reply.code(201);
      return repo.getVersion(result.versionId);
    },
  );

  // Cheap `ls-remote` upstream check (no clone) for the "update available" badge.
  app.get("/api/skills/:id/upstream", async (request) => {
    const { id } = request.params as { id: string };
    return git.upstream(id);
  });

  app.get("/api/skills/:id/versions/:vid", async (request): Promise<SkillVersion> => {
    const { vid } = request.params as { id: string; vid: string };
    return repo.getVersion(vid);
  });

  // --- Publish to GitHub (WP 7.1, I6) -----------------------------------------------------------

  // Create a NEW GitHub repo from this version + initial push, optionally binding it as the skill's
  // github source. The PAT comes from the request body (wins) or the skill's stored encrypted PAT;
  // neither → 400. The token is NEVER returned or logged (only `repoUrl` + `bound` come back).
  app.post(
    "/api/skills/:id/versions/:vid/publish-github",
    async (request): Promise<PublishToGithubResult> => {
      const { id, vid } = request.params as { id: string; vid: string };
      const input = publishToGithubInputSchema.parse(request.body);

      // Resolve the PAT: request body wins → the skill's stored encrypted PAT → the app-wide
      // GitHub account (Settings sign-in).
      const skill = repo.getInternal(id); // 404 if the skill is missing
      const token = input.token ?? skill.githubToken ?? options.githubAccountToken?.();
      if (!token) {
        throw httpError(
          400,
          "A GitHub token is required — provide one in the request, sign in with GitHub in Settings, or bind the skill to a repository with a stored token first.",
        );
      }

      return publish.publish({ skillId: id, versionId: vid, input, token });
    },
  );

  // --- Push to the bound source repo (direct commit or PR) ---------------------------------------

  // Push THIS version back to the skill's bound GitHub source: `mode: "direct"` commits onto the
  // tracked ref and pushes it (never force); `mode: "pr"` pushes a new head branch and opens a pull
  // request against the tracked ref. PAT resolution mirrors publish (body wins → stored PAT → 400);
  // the token is NEVER returned or logged.
  app.post(
    "/api/skills/:id/versions/:vid/push-github",
    async (request): Promise<SkillPushToGithubResult> => {
      if (!options.push) {
        throw httpError(500, "Push service is not configured.");
      }
      const { id, vid } = request.params as { id: string; vid: string };
      const input = skillPushToGithubInputSchema.parse(request.body);

      const skill = repo.getInternal(id); // 404 if the skill is missing
      const token = input.token ?? skill.githubToken ?? options.githubAccountToken?.();
      if (!token) {
        throw httpError(
          400,
          "A GitHub token is required — provide one in the request, sign in with GitHub in Settings, or store a token in the skill's source settings first.",
        );
      }

      return options.push.push({ skillId: id, versionId: vid, input, token });
    },
  );

  app.get("/api/skills/:id/versions/:vid/files", async (request): Promise<SkillFileNode[]> => {
    const { vid } = request.params as { id: string; vid: string };
    return repo.listFiles(vid);
  });

  app.get("/api/skills/:id/versions/:vid/file", async (request): Promise<SkillFileContent> => {
    const { id, vid } = request.params as { id: string; vid: string };
    const path = requirePathQuery(request);
    const content = repo.getFileContent(vid, path);
    if (content.isBinary) {
      // Point the download at the spec-shaped raw route (which includes the skill id).
      return { ...content, downloadPath: rawPath(id, vid, path) };
    }
    return content;
  });

  app.get("/api/skills/:id/versions/:vid/raw", async (request, reply): Promise<Buffer> => {
    const { vid } = request.params as { id: string; vid: string };
    const path = requirePathQuery(request);
    const file = repo.getFileBytes(vid, path);
    reply.header("content-type", "application/octet-stream");
    reply.header(
      "content-disposition",
      `attachment; filename="${sanitizeDisposition(basename(file.path))}"`,
    );
    return file.bytes;
  });

  app.get("/api/skills/:id/versions/:vid/export", async (request, reply): Promise<Buffer> => {
    const { vid } = request.params as { id: string; vid: string };
    const version = repo.getVersion(vid); // 404 if missing
    const zip = ingest.exportVersionZip(vid);
    reply.header("content-type", "application/zip");
    reply.header(
      "content-disposition",
      `attachment; filename="${sanitizeDisposition(version.versionLabel || "skill")}.zip"`,
    );
    return zip;
  });

  // --- Diff (WP 1.5) ----------------------------------------------------------------------------

  // Full-tree diff between two versions: per-file added/removed/modified/renamed + rollup token
  // deltas per level + a manifest field diff. Both ids must be versions of this skill.
  app.get("/api/skills/:id/diff", async (request): Promise<SkillDiff> => {
    const { id } = request.params as { id: string };
    const { from, to } = requireDiffQuery(request);
    assertVersionOfSkill(repo, id, from);
    assertVersionOfSkill(repo, id, to);
    return diffService.diffVersions(from, to);
  });

  // Both file contents for one path across the two versions — feeds the client-side Monaco DiffEditor.
  app.get("/api/skills/:id/diff/file", async (request): Promise<SkillFileDiff> => {
    const { id } = request.params as { id: string };
    const { from, to } = requireDiffQuery(request);
    const path = requirePathQuery(request);
    assertVersionOfSkill(repo, id, from);
    assertVersionOfSkill(repo, id, to);
    return diffService.fileDiff(from, to, path);
  });

  // --- Server bindings (Skill IDE WP 8.1 / I9.1) ------------------------------------------------
  // GET  → the skill's binding set: every frontmatter `servers:` name (portable, in order) resolved
  //        to a registered server id, or `null` when unbound. A persisted `skill_server_bindings`
  //        override wins over auto name-resolution; a name that matches no (or an AMBIGUOUS set of)
  //        registered server resolves to `null` — NEVER guessed.
  // PUT  → upsert the binding set (REPLACE semantics). A non-null serverId must name a real registered
  //        server (else 400) so the honest unbound state is the ONLY way to carry `null`.
  app.get("/api/skills/:id/bindings", async (request): Promise<SkillServerBinding[]> => {
    const { id } = request.params as { id: string };
    repo.getPublic(id); // 404 if the skill is missing
    return resolveBindings(repo, bindings, servers, id, scans, serverTypes);
  });

  app.put("/api/skills/:id/bindings", async (request): Promise<SkillServerBinding[]> => {
    const { id } = request.params as { id: string };
    repo.getPublic(id); // 404 if the skill is missing
    const input = skillBindingsInputSchema.parse(request.body);

    // A provided non-null serverId must be a real registered server (the FK would reject it anyway;
    // this returns an honest 400 instead of a 500). Unbound (`null`) rows are always allowed.
    const registeredIds = new Set(servers.list().map((server) => server.id));
    for (const binding of input.bindings) {
      if (binding.serverId !== null && !registeredIds.has(binding.serverId)) {
        throw httpError(
          400,
          `Unknown serverId "${binding.serverId}" for binding "${binding.serverName}".`,
        );
      }
    }

    bindings.replaceForSkill(id, input.bindings);
    return resolveBindings(repo, bindings, servers, id, scans, serverTypes);
  });

  // --- Bound tools (Skill IDE WP 8.2 / I9.3) ----------------------------------------------------
  // For each RESOLVED binding (frontmatter `servers:` name → registered id, reusing the SAME
  // resolution as GET /bindings), return the server's LATEST COMPLETED scan's tools as an
  // editor-friendly list (description + compact schema-param summary + definition token cost). Feeds
  // Monaco completion (tool names inside backticks) + the hover popup. READ-ONLY over persisted scans
  // — never opens an MCP connection (I5/I9 never-scan). Unresolved bindings, and resolved servers with
  // no completed scan, contribute nothing (honest degradation → an unbound skill yields `[]`).
  //
  // STATUS-AWARE latest scan: `listSummariesByServer(id)` is newest-first; we keep only `success`
  // scans and take `[0]` — deliberately NOT `getLatestForServer` (which ignores status and could
  // surface a `failed`/`running` scan). Mirrors WP 5.1's `loadRegisteredServerScans`.
  //
  // Bindings are a per-skill development concern (WP 8.1 resolves them from the skill's CURRENT version
  // frontmatter + picker overrides), so this reuses `resolveBindings(...id)` — the `:vid` scopes which
  // editor is asking, not which frontmatter to read.
  app.get("/api/skills/:id/versions/:vid/bound-tools", async (request): Promise<BoundTool[]> => {
    const { id, vid } = request.params as { id: string; vid: string };
    assertVersionOfSkill(repo, id, vid); // 404 if the version isn't this skill's

    // Defensive: the pre-8.2 test callers omit `scans` (it arrives `undefined`); with no scan
    // repository wired there are no persisted scans to read, so degrade to the honest empty set.
    if (!scans) return [];

    const resolved = resolveBindings(repo, bindings, servers, id, scans, serverTypes).filter(
      (binding): binding is SkillServerBinding & { serverId: string } => binding.serverId !== null,
    );

    const out: BoundTool[] = [];
    for (const binding of resolved) {
      const latestCompleted = scans
        .listSummariesByServer(binding.serverId)
        .find((summary) => summary.status === "success");
      if (!latestCompleted) continue; // resolved server, no completed scan → contributes nothing
      const detail = scans.getDetail(latestCompleted.id);
      for (const tool of detail.tools) {
        out.push({
          serverId: binding.serverId,
          serverName: binding.serverName,
          toolName: tool.toolName,
          description: tool.description,
          schemaParams: extractSchemaParams(tool.inputSchema),
          definitionTokens: tool.totalTokens,
        });
      }
    }
    return out;
  });

  // --- Scaffold a new skill from a server (Skill IDE WP 8.4 / I9.4) ------------------------------
  // Start a skill FROM a registered server's tool surface: read the server's LATEST COMPLETED scan
  // (persisted reads only — reuses WP 8.2's status-aware latest-success selection, NEVER opens an MCP
  // connection), compose a spec-valid SKILL.md (frontmatter `servers: [<server name>]`, an intro, and
  // one `##` section per selected tool with its scan description's first sentence + a backticked tool
  // reference), create it as v1 through the SAME blank-skill create path, and persist a
  // `skill_server_bindings` row resolved to the source server (so palette/completion go live at once).
  // Slug/name collisions → 409 (surfaced inline); a server with no completed scan / an unknown tool → 400.
  app.post(
    "/api/skills/scaffold-from-server",
    async (request, reply): Promise<ScaffoldFromServerResult> => {
      const input = scaffoldFromServerSchema.parse(request.body);

      // Resolve the source server (redacted config — no secrets). 404 if it isn't a registered server.
      const server = servers.getPublic(input.serverId);

      // Server-types WP 3.2 (B) — scaffold-from-TYPE. When `bindTypeName` is set, the source server is
      // only the tool-surface (the type's D-ST3 representative the client resolved); the scaffolded
      // skill's frontmatter `servers:` names the TYPE so the new skill binds to the type, not one box.
      // Validate it names a real registered type; refuse when the type name is ALSO a registered server
      // name (WP 3.1 precedence would resolve the frontmatter entry to that server, defeating the type
      // binding). `frontmatterName` is what lands in `servers:` — the type name, else the server name.
      let frontmatterName = server.name;
      const bindingAsType = input.bindTypeName !== undefined;
      if (bindingAsType) {
        const wanted = input.bindTypeName!.trim();
        const type = serverTypes
          ?.list()
          .find((t) => t.name.toLowerCase() === wanted.toLowerCase());
        if (!type) {
          throw httpError(400, `Unknown server type "${wanted}".`);
        }
        if (servers.list().some((s) => s.name === type.name)) {
          throw httpError(
            400,
            `"${type.name}" is also a registered server name — a frontmatter entry would bind that server, not the type. Rename one under Servers first.`,
          );
        }
        frontmatterName = type.name;
      }

      // Read the server's LATEST COMPLETED scan from persisted data (status-aware, like bound-tools).
      // Defensive: pre-8.2 callers omit the `scans` DI — with no scan store there's nothing to read.
      if (!scans) throw httpError(400, "Scan data is unavailable.");
      const latestCompleted = scans
        .listSummariesByServer(server.id)
        .find((summary) => summary.status === "success");
      if (!latestCompleted) {
        throw httpError(400, `Server "${server.name}" has no completed scan to scaffold from.`);
      }
      const detail = scans.getDetail(latestCompleted.id);
      const byToolName = new Map(detail.tools.map((tool) => [tool.toolName, tool] as const));

      // Selected tools (dedupe, preserve the caller's order); each MUST exist in the latest scan.
      const selected: ServerScaffoldTool[] = [];
      const seen = new Set<string>();
      for (const name of input.tools) {
        if (seen.has(name)) continue;
        seen.add(name);
        const tool = byToolName.get(name);
        if (!tool) {
          throw httpError(
            400,
            `Tool "${name}" is not in the latest scan of server "${server.name}".`,
          );
        }
        selected.push({ toolName: tool.toolName, description: tool.description });
      }

      // Slug/name collision → 409 (surfaced inline). A valid Agent-Skills name IS its own slug, so a
      // same-name OR same-slug skill collides. The blank path silently de-dupes; this route refuses.
      const skillName = normalizeBlankSkillName(input.name);
      if (
        repo.list().some((existing) => existing.slug === skillName || existing.name === skillName)
      ) {
        throw httpError(409, `A skill named "${skillName}" already exists.`);
      }

      const scaffold = buildServerScaffoldTree({
        name: input.name,
        displayName: input.displayName,
        description: input.description,
        serverName: frontmatterName,
        tools: selected,
      });

      const skill = await persistScaffoldedSkill(
        repo,
        scaffold,
        {
          name: skillName,
          displayName: input.displayName,
          sourceRef: "server-scaffold",
        },
        caps,
      );

      // Binding: a plain scaffold-from-server pins the SOURCE server (an explicit persisted override, so
      // palette/completion are immediately live). A scaffold-from-TYPE creates NO override — the type
      // name in the frontmatter resolves DYNAMICALLY to the type's representative (D-ST3) at read time,
      // which is the whole point (it re-resolves as members/scans change, never pinned to one box).
      if (!bindingAsType) {
        bindings.replaceForSkill(skill.id, [{ serverName: server.name, serverId: server.id }]);
      }

      reply.code(201);
      return {
        skill: repo.getPublic(skill.id),
        bindings: resolveBindings(repo, bindings, servers, skill.id, scans, serverTypes),
      };
    },
  );

  // ── Skill IDE WP 9.1 — the CONTENT-CANONICAL save of the live draft (I10.3) ─────────────────────
  // POST /api/skills/:id/save-draft → turn the live draft into ONE new immutable version. Unlike the
  // op-canonical edits route, the draft IS the final SKILL.md text: build the new tree = base tree with
  // SKILL.md ← `content`, apply the pending `treeOps` (via the SAME `applyTreeOps` as the edits route),
  // then submit through the SAME `createVersion` write path uploads/GitHub/blank/edits all use. The op
  // INTENT LOG rides along as version metadata (`intent_log_json`) so op-level audit granularity
  // survives the text-canonical save (I10.3). Semantics:
  //  - 404 unknown skill/version; 409 when `baseVersionId` is no longer the skill's HEAD (someone saved
  //    a newer version since the draft forked — reload and re-apply, never a silent overwrite);
  //  - `{ unchanged: true }` when the draft is byte-identical to the head (createVersion's tree_sha
  //    dedupe), otherwise a new version + the WP 1.5 diff base → new.
  // D4 untouched: nothing here executes skill content.
  app.post("/api/skills/:id/save-draft", async (request, reply): Promise<SkillEditsResponse> => {
    const { id } = request.params as { id: string };
    const skill = repo.getPublic(id); // 404 if the skill is missing
    const input = saveSkillDraftRequestSchema.parse(request.body);

    const base = repo.getVersion(input.baseVersionId); // 404 if the version is missing
    if (base.skillId !== id) throw httpError(404, "Skill version not found");
    if (skill.currentVersionId !== input.baseVersionId) {
      throw httpError(
        409,
        "The skill head moved since this draft was started (a newer version exists). Reload the draft and re-apply your edits.",
      );
    }

    // Build the new tree: the base tree with SKILL.md replaced by the draft content, then the tree ops.
    // Only true tree/file ops are applied here (graph/text ops are already baked into `content` by the
    // draft's apply-preview passes); anything else in `treeOps` is ignored by `applyTreeOps`.
    const treeOpTypes = new Set(["add_file", "update_file", "rename_file", "delete_file"]);
    const treeOps = input.treeOps.filter((op) => treeOpTypes.has(op.op));
    const baseTree = repo
      .getVersionFiles(input.baseVersionId)
      .map((file) =>
        file.path === "SKILL.md"
          ? { path: file.path, content: Buffer.from(input.content, "utf8") }
          : { path: file.path, content: file.bytes },
      );
    if (!baseTree.some((file) => file.path === "SKILL.md")) {
      // Manifest invariant: every version carries a SKILL.md. Defensive — never lose the draft content.
      baseTree.unshift({ path: "SKILL.md", content: Buffer.from(input.content, "utf8") });
    }
    const treeResult = applyTreeOps(baseTree, treeOps, caps);
    const warnings = [...treeResult.warnings];

    const tree: SkillFileInput[] = treeResult.files.map((file) => ({
      path: file.path,
      bytes: file.content,
    }));
    const parsed = parseSkillManifest(input.content);
    const footprintFiles: SkillFootprintFile[] = tree.map((file) =>
      isBinary(file.bytes)
        ? { path: file.path, isBinary: true }
        : { path: file.path, isBinary: false, text: file.bytes.toString("utf8") },
    );
    const levels = await countLevels(
      footprintFiles,
      parsed.manifest,
      parsed.body,
      base.tokenProfile,
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
      intentLog: input.intentLog,
      footprint: { l1: levels.l1, l2: levels.l2, l3: levels.l3, total: levels.total, byPath },
    };
    const result: CreateVersionResult = repo.createVersion(id, tree, meta);
    if (result.unchanged) {
      return { unchanged: true, warnings };
    }

    reply.code(201);
    return {
      version: result.version,
      diff: diffService.diffVersions(input.baseVersionId, result.version.id),
      warnings,
    };
  });

  // ── Restore an OLDER version as the new latest — a NON-destructive re-point ──────────────────────
  // POST /api/skills/:id/versions/:vid/restore → copy the chosen version's exact tree into a NEW head
  // version through the SAME `createVersion` write path uploads/GitHub/edits all use. Because
  // createVersion always computes `seq = MAX(seq)+1` and only moves `skills.current_version_id`
  // FORWARD (never deletes), the in-between versions are left completely intact — only the "latest"
  // pointer moves. This is the answer to "set the latest back to a certain version without deleting
  // the ones in between": you get a new (higher) seq whose content equals `:vid`.
  //  - 404 unknown skill / version (or a version belonging to another skill);
  //  - `{ unchanged: true }` when the chosen tree is byte-identical to the current head (restoring the
  //    current version, or one identical to it — createVersion's tree_sha dedupe), so no version is
  //    created; otherwise a new version + the diff (previous head → new) showing what the restore did.
  // D4 untouched: nothing here executes skill content.
  app.post(
    "/api/skills/:id/versions/:vid/restore",
    async (request, reply): Promise<SkillEditsResponse> => {
      const { id, vid } = request.params as { id: string; vid: string };
      const skill = repo.getPublic(id); // 404 if the skill is missing
      const source = repo.getVersion(vid); // 404 if the version is missing
      if (source.skillId !== id) throw httpError(404, "Skill version not found");
      const body = restoreSkillVersionRequestSchema.parse(request.body ?? {});

      // Rebuild the chosen version's exact tree and recompute its footprint (the same footprint math
      // save-draft/upload use), then resubmit through `createVersion`.
      const tree: SkillFileInput[] = repo
        .getVersionFiles(vid)
        .map((file) => ({ path: file.path, bytes: file.bytes }));
      const skillMd = tree.find((file) => file.path === "SKILL.md");
      const parsed = parseSkillManifest(skillMd ? skillMd.bytes.toString("utf8") : "");
      const footprintFiles: SkillFootprintFile[] = tree.map((file) =>
        isBinary(file.bytes)
          ? { path: file.path, isBinary: true }
          : { path: file.path, isBinary: false, text: file.bytes.toString("utf8") },
      );
      const levels = await countLevels(
        footprintFiles,
        parsed.manifest,
        parsed.body,
        source.tokenProfile,
      );
      const byPath = new Map<string, number>();
      for (const file of levels.files) byPath.set(file.path, file.tokenTotal);

      const meta: CreateVersionMeta = {
        sourceKind: "upload",
        importedFrom: "upload",
        sourceRef: SKILL_RESTORE_SOURCE_REF,
        manifest: parsed.manifest,
        manifestValid: parsed.valid,
        manifestErrors: parsed.errors,
        tokenProfile: levels.tokenProfile,
        note: body.note ?? `Restored from v${source.seq}`,
        footprint: { l1: levels.l1, l2: levels.l2, l3: levels.l3, total: levels.total, byPath },
      };
      const result: CreateVersionResult = repo.createVersion(id, tree, meta);
      if (result.unchanged) {
        return { unchanged: true };
      }

      // The diff base is the PREVIOUS head (captured before createVersion moved the pointer) so the
      // diff shows what reverting changed — a diff vs `:vid` itself would be empty by construction.
      const diffBase = skill.currentVersionId ?? vid;
      reply.code(201);
      return {
        version: result.version,
        diff: diffService.diffVersions(diffBase, result.version.id),
      };
    },
  );
}

/**
 * Skill IDE WP 8.2 — parse a bound tool's top-level input-schema parameters for the editor hover.
 * Reads the JSON-schema `properties` (name → declared `type`) and the `required` string array. Purely
 * structural + defensive: a missing/non-object schema, missing `properties`, or a property without a
 * `type` all degrade gracefully (`[]`, or `"unknown"`/`"enum"` for the type). Property order follows
 * the stored (stably-serialized) schema, so the output is deterministic per scan.
 */
function extractSchemaParams(inputSchema: unknown): BoundToolParam[] {
  if (!inputSchema || typeof inputSchema !== "object") return [];
  const schema = inputSchema as { properties?: unknown; required?: unknown };
  const properties = schema.properties;
  if (!properties || typeof properties !== "object") return [];
  const requiredSet = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((name): name is string => typeof name === "string")
      : [],
  );
  return Object.entries(properties as Record<string, unknown>).map(([name, definition]) => ({
    name,
    type: schemaTypeOf(definition),
    required: requiredSet.has(name),
  }));
}

/** A compact JSON-schema type label: the `type` string, a joined union for `type: [...]`, `"enum"`
 *  for an untyped enum, else `"unknown"`. */
function schemaTypeOf(definition: unknown): string {
  if (!definition || typeof definition !== "object") return "unknown";
  const type = (definition as { type?: unknown }).type;
  if (typeof type === "string") return type;
  if (Array.isArray(type)) {
    const parts = type.filter((entry): entry is string => typeof entry === "string");
    if (parts.length > 0) return parts.join(" | ");
  }
  if (Array.isArray((definition as { enum?: unknown }).enum)) return "enum";
  return "unknown";
}

/**
 * Resolve a skill's server bindings (Skill IDE WP 8.1 / I9.1; server-types WP 3.1 / D-ST3): the portable
 * frontmatter `servers:` names (in order) each mapped to a registered server id. Resolution precedence,
 * preserved exactly (an existing server/persisted binding stays byte-identical — the type metadata is
 * carried ONLY on a step-3 type match):
 *   1. A persisted `skill_server_bindings` override for the name WINS (explicit pick, incl. an explicit
 *      unbound `null`). Emitted as `{ serverName, serverId }`.
 *   2. Else if the name matches a registered SERVER: the UNIQUELY name-matched server (`serverId`), or
 *      `null` when the match is ambiguous (>1 server shares the name) — never a guess, and NEVER a
 *      fall-through to types. Emitted as `{ serverName, serverId }`.
 *   3. Else if the name matches a server TYPE (type names are unique COLLATE NOCASE, so ≤1): resolve to
 *      the type's REPRESENTATIVE member — the member whose newest SUCCESSFUL scan is the newest overall
 *      (tiebreak: newest `scanned_at`, then server `id` ASC). Emitted as
 *      `{ serverName, serverId: <rep|null>, typeId, resolvedVia: "type" }`; `serverId` is `null` (honest
 *      unbound) when no member has a successful scan, but `typeId`/`resolvedVia` still record the match.
 *   4. Else `null` (honest unbound). Emitted as `{ serverName, serverId }`.
 * Type resolution reads only PERSISTED data (redacted server configs + scan summaries) — it never opens
 * an MCP connection and decrypts no secret (a type carries neither). When `serverTypes`/`scans` are not
 * wired (some test callers), step 3 simply cannot fire and the name degrades to step 4.
 *
 * Names in the persisted set that are NOT in the current frontmatter are appended after (sorted) so a
 * PUT-then-GET round-trips even without a frontmatter entry.
 */
function resolveBindings(
  repo: SkillRepository,
  bindings: SkillBindingRepository,
  servers: ServerRepository,
  skillId: string,
  scans?: ScanRepository,
  serverTypes?: ServerTypeRepository,
): SkillServerBinding[] {
  const frontmatterNames = readFrontmatterServers(repo, skillId);
  const stored = new Map(
    bindings.listForSkill(skillId).map((b) => [b.serverName, b.serverId] as const),
  );

  // Auto-resolution map: a name → the id of the UNIQUE registered server with that name (ambiguous or
  // absent → not present here, resolving to null). Reads only redacted configs (no secrets).
  const allServers = servers.list();
  const nameCounts = new Map<string, number>();
  const nameToId = new Map<string, string>();
  for (const server of allServers) {
    nameCounts.set(server.name, (nameCounts.get(server.name) ?? 0) + 1);
    nameToId.set(server.name, server.id);
  }
  const autoResolve = (name: string): string | null =>
    nameCounts.get(name) === 1 ? (nameToId.get(name) ?? null) : null;

  // Type registry keyed by lowercase name (types are unique COLLATE NOCASE → ≤1 per key). Absent when
  // `serverTypes` isn't wired, which keeps step 3 inert.
  const typeByLowerName = new Map(
    (serverTypes?.list() ?? []).map((type) => [type.name.toLowerCase(), type] as const),
  );

  const out: SkillServerBinding[] = [];
  const emitted = new Set<string>();
  for (const name of frontmatterNames) {
    if (emitted.has(name)) continue;
    emitted.add(name);

    // (1) Persisted override wins — byte-identical `{ serverName, serverId }`.
    if (stored.has(name)) {
      out.push({ serverName: name, serverId: stored.get(name) ?? null });
      continue;
    }
    // (2) Registered-server match (exact) — never falls through to a type, stays byte-identical.
    if (nameCounts.has(name)) {
      out.push({ serverName: name, serverId: autoResolve(name) });
      continue;
    }
    // (3) Server-type match (case-insensitive) → the type's representative member (D-ST3).
    const type = typeByLowerName.get(name.toLowerCase());
    if (type) {
      const memberIds = allServers.filter((s) => s.typeId === type.id).map((s) => s.id);
      out.push({
        serverName: name,
        serverId: pickRepresentativeServer(memberIds, scans),
        typeId: type.id,
        resolvedVia: "type",
      });
      continue;
    }
    // (4) No match → honest unbound.
    out.push({ serverName: name, serverId: null });
  }
  // Persisted names not in the frontmatter (stale but part of the developer's picker state) — appended
  // sorted so the GET view still round-trips a PUT that named a server the frontmatter doesn't declare.
  for (const name of [...stored.keys()]
    .filter((n) => !emitted.has(n))
    .sort((a, b) => a.localeCompare(b))) {
    out.push({ serverName: name, serverId: stored.get(name) ?? null });
  }
  return out;
}

/**
 * D-ST3 representative-server selection: among a server type's member ids, pick the member whose newest
 * SUCCESSFUL scan is the newest overall. Deterministic tiebreak — newest `scanned_at` DESC, then server
 * `id` ASC. Returns `null` (honest unbound) when no member has a successful scan, or when the
 * `ScanRepository` isn't wired. `listSummariesByServer(id)` is already newest-first, so `.find(success)`
 * is that member's newest successful scan. Pure persisted read — never opens an MCP connection.
 */
function pickRepresentativeServer(memberIds: string[], scans?: ScanRepository): string | null {
  if (!scans) return null;
  const candidates: { serverId: string; scannedAt: string }[] = [];
  for (const id of memberIds) {
    const latestSuccess = scans
      .listSummariesByServer(id)
      .find((summary) => summary.status === "success");
    if (latestSuccess) candidates.push({ serverId: id, scannedAt: latestSuccess.scannedAt });
  }
  if (candidates.length === 0) return null;
  // ISO-8601 UTC timestamps compare lexicographically in chronological order. Newest scan first; ties
  // broken by the lower server id (string ASC) so the choice is fully deterministic.
  candidates.sort((a, b) =>
    a.scannedAt !== b.scannedAt
      ? a.scannedAt < b.scannedAt
        ? 1
        : -1
      : a.serverId < b.serverId
        ? -1
        : a.serverId > b.serverId
          ? 1
          : 0,
  );
  return candidates[0]?.serverId ?? null;
}

/**
 * The portable `servers:` list from a skill's CURRENT version SKILL.md frontmatter (order-preserving),
 * or `[]` when the skill has no current version or an unparseable/absent `servers:`. Pure read — never
 * throws (a missing/binary SKILL.md degrades to `[]`, like the projector's own loader).
 */
function readFrontmatterServers(repo: SkillRepository, skillId: string): string[] {
  const skill = repo.getPublic(skillId);
  if (!skill.currentVersionId) return [];
  try {
    const content = repo.getFileContent(skill.currentVersionId, "SKILL.md");
    if (content.isBinary) return [];
    return parseSkillManifest(content.text).manifest.servers ?? [];
  } catch {
    return [];
  }
}

// --- Helpers ------------------------------------------------------------------------------------

/**
 * Blank-skill creation (SkillFlow D3, WP 1.2): scaffold a minimal, spec-valid `SKILL.md` from the
 * JSON body's `{ name, description, displayName? }` and register it as version 1 through the SAME
 * `SkillRepository.createVersion` write path uploads and GitHub imports use — manifest parsing,
 * token-footprint counting, and ingest caps all apply unchanged, exactly as for an uploaded file.
 * (`SkillIngestService.ingestUpload` itself isn't reusable here because it never accepts a caller-
 * supplied `source_ref`; `createVersion` — the routine its own docstring calls "shared by upload
 * and GitHub ingestion" — is, so this mirrors `SkillGitService`'s own manifest→footprint→
 * `createVersion` sequence for its source instead of duplicating `SkillIngestService`.)
 *
 * Storage mapping (WP 1.2 acceptance, confirmed against `db/schema.ts` + `repository.ts`):
 * `skills.source_type` and `skill_versions.source_kind` reuse the existing `'upload'` semantics
 * (both columns' `CHECK` constraints only allow `'upload' | 'github'` — no schema change), and
 * `imported_from` is `'upload'` too. `source_ref` is stamped `'blank'` so a blank-created skill
 * stays distinguishable from a real file upload (regular uploads never set `source_ref` today —
 * `SkillIngestService.buildVersionMeta` never populates it).
 *
 * No partial rows on failure: an invalid name/description throws (400) before any row is written;
 * an ingest failure after the skill shell exists deletes it, mirroring the upload branch above.
 */
async function createBlankSkill(
  repo: SkillRepository,
  input: BlankSkillImportInput,
  reply: FastifyReply,
  caps: IngestCaps,
): Promise<Skill> {
  const name = normalizeBlankSkillName(input.name);
  const scaffold = buildBlankSkillTree(input.name, input.description, input.displayName);
  const skill = await persistScaffoldedSkill(
    repo,
    scaffold,
    {
      name,
      displayName: input.displayName,
      sourceRef: "blank",
    },
    caps,
  );
  reply.code(201);
  return skill;
}

/**
 * Persist a scaffolded (single-file) skill tree as version 1 through the SAME
 * `SkillRepository.createVersion` write path uploads/GitHub imports use — the shared body behind BOTH
 * the blank-skill (WP 1.2) and server-scaffold (WP 8.4) create paths. Enforces the SAME ingest caps
 * (caps.ts) every other ingestion path uses — the caller-supplied `caps` (H-4: `registerSkillRoutes`'s
 * `options.caps`, defaulting to `DEFAULT_INGEST_CAPS`, itself env-overridable via `index.ts`'s
 * `skillCaps`) rather than a hardcoded default, so a tightened `SKILL_MAX_*` override actually applies
 * here too. Parses + token-counts the manifest, and rolls back the skill shell on an ingest failure
 * (no partial rows). `sourceRef` stamps provenance (`'blank'` vs `'server-scaffold'`) so a scaffolded
 * skill stays distinguishable from a real file upload. Callers set the reply status (201) themselves.
 */
async function persistScaffoldedSkill(
  repo: SkillRepository,
  scaffold: BlankSkillFile[],
  opts: { name: string; displayName?: string; sourceRef: string },
  caps: IngestCaps,
): Promise<Skill> {
  const skillMd = scaffold[0];
  if (!skillMd) throw httpError(500, "Scaffold produced no files.");

  assertFileCountCap(scaffold.length, caps);
  let totalBytes = 0;
  for (const file of scaffold) {
    assertFileCap(file.content.byteLength, caps);
    totalBytes += file.content.byteLength;
  }
  assertTotalCap(totalBytes, caps);

  const parsed = parseSkillManifest(skillMd.content.toString("utf8"));
  const footprintFiles: SkillFootprintFile[] = scaffold.map((file) => ({
    path: file.path,
    isBinary: false,
    text: file.content.toString("utf8"),
  }));
  const levels = await countLevels(footprintFiles, parsed.manifest, parsed.body);
  const byPath = new Map<string, number>();
  for (const file of levels.files) byPath.set(file.path, file.tokenTotal);

  const skill = repo.create({
    name: opts.name,
    displayName: opts.displayName,
    sourceType: "upload",
  });
  try {
    const files: SkillFileInput[] = scaffold.map((file) => ({
      path: file.path,
      bytes: file.content,
    }));
    const meta: CreateVersionMeta = {
      sourceKind: "upload",
      importedFrom: "upload",
      sourceRef: opts.sourceRef,
      manifest: parsed.manifest,
      manifestValid: parsed.valid,
      manifestErrors: parsed.errors,
      tokenProfile: levels.tokenProfile,
      footprint: { l1: levels.l1, l2: levels.l2, l3: levels.l3, total: levels.total, byPath },
    };
    repo.createVersion(skill.id, files, meta);
  } catch (err) {
    // No partial rows: an ingest failure removes the just-created skill shell (mirrors the upload
    // branch above), though in practice a scaffold this small should never breach a cap.
    repo.delete(skill.id);
    throw err;
  }

  return repo.getPublic(skill.id);
}

/** Read the single file part (+ optional `displayName` field) from a multipart request. */
async function readMultipart(request: FastifyRequest): Promise<MultipartUpload> {
  let buffer: Buffer | undefined;
  let filename = "upload";
  let displayName: string | undefined;

  const parts = request.parts();
  for await (const part of parts) {
    if (part.type === "file") {
      filename = part.filename || filename;
      try {
        buffer = await part.toBuffer();
      } catch (err) {
        // @fastify/multipart throws when the file part exceeds the configured size limit.
        throw httpError(400, `Upload exceeds the size limit: ${(err as Error).message}`);
      }
    } else if (part.fieldname === "displayName" && typeof part.value === "string") {
      displayName = part.value.trim() || undefined;
    }
  }

  if (!buffer || buffer.byteLength === 0) {
    throw httpError(400, "No file part found in the upload.");
  }
  return { buffer, filename, displayName };
}

function respondVersion(
  reply: FastifyReply,
  result: CreateVersionResult,
): SkillVersion | { unchanged: true } {
  if (result.unchanged) {
    return { unchanged: true };
  }
  reply.code(201);
  return result.version;
}

/** Validate the shared `from`/`to` version-id query params on the diff routes (400 if missing). */
function requireDiffQuery(request: FastifyRequest): { from: string; to: string } {
  const { from, to } = request.query as { from?: string; to?: string };
  if (typeof from !== "string" || from.length === 0) {
    throw httpError(400, "Query parameter 'from' is required.");
  }
  if (typeof to !== "string" || to.length === 0) {
    throw httpError(400, "Query parameter 'to' is required.");
  }
  return { from, to };
}

/** 404 if the version id isn't a version of this skill (guards cross-skill diff requests). */
function assertVersionOfSkill(repo: SkillRepository, skillId: string, versionId: string): void {
  const version = repo.getVersion(versionId); // 404 if the version is missing
  if (version.skillId !== skillId) {
    throw httpError(404, "Skill version not found");
  }
}

function requirePathQuery(request: FastifyRequest): string {
  const { path } = request.query as { path?: string };
  if (typeof path !== "string" || path.length === 0) {
    throw httpError(400, "Query parameter 'path' is required.");
  }
  return path;
}

function rawPath(id: string, vid: string, path: string): string {
  return `/api/skills/${id}/versions/${vid}/raw?path=${encodeURIComponent(path)}`;
}

/** Derive a spec-valid skill name from an upload filename (lowercase, hyphenated). */
function deriveNameFromFilename(filename: string): string {
  const stem = basename(filename).replace(/\.(zip|md)$/i, "");
  const slug = stem
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "skill";
}

function basename(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] ?? p;
}

function sanitizeDisposition(name: string): string {
  return name.replace(/["\r\n]/g, "_");
}
