import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import type { SkillPushToGithubInput, SkillPushToGithubResult } from "@mcp-token-footprint/shared";
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
import type { InternalSkill, SkillRepository } from "./repository.js";
import { httpError } from "../utils/errors.js";

/**
 * Result of the PR-creation step. Injected so tests never touch the network (the offline suite
 * drives a `file://` bare repo and a stub PR fn); the default impl calls the GitHub REST API.
 */
export type CreatePullRequestResult = { url: string; number: number };

/** Create a pull request `head` → `base` on the repo behind `repoUrl`, using `token` (bearer PAT). */
export type CreatePullRequestFn = (args: {
  repoUrl: string;
  head: string;
  base: string;
  title: string;
  body: string;
  token: string;
}) => Promise<CreatePullRequestResult>;

export type PushServiceOptions = {
  dataDir: string;
  /** git subprocess timeout (ms). */
  gitTimeoutMs?: number;
  /** DNS resolver for the pre-clone SSRF guard (injectable for tests); defaults to `dns.lookup`. */
  lookup?: DnsLookupAll;
  /**
   * PR-creation implementation. INJECTED so offline tests never hit the network; defaults to
   * {@link githubCreatePullRequest} (GitHub REST `POST /repos/{owner}/{repo}/pulls`).
   */
  createPullRequest?: CreatePullRequestFn;
};

/** Args to {@link SkillPushService.push}. `token` is resolved by the route (body wins over the skill's stored PAT). */
export type PushArgs = {
  skillId: string;
  versionId: string;
  input: SkillPushToGithubInput;
  token: string;
};

// The neutral committer used for push-back commits — never a real identity, stamped via env so it
// never depends on (or writes) any global git config. Matches the publish service.
const COMMITTER_NAME = "MCP Token Footprint";
const COMMITTER_EMAIL = "skills@mcp-token-footprint.local";

/**
 * Push a skill version BACK to its bound GitHub source (the missing half of the pull/publish
 * workflow): clone the tracked ref, replace the tracked subpath's content with the version tree,
 * commit, then either push the tracked branch directly (`mode: "direct"`) or push a new head branch
 * and open a pull request against the tracked ref (`mode: "pr"`, GitHub REST — injected for tests).
 *
 * Mirrors {@link SkillGitService} / {@link SkillPublishService}'s PAT discipline exactly: argv-only
 * credential URL via {@link withToken}, `credential.helper=` disabled through the shared
 * {@link runGit}, every error {@link redactUrl}-ed, the tmp clone always cleaned in `finally`, and
 * the DNS SSRF guard before any network git call. It NEVER force-pushes: an upstream that moved
 * since the clone rejects the un-forced push and surfaces as a 409 ("pull latest, then retry").
 */
export class SkillPushService {
  private readonly gitTimeoutMs: number;
  private readonly lookup: DnsLookupAll;
  private readonly createPullRequest: CreatePullRequestFn;

  constructor(
    private readonly repo: SkillRepository,
    private readonly options: PushServiceOptions,
  ) {
    this.gitTimeoutMs = options.gitTimeoutMs ?? 120_000;
    this.lookup = options.lookup ?? defaultLookup;
    this.createPullRequest = options.createPullRequest ?? githubCreatePullRequest;
  }

  async push(args: PushArgs): Promise<SkillPushToGithubResult> {
    const { skillId, versionId, input, token } = args;

    // 404s / 400s first: the skill must exist, be github-bound, and own the version.
    const skill = this.repo.getInternal(skillId); // throws 404 if the skill is missing
    if (skill.sourceType !== "github" || !skill.github) {
      throw httpError(400, "This skill is not bound to a GitHub repository.");
    }
    const version = this.repo.getVersion(versionId); // throws 404 if the version is missing
    if (version.skillId !== skillId) {
      throw httpError(404, "Skill version not found");
    }

    const github = skill.github;
    const files = this.repo.getVersionFiles(versionId);
    const commitMessage =
      input.commitMessage?.trim() || `Update ${skill.name} to ${version.versionLabel}`;
    const headBranch =
      input.mode === "pr"
        ? input.branch || defaultHeadBranch(skill, version.versionLabel)
        : github.ref;

    const tmp = this.tmpDir();
    try {
      fs.mkdirSync(tmp, { recursive: true });

      // SSRF DNS guard before any network git call (skips file:// used by the offline tests).
      await assertHostAllowed(github.repoUrl, this.lookup);
      const authUrl = withToken(github.repoUrl, token);

      // Clone the TRACKED ref so the commit sits on the real upstream history (sparse to the
      // subpath when set — the rest of a monorepo tree never needs materializing to be preserved).
      const sparse = github.subpath.trim().length > 0;
      try {
        await this.git(
          [
            "clone",
            "--depth",
            "1",
            "--branch",
            github.ref,
            ...(sparse ? ["--filter=blob:none", "--sparse"] : []),
            "--single-branch",
            authUrl,
            tmp,
          ],
          process.cwd(),
        );
        if (sparse) {
          await this.git(["sparse-checkout", "set", "--no-cone", github.subpath], tmp);
        }
        // The clone's origin URL carries the PAT — scrub it immediately so nothing credential-
        // bearing sits in `.git/config` even for the lifetime of the tmp dir (collections-sync
        // discipline). Every later push passes the auth URL as argv.
        await this.git(["remote", "set-url", "origin", github.repoUrl], tmp);
      } catch (err) {
        throw cloneError(github.repoUrl, github.ref, err);
      }

      // Replace the tracked subpath's content with the version tree (deletes included).
      const root = sparse ? path.join(tmp, ...github.subpath.split("/")) : tmp;
      this.clearTree(root, tmp);
      this.materialize(root, files);

      // Stage; an empty status means the version is identical to upstream — honest no-op.
      const addPath = sparse ? github.subpath : ".";
      await this.git(["add", "-A", "--", addPath], tmp);
      const { stdout: status } = await this.git(["status", "--porcelain"], tmp);
      if (status.trim().length === 0) {
        return {
          mode: input.mode,
          repoUrl: htmlUrl(github.repoUrl),
          branch: headBranch,
          unchanged: true,
        };
      }

      const committerEnv = {
        GIT_AUTHOR_NAME: COMMITTER_NAME,
        GIT_AUTHOR_EMAIL: COMMITTER_EMAIL,
        GIT_COMMITTER_NAME: COMMITTER_NAME,
        GIT_COMMITTER_EMAIL: COMMITTER_EMAIL,
      };
      await this.git(["commit", "-q", "-m", commitMessage], tmp, committerEnv);
      const { stdout } = await this.git(["rev-parse", "HEAD"], tmp);
      const sha = stdout.trim();

      // No `--force`, ever. An upstream that moved since the clone rejects the push → 409.
      try {
        await this.git(["push", authUrl, `HEAD:refs/heads/${headBranch}`], tmp);
      } catch (err) {
        throw pushError(github.repoUrl, headBranch, err);
      }

      if (input.mode === "direct") {
        // The tracked branch now points at our commit — record it so the upstream badge doesn't
        // flag our own push and the next pull short-circuits on the same sha.
        this.repo.update(skillId, { github: { lastSha: sha } });
        return {
          mode: "direct",
          repoUrl: htmlUrl(github.repoUrl),
          branch: headBranch,
          unchanged: false,
          commitSha: sha,
        };
      }

      const pr = await this.createPullRequest({
        repoUrl: github.repoUrl,
        head: headBranch,
        base: github.ref,
        title: input.prTitle?.trim() || commitMessage,
        body:
          input.prBody ?? `Pushed from MCP Token Footprint: ${skill.name} ${version.versionLabel}.`,
        token,
      });
      return {
        mode: "pr",
        repoUrl: htmlUrl(github.repoUrl),
        branch: headBranch,
        unchanged: false,
        commitSha: sha,
        prUrl: pr.url,
        prNumber: pr.number,
      };
    } finally {
      this.cleanup(tmp);
    }
  }

  /**
   * Remove everything under `root` except the `.git` directory (only relevant when `root` is the
   * clone itself, i.e. subpath = repo root) so deleted files show up as deletions when the version
   * tree is materialized on top. A missing `root` (brand-new subpath) is fine — materialize creates it.
   */
  private clearTree(root: string, cloneRoot: string): void {
    if (!fs.existsSync(root)) return;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (root === cloneRoot && entry.name === ".git") continue;
      fs.rmSync(path.join(root, entry.name), { recursive: true, force: true });
    }
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

// --- Defaults & helpers ---------------------------------------------------------------------------

/** Default PR head branch: `skill/<slug-or-name>-<version_label>`, sanitized to safe ref chars. */
export function defaultHeadBranch(skill: InternalSkill, versionLabel: string): string {
  const stem = sanitizeRefPart(skill.slug || skill.name);
  const label = sanitizeRefPart(versionLabel);
  return `skill/${stem || "update"}${label ? `-${label}` : ""}`;
}

function sanitizeRefPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/\.+/g, ".")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80);
}

/** The human-facing repo URL for results/links: the tracked clone URL minus a trailing `.git`. */
function htmlUrl(repoUrl: string): string {
  return repoUrl.replace(/\.git$/, "");
}

/**
 * Parse `https://github.com/<owner>/<repo>(.git)` → `{ owner, repo }`. Only github.com is supported
 * by the DEFAULT PR impl (the REST endpoint is GitHub's); other hosts get an honest 400 — direct
 * push still works everywhere git does.
 */
export function parseGithubOwnerRepo(repoUrl: string): { owner: string; repo: string } | undefined {
  let url: URL;
  try {
    url = new URL(repoUrl);
  } catch {
    return undefined;
  }
  if (url.hostname.toLowerCase() !== "github.com") return undefined;
  const parts = url.pathname.split("/").filter(Boolean);
  const owner = parts[0];
  const repo = parts[1]?.replace(/\.git$/, "");
  if (!owner || !repo) return undefined;
  return { owner, repo };
}

/**
 * Default {@link CreatePullRequestFn}: GitHub REST `POST /repos/{owner}/{repo}/pulls` (bearer PAT).
 * Errors map to 4xx/502 with redacted messages; a 422 "already exists" (a PR for this head/base is
 * already open) becomes a 409.
 *
 * NOTE: the live REST path is unverifiable offline (needs a real PAT + network) — the offline suite
 * injects a stub {@link CreatePullRequestFn} instead.
 */
export const githubCreatePullRequest: CreatePullRequestFn = async (args) => {
  const target = parseGithubOwnerRepo(args.repoUrl);
  if (!target) {
    throw httpError(
      400,
      "Pull requests are only supported for github.com repositories; use a direct push instead.",
    );
  }

  let res: Response;
  try {
    res = await fetch(`https://api.github.com/repos/${target.owner}/${target.repo}/pulls`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "User-Agent": "mcp-token-footprint",
      },
      body: JSON.stringify({
        title: args.title,
        head: args.head,
        base: args.base,
        body: args.body,
      }),
    });
  } catch (err) {
    throw httpError(502, `GitHub PR creation failed: ${redactUrl(errText(err)).slice(0, 300)}`);
  }

  if (!res.ok) {
    const detail = redactUrl(await readGithubMessage(res)).slice(0, 300);
    if (res.status === 422) {
      throw httpError(
        409,
        `GitHub refused the pull request (${detail}) — a PR for this branch may already exist.`,
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw httpError(res.status, `GitHub rejected the request (${res.status}): ${detail}`);
    }
    if (res.status >= 400 && res.status < 500) {
      throw httpError(res.status, `GitHub PR creation failed (${res.status}): ${detail}`);
    }
    throw httpError(502, `GitHub PR creation failed (${res.status}): ${detail}`);
  }

  const body = (await res.json()) as { html_url?: string; number?: number };
  if (!body.html_url || typeof body.number !== "number") {
    throw httpError(
      502,
      "GitHub PR creation returned an unexpected response (missing URL/number).",
    );
  }
  return { url: body.html_url, number: body.number };
};

async function readGithubMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string; errors?: Array<{ message?: string }> };
    const nested = body.errors
      ?.map((e) => e.message)
      .filter(Boolean)
      .join("; ");
    if (typeof body.message === "string") {
      return nested ? `${body.message}: ${nested}` : body.message;
    }
    return `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

// --- Error mappers --------------------------------------------------------------------------------

function cloneError(repoUrl: string, ref: string, err: unknown): Error {
  const stderr = redactUrl(errText(err));
  if (looksLikeAuthFailure(stderr)) {
    return httpError(401, `Authentication required for ${redactUrl(repoUrl)} (${ref}).`);
  }
  return httpError(
    502,
    `git clone failed for ${redactUrl(repoUrl)} (${ref}): ${stderr.slice(0, 500)}`,
  );
}

/** Map a `git push` failure: auth → 401; non-fast-forward (upstream moved) → 409; else 502. */
function pushError(repoUrl: string, branch: string, err: unknown): Error {
  const stderr = redactUrl(errText(err));
  if (looksLikeAuthFailure(stderr)) {
    return httpError(401, `Authentication required to push to ${redactUrl(repoUrl)}.`);
  }
  if (looksLikeNonFastForward(stderr)) {
    return httpError(
      409,
      `The remote branch "${branch}" moved since this push started (or already exists with different history). Pull the latest changes, then retry — this app never force-pushes.`,
    );
  }
  return httpError(502, `git push failed for ${redactUrl(repoUrl)}: ${stderr.slice(0, 500)}`);
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
