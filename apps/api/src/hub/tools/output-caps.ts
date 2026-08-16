// Assistant Hub (WP0.5, §1.6, R-MCP7) — output-size warn/cap + workspace spill. Warn at
// `HUB_MCP_OUTPUT_WARN_TOKENS` (10K default), cap at `HUB_MCP_OUTPUT_MAX_TOKENS` (25K default); an
// oversized result spills to the session workspace as a file + a reference (`HubToolArtifact`) instead
// of blowing the model's context. The UI card that RENDERS the reference is WP1.4's job (already built
// — `ConversationPane.tsx`'s `SpillCard`, keyed on `part.artifact?.kind === "spill"`); WP3.4 closes the
// loop end-to-end by wiring `applyOutputCapToMcpTools` (below) into the LIVE MCP tool-call execution
// path (`hub/session-service.ts`'s `resolveToolset`) so a real oversized MCP result actually produces
// the artifact the card renders, instead of the cap existing only as unwired, unit-tested plumbing.
import type { HubToolArtifact } from "@mcp-token-footprint/shared";
import type { Tool, ToolExecutionOptions } from "ai";
import type { TokenCounter } from "../../token-counting/types.js";
import { stableStringify } from "../../utils/json.js";
import { writeWorkspaceTextFile } from "../workspace.js";

export type OutputCapConfig = {
  warnTokens: number;
  capTokens: number;
};

export type OutputCapStatus = "ok" | "warn" | "capped";

export type OutputCapOutcome = {
  status: OutputCapStatus;
  tokens: number;
  /** The value to feed back to the model: the ORIGINAL result when `ok`/`warn`, a compact pointer
   *  string when `capped`. */
  modelContent: unknown;
  /** Present only when `capped` — the spilled file's UI-visible reference. */
  artifact?: HubToolArtifact;
};

const SPILL_DIR = "_tool-output-spills";
const PREVIEW_CHARS = 500;

/**
 * Measure a tool result and apply the warn/cap policy. `toolCallId` names the spill file
 * (`_tool-output-spills/<toolCallId>.json`) so a re-request of the same call doesn't collide with a
 * prior spill under a different id.
 */
export async function applyOutputCap(
  result: unknown,
  toolCallId: string,
  workspaceRoot: string,
  tokenCounter: TokenCounter,
  config: OutputCapConfig,
): Promise<OutputCapOutcome> {
  const tokens = await tokenCounter.countJson(result);

  if (tokens <= config.warnTokens) {
    return { status: "ok", tokens, modelContent: result };
  }
  if (tokens <= config.capTokens) {
    return { status: "warn", tokens, modelContent: result };
  }

  const serialized = stableStringify(result);
  const spillPath = `${SPILL_DIR}/${toolCallId}.json`;
  writeWorkspaceTextFile(workspaceRoot, spillPath, serialized);
  const preview = serialized.slice(0, PREVIEW_CHARS);
  const truncated = serialized.length > PREVIEW_CHARS;

  return {
    status: "capped",
    tokens,
    modelContent: `Tool result too large (${tokens} tokens, cap ${config.capTokens}) — spilled to the session workspace file "${spillPath}". Read it via files.read rather than re-requesting the call. Preview: ${preview}${truncated ? "…" : ""}`,
    artifact: { kind: "spill", spillPath, mimeType: "application/json", text: preview },
  };
}

/**
 * WP3.4 — wrap a resolved MCP toolset (`hub/tools/mcp-bridge.ts`'s `buildHubMcpTools` output) with the
 * warn/cap + spill policy above, so a LIVE oversized `tools/call` result actually gets capped instead
 * of the policy existing only as unit-tested plumbing. Each wrapped tool's `execute` still calls the
 * ORIGINAL (unmodified — the reused `testing/tool-bridge.ts` translation stays behavior-identical for
 * Testing's own tests), then measures + caps the result before handing it to the AI SDK: the MODEL sees
 * only `modelContent` (the pointer string when capped — the whole point of the cap); the UI-visible
 * `artifact` (present only when capped) is written into `artifactSink` keyed by `toolCallId` so the
 * caller (`turn-engine.ts`'s "tool-result" persist step, via `HubResolvedToolset.toolArtifacts`) can
 * attach it to the settled `tool_result` event without the AI SDK's `execute()` return value carrying
 * two channels at once.
 */
export function applyOutputCapToMcpTools(
  tools: Record<string, Tool>,
  opts: {
    workspaceRoot: string;
    tokenCounter: TokenCounter;
    config: OutputCapConfig;
    artifactSink: Map<string, HubToolArtifact>;
  },
): Record<string, Tool> {
  const wrapped: Record<string, Tool> = {};
  for (const [name, original] of Object.entries(tools)) {
    const originalExecute = original.execute;
    if (!originalExecute) {
      wrapped[name] = original;
      continue;
    }
    wrapped[name] = {
      ...original,
      execute: async (input: unknown, options: ToolExecutionOptions<unknown>) => {
        const raw = await originalExecute(input, options);
        const toolCallId = options?.toolCallId ?? `uncorrelated-${Date.now()}`;
        const outcome = await applyOutputCap(
          raw,
          toolCallId,
          opts.workspaceRoot,
          opts.tokenCounter,
          opts.config,
        );
        if (outcome.artifact) {
          opts.artifactSink.set(toolCallId, outcome.artifact);
        }
        return outcome.modelContent;
      },
    } as Tool;
  }
  return wrapped;
}
