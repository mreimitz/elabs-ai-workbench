import {
  RATE_LIMITED_ERROR_CODE,
  RATE_LIMITED_ROUTES,
  RATE_LIMIT_WINDOW_MS,
} from "@mcp-token-footprint/shared";
import type { FastifyInstance } from "fastify";
import { httpError } from "../utils/errors.js";
import { normalizeRequestPath, requestPathCandidates } from "../utils/request-path.js";

/**
 * A fixed-window, in-memory rate limiter (RM-37 WP 0.4).
 *
 * Not `@fastify/rate-limit`: this app is one process with one operator, so there is no store to
 * share, no cluster to coordinate and no headers contract anyone consumes — and the WP is explicit
 * that a small in-memory window is an acceptable shape. Adding a dependency for ~40 lines is not a
 * trade this repo makes (`.claude/rules/dependencies.md`).
 *
 * **Fixed window, not sliding, and that is a deliberate simplification.** A fixed window lets a
 * caller send up to 2× the budget across a window boundary. That matters when the budget is the
 * product's contract; here the budgets exist to stop a retry storm and to keep an auth endpoint from
 * being a free oracle, and 40 failed token attempts in a 2-second straddle is as thoroughly refused
 * as 20. The counter is a `Map` that prunes on read, so it cannot grow without bound: an idle key's
 * window expires and the entry is dropped the next time anything sweeps it.
 */
export class FixedWindowRateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly windowMs: number = RATE_LIMIT_WINDOW_MS,
    /** Injectable clock so every budget is testable without sleeping through a real minute. */
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * Record one hit against `key` and report whether it exceeded `limit`.
   *
   * `limited` is true from the (limit + 1)-th hit inside the window onward — so a budget of 20 means
   * the 21st is the one that is refused, which is exactly how the WP's acceptance reads.
   */
  hit(key: string, limit: number): { limited: boolean; retryAfterSeconds: number } {
    const now = this.now();
    this.sweep(now);

    const existing = this.windows.get(key);
    if (existing === undefined || existing.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      return { limited: 1 > limit, retryAfterSeconds: Math.ceil(this.windowMs / 1000) };
    }

    existing.count += 1;
    return {
      limited: existing.count > limit,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  /** Forget every window (test hygiene; also what a future "unblock me" action would call). */
  reset(): void {
    this.windows.clear();
  }

  /** Drop expired windows so an instance that has seen many peers does not retain them forever. */
  private sweep(now: number): void {
    if (this.windows.size < 256) return;
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }
}

/**
 * The identity a budget is counted against: the authenticated token when there is one, else the
 * socket peer. Never a header — `X-Forwarded-For` is caller-controlled, and a limiter keyed on it
 * would be a limiter an attacker resets at will (the same reasoning `api-tokens/guard.ts` applies to
 * the loopback decision).
 */
export function rateLimitPeerKey(remoteAddress: string | undefined, tokenId?: string): string {
  if (tokenId !== undefined) return `token:${tokenId}`;
  return `peer:${remoteAddress ?? "unknown"}`;
}

/** Which expensive-action rule (if any) this request matches. `undefined` ⇒ not budgeted. */
export function matchRateLimitedRoute(
  method: string,
  url: string,
): (typeof RATE_LIMITED_ROUTES)[number] | undefined {
  const verb = method.toUpperCase();
  const path = normalizeRequestPath(url);
  const candidates = requestPathCandidates(path);
  for (const rule of RATE_LIMITED_ROUTES) {
    if (rule.method !== verb) continue;
    const hit = candidates.some((candidate) => {
      if (rule.match === "exact") return candidate === rule.path;
      if (rule.match === "prefix") {
        return candidate === rule.path || candidate.startsWith(`${rule.path}/`);
      }
      // `suffix` — `/api/servers/:id/scan`, `/api/suites/:id/run`. Anchored to a segment boundary so
      // `/api/x/rescan` cannot match `/scan`.
      return candidate.endsWith(rule.path) && candidate.length > rule.path.length;
    });
    if (hit) return rule;
  }
  return undefined;
}

/**
 * Install the expensive-action budget as a root `onRequest` hook.
 *
 * Registered AFTER the origin guard and BEFORE the token guard, so a cross-site request is refused
 * on its own terms rather than being silently absorbed into someone's rate budget — and so a request
 * that IS budgeted is counted before the API spends anything verifying its credential.
 *
 * The limit applies to tokenless loopback callers too, per the WP: the runaway this guards against
 * is a retry storm in the operator's own browser or a stuck agent on their own machine, which is
 * exactly the traffic a peer-based exemption would have waved through.
 */
export function registerRateLimitGuard(
  app: FastifyInstance,
  limiter: FixedWindowRateLimiter,
  limit: number,
): void {
  app.addHook("onRequest", async (request, reply) => {
    const rule = matchRateLimitedRoute(request.method, request.url);
    if (rule === undefined) return;

    const key = `${rule.reason}:${rateLimitPeerKey(request.socket.remoteAddress)}`;
    const result = limiter.hit(key, limit);
    if (!result.limited) return;

    reply.header("retry-after", String(result.retryAfterSeconds));
    throw httpError(
      429,
      `Too many ${rule.reason} requests. Wait ${result.retryAfterSeconds}s and try again.`,
      RATE_LIMITED_ERROR_CODE,
    );
  });
}
