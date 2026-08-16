// Assistant Hub (WP2.6, R-GUI1/2) — compile the shared `HUB_GENUI_CATALOG` into the FLAT JSON schema for
// the `present`/`prompt_user` tool input. The third artifact derived from the one registry (with the
// prompt catalog + the shared validator).
//
// R-GUI2: the schema is deliberately FLAT — a single recursive node type whose `$type` is an ENUM whose
// DESCRIPTION lists each component + a one-liner, plus a free `props` object and a `children` array of the
// same node. Providers reject a top-level `oneOf`/discriminated union of 14 component shapes, so we do NOT
// encode per-component prop shapes in the schema; the exact prop typing is enforced by the runtime
// validator (shared `validateGenuiSpec`) which drives the repair loop. The schema's job is only to steer
// the model toward the flat node shape and the known component ids.

import { HUB_GENUI_CATALOG } from "@mcp-token-footprint/shared";

/** A minimal JSON-schema fragment (enough for the AI-SDK `jsonSchema()` tool input). */
export type GenuiJsonSchema = Record<string, unknown>;

/** Build the `$type` enum description: every component id + its one-line summary, so the model sees the
 *  whole catalog inline on the enum itself (the R-GUI2 technique — the enum description IS the catalog). */
function typeEnumDescription(): string {
  const lines = HUB_GENUI_CATALOG.map((c) => `${c.id}: ${c.summary}`);
  return `The component to render. One of the catalog components:\n${lines.join("\n")}`;
}

/**
 * The flat recursive node schema (R-GUI2). `$type` is the enum of catalog ids; `$key` stabilizes list
 * identity for streaming; `props` is an open object (validated at runtime, not here); `children` is an
 * array of the same node. Returned as a plain object so callers wrap it with the AI-SDK `jsonSchema()`.
 */
export function compileGenuiNodeJsonSchema(): GenuiJsonSchema {
  return {
    $ref: "#/$defs/node",
    $defs: {
      node: {
        type: "object",
        additionalProperties: false,
        required: ["$type"],
        properties: {
          $type: {
            type: "string",
            enum: HUB_GENUI_CATALOG.map((c) => c.id),
            description: typeEnumDescription(),
          },
          $key: {
            type: "string",
            description: "Stable identity for a child in a list (streaming reconciliation). Optional.",
          },
          props: {
            type: "object",
            description:
              "Typed data for this component (see the catalog signatures). STRUCTURE and DATA only — never colors, CSS, or layout pixels; a style-bearing prop is rejected.",
            additionalProperties: true,
          },
          children: {
            type: "array",
            description: "Child nodes (only for container components: Stack, Grid, Card).",
            items: { $ref: "#/$defs/node" },
          },
        },
      },
    },
  };
}

/**
 * The `present` / `prompt_user` tool input schema: `{ root: node }`. A single root node keeps the tool
 * input flat + unambiguous (the model emits one widget tree per call).
 */
export function compileGenuiToolJsonSchema(): GenuiJsonSchema {
  const node = compileGenuiNodeJsonSchema();
  return {
    type: "object",
    additionalProperties: false,
    required: ["root"],
    properties: {
      root: {
        ...(node.$defs ? { $defs: node.$defs } : {}),
        $ref: "#/properties/root/$defs/node",
        description: "The root component of the UI tree to render.",
      },
    },
  };
}
