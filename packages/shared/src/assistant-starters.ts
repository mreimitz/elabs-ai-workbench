import { ASSISTANT_ENTITY_KINDS } from "./constants.js";
import type { AssistantEntityKind } from "./types.js";

// ==================================================================================================
// Assistant Refinement R3 (WP R3.1) — the shared SESSION-STARTER catalog (D-AS27/D-AS28/D-AS29)
// ==================================================================================================
// A deterministic, curated + data-aware set of "what to ask next" prompt chips per app surface. This
// module is the ONE place the exact wording lives — both `apps/api` (the data-aware
// `GET /api/assistant/starters` service, `apps/api/src/assistant/starters.ts`) and `apps/web` (the
// dock's empty-state chip render, a later WP) read from it. Authored verbatim from
// `planning/Roadmap/RM-02-assistant/refinement-03-session-starters.md` §"The catalog" — labels/prompt text/scope
// markers (`[A]`/`[W]`/`[?cond]`) are NOT paraphrased.
//
// Curated + free (D-AS28): every entry here is STATIC text, computed with zero LLM calls. The only
// "dynamic" starter (`buildGlobalDebugFailedScansStarter`) interpolates a plain count the API service
// already computed from a cheap read — still fully deterministic.
//
// Scope-consistent (D-AS29): a `kind: "action"` starter's `writeTool` MUST be a member of
// `SCOPE_WRITE_TOOLS[surface]` (`./assistant-scope.js`) for every entity-kind surface, and non-entity
// surfaces (`global`, `compatibility`) must carry NO action starters at all (there is no entity to
// scope a write to). `apps/api/test/assistant-starters.test.ts` cross-checks this for EVERY surface +
// tab variant — the required D-AS29 guard — and `deriveStarters` (the API service) additionally
// scope-filters at runtime as belt-and-braces.

/** `analysis` = read-only, always safe to suggest; `action` = triggers a gated write (D-AS4) — only
 *  ever emitted where `writeTool` is in scope for the current surface (D-AS29). */
export type AssistantStarterKind = "analysis" | "action";

/**
 * One starter chip. `prompt` is PREFILL TEXT ONLY (D-AS27 — clicking a chip fills the composer via
 * the existing `openAssistant({prompt, entity})`, which never auto-sends); it must read naturally as
 * something the owner could edit before sending, not as an instruction TO the catalog.
 */
export type AssistantStarter = {
  /** Stable, globally-unique, surface-prefixed kebab id (e.g. `server.explain-footprint`). */
  id: string;
  label: string;
  prompt: string;
  kind: AssistantStarterKind;
  /** Set ONLY on `kind: "action"` starters — the bare write-tool name (no `mcp__<server>__` prefix),
   *  matching `SCOPE_WRITE_TOOLS` in `./assistant-scope.js`. */
  writeTool?: string;
};

/**
 * The surfaces a starter set can target: the 9 {@link AssistantEntityKind}s PLUS four surfaces that are
 * NOT entity kinds — `"global"` (no entity pinned; the dashboard/unmatched-route dock),
 * `"compatibility"` (`/testing/compatibility` — a real page with no `AssistantEntityKind` of its own,
 * since it scores a scan against models rather than naming one entity), and `"hub"` / `"agents"`
 * (assistant-operability WP 2.1, D-AO3 — route-keyed surfaces for the Hub's own pages, `/assistant*`
 * and `/assistant/agents*` respectively; NOT new entity kinds — the Hub's agents/crews are a
 * suggestion-only context gap, not a write-scope boundary, so they deliberately stay outside
 * `ASSISTANT_ENTITY_KINDS`/`SCOPE_WRITE_TOOLS`). All four extra surfaces are READ-ONLY by
 * construction: none has a `SCOPE_WRITE_TOOLS` entry (that map is keyed by `AssistantEntityKind`
 * only), so an action starter can never be scope-checked for them — the catalog and the API service
 * both therefore carry zero action starters under `global`/`compatibility`/`hub`/`agents`.
 */
export type AssistantStarterSurface = "global" | "compatibility" | "hub" | "agents" | AssistantEntityKind;

/** `GET /api/assistant/starters` response shape. `version` is {@link ASSISTANT_STARTERS_VERSION} —
 *  bump it whenever the catalog's wording/conditionals change in a way a consumer might care to know
 *  about (mirrors `TOKEN_COUNTING_VERSION`'s pattern; nothing currently branches on it). */
export type AssistantStartersResponse = {
  version: number;
  surface: AssistantStarterSurface;
  starters: AssistantStarter[];
};

/** Bump on any catalog wording/conditional change (see {@link AssistantStartersResponse}'s doc). */
export const ASSISTANT_STARTERS_VERSION = 1;

// ── The BASE catalog — one entry per surface, authored verbatim from the R3 plan's "The catalog" ────
// (the `[?cond]` conditional starters are NOT here — they're computed server-side and prepended by
// `deriveStarters`; their text is still authored once, as the named exports further down, so the
// wording lives in exactly one place).

const GLOBAL_STARTERS: readonly AssistantStarter[] = [
  {
    id: "global.most-expensive-server",
    kind: "analysis",
    label: "Most expensive server",
    prompt: "Rank my MCP servers by token footprint and show the biggest contributors.",
  },
  {
    id: "global.token-savings",
    kind: "analysis",
    label: "Token savings",
    prompt:
      "Look across my servers' latest scans and find the biggest token-savings opportunities — bloated descriptions, unused or overlapping tools — with estimated savings.",
  },
  {
    id: "global.recent-failures",
    kind: "analysis",
    label: "Recent failures",
    prompt: "Summarize my failed runs from the last week and group them by likely cause.",
  },
];

const SERVER_STARTERS: readonly AssistantStarter[] = [
  {
    id: "server.explain-footprint",
    kind: "analysis",
    label: "Explain the footprint",
    prompt: "Explain this server's token footprint and its biggest tool contributors.",
  },
  {
    id: "server.trim-tokens",
    kind: "analysis",
    label: "Trim tokens",
    prompt:
      "Identify tools or descriptions on this server I could trim to cut tokens, with estimated savings.",
  },
  {
    id: "server.whats-changed-since-last-scan",
    kind: "analysis",
    label: "What changed since last scan?",
    prompt: "Compare this server's two most recent scans and explain what changed.",
  },
  {
    id: "server.adjust-config",
    kind: "action",
    label: "Adjust config",
    prompt: "Help me adjust this server's non-secret configuration.",
    writeTool: "servers_update_config",
  },
];

const SCAN_STARTERS: readonly AssistantStarter[] = [
  {
    id: "scan.reduce-token-footprint",
    kind: "analysis",
    label: "Reduce token footprint",
    prompt:
      "Analyze this scan and identify ways to reduce the server's token footprint — bloated descriptions, unused tools, optimization opportunities.",
  },
  {
    id: "scan.most-expensive-tools",
    kind: "analysis",
    label: "Most expensive tools",
    prompt: "Show which tools in this scan cost the most tokens, and why.",
  },
  {
    id: "scan.fits-the-models",
    kind: "analysis",
    label: "Fits the models?",
    prompt:
      "Check this scan's tools against common model context limits and flag anything that won't fit.",
  },
  {
    id: "scan.compare-to-previous",
    kind: "analysis",
    label: "Compare to previous",
    prompt: "Compare this scan to the server's previous scan and explain the deltas.",
  },
];

/** Skill — "Overview / default" set (the plan's un-labeled first block). Shown for every skill-page
 *  tab that has no more specific override in {@link SKILL_TAB_STARTERS}. */
const SKILL_STARTERS: readonly AssistantStarter[] = [
  {
    id: "skill.improve-from-recent-runs",
    kind: "action",
    label: "Improve from recent runs",
    prompt:
      "Analyze the recent test runs that use this skill, find avoidable issues, and propose edits to the skill.",
    writeTool: "skills_commit_workspace",
  },
  {
    id: "skill.explain-footprint",
    kind: "analysis",
    label: "Explain the footprint",
    prompt: "Explain this skill's L1/L2/L3 token footprint and where I could trim it.",
  },
  {
    id: "skill.tighten-triggers",
    kind: "action",
    label: "Tighten triggers",
    prompt:
      "Review this skill's description and trigger keywords for collisions or weak matches and propose fixes.",
    // The plan marks this bare `[W]` — every skill edit commits a new version via skills_commit_workspace.
    writeTool: "skills_commit_workspace",
  },
];

/** Skill — tab overrides (the plan's "Tab overrides" block): surfaced FIRST when the envelope's `tab`
 *  matches one of these keys, ahead of {@link SKILL_STARTERS}. `overview` carries no override entries
 *  of its own (the Overview tab IS the default set above) — kept as an explicit empty key so every tab
 *  this surface recognizes is enumerable from one map. NOTE (see `apps/api/src/assistant/starters.ts`):
 *  the skill envelope carries no `tab` today (the skill editor's sub-view lives in `?mode=`, not
 *  `?tab=`), so these variants are DORMANT until a later WP maps `?mode=` → the envelope's `tab`. */
export const SKILL_TAB_STARTERS: Readonly<Record<string, readonly AssistantStarter[]>> = {
  overview: [],
  quality: [
    {
      id: "skill.tab.quality.fix-top-findings",
      kind: "action",
      label: "Quality",
      prompt: "Fix the top quality findings for this skill and show me the changes.",
      writeTool: "skills_commit_workspace",
    },
  ],
  diff: [
    {
      id: "skill.tab.diff.summarize-changes",
      kind: "analysis",
      label: "Diff",
      prompt:
        "Summarize what changed between the two versions I'm comparing and whether anything looks risky.",
    },
  ],
  usage: [
    {
      id: "skill.tab.usage.explain-cost-and-quality",
      kind: "analysis",
      label: "Usage",
      prompt: "Explain how this skill affected the cost and quality of the runs that used it.",
    },
  ],
  versions: [
    {
      id: "skill.tab.versions.walk-through-evolution",
      kind: "analysis",
      label: "Versions",
      prompt: "Walk me through how this skill evolved across its versions.",
    },
  ],
  files: [
    {
      id: "skill.tab.files.tour",
      kind: "analysis",
      label: "Files",
      prompt: "Give me a tour of this skill's files and what each one is for.",
    },
  ],
};

/** Run — read-only scope (`SCOPE_WRITE_TOOLS.run === []`) → analysis-only, per the plan's note. */
const RUN_STARTERS: readonly AssistantStarter[] = [
  {
    id: "run.summarize-this-run",
    kind: "analysis",
    label: "Summarize this run",
    prompt: "Analyze this run and summarize what happened.",
  },
  {
    id: "run.most-expensive-turns",
    kind: "analysis",
    label: "Most expensive turns",
    prompt: "Break down which turns and tool calls consumed the most tokens.",
  },
];

const SUITE_RUN_STARTERS: readonly AssistantStarter[] = [
  {
    id: "suite_run.summarize-the-matrix",
    kind: "analysis",
    label: "Summarize the matrix",
    prompt: "Analyze this suite run and summarize the aggregate outcome across its test matrix.",
  },
  {
    id: "suite_run.biggest-failure-buckets",
    kind: "analysis",
    label: "Biggest failure buckets",
    prompt: "Which tests or environments failed most in this suite run, and why?",
  },
];

const COMPARE_STARTERS: readonly AssistantStarter[] = [
  {
    id: "compare.explain-the-differences",
    kind: "analysis",
    label: "Explain the differences",
    prompt: "Explain the key differences in this comparison and why they matter.",
  },
  {
    id: "compare.what-drove-cost-up",
    kind: "analysis",
    label: "What drove cost up?",
    prompt: "Which changes increased tokens or cost the most here?",
  },
  {
    id: "compare.recommend-a-verdict",
    kind: "analysis",
    label: "Recommend a verdict",
    prompt: "Weigh the differences and recommend a verdict with evidence.",
  },
];

const COLLECTION_STARTERS: readonly AssistantStarter[] = [
  {
    id: "collection.what-does-this-cover",
    kind: "analysis",
    label: "What does this cover?",
    prompt: "Summarize this collection's tests and what they exercise.",
  },
  {
    id: "collection.coverage-gaps",
    kind: "analysis",
    label: "Coverage gaps",
    prompt:
      "Identify gaps in this collection — tests without expectations or graders, or capabilities not covered.",
  },
  {
    id: "collection.organize",
    kind: "action",
    label: "Organize",
    prompt: "Help me organize this collection — rename, regroup, or adjust membership.",
    writeTool: "collections_modify",
  },
];

const COMPATIBILITY_STARTERS: readonly AssistantStarter[] = [
  {
    id: "compatibility.explain-failures",
    kind: "analysis",
    label: "Explain failures",
    prompt:
      "Explain the compatibility failures shown here — which models have issues and the root causes.",
  },
  {
    id: "compatibility.best-model",
    kind: "analysis",
    label: "Best model",
    prompt: "Recommend the best model(s) for this server's tools based on these results.",
  },
];

/** `agents` — the Hub's Agents & Crews surface (`/assistant/agents*`, assistant-operability WP 2.1,
 *  D-AO3). Analysis-only, no `writeTool`: mirrors the `compatibility` precedent — a route-keyed
 *  surface, not an {@link AssistantEntityKind}, so there is no `SCOPE_WRITE_TOOLS` entry to scope a
 *  write against. */
const AGENTS_STARTERS: readonly AssistantStarter[] = [
  {
    id: "agents.rank-by-cost",
    kind: "analysis",
    label: "Rank by cost",
    prompt: "Rank my agents by token & cost this month",
  },
  {
    id: "agents.summarize-crew-usage",
    kind: "analysis",
    label: "Summarize crew usage",
    prompt: "Summarize how my crews have been used recently",
  },
  {
    id: "agents.compare-two-agents",
    kind: "analysis",
    label: "Compare two agents",
    prompt: "Compare two agents' setup (model, tools, skills) & typical cost",
  },
  {
    id: "agents.find-stale-agents",
    kind: "analysis",
    label: "Find stale agents",
    prompt: "Which agents/crews haven't been used lately and could be archived?",
  },
  {
    id: "agents.draft-a-new-agent",
    kind: "analysis",
    label: "Draft a new agent",
    prompt: "Help me draft a new agent for <role>",
  },
];

/** `hub` — the rest of the Hub (`/assistant`, `/assistant/sessions`, `/assistant/projects`,
 *  `/assistant/audit`; assistant-operability WP 2.1, D-AO3). Analysis-only, no `writeTool` — same
 *  route-keyed, non-entity-kind precedent as {@link AGENTS_STARTERS} / `compatibility`. */
const HUB_STARTERS: readonly AssistantStarter[] = [
  {
    id: "hub.recent-sessions",
    kind: "analysis",
    label: "Recent sessions",
    prompt: "Summarize my recent assistant sessions",
  },
  {
    id: "hub.find-sessions-about-topic",
    kind: "analysis",
    label: "Find sessions about a topic",
    prompt: "Find my sessions about <topic>",
  },
  {
    id: "hub.spend-breakdown",
    kind: "analysis",
    label: "Spend breakdown",
    prompt: "Break down my assistant spend this week by model & mode.",
  },
];

/** Environment (wire name `scenario` — see `ASSISTANT_ENTITY_KINDS`'s doc, Testing-IA rename is
 *  UI-label-only). This is where test/environment write starters belong (in scope per D-AS29) —
 *  never on a run/skill page. */
const SCENARIO_STARTERS: readonly AssistantStarter[] = [
  {
    id: "scenario.draft-a-test-from-a-failed-run",
    kind: "action",
    label: "Draft a test from a failed run",
    prompt: "Draft a regression test for this environment based on a recent failed run.",
    writeTool: "tests_create",
  },
  {
    id: "scenario.set-up-a-skill",
    kind: "action",
    label: "Set up a skill",
    prompt: "Attach a skill to this environment and configure it.",
    writeTool: "environments_attach_skill",
  },
  {
    id: "scenario.tune-the-setup",
    kind: "action",
    label: "Tune the setup",
    prompt: "Review this environment's system prompt, tools, and model and suggest improvements.",
    writeTool: "environments_update",
  },
  {
    id: "scenario.explain-this-environment",
    kind: "analysis",
    label: "Explain this environment",
    prompt: "Explain how this environment is configured and what it exercises.",
  },
];

/** `test` has no authored base starters (the plan's catalog never gives the `test` surface its own
 *  section — test/environment writes belong on the Environment page, see {@link SCENARIO_STARTERS}). */
const TEST_STARTERS: readonly AssistantStarter[] = [];

/**
 * The complete base catalog, one entry per {@link AssistantStarterSurface}. `[?cond]` conditionals are
 * NOT included here (see the module banner) — `apps/api/src/assistant/starters.ts`'s `deriveStarters`
 * prepends the ones authored below as their own named exports once their data condition holds.
 */
export const ASSISTANT_STARTER_CATALOG: Readonly<
  Record<AssistantStarterSurface, readonly AssistantStarter[]>
> = {
  global: GLOBAL_STARTERS,
  compatibility: COMPATIBILITY_STARTERS,
  hub: HUB_STARTERS,
  agents: AGENTS_STARTERS,
  run: RUN_STARTERS,
  scenario: SCENARIO_STARTERS,
  skill: SKILL_STARTERS,
  scan: SCAN_STARTERS,
  server: SERVER_STARTERS,
  test: TEST_STARTERS,
  collection: COLLECTION_STARTERS,
  suite_run: SUITE_RUN_STARTERS,
  compare: COMPARE_STARTERS,
};

/**
 * Look up ONE base-catalog starter by id within a surface — for a consumer that wants a single named
 * entry from a surface's {@link ASSISTANT_STARTER_CATALOG} set rather than the whole array. Intended
 * for a page-hook prompt builder (see {@link buildSkillAnalyzeRecentRunsPrompt} /
 * {@link buildCompareExplainDifferencesPrompt} below) that wants to fold its own prompt text into this
 * catalog so the wording lives in exactly one place, for the cases where the builder's intent matches
 * an existing base starter closely enough to just reuse its prompt verbatim.
 * Throws on an unknown id — a programming error (a stale/typoed id after a catalog rename), never a
 * runtime condition a caller should handle gracefully.
 */
export function getBaseStarter(surface: AssistantStarterSurface, id: string): AssistantStarter {
  const starter = ASSISTANT_STARTER_CATALOG[surface].find((entry) => entry.id === id);
  if (!starter) throw new Error(`unknown base starter id "${id}" for surface "${surface}"`);
  return starter;
}

// ── Conditional (`[?cond]`) starters — authored once here, fired by `deriveStarters` only when the ──
// entity's live data supports them (D-AS28: "conditionals fire only when the entity's state supports
// them"). Every one of these is read-only (`kind: "analysis"`) EXCEPT the two skill conditionals,
// which commit through the same gated `skills_commit_workspace` write as every other skill edit.

/** Global `[?any server's latest scan failed]`. `failedServerCount` is a plain count the API service
 *  already computed from a cheap read (`servers.list()` + a status-only latest-scan summary per
 *  server) — the only "dynamic" text in the catalog, still fully deterministic (D-AS28). */
export function buildGlobalDebugFailedScansStarter(failedServerCount: number): AssistantStarter {
  const subject = failedServerCount === 1 ? "1 server's" : `${failedServerCount} servers'`;
  return {
    id: "global.debug-failed-scans",
    kind: "analysis",
    label: "Debug failed scans",
    prompt: `${subject} most recent scan failed. Investigate each and explain the likely cause.`,
  };
}

/** Global `[?recent run pass-rate low]`. */
export const GLOBAL_WHY_ARE_RUNS_FAILING_STARTER: AssistantStarter = {
  id: "global.why-are-runs-failing",
  kind: "analysis",
  label: "Why are runs failing?",
  prompt: "Investigate the recent drop in run pass rate and identify the common root causes.",
};

/** Server `[?last scan failed]`. */
export const SERVER_DEBUG_FAILED_SCAN_STARTER: AssistantStarter = {
  id: "server.debug-the-failed-scan",
  kind: "analysis",
  label: "Debug the failed scan",
  prompt:
    "The most recent scan of this server failed. Investigate the failure and explain what prevented it from completing.",
};

/** Scan `[?scan failed]`. */
export const SCAN_WHY_DID_IT_FAIL_STARTER: AssistantStarter = {
  id: "scan.why-did-it-fail",
  kind: "analysis",
  label: "Why did it fail?",
  prompt: "Explain why this scan failed.",
};

/** Skill `[?quality score low]` — SKIPPED by `deriveStarters` (see its module banner): the quality
 *  score needs the full `analyzeSkillQuality` pipeline (SKILL.md parse + graph projection + async
 *  L1/L2 token counting), which is not a cheap per-request read. Authored here so the wording is
 *  ready the moment a cheap quality-score cache exists. */
export const SKILL_FIX_QUALITY_FINDINGS_STARTER: AssistantStarter = {
  id: "skill.fix-quality-findings",
  kind: "action",
  label: "Fix quality findings",
  prompt: "Fix the top quality findings for this skill and show me the changes.",
  writeTool: "skills_commit_workspace",
};

/** Skill `[?L2 over budget]`. */
export const SKILL_SPLIT_OVERSIZED_BODY_STARTER: AssistantStarter = {
  id: "skill.split-oversized-body",
  kind: "action",
  label: "Split oversized body",
  prompt:
    "This skill's body is over the L2 budget — split the largest section into a reference file and show the diff.",
  writeTool: "skills_commit_workspace",
};

/** Run `[?failed/errored]`. */
export const RUN_WHY_DID_THIS_FAIL_STARTER: AssistantStarter = {
  id: "run.why-did-this-fail",
  kind: "analysis",
  label: "Why did this fail?",
  prompt:
    "This run did not finish successfully. Investigate what happened and explain the root cause.",
};

/** Run `[?context_overflow]`. */
export const RUN_EXPLAIN_THE_OVERFLOW_STARTER: AssistantStarter = {
  id: "run.explain-the-overflow",
  kind: "analysis",
  label: "Explain the overflow",
  prompt: "Explain what caused the context overflow and how to avoid it.",
};

/** Run `[?assertions_failed]`. */
export const RUN_WHICH_EXPECTATIONS_FAILED_STARTER: AssistantStarter = {
  id: "run.which-expectations-failed",
  kind: "analysis",
  label: "Which expectations failed?",
  prompt: "List the expectations that failed and explain why.",
};

/** Suite run `[?pass-rate low]`. */
export const SUITE_RUN_INVESTIGATE_FAILURES_STARTER: AssistantStarter = {
  id: "suite_run.investigate-the-failures",
  kind: "analysis",
  label: "Investigate the failures",
  prompt: "Investigate the failures dragging down this suite run's pass rate.",
};

/** One `[?cond]` conditional starter tagged with the surface it belongs to. */
export type AssistantConditionalStarterEntry = {
  surface: AssistantStarterSurface;
  starter: AssistantStarter;
};

/**
 * THE single registry of EVERY data-aware conditional (`[?cond]`) starter, each tagged with its
 * surface. This is the source of truth both sides consume so a new conditional can never escape the
 * D-AS29 scope guard (FIX 1):
 *   - the API service (`apps/api/src/assistant/starters.ts` `deriveStarters`) emits its conditionals
 *     by LOOKING THEM UP HERE (never via a loose named import), so a conditional it can emit is
 *     necessarily in this list;
 *   - the catalog cross-check (`apps/api/test/assistant-starters-catalog.test.ts`) walks this list and
 *     asserts every `kind:"action"` entry's `writeTool` ∈ `SCOPE_WRITE_TOOLS[surface]` and ∉
 *     `INTENTIONALLY_UNSCOPED_WRITE_TOOLS`.
 * Adding a new conditional action starter therefore auto-covers it: it must appear here to be
 * emittable, and appearing here makes the test enforce its scope. The global "debug failed scans"
 * entry uses a representative instance (count = 1) because its only variable is a plain count; the
 * service re-derives the count-interpolated prompt from {@link buildGlobalDebugFailedScansStarter}
 * over this entry's stable id/label/kind (see the service). `skill.fix-quality-findings` is listed
 * even though the service currently SKIPS emitting it (the quality-score read isn't cheap — see its
 * doc above): it is still an authored conditional action starter and must be scope-checked.
 */
export const ASSISTANT_CONDITIONAL_STARTERS: readonly AssistantConditionalStarterEntry[] = [
  { surface: "global", starter: buildGlobalDebugFailedScansStarter(1) },
  { surface: "global", starter: GLOBAL_WHY_ARE_RUNS_FAILING_STARTER },
  { surface: "server", starter: SERVER_DEBUG_FAILED_SCAN_STARTER },
  { surface: "scan", starter: SCAN_WHY_DID_IT_FAIL_STARTER },
  { surface: "skill", starter: SKILL_FIX_QUALITY_FINDINGS_STARTER },
  { surface: "skill", starter: SKILL_SPLIT_OVERSIZED_BODY_STARTER },
  { surface: "run", starter: RUN_WHY_DID_THIS_FAIL_STARTER },
  { surface: "run", starter: RUN_EXPLAIN_THE_OVERFLOW_STARTER },
  { surface: "run", starter: RUN_WHICH_EXPECTATIONS_FAILED_STARTER },
  { surface: "suite_run", starter: SUITE_RUN_INVESTIGATE_FAILURES_STARTER },
];

// ── Page-hook-only prompts (WP R3.2 D-AS28 fold) ─────────────────────────────────────────────────────
// Originally authored to back 7 web "Analyze…" page-hook buttons (one per feature) so their wording
// lived in exactly one place (see the R3 plan's "web render" note). Most of the 7 mapped straight onto
// an existing base/conditional starter above (via {@link getBaseStarter} or a named conditional export)
// because their intent was identical to that starter's, so those call sites needed no dedicated builder
// function. These two did NOT: each carries real, entity-specific content its closest catalog analogue
// doesn't (and can't, since a base/conditional starter's prompt is deliberately generic — the envelope
// already carries the pinned entity's id, see the module banner) — so the exact wording lives here as a
// small parameterized builder instead of a static entry, per the R3.2 brief's explicit fallback: "keep
// the builder's wording but move that exact string INTO the shared catalog as the authoritative
// source." The two page-hook buttons that originally called these builders have since been removed by
// later UI passes (the skill inspector's "Analyze recent runs" header action explicitly under the
// toolbar standard, D-TB3 — see the note near `useAssistant()` in
// `apps/web/src/features/skills/SkillInspector.tsx`; no equivalent button exists in the current Compare
// Workspace either). These two functions remain THIS module's authoritative wording of record — dormant
// until/unless an equivalent page hook is reintroduced; cite this module (not a web `*-analyze.ts` file
// — none exists) as the mechanism.

/**
 * Skill — wording for a (currently retired) "Analyze recent runs" page-hook button on the skill
 * inspector. Deliberately NOT part of {@link SKILL_STARTERS} / the dock's rendered chip set: its
 * closest catalog analogue, `skill.improve-from-recent-runs`, is a `kind: "action"` starter that
 * proposes an EDIT (`writeTool: "skills_commit_workspace"`), while this builder is analysis-only
 * ("find avoidable issues", no edit proposed) — folding it onto that starter would silently turn a
 * read-only prompt into one that solicits a gated write, changing its intent. `skillName` mirrors the
 * retired button's behavior: the skill's name when known (quoted), else the generic "this skill".
 */
export function buildSkillAnalyzeRecentRunsPrompt(skillName: string): string {
  const trimmed = skillName.trim();
  const reference = trimmed.length > 0 ? `"${trimmed}"` : "this skill";
  return `Analyze the recent test runs that use ${reference} and find avoidable issues.`;
}

/**
 * Compare — wording for a (currently retired) "Explain this diff" page-hook button on the Compare
 * Workspace. Deliberately NOT part of {@link COMPARE_STARTERS}: its closest analogue,
 * `compare.explain-the-differences`, is generic text ("this comparison") because the `compare`
 * surface's entity pin only ever carries the PRIMARY run id (`resolveEntityPin` in
 * `apps/web/src/features/assistant/assistant-context.tsx` — a compare view names no single entity by
 * design). This builder enumerates EVERY compared run id in the prompt text itself, which is
 * otherwise-unavailable context the agent needs (not mere personalization) — folding it onto the
 * generic starter would silently drop which runs are being compared.
 */
export function buildCompareExplainDifferencesPrompt(allRunIds: readonly string[]): string {
  const idList = allRunIds.join(", ");
  return `Explain the key differences in the comparison between runs ${idList}. Highlight what changed and why it matters.`;
}

// ── Hub page-hook prompts (assistant-operability WP 3.2, D-AO5) ─────────────────────────────────────
// Back the "Ask the assistant" header action on the Hub's Workforce surfaces — the agent-profile modal
// (`apps/web/src/features/hub/workforce/agent-profile/AgentProfileModal.tsx`) and the crew-profile
// modal (`.../crew-profile/CrewProfileModal.tsx`). Each is rendered ONLY while
// `assistant.authConfigured` (hidden entirely otherwise — the same gate `IssueAssistantMount` and
// `SkillInspector`'s "Fix with assistant" use) and calls `openAssistant({ prompt })`, which only ever
// PREFILLS the dock composer — nothing is auto-sent. Deliberately analysis-only (no `writeTool`
// solicited): D-AO5 keeps the dock's Hub surfaces "page-operation-flavored" ("summarize *this* page's
// usage"), not "answer anything", and mirrors the `AGENTS_STARTERS`/`HUB_STARTERS` chips' own
// analysis-only wording just above. Each carries the entity's live NAME so the agent/crew is
// unambiguous from the first sentence (the `agents` surface's own envelope carries no entity pin — see
// `resolveEntityPin`'s doc — so the generic chip wording alone can't say WHICH agent/crew), the same
// reason {@link buildCompareExplainDifferencesPrompt} above embeds its run ids explicitly. These are
// deliberately NOT wired into the Workforce view's `ViewToolbar` `actions` slot — that slot is
// permanently off-limits to assistant hooks (D-TB3, `apps/web/src/components/ViewToolbar.tsx`'s own
// doc: "actions is NEVER an assistant 'Analyze…'/'Explain…' hook"); the two profile modals are their
// own `WideDialog`, not a page's one-row toolbar, so D-TB3 doesn't reach them (same precedent as
// `CrewProfileModal`'s existing "Instantiate" header action).

/**
 * Agent — wording for the agent-profile modal's "Ask the assistant" header action. `agentName` mirrors
 * {@link buildSkillAnalyzeRecentRunsPrompt}'s guard: the agent's display name when known (quoted), else
 * the generic "this agent" (a brand-new, not-yet-saved agent has no name to quote).
 */
export function buildHubAgentAnalyzePrompt(agentName: string): string {
  const trimmed = agentName.trim();
  const reference = trimmed.length > 0 ? `"${trimmed}"` : "this agent";
  return `Analyze the agent ${reference}: its setup (model, tools, skills) and recent usage & cost, and suggest what to tune or whether it's a candidate to archive.`;
}

/**
 * Crew — wording for the crew-profile modal's "Ask the assistant" header action. `crewName` guarded
 * the same way as {@link buildHubAgentAnalyzePrompt}.
 */
export function buildHubCrewAnalyzePrompt(crewName: string): string {
  const trimmed = crewName.trim();
  const reference = trimmed.length > 0 ? `"${trimmed}"` : "this crew";
  return `Analyze the crew ${reference}: its topology, members, and recent usage & cost, and suggest what to tune or whether it's a candidate to archive.`;
}

/**
 * Workforce — a Directory-header-level "rank my agents by cost & flag stale/unused ones" ask (no
 * single entity to scope to, so no argument). Folds the intent of the `AGENTS_STARTERS` chips
 * `agents.rank-by-cost` + `agents.find-stale-agents` into one combined sentence rather than reusing
 * either verbatim via {@link getBaseStarter} (it merges two chips' intent, not one). Authored per the
 * WP 3.2 brief; NOT currently wired to a UI hook (see the module banner above this section — the
 * Workforce view's only header surface is its `ViewToolbar`, which D-TB3 places off-limits to
 * assistant hooks). Kept as this module's authoritative wording of record, the same
 * authored-but-dormant precedent as {@link buildSkillAnalyzeRecentRunsPrompt} /
 * {@link buildCompareExplainDifferencesPrompt} above, in case a non-toolbar Workforce-level surface
 * (e.g. inside the Directory tab body) adopts it later.
 */
export function buildHubWorkforceOverviewPrompt(): string {
  return "Rank my agents by token & cost this month, and flag any that look stale or unused and could be archived.";
}

// ── Surface resolution ────────────────────────────────────────────────────────────────────────────

/** Route prefixes/exact paths that resolve to the `compare` surface even though the web app never
 *  pins a `compare` entity (see `apps/web/src/features/assistant/assistant-context.tsx`'s
 *  `resolveEntityPin` doc — a compare view's URL inherently names no single entity id, by design).
 *  Includes both canonical routes and their redirect sources (`App.tsx`), normalized (no trailing
 *  slash) before comparison. */
const COMPARE_ROUTES: ReadonlySet<string> = new Set([
  "/compare/scans",
  "/compare",
  "/testing/runs/compare",
  "/testing/compare",
]);

const COMPATIBILITY_ROUTE = "/testing/compatibility";

/** Exact hub routes (assistant-operability WP 2.1, D-AO3) that resolve to the `"hub"` surface —
 *  everything the Hub's full-page assistant owns EXCEPT Agents & Crews, which is its own `"agents"`
 *  surface (checked first — see {@link resolveStarterSurface}'s precedence doc). Mirrors
 *  {@link COMPARE_ROUTES}'s shape: a normalized (no trailing slash), exact-match set. */
const HUB_ROUTES: ReadonlySet<string> = new Set([
  "/assistant",
  "/assistant/sessions",
  "/assistant/projects",
  "/assistant/audit",
]);

/** The Agents & Crews route and its detail sub-routes (`/assistant/agents/agent/:id`,
 *  `/assistant/agents/crew/:id`) — matched by prefix, ahead of {@link HUB_ROUTES}, so a more specific
 *  hub sub-tree resolves to its own `"agents"` surface rather than the generic `"hub"` one. */
const AGENTS_ROUTE = "/assistant/agents";

function normalizeRoute(route: string): string {
  if (route.length > 1 && route.endsWith("/")) return route.slice(0, -1);
  return route;
}

function isAssistantEntityKind(value: string): value is AssistantEntityKind {
  return (ASSISTANT_ENTITY_KINDS as readonly string[]).includes(value);
}

/**
 * Resolve which {@link AssistantStarterSurface} a `GET /api/assistant/starters` request targets.
 * PURE — no I/O. Precedence:
 *   1. A valid, pinned `entityKind` wins outright (it IS the surface — every {@link AssistantEntityKind}
 *      is itself a member of {@link AssistantStarterSurface}).
 *   2. Else a `route` matching a known compare route (canonical or redirect-source) → `"compare"`.
 *   3. Else a `route` matching the compatibility route → `"compatibility"`.
 *   4. Else a `route` matching `/assistant/agents` (or a `/agent/:id` / `/crew/:id` sub-route) →
 *      `"agents"` — checked BEFORE the generic hub routes, since it's the more specific sub-tree.
 *   5. Else a `route` matching one of the other hub routes (`/assistant`, `/assistant/sessions`,
 *      `/assistant/projects`, `/assistant/audit`) → `"hub"`.
 *   6. Else `"global"` (unmatched route / no route at all — the dashboard / unpinned dock default).
 *
 * Deliberately does NOT map `/testing/environments` to `"scenario"` — that page holds its selection in
 * React state, not the URL (see the R1.1 pin-reconciliation doc), so there is no real per-entity pin
 * to key starters off yet; it falls through to `"global"` like any other unpinned route.
 */
export function resolveStarterSurface(input: {
  entityKind?: AssistantEntityKind | string;
  route?: string;
}): AssistantStarterSurface {
  const { entityKind, route } = input;
  if (entityKind !== undefined && isAssistantEntityKind(entityKind)) {
    return entityKind;
  }
  if (route !== undefined) {
    const normalized = normalizeRoute(route);
    if (COMPARE_ROUTES.has(normalized)) return "compare";
    if (normalized === COMPATIBILITY_ROUTE) return "compatibility";
    if (normalized === AGENTS_ROUTE || normalized.startsWith(`${AGENTS_ROUTE}/`)) return "agents";
    if (HUB_ROUTES.has(normalized)) return "hub";
  }
  return "global";
}
