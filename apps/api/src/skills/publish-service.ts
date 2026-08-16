import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import {
  GITHUB_REPO_NAME_PATTERN,
  isBlockedIp,
  type PublishToGithubInput,
  type PublishToGithubResult,
} from "@mcp-token-footprint/shared";
import {
  assertHostAllowed,
  defaultLookup,
  errText,
  looksLikeAuthFailure,
  redactUrl,
  runGit,
  withToken,
  type DnsLookupAll,
} from "../git/git-credential.js";
import type { SkillRepository } from "./repository.js";
import { httpError } from "../utils/errors.js";

/**
 * Result of the repo-creation step: the git-cloneable URL to push to and the human-facing URL to
 * return. Injected so tests never touch the network (a local `file://` bare repo stands in for the
 * created remote); the default impl calls the GitHub REST API.
 */
export type CreateRepoResult = { cloneUrl: string; htmlUrl: string };

/** Create the remote repo from a validated {@link PublishToGithubInput}, using `token` (bearer PAT). */
export type CreateRepoFn = (
  input: PublishToGithubInput,
  token: string,
) => Promise<CreateRepoResult>;

export type PublishServiceOptions = {
  dataDir: string;
  /** git subprocess timeout (ms). */
  gitTimeoutMs?: number;
  /** DNS resolver for the pre-push SSRF guard (injectable for tests); defaults to `dns.lookup`. */
  lookup?: DnsLookupAll;
  /**
   * Repo-creation implementation. INJECTED so offline tests supply a `file://` bare repo without a
   * network call; defaults to {@link githubCreateRepo} (GitHub REST `POST /user/repos`).
   */
  createRepo?: CreateRepoFn;
};

/** Args to {@link SkillPublishService.publish}. `token` is resolved by the route (body wins over the skill's stored PAT). */
export type PublishArgs = {
  skillId: string;
  versionId: string;
  input: PublishToGithubInput;
  token: string;
};

// The neutral committer used for the initial publish commit — never a real identity, and stamped via
// env so it never depends on (or writes) any global git config.
const COMMITTER_NAME = "MCP Token Footprint";
const COMMITTER_EMAIL = "skills@mcp-token-footprint.local";

/**
 * I6 — "create a GitHub repo from a skill version". Mirrors {@link SkillGitService}'s PAT discipline
 * exactly (argv-only credential URL via {@link withToken}, `credential.helper=` disabled through the
 * shared {@link runGit}, every error {@link redactUrl}-ed, tmp dir always cleaned in `finally`, the
 * DNS SSRF guard before any network git call). It NEVER force-pushes: a non-empty target is refused
 * with a 409, both by a pre-push `ls-remote` probe and by an un-forced push that git itself rejects.
 */
export class SkillPublishService {
  private readonly gitTimeoutMs: number;
  private readonly lookup: DnsLookupAll;
  private readonly createRepo: CreateRepoFn;

  constructor(
    private readonly repo: SkillRepository,
    private readonly options: PublishServiceOptions,
  ) {
    this.gitTimeoutMs = options.gitTimeoutMs ?? 120_000;
    this.lookup = options.lookup ?? defaultLookup;
    this.createRepo = options.createRepo ?? githubCreateRepo;
  }

  async publish(args: PublishArgs): Promise<PublishToGithubResult> {
    const { skillId, versionId, input, token } = args;

    // 404s first: skill + version must exist and the version must belong to the skill.
    const skill = this.repo.getInternal(skillId); // throws 404 if the skill is missing
    const version = this.repo.getVersion(versionId); // throws 404 if the version is missing
    if (version.skillId !== skillId) {
      throw httpError(404, "Skill version not found");
    }

    // Refuse a silent rebind: an already-github-bound skill can be published (to a NEW repo) but not
    // re-bound here — unbind/rebind is a deliberate skill-settings action.
    if (input.bindAsSource && skill.sourceType === "github") {
      throw httpError(
        409,
        "This skill is already bound to a GitHub repository. Unbind or rebind it from the skill settings before publishing it as a new source.",
      );
    }

    const files = this.repo.getVersionFiles(versionId);

    // Create the remote (injected offline). A default-impl "name already exists" surfaces as a 409.
    const { cloneUrl, htmlUrl } = await this.createRepo(input, token);

    // Push the version tree as the initial commit; returns the committed sha for the bind's `lastSha`.
    const sha = await this.pushInitialCommit(
      cloneUrl,
      files,
      token,
      skill.name,
      version.versionLabel,
    );

    let bound = false;
    if (input.bindAsSource) {
      // Set the github fields exactly as import does (repo_url, ref 'main', subpath '', encrypted PAT).
      this.repo.bindGithubSource(skillId, {
        repoUrl: cloneUrl,
        ref: "main",
        subpath: "",
        lastSha: sha,
        token,
      });
      bound = true;
    }

    return { repoUrl: htmlUrl, bound };
  }

  /**
   * Materialize the version tree in a fresh tmp dir → `git init -b main` → neutral commit → push
   * `HEAD:main` (never `--force`). Refuses a non-empty target with a 409 both pre-push (an
   * `ls-remote` probe) and via the un-forced push git rejects. The tmp dir is always cleaned.
   */
  private async pushInitialCommit(
    cloneUrl: string,
    files: Array<{ path: string; bytes: Buffer }>,
    token: string,
    skillName: string,
    versionLabel: string,
  ): Promise<string> {
    const tmp = this.tmpDir();
    try {
      fs.mkdirSync(tmp, { recursive: true });

      // SSRF DNS guard before any network git call (skips file:// used by the offline tests).
      await assertHostAllowed(cloneUrl, this.lookup);

      // Pre-push probe: an existing/non-empty remote → 409, before we write a single commit.
      if (await this.remoteHasRefs(cloneUrl, token)) {
        throw httpError(
          409,
          "The target repository already exists and is not empty; refusing to publish over it (no force-push).",
        );
      }

      this.materialize(tmp, files);

      const committerEnv = {
        GIT_AUTHOR_NAME: COMMITTER_NAME,
        GIT_AUTHOR_EMAIL: COMMITTER_EMAIL,
        GIT_COMMITTER_NAME: COMMITTER_NAME,
        GIT_COMMITTER_EMAIL: COMMITTER_EMAIL,
      };
      await this.git(["init", "-q", "-b", "main"], tmp);
      await this.git(["add", "-A"], tmp);
      await this.git(
        ["commit", "-q", "-m", `Initial commit from ${skillName} ${versionLabel}`],
        tmp,
        committerEnv,
      );
      const { stdout } = await this.git(["rev-parse", "HEAD"], tmp);
      const sha = stdout.trim();

      const authUrl = withToken(cloneUrl, token);
      try {
        // No `--force`, ever. A non-fast-forward (non-empty remote) is rejected → mapped to 409.
        await this.git(["push", authUrl, "HEAD:main"], tmp);
      } catch (err) {
        throw pushError(cloneUrl, err);
      }

      return sha;
    } finally {
      this.cleanup(tmp);
    }
  }

  /** `git ls-remote` the target → true when it already has any refs (an existing/non-empty repo). */
  private async remoteHasRefs(cloneUrl: string, token: string): Promise<boolean> {
    const authUrl = withToken(cloneUrl, token);
    let stdout: string;
    try {
      ({ stdout } = await this.git(["ls-remote", authUrl], process.cwd()));
    } catch (err) {
      // A brand-new empty repo answers `ls-remote` with an empty listing + exit 0, so a THROW here is
      // a real failure (auth/network/missing) — surface it, redacted. Auth failures map to 401.
      throw lsRemoteError(cloneUrl, err);
    }
    return stdout.split("\n").some((line) => line.trim().length > 0);
  }

  /** Write every file (posix path, raw bytes) under `root`, creating parent dirs. */
  private materialize(root: string, files: Array<{ path: string; bytes: Buffer }>): void {
    for (const file of files) {
      const abs = path.join(root, ...file.path.split("/"));
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, file.bytes);
    }
  }

  private git(
    args: string[],
    cwd: string,
    env?: NodeJS.ProcessEnv,
  ): Promise<{ stdout: string; stderr: string }> {
    return runGit(args, cwd, { timeoutMs: this.gitTimeoutMs, env });
  }

  private tmpDir(): string {
    return path.join(this.options.dataDir, "tmp", nanoid());
  }

  private cleanup(tmp: string): void {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// --- Default GitHub REST createRepo -------------------------------------------------------------

/**
 * Default {@link CreateRepoFn}: create a new repo via GitHub REST `POST /user/repos` (bearer PAT).
 * Validates `repoName` against `GITHUB_REPO_NAME_PATTERN` before the call, honors `private`, and
 * disables `auto_init` so the repo starts empty (the push provides the first commit). Errors are
 * mapped to 4xx/502 with redacted messages; a 422 "name already exists" becomes a 409.
 *
 * NOTE: the live REST path is unverifiable offline (needs a real PAT + network) — the offline suite
 * injects a `file://`-backed {@link CreateRepoFn} instead. See WP 7.1 acceptance.
 */
export const githubCreateRepo: CreateRepoFn = async (input, token) => {
  if (!GITHUB_REPO_NAME_PATTERN.test(input.repoName)) {
    throw httpError(
      400,
      "Repo name may only contain letters, digits, '.', '-', '_' (1–100 chars).",
    );
  }
  // SSRF: the fixed api.github.com host is public; guard defensively against a resolved-private flip.
  if (isBlockedIp("api.github.com")) throw httpError(400, "GitHub API host is not allowed.");

  let res: Response;
  try {
    res = await fetch("https://api.github.com/user/repos", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "User-Agent": "mcp-token-footprint",
      },
      body: JSON.stringify({ name: input.repoName, private: input.private, auto_init: false }),
    });
  } catch (err) {
    throw httpError(502, `GitHub repo creation failed: ${redactUrl(errText(err)).slice(0, 300)}`);
  }

  if (!res.ok) {
    const detail = redactUrl(await readGithubMessage(res)).slice(0, 300);
    if (res.status === 422) {
      throw httpError(409, `A repository named "${input.repoName}" already exists.`);
    }
    if (res.status === 401 || res.status === 403) {
      throw httpError(res.status, `GitHub rejected the request (${res.status}): ${detail}`);
    }
    if (res.status >= 400 && res.status < 500) {
      throw httpError(res.status, `GitHub repo creation failed (${res.status}): ${detail}`);
    }
    throw httpError(502, `GitHub repo creation failed (${res.status}): ${detail}`);
  }

  const body = (await res.json()) as { clone_url?: string; html_url?: string };
  if (!body.clone_url || !body.html_url) {
    throw httpError(502, "GitHub repo creation returned an unexpected response (missing URLs).");
  }
  return { cloneUrl: body.clone_url, htmlUrl: body.html_url };
};

async function readGithubMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string };
    return typeof body.message === "string" ? body.message : `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

// --- Error mappers ------------------------------------------------------------------------------

/** Map a `git push` failure: non-fast-forward / non-empty → 409; auth → 401; else 502 (all redacted). */
function pushError(cloneUrl: string, err: unknown): Error {
  const stderr = redactUrl(errText(err));
  if (looksLikeAuthFailure(stderr)) {
    return httpError(401, `Authentication required to push to ${redactUrl(cloneUrl)}.`);
  }
  if (looksLikeNonFastForward(stderr)) {
    return httpError(
      409,
      "The target repository already contains commits; refusing to force-push over it.",
    );
  }
  return httpError(502, `git push failed for ${redactUrl(cloneUrl)}: ${stderr.slice(0, 500)}`);
}

/** Map an `ls-remote` failure: auth → 401; else 502 (redacted). */
function lsRemoteError(cloneUrl: string, err: unknown): Error {
  const stderr = redactUrl(errText(err));
  if (looksLikeAuthFailure(stderr)) {
    return httpError(401, `Authentication required to reach ${redactUrl(cloneUrl)}.`);
  }
  return httpError(502, `Could not reach ${redactUrl(cloneUrl)}: ${stderr.slice(0, 500)}`);
}

function looksLikeNonFastForward(stderr: string): boolean {
  const lower = stderr.toLowerCase();
  return (
    lower.includes("non-fast-forward") ||
    lower.includes("fetch first") ||
    lower.includes("rejected") ||
    lower.includes("failed to push")
  );
}
