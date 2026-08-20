// Assistant Hub (planning/Roadmap/RM-03-assistant-hub/, WP0.5, D-AH1…D-AH20, §1.6) — the tool-registry core types.
//
// "One registry, three sources": in-process BUILT-INS (this file's `HubBuiltinTool`), bridged MCP
// tools (`./mcp-bridge.ts`, reusing `testing/tool-bridge.ts`'s translation), and skill-provided
// affordances (materialization is WP2.4's job — this module only needs the `HubToolSource` vocabulary
// to already include `"skill"`, which the shared contract does).
//
// Tool output is UNTRUSTED input (`.claude/rules/mcp-and-security.md`): a built-in's `execute()` may
// throw (validation, not-found, workspace-guard) and the CALLER (`safeExecuteBuiltin`) turns that into
// a model-visible failed step — R-MCP6's "isError:true is data, never a session crash" applies equally
// to built-ins, not just MCP results.
import type { HubToolArtifact, HubToolAnnotations } from "@mcp-token-footprint/shared";
import type { z } from "zod";
import type { TokenCounter } from "../../token-counting/types.js";
import { toErrorMessage } from "../../utils/errors.js";
import type { HubRepository } from "../repository.js";

/**
 * The result channels a built-in returns — the SAME split `HubToolPart` uses (`modelContent` fed back
 * to the model, `artifact` rendered only). `isError`/`errorText` mirror the MCP `isError:true`
 * contract (R-MCP6): a business-logic failure (not-found, validation, workspace-guard) is DATA the
 * model can react to, never a thrown exception that would crash the turn.
 */
export type HubBuiltinResult = {
  modelContent: unknown;
  artifact?: HubToolArtifact;
  isError?: boolean;
  errorText?: string;
};

/**
 * Everything a built-in's `execute()` needs beyond its own (already-validated) input. `repository` is
 * the WP0.2 `HubRepository` — built-ins that persist real state (artifacts, memory) call it directly;
 * `tasks.*` uses it read-only (`repository.listEvents`) to reconstruct the live task list from the
 * session's own tool-call history (see `builtins/tasks.ts` — there is no `hub_tasks` table by design).
 * `workspaceRoot` is the session's resolved, already-`ensureHubWorkspaceRoot`-created directory.
 */
export type HubToolExecutionContext = {
  sessionId: string;
  workspaceRoot: string;
  repository: HubRepository;
  tokenCounter: TokenCounter;
};

/**
 * One in-process hub tool. `inputSchema` is a zod schema (not raw JSON-schema — built-ins are
 * hand-authored, unlike MCP tools whose schema arrives over the wire); the AI-SDK adapter that turns
 * this into a callable model tool is WP1.1's job (the turn engine owns model/provider wiring), so this
 * type stays provider-agnostic.
 */
export type HubBuiltinTool = {
  name: string;
  source: "builtin";
  description: string;
  inputSchema: z.ZodTypeAny;
  /** Static annotations for the UI/inspector — built-ins are first-party and bypass the MCP
   *  annotation-informed approval policy entirely (see `approval-policy.ts`'s doc). */
  annotations?: HubToolAnnotations;
  execute(input: unknown, ctx: HubToolExecutionContext): Promise<HubBuiltinResult>;
};

/**
 * Run a built-in's `execute()`, converting ANY thrown error (zod validation, `httpError` 400/404 from
 * the workspace guard or a missing artifact/task, or anything else) into `{isError: true, errorText}`
 * instead of letting it propagate — the single choke point that guarantees a built-in call can never
 * crash the session (mirrors the MCP bridge's own `isError`/transport-error split, minus the
 * "transport failure fails the run" branch, which doesn't apply to an in-process call).
 */
export async function safeExecuteBuiltin(
  tool: HubBuiltinTool,
  input: unknown,
  ctx: HubToolExecutionContext,
): Promise<HubBuiltinResult> {
  try {
    return await tool.execute(input, ctx);
  } catch (error) {
    return { modelContent: null, isError: true, errorText: formatBuiltinError(error) };
  }
}

function formatBuiltinError(error: unknown): string {
  // A zod validation error's default `.message` is a JSON-stringified issues array — flatten it into
  // one readable line instead.
  if (error && typeof error === "object" && "issues" in error && Array.isArray((error as { issues: unknown }).issues)) {
    const issues = (error as { issues: Array<{ path: (string | number)[]; message: string }> }).issues;
    return issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
  }
  return toErrorMessage(error);
}
