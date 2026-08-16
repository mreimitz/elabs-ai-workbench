import { describe, expect, it } from "vitest";
import { TOKEN_PROFILES } from "@mcp-token-footprint/shared";
import {
  modelSupportsDeferred,
  modelSupportsReasoning,
  TOKEN_PROFILE_META,
} from "./environment-model-caps";

describe("modelSupportsReasoning", () => {
  it("is permissive when no provider is chosen yet", () => {
    expect(modelSupportsReasoning(undefined, "")).toBe(true);
  });

  it("anthropic: modern Claude yes, Haiku no", () => {
    expect(modelSupportsReasoning("anthropic", "claude-opus-4-8")).toBe(true);
    expect(modelSupportsReasoning("anthropic", "claude-3-5-haiku")).toBe(false);
  });

  it("openai: o-series / GPT-5 yes, classic chat no", () => {
    expect(modelSupportsReasoning("openai", "o3")).toBe(true);
    expect(modelSupportsReasoning("openai", "o4-mini")).toBe(true);
    expect(modelSupportsReasoning("openai", "gpt-5")).toBe(true);
    expect(modelSupportsReasoning("openai", "gpt-4o")).toBe(false);
    expect(modelSupportsReasoning("openai", "gpt-4.1-mini")).toBe(false);
  });

  it("google: Gemini 2.5 yes, older no", () => {
    expect(modelSupportsReasoning("google", "gemini-2.5-pro")).toBe(true);
    expect(modelSupportsReasoning("google", "gemini-1.5-flash")).toBe(false);
  });

  it("local/compat kinds stay permissive", () => {
    expect(modelSupportsReasoning("ollama", "deepseek-r1")).toBe(true);
    expect(modelSupportsReasoning("openai_compatible", "some-model")).toBe(true);
  });
});

describe("modelSupportsDeferred", () => {
  it("only Anthropic non-Haiku supports tool search", () => {
    expect(modelSupportsDeferred("anthropic", "claude-opus-4-8")).toBe(true);
    expect(modelSupportsDeferred("anthropic", "claude-3-5-haiku")).toBe(false);
    expect(modelSupportsDeferred("openai", "gpt-4o")).toBe(false);
    expect(modelSupportsDeferred(undefined, "claude-opus-4-8")).toBe(false);
  });
});

describe("TOKEN_PROFILE_META", () => {
  it("covers every token profile with title + help", () => {
    for (const profile of TOKEN_PROFILES) {
      expect(TOKEN_PROFILE_META[profile]?.title.length).toBeGreaterThan(0);
      expect(TOKEN_PROFILE_META[profile]?.help.length).toBeGreaterThan(0);
    }
  });
});
