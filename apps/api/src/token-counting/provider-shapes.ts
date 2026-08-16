import type { NormalizedToolDefinition } from "@mcp-token-footprint/shared";

// Provider-shape serialization adapters. This is the SINGLE serialization path for tool-definition
// token counting: the headline scan counts the raw MCP shape (the provider-agnostic default), and a
// per-provider recount passes the model's `tool_definition_shape`. Counting the SERIALIZED object
// (not a facet sum) is what makes the footprint reflect the JSON keys/braces + provider envelope the
// model actually ingests — see BaseTokenCounter.countToolDefinition in profiles.ts.

export function toOpenAIStyleTool(tool: NormalizedToolDefinition) {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description ?? "",
      parameters: tool.inputSchema ?? { type: "object", properties: {} },
    },
  };
}

export function toClaudeStyleTool(tool: NormalizedToolDefinition) {
  return {
    name: tool.name,
    description: tool.description ?? "",
    input_schema: tool.inputSchema ?? { type: "object", properties: {} },
  };
}

export function toRawMcpTool(tool: NormalizedToolDefinition) {
  return tool.raw;
}

/**
 * Google Gemini `functionDeclarations` shape — `{ name, description, parameters }` like OpenAI but
 * carried under a different envelope; counted distinctly so the footprint reflects how Gemini
 * actually serializes tools.
 */
export function toGeminiDeclarationTool(tool: NormalizedToolDefinition) {
  return {
    name: tool.name,
    description: tool.description ?? "",
    parameters: tool.inputSchema ?? { type: "object", properties: {} },
  };
}

/**
 * Pick the serialization adapter for a model's `tools_mcp.tool_definition_shape` (from the dataset).
 * Open-weight families served via OpenAI-compatible endpoints (gemma/llama/phi/qwen) use the OpenAI
 * function JSON shape; `raw_mcp`/unknown fall back to the raw MCP tool.
 */
export function adapterForShape(shape: string | null | undefined) {
  const s = (shape ?? "").toLowerCase();
  if (s.startsWith("anthropic")) return toClaudeStyleTool;
  if (s.startsWith("gemini")) return toGeminiDeclarationTool;
  if (s.startsWith("openai") || s.includes("function") || s.includes("pythonic"))
    return toOpenAIStyleTool;
  return toRawMcpTool;
}
