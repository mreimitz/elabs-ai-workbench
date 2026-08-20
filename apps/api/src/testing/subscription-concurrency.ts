// Claude subscription concurrency budget (planning/Roadmap/RM-09-claude-subscription/, WP 2.1 — D-CS2/D-CS10).
//
// The app spawns TWO kinds of ~1 GiB Claude Agent-SDK child: a subscription RUN
// ({@link import("./claude-subscription-executor.js").runClaudeSubscription}) and the Auto-Rating CLI
// JUDGE ({@link import("../grading/claude-cli-judge.js").createClaudeCliJudgeGenerate}). Before WP 2.1
// each side owned its OWN `AsyncSemaphore(config.autoRatingMaxConcurrency)`, so a suite of subscription
// runs PLUS their ratings could put up to **2N** children in flight → a memory blowout (D-CS10). This
// module holds the ONE canonical {@link ConcurrencyGate}/{@link AsyncSemaphore} that BOTH sides now draw
// from, plus the per-provider cap (D-CS2). Production creates a single {@link SubscriptionConcurrencyPool}
// in `index.ts` and injects `pool.shared` into the judge AND the run path — so the TOTAL of (in-flight
// runs + in-flight judges) can never exceed the bound.
//
// This module deliberately imports NOTHING heavy (no fs/os/child_process/config), so the executor AND
// the judge can both share its primitives without dragging one another's dependency graph in — it is the
// neutral home for the dedup the plan calls for.

/**
 * A counting concurrency gate. The contract every ~1 GiB Agent-SDK child obeys: `acquire()` a permit
 * BEFORE spawning the child, `release()` it in a `finally` after the child is torn down. A shared
 * instance is what makes runs + judges draw from ONE budget.
 */
export interface ConcurrencyGate {
  acquire(): Promise<void>;
  release(): void;
}

/**
 * Unified Sessions (planning/Roadmap/completed/RM-29-unified-sessions/, WP1.4, D-US1/D-US6) — an OPTIONAL queue-VISIBILITY facet
 * a {@link ConcurrencyGate} may additionally implement, so a caller can compute an honest, race-free
 * 1-based queue POSITION for its own upcoming `acquire()` call and emit a
 * `{type:"phase",phase:"queued",detail:{position}}` event BEFORE actually calling `acquire()` (D-US1).
 * `willQueue` answers "would MY next `acquire()` call have to wait right now" (a free permit ⇒ `false`);
 * `queueLength` is how many acquirers are ALREADY waiting ahead of that call. Read them SYNCHRONOUSLY,
 * back-to-back with no `await` in between (a single-threaded scheduler — nothing else can interleave),
 * so the reported position stays accurate. {@link AsyncSemaphore} implements this; a bare hand-rolled
 * {@link ConcurrencyGate} test double simply gets no queue-position visibility (it still queues
 * correctly via plain `acquire()` — the facet is additive, never required).
 */
export interface QueueVisibleGate extends ConcurrencyGate {
  readonly willQueue: boolean;
  readonly queueLength: number;
}

/**
 * A tiny, dependency-free FIFO counting semaphore ({@link ConcurrencyGate}, {@link QueueVisibleGate}).
 * `acquire` resolves immediately when a permit is free, else waits FIFO; `release` hands the permit
 * STRAIGHT to the next waiter (so the count is conserved and no permit is ever lost or double-counted)
 * or returns it to the pool. This is the SINGLE definition the run executor and the CLI judge both use
 * (the two former duplicates were deduped onto it).
 */
export class AsyncSemaphore implements QueueVisibleGate {
  private permits: number;
  private readonly waiters: Array<() => void> = [];
  constructor(permits: number) {
    this.permits = Math.max(1, Math.floor(permits));
  }
  /** True when the NEXT `acquire()` call on this gate would have to wait (no free permit right now). */
  get willQueue(): boolean {
    return this.permits <= 0;
  }
  /** Count of acquirers already queued waiting for a permit (D-US6 queue-position support). */
  get queueLength(): number {
    return this.waiters.length;
  }
  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits -= 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }
  release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.permits += 1;
  }
}

/**
 * The per-provider concurrency cap (D-CS2). Hands out ONE {@link ConcurrencyGate} per provider CREDENTIAL
 * id, each bounded by `maxPerProvider`, created lazily and memoized so every run of the same provider
 * contends on the SAME gate. This is ADDITIONAL to the shared runs+judge budget: the shared gate bounds
 * the process-wide total of ~1 GiB children; this bounds how many run children a SINGLE provider's suite
 * matrix can have admitted at once, so one provider can never monopolize the whole budget unbounded.
 */
export class ProviderConcurrencyRegistry {
  private readonly gates = new Map<string, ConcurrencyGate>();
  constructor(
    private readonly maxPerProvider: number,
    /** Gate factory — injectable so a test can substitute an instrumented gate. */
    private readonly makeGate: (permits: number) => ConcurrencyGate = (permits) =>
      new AsyncSemaphore(permits),
  ) {}

  /** The memoized per-provider gate for `providerId` (created on first use, then reused). */
  gateFor(providerId: string): ConcurrencyGate {
    let gate = this.gates.get(providerId);
    if (!gate) {
      gate = this.makeGate(this.maxPerProvider);
      this.gates.set(providerId, gate);
    }
    return gate;
  }
}

/**
 * The process-wide subscription concurrency pool (D-CS2 + D-CS10). Bundles the ONE shared judge budget
 * ({@link shared}) with the per-provider cap ({@link providerGate}) and the decoupled subscription-RUN
 * budget ({@link runs}, WP1.4/D-US6). Created ONCE in `index.ts`: `pool.shared` is injected into the CLI
 * judge, `pool.runs` is injected into `RunService` (`resolveClaudeSubscription`'s `concurrency` — wired
 * production-side by WP1.7) for a subscription RUN's own budget, and `pool.providerGate(id)` additionally
 * gates one provider's runs on TOP of whichever of those two gates it's drawing from (so no single
 * provider's matrix can flood the budget it shares with everyone else on that gate).
 *
 * `maxPerProvider` defaults to `maxConcurrency` — i.e. one provider can, at most, fill the ENTIRE shared
 * subscription budget with its own runs, never more (a real, testable upper bound). The constructor
 * accepts a distinct `maxPerProvider` seam so an owner who raises `AUTO_RATING_MAX_CONCURRENCY` can later
 * cap a single provider BELOW the global budget for strict fairness without touching this file's callers.
 */
export class SubscriptionConcurrencyPool {
  /**
   * The shared judge budget — the SAME instance injected into the Auto-Rating CLI judge (D-CS10).
   * Named `shared` for its pre-WP1.4 history (when subscription runs drew on it too); as of WP1.4/WP1.7
   * (D-US6) production only ever draws a JUDGE child from this gate — see {@link runs} for the run side.
   */
  readonly shared: ConcurrencyGate;
  /**
   * Unified Sessions (planning/Roadmap/completed/RM-29-unified-sessions/, WP1.4/WP1.7, D-US6) — a SEPARATE budget dedicated to
   * subscription RUNS, decoupled from {@link shared} (which the CLI judge alone bounds against) — its
   * OWN semaphore/counter, never `shared`'s. Sized by `runsMaxConcurrency` (production:
   * `config.subscriptionRunsMaxConcurrency`, i.e. `SUBSCRIPTION_RUNS_MAX_CONCURRENCY` — see
   * `config/env.ts`). {@link import("./claude-subscription-executor.js").runClaudeSubscription}'s
   * queue-position phase (D-US1) is gate-agnostic — it works with this gate, `shared`, or any injected
   * {@link QueueVisibleGate} alike. WP1.7 completed the production wiring: `run-service.ts`'s
   * `resolveClaudeSubscription` now reads `pool.runs` (not `pool.shared`) for
   * `ClaudeSubscriptionRunConfig.concurrency`, so a suite of subscription runs can no longer contend
   * with (or be starved by) an in-flight CLI judge.
   */
  readonly runs: ConcurrencyGate;
  private readonly providers: ProviderConcurrencyRegistry;

  constructor(
    maxConcurrency: number,
    maxPerProvider: number = maxConcurrency,
    runsMaxConcurrency: number = maxConcurrency,
  ) {
    this.shared = new AsyncSemaphore(maxConcurrency);
    this.runs = new AsyncSemaphore(runsMaxConcurrency);
    this.providers = new ProviderConcurrencyRegistry(Math.max(1, Math.floor(maxPerProvider)));
  }

  /** The memoized per-provider gate for `providerId` (D-CS2). */
  providerGate(providerId: string): ConcurrencyGate {
    return this.providers.gateFor(providerId);
  }
}
