// Assistant Hub (WP0.5, §1.6, R-MCP6) — structured-output validation + the `isError` fold.
//
// Validation reuses the grading feature's `checkArgsAgainstSchema` (`apps/api/src/grading/
// schema-check.ts`) — an EXISTING, deliberately small, in-house JSON-Schema SUBSET validator built
// specifically to avoid adding `ajv` (a new runtime dependency, owner-gated per
// `.claude/rules/dependencies.md`). It was authored generically over "a schema + a value"
// (`tool_hygiene`'s use is `inputSchema` + call args); this module applies the exact same function to
// `outputSchema` + `structuredContent` — same shape, same subset scope, zero new dependency, zero
// duplicated logic. Read-only reuse: this file does not modify `grading/schema-check.ts`.
import type { SchemaViolation } from "../../grading/schema-check.js";
import { checkArgsAgainstSchema } from "../../grading/schema-check.js";

export type StructuredOutputValidation = {
  valid: boolean;
  violations: SchemaViolation[];
};

/** Validate `structuredContent` against `outputSchema` (top-level subset only — see schema-check.ts's
 *  doc for exactly what it checks). No `outputSchema` declared → nothing to validate against, `valid`. */
export function validateStructuredOutput(
  outputSchema: unknown,
  structuredContent: unknown,
): StructuredOutputValidation {
  if (outputSchema === undefined || outputSchema === null) {
    return { valid: true, violations: [] };
  }
  const violations = checkArgsAgainstSchema(outputSchema, structuredContent);
  return { valid: violations.length === 0, violations };
}

export type McpResultLike = {
  content?: unknown;
  structuredContent?: unknown;
  isError?: boolean;
  outputSchema?: unknown;
};

export type FoldedMcpResult = {
  modelContent: unknown;
  isError: boolean;
  errorText?: string;
};

/**
 * R-MCP6 — fold a raw MCP `tools/call` result into the model-visible channel: a tool-level
 * `isError: true` becomes DATA the model can react to (never thrown, never a session error); when
 * `structuredContent` disagrees with a declared `outputSchema`, the mismatch is surfaced to the model
 * as a self-correction opportunity (not silently accepted, not a crash either).
 */
export function foldMcpResultForModel(result: McpResultLike): FoldedMcpResult {
  const isError = result.isError === true;

  if (result.structuredContent !== undefined && result.outputSchema !== undefined) {
    const validation = validateStructuredOutput(result.outputSchema, result.structuredContent);
    if (!validation.valid) {
      return {
        modelContent: {
          structuredContent: result.structuredContent,
          content: result.content,
          validationError: `structuredContent does not match outputSchema: ${validation.violations
            .map((v) => v.message)
            .join("; ")}`,
        },
        isError: true,
        errorText: "structuredContent failed outputSchema validation",
      };
    }
  }

  return {
    modelContent: result.structuredContent ?? result.content,
    isError,
    errorText: isError ? extractErrorText(result.content) : undefined,
  };
}

function extractErrorText(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const withText = content.find(
      (part): part is { text: string } =>
        !!part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string",
    );
    return withText?.text;
  }
  return undefined;
}
