import { z } from "zod";

// ==================================================================================================
// Assistant (WP 3.1) — the addressable-view registry (D-AS8 / D-AS16)
// ==================================================================================================
// The SAFETY BOUNDARY for agent-driven navigation: the ONLY app views the agent may ever send the
// owner's browser to, each with zod-validated params. Both sides of the app use THIS module — never
// a private copy:
//   - `apps/api/src/assistant/tools/ui-tools.ts` (the `ui_*` tool handlers) validates a tool call's
//     args against it BEFORE ever resolving a route; a bad view/params never produces a `ui_action`
//     event (a tool error instead — the browser is never told to navigate anywhere unregistered).
//   - `apps/web/src/features/assistant/assistant-context.tsx` (the client executor) re-resolves a
//     LIVE `ui_action` event against the exact same registry before calling `navigate()`, and
//     `AssistantUiActionChip.tsx` re-resolves a replayed one purely to render its label.
// A route/params pair that isn't in this registry can NEVER reach `navigate()` — that is the whole
// point of routing every resolution through one shared module instead of trusting the wire event.
//
// VERIFIED against the real route table (`apps/web/src/App.tsx`'s `<Routes>`) at WP 3.1 time, not
// assumed from the plan — two gaps found and handled honestly rather than silently "supported":
//   1. The run console had NO existing URL-level turn deep link (`console-anchors.ts`'s cross-pane
//      nav is in-memory React state, not query-string driven). WP 3.1 ADDED minimal `?turn=<index>`
//      support to `RunConsoleRoute.tsx`/`RunConsole.tsx` so this registry's "run" view is honestly
//      backed by real navigation, not a param that silently does nothing.
//   2. The skill inspector's tab (`SkillInspector.tsx`'s `tab` state) and version selection are
//      local React state, NOT URL-driven, and `apps/web/src/features/skills/` is out of scope for
//      this WP (owned by a parallel workstream). `tab`/`version` are still accepted here (and carried
//      onto `/skills/:id` as query params) for a forward-compatible, contract-first shape, but the
//      inspector does not yet read them from the URL — see the WP 3.1 handback for this known gap.
// Everything else (scan, server, suite run, the Compare Workspace's full `?ids&baseline&mode&focus`
// contract, settings) maps onto real, already-URL-driven routes/state — confirmed against
// `apps/web/src/features/testing/compare/useCompareState.ts` and `App.tsx`.

/** The allowlisted app views an agent may navigate to. Exhaustive — nothing outside this list. */
export const ASSISTANT_UI_VIEWS = [
  "run",
  "skill",
  "scan",
  "server",
  "suite_run",
  "compare",
  "settings",
] as const;
export type AssistantUiView = (typeof ASSISTANT_UI_VIEWS)[number];

export function isAssistantUiView(value: string): value is AssistantUiView {
  return (ASSISTANT_UI_VIEWS as readonly string[]).includes(value);
}

/**
 * The `ui_*` tool names (bare, `ui_` prefix stripped), matching the `action` values the frozen
 * `AssistantEvent`'s `ui_action` variant documents (`packages/shared/src/types.ts`). `navigate` is
 * the general-purpose escape valve (any view via `{ view, params }`); the other three are ergonomic,
 * explicit-arg wrappers over one "rich" view each — see `resolveAssistantUiAction`.
 */
export const ASSISTANT_UI_ACTIONS = [
  "navigate",
  "open_run_turn",
  "open_skill",
  "open_diff",
] as const;
export type AssistantUiAction = (typeof ASSISTANT_UI_ACTIONS)[number];

export function isAssistantUiAction(value: string): value is AssistantUiAction {
  return (ASSISTANT_UI_ACTIONS as readonly string[]).includes(value);
}

/**
 * Mirrors `apps/web/src/features/skills/SkillInspector.tsx`'s tab strip (`design`/`trace` fold into
 * `files` there). Duplicated here — not imported — because `packages/shared` may never import an
 * `apps/web` feature module (architecture.md: `shared -> web` is forbidden); keep in sync by hand.
 * See the module banner's gap #2: not yet URL-consumed by the inspector.
 */
export const ASSISTANT_UI_SKILL_TABS = ["overview", "files", "usage", "versions", "diff"] as const;
export type AssistantUiSkillTab = (typeof ASSISTANT_UI_SKILL_TABS)[number];

/**
 * Mirrors `apps/web/src/features/testing/compare/compare-runs.ts` (`COMPARE_MODES`/
 * `MAX_COMPARE_RUNS`) — duplicated for the same `shared -> web` boundary reason as the skill tabs
 * above. `MAX_COMPARE_RUNS` there is `COMPARE_LETTERS.length` (6, the letter-chip alphabet's size).
 */
export const ASSISTANT_UI_COMPARE_MODES = ["summary", "flow", "metrics", "suite"] as const;
export type AssistantUiCompareMode = (typeof ASSISTANT_UI_COMPARE_MODES)[number];
export const ASSISTANT_UI_MAX_COMPARE_RUNS = 6;

// ── Per-view param shapes ───────────────────────────────────────────────────────────────────────
// Plain `ZodRawShape` objects (not `z.object(...)`) so `apps/api/src/assistant/tools/ui-tools.ts` can
// spread individual fields directly into the Agent SDK's `tool(name, description, ZodRawShape, …)`
// third argument without re-declaring the field.

export const assistantUiRunParamsShape = {
  runId: z.string().min(1),
  /** 0-based, matching `TimelineAssistantTurn.turnIndex` / `console-anchors.ts`'s `turnAnchorValue`. */
  turnIndex: z.number().int().nonnegative().optional(),
};
export const assistantUiSkillParamsShape = {
  skillId: z.string().min(1),
  tab: z.enum(ASSISTANT_UI_SKILL_TABS).optional(),
  version: z.string().min(1).optional(),
};
export const assistantUiScanParamsShape = { scanId: z.string().min(1) };
export const assistantUiServerParamsShape = { serverId: z.string().min(1) };
export const assistantUiSuiteRunParamsShape = { suiteRunId: z.string().min(1) };
export const assistantUiCompareParamsShape = {
  ids: z.array(z.string().min(1)).min(1).max(ASSISTANT_UI_MAX_COMPARE_RUNS),
  baseline: z.string().min(1).optional(),
  mode: z.enum(ASSISTANT_UI_COMPARE_MODES).optional(),
  focus: z.string().min(1).optional(),
};
export const assistantUiSettingsParamsShape = {};

const runSchema = z.object(assistantUiRunParamsShape);
const skillSchema = z.object(assistantUiSkillParamsShape);
const scanSchema = z.object(assistantUiScanParamsShape);
const serverSchema = z.object(assistantUiServerParamsShape);
const suiteRunSchema = z.object(assistantUiSuiteRunParamsShape);
const compareSchema = z.object(assistantUiCompareParamsShape);
const settingsSchema = z.object(assistantUiSettingsParamsShape).strict();

/** The `ui_navigate` tool's own args: an allowlisted view name + that view's (loosely-typed here,
 *  STRICTLY re-validated by {@link resolveAssistantUiView}) params bag. */
const navigateArgsSchema = z.object({
  view: z.enum(ASSISTANT_UI_VIEWS),
  params: z.record(z.unknown()).optional(),
});

/** One resolved, SAFE navigation target — everything `navigate()` / the inert chip need. */
export type AssistantUiTarget = {
  view: AssistantUiView;
  /** The concrete, always-relative, always-same-app route (+ query string) to navigate to. Never
   *  absolute/external — every builder below only ever composes a `/…` path. */
  route: string;
  /** A short, human-readable label for the inert replay chip. */
  label: string;
  /** The validated, view-shaped params (echoes back what was resolved, defaults applied). */
  params: Record<string, unknown>;
};

export type AssistantUiResolution =
  | { ok: true; target: AssistantUiTarget }
  | { ok: false; error: string };

function ok(
  view: AssistantUiView,
  route: string,
  label: string,
  params: Record<string, unknown>,
): AssistantUiResolution {
  return { ok: true, target: { view, route, label, params } };
}

function invalid(view: string, error: z.ZodError): AssistantUiResolution {
  const detail = error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
  return { ok: false, error: `Invalid params for view "${view}": ${detail}` };
}

/** Truncate an opaque id for a compact, still-identifying chip label. */
function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 10)}…` : id;
}

/**
 * Validate `rawParams` against `view`'s schema and resolve the concrete route + label. THE safety
 * choke point (see the module banner) — every `ui_*` tool and the client executor/chip call this (or
 * {@link resolveAssistantUiAction}, which delegates here) rather than building a route by hand.
 */
export function resolveAssistantUiView(view: string, rawParams: unknown): AssistantUiResolution {
  if (!isAssistantUiView(view)) {
    return { ok: false, error: `Unknown view "${view}" — not in the addressable-view registry.` };
  }
  switch (view) {
    case "run": {
      const parsed = runSchema.safeParse(rawParams);
      if (!parsed.success) return invalid(view, parsed.error);
      const { runId, turnIndex } = parsed.data;
      const query = turnIndex !== undefined ? `?turn=${turnIndex}` : "";
      const label =
        turnIndex !== undefined
          ? `Run console — ${shortId(runId)}, turn ${turnIndex + 1}`
          : `Run console — ${shortId(runId)}`;
      return ok(view, `/testing/runs/${encodeURIComponent(runId)}${query}`, label, parsed.data);
    }
    case "skill": {
      const parsed = skillSchema.safeParse(rawParams);
      if (!parsed.success) return invalid(view, parsed.error);
      const { skillId, tab, version } = parsed.data;
      const qs = new URLSearchParams();
      if (tab) qs.set("tab", tab);
      if (version) qs.set("version", version);
      const query = qs.toString();
      const label = `Skill inspector — ${shortId(skillId)}${tab ? ` (${tab})` : ""}`;
      return ok(
        view,
        `/skills/${encodeURIComponent(skillId)}${query ? `?${query}` : ""}`,
        label,
        parsed.data,
      );
    }
    case "scan": {
      const parsed = scanSchema.safeParse(rawParams);
      if (!parsed.success) return invalid(view, parsed.error);
      const { scanId } = parsed.data;
      return ok(
        view,
        `/scans/${encodeURIComponent(scanId)}`,
        `Scan detail — ${shortId(scanId)}`,
        parsed.data,
      );
    }
    case "server": {
      const parsed = serverSchema.safeParse(rawParams);
      if (!parsed.success) return invalid(view, parsed.error);
      const { serverId } = parsed.data;
      return ok(
        view,
        `/servers/${encodeURIComponent(serverId)}`,
        `Server detail — ${shortId(serverId)}`,
        parsed.data,
      );
    }
    case "suite_run": {
      const parsed = suiteRunSchema.safeParse(rawParams);
      if (!parsed.success) return invalid(view, parsed.error);
      const { suiteRunId } = parsed.data;
      return ok(
        view,
        `/testing/suite-runs/${encodeURIComponent(suiteRunId)}`,
        `Suite run — ${shortId(suiteRunId)}`,
        parsed.data,
      );
    }
    case "compare": {
      const parsed = compareSchema.safeParse(rawParams);
      if (!parsed.success) return invalid(view, parsed.error);
      const { ids, baseline, mode, focus } = parsed.data;
      const qs = new URLSearchParams();
      qs.set("ids", ids.join(","));
      if (baseline) qs.set("baseline", baseline);
      if (mode) qs.set("mode", mode);
      if (focus) qs.set("focus", focus);
      const label = `Compare workspace — ${ids.length} run${ids.length === 1 ? "" : "s"}`;
      return ok(view, `/testing/runs/compare?${qs.toString()}`, label, parsed.data);
    }
    case "settings": {
      const parsed = settingsSchema.safeParse(rawParams);
      if (!parsed.success) return invalid(view, parsed.error);
      return ok(view, "/settings", "Settings", parsed.data);
    }
  }
}

/**
 * Resolve one of the four `ui_*` tools' raw args (see {@link ASSISTANT_UI_ACTIONS}) onto a concrete
 * navigation target, via {@link resolveAssistantUiView}. `action` is exactly the value the frozen
 * `AssistantEvent`'s `ui_action.action` field carries; `rawParams` is exactly that event's `params`
 * (== the tool's own args) — so this same function resolves a tool call BEFORE the event is emitted
 * (API side) and a settled event AFTER it was persisted (web side), with identical results.
 */
export function resolveAssistantUiAction(
  action: string,
  rawParams: unknown,
): AssistantUiResolution {
  if (!isAssistantUiAction(action)) {
    return { ok: false, error: `Unknown assistant UI action "${action}".` };
  }
  switch (action) {
    case "navigate": {
      const parsed = navigateArgsSchema.safeParse(rawParams);
      if (!parsed.success) return invalid("navigate", parsed.error);
      return resolveAssistantUiView(parsed.data.view, parsed.data.params ?? {});
    }
    case "open_run_turn":
      return resolveAssistantUiView("run", rawParams);
    case "open_skill":
      return resolveAssistantUiView("skill", rawParams);
    case "open_diff":
      return resolveAssistantUiView("compare", rawParams);
  }
}
