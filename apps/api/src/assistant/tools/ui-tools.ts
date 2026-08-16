// Assistant (WP 3.1) — the `ui_*` navigation-ONLY tool definitions (D-AS8/D-AS16). Kept in their OWN
// file (not `./index.ts`, which WP 2.2 also touches in parallel) so the two WPs' tool arrays merge
// with a single clearly-commented import + spread — see `./index.ts`'s `buildAssistantToolDefinitions`.
//
// HARD RULE: every tool here is navigation-ONLY. It must never read a secret, never write/mutate app
// data, and never do anything besides resolve + report a target the client then navigates to. This is
// load-bearing: `permission-classifier.ts` AUTO-ALLOWS any `ui_`-prefixed tool (the `ui` band, checked
// AFTER the delete-verb guard so a hypothetical `ui_delete_*` still always asks) — if a `ui_*` tool
// ever mutated something, that mutation would run with NO approval round-trip. None of these tools
// accept anything but ROUTE PARAMETERS (ids, an optional turn/tab/version/mode/focus), and none of
// them touch a repository — they only call {@link resolveAssistantUiAction} (the shared
// addressable-view registry, `packages/shared/src/assistant-ui-registry.ts`), which is pure route
// resolution over static, already-public-shaped data (ids the agent itself was given by the READ
// toolset). A bad view/params fails registry validation and the tool returns an `isError` result —
// **no `ui_action` event is ever emitted for a call that didn't resolve** (see `session-manager.ts`'s
// `pump()`: it only looks for a `ui_action` payload on a SUCCESSFUL, non-error tool result), so the
// browser can never be told to navigate anywhere the registry didn't approve.
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  ASSISTANT_UI_VIEWS,
  assistantUiCompareParamsShape,
  assistantUiRunParamsShape,
  assistantUiSkillParamsShape,
  resolveAssistantUiAction,
} from "@mcp-token-footprint/shared";
import { z } from "zod";
import { errorResult, jsonResult, safeTool } from "./util.js";

/**
 * The bare names of every tool this module registers — imported by `assistant-tools.test.ts`'s
 * inventory-sanity gate test (mirrors `read-tool-names.ts`'s role for the WP 1.2 read toolset) and by
 * `./index.ts`'s single spread point. Kept as a literal array (not derived from the tool definitions)
 * so a rename here is a visible two-place diff, not a silent drift.
 */
export const ASSISTANT_UI_TOOL_NAMES = [
  "ui_navigate",
  "ui_open_run_turn",
  "ui_open_skill",
  "ui_open_diff",
] as const;

/**
 * Resolve `action`'s raw args against the shared registry and shape the tool's `CallToolResult`. On
 * success the JSON payload is `{ action, route, label, params }` where **`params` is the RAW args this
 * call was made with** (not the resolved view params). This matters: `session-manager.ts`'s `pump()`
 * relays exactly the `{ action, params }` pair onto the persisted `ui_action` event, and the client
 * (`assistant-context.tsx` / `AssistantUiActionChip.tsx`) re-derives the route/label by calling the
 * SAME pure `resolveAssistantUiAction(action, params)` — so it MUST receive the same args the server
 * resolved. Echoing `target.params` (e.g. `{ scanId }` for `navigate`) would fail that re-resolution
 * (`navigate` needs `{ view, params }`), silently breaking client navigation. `route`/`label` are
 * included for the agent's own visibility but are NOT part of the wire event.
 */
function uiResult(action: string, rawParams: unknown): CallToolResult {
  const resolution = resolveAssistantUiAction(action, rawParams);
  if (!resolution.ok) return errorResult(resolution.error);
  const { target } = resolution;
  return jsonResult({ action, route: target.route, label: target.label, params: rawParams });
}

/** Build the `ui_*` tool definitions. Exported separately from any `createSdkMcpServer` wrapping
 *  (mirrors `./index.ts`'s `buildAssistantToolDefinitions`) so tests call `.handler(args, {})`
 *  directly — no SDK session, no MCP round-trip. */
export function buildUiToolDefinitions() {
  return [
    tool(
      "ui_navigate",
      "Navigate the owner's browser to an allowlisted app view: run (the run console), skill (the " +
        "Skills inspector), scan (scan detail), server (server detail), suite_run, compare (the Compare " +
        "Workspace), or settings. Only a registered view/params combination ever resolves — anything " +
        "else returns an error and the browser never moves. Prefer the more specific " +
        "ui_open_run_turn / ui_open_skill / ui_open_diff tools when they fit; this is the general " +
        "fallback for scan/server/suite_run/settings and for a plain run/skill/compare open with no " +
        "extra anchor.",
      {
        view: z.enum(ASSISTANT_UI_VIEWS).describe("The allowlisted view to open."),
        params: z
          .record(z.unknown())
          .optional()
          .describe(
            'The view\'s params, e.g. { runId } for "run", { scanId } for "scan", ' +
              '{ serverId } for "server", { suiteRunId } for "suite_run", or {} for "settings".',
          ),
      },
      async (args) => safeTool(() => uiResult("navigate", args)),
    ),

    tool(
      "ui_open_run_turn",
      "Open a test run in the run console, scrolled and focused to one turn in the chat. `turnIndex` " +
        "is 0-based (turn 1 shown in the UI is turnIndex 0).",
      {
        runId: assistantUiRunParamsShape.runId,
        turnIndex: z.number().int().nonnegative(),
      },
      async (args) => safeTool(() => uiResult("open_run_turn", args)),
    ),

    tool(
      "ui_open_skill",
      "Open a skill in the Skills inspector, optionally to one tab (overview, files, usage, versions, " +
        "diff) and/or one version id.",
      {
        skillId: assistantUiSkillParamsShape.skillId,
        tab: assistantUiSkillParamsShape.tab,
        version: assistantUiSkillParamsShape.version,
      },
      async (args) => safeTool(() => uiResult("open_skill", args)),
    ),

    tool(
      "ui_open_diff",
      "Open the Compare Workspace pre-loaded with one or more run ids (assigned letter-chip identity " +
        "Ⓐ/Ⓑ/… in the order given), optionally pinning a baseline run id, a mode " +
        "(summary/flow/metrics/suite), and/or an opaque drill-down focus token.",
      {
        ids: assistantUiCompareParamsShape.ids,
        baseline: assistantUiCompareParamsShape.baseline,
        mode: assistantUiCompareParamsShape.mode,
        focus: assistantUiCompareParamsShape.focus,
      },
      async (args) => safeTool(() => uiResult("open_diff", args)),
    ),
  ];
}
