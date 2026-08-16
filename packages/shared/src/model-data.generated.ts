// GENERATED — do not edit by hand.
// Source of truth: research/token-context-comparison/data/**; regenerate with `pnpm build:model-data`.
// Derived from the model-comparison dataset (as-of 2026-06-21; 33 models).

/** Context window (tokens) per model id, for every model with a documented window. */
export const GENERATED_MODEL_CONTEXT_LIMITS: Record<string, number> = {
  "Qwen/Qwen3.5-35B-A3B": 262144,
  "Qwen/Qwen3.6-27B": 262144,
  "Qwen/Qwen3.6-35B-A3B": 262144,
  "claude-haiku-4-5": 200000,
  "claude-opus-4-8": 1000000,
  "claude-sonnet-4-6": 1000000,
  "deepseek-ai/DeepSeek-V3.2": 163840,
  "deepseek-ai/DeepSeek-V4-Flash": 1048576,
  "deepseek-ai/DeepSeek-V4-Pro": 1048576,
  "gemini-2.5-pro": 1048576,
  "gemini-3.1-flash-lite": 1048576,
  "gemini-3.5-flash": 1048576,
  "google/gemma-4-12B-it": 262144,
  "google/gemma-4-31B-it": 262144,
  "google/gemma-4-E4B-it": 131072,
  "gpt-5.4": 1050000,
  "gpt-5.4-mini": 400000,
  "gpt-5.5": 1050000,
  "grok-4.20-multi-agent-0309": 1000000,
  "grok-4.3": 1000000,
  "grok-build-0.1": 256000,
  "meta-llama/Llama-4-Maverick-17B-128E-Instruct": 1048576,
  "meta-llama/Llama-4-Scout-17B-16E-Instruct": 10485760,
  "microsoft-copilot-consumer": 200000,
  "microsoft/Phi-4-mini-instruct": 131072,
  "microsoft/Phi-4-multimodal-instruct": 131072,
  "microsoft/phi-4": 16384,
  "mistral-large-2512": 256000,
  "mistral-medium-3-5": 256000,
  "mistral-small-2603": 256000
};

export type GeneratedModelPrice = { inPer1M: number; outPer1M: number; cachedInPer1M?: number };

/** Per-1M-token USD list price per model id, for every model with documented input+output prices. */
export const GENERATED_MODEL_PRICING: Record<string, GeneratedModelPrice> = {
  "Qwen/Qwen3.5-35B-A3B": {"inPer1M":0.1,"outPer1M":0.4},
  "Qwen/Qwen3.6-27B": {"inPer1M":0.14,"outPer1M":0.9,"cachedInPer1M":0.05},
  "Qwen/Qwen3.6-35B-A3B": {"inPer1M":0.14,"outPer1M":0.9,"cachedInPer1M":0.05},
  "claude-haiku-4-5": {"inPer1M":1,"outPer1M":5,"cachedInPer1M":0.1},
  "claude-opus-4-8": {"inPer1M":5,"outPer1M":25,"cachedInPer1M":0.5},
  "claude-sonnet-4-6": {"inPer1M":3,"outPer1M":15,"cachedInPer1M":0.3},
  "deepseek-ai/DeepSeek-V4-Flash": {"inPer1M":0.14,"outPer1M":0.28,"cachedInPer1M":0.0028},
  "deepseek-ai/DeepSeek-V4-Pro": {"inPer1M":0.435,"outPer1M":0.87,"cachedInPer1M":0.003625},
  "gemini-2.5-pro": {"inPer1M":1.25,"outPer1M":10,"cachedInPer1M":0.125},
  "gemini-3.1-flash-lite": {"inPer1M":0.25,"outPer1M":1.5,"cachedInPer1M":0.025},
  "gemini-3.5-flash": {"inPer1M":1.5,"outPer1M":9,"cachedInPer1M":0.15},
  "gpt-5.4": {"inPer1M":2.5,"outPer1M":15,"cachedInPer1M":0.25},
  "gpt-5.4-mini": {"inPer1M":0.75,"outPer1M":4.5,"cachedInPer1M":0.075},
  "gpt-5.5": {"inPer1M":5,"outPer1M":30,"cachedInPer1M":0.5},
  "grok-4.20-multi-agent-0309": {"inPer1M":1.25,"outPer1M":2.5,"cachedInPer1M":0.2},
  "grok-4.3": {"inPer1M":1.25,"outPer1M":2.5,"cachedInPer1M":0.2},
  "grok-build-0.1": {"inPer1M":1,"outPer1M":2,"cachedInPer1M":0.2},
  "mistral-large-2512": {"inPer1M":0.5,"outPer1M":1.5},
  "mistral-medium-3-5": {"inPer1M":1.5,"outPer1M":7.5},
  "mistral-small-2603": {"inPer1M":0.15,"outPer1M":0.6}
};
