/**
 * Facade-side concurrency cap (WP4.2; research 04 §6: "the facade should enforce its own
 * concurrency cap and pass through 429s" — the Qlik Answers tenant's own rate-limit tier
 * (~100 req/min) is shared by EVERY client of this facade, and one `/chat/completions` call issues
 * 2-3 tenant requests (app-context resolution, thread create-or-reuse, `actions/stream`, the
 * settled `messages` fetch), so an unbounded facade can burn that shared budget fast.
 *
 * This is DELIBERATELY NOT the queueing
 * {@link import("../testing/subscription-concurrency.js").AsyncSemaphore} pattern the Claude-
 * subscription concurrency budget uses (WP2.1, D-CS2) — that pool makes a caller WAIT for a
 * permit, which is right for OUR OWN orchestrator (a suite matrix can afford to queue quietly). An
 * external OpenAI-compatible client instead expects the STANDARD response to server overload: a
 * fast `429` + `Retry-After` it already knows how to auto-retry on (research 04 §1 — official
 * clients auto-retry 429s with backoff). So this is a REJECT-FAST (non-blocking) counting gate,
 * not a queue: `tryAcquire()` never waits — a full gate fails immediately.
 */

import { concurrencyLimitExceeded, type FacadeError } from "./mapping.js";

export class FacadeConcurrencyLimiter {
  private inFlight = 0;
  readonly max: number;
  readonly retryAfterSeconds: number;

  constructor(max: number, retryAfterSeconds: number) {
    this.max = Math.max(1, Math.floor(max));
    this.retryAfterSeconds = Math.max(0, Math.floor(retryAfterSeconds));
  }

  /** Admit one more in-flight request, or return `false` immediately when already at capacity. */
  tryAcquire(): boolean {
    if (this.inFlight >= this.max) return false;
    this.inFlight += 1;
    return true;
  }

  /** Release a previously-admitted slot. Call at most once per successful {@link tryAcquire}. */
  release(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
  }

  /** Current in-flight count (test/introspection aid, mirrors {@link import("./affinity-cache.js").ThreadAffinityCache.size}). */
  current(): number {
    return this.inFlight;
  }

  /** The mapped `429` + `Retry-After` error for a rejected admission. */
  rejection(): FacadeError {
    return concurrencyLimitExceeded(this.retryAfterSeconds);
  }
}
