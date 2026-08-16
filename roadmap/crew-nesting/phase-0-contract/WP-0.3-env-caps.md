# WP 0.3 — Env caps: `HUB_MISSION_MAX_DEPTH` / `HUB_MISSION_MAX_TOTAL_AGENTS` + `HubMissionCaps` fields

**Phase:** 0 — Contract & foundation · **Size:** S · **Depends on:** 0.1 · **Model:** Sonnet

## Objective
Add the two new server-side hard caps that bound a nested-crew tree — `HUB_MISSION_MAX_DEPTH`
(default **2**) and `HUB_MISSION_MAX_TOTAL_AGENTS` (default **24**) — to `apps/api/src/config/env.ts`,
add the corresponding optional fields to `HubMissionCaps` (`apps/api/src/hub/missions/planner.ts:46`),
and wire both through to the `HubMissionService` construction in `apps/api/src/index.ts`. This WP
**only** defines, parses, and threads the caps — it implements no depth/budget enforcement logic
(that is WP 1.1's author-time guard and WP 2.1/2.2's run-time recursion/cascade). It realizes the
numeric half of **D-CN10** (defaults + the `MAX_DEPTH=1` off-switch) so later WPs have a typed,
env-overridable ceiling to read from.

## Why / references
- **D-CN3** — `HUB_MISSION_MAX_BUDGET_USD` is a whole-tree ceiling; a companion whole-tree **agent**
  ceiling (`HUB_MISSION_MAX_TOTAL_AGENTS`) backstops the existing per-mission `HUB_MISSION_MAX_AGENTS`.
  This WP defines that constant; WP 2.2 is where it is actually read against the tree.
- **D-CN10** — ships with `HUB_MISSION_MAX_DEPTH` default **2** (root + one nested level) and
  `HUB_MISSION_MAX_TOTAL_AGENTS` default **24**; `HUB_MISSION_MAX_DEPTH=1` must reproduce today's
  exact depth-1 semantics (a `crewId` member is then rejected at author time as over-depth — enforced
  by WP 1.1, not here).
- Depends on **0.1** (`packages/shared`), which lands the `HUB_MISSION_MAX_DEPTH` /
  `HUB_MISSION_MAX_TOTAL_AGENTS` numeric default constants in `packages/shared/src/constants.ts` —
  the same "shared constant importable both as an env.ts fallback and directly by a lower layer with
  no config threaded to it" shape already used for `HUB_FILE_MAX_BYTES` / `HUB_WS_MAX_FILE_BYTES`
  (`env.ts:15–16`, import used as the `readPositiveInt` fallback at `env.ts:324`). WP 1.1's author-time
  repository check will need the same default without `HubMissionServiceConfig` threaded to it, so this
  WP consumes that same shared constant rather than re-inventing a literal.
- **Exact anchors this WP touches** (from `references.md`): `apps/api/src/hub/missions/planner.ts` —
  `HubMissionCaps:46`; `apps/api/src/config/env.ts` — `hubMissionMaxAgents:349`, `MaxParallel:353`,
  `DefaultBudgetUsd`/`MaxBudgetUsd:363`; `apps/api/src/index.ts` — the `hubMissionService` config
  object `~717–724`.

## Design
1. **`packages/shared`** (already landed by 0.1 — read, don't re-add): `HUB_MISSION_MAX_DEPTH = 2` and
   `HUB_MISSION_MAX_TOTAL_AGENTS = 24` exported from `packages/shared/src/constants.ts`. Confirm they
   exist under those exact names before wiring; if 0.1 landed them under different identifiers, adjust
   only the import name here — the values/semantics (D-CN10) are locked.
2. **`apps/api/src/config/env.ts`** — import the two constants alongside the existing
   `HUB_FILE_MAX_BYTES`/`HUB_WS_MAX_FILE_BYTES` imports (top-of-file `@mcp-token-footprint/shared`
   block), then add two new `config` fields immediately after `hubMissionMaxBudgetUsd` (line 363),
   inside the same "Assistant Hub … MISSION knobs … HARD CAPS" doc block (lines 342–346), using the
   **exact same parsing helper** as the sibling caps — `readPositiveInt`, which already falls back to
   the default on `0`, a negative value, or a non-numeric string (this is the "reject non-positive"
   requirement, for free, from the existing helper — no new validation function needed):
   `hubMissionMaxDepth: readPositiveInt(process.env.HUB_MISSION_MAX_DEPTH, HUB_MISSION_MAX_DEPTH)` and
   `hubMissionMaxTotalAgents: readPositiveInt(process.env.HUB_MISSION_MAX_TOTAL_AGENTS, HUB_MISSION_MAX_TOTAL_AGENTS)`
   — the identical env-var-name-equals-fallback-constant-name shape already used at `env.ts:324`
   (`readPositiveInt(process.env.HUB_WS_MAX_FILE_BYTES, HUB_WS_MAX_FILE_BYTES)`). Add a doc comment
   naming D-CN3/D-CN10 and stating `HUB_MISSION_MAX_DEPTH=1` reproduces today's behavior (enforcement
   lands in WP 1.1/2.1, not here).
3. **`apps/api/src/hub/missions/planner.ts`** — add two **optional** fields to `HubMissionCaps`
   (line 46), each with a doc comment mirroring the existing six fields' style, citing D-CN3/D-CN10 and
   the env var name:
   - `maxDepth?: number;` — the max nesting depth a mission tree may reach. `HUB_MISSION_MAX_DEPTH`.
   - `maxTotalAgents?: number;` — the transitive whole-tree leaf-agent ceiling, backstopping the
     per-mission `maxAgents`. `HUB_MISSION_MAX_TOTAL_AGENTS`.
   They are **optional**, not required, deliberately: `HubMissionServiceConfig = HubMissionCaps & {…}`
   (`orchestrator.ts:150`) and ~10 existing test files construct a `HubMissionCaps`/config literal
   directly (`hub-missions.test.ts`, `hub-topologies.test.ts`, `hub-mission-approval.test.ts`,
   `hub-repository.test.ts`, `hub-agent-runner.test.ts`, `hub-agent-handoff.test.ts`,
   `hub-session-roster.test.ts`, `hub-prompting.test.ts`, `hub-wp1r-review.test.ts`,
   `hub-wp4r-final-review.test.ts`) without these two fields. Making them required would force an
   unrelated edit to every one of those files just to satisfy the type checker — the wrong blast radius
   for an S-sized, disjoint WP, and a violation of D-CN5's additive-only doctrine. Production always
   populates both (env.ts never returns `undefined`); a later WP that reads `caps.maxDepth`/
   `caps.maxTotalAgents` (2.1/2.2) is responsible for its own `?? fallback`.
4. **`apps/api/src/index.ts`** — in the `hubMissionService` construction (`~715–730`), add
   `maxDepth: config.hubMissionMaxDepth,` and `maxTotalAgents: config.hubMissionMaxTotalAgents,`
   immediately after the existing `maxBudgetUsd: config.hubMissionMaxBudgetUsd,` line, before the
   autonomy-threshold fields — same grouping as the "hard caps" cluster already there.
5. **`.env.example`** — document both new vars in the existing "Assistant Hub … mission knobs" block,
   directly after `HUB_MISSION_MAX_BUDGET_USD=10.00`, in the same terse comment-then-`KEY=value` shape
   as the surrounding lines, naming the defaults (2 / 24) and the D-CN10 `MAX_DEPTH=1` off-switch note.
6. **No enforcement logic anywhere.** Do not read `maxDepth`/`maxTotalAgents` in `topologies.ts`,
   `orchestrator.ts`, or the repository in this WP — that is explicitly out of scope (WP 1.1 for
   author-time depth rejection, WP 2.1/2.2 for run-time recursion + whole-tree budget/agent-count
   cascade). This WP's job ends at "the number is parsed, typed, and reachable via `config`."

## Files
- `apps/api/src/config/env.ts` *(modify)* — import the two shared default constants; add
  `hubMissionMaxDepth`/`hubMissionMaxTotalAgents` parsed via `readPositiveInt`, alongside the existing
  mission hard-cap fields (~349–363).
- `apps/api/src/hub/missions/planner.ts` *(modify)* — add optional `maxDepth?: number` /
  `maxTotalAgents?: number` fields (with doc comments) to `HubMissionCaps` (line 46).
- `apps/api/src/index.ts` *(modify)* — wire `maxDepth: config.hubMissionMaxDepth` /
  `maxTotalAgents: config.hubMissionMaxTotalAgents` into the `hubMissionService` config object
  (~717–724).
- `.env.example` *(modify)* — document `HUB_MISSION_MAX_DEPTH` / `HUB_MISSION_MAX_TOTAL_AGENTS`
  (defaults, semantics, the D-CN10 `=1` off-switch note) after `HUB_MISSION_MAX_BUDGET_USD`.
- `apps/api/test/hub-mission-nesting-env.test.ts` *(create)* — env-parsing tests, following the
  `assistant-env.test.ts` cache-busting-dynamic-import `freshConfig()` pattern.

## Acceptance
- [ ] `HUB_MISSION_MAX_DEPTH` unset/empty ⇒ `config.hubMissionMaxDepth === 2`.
- [ ] `HUB_MISSION_MAX_TOTAL_AGENTS` unset/empty ⇒ `config.hubMissionMaxTotalAgents === 24`.
- [ ] A valid positive-int override for each (e.g. `"3"`, `"40"`) is parsed and stored verbatim.
- [ ] A non-positive value (`"0"`, `"-1"`) or a non-numeric value (`"abc"`) for either var falls back
      to its default (2 / 24 respectively) — proves the "reject non-positive" requirement.
- [ ] `HUB_MISSION_MAX_DEPTH=1` is accepted and parsed as `1` (today's-behavior reproduction value;
      no rejection logic lives here — that is WP 1.1).
- [ ] `HubMissionCaps` in `planner.ts` has `maxDepth?: number` and `maxTotalAgents?: number`, each with
      a doc comment naming D-CN3/D-CN10 and its env var.
- [ ] `apps/api/src/index.ts`'s `hubMissionService` construction passes both new fields through from
      `config`.
- [ ] `.env.example` documents both vars with their defaults and the D-CN10 off-switch note.
- [ ] None of the ~10 pre-existing test files that construct a `HubMissionCaps`/`HubMissionServiceConfig`
      object literal (`hub-missions.test.ts`, `hub-topologies.test.ts`, `hub-mission-approval.test.ts`,
      `hub-repository.test.ts`, `hub-agent-runner.test.ts`, `hub-agent-handoff.test.ts`,
      `hub-session-roster.test.ts`, `hub-prompting.test.ts`, `hub-wp1r-review.test.ts`,
      `hub-wp4r-final-review.test.ts`) needed any edit — confirms the widening is additive.
- [ ] No file outside the five listed above reads `maxDepth` or `maxTotalAgents` (enforcement is out
      of scope for this WP).
- [ ] Gate green (`pnpm typecheck && pnpm test && pnpm build && pnpm lint`).

## Notes
- **Parallel-safety:** solo-safe against its sibling batch WP **0.2** (disjoint files — 0.2 owns
  `apps/api/src/db/*`, this WP owns `config/env.ts` + `index.ts`'s caps block only) — the README's
  batch 2 groups `{0.2, 0.3}` together. However, `index.ts` is on `conventions.md`'s contested-hot-file
  list ("touches … `index.ts` → run solo") — that rule guards against *other, unrelated* concurrent
  work on `index.ts`, not against 0.2, which never touches it. If any other in-flight plan is mid-edit
  on `index.ts` at claim time, sequence rather than batch.
- **Sequencing:** depends only on 0.1 landing the two shared default constants in
  `packages/shared/src/constants.ts` — confirm they exist under the exact names
  `HUB_MISSION_MAX_DEPTH`/`HUB_MISSION_MAX_TOTAL_AGENTS` before wiring; if 0.1 named them differently,
  fix only the import here.
- **Nothing owner-gated or stub-tested here** — this is pure env-parsing + type-widening + DI wiring,
  no provider/runtime dependency. The interesting invariants (budget monotonicity, depth rejection)
  are proven in WP 1.1 and WP 2.1/2.2/2.R, not here — don't be tempted to pull that work forward.
