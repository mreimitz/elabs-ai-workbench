// Assistant Hub (WP0.5, §1.6; event emission WP3.2, §1.3) — the `memory.propose_save` built-in
// (D-AH11: the assistant may only PROPOSE — never write silently). Persisted through the WP0.2
// `HubRepository` with `source: "assistant_proposed"`, which `HubRepository.createMemory` stamps
// `status: "proposed"` (the user must explicitly accept it — `PATCH /api/hub/memory/:id` from either
// the Memory panel or the transcript's proposal chip, `hub/routes.ts`'s WP3.2 block — before it
// becomes `active` and gets injected into future prompts, `hub/turn-engine.ts`'s memory-summary wiring).
//
// Mirrors `artifacts.create` (`./artifacts.ts`): besides persisting the row, it appends the discrete
// `memory_proposed` event (§1.3) to the session's log so a reconnecting client — or anything
// reconstructing the session purely from `hub_events` (R-SES1) — sees the proposal WITHOUT parsing this
// tool's `modelContent`/`artifact` result shape. `ConversationPane.tsx`'s `reconstructMemoryProposals`
// folds this event (paired with a later `memory_saved`, if any) into the transcript's proposal chip.
import { hubMemoryKindSchema, hubMemoryScopeSchema } from "@mcp-token-footprint/shared";
import { z } from "zod";
import type { HubBuiltinTool } from "../types.js";

// WP1.5 (D-HUX11) — a proposal now carries an optional SCOPE (default `profile`); a `project`/`crew`/
// `agent` scope names its owning entity in `scopeId` (validated + entity-guarded by
// `HubRepository.createMemory`). The default-most-specific-owner choice is the model's; an omitted
// scope stays global profile memory (byte-identical to the pre-scope proposal).
const proposeInput = z
  .object({
    kind: hubMemoryKindSchema,
    content: z.string().trim().min(1),
    scope: hubMemoryScopeSchema.optional(),
    scopeId: z.string().trim().min(1).optional(),
  })
  .strict();

export const memoryProposeSave: HubBuiltinTool = {
  name: "memory.propose_save",
  source: "builtin",
  description:
    "Propose saving a durable profile/preference/instruction to memory, optionally scoped to a project/agent/crew (default: global profile). This is a PROPOSAL only — the user must accept it before it becomes active.",
  inputSchema: proposeInput,
  annotations: { readOnlyHint: false, destructiveHint: false },
  async execute(input, ctx) {
    const { kind, content, scope, scopeId } = proposeInput.parse(input);
    const memory = ctx.repository.createMemory({
      kind,
      content,
      source: "assistant_proposed",
      ...(scope ? { scope } : {}),
      ...(scopeId ? { scopeId } : {}),
    });
    ctx.repository.appendEvent(ctx.sessionId, {
      type: "memory_proposed",
      memoryId: memory.id,
      kind: memory.kind,
      content: memory.content,
      ...(memory.scope ? { scope: memory.scope } : {}),
      scopeId: memory.scopeId ?? null,
    });
    return {
      modelContent: { memoryId: memory.id, status: memory.status },
      artifact: { kind: "hub_memory", data: memory },
    };
  },
};

export const MEMORY_BUILTINS: HubBuiltinTool[] = [memoryProposeSave];
