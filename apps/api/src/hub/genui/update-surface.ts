// Assistant Hub (WP2.6, R-GUI6) — the editable-surface snapshot contract. Agent-editable surfaces
// (artifacts, plan cards, the task list, a rendered Form) expose an auto-generated `update_{name}` tool
// with the fixed wording "Only include the fields you want to change; omitted fields keep their current
// values", and their current state is stamped into user turns at send time via
// `stampGenuiSurfaceState` (shared) so ids stay model-visible.
//
// This module provides the reusable FACTORY. Wiring it onto specific surfaces (artifact/plan/task) is
// owned by those WPs; WP2.6 owns the contract + the wording so every surface is consistent.

import { z } from "zod";
import type { HubBuiltinTool } from "../tools/types.js";

/** The fixed wording every `update_{name}` tool carries (R-GUI6) — partial-update semantics. */
export const UPDATE_SURFACE_PARTIAL_WORDING =
  "Only include the fields you want to change; omitted fields keep their current values.";

export type UpdateSurfaceField = {
  name: string;
  /** The value kind — kept to the primitives an editable surface field needs. */
  kind: "string" | "number" | "boolean";
  description: string;
};

export type BuildUpdateSurfaceToolInput = {
  /** The surface name — the tool is `update_{name}` (spaces/dashes → underscores). */
  name: string;
  fields: UpdateSurfaceField[];
  /** Applies the (partial) patch to the surface, returning the model-visible result. */
  apply: (patch: Record<string, unknown>) => Promise<unknown> | unknown;
  description?: string;
};

const toolNameFor = (name: string): string => `update_${name.trim().replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase()}`;

const fieldSchema = (kind: UpdateSurfaceField["kind"]): z.ZodTypeAny =>
  kind === "number" ? z.number() : kind === "boolean" ? z.boolean() : z.string();

/**
 * Build an `update_{name}` built-in tool (R-GUI6). Every field is OPTIONAL (partial-update semantics); the
 * description carries the fixed partial-update wording so the model never re-sends the whole surface.
 */
export function buildUpdateSurfaceTool(input: BuildUpdateSurfaceToolInput): HubBuiltinTool {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of input.fields) {
    shape[field.name] = fieldSchema(field.kind).optional().describe(field.description);
  }
  const inputSchema = z.object(shape).strict();
  const description = `${input.description ? `${input.description} ` : ""}${UPDATE_SURFACE_PARTIAL_WORDING}`;
  return {
    name: toolNameFor(input.name),
    source: "builtin",
    description,
    inputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false },
    async execute(raw) {
      const patch = inputSchema.parse(raw) as Record<string, unknown>;
      const result = await input.apply(patch);
      return { modelContent: result ?? { ok: true } };
    },
  };
}
