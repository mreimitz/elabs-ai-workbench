// Assistant (WP 0.2) — Claude subscription sign-in via the `claude setup-token` PTY flow (D-AS1/D-AS2).
//
// SECURITY (the central requirement of this WP — see .claude/rules/mcp-and-security.md):
//   • The captured `sk-ant-oat01-…` token is returned IN-PROCESS to the auth service, which encrypts
//     it via the repository before it ever touches SQLite. It is NEVER put into an Error, NEVER logged,
//     and the raw CLI transcript that produced it is dropped from memory the instant the flow settles
//     (`PtyFlowSession.close()` blanks the buffer). No route response and no log line ever carries it.
//   • Parse failures surface a CLEAN remediation message (point the owner at the paste path) — they
//     NEVER echo the raw CLI output, which could contain the token.
//
// TESTABILITY: the PTY boundary is a dependency-injected seam ({@link PtyDriver}). The real driver
// ({@link NodePtyDriver}) spawns `claude setup-token` via node-pty; tests inject a scripted fake that
// replays captured transcripts, so no test ever touches a real binary, opens a real PTY, or calls
// Anthropic. The command/binary path is likewise injected (`resolveSpawn`).
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { ASSISTANT_OAUTH_TOKEN_PREFIX } from "@mcp-token-footprint/shared";
import { nanoid } from "nanoid";
import { httpError } from "../utils/errors.js";

// ── The injectable PTY seam ────────────────────────────────────────────────────────────────────────

/** A live pseudo-terminal handle — the minimal surface {@link ClaudeOauthFlowManager} drives. */
export interface PtyDriverHandle {
  /** Register a data listener (raw terminal output chunks — may be partial lines / carry ANSI). */
  onData(listener: (chunk: string) => void): void;
  /** Register an exit listener. */
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): void;
  /** Write to the child's stdin (a pasted code is followed by a carriage return, not `\n`). */
  write(data: string): void;
  /** Kill the child (SIGHUP by default). Must be safe to call more than once / after exit. */
  kill(signal?: string): void;
}

/** What to spawn: the resolved binary, its argv, and the (fully-replacing) child environment. */
export interface PtySpawnSpec {
  file: string;
  args: string[];
  env: Record<string, string>;
}

/** The DI seam. The real impl is {@link NodePtyDriver}; tests inject a scripted fake. */
export interface PtyDriver {
  spawn(spec: PtySpawnSpec): PtyDriverHandle;
}

/**
 * The real driver: spawns a process in a pseudo-terminal via `node-pty`. node-pty is `require`d
 * LAZILY inside `spawn` so merely importing this module (as the tests do, to reach the manager +
 * parse helpers) never loads the native addon.
 */
export class NodePtyDriver implements PtyDriver {
  spawn(spec: PtySpawnSpec): PtyDriverHandle {
    const require = createRequire(import.meta.url);
    const pty = require("node-pty") as typeof import("node-pty");
    const proc = pty.spawn(spec.file, spec.args, {
      name: "xterm-color",
      // A WIDE terminal so `claude setup-token`'s long authorization URL (≈350 chars: client_id +
      // redirect_uri + scope + code_challenge + state) prints on ONE line. The CLI's TUI hard-wraps to
      // the pty width, and `parseAuthUrl`'s `\S+` stops at the wrap — at 120 cols the URL was truncated
      // mid-`redirect_uri`, so claude.ai rejected it ("Missing redirect_uri parameter"). Verified in the
      // container: 120 → truncated, 1000 → the full URL is captured.
      cols: 1000,
      rows: 40,
      env: spec.env,
    });
    return {
      onData: (listener) => {
        proc.onData(listener);
      },
      onExit: (listener) => {
        proc.onExit(listener);
      },
      write: (data) => proc.write(data),
      kill: (signal) => {
        try {
          proc.kill(signal);
        } catch {
          // Already exited — killing a dead pty throws; nothing to clean up.
        }
      },
    };
  }
}

// ── Real spawn resolution (NOT exercised by tests — see the WP report's "NOT verified") ─────────────

/**
 * Resolve the `claude` binary. Prefers the SDK's bundled native CLI (the same one
 * `@anthropic-ai/claude-agent-sdk` runs — mirrors the SDK's own platform-package lookup) so a Docker
 * image that ships the SDK needs nothing else on PATH; falls back to a `claude` on PATH otherwise.
 */
export function resolveClaudeBinary(): string {
  const platform = process.platform;
  const arch = process.arch;
  const suffix = platform === "win32" ? ".exe" : "";
  const candidates =
    platform === "linux"
      ? [
          // glibc (the Debian-based Docker image this app ships) first; musl (Alpine) as the fallback.
          `@anthropic-ai/claude-agent-sdk-linux-${arch}/claude${suffix}`,
          `@anthropic-ai/claude-agent-sdk-linux-${arch}-musl/claude${suffix}`,
        ]
      : [`@anthropic-ai/claude-agent-sdk-${platform}-${arch}/claude${suffix}`];
  // The bundled CLI ships as the SDK's platform-specific OPTIONAL dependency
  // (`@anthropic-ai/claude-agent-sdk-<platform>-<arch>`). Under pnpm's nested layout that optional
  // package is only resolvable from the SDK's OWN module scope, NOT from this app's — so resolve it
  // relative to the SDK's resolved location FIRST. (Resolving only from `import.meta.url`, as this
  // originally did, returns MODULE_NOT_FOUND in a pnpm Docker image and silently falls back to a bare
  // `claude` on PATH — which the image doesn't have — so in-app sign-in always failed with a parse
  // error. Verified against the running container.) Fall back to this module's scope for a
  // hoisted/npm-flat layout.
  const scopes: Array<ReturnType<typeof createRequire>> = [];
  try {
    const sdkEntry = createRequire(import.meta.url).resolve("@anthropic-ai/claude-agent-sdk");
    scopes.push(createRequire(sdkEntry));
  } catch {
    // SDK not resolvable from here — fall through to this module's own scope below.
  }
  scopes.push(createRequire(import.meta.url));
  for (const req of scopes) {
    for (const candidate of candidates) {
      try {
        const resolved = req.resolve(candidate);
        if (fs.existsSync(resolved)) return resolved;
      } catch {
        // Not installed for this platform / not resolvable from this scope — try the next.
      }
    }
  }
  return "claude";
}

/**
 * Build the real spawn spec for `claude setup-token`. HOME + CLAUDE_CONFIG_DIR are scoped UNDER the
 * assistant data dir so the CLI never reads or writes the operator's real `~/.claude` state — the
 * child carries only what it needs (no app secret/config), mirroring `spawn-env.ts` (D-AS17).
 */
export function resolveClaudeSetupTokenSpawn(assistantDataDir: string): PtySpawnSpec {
  const dataDir = path.resolve(assistantDataDir);
  const home = path.join(dataDir, "home");
  const claudeConfigDir = path.join(dataDir, "claude");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(claudeConfigDir, { recursive: true });
  return {
    file: resolveClaudeBinary(),
    args: ["setup-token"],
    env: {
      HOME: home,
      CLAUDE_CONFIG_DIR: claudeConfigDir,
      PATH: process.env.PATH ?? "",
    },
  };
}

// ── Output parsing (ANSI-tolerant; buffer-based, not line-based, so partial chunks are fine) ─────────

// Strip ANSI/VT control sequences a real terminal interleaves so the URL/token regexes match cleanly:
// CSI (colour codes) and OSC (terminal hyperlinks), both introduced by ESC (\\u001B).
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching terminal ESC sequences is the point.
const ANSI_CSI_RE = /\u001B\[[0-9;?]*[ -/]*[@-~]/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: OSC sequences are ESC/BEL-delimited by design.
const ANSI_OSC_RE = /\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/g;
const AUTH_URL_RE = /https?:\/\/\S+/g;
const OAUTH_TOKEN_RE = new RegExp(`${escapeRegExp(ASSISTANT_OAUTH_TOKEN_PREFIX)}[A-Za-z0-9_-]{8,}`);

// A residual lone ESC after CSI/OSC removal (e.g. a truncated/interrupted sequence) is still a control
// byte — drop it too so it can never bleed into a parsed URL/token.
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping stray terminal control bytes is the point.
const ANSI_RESIDUAL_RE = /\u001b/g;

function stripAnsi(value: string): string {
  return value.replace(ANSI_CSI_RE, "").replace(ANSI_OSC_RE, "").replace(ANSI_RESIDUAL_RE, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripTrailingPunctuation(url: string): string {
  return url.replace(/[.,;:)\]}'"]+$/, "");
}

/**
 * Extract the authorization URL `claude setup-token` prints. Prefers an OAuth/authorize URL; falls
 * back to the first URL printed. Returns `undefined` until one appears (the manager keeps waiting).
 */
export function parseAuthUrl(buffer: string): string | undefined {
  const matches = stripAnsi(buffer).match(AUTH_URL_RE);
  if (!matches || matches.length === 0) return undefined;
  const preferred = matches.find((url) => /oauth|authorize/i.test(url)) ?? matches[0];
  return preferred ? stripTrailingPunctuation(preferred) : undefined;
}

/**
 * When a pasted code FAILS the token exchange (expired / already-used / a stale flow whose `state`
 * no longer matches), `claude setup-token` prints an error line ("OAuth error: Request failed with
 * status code 4xx" → "Press Enter to retry.") and STAYS ALIVE at the prompt — it neither prints a
 * `sk-ant-oat01-…` token nor exits. Verified against the running container. Without spotting that, the
 * token-wait blocks for the full `tokenMs` (a 2-minute spinner) before failing. This settled-error
 * marker is intentionally coarse (never echoes the code — no secret leak) so `complete` can fail FAST.
 */
const OAUTH_EXCHANGE_ERROR_RE =
  /oauth error|press enter to retry|invalid[_ ]?grant|status code 4\d\d/i;

export type TokenOutcome = { token: string } | { error: true };

/** For `complete`'s wait: the captured token, a settled exchange error, or `undefined` (keep waiting). */
export function parseTokenOutcome(buffer: string): TokenOutcome | undefined {
  const cleaned = stripAnsi(buffer);
  const token = cleaned.match(OAUTH_TOKEN_RE);
  if (token) return { token: token[0] };
  if (OAUTH_EXCHANGE_ERROR_RE.test(cleaned)) return { error: true };
  return undefined;
}

// ── The single-flight PTY flow manager ──────────────────────────────────────────────────────────────

/** Machine-readable error code the routes surface (and the UI keys on) when parsing fails. */
export const ASSISTANT_AUTH_PARSE_FAILED = "ASSISTANT_AUTH_PARSE_FAILED";

// Remediation copy is clean UI text: it points the owner at the manual paste path and NEVER contains
// raw CLI output. (No "Claude Code" branding — D-AS9.)
const START_FAILURE_MESSAGE =
  "Could not start Claude sign-in automatically. Paste a Claude subscription token instead.";
const COMPLETE_FAILURE_MESSAGE =
  "Claude sign-in did not complete — the code was rejected or timed out. A code is single-use and tied " +
  "to one sign-in attempt, so start sign-in again and paste the FRESH code right away — or paste a " +
  "Claude subscription token instead.";

export interface FlowTimeouts {
  /** Max wait for the auth URL after spawn (during `start`). */
  urlMs: number;
  /** Max wait for the token after the code is written (during `complete`). */
  tokenMs: number;
  /** Idle cap between a successful `start` and `complete`/`cancel` — auto-cancels + kills the PTY. */
  hardMs: number;
}

const DEFAULT_TIMEOUTS: FlowTimeouts = {
  urlMs: 60_000,
  // The exchange is fast (a few seconds) and a FAILED exchange is now spotted immediately by
  // parseTokenOutcome, so this is only a backstop for a genuinely stalled child — kept modest so a
  // hang can't spin the UI for two minutes.
  tokenMs: 60_000,
  // 10 minutes for the owner to authorize in their browser and paste the code back.
  hardMs: 600_000,
};

/**
 * Settle time between writing the pasted code and writing its submit (carriage return) — see
 * {@link ClaudeOauthFlowManager.complete}. The bundled `claude setup-token` CLI is an Ink/React TUI
 * reading stdin in RAW mode; when the whole ~90-char `code#state` and the CR arrive glued in one
 * write, the CR can be handled as "submit" before React has flushed the appended input value, so the
 * CLI exchanges a truncated/empty code → the token endpoint returns 400 (`invalid_grant`). Writing the
 * code, letting it register, THEN sending the CR mirrors real paste-then-Enter timing. Tests inject 0.
 */
const DEFAULT_PASTE_DELAY_MS = 150;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

class PtyFlowError extends Error {
  constructor(readonly reason: "exited" | "timeout" | "closed") {
    super(`pty flow ${reason}`);
    this.name = "PtyFlowError";
  }
}

/**
 * One in-flight `setup-token` session. Accumulates the child's output into a buffer and lets callers
 * `waitFor` a pattern to appear (or the child to exit / a timeout to elapse). `close()` is terminal:
 * it blanks the buffer (dropping any captured token from memory) and kills the child.
 */
class PtyFlowSession {
  readonly flowId = nanoid();
  private buffer = "";
  private exited = false;
  private closed = false;
  private notify: Array<() => void> = [];

  constructor(private readonly handle: PtyDriverHandle) {
    handle.onData((chunk) => {
      if (this.closed) return;
      this.buffer += chunk;
      this.flushWaiters();
    });
    handle.onExit(() => {
      this.exited = true;
      this.flushWaiters();
    });
  }

  private flushWaiters(): void {
    const waiters = this.notify;
    this.notify = [];
    for (const wake of waiters) wake();
  }

  write(data: string): void {
    if (!this.closed) this.handle.write(data);
  }

  /** Resolve once `extract(buffer)` yields a value; reject if the child exits/times out/is closed. */
  async waitFor<T>(extract: (buffer: string) => T | undefined, timeoutMs: number): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (this.closed) throw new PtyFlowError("closed");
      const found = extract(this.buffer);
      if (found !== undefined) return found;
      if (this.exited) throw new PtyFlowError("exited");
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new PtyFlowError("timeout");
      await new Promise<void>((resolve) => {
        let done = false;
        const finish = (): void => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve();
        };
        // NOT unref'd: an awaiting request must keep the loop alive until this bounded wait settles
        // (the timer is always short-lived — capped by urlMs/tokenMs — and cleared the instant the
        // pattern appears or the child exits). Only the long, idle hard-timeout is unref'd.
        const timer = setTimeout(finish, remaining);
        this.notify.push(finish);
      });
    }
  }

  /** Terminal + idempotent: stop parsing, drop the buffer (may hold the token), kill the child. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.buffer = "";
    this.handle.kill();
    this.flushWaiters();
  }
}

export interface ClaudeOauthFlowManagerOptions {
  driver: PtyDriver;
  /** Produces the spawn spec (binary + args + env). Injected so tests never resolve a real binary. */
  resolveSpawn: () => PtySpawnSpec;
  timeouts?: Partial<FlowTimeouts>;
  /**
   * Settle delay (ms) between writing the pasted code and its carriage-return submit
   * ({@link DEFAULT_PASTE_DELAY_MS}). Injected as 0 by tests so the scripted fake runs synchronously.
   */
  pasteDelayMs?: number;
}

/**
 * Owns the `claude setup-token` PTY flow with SINGLE-FLIGHT semantics: at most one flow exists at a
 * time. Starting a second while one is active is rejected (409) — the caller must cancel first. A
 * hard idle timeout auto-cancels an abandoned flow and cleans up its PTY.
 */
export class ClaudeOauthFlowManager {
  private active: { session: PtyFlowSession; hardTimer?: NodeJS.Timeout } | undefined;

  constructor(private readonly options: ClaudeOauthFlowManagerOptions) {}

  private get timeouts(): FlowTimeouts {
    return { ...DEFAULT_TIMEOUTS, ...this.options.timeouts };
  }

  private get pasteDelayMs(): number {
    return this.options.pasteDelayMs ?? DEFAULT_PASTE_DELAY_MS;
  }

  hasActiveFlow(): boolean {
    return this.active !== undefined;
  }

  /** Spawn `claude setup-token`, parse the printed auth URL, and return it with the flow id. */
  async start(): Promise<{ flowId: string; authUrl: string }> {
    if (this.active) {
      throw httpError(
        409,
        "A Claude sign-in is already in progress. Cancel it before starting another.",
      );
    }
    let session: PtyFlowSession;
    try {
      const handle = this.options.driver.spawn(this.options.resolveSpawn());
      session = new PtyFlowSession(handle);
    } catch {
      // The binary is missing / the PTY failed to open — never leak internals; point at the paste path.
      throw httpError(502, START_FAILURE_MESSAGE, ASSISTANT_AUTH_PARSE_FAILED);
    }
    this.active = { session };
    try {
      const authUrl = await session.waitFor(parseAuthUrl, this.timeouts.urlMs);
      // Now awaiting the code: arm the idle hard-timeout that auto-cancels an abandoned flow.
      const hardTimer = setTimeout(() => this.onHardTimeout(session.flowId), this.timeouts.hardMs);
      hardTimer.unref?.();
      this.active = { session, hardTimer };
      return { flowId: session.flowId, authUrl };
    } catch {
      // No URL (timeout / early exit / unparseable) — kill + clear, surface a clean hint, no raw output.
      this.disposeActive();
      throw httpError(502, START_FAILURE_MESSAGE, ASSISTANT_AUTH_PARSE_FAILED);
    }
  }

  /**
   * Write the pasted code to the PTY and capture the printed `sk-ant-oat01-…` token. Returns the
   * token IN-PROCESS (the caller encrypts it immediately). The PTY is always killed + the buffer
   * dropped afterwards, whether the token was captured or not.
   */
  async complete(flowId: string, code: string): Promise<string> {
    const active = this.active;
    if (!active || active.session.flowId !== flowId) {
      throw httpError(409, "No matching Claude sign-in is in progress. Start sign-in again.");
    }
    // The token-wait has its own bound, so retire the idle hard-timeout for the duration.
    if (active.hardTimer) clearTimeout(active.hardTimer);
    active.hardTimer = undefined;
    try {
      // Deliver the pasted code and its submit as TWO writes with a short settle between them, NOT one
      // glued `${code}\r`. `claude setup-token` is an Ink/React TUI reading stdin in raw mode: a glued
      // write lets the CR fire "submit" before React flushes the ~90-char appended value, so the CLI
      // exchanges a truncated/empty code → the token endpoint 400s (`invalid_grant`) with no token
      // emitted. Writing the code, letting it register, THEN sending the CR mirrors paste-then-Enter so
      // the full value lands before submit. (Confirm/refute with the container capture harness: compare
      // the code the CLI SENDS in the exchange to the code pasted — differ ⇒ this was the bug.)
      active.session.write(code);
      if (this.pasteDelayMs > 0) await sleep(this.pasteDelayMs);
      active.session.write("\r");
      // Resolve on the token OR a settled exchange error (the CLI prints "OAuth error … Press Enter to
      // retry" and stays alive on a bad/expired/stale code — parseTokenOutcome spots it so we fail FAST
      // instead of blocking for the full tokenMs). `waitFor` still throws on child-exit/timeout/close.
      const outcome = await active.session.waitFor(parseTokenOutcome, this.timeouts.tokenMs);
      if ("token" in outcome) return outcome.token;
      // outcome.error — fall through to the shared failure below (buffer dropped by `disposeActive`).
    } catch {
      // child exit / timeout / closed — fall through to the shared failure below.
    } finally {
      this.disposeActive();
    }
    throw httpError(502, COMPLETE_FAILURE_MESSAGE, ASSISTANT_AUTH_PARSE_FAILED);
  }

  /** Cancel the active flow (kill the PTY + clear state). Idempotent; a stale `flowId` is a no-op. */
  cancel(flowId?: string): void {
    const active = this.active;
    if (!active) return;
    if (flowId !== undefined && active.session.flowId !== flowId) return;
    this.disposeActive();
  }

  private onHardTimeout(flowId: string): void {
    if (this.active && this.active.session.flowId === flowId) this.disposeActive();
  }

  private disposeActive(): void {
    const active = this.active;
    if (!active) return;
    if (active.hardTimer) clearTimeout(active.hardTimer);
    active.session.close();
    this.active = undefined;
  }
}
