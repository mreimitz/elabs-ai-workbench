// The browser's copy of the reference data pack's VALUES (RM-38 WP 3.2, owner ruling 2026-08-23).
//
// THE PROBLEM THIS SOLVES
// ----------------------
// `packages/shared` may never read the filesystem, so everything the browser needs out of the pack
// is compiled into the image at build time — `pack-defaults.generated.ts` for the model context
// windows and the two thresholds, `security-tables.generated.ts` for the rule registry. That was
// fine while the pack could only ever be the one that shipped. RM-38 WP 3.1 made a pack fetchable,
// and from that moment the API's answers could move while the browser's stayed on what was in the
// image: a model the API accepts reading as unknown in the picker, a compare view opening on the old
// default, a "50%" label beside a bucket computed at another number, and a Security tab counting
// rules the analyzer no longer has and captioning a finding with a title it no longer carries.
//
// An imported `const` cannot be re-pointed, so hydration is invisible unless every consumer reads
// through an accessor. This module is that accessor, and it is the ONLY module under `apps/web/src`
// allowed to import the compiled floor —
// `apps/web/src/lib/pack-values.guardrail.test.ts` BANS those symbols everywhere else.
//
// FOUR RULES, EACH OF WHICH IS A WAY THIS GOES WRONG
// -------------------------------------------------
//  1. **The floor is the initial value AND the per-key fallback. The store is never empty.** Not
//     "the floor until hydration succeeds" — the floor *under* whatever hydrates, forever. Emptying
//     the live map mid-session still yields the compiled window for a model the image knew. That
//     matters most at `RunConsole.tsx`, whose `?? 0` turned an unknown window into a confident,
//     meaningless "0% of context used"; `contextLimitFor` returns `null` for genuinely unknown and
//     the caller renders nothing rather than a number it cannot justify.
//  2. **`CompareView`'s threshold is a SEED, not a live value.** It never re-points on a later pack
//     change: that would yank a slider the operator had already moved. Because the seed can be
//     wanted before hydration returns, `CompareView` awaits `packValuesSettled()` ONCE and adopts
//     the pack's default only while its own seed is still untouched. Nothing blocks the first
//     paint to arrange this — see `packValuesSettled` for why that inversion mattered.
//  3. **A malformed payload degrades, it does not throw.** `install` validates against the shared
//     zod schema and keeps the floor on any failure. A pack surface that could white-screen the app
//     would be a worse outcome than a stale number.
//  4. **Hydration never blocks anything — not correctness, and not the first paint.** Every accessor
//     answers before the fetch resolves and after it fails, and the shell renders without waiting
//     on it at all.

import { useSyncExternalStore } from "react";
import {
  DEFAULT_COMPARE_THRESHOLD,
  DataPackValuesSchema,
  FAILURE_BUCKET_SCORE_THRESHOLD,
  MODEL_CONTEXT_LIMITS,
  SECURITY_RULES,
  type DataPackSecurityRuleView,
  type DataPackValues,
} from "@mcp-token-footprint/shared";
import { getDataPackStatus } from "./api";

/**
 * The compiled floor, projected into the wire shape once.
 *
 * This is the ONE import of those four symbols in `apps/web/src`. Everything else reads the
 * accessors below.
 */
const FLOOR: DataPackValues = {
  modelContextLimits: MODEL_CONTEXT_LIMITS,
  defaultCompareThreshold: DEFAULT_COMPARE_THRESHOLD,
  failureBucketScoreThreshold: FAILURE_BUCKET_SCORE_THRESHOLD,
  securityRules: Object.fromEntries(
    Object.entries(SECURITY_RULES).map(([id, rule]) => [
      id,
      { id: rule.id, severity: rule.severity, title: rule.title, rationale: rule.rationale },
    ]),
  ),
};

let current: DataPackValues = FLOOR;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/**
 * Put a hydrated `values` block in force. Invalid input is IGNORED — the floor (or whatever is
 * already in force) keeps serving, because a browser that renders the wrong number confidently is
 * worse than one that renders last week's.
 */
export function installPackValues(values: unknown): boolean {
  const parsed = DataPackValuesSchema.safeParse(values);
  if (!parsed.success) return false;
  current = parsed.data;
  emit();
  return true;
}

/** The whole block in force. Prefer the named accessors; this exists for the hook. */
export function packValues(): DataPackValues {
  return current;
}

/** The compiled floor itself — exported so a test can prove the fallback is the image's table. */
export function packValuesFloor(): DataPackValues {
  return FLOOR;
}

/**
 * A model's context window in tokens, or `null` when NOTHING knows it.
 *
 * `null`, never `0`. A caller must be able to tell "this model's window is unknown" from "this
 * model's window is zero", and the second is not a thing that exists.
 */
export function contextLimitFor(modelId: string): number | null {
  return resolveContextLimit(current, modelId);
}

/** The same resolution over an explicitly supplied block — what the hook below reads. */
function resolveContextLimit(values: DataPackValues, modelId: string): number | null {
  const live = values.modelContextLimits[modelId];
  if (typeof live === "number" && Number.isFinite(live)) return live;
  const floor = FLOOR.modelContextLimits[modelId];
  return typeof floor === "number" && Number.isFinite(floor) ? floor : null;
}

/** Every model id with a known context window — the pack's UNION the compiled floor's (D-DP3). */
export function knownModelIds(): string[] {
  return [
    ...new Set([
      ...Object.keys(FLOOR.modelContextLimits),
      ...Object.keys(current.modelContextLimits),
    ]),
  ];
}

/** True when any layer knows this model. The exact-key question `allow-list.ts` asks. */
export function isKnownModelId(modelId: string): boolean {
  return contextLimitFor(modelId) !== null;
}

/** The compare matcher's Jaccard floor. Read ONCE, at mount — see rule 2 in the header. */
export function defaultCompareThreshold(): number {
  const live = current.defaultCompareThreshold;
  return typeof live === "number" && Number.isFinite(live) ? live : FLOOR.defaultCompareThreshold;
}

/** Suite failure buckets — a run scoring below this is a low-score candidate. */
export function failureBucketScoreThreshold(): number {
  const live = current.failureBucketScoreThreshold;
  return typeof live === "number" && Number.isFinite(live)
    ? live
    : FLOOR.failureBucketScoreThreshold;
}

/** The security rule registry in force, falling back whole if the live one is degenerate. */
export function securityRuleRegistry(): Record<string, DataPackSecurityRuleView> {
  return Object.keys(current.securityRules).length > 0
    ? current.securityRules
    : FLOOR.securityRules;
}

/** One rule, or `undefined` when neither the pack nor the image declares it. */
export function securityRuleFor(ruleId: string): DataPackSecurityRuleView | undefined {
  return securityRuleRegistry()[ruleId] ?? FLOOR.securityRules[ruleId];
}

/** How many rules the analyzer in force declares. */
export function securityRuleCount(): number {
  return Object.keys(securityRuleRegistry()).length;
}

// ── Hydration ───────────────────────────────────────────────────────────────────────────────────

/** The in-flight (or settled) first hydration, so a consumer can wait on it WITHOUT the shell doing so. */
let hydration: Promise<boolean> | null = null;

/**
 * Fetch `GET /api/data-pack` and install its `values`.
 *
 * Never throws and never rejects: an unreachable API leaves the floor in force, which is exactly
 * what the image shipped with. `main.tsx` FIRES this and does not await it — see
 * {@link packValuesSettled} for why that ordering is the whole design.
 */
export function hydratePackValues(signal?: AbortSignal): Promise<boolean> {
  const attempt = getDataPackStatus(signal)
    .then((status) => installPackValues(status.values))
    .catch(() => false);
  hydration = attempt;
  return attempt;
}

/**
 * Resolves once the first hydration attempt has SETTLED — or immediately if none was ever fired.
 *
 * **This exists so that nothing has to block the first paint.** An earlier cut awaited hydration in
 * `main.tsx` before mounting, which bought one correct slider default on one route and cost a blank
 * screen for up to two seconds whenever the API was slow to answer. That is this work package's own
 * subject inverted: D-DP4 and WP 3.1 exist to stop the app waiting on a dependency that is ALLOWED
 * to be slow, and a busy event loop — a large scan, a suite run — is exactly when someone reloads
 * the page to see what is happening.
 *
 * So the shell mounts immediately, and the ONE consumer whose value is a seed rather than a live
 * read (`CompareView`'s Jaccard threshold) waits here instead: a local, cancellable wait inside one
 * route's subtree, which renders its floor-seeded default in the meantime and adopts the pack's
 * default if and when it lands. A hung `/api/data-pack` therefore delays nothing at all — it leaves
 * one slider on the value the image shipped with.
 *
 * Never rejects, for the same reason {@link hydratePackValues} does not.
 */
export function packValuesSettled(): Promise<boolean> {
  return hydration ?? Promise.resolve(false);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Re-render on hydration. For the surfaces that SHOULD move when the pack does (rule 2 excepted). */
export function usePackValues(): DataPackValues {
  return useSyncExternalStore(subscribe, packValues, packValues);
}

/**
 * A model's context window, re-rendering when the pack changes underneath.
 *
 * `null` means UNKNOWN — never `0`. `RunConsole` is the reason that distinction is spelled out: its
 * previous `MODEL_CONTEXT_LIMITS[model] ?? 0` could not tell a window it did not know from a window
 * of zero, and rendered the second, which is a number nobody can justify.
 */
export function useContextLimit(modelId: string): number | null {
  return resolveContextLimit(usePackValues(), modelId);
}

/** The security rule registry, re-rendering when the pack changes underneath. */
export function useSecurityRuleRegistry(): Record<string, DataPackSecurityRuleView> {
  const values = usePackValues();
  return Object.keys(values.securityRules).length > 0 ? values.securityRules : FLOOR.securityRules;
}

/** For tests only — production installs and never reverts. */
export function resetPackValuesForTests(): void {
  current = FLOOR;
  hydration = null;
  emit();
}
