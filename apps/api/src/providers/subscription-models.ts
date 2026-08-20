// Claude subscription LIVE model roster (planning/Roadmap/RM-09-claude-subscription/ follow-up).
//
// The `claude_subscription` provider kind's "models" are the Claude tiers the signed-in subscription
// grants. The Agent SDK exposes the LIVE list the CLI picker uses via `Query.supportedModels()` — but
// that needs a spawned child, so this resolver fetches it lazily, caches it (~1h keyed on the sign-in),
// and ALWAYS falls back to the static `ASSISTANT_DEFAULT_MODEL_ROSTER` on any error/timeout/not-signed-
// in (honest — the dropdown must always return something usable, never a fabricated tier, never a hang).
//
// It drives THREE surfaces: the provider Model dropdown (`GET /api/providers/:id/models` via
// `model-catalog.ts`), the Assistant dock roster (`GET /api/assistant/models`), and the run-path
// unknown-model guard (`RunService.resolveClaudeSubscription`, which reads the CACHE only — no hot-path
// spawn).
//
// Secret boundary (`.claude/rules/mcp-and-security.md`, D-AS17): the decrypted subscription token is
// resolved server-side and injected ONLY into the throwaway child env by `buildAssistantSpawnEnv`; it is
// never logged, never returned, and never held as a cache key (only a non-reversible fingerprint is).
//
// Memory budget (D-CS2/D-CS10): the probe child (~1 GiB, like a run/judge) is drawn from the SAME shared
// `SubscriptionConcurrencyPool.shared` gate, so it can't blow the ~1 GiB budget alongside runs/judges.
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ASSISTANT_DEFAULT_MODEL_ROSTER, type AvailableModel } from "@mcp-token-footprint/shared";
import type { AgentSessionDriver, DriverModelInfo } from "../assistant/session-driver.js";
import { type AssistantAuthSource, buildAssistantSpawnEnv } from "../assistant/spawn-env.js";
import type { ConcurrencyGate } from "../testing/subscription-concurrency.js";

/** The narrow "list the subscription's models" seam the provider dropdown + assistant dock consume. */
export interface SubscriptionModelSource {
  /** The subscription's models as {@link AvailableModel}s. Never throws — always returns a usable list
   *  (the live roster, or the static fallback on any error/timeout/not-signed-in). */
  resolve(): Promise<AvailableModel[]>;
}

/** The narrow "which model ids does the live list accept" seam the RUN path consumes off the cache. */
export interface SupportedModelIdSource {
  /**
   * The set of acceptable model ids (each roster row's `value` AND its `resolvedModel`) from a FRESH,
   * LIVE cache entry — or `undefined` when the live list is UNAVAILABLE (cache cold/stale, or the last
   * probe fell back to the static roster), meaning the caller should SKIP strict validation. NEVER
   * spawns (reads the in-memory cache only), so it is safe on the run hot path.
   */
  cachedSupportedModelIds(): Set<string> | undefined;
}

/** How long a successful LIVE roster is cached (~1h; the subscription's tiers change rarely). */
const LIVE_TTL_MS = 60 * 60_000;
/** How long a FAILED probe's fallback is cached — short, so a transient failure recovers soon without
 *  re-spawning on every dropdown open (yet doesn't hammer the SDK). */
const NEGATIVE_TTL_MS = 60_000;
/** Hard bound on ONE `supportedModels()` spawn so a slow/hung child never stalls the dropdown. */
const SPAWN_TIMEOUT_MS = 15_000;

/** A throwaway workspace for one probe: a temp dir + its idempotent, defensive cleanup. */
type ThrowawayWorkspace = { dir: string; cleanup: () => Promise<void> };
type CreateThrowawayWorkspace = () => Promise<ThrowawayWorkspace>;

/** The production {@link CreateThrowawayWorkspace}: a fresh temp dir scoping the child's HOME /
 *  CLAUDE_CONFIG_DIR + cwd, removed by `cleanup` — the real assistant home is never touched. */
function createThrowawayWorkspace(tempRoot: string = os.tmpdir()): CreateThrowawayWorkspace {
  return async () => {
    const dir = await fs.mkdtemp(path.join(tempRoot, "mcpfp-sub-models-"));
    return {
      dir,
      cleanup: async () => {
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      },
    };
  };
}

/** Dependencies for {@link SubscriptionModelResolver} — all injected so the resolver is offline-testable. */
export type SubscriptionModelResolverDeps = {
  /** The raw SDK driver seam (production: `SdkAgentSessionDriver`; tests: a scripted fake). */
  driver: AgentSessionDriver;
  /** Resolve the DECRYPTED subscription auth source, or `null` when unsigned (→ static fallback, no spawn). */
  resolveAuth: () => AssistantAuthSource | null;
  /** The SHARED runs+judge concurrency gate (`SubscriptionConcurrencyPool.shared`) — the probe child
   *  contends on the SAME ~1 GiB budget as runs/judges. */
  gate: ConcurrencyGate;
  /** Test seam — successful-roster cache TTL (defaults to {@link LIVE_TTL_MS}). */
  liveTtlMs?: number;
  /** Test seam — failed-probe fallback cache TTL (defaults to {@link NEGATIVE_TTL_MS}). */
  negativeTtlMs?: number;
  /** Test seam — one-probe timeout (defaults to {@link SPAWN_TIMEOUT_MS}). */
  spawnTimeoutMs?: number;
  /** Test seam — workspace factory (defaults to a real temp dir). */
  createWorkspace?: CreateThrowawayWorkspace;
  /** Test seam — clock (defaults to `Date.now`). */
  now?: () => number;
};

type CacheEntry = {
  /** Sign-in fingerprint (busts on re-sign-in). */
  key: string;
  /** Mapped models for the dropdown. */
  models: AvailableModel[];
  /** Acceptable ids (value ∪ resolvedModel) for the run-path guard — empty on a fallback entry. */
  ids: Set<string>;
  /** Whether this entry came from a real LIVE probe (vs. a cached fallback). */
  live: boolean;
  /** Expiry (ms epoch). */
  expiresAt: number;
};

/**
 * The cached live-roster resolver. Implements {@link SubscriptionModelSource} (dropdown/dock) and
 * {@link SupportedModelIdSource} (run-path guard). Single cache entry (one owner, one subscription),
 * keyed on the sign-in fingerprint so a re-sign-in busts it; concurrent callers coalesce onto ONE probe.
 */
export class SubscriptionModelResolver implements SubscriptionModelSource, SupportedModelIdSource {
  private cache: CacheEntry | undefined;
  private inflight: Promise<AvailableModel[]> | undefined;
  private readonly liveTtlMs: number;
  private readonly negativeTtlMs: number;
  private readonly spawnTimeoutMs: number;
  private readonly createWorkspace: CreateThrowawayWorkspace;
  private readonly now: () => number;

  constructor(private readonly deps: SubscriptionModelResolverDeps) {
    this.liveTtlMs = deps.liveTtlMs ?? LIVE_TTL_MS;
    this.negativeTtlMs = deps.negativeTtlMs ?? NEGATIVE_TTL_MS;
    this.spawnTimeoutMs = deps.spawnTimeoutMs ?? SPAWN_TIMEOUT_MS;
    this.createWorkspace = deps.createWorkspace ?? createThrowawayWorkspace();
    this.now = deps.now ?? Date.now;
  }

  async resolve(): Promise<AvailableModel[]> {
    const auth = safeResolveAuth(this.deps.resolveAuth);
    // Not signed in → the static fallback, cheaply (no spawn; the resolver never fabricates a tier).
    if (!auth) return staticFallback();
    const key = signInKey(auth);
    const cached = this.cache;
    if (cached && cached.key === key && cached.expiresAt > this.now()) return cached.models;
    // Coalesce concurrent callers (a dropdown + the dock opening together) onto ONE probe.
    if (this.inflight) return this.inflight;
    const inflight = this.fetchAndCache(auth, key).finally(() => {
      if (this.inflight === inflight) this.inflight = undefined;
    });
    this.inflight = inflight;
    return inflight;
  }

  cachedSupportedModelIds(): Set<string> | undefined {
    const cached = this.cache;
    // Only a FRESH, LIVE entry drives strict validation; a cold/stale/fallback cache → skip (undefined).
    if (!cached || !cached.live || cached.expiresAt <= this.now()) return undefined;
    return cached.ids;
  }

  private async fetchAndCache(auth: AssistantAuthSource, key: string): Promise<AvailableModel[]> {
    const live = await this.fetchLive(auth);
    const now = this.now();
    if (live) {
      const models = mapModels(live);
      // A probe that returned NO usable models is treated as a fallback (never an empty dropdown).
      if (models.length > 0) {
        this.cache = { key, models, ids: collectIds(live), live: true, expiresAt: now + this.liveTtlMs };
        return models;
      }
    }
    // Failure (or an empty live list) → cache the static fallback for a SHORT window. `live:false` so the
    // run-path guard returns `undefined` (skip validation) rather than validating against a stale/fake set.
    const models = staticFallback();
    this.cache = { key, models, ids: new Set(), live: false, expiresAt: now + this.negativeTtlMs };
    return models;
  }

  /** ONE probe: acquire the shared gate, spin a throwaway workspace, ask `supportedModels()` under a
   *  hard timeout, tear the child down. Returns `undefined` on ANY failure/timeout — NEVER rethrows. */
  private async fetchLive(auth: AssistantAuthSource): Promise<DriverModelInfo[] | undefined> {
    await this.deps.gate.acquire();
    let workspace: ThrowawayWorkspace | undefined;
    const abortController = new AbortController();
    try {
      workspace = await this.createWorkspace();
      const env = buildAssistantSpawnEnv({ auth, assistantDataDir: workspace.dir });
      return await withTimeout(
        this.deps.driver.supportedModels({ env, cwd: workspace.dir, abortController }),
        this.spawnTimeoutMs,
        () => abortController.abort(),
      );
    } catch {
      // ANY failure (timeout / driver error / spawn failure) → fall back. Never rethrows (the dropdown
      // must always get a list); never logs — an error message could carry the token.
      return undefined;
    } finally {
      abortController.abort();
      await workspace?.cleanup().catch(() => {});
      this.deps.gate.release();
    }
  }
}

/** The corrected static roster mapped to id-only {@link AvailableModel}s — the honest fallback floor. */
function staticFallback(): AvailableModel[] {
  return ASSISTANT_DEFAULT_MODEL_ROSTER.map((id) => ({ id }));
}

/**
 * Map the SDK's live {@link DriverModelInfo}s → {@link AvailableModel}s for the picker, preserving the
 * SDK's (CLI-picker) order and deduping by id. `value` → `id`; `displayName` filled when present.
 */
function mapModels(models: DriverModelInfo[]): AvailableModel[] {
  const byId = new Map<string, AvailableModel>();
  for (const model of models) {
    // Use the CANONICAL wire id (`resolvedModel`, e.g. `sonnet` → `claude-sonnet-5`) as the model id,
    // NOT the alias (`value`): a run stores + shadow-prices on this id, and `pricing.ts` (the cost KPI
    // + the `maxCostUsd` cap) only knows the canonical id — an alias would price at $0 and a cost cap
    // would reject it. Falls back to the alias when the SDK omits a `resolvedModel`. Dedupes by id
    // (e.g. `default` + `opus` both → `claude-opus-4-8`); the LAST alias's `displayName` wins (keeps
    // the first-seen order but a cleaner label — `Opus` over `Default (recommended)`).
    const id = model.resolvedModel?.trim() || model.value?.trim();
    if (!id) continue;
    const displayName = model.displayName?.trim();
    byId.set(id, displayName ? { id, displayName } : { id });
  }
  return [...byId.values()];
}

/** Every acceptable id the run-path guard checks against: each row's `value` AND its `resolvedModel`
 *  (so a selected alias id or its canonical wire id both validate). */
function collectIds(models: DriverModelInfo[]): Set<string> {
  const ids = new Set<string>();
  for (const model of models) {
    const value = model.value?.trim();
    if (value) ids.add(value);
    const resolved = model.resolvedModel?.trim();
    if (resolved) ids.add(resolved);
  }
  return ids;
}

/** Resolve the auth source defensively — a throwing resolver (never expected) is treated as unsigned. */
function safeResolveAuth(resolveAuth: () => AssistantAuthSource | null): AssistantAuthSource | null {
  try {
    return resolveAuth();
  } catch {
    return null;
  }
}

/** A stable, NON-reversible fingerprint of the sign-in so the cache busts on re-sign-in WITHOUT ever
 *  holding the raw token/key as a map key (secret boundary). */
function signInKey(auth: AssistantAuthSource): string {
  const material = auth.kind === "claude_oauth" ? auth.token : auth.apiKey;
  return `${auth.kind}:${createHash("sha256").update(material).digest("hex").slice(0, 16)}`;
}

/** Race a promise against a timeout; on timeout, fire `onTimeout` (aborts the probe) and reject. */
async function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout();
      reject(new Error(`supportedModels timed out after ${ms}ms`));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
