import type {
  NormalizedPromptDefinition,
  NormalizedResourceDefinition,
  NormalizedToolDefinition,
  TokenBreakdown,
} from "@mcp-token-footprint/shared";

/** Per-facet token breakdown for one resource/template definition (no row identity). */
export type ResourceTokenBreakdown = {
  totalTokens: number;
  uriTokens: number;
  nameTokens: number;
  descriptionTokens: number;
  mimeTypeTokens: number;
  rawBytes: number;
};

/** Per-facet token breakdown for one prompt definition (no row identity). */
export type PromptTokenBreakdown = {
  totalTokens: number;
  nameTokens: number;
  descriptionTokens: number;
  argumentsTokens: number;
  rawBytes: number;
};

export type TokenCounter = {
  id: string;
  label: string;
  countText(text: string): Promise<number>;
  countJson(value: unknown): Promise<number>;
  /**
   * Count a tool definition's footprint. `totalTokens` is the token count of the ACTUAL serialized
   * tool object for the given provider `shape` (JSON keys/braces + the provider wire envelope), NOT
   * the sum of the isolated name/description/schema facets — those facets remain in the breakdown for
   * per-field insight. `shape` selects the serialization adapter (see provider-shapes.ts); omitted →
   * the raw MCP tool object (the provider-agnostic headline footprint).
   */
  countToolDefinition(
    tool: NormalizedToolDefinition,
    shape?: string | null,
  ): Promise<TokenBreakdown>;
  countResourceDefinition(resource: NormalizedResourceDefinition): Promise<ResourceTokenBreakdown>;
  countPromptDefinition(prompt: NormalizedPromptDefinition): Promise<PromptTokenBreakdown>;
};
