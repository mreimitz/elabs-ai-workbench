import type {
  NormalizedPromptDefinition,
  NormalizedResourceDefinition,
  NormalizedToolDefinition,
  TokenBreakdown,
  TokenProfileId,
} from "@mcp-token-footprint/shared";
import { TOKEN_PROFILES } from "@mcp-token-footprint/shared";
import { Tiktoken } from "js-tiktoken/lite";
import cl100kBase from "js-tiktoken/ranks/cl100k_base";
import o200kBase from "js-tiktoken/ranks/o200k_base";
import { jsonBytes, stableStringify } from "../utils/json.js";
import { adapterForShape } from "./provider-shapes.js";
import type { PromptTokenBreakdown, ResourceTokenBreakdown, TokenCounter } from "./types.js";

/**
 * Base counter: everything except `countText` is method-agnostic. The definition-footprint methods
 * live here so the real-BPE and heuristic counters share ONE implementation — in particular the
 * tool footprint routes through the SAME provider-shape serialization path (`adapterForShape`) as
 * any compatibility recount, so the headline total is the serialized tool object, not a facet sum.
 */
abstract class BaseTokenCounter implements TokenCounter {
  constructor(
    public readonly id: TokenProfileId,
    public readonly label: string,
  ) {}

  abstract countText(text: string): Promise<number>;

  async countJson(value: unknown): Promise<number> {
    return this.countText(stableStringify(value));
  }

  async countToolDefinition(
    tool: NormalizedToolDefinition,
    shape?: string | null,
  ): Promise<TokenBreakdown> {
    // Per-field facets (isolated) — retained for the per-tool breakdown insight only.
    const nameTokens = await this.countText(tool.name);
    const descriptionTokens = tool.description ? await this.countText(tool.description) : 0;
    const schemaTokens = tool.inputSchema ? await this.countJson(tool.inputSchema) : 0;
    const annotationsTokens = tool.annotations ? await this.countJson(tool.annotations) : 0;
    const rawBytes = jsonBytes(tool.raw);

    // Headline total: tokens of the ACTUAL serialized tool object for the target provider shape
    // (envelope + JSON keys/braces), so the footprint reflects what the model really ingests. This
    // is >= the facet sum because the wire structure (keys, braces, envelope) is now included.
    const serialized = adapterForShape(shape)(tool);
    const totalTokens = await this.countJson(serialized);

    return {
      totalTokens,
      nameTokens,
      descriptionTokens,
      schemaTokens,
      annotationsTokens,
      rawBytes,
    };
  }

  async countResourceDefinition(
    resource: NormalizedResourceDefinition,
  ): Promise<ResourceTokenBreakdown> {
    const uriTokens = await this.countText(resource.uri);
    const nameTokens = resource.name ? await this.countText(resource.name) : 0;
    const descriptionTokens = resource.description ? await this.countText(resource.description) : 0;
    const mimeTypeTokens = resource.mimeType ? await this.countText(resource.mimeType) : 0;
    const rawBytes = jsonBytes(resource.raw);

    return {
      totalTokens: uriTokens + nameTokens + descriptionTokens + mimeTypeTokens,
      uriTokens,
      nameTokens,
      descriptionTokens,
      mimeTypeTokens,
      rawBytes,
    };
  }

  async countPromptDefinition(prompt: NormalizedPromptDefinition): Promise<PromptTokenBreakdown> {
    const nameTokens = await this.countText(prompt.name);
    const descriptionTokens = prompt.description ? await this.countText(prompt.description) : 0;
    const argumentsTokens = prompt.arguments ? await this.countJson(prompt.arguments) : 0;
    const rawBytes = jsonBytes(prompt.raw);

    return {
      totalTokens: nameTokens + descriptionTokens + argumentsTokens,
      nameTokens,
      descriptionTokens,
      argumentsTokens,
      rawBytes,
    };
  }
}

/**
 * Real BPE counter backed by js-tiktoken. Rank data is bundled via the `js-tiktoken/ranks/*` subpath
 * imports (no network fetch — works fully offline). The `Tiktoken` instance is built lazily and
 * cached so the (small) rank-table parse happens at most once per profile.
 */
type TiktokenRanks = ConstructorParameters<typeof Tiktoken>[0];

class TiktokenCounter extends BaseTokenCounter {
  private encoder: Tiktoken | null = null;

  constructor(
    id: TokenProfileId,
    label: string,
    private readonly ranks: TiktokenRanks,
  ) {
    super(id, label);
  }

  private getEncoder(): Tiktoken {
    if (!this.encoder) this.encoder = new Tiktoken(this.ranks);
    return this.encoder;
  }

  async countText(text: string): Promise<number> {
    if (!text) return 0;
    // Encode with special tokens neither allowed nor disallowed: any `<|…|>`-looking substring in a
    // tool definition is ordinary data, so it is BPE-merged as text (and never throws).
    return this.getEncoder().encode(text, [], []).length;
  }
}

type EstimateMode = "generic" | "raw";

/**
 * Heuristic counter (byte-ratio + lexical/punctuation structure). NOT tokenizer-accurate — kept only
 * under explicitly-named profiles (`generic_estimate`, `raw_json_rough`) so nothing carrying a real
 * encoding name relies on an estimate.
 */
class EstimatedTokenCounter extends BaseTokenCounter {
  constructor(
    id: TokenProfileId,
    label: string,
    private readonly mode: EstimateMode,
  ) {
    super(id, label);
  }

  async countText(text: string): Promise<number> {
    return countTextEstimate(text, this.mode);
  }
}

const counters: Record<TokenProfileId, TokenCounter> = {
  generic_o200k: new TiktokenCounter("generic_o200k", "o200k_base (tiktoken)", o200kBase),
  generic_cl100k: new TiktokenCounter("generic_cl100k", "cl100k_base (tiktoken)", cl100kBase),
  generic_estimate: new EstimatedTokenCounter(
    "generic_estimate",
    "Generic heuristic estimate",
    "generic",
  ),
  raw_json_rough: new EstimatedTokenCounter("raw_json_rough", "Raw JSON rough estimate", "raw"),
};

export function getTokenCounter(profile: TokenProfileId): TokenCounter {
  return counters[profile]!;
}

export function listTokenCounters(): TokenCounter[] {
  return TOKEN_PROFILES.map((profile) => counters[profile]!);
}

function countTextEstimate(text: string, mode: EstimateMode): number {
  if (!text) return 0;

  const bytes = Buffer.byteLength(text, "utf8");
  if (mode === "raw") {
    return Math.max(1, Math.ceil(bytes / 4));
  }

  const lexicalTokens = text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s._/-]+|(?=[{}[\]():,"])/u)
    .filter(Boolean);
  const punctuationTokens = text.match(/[{}[\]():,"|<>]/gu)?.length ?? 0;
  const lengthEstimate = Math.ceil(bytes / 4.05);
  const structureEstimate = Math.ceil(lexicalTokens.length + punctuationTokens * 0.35);
  return Math.max(1, Math.max(lengthEstimate, structureEstimate));
}
