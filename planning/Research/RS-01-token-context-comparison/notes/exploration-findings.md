---
type: "Research Note"
title: "MCP Token Footprint App \u2014 Existing Conventions & Test/Check Architecture"
description: "This report documents the MCP Token Footprint app's current test/check patterns, tool definitions, token counting, and data model to inform a new \"model-compatibility test suite.\" The app\u2026"
tags: ["research", "RS-01"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# MCP Token Footprint App — Existing Conventions & Test/Check Architecture

## Summary

This report documents the MCP Token Footprint app's current test/check patterns, tool definitions, token counting, and data model to inform a new "model-compatibility test suite." The app is organized as a monorepo with `apps/api` (backend), `apps/web` (React UI), and `packages/shared` (types). The primary domains are scans (static tool analysis), testing (agentic runs), and comparisons.

---

## 1. EXISTING TESTS/CHECKS AGAINST TOOLS

### Current Architecture

The app has **two separate check systems**:

#### 1a. Scan-Time Events (Real-time Validation during Tool Discovery)

**Location:** `apps/api/src/scans/`

- **Schema table:** `scan_events` (id, scan_id, level, message, created_at)
- **Level enum:** `"info" | "warning" | "error"` (from `ScanEventLevel` type in `packages/shared/src/types.ts`)
- **Database columns:** level TEXT NOT NULL CHECK (level IN ('info', 'warning', 'error'))

**How it works:** When running `runScan()`, the scan service calls `discoverTools()` with a logging callback. Any error or status event during tool discovery is captured as a `ScanEvent`.

**Quote from schema.ts:**
```sql
CREATE TABLE IF NOT EXISTS scan_events (
  id TEXT PRIMARY KEY,
  scan_id TEXT NOT NULL REFERENCES mcp_scans(id) ON DELETE CASCADE,
  level TEXT NOT NULL CHECK (level IN ('info', 'warning', 'error')),
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

**Usage pattern (scans/service.ts):**
```typescript
const discovery = await discoverTools(
  server,
  async (level, message) => {
    await this.scans.addEvent(scan_id, level, message);  // 'info' | 'warning' | 'error'
  }
);
```

#### 1b. Optimization Suggestions (Post-Scan Analysis)

**Location:** `apps/web/src/lib/optimize.ts`

- **Purpose:** Rule-based optimization guidance for tool definitions (NOT assertions; NOT test failures)
- **Severity enum:** `"warn" | "info"` (2-tier, no error; warnings are actionable, info is FYI)
- **NOT persisted to database** — computed client-side on read from scan results

**Quote from optimize.ts:**
```typescript
export type Suggestion = {
  id: string;
  label: string;
  savings: number;
  severity: "warn" | "info";
};
```

**Example rules:**
- `"no-desc"` (warn) — tool has no description
- `"long-desc"` (warn) — description exceeds 80 tokens
- `"enum-*"` (warn) — large enum values inline in schema
- `"no-schema"` (info) — no input schema provided
- `"huge"` (info) — tool exceeds 1000 tokens

**Grouped output (serverRecommendations, groupFindings):** Severity is used to bucket findings and prioritize UI rendering — "warn" appears first, info later.

### No Built-in Tool-Specific Test Suite (Yet)

- There is **no existing "tests we run against individual tools"** feature
- Scans are **static extraction** (discover tools, count tokens, emit events)
- Testing feature (in roadmap) is **agentic (LLM-driven)**, not tool-definition validation
- Tool playground allows **manual execution** of individual tools but no assertion framework

### Verdict/Status Vocabulary Already in Use

- **Scan events:** `"info" | "warning" | "error"` (no "ok"/"pass")
- **Optimization severity:** `"warn" | "info"` (no error level in suggestions)
- **Run outcomes:** `"completed" | "stopped_guardrail" | "context_overflow" | "error" | "aborted"` (from constants.ts)
- **Run status:** `"pending" | "running" | "completed" | "stopped" | "error" | "aborted"`

---

## 2. NORMALIZED TOOL DEFINITION

### Type Definition

**Location:** `packages/shared/src/types.ts`

**Quote:**
```typescript
export type NormalizedToolDefinition = {
  name: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: unknown;
  raw: unknown;
};
```

**Normalization logic (apps/api/src/mcp/normalize.ts):**
```typescript
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
    raw
  };
}
```

**Schema field remapping:** Tries `inputSchema`, falls back to `input_schema` (Claude SDK style), then `parameters` (OpenAI style).

### Token Breakdown Type

**Location:** `packages/shared/src/types.ts`

**Quote:**
```typescript
export type TokenBreakdown = {
  totalTokens: number;
  nameTokens: number;
  descriptionTokens: number;
  schemaTokens: number;
  annotationsTokens: number;
  rawBytes: number;
};
```

**Database mapping (ToolScanRow in apps/api/src/db/rows.ts):**
```typescript
export type ToolScanRow = {
  id: string;
  scan_id: string;
  tool_name: string;
  description: string | null;
  input_schema_json: string | null;
  annotations_json: string | null;
  raw_tool_json: string;
  total_tokens: number;
  name_tokens: number;
  description_tokens: number;
  schema_tokens: number;
  annotations_tokens: number;
  raw_bytes: number;
  contribution_percent: number;
};
```

---

## 3. TOKEN COUNTING

### TokenCounter Interface

**Location:** `apps/api/src/token-counting/types.ts`

**Quote:**
```typescript
export type TokenCounter = {
  id: string;
  label: string;
  countText(text: string): Promise<number>;
  countJson(value: unknown): Promise<number>;
  countToolDefinition(tool: NormalizedToolDefinition): Promise<TokenBreakdown>;
};
```

### Token Profiles (Estimators)

**Location:** `apps/api/src/token-counting/profiles.ts`

**Available profiles (from constants.ts):**
```typescript
export const TOKEN_PROFILES = [
  "generic_o200k",       // Generic estimate tuned for o200k tokenizer (Claude Opus, Sonnet)
  "generic_cl100k",      // Generic estimate tuned for cl100k tokenizer (older Claude)
  "raw_json_rough"       // Rough estimate: ~4 bytes per token
] as const;
```

**Profile implementations (all estimated, not actual):**
```typescript
const counters: Record<TokenProfileId, TokenCounter> = {
  generic_o200k: new EstimatedTokenCounter("generic_o200k", "Generic o200k estimate", "o200k"),
  generic_cl100k: new EstimatedTokenCounter("generic_cl100k", "Generic cl100k estimate", "cl100k"),
  raw_json_rough: new EstimatedTokenCounter("raw_json_rough", "Raw JSON rough estimate", "raw")
};
```

**Estimation logic:**
- **o200k mode:** ~4.25 bytes per token average; lexical tokenization + heuristic
- **cl100k mode:** ~3.85 bytes per token average
- **raw mode:** simple bytes/4 ceiling

### Provider-Shape Helpers

**Location:** `apps/api/src/token-counting/provider-shapes.ts`

**Quote:**
```typescript
export function toOpenAIStyleTool(tool: NormalizedToolDefinition) {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description ?? "",
      parameters: tool.inputSchema ?? { type: "object", properties: {} }
    }
  };
}

export function toClaudeStyleTool(tool: NormalizedToolDefinition) {
  return {
    name: tool.name,
    description: tool.description ?? "",
    input_schema: tool.inputSchema ?? { type: "object", properties: {} }
  };
}

export function toRawMcpTool(tool: NormalizedToolDefinition) {
  return tool.raw;
}
```

**Purpose:** Convert normalized tool to provider-specific formats for comparison/display.

---

## 4. DATA MODEL

### Database Schema Location

`apps/api/src/db/schema.ts` (SQLite, DDL as string exported as `schemaSql`)

### Core Tables for Tool Management

#### mcp_servers
```sql
CREATE TABLE IF NOT EXISTS mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  transport TEXT NOT NULL CHECK (transport IN ('stdio', 'streamable_http')),
  command TEXT,
  args_json TEXT NOT NULL DEFAULT '[]',
  url TEXT,
  headers_json TEXT NOT NULL DEFAULT '{}',
  env_json TEXT NOT NULL DEFAULT '{}',
  auth_type TEXT NOT NULL DEFAULT 'none' CHECK (auth_type IN ('none', 'bearer', 'api_key', 'oauth', 'custom_headers')),
  auth_header_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

#### mcp_scans
```sql
CREATE TABLE IF NOT EXISTS mcp_scans (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  token_profile TEXT NOT NULL,
  scanned_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
  total_tools INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  total_raw_bytes INTEGER NOT NULL DEFAULT 0,
  average_tokens_per_tool REAL NOT NULL DEFAULT 0,
  largest_tool_name TEXT,
  largest_tool_tokens INTEGER NOT NULL DEFAULT 0,
  error_message TEXT
);
```

#### mcp_tool_scans
```sql
CREATE TABLE IF NOT EXISTS mcp_tool_scans (
  id TEXT PRIMARY KEY,
  scan_id TEXT NOT NULL REFERENCES mcp_scans(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  description TEXT,
  input_schema_json TEXT,
  annotations_json TEXT,
  raw_tool_json TEXT NOT NULL,
  total_tokens INTEGER NOT NULL,
  name_tokens INTEGER NOT NULL,
  description_tokens INTEGER NOT NULL,
  schema_tokens INTEGER NOT NULL,
  annotations_tokens INTEGER NOT NULL,
  raw_bytes INTEGER NOT NULL,
  contribution_percent REAL NOT NULL
);
```

#### scan_events
```sql
CREATE TABLE IF NOT EXISTS scan_events (
  id TEXT PRIMARY KEY,
  scan_id TEXT NOT NULL REFERENCES mcp_scans(id) ON DELETE CASCADE,
  level TEXT NOT NULL CHECK (level IN ('info', 'warning', 'error')),
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

### Testing Tables (for Agentic Runs — Roadmap Phase 3)

#### scenarios
```sql
CREATE TABLE IF NOT EXISTS scenarios (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider_id TEXT NOT NULL REFERENCES provider_credentials(id) ON DELETE RESTRICT,
  model TEXT NOT NULL,
  params_json TEXT NOT NULL DEFAULT '{}',
  system_prompt TEXT NOT NULL DEFAULT '',
  default_profiles_json TEXT NOT NULL DEFAULT '[]',
  guardrails_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

#### tests
```sql
CREATE TABLE IF NOT EXISTS tests (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  user_prompt TEXT NOT NULL,
  system_prompt_override TEXT,
  added_profiles_json TEXT NOT NULL DEFAULT '[]',
  assertions_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

#### runs
```sql
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  test_id TEXT NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('automated','interactive')),
  status TEXT NOT NULL CHECK (status IN ('pending','running','completed','stopped','error','aborted')),
  outcome TEXT,
  stop_reason TEXT,
  started_at TEXT NOT NULL,
  duration_ms INTEGER,
  turns INTEGER NOT NULL DEFAULT 0,
  tool_calls INTEGER NOT NULL DEFAULT 0,
  peak_context_tokens INTEGER NOT NULL DEFAULT 0,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  error_message TEXT
);
```

#### run_steps
```sql
CREATE TABLE IF NOT EXISTS run_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('llm_request','llm_response','tool_call','tool_result','context_event')),
  label TEXT NOT NULL,
  status TEXT NOT NULL,
  duration_ms INTEGER,
  server_id TEXT,
  tool_name TEXT,
  profile_tokens_json TEXT NOT NULL DEFAULT '{}',
  usage_actual_json TEXT,
  context_snapshot_json TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}'
);
```

---

## 5. SHARED WIRE TYPES & CONVENTIONS

### Naming Style

**Primary convention:** `camelCase` throughout (TypeScript types, API responses, form inputs)

- Tool properties: `toolName`, `inputSchema`, `descriptionTokens`
- Database columns: `snake_case` (SQLite convention)
- JSON serialization: `camelCase` (via TypeScript → JSON serializers)

**Quote from shared/src/types.ts:**
```typescript
export type ScanSummary = {
  id: string;
  serverId: string;
  serverName: string;
  tokenProfile: TokenProfileId;
  scannedAt: string;
  status: ScanStatus;
  totalTools: number;
  totalTokens: number;
  // ... all camelCase
};
```

### Enum/Severity Naming Patterns

#### Enums as Literal Unions
All enums are **const arrays** in constants.ts, exported as readonly tuples, then derived into type unions:

```typescript
// constants.ts
export const RUN_STATUSES = ["pending", "running", "completed", "stopped", "error", "aborted"] as const;

// types.ts
export type RunStatus = (typeof RUN_STATUSES)[number];
```

**Pattern:** `SCREAMING_SNAKE_CASE` for const arrays; derived type is PascalCase union.

#### Severity/Level Patterns (Two Current Systems)

1. **Scan events (historical validation):** `"info" | "warning" | "error"` — three levels
2. **Optimization suggestions:** `"warn" | "info"` — two levels (no error)

**Convention to follow:** Use lowercase literals; group related statuses/levels as discriminated unions when needed.

### Result/Status/Verdict Vocabulary

**Scan execution:** `status: "running" | "success" | "failed"`
**Run execution:** `status: "pending" | "running" | "completed" | "stopped" | "error" | "aborted"`
**Run outcome:** `outcome?: "completed" | "stopped_guardrail" | "context_overflow" | "error" | "aborted"`
**Step status:** `status: "ok" | "error" | "running"`
**Event level:** `level: "info" | "warning" | "error"`

**Pattern:** Status tracks execution state; outcome is the result reason; level is severity.

### Repository/Service/Route Layering

**Standard 3-tier architecture:** (enforced across all domains)

1. **Repository** — data access layer (`*-repository.ts`)
   - Methods like `.get()`, `.create()`, `.update()`, `.delete()`, `.list()`
   - Returns plain DTO types (e.g., `ScanRow`, `TestRow`)

2. **Service** — business logic layer (`*-service.ts`)
   - Takes repositories via constructor injection
   - Methods like `.runScan()`, `.callTool()`, `.createScenario()`
   - Coordinates between repos, orchestrates workflows
   - Returns wire types (e.g., `ScanDetail`, `ScanSummary`)

3. **Routes** — HTTP endpoints (`*-routes.ts`)
   - Takes services via constructor injection
   - Validates input via Zod schemas
   - Calls service methods, returns JSON
   - Error handling via shared error utils

**Example (scans):**
- `ScanRepository` — `.getDetail()`, `.createRunningScan()`, `.completeScan()`, `.addEvent()`
- `ScanService` — `.runScan()` (orchestrates discovery → normalization → counting → persistence), `.testServer()`
- `scans/routes.ts` — `GET /api/scans/:id`, `POST /api/servers/:id/scan` (request validation + service call)

---

## 6. EXISTING SEVERITY/STATUS VOCABULARY TO REUSE

### Approved Enums (from constants.ts)

```typescript
export const TRANSPORT_TYPES = ["stdio", "streamable_http"] as const;
export const SERVER_AUTH_TYPES = ["none", "bearer", "api_key", "oauth", "custom_headers"] as const;
export const TOKEN_PROFILES = ["generic_o200k", "generic_cl100k", "raw_json_rough"] as const;
export const PROVIDER_KINDS = ["anthropic", "openai", "google", "openai_compatible", "ollama"] as const;
export const RUN_MODES = ["automated", "interactive"] as const;
export const RUN_STATUSES = ["pending", "running", "completed", "stopped", "error", "aborted"] as const;
export const RUN_OUTCOMES = ["completed", "stopped_guardrail", "context_overflow", "error", "aborted"] as const;
export const RUN_STEP_TYPES = ["llm_request", "llm_response", "tool_call", "tool_result", "context_event"] as const;
```

### Severity/Status Already in Use

| Domain | Field | Values | Usage |
| --- | --- | --- | --- |
| Scans | `ScanEventLevel` | `info` \| `warning` \| `error` | Event logging during discovery |
| Scans | `ScanStatus` | `running` \| `success` \| `failed` | Scan execution state |
| Optimization | Suggestion severity | `warn` \| `info` | Rule-based findings (client-computed) |
| Runs | `RunStatus` | `pending` \| `running` \| `completed` \| `stopped` \| `error` \| `aborted` | Run lifecycle |
| Runs | `RunOutcome` | `completed` \| `stopped_guardrail` \| `context_overflow` \| `error` \| `aborted` | Run result reason |
| Run steps | Step status | `ok` \| `error` \| `running` | Individual step state |

---

## 7. GUARDRAILS FRAMEWORK

### Existing Guardrail Pattern (for Agentic Runs)

**Location:** `apps/api/src/testing/guardrails.ts`

**Quote:**
```typescript
export type GuardrailConfig = {
  maxTurns?: number;
  maxToolCalls?: number;
  maxTokens?: number;
  maxContextTokens?: number;
  maxCostUsd?: number;
};

export type GuardrailState = {
  turns: number;
  toolCalls: number;
  tokens: number;
  contextTokens: number;
  costUsd: number;
  tripped?: keyof GuardrailConfig;
};

export function check(state: GuardrailState, cfg: GuardrailConfig): GuardrailState["tripped"] {
  if (cfg.maxToolCalls && state.toolCalls >= cfg.maxToolCalls) return "maxToolCalls";
  if (cfg.maxTokens && state.tokens >= cfg.maxTokens) return "maxTokens";
  if (cfg.maxContextTokens && state.contextTokens >= cfg.maxContextTokens) return "maxContextTokens";
  if (cfg.maxCostUsd && state.costUsd >= cfg.maxCostUsd) return "maxCostUsd";
  return undefined;
}
```

**Pattern:** Guardrails are boolean checks (did we trip?) not severity/verdicts. Use for budget enforcement, not compatibility verdicts.

---

## 8. CONVENTIONS FOR NEW MODEL-COMPATIBILITY TEST SUITE

### Naming & Organization

- **New check type:** Introduce as `ModelCompatibilityCheck` or `ToolCompatibilityTest` (distinct from `Suggestion` and `ScanEvent`)
- **Severity enum:** Follow existing pattern — lowercase literals in const array, then type union
  - Suggested: `"fail" | "warn" | "info"` (three-tier, matching scan events but with "fail" for hard errors)
  - OR: `"incompatible" | "warn" | "info"` (domain-specific vocabulary)
- **Result type:** Mimic `Suggestion` structure but for model-compatibility
  - Include: id, label, severity, details/context, applicable_profiles (which token profiles or providers)

### Storage Approach

- **Option A (Ephemeral):** Compute client-side like `Suggestion` — only during scan detail view
- **Option B (Persisted):** Add `mcp_tool_compatibility_checks` table, linked to `mcp_tool_scans`, with columns:
  ```sql
  id TEXT PRIMARY KEY,
  tool_scan_id TEXT NOT NULL REFERENCES mcp_tool_scans(id),
  check_id TEXT NOT NULL,        -- e.g., "missing-annotation", "schema-too-deep"
  severity TEXT CHECK (severity IN ('fail', 'warn', 'info')),
  message TEXT,
  details_json TEXT,             -- nested data
  created_at TEXT NOT NULL
  ```

### Test Catalog Schema

- Store as JSON in `packages/shared` (or new `packages/model-compatibility-catalog`)
- Structure:
  ```typescript
  export type ModelCompatibilityCheckSpec = {
    id: string;
    category: "schema" | "annotation" | "behavior" | "performance";
    title: string;
    description: string;
    applicable_to: ("all_models" | "claude" | "gpt" | "gemini" | specific model list)[];
    default_severity: "fail" | "warn" | "info";
    check_fn: (tool: NormalizedToolDefinition) => CompatibilityIssue | null;
  };

  export type CompatibilityIssue = {
    id: string;
    severity: "fail" | "warn" | "info";
    message: string;
    remedy?: string;
  };
  ```

### Service Layer

- New domain: `apps/api/src/compatibility/`
  - `compatibility-checks.ts` — catalog of check functions
  - `compatibility-service.ts` — orchestrates checks against a tool or scan
  - `compatibility-repository.ts` (if persisting) — CRUD for check results
  - `compatibility-routes.ts` — new endpoints if needed

### API Endpoints (Sketch)

```
POST /api/tools/:toolId/check       # Run compatibility checks on a tool
GET  /api/scans/:scanId/compatibility # All tools + all checks
GET  /api/compatibility/catalog     # Fetch check specs for UI
```

### Recommended Severity Vocabulary for Compatibility

Use **three-tier** to match `ScanEventLevel`:

| Level | Meaning | UI Treatment |
| --- | --- | --- |
| `fail` | Model cannot use this tool (incompatible feature, missing required field) | Red icon, top priority |
| `warn` | Tool may not work correctly with some models (suboptimal schema, missing description) | Yellow/orange icon, actionable |
| `info` | Optimization or best-practice tip (no functional impact) | Blue icon, informational |

---

## References

**Key files:**
- Shared types: `/packages/shared/src/types.ts`
- Shared constants/enums: `/packages/shared/src/constants.ts`
- Database schema: `/apps/api/src/db/schema.ts`
- Scans service: `/apps/api/src/scans/service.ts`
- Optimization suggestions: `/apps/web/src/lib/optimize.ts`
- Token counting: `/apps/api/src/token-counting/profiles.ts`, `types.ts`, `provider-shapes.ts`
- Guardrails: `/apps/api/src/testing/guardrails.ts`
- Testing roadmap: `/roadmap/09-testing.md`

# Citations

None.
