import { execFile } from "node:child_process";
import dns from "node:dns";
import { promisify } from "node:util";
import { isBlockedIp } from "@mcp-token-footprint/shared";
import { httpError } from "../utils/errors.js";

/**
 * THE single git-credential / SSRF / redaction implementation for this app.
 *
 * Extracted verbatim from `skills/git-service.ts` (WP 4.2, B11) so EVERY git subprocess in the
 * codebase — skill import/pull, skill publish, and collection two-way sync — shares one credential
 * discipline and cannot drift:
 *
 *  - the PAT is injected via an argv-only `https://<token>@host` URL ({@link withToken}) and NEVER
 *    written to disk (`credential.helper=` / `core.askpass=` disabled through {@link runGit});
 *  - `GIT_TERMINAL_PROMPT=0` / `GIT_ASKPASS=""` block any interactive credential prompt;
 *  - a pre-network SSRF DNS guard ({@link assertHostAllowed}) rejects a repo host that resolves to a
 *    loopback / private / link-local / unique-local / IPv4-mapped address;
 *  - every surfaced or logged error is {@link redactUrl}-ed so an embedded token can never leak;
 *  - each subprocess carries a hard timeout so a blocked/slow git call fails cleanly.
 *
 * NOTHING here force-pushes or rewrites history — that policy lives in the callers, but this module
 * deliberately exposes no `--force` affordance.
 */

const execFileAsync = promisify(execFile);

/**
 * DNS resolver signature (`{ all: true }` form) used by the pre-network SSRF guard. Injectable so a
 * test can supply a resolver returning a private address without touching real DNS (mocking
 * `node:dns` in ESM is fiddly). Defaults to {@link dns.promises.lookup}.
 */
export type DnsLookupAll = (
  hostname: string,
  options: { all: true },
) => Promise<Array<{ address: string; family: number }>>;

export const defaultLookup: DnsLookupAll = (hostname, options) =>
  dns.promises.lookup(hostname, options);

/**
 * Run `git` with the PAT-in-URL kept in argv only; disable any on-disk credential helper.
 * `-c credential.helper=` neuters any global helper so a bad/omitted PAT fails fast instead of
 * prompting or reading cached credentials. `GIT_TERMINAL_PROMPT=0` blocks interactive auth. The
 * canonical credential discipline for every git subprocess in this app — shared by the skills git
 * services and the collection sync engine so none can drift from it.
 */
export function runGit(
  args: string[],
  cwd: string,
  options: { timeoutMs: number; env?: NodeJS.ProcessEnv },
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("git", ["-c", "credential.helper=", "-c", "core.askpass=", ...args], {
    cwd,
    timeout: options.timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "", ...options.env },
  });
}

/**
 * SSRF via DNS — resolve `repoUrl`'s host and reject if ANY resolved address is loopback / private /
 * link-local / unique-local / IPv4-mapped (reusing the shared `isBlockedIp` range logic that also
 * backs the literal-host schema guard). This closes the practical case a literal-host check alone
 * misses: a public name whose DNS record points at `127.0.0.1` / `10.x` / `169.254.169.254` would
 * otherwise be handed straight to `git`.
 *
 * ACKNOWLEDGED residual (TOCTOU / DNS rebinding): `git` re-resolves the host INDEPENDENTLY a moment
 * later, so a determined attacker could still flip the record between our lookup and git's. There is
 * no portable way to pin the resolved IP through the git CLI; this guard closes the common "name
 * simply points at an internal address" case and layers on the literal-host schema check (defense in
 * depth). A literal blocked IP is also caught here (belt-and-suspenders).
 *
 * Only applies to `https://` URLs. Non-https / hostless URLs (e.g. the `file://` local repos the
 * offline git tests drive) skip it; the schema's literal guard already rejects them at the route
 * boundary.
 */
export async function assertHostAllowed(repoUrl: string, lookup: DnsLookupAll): Promise<void> {
  let url: URL;
  try {
    url = new URL(repoUrl);
  } catch {
    return; // unparseable — the git invocation will fail cleanly on its own
  }
  if (url.protocol !== "https:") return;
  const host = url.hostname.replace(/^\[/, "").replace(/\]$/, "");
  if (!host) return;
  // A literal blocked IP: reject without a lookup (defense in depth with the schema).
  if (isBlockedIp(host)) throw blockedHostError(repoUrl);
  let resolved: Array<{ address: string }>;
  try {
    resolved = await lookup(host, { all: true });
  } catch {
    return; // DNS failure — let the git invocation surface the real network error
  }
  if (resolved.some((entry) => isBlockedIp(entry.address))) {
    throw blockedHostError(repoUrl);
  }
}

/** Inject a PAT into an https URL, kept only in-process (argv). Non-https URLs pass through. */
export function withToken(repoUrl: string, token: string | undefined): string {
  if (!token) return repoUrl;
  try {
    const url = new URL(repoUrl);
    if (url.protocol !== "https:") return repoUrl;
    // `x-access-token` is GitHub's PAT-over-HTTPS username; the token is the password.
    url.username = "x-access-token";
    url.password = token;
    return url.toString();
  } catch {
    return repoUrl;
  }
}

/** Strip any embedded credentials from a URL before it can reach a log or the web. */
export function redactUrl(text: string): string {
  return text.replace(/https:\/\/[^@\s/]+:[^@\s/]+@/g, "https://***@");
}

export function errText(err: unknown): string {
  const e = err as { stderr?: unknown; message?: unknown };
  if (typeof e?.stderr === "string" && e.stderr.trim()) return e.stderr;
  if (typeof e?.message === "string") return e.message;
  return String(err);
}

export function looksLikeAuthFailure(stderr: string): boolean {
  const lower = stderr.toLowerCase();
  return (
    lower.includes("authentication failed") ||
    lower.includes("could not read username") ||
    lower.includes("terminal prompts disabled") ||
    lower.includes("permission denied") ||
    lower.includes("403") ||
    lower.includes("401") ||
    lower.includes("invalid username or password") ||
    lower.includes("access denied")
  );
}

/** The 400 thrown when a repo host resolves to (or is a literal) blocked internal address. */
export function blockedHostError(repoUrl: string): Error {
  return httpError(
    400,
    `Repository URL host is not allowed (resolves to a loopback, link-local, or private address): ${redactUrl(repoUrl)}`,
  );
}
