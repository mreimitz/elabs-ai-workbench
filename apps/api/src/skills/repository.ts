import crypto from "node:crypto";
import { nanoid } from "nanoid";
import type {
  Skill,
  SkillFileContent,
  SkillFileNode,
  SkillIntentLogEntry,
  SkillManifest,
  SkillUsage,
  SkillUsageEnvironment,
  SkillUsageRun,
  SkillVersion,
  TokenProfileId,
} from "@mcp-token-footprint/shared";
import { DEFAULT_TOKEN_PROFILE } from "@mcp-token-footprint/shared";
import type { AppDatabase } from "../db/database.js";
import type { SkillFileRow, SkillRow, SkillVersionRow } from "../db/rows.js";
import type { SecretStore } from "../secrets/secret-store.js";
import { httpError } from "../utils/errors.js";
import { parseJsonObject } from "../utils/json.js";

/** A single file handed to `createVersion` — a posix path plus its raw bytes. */
export type SkillFileInput = {
  path: string;
  bytes: Buffer;
};

/** One file's diff-relevant fields (from `getDiffFileMap`) — hashed & token-compared by WP 1.5. */
export type SkillDiffFile = {
  blobSha: string;
  tokens: number;
  kind: SkillFileNode["kind"];
  binary: boolean;
  size: number;
};

/** GitHub binding fields (internal — carries the encrypted PAT ref, never exposed to the web). */
export type SkillGithubBinding = {
  repoUrl: string;
  ref: string;
  subpath: string;
  lastSha?: string;
  /** PAT plaintext; encrypted on write via `SecretStore`. Omit to leave unchanged. */
  token?: string;
};

export type CreateSkillInput = {
  name: string;
  displayName?: string;
  slug?: string;
  sourceType: "upload" | "github";
  description?: string;
  github?: SkillGithubBinding;
};

export type UpdateSkillInput = {
  displayName?: string;
  description?: string;
  github?: {
    /** Retarget the tracked repo (github-bound skills only; resets `last_sha` — see `update`). */
    repoUrl?: string;
    ref?: string;
    /** Retarget the tracked subpath ('' = repo root; resets `last_sha` — see `update`). */
    subpath?: string;
    lastSha?: string;
    /** `undefined` = leave unchanged; `null` = clear the PAT; string = set/replace it. */
    token?: string | null;
  };
};

/**
 * Precomputed token footprint for a version (from `countLevels`). When present, `createVersion`
 * backfills the L1/L2/L3 + total columns on `skill_versions` and per-file `token_total` on
 * `skill_files` (`byPath` maps a posix file path → its token total). Omitted → zeros are stored.
 */
export type CreateVersionFootprint = {
  l1: number;
  l2: number;
  l3: number;
  total: number;
  byPath: Map<string, number>;
};

/** Metadata that accompanies a `createVersion` call (source provenance + manifest). */
export type CreateVersionMeta = {
  sourceKind: "upload" | "github";
  importedFrom: "upload" | "github-pull";
  sourceRef?: string;
  manifest?: SkillManifest;
  manifestValid?: boolean;
  manifestErrors?: string[];
  /** Optional explicit label; otherwise derived (metadata.version → short sha → v{seq}). */
  versionLabel?: string;
  tokenProfile?: TokenProfileId;
  note?: string;
  /**
   * Skill IDE WP 9.1 (I10.3): the live-draft save's op INTENT LOG — the staged ops that produced this
   * content-canonical version. Serialized into `skill_versions.intent_log_json` (JSON) so op-level
   * audit granularity survives the text save. Absent (upload/GitHub/other paths) → NULL.
   */
  intentLog?: SkillIntentLogEntry[];
  /** Precomputed L1/L2/L3 + per-file token totals; backfilled into the version + file rows. */
  footprint?: CreateVersionFootprint;
};

export type CreateVersionResult =
  | { unchanged: true; version: SkillVersion }
  | { unchanged: false; version: SkillVersion };

/** Internal view of a skill: adds the decrypted GitHub PAT for API-side use (network/git). */
export type InternalSkill = Skill & { githubToken?: string };

export class SkillRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly secrets: SecretStore,
  ) {}

  // --- Skills ---------------------------------------------------------------------------------

  list(): Skill[] {
    const rows = this.db
      .prepare("SELECT * FROM skills ORDER BY updated_at DESC")
      .all() as SkillRow[];
    return rows.map((row) => toPublicSkill(row, this.versionCount(row.id)));
  }

  getPublic(id: string): Skill {
    const row = this.getRow(id);
    return toPublicSkill(row, this.versionCount(id));
  }

  /**
   * UX WP 3.3 (G11/S20) — a skill's usage across the app: the environments (scenarios) it is attached
   * to (via `scenario_skills`) plus its most-recent runs (via `run_skills`, newest first, capped).
   * Read-only projection; opens no MCP connection and mutates nothing. `getPublic` first so an unknown
   * skill 404s consistently with the other routes.
   */
  getUsage(id: string, runLimit = 5): SkillUsage {
    this.getRow(id); // 404 if the skill is missing

    const environments = this.db
      .prepare(
        `SELECT s.id AS scenarioId, s.name AS name,
                ss.version_mode AS versionMode, ss.pinned_version_id AS pinnedVersionId, ss.eager AS eager
           FROM scenario_skills ss
           JOIN scenarios s ON s.id = ss.scenario_id
          WHERE ss.skill_id = ?
          ORDER BY s.name ASC`,
      )
      .all(id) as {
      scenarioId: string;
      name: string;
      versionMode: string;
      pinnedVersionId: string | null;
      eager: number;
    }[];

    // Runs that RESOLVED this skill (any version), newest first. `scenario_id`/status/outcome come from
    // the immutable `runs` row; `version_label` is the denormalized display label on `run_skills` (it
    // survives a later version deletion). `s.name` is LEFT-joined so a run against a since-deleted
    // environment still lists (name → null).
    const runs = this.db
      .prepare(
        `SELECT r.id AS runId, r.status AS status, r.outcome AS outcome, r.started_at AS startedAt,
                rs.version_label AS versionLabel, r.scenario_id AS scenarioId, s.name AS scenarioName
           FROM run_skills rs
           JOIN runs r ON r.id = rs.run_id
           LEFT JOIN scenarios s ON s.id = r.scenario_id
          WHERE rs.skill_id = ?
          ORDER BY r.started_at DESC
          LIMIT ?`,
      )
      .all(id, runLimit) as {
      runId: string;
      status: string;
      outcome: string | null;
      startedAt: string;
      versionLabel: string;
      scenarioId: string;
      scenarioName: string | null;
    }[];

    return {
      skillId: id,
      environments: environments.map(
        (row): SkillUsageEnvironment => ({
          scenarioId: row.scenarioId,
          name: row.name,
          versionMode: row.versionMode === "pinned" ? "pinned" : "latest",
          ...(row.pinnedVersionId ? { pinnedVersionId: row.pinnedVersionId } : {}),
          eager: row.eager === 1,
        }),
      ),
      runs: runs.map(
        (row): SkillUsageRun => ({
          runId: row.runId,
          status: row.status as SkillUsageRun["status"],
          ...(row.outcome ? { outcome: row.outcome as SkillUsageRun["outcome"] } : {}),
          startedAt: row.startedAt,
          versionLabel: row.versionLabel,
          scenarioId: row.scenarioId,
          ...(row.scenarioName ? { scenarioName: row.scenarioName } : {}),
        }),
      ),
    };
  }

  getInternal(id: string): InternalSkill {
    const row = this.getRow(id);
    const skill = toPublicSkill(row, this.versionCount(id));
    const githubToken = row.github_auth_ref
      ? this.secrets.decryptText(row.github_auth_ref)
      : undefined;
    return { ...skill, githubToken };
  }

  create(input: CreateSkillInput): Skill {
    const now = new Date().toISOString();
    const id = nanoid();
    const displayName = input.displayName?.trim() || input.name;
    const slug = this.uniqueSlug(input.slug ?? input.name);
    const github = input.github;

    this.db
      .prepare(
        `INSERT INTO skills (
          id, name, display_name, slug, source_type, description, current_version_id,
          github_repo_url, github_ref, github_subpath, github_auth_ref, github_last_sha,
          created_at, updated_at
        ) VALUES (
          @id, @name, @displayName, @slug, @sourceType, @description, NULL,
          @repoUrl, @ref, @subpath, @authRef, @lastSha, @createdAt, @updatedAt
        )`,
      )
      .run({
        id,
        name: input.name,
        displayName,
        slug,
        sourceType: input.sourceType,
        description: input.description ?? null,
        repoUrl: github?.repoUrl ?? null,
        ref: github?.ref ?? null,
        subpath: github?.subpath ?? null,
        authRef: github?.token ? this.secrets.encryptText(github.token) : null,
        lastSha: github?.lastSha ?? null,
        createdAt: now,
        updatedAt: now,
      });

    return this.getPublic(id);
  }

  update(id: string, input: UpdateSkillInput): Skill {
    const row = this.getRow(id);
    const now = new Date().toISOString();

    let authRef = row.github_auth_ref;
    if (input.github && "token" in input.github) {
      if (input.github.token === null) authRef = null;
      else if (typeof input.github.token === "string")
        authRef = this.secrets.encryptText(input.github.token);
    }

    // Retargeting what the skill TRACKS (repo url / ref / subpath) invalidates the recorded
    // `last_sha` — it belongs to the previous target, and keeping it would make the next pull's
    // same-sha fast path (and the upstream badge) lie. An explicit `lastSha` in the input wins.
    const repoUrl = input.github?.repoUrl ?? row.github_repo_url;
    const ref = input.github?.ref ?? row.github_ref;
    const subpath = input.github?.subpath ?? row.github_subpath;
    const retargeted =
      repoUrl !== row.github_repo_url || ref !== row.github_ref || subpath !== row.github_subpath;
    const lastSha = input.github?.lastSha ?? (retargeted ? null : row.github_last_sha);

    this.db
      .prepare(
        `UPDATE skills SET
          display_name = @displayName,
          description = @description,
          github_repo_url = @repoUrl,
          github_ref = @ref,
          github_subpath = @subpath,
          github_auth_ref = @authRef,
          github_last_sha = @lastSha,
          updated_at = @updatedAt
        WHERE id = @id`,
      )
      .run({
        id,
        displayName: input.displayName?.trim() || row.display_name,
        description: input.description ?? row.description,
        repoUrl,
        ref,
        subpath,
        authRef,
        lastSha,
        updatedAt: now,
      });

    return this.getPublic(id);
  }

  /**
   * Bind (or rebind) a skill to a GitHub source, writing the full github column set exactly as an
   * import does (`repo_url`, `ref`, `subpath`, encrypted PAT, `last_sha`) and flipping `source_type`
   * to `'github'`. `update()` deliberately cannot touch `repo_url`/`subpath`/`source_type` (it only
   * refreshes an already-bound skill's ref/token/sha), so the publisher's bind-as-source path (I6,
   * WP 7.1) uses this dedicated write. The PAT is encrypted via `SecretStore`; omit `token` to leave
   * the existing auth blob unchanged. Never rebinds silently — the caller refuses an already-bound
   * skill with a 409 before reaching here.
   */
  bindGithubSource(skillId: string, binding: SkillGithubBinding): Skill {
    const row = this.getRow(skillId);
    const now = new Date().toISOString();
    const authRef =
      typeof binding.token === "string"
        ? this.secrets.encryptText(binding.token)
        : row.github_auth_ref;
    this.db
      .prepare(
        `UPDATE skills SET
          source_type = 'github',
          github_repo_url = @repoUrl,
          github_ref = @ref,
          github_subpath = @subpath,
          github_auth_ref = @authRef,
          github_last_sha = @lastSha,
          updated_at = @now
        WHERE id = @id`,
      )
      .run({
        id: skillId,
        repoUrl: binding.repoUrl,
        ref: binding.ref,
        subpath: binding.subpath,
        authRef,
        lastSha: binding.lastSha ?? null,
        now,
      });
    return this.getPublic(skillId);
  }

  /**
   * Canonicalize a skill's identity from its parsed SKILL.md manifest. The upload route creates the
   * skill shell with a filename-derived placeholder before the manifest is parsed; once the first
   * version is ingested we set the real `name` (and, unless the caller supplied one, the display
   * name) from the manifest so the registry shows the skill's actual name (e.g. `pdf-processing`),
   * not the upload filename (`pdf-v1`). The slug follows the name.
   */
  applyManifestIdentity(id: string, manifestName: string, userDisplayName?: string): Skill {
    const row = this.getRow(id);
    const name = manifestName.trim();
    if (!name) return this.getPublic(id);
    const displayName = userDisplayName?.trim() || name;
    const slug = slugify(name) === row.slug ? row.slug : this.uniqueSlug(name);
    this.db
      .prepare(
        "UPDATE skills SET name = @name, display_name = @displayName, slug = @slug, updated_at = @now WHERE id = @id",
      )
      .run({ id, name, displayName, slug, now: new Date().toISOString() });
    return this.getPublic(id);
  }

  delete(id: string): void {
    this.getRow(id); // 404 if missing
    const tx = this.db.transaction(() => {
      // Break the FK loop first so the version cascade can run, then delete the skill.
      this.db.prepare("UPDATE skills SET current_version_id = NULL WHERE id = ?").run(id);
      this.db.prepare("DELETE FROM skills WHERE id = ?").run(id);
      this.deleteOrphanBlobs();
    });
    tx();
  }

  // --- Versions -------------------------------------------------------------------------------

  listVersions(skillId: string): SkillVersion[] {
    this.getRow(skillId); // 404 if missing
    const rows = this.db
      .prepare("SELECT * FROM skill_versions WHERE skill_id = ? ORDER BY seq DESC")
      .all(skillId) as SkillVersionRow[];
    return rows.map(toVersion);
  }

  getVersion(versionId: string): SkillVersion {
    return toVersion(this.getVersionRow(versionId));
  }

  /**
   * The one create-version routine shared by upload and GitHub ingestion. Content-addresses every
   * file (sha256 → `skill_blobs`), computes `tree_sha`, and short-circuits to `{ unchanged: true }`
   * when the tree matches the current version. Token counts are 0 here (WP 1.2/1.3 backfill them).
   */
  createVersion(
    skillId: string,
    files: SkillFileInput[],
    meta: CreateVersionMeta,
  ): CreateVersionResult {
    const skill = this.getRow(skillId);
    const tokenProfile: TokenProfileId = meta.tokenProfile ?? DEFAULT_TOKEN_PROFILE;

    // Hash every file up-front and build the (path → blob_sha) entries.
    const entries = files
      .map((file) => {
        const sha = sha256(file.bytes);
        const binary = isBinary(file.bytes);
        return {
          path: file.path,
          bytes: file.bytes,
          sha,
          size: file.bytes.byteLength,
          binary,
          isSkillMd: isSkillMdPath(file.path),
          kind: classifyKind(file.path, binary),
        };
      })
      .sort((a, b) => a.path.localeCompare(b.path));

    const treeSha = computeTreeSha(entries.map((e) => ({ path: e.path, sha: e.sha })));

    // No-op when the tree matches the current version.
    if (skill.current_version_id) {
      const current = this.db
        .prepare("SELECT * FROM skill_versions WHERE id = ?")
        .get(skill.current_version_id) as SkillVersionRow | undefined;
      if (current && current.tree_sha === treeSha) {
        return { unchanged: true, version: toVersion(current) };
      }
    }

    const now = new Date().toISOString();
    const versionId = nanoid();
    const totalBytes = entries.reduce((sum, e) => sum + e.size, 0);
    const footprint = meta.footprint;

    const tx = this.db.transaction(() => {
      const seqRow = this.db
        .prepare("SELECT COALESCE(MAX(seq), 0) AS maxSeq FROM skill_versions WHERE skill_id = ?")
        .get(skillId) as { maxSeq: number };
      const seq = seqRow.maxSeq + 1;
      const versionLabel = meta.versionLabel?.trim() || this.deriveLabel(skillId, meta, seq);

      this.db
        .prepare(
          `INSERT INTO skill_versions (
            id, skill_id, seq, version_label, tree_sha, source_kind, source_ref,
            manifest_json, manifest_valid, manifest_errors_json, token_profile,
            file_count, total_bytes, l1_metadata_tokens, l2_body_tokens, l3_resource_tokens,
            total_tokens, imported_from, note, intent_log_json, created_at
          ) VALUES (
            @id, @skillId, @seq, @versionLabel, @treeSha, @sourceKind, @sourceRef,
            @manifestJson, @manifestValid, @manifestErrorsJson, @tokenProfile,
            @fileCount, @totalBytes, @l1, @l2, @l3, @totalTokens, @importedFrom, @note, @intentLogJson, @createdAt
          )`,
        )
        .run({
          id: versionId,
          skillId,
          seq,
          versionLabel,
          treeSha,
          sourceKind: meta.sourceKind,
          sourceRef: meta.sourceRef ?? null,
          manifestJson: JSON.stringify(meta.manifest ?? {}),
          manifestValid: meta.manifestValid === false ? 0 : 1,
          manifestErrorsJson: JSON.stringify(meta.manifestErrors ?? []),
          tokenProfile,
          fileCount: entries.length,
          totalBytes,
          l1: footprint?.l1 ?? 0,
          l2: footprint?.l2 ?? 0,
          l3: footprint?.l3 ?? 0,
          totalTokens: footprint?.total ?? 0,
          importedFrom: meta.importedFrom,
          note: meta.note ?? null,
          intentLogJson:
            meta.intentLog && meta.intentLog.length > 0 ? JSON.stringify(meta.intentLog) : null,
          createdAt: now,
        });

      const upsertBlob = this.db.prepare(
        `INSERT INTO skill_blobs (sha256, content, size, is_binary, created_at)
         VALUES (@sha, @content, @size, @isBinary, @createdAt)
         ON CONFLICT(sha256) DO NOTHING`,
      );
      const insertFile = this.db.prepare(
        `INSERT INTO skill_files (
          id, version_id, path, blob_sha, size, is_binary, is_skill_md, kind, token_total
        ) VALUES (
          @id, @versionId, @path, @blobSha, @size, @isBinary, @isSkillMd, @kind, @tokenTotal
        )`,
      );

      for (const entry of entries) {
        upsertBlob.run({
          sha: entry.sha,
          content: entry.bytes,
          size: entry.size,
          isBinary: entry.binary ? 1 : 0,
          createdAt: now,
        });
        insertFile.run({
          id: nanoid(),
          versionId,
          path: entry.path,
          blobSha: entry.sha,
          size: entry.size,
          isBinary: entry.binary ? 1 : 0,
          isSkillMd: entry.isSkillMd ? 1 : 0,
          kind: entry.kind,
          tokenTotal: footprint?.byPath.get(entry.path) ?? 0,
        });
      }

      // The new version becomes current; refresh the cached description from its manifest.
      this.db
        .prepare(
          "UPDATE skills SET current_version_id = @versionId, description = @description, updated_at = @now WHERE id = @skillId",
        )
        .run({
          versionId,
          description: meta.manifest?.description ?? skill.description ?? null,
          now,
          skillId,
        });

      // No orphan blobs are produced by a create, but keep the store tidy after seq churn.
      this.deleteOrphanBlobs();
    });

    tx();
    return { unchanged: false, version: this.getVersion(versionId) };
  }

  deleteVersion(versionId: string): void {
    const version = this.getVersionRow(versionId);
    // WP 2.1 delete-guard: refuse to delete a version pinned by a scenario. Phase 1 returns [].
    const pinnedBy = this.versionPinnedBy(versionId);
    if (pinnedBy.length > 0) {
      throw httpError(409, "Version is pinned by one or more scenarios");
    }

    const tx = this.db.transaction(() => {
      if (this.isCurrentVersion(version.skill_id, versionId)) {
        // Re-point `current_version_id` at the next-highest surviving version (or NULL).
        const next = this.db
          .prepare(
            "SELECT id FROM skill_versions WHERE skill_id = ? AND id != ? ORDER BY seq DESC LIMIT 1",
          )
          .get(version.skill_id, versionId) as { id: string } | undefined;
        this.db
          .prepare("UPDATE skills SET current_version_id = ?, updated_at = ? WHERE id = ?")
          .run(next?.id ?? null, new Date().toISOString(), version.skill_id);
      }
      this.db.prepare("DELETE FROM skill_versions WHERE id = ?").run(versionId);
      this.deleteOrphanBlobs();
    });
    tx();
  }

  deleteSkill(skillId: string): void {
    this.getRow(skillId); // 404 if missing
    // Block-delete (Q6): if any of this skill's versions is pinned by a scenario, deleting the skill
    // would cascade that pinned version away. Refuse — the scenario must detach/re-pin first.
    const pinnedBy = this.skillPinnedBy(skillId);
    if (pinnedBy.length > 0) {
      throw httpError(409, "Skill has a version pinned by one or more scenarios");
    }
    this.delete(skillId);
  }

  /**
   * Delete-guard (WP 2.1, Q6): scenario ids that **pin** the given version via `scenario_skills`
   * (`version_mode = 'pinned'`). A non-empty result blocks the version delete with a 409. A
   * `latest`-mode attachment never pins a specific version, so it never appears here (its skill
   * delete follows the normal cascade).
   */
  versionPinnedBy(versionId: string): string[] {
    const rows = this.db
      .prepare(
        "SELECT scenario_id FROM scenario_skills WHERE version_mode = 'pinned' AND pinned_version_id = ?",
      )
      .all(versionId) as Array<{ scenario_id: string }>;
    return rows.map((row) => row.scenario_id);
  }

  /** Scenario ids that pin **any** version of the given skill (drives the skill-delete guard). */
  private skillPinnedBy(skillId: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT ss.scenario_id AS scenario_id
           FROM scenario_skills ss
           JOIN skill_versions sv ON sv.id = ss.pinned_version_id
          WHERE ss.version_mode = 'pinned' AND sv.skill_id = ?`,
      )
      .all(skillId) as Array<{ scenario_id: string }>;
    return rows.map((row) => row.scenario_id);
  }

  // --- Files ----------------------------------------------------------------------------------

  listFiles(versionId: string): SkillFileNode[] {
    this.getVersionRow(versionId); // 404 if missing
    const rows = this.db
      .prepare("SELECT * FROM skill_files WHERE version_id = ? ORDER BY path ASC")
      .all(versionId) as SkillFileRow[];
    return rows.map(toFileNode);
  }

  getFileContent(versionId: string, path: string): SkillFileContent {
    const file = this.db
      .prepare("SELECT * FROM skill_files WHERE version_id = ? AND path = ?")
      .get(versionId, path) as SkillFileRow | undefined;
    if (!file) throw httpError(404, "Skill file not found");

    const blob = this.db
      .prepare("SELECT content FROM skill_blobs WHERE sha256 = ?")
      .get(file.blob_sha) as { content: Buffer } | undefined;
    if (!blob) throw httpError(404, "Skill blob not found");

    if (file.is_binary) {
      return {
        path: file.path,
        isBinary: true,
        size: file.size,
        downloadPath: `/api/skills/versions/${versionId}/files/raw?path=${encodeURIComponent(path)}`,
      };
    }

    return {
      path: file.path,
      isBinary: false,
      text: blob.content.toString("utf8"),
      tokenTotal: file.token_total,
    };
  }

  /** Raw bytes + metadata for one file in a version (feeds the `raw?path=` download + export). */
  getFileBytes(
    versionId: string,
    path: string,
  ): { path: string; bytes: Buffer; isBinary: boolean } {
    const file = this.db
      .prepare("SELECT * FROM skill_files WHERE version_id = ? AND path = ?")
      .get(versionId, path) as SkillFileRow | undefined;
    if (!file) throw httpError(404, "Skill file not found");

    const blob = this.db
      .prepare("SELECT content FROM skill_blobs WHERE sha256 = ?")
      .get(file.blob_sha) as { content: Buffer } | undefined;
    if (!blob) throw httpError(404, "Skill blob not found");

    return { path: file.path, bytes: Buffer.from(blob.content), isBinary: file.is_binary !== 0 };
  }

  /**
   * `path → { blobSha, tokens, kind, binary, size }` for every file of a version — the input the
   * diff engine (WP 1.5) hash-compares between two versions. Cheaper than `listFiles` (no wire
   * mapping) and keyed by path for O(1) lookups.
   */
  getDiffFileMap(versionId: string): Map<string, SkillDiffFile> {
    this.getVersionRow(versionId); // 404 if missing
    const rows = this.db
      .prepare("SELECT * FROM skill_files WHERE version_id = ?")
      .all(versionId) as SkillFileRow[];
    const map = new Map<string, SkillDiffFile>();
    for (const row of rows) {
      map.set(row.path, {
        blobSha: row.blob_sha,
        tokens: row.token_total,
        kind: row.kind,
        binary: row.is_binary !== 0,
        size: row.size,
      });
    }
    return map;
  }

  /** Every file of a version as `{ path, bytes }` (rebuilds the exact tree for export). */
  getVersionFiles(versionId: string): Array<{ path: string; bytes: Buffer }> {
    this.getVersionRow(versionId); // 404 if missing
    const rows = this.db
      .prepare(
        `SELECT f.path AS path, b.content AS content
           FROM skill_files f JOIN skill_blobs b ON b.sha256 = f.blob_sha
          WHERE f.version_id = ? ORDER BY f.path ASC`,
      )
      .all(versionId) as Array<{ path: string; content: Buffer }>;
    return rows.map((row) => ({ path: row.path, bytes: Buffer.from(row.content) }));
  }

  // --- Internal helpers -----------------------------------------------------------------------

  /** Content-addressed GC: drop any blob no live `skill_files` row references. */
  private deleteOrphanBlobs(): void {
    this.db
      .prepare("DELETE FROM skill_blobs WHERE sha256 NOT IN (SELECT blob_sha FROM skill_files)")
      .run();
  }

  private versionCount(skillId: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM skill_versions WHERE skill_id = ?")
      .get(skillId) as { n: number };
    return row.n;
  }

  private isCurrentVersion(skillId: string, versionId: string): boolean {
    const row = this.db
      .prepare("SELECT current_version_id FROM skills WHERE id = ?")
      .get(skillId) as { current_version_id: string | null } | undefined;
    return row?.current_version_id === versionId;
  }

  private getRow(id: string): SkillRow {
    const row = this.db.prepare("SELECT * FROM skills WHERE id = ?").get(id) as
      | SkillRow
      | undefined;
    if (!row) throw httpError(404, "Skill not found");
    return row;
  }

  private getVersionRow(versionId: string): SkillVersionRow {
    const row = this.db.prepare("SELECT * FROM skill_versions WHERE id = ?").get(versionId) as
      | SkillVersionRow
      | undefined;
    if (!row) throw httpError(404, "Skill version not found");
    return row;
  }

  private uniqueSlug(seed: string): string {
    const base = slugify(seed) || "skill";
    let candidate = base;
    let suffix = 1;
    while (this.slugTaken(candidate)) {
      suffix += 1;
      candidate = `${base}-${suffix}`;
    }
    return candidate;
  }

  private slugTaken(slug: string): boolean {
    const row = this.db.prepare("SELECT 1 FROM skills WHERE slug = ?").get(slug);
    return Boolean(row);
  }

  /**
   * Version label priority (planning/Research/RS-02-skill-registry/outputs/04-versioning-and-diff.md): `metadata.version` when present AND not
   * already used by another version of this skill → git short-sha (GitHub) → `v{seq}`.
   */
  private deriveLabel(skillId: string, meta: CreateVersionMeta, seq: number): string {
    const metaVersion = meta.manifest?.metadata?.version?.trim();
    if (metaVersion && !this.labelTaken(skillId, metaVersion)) return metaVersion;
    if (meta.sourceKind === "github" && meta.sourceRef) return meta.sourceRef.slice(0, 7);
    return `v${seq}`;
  }

  private labelTaken(skillId: string, label: string): boolean {
    const row = this.db
      .prepare("SELECT 1 FROM skill_versions WHERE skill_id = ? AND version_label = ?")
      .get(skillId, label);
    return Boolean(row);
  }
}

// --- Row → wire mappers -------------------------------------------------------------------------

function toPublicSkill(row: SkillRow, versionCount: number): Skill {
  const skill: Skill = {
    id: row.id,
    name: row.name,
    displayName: row.display_name,
    slug: row.slug,
    sourceType: row.source_type,
    description: row.description ?? undefined,
    currentVersionId: row.current_version_id ?? undefined,
    versionCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  if (row.source_type === "github" && row.github_repo_url) {
    // Redaction: expose only `hasAuth` — never the PAT (`github_auth_ref`).
    skill.github = {
      repoUrl: row.github_repo_url,
      ref: row.github_ref ?? "",
      subpath: row.github_subpath ?? "",
      lastSha: row.github_last_sha ?? undefined,
      hasAuth: Boolean(row.github_auth_ref),
    };
  }

  return skill;
}

function toVersion(row: SkillVersionRow): SkillVersion {
  return {
    id: row.id,
    skillId: row.skill_id,
    seq: row.seq,
    versionLabel: row.version_label,
    treeSha: row.tree_sha,
    sourceKind: row.source_kind,
    sourceRef: row.source_ref ?? undefined,
    manifest: parseJsonObject<SkillManifest>(row.manifest_json, { name: "", description: "" }),
    manifestValid: row.manifest_valid !== 0,
    manifestErrors: parseJsonObject<string[]>(row.manifest_errors_json, []),
    fileCount: row.file_count,
    totalBytes: row.total_bytes,
    tokenProfile: row.token_profile,
    l1MetadataTokens: row.l1_metadata_tokens,
    l2BodyTokens: row.l2_body_tokens,
    l3ResourceTokens: row.l3_resource_tokens,
    totalTokens: row.total_tokens,
    importedFrom: row.imported_from,
    note: row.note ?? undefined,
    createdAt: row.created_at,
  };
}

function toFileNode(row: SkillFileRow): SkillFileNode {
  return {
    path: row.path,
    size: row.size,
    isBinary: row.is_binary !== 0,
    isSkillMd: row.is_skill_md !== 0,
    kind: row.kind,
    tokenTotal: row.token_total,
  };
}

// --- Pure helpers -------------------------------------------------------------------------------

export function sha256(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

/** `tree_sha` = sha256 over the sorted `path:blob_sha` lines (git-object-model style). */
export function computeTreeSha(entries: Array<{ path: string; sha: string }>): string {
  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path));
  const manifest = sorted.map((e) => `${e.path}:${e.sha}`).join("\n");
  return crypto.createHash("sha256").update(manifest, "utf8").digest("hex");
}

/** Binary heuristic: a NUL byte or bytes that don't round-trip as UTF-8. */
export function isBinary(bytes: Buffer): boolean {
  if (bytes.includes(0)) return true;
  const decoded = bytes.toString("utf8");
  return !Buffer.from(decoded, "utf8").equals(bytes);
}

function isSkillMdPath(path: string): boolean {
  return path === "SKILL.md";
}

function classifyKind(path: string, binary: boolean): SkillFileNode["kind"] {
  if (isSkillMdPath(path)) return "skill_md";
  if (binary) return "asset";
  if (path.startsWith("scripts/")) return "script";
  if (path.startsWith("references/") || path.startsWith("reference/")) return "reference";
  const lower = path.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".txt")) return "reference";
  if (path.startsWith("assets/")) return "asset";
  return "other";
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
