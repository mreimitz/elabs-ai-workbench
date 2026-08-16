import type {
  NormalizedPromptDefinition,
  NormalizedResourceDefinition,
  NormalizedToolDefinition,
  ResourceKind,
} from "@mcp-token-footprint/shared";

export function normalizeTool(raw: unknown): NormalizedToolDefinition {
  const value = isRecord(raw) ? raw : {};
  const name = typeof value.name === "string" ? value.name : "unnamed_tool";
  const description = typeof value.description === "string" ? value.description : undefined;
  const inputSchema = value.inputSchema ?? value.input_schema ?? value.parameters;
  const annotations = value.annotations;

  return {
    name,
    description,
    inputSchema,
    annotations,
    raw,
  };
}

export function normalizeResource(raw: unknown, kind: ResourceKind): NormalizedResourceDefinition {
  const value = isRecord(raw) ? raw : {};
  // Concrete resources carry `uri`; templates carry `uriTemplate` — fold both into `uri`.
  const uriValue = kind === "template" ? (value.uriTemplate ?? value.uri) : value.uri;
  const uri = typeof uriValue === "string" ? uriValue : "";
  const name = typeof value.name === "string" ? value.name : undefined;
  const description = typeof value.description === "string" ? value.description : undefined;
  const mimeType = typeof value.mimeType === "string" ? value.mimeType : undefined;

  return {
    kind,
    uri,
    name,
    description,
    mimeType,
    raw,
  };
}

export function normalizePrompt(raw: unknown): NormalizedPromptDefinition {
  const value = isRecord(raw) ? raw : {};
  const name = typeof value.name === "string" ? value.name : "unnamed_prompt";
  const description = typeof value.description === "string" ? value.description : undefined;
  const argumentsValue = value.arguments;

  return {
    name,
    description,
    arguments: argumentsValue,
    raw,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
