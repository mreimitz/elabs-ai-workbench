---
type: "Research Output"
title: "04 Token Counting Strategy"
description: "Phase 1 counts only the normalized MCP tool definition payload loaded during discovery. The"
tags: ["research", "RS-09"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# 04 Token Counting Strategy

## Scope

Phase 1 counts only the normalized MCP tool **definition** payload loaded during discovery. The
expanded target adds **runtime** call accounting (request + response tokens of a `tools/call`)
reusing the same `TokenCounter` interface — see [`08-expanded-target.md`](../../../Roadmap/RM-31-mvp-footprint-analyzer/08-expanded-target.md).

## Interface

```ts
interface TokenCounter {
  id: string;
  label: string;
  countText(text: string): Promise<number>;
  countJson(value: unknown): Promise<number>;
  countToolDefinition(tool: NormalizedToolDefinition): Promise<TokenBreakdown>;
}
```

## Profiles

- `generic_o200k`: OpenAI-style generic profile for modern large context models.
- `generic_cl100k`: OpenAI-style generic profile for older tokenizer behavior.
- `raw_json_rough`: deterministic bytes-to-token rough estimate for comparison and fallback.

## Counting Rules

- Names, descriptions, schemas, and annotations are counted separately.
- Raw bytes are measured from stable JSON serialization.
- Tool total is the sum of name, description, schema, and annotation counts.
- Contribution percent is `tool_tokens / scan_total_tokens * 100`.
- Provider-shaped conversion helpers are prepared but not overbuilt:
  - `toOpenAIStyleTool`
  - `toClaudeStyleTool`
  - `toRawMcpTool`

## Future Adapter Points

Provider token APIs can be added behind the `TokenCounter` interface without changing scan persistence or UI contracts.

# Citations

None.
