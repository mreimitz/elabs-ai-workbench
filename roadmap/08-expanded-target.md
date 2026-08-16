# 08 Expanded Target (north star)

This document defines the expanded product target that supersedes the original "non-goals"
framing. It is the planning reference for Phase 2. Phase 1 (startup-footprint scanning) is the
foundation; the items here build on it.


> **Status (in progress):** the tool playground (schema-generated form → `tools/call` → result) and runtime request/response token measurement are now implemented. Cross-server tool-level compare and resource/prompt footprint remain.

## Summary of the four targets

1. **Tool playground** — schema → generated form → `tools/call` → result.
2. **Runtime token accounting** — measure request + response token cost of a tool call.
3. **Cross-server comparison** — server-level and **tool-level** diff across two *different* servers.
4. **UI/UX redesign** — operator-grade, dense, table-first across all screens.

Build order roughly follows that list; (4) runs alongside as each surface is built.

---

## 1. Tool playground (schema → form → execute → result)

**Goal:** from a scanned/connected server, pick a tool, render a form generated from its
`inputSchema`, let the user fill it, execute the tool, and show the result.

**Flow**
- Source of the schema: the normalized tool definition already captured by a scan
  (`mcp_tool_scans.input_schema_json`) or a live `tools/list` for the selected server.
- Generate the form from JSON Schema: map types to controls — string→text, `enum`→Select/ChoiceGrid,
  boolean→toggle, number/integer→numeric, object→nested group, array→repeatable group; honor
  `required`, `default`, `format`, and show `description` as field help. Reuse `brand-ui` form
  primitives (`Field`, `FormGrid`, `TextInput`, `Select`, `SegmentedControl`, `ChoiceGrid`).
- Validate the assembled arguments against the schema before submit.
- **Execute in the API** (new endpoint, e.g. `POST /api/servers/:id/tools/:toolName/call`) which
  opens an MCP connection and issues `tools/call`. The browser never calls the MCP server directly.
- Present the result (content blocks, structured content, `isError`) using `CodeViewer` for raw
  payloads and a readable rendering for text/structured output.

**Constraints**
- Honor the runtime/security boundary and secret rules (`.claude/rules/mcp-and-security.md`):
  arguments may contain user secrets — don't log full payloads in cleartext, don't echo saved
  secrets back, treat tool output as untrusted.
- Calling a tool may have real side effects on the target server — make execution explicit
  (a deliberate "Execute" action), surface `annotations` hints (e.g. read-only vs destructive)
  where available, and confirm before destructive-looking calls.

## 2. Runtime token accounting

**Goal:** quantify what a *call* costs, not just the definition.

- Measure tokens + raw bytes for the **request** (tool name + serialized arguments, in the chosen
  provider shape) and the **response** (content/structured output), reusing the existing
  `TokenCounter` interface and profiles (`apps/api/src/token-counting/`). Extend
  `04-token-counting-strategy.md` scope from "definition only" to "definition + runtime call".
- Show definition footprint and per-call cost together so the user sees total context impact.
- Persist execution history so calls can be reviewed/compared (see data model below).

## 3. Cross-server comparison (server- and tool-level)

**Goal:** compare two *different* MCP servers, not just two scans of one server.

- **Server level:** totals and deltas (tool count, total tokens, average tokens/tool, largest
  tool) between a scan of server A and a scan of server B.
- **Tool level:** match tools across servers (by exact name, then fuzzy/normalized name) and show
  added/removed/common tools, with per-tool token deltas and schema/description differences for
  common tools.
- Generalize the existing same-server compare logic (`apps/web/src/lib/compare.ts` +
  `apps/api/src/reports`) so a comparison takes two arbitrary `scanId`s (or server+latest-scan)
  regardless of whether they share a `server_id`. The current implementation assumes one server —
  lift that assumption rather than forking a parallel path.

## 4. UI/UX redesign

The current UI works but is rough. Target an operator-grade experience per `05-ui-plan.md`:
dense, table-first, clear hierarchy, real empty/error/loading states, both themes correct,
keyboard-accessible. Add screens/surfaces for the tool playground and cross-server comparison.
Keep everything in the component library (`library-first.md`).

---

## Data model implications

New tables (extend `03-data-model.md`; create/migrate in `apps/api/src/db/schema.ts`):

- **`tool_executions`** — one tool call: `id`, `server_id`, `tool_name`, `token_profile`,
  `arguments_json` (consider redaction/retention), `status`, `started_at`, `duration_ms`,
  `request_tokens`, `request_bytes`, `response_tokens`, `response_bytes`, `result_json`,
  `is_error`, `error_message`.
- Optionally **`server_comparisons`** if comparisons need to be saved/shared; otherwise compute
  on the fly from two `scanId`s.

Keep the repository/service/routes layering and add the wire types/schemas to
`packages/shared` **first**.

## API additions (sketch)

```
POST /api/servers/:id/tools/:toolName/call     # execute a tool, return result + token cost
GET  /api/servers/:id/executions               # execution history
GET  /api/executions/:id                        # one execution detail
GET  /api/compare?a=:scanId&b=:scanId           # cross-server (and same-server) comparison
```

Names are indicative — finalize types in `packages/shared/src/{types,schemas}.ts` before
implementing.

## Risks / open questions

- **Side effects & safety:** executing arbitrary tools can mutate external systems. Decide on
  confirmations, a dry-run/read-only affordance, and how much to lean on tool `annotations`.
- **Secret/argument retention:** how long to keep `arguments_json`/`result_json`, and whether to
  redact. Default to minimal retention and never store known secret fields in cleartext.
- **Schema coverage:** real-world JSON Schemas use `oneOf`/`anyOf`/`$ref`/conditionals. Define how
  far the generated form goes vs. falling back to a raw-JSON editor for unsupported shapes.
- **Tool matching across servers:** exact-name first; define the fuzzy-match rule and how to show
  ambiguous matches.
