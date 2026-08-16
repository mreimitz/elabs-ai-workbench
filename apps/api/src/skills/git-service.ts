import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { type SkillRepoProbe, type TokenProfileId } from "@mcp-token-footprint/shared";
import {
  assertHostAllowed,
  type DnsLookupAll,
  defaultLookup,
  errText,
  looksLikeAuthFailure,
  redactUrl,
  runGit,
  withToken,
} from "../git/git-credential.js";
import { countLevels, type SkillFootprintFile } from "./footprint.js";
import {
  DEFAULT_INGEST_CAPS,
  assertFileCap,
  assertFileCountCap,
  assertTotalCap,
  type IngestCaps,
} from "./caps.js";
import { parseSkillManifest } from "./manifest.js";
import type {
  CreateVersionFootprint,
  CreateVersionMeta,
  CreateVersionResult,
  InternalSkill,
  SkillFileInput,
  SkillRepository,
} from "./repository.js";
import { isBinary } from "./repository.js";
import { httpError } from "../utils/errors.js";

// The git credential / SSRF / redaction discipline lives in ONE place (`../git/git-credential.ts`) and
// is imported above; re-export the resolver type so existing importers (`./publish-service`, tests)
// keep resolving it from here without knowing it moved.
export type { DnsLookupAll } from "../git/git-credential.js";

/** Files/dirs we never store from a git checkout (VCS + OS cruft). */
const IGNORED_TOP_DIRS = new Set([".git"]);
/** Max directory depth to scan for `SKILL.md` candidates (monorepo guard). */
const MAX_PROBE_DEPTH = 8;

export type GitServiceOptions = {
  dataDir: string;
  tokenProfile?: TokenProfileId;
  /** git subprocess timeout (ms). A blocked/slow clone fails cleanly rather than hanging. */
  gitTimeoutMs?: number;
  /** Ingest caps (same guard as the upload path); defaults to the shared-constant caps. */
  caps?: IngestCaps;
  /**
   * F1 — DNS resolver for the pre-clone SSRF guard. Injectable for tests; defaults to
   * {@link dns.promises.lookup}. See {@link SkillGitService.assertResolvableHost}.
   */
  lookup?: DnsLookupAll;
  /**
   * The app-wide GitHub account token (Settings sign-in), used as the LAST auth fallback for
   * probe/import/pull/upstream when neither an explicit token nor a per-skill stored PAT exists.
   * A provider function (not a value) so sign-in/out applies immediately; in-process only.
   */
  accountToken?: () => string | undefined;
};

/** Input to `importSkill` — the chosen repo/ref/subpath plus an optional PAT (private repos). */
export type GitImportInput = {
  repoUrl: string;
  ref: string;
  /** '' = repo root; else the chosen skill directory (posix, relative to repo root). */
  subpath: string;
  token?: string;
  displayName?: string;
};

export type GitImportResult = { skillId: string; versionId: string };

export type GitPullResult =
  | { unchanged: true }
  | { unchanged: false; versionId: string; sha: string };

export type GitUpstreamResult = {
  hasUpdate: boolean;
  currentSha?: string;
  upstreamSha?: string;
};

/**
 * GitHub (and any git-hosted) skill ingestion via the `git` CLI (`node:child_process`, no npm dep).
 *
 * Runtime boundary: only the API touches `git`, the filesystem, and decrypted PATs. Every clone goes
 * to `DATA_DIR/tmp/<nanoid>/` and is removed in a `finally`. The PAT is injected via an EPHEMERAL
 * in-process credential (an `https://<token>@host` URL passed as an argv, plus `credential.helper=`
 * disabled) — it is never written to disk and never returned to the web (`hasAuth` only).
 */
export class SkillGitService {
  private readonly gitTimeoutMs: number;
  private readonly caps: IngestCaps;
  private readonly lookup: DnsLookupAll;

  constructor(
    private readonly repo: SkillRepository,
    private readonly options: GitServiceOptions,
  ) {
    this.gitTimeoutMs = options.gitTimeoutMs ?? 120_000;
    this.caps = options.caps ?? DEFAULT_INGEST_CAPS;
    this.lookup = options.lookup ?? defaultLookup;
  }

  // --- Probe / discovery ------------------------------------------------------------------------

  /**
   * Shallow, blobless, sparse clone of `repoUrl@ref` → discover every `SKILL.md` directory and the
   * HEAD commit sha. Returns a `SkillRepoProbe` (no persistence). Auth failures surface as
   * `requiresAuth`; any other git failure surfaces a clear `errorMessage`.
   */
  async probe(repoUrl: string, ref: string, auth?: { token?: string }): Promise<SkillRepoProbe> {
    const tmpDir = this.tmpDir();
    try {
      fs.mkdirSync(tmpDir, { recursive: true });
      // F1 — resolve the host and reject a private/loopback/link-local address BEFORE the clone (a 400
      // that propagates, not a probeFailure). Closes the DNS-rebinding SSRF the literal schema misses.
      await this.assertResolvableHost(repoUrl);
      const authRepoUrl = withToken(repoUrl, auth?.token ?? this.options.accountToken?.());

      try {
        await this.git(
          [
            "clone",
            "--depth",
            "1",
            "--filter=blob:none",
            "--sparse",
            "--branch",
            ref,
            authRepoUrl,
            tmpDir,
          ],
          process.cwd(),
        );
      } catch (err) {
        return this.probeFailure(repoUrl, ref, err);
      }

      const commitSha = await this.headSha(tmpDir);
      const candidates = await this.discoverCandidates(tmpDir);

      return {
        repoUrl,
        ref,
        ok: true,
        requiresAuth: false,
        commitSha,
        candidates,
        message:
          candidates.length === 0
            ? "No SKILL.md found in the repository at this ref."
            : `Found ${candidates.length} skill${candidates.length === 1 ? "" : "s"}.`,
      };
    } finally {
      this.cleanup(tmpDir);
    }
  }

  // --- Import -----------------------------------------------------------------------------------

  /**
   * Clone the chosen `subpath`, read its files, create the skill + its first version through the
   * shared `createVersion` path (so L1/L2/L3 token levels are populated). Records repo/ref/subpath +
   * last sha; the PAT is encrypted via `SecretStore` (never stored plaintext, never returned).
   */
  async importSkill(input: GitImportInput): Promise<GitImportResult> {
    const tmpDir = this.tmpDir();
    try {
      fs.mkdirSync(tmpDir, { recursive: true });
      const { files, sha } = await this.checkout(
        input.repoUrl,
        input.ref,
        input.subpath,
        input.token ?? this.options.accountToken?.(),
        tmpDir,
      );

      const name = deriveSkillName(files, input.subpath, input.repoUrl);
      const skill = this.repo.create({
        name,
        displayName: input.displayName,
        sourceType: "github",
        github: {
          repoUrl: input.repoUrl,
          ref: input.ref,
          subpath: input.subpath,
          lastSha: sha,
          token: input.token,
        },
      });

      try {
        const meta = await this.buildVersionMeta(files, sha);
        const result = this.repo.createVersion(skill.id, files, meta);
        return { skillId: skill.id, versionId: result.version.id };
      } catch (err) {
        // No partial rows: a failed first-version import removes the just-created skill shell.
        this.repo.delete(skill.id);
        throw err;
      }
    } finally {
      this.cleanup(tmpDir);
    }
  }

  // --- Pull -------------------------------------------------------------------------------------

  /**
   * Re-clone the tracked ref. Fast path: if the resolved sha equals the stored `lastSha`, return
   * `{ unchanged: true }` without hashing. Otherwise re-read files and `createVersion` — which itself
   * returns `{ unchanged: true }` when the `tree_sha` matches. On a new version, advance `lastSha`.
   */
  async pull(skillId: string): Promise<GitPullResult> {
    const skill = this.requireGithubSkill(skillId);
    const github = skill.github!;
    const tmpDir = this.tmpDir();
    try {
      fs.mkdirSync(tmpDir, { recursive: true });
      const { files, sha } = await this.checkout(
        github.repoUrl,
        github.ref,
        github.subpath,
        skill.githubToken ?? this.options.accountToken?.(),
        tmpDir,
      );

      // Fast path: same commit → nothing changed, skip hashing entirely.
      if (github.lastSha && github.lastSha === sha) {
        return { unchanged: true };
      }

      const meta = await this.buildVersionMeta(files, sha);
      const result = this.repo.createVersion(skillId, files, meta);

      // Record the observed sha even when the tree was identical, so the next pull short-circuits.
      this.repo.update(skillId, { github: { lastSha: sha } });

      if (result.unchanged) return { unchanged: true };
      return { unchanged: false, versionId: result.version.id, sha };
    } finally {
      this.cleanup(tmpDir);
    }
  }

  // --- Upstream check ---------------------------------------------------------------------------

  /**
   * `git ls-remote` (NO clone) → the remote sha for the tracked ref. `hasUpdate` is true when it
   * differs from the stored `lastSha`. Cheap enough for an on-open badge.
   */
  async upstream(skillId: string): Promise<GitUpstreamResult> {
    const skill = this.requireGithubSkill(skillId);
    const github = skill.github!;
    const upstreamSha = await this.lsRemote(
      github.repoUrl,
      github.ref,
      skill.githubToken ?? this.options.accountToken?.(),
    );
    const currentSha = github.lastSha;
    return {
      hasUpdate: Boolean(upstreamSha) && upstreamSha !== currentSha,
      currentSha,
      upstreamSha: upstreamSha || undefined,
    };
  }

  // --- Internals --------------------------------------------------------------------------------

  /** Clone the ref (sparse to `subpath` when set), read the skill files, resolve the commit sha. */
  private async checkout(
    repoUrl: string,
    ref: string,
    subpath: string,
    token: string | undefined,
    tmpDir: string,
  ): Promise<{ files: SkillFileInput[]; sha: string }> {
    // F1 — SSRF DNS guard before the clone (import/pull path). See `assertResolvableHost`.
    await this.assertResolvableHost(repoUrl);
    const authRepoUrl = withToken(repoUrl, token);
    const sparse = subpath.trim().length > 0;

    try {
      await this.git(
        [
          "clone",
          "--depth",
          "1",
          "--branch",
          ref,
          ...(sparse ? ["--filter=blob:none", "--sparse"] : []),
          "--single-branch",
          authRepoUrl,
          tmpDir,
        ],
        process.cwd(),
      );
      if (sparse) {
        await this.git(["sparse-checkout", "set", "--no-cone", subpath], tmpDir);
      }
    } catch (err) {
      throw cloneError(repoUrl, ref, err);
    }

    const sha = await this.headSha(tmpDir);
    const root = sparse ? path.join(tmpDir, ...subpath.split("/")) : tmpDir;

    // M2 (path traversal) — defense in depth: the schema (`safeSubpathSchema`) already rejects an
    // absolute/`..`-bearing `subpath` at the route boundary, but assert containment here too so this
    // service is safe even if a future caller skips the schema. `path.join` normalizes `..` segments,
    // so a malicious subpath would otherwise resolve OUTSIDE `tmpDir` and read arbitrary host files
    // into the stored skill.
    assertWithinRoot(root, tmpDir, subpath, repoUrl, ref);

    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      throw httpError(400, `Subpath "${subpath}" does not exist in ${repoUrl} at ${ref}.`);
    }

    // Same ingest caps as the upload path — a huge repo tree can't slip in through the git route.
    // `readTreeFiles` STATs each file and enforces the caps on the running size/count BEFORE reading
    // any file contents, so an oversized tree aborts without slurping every blob into memory first.
    const files = readTreeFiles(root, this.caps);
    if (!files.some((f) => f.path === "SKILL.md")) {
      throw httpError(400, `No SKILL.md found under "${subpath || "/"}" in ${repoUrl} at ${ref}.`);
    }
    return { files, sha };
  }

  /** Parse the manifest + count tokens → the `createVersion` meta with the backfilled footprint. */
  private async buildVersionMeta(files: SkillFileInput[], sha: string): Promise<CreateVersionMeta> {
    const skillMd = files.find((f) => f.path === "SKILL.md");
    if (!skillMd) throw httpError(400, "No SKILL.md found in the repository files.");

    const parsed = parseSkillManifest(skillMd.bytes.toString("utf8"));
    const footprintFiles: SkillFootprintFile[] = files.map((file) => {
      const binary = isBinary(file.bytes);
      return {
        path: file.path,
        isBinary: binary,
        text: binary ? undefined : file.bytes.toString("utf8"),
      };
    });

    const levels = await countLevels(
      footprintFiles,
      parsed.manifest,
      parsed.body,
      this.options.tokenProfile,
    );
    const byPath = new Map<string, number>();
    for (const file of levels.files) byPath.set(file.path, file.tokenTotal);
    const footprint: CreateVersionFootprint = {
      l1: levels.l1,
      l2: levels.l2,
      l3: levels.l3,
      total: levels.total,
      byPath,
    };

    return {
      sourceKind: "github",
      importedFrom: "github-pull",
      sourceRef: sha,
      manifest: parsed.manifest,
      manifestValid: parsed.valid,
      manifestErrors: parsed.errors,
      tokenProfile: levels.tokenProfile,
      footprint,
    };
  }

  /** Walk a sparse blobless checkout, list every dir containing a `SKILL.md`, parse name/description. */
  private async discoverCandidates(tmpDir: string): Promise<SkillRepoProbe["candidates"]> {
    // Materialize the whole tree so nested SKILL.md files are readable in the blobless clone.
    try {
      await this.git(["sparse-checkout", "disable"], tmpDir);
    } catch {
      // Non-sparse or already-materialized checkout — proceed with what is on disk.
    }

    const candidates: SkillRepoProbe["candidates"] = [];
    for (const skillMdPath of findSkillMdFiles(tmpDir, MAX_PROBE_DEPTH)) {
      const dir = path.dirname(skillMdPath);
      const subpath = toPosix(path.relative(tmpDir, dir));
      let name: string | undefined;
      let description: string | undefined;
      try {
        const text = fs.readFileSync(skillMdPath, "utf8");
        const parsed = parseSkillManifest(text);
        name = parsed.manifest.name || undefined;
        description = parsed.manifest.description || undefined;
      } catch {
        // Unreadable SKILL.md still counts as a candidate (name/description left undefined).
      }
      candidates.push({
        subpath,
        ...(name ? { name } : {}),
        ...(description ? { description } : {}),
      });
    }

    candidates.sort((a, b) => a.subpath.localeCompare(b.subpath));
    return candidates;
  }

  private async headSha(cwd: string): Promise<string> {
    const { stdout } = await this.git(["rev-parse", "HEAD"], cwd);
    return stdout.trim();
  }

  private async lsRemote(repoUrl: string, ref: string, token: string | undefined): Promise<string> {
    // F1 — SSRF DNS guard before `ls-remote` (upstream-check path). See `assertResolvableHost`.
    await this.assertResolvableHost(repoUrl);
    const authRepoUrl = withToken(repoUrl, token);
    let stdout: string;
    try {
      ({ stdout } = await this.git(["ls-remote", authRepoUrl, ref], process.cwd()));
    } catch (err) {
      throw cloneError(repoUrl, ref, err);
    }
    // Output: "<sha>\t<refname>" lines. Prefer an exact branch/tag; fall back to the first line.
    const lines = stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const exact =
      lines.find((l) => l.endsWith(`refs/heads/${ref}`)) ??
      lines.find((l) => l.endsWith(`refs/tags/${ref}`)) ??
      lines[0];
    const sha = exact?.split(/\s+/)[0] ?? "";
    return sha;
  }

  /**
   * F1 (SSRF via DNS) — resolve the repo URL's host and reject if ANY resolved address is loopback /
   * private / link-local / unique-local / IPv4-mapped (reusing the shared `isBlockedIp` range logic
   * that also backs the literal-host schema guard). This closes the practical case the literal check
   * alone misses: a public name (`https://public-name.example`) whose DNS record points at
   * `127.0.0.1` / `10.x` / `169.254.169.254` would otherwise be handed straight to `git clone`.
   *
   * ACKNOWLEDGED residual (TOCTOU / DNS rebinding): `git` re-resolves the host INDEPENDENTLY a moment
   * after this check, so a determined attacker could still flip the record between our lookup and
   * git's. There is no portable way to pin the resolved IP through the git CLI; this guard closes the
   * common "name simply points at an internal address" case and layers on the literal-host schema
   * check (defense in depth). A literal blocked IP is also caught here (belt-and-suspenders).
   *
   * Only applies to `https://` URLs — the only scheme the route schema admits. Non-https / hostless
   * URLs (e.g. the `file://` local repos the offline git tests drive directly) skip it; the schema's
   * literal guard already rejects them at the route boundary.
   */
  private async assertResolvableHost(repoUrl: string): Promise<void> {
    await assertHostAllowed(repoUrl, this.lookup);
  }

  /** Run `git` with the PAT-in-URL kept in argv only; disable any on-disk credential helper. */
  private git(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
    return runGit(args, cwd, { timeoutMs: this.gitTimeoutMs });
  }

  private probeFailure(repoUrl: string, ref: string, err: unknown): SkillRepoProbe {
    const stderr = errText(err);
    const requiresAuth = looksLikeAuthFailure(stderr);
    return {
      repoUrl,
      ref,
      ok: false,
      requiresAuth,
      candidates: [],
      message: requiresAuth
        ? "This repository requires authentication."
        : "Could not access the repository.",
      errorMessage: redactUrl(stderr),
    };
  }

  private requireGithubSkill(skillId: string): InternalSkill {
    const skill = this.repo.getInternal(skillId);
    if (skill.sourceType !== "github" || !skill.github) {
      throw httpError(400, "This skill is not bound to a GitHub repository.");
    }
    return skill;
  }

  private tmpDir(): string {
    return path.join(this.options.dataDir, "tmp", nanoid());
  }

  private cleanup(tmpDir: string): void {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// --- Pure helpers -------------------------------------------------------------------------------
// The credential / SSRF / redaction helpers (`runGit`, `assertHostAllowed`, `withToken`, `redactUrl`,
// `errText`, `looksLikeAuthFailure`) now live in ONE place — `../git/git-credential.ts` — imported at
// the top of this file. Only the skills-import-specific error mapping stays here.

function cloneError(repoUrl: string, ref: string, err: unknown): Error {
  const stderr = redactUrl(errText(err));
  if (looksLikeAuthFailure(stderr)) {
    return httpError(401, `Authentication required for ${repoUrl} (${ref}).`);
  }
  return httpError(502, `git clone failed for ${repoUrl} (${ref}): ${stderr.slice(0, 500)}`);
}

/**
 * M2 (path traversal) — assert `root` (the subpath joined onto the checkout dir) resolves to `tmpDir`
 * itself or a descendant of it. `path.join` normalizes `..` segments, so an unvalidated `subpath` (an
 * absolute path, or one carrying `..`) could otherwise resolve OUTSIDE the ephemeral checkout and
 * `readTreeFiles` would happily walk arbitrary host files into the stored skill. The schema
 * (`safeSubpathSchema`) already rejects such a `subpath` at the route boundary; this is a second,
 * independent layer inside the service itself.
 */
function assertWithinRoot(
  root: string,
  tmpDir: string,
  subpath: string,
  repoUrl: string,
  ref: string,
): void {
  const resolvedRoot = path.resolve(root);
  const resolvedTmpDir = path.resolve(tmpDir);
  const contained =
    resolvedRoot === resolvedTmpDir || resolvedRoot.startsWith(resolvedTmpDir + path.sep);
  if (!contained) {
    throw httpError(
      400,
      `Subpath "${subpath}" escapes the repository checkout for ${repoUrl} at ${ref}.`,
    );
  }
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

/** Recursively find every `SKILL.md` (case-insensitive) under `root`, bounded by depth. */
function findSkillMdFiles(root: string, maxDepth: number): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (IGNORED_TOP_DIRS.has(entry.name)) continue;
        walk(path.join(dir, entry.name), depth + 1);
      } else if (entry.isFile() && entry.name.toLowerCase() === "skill.md") {
        found.push(path.join(dir, entry.name));
      }
    }
  };
  walk(root, 0);
  return found;
}

/**
 * Read every file under `root` (skipping `.git`) as `{ path (posix, rebased), bytes }`.
 *
 * Two phases so the ingest caps are enforced BEFORE any content is read: (1) walk + `stat` each
 * file, accumulating size + count against the caps and aborting on the first breach; (2) only then
 * read the surviving files' bytes. This prevents a huge repo tree from being slurped into memory
 * before the guard runs.
 */
function readTreeFiles(root: string, caps: IngestCaps): SkillFileInput[] {
  const staged: Array<{ path: string; abs: string }> = [];
  let total = 0;
  let count = 0;

  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_TOP_DIRS.has(entry.name)) continue;
        walk(abs);
      } else if (entry.isFile()) {
        const size = fs.statSync(abs).size;
        count += 1;
        assertFileCountCap(count, caps);
        assertFileCap(size, caps);
        total += size;
        assertTotalCap(total, caps);
        staged.push({ path: toPosix(path.relative(root, abs)), abs });
      }
    }
  };
  walk(root);

  const files: SkillFileInput[] = staged.map((f) => ({
    path: f.path,
    bytes: fs.readFileSync(f.abs),
  }));
  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

/** Derive a spec-shaped skill name: manifest name → subpath basename → repo name → "skill". */
function deriveSkillName(files: SkillFileInput[], subpath: string, repoUrl: string): string {
  const skillMd = files.find((f) => f.path === "SKILL.md");
  if (skillMd) {
    const parsed = parseSkillManifest(skillMd.bytes.toString("utf8"));
    if (parsed.manifest.name) return parsed.manifest.name;
  }
  const fromSubpath = subpath.split("/").filter(Boolean).pop();
  const fromRepo = repoUrl
    .replace(/\.git$/, "")
    .split("/")
    .filter(Boolean)
    .pop();
  return slugifyName(fromSubpath || fromRepo || "skill");
}

function slugifyName(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "skill";
}
