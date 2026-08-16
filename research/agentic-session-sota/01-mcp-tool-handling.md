# 01 — State of the art: MCP server & tool handling (client-side)

Verified against live spec/docs 2026-07-17. Sources: modelcontextprotocol.io (spec 2025-11-25 +
changelog + blog), platform.claude.com (tool-use docs), code.claude.com/docs (Claude Code MCP),
developers.openai.com, docs.windsurf.com. This doc states the facts and what the Hub adopts;
normative requirements live in `roadmap/assistant-hub/requirements.md` (R-MCP*).

## 1. Spec posture: pin 2025-11-25, abstract the parts the next revision deletes

- Current stable revision: **2025-11-25**. A **2026-07-28 release candidate** ships final ~2
  weeks after this research: it **removes `initialize` and protocol sessions** (`Mcp-Session-Id`
  gone; client identity travels in `_meta`; new `server/discover`; `Mcp-Method`/`Mcp-Name`
  headers), reworks **Tasks** (polling `tasks/get`, no blocking `tasks/result`), stabilizes an
  **Extensions framework** and makes **MCP Apps** (server-shipped sandboxed HTML UIs) an official
  extension, adds list-result **caching hints** (`ttlMs`, `cacheScope`) and deterministic
  `tools/list` ordering for prompt-cache friendliness, and **deprecates roots, sampling, logging
  and HTTP+SSE** (≥12-month window).
- Consequence: keep every handshake/session assumption inside the app's existing MCP client
  layer; build **no new feature on roots/sampling**; treat tools/prompts/resources/elicitation/
  progress as the durable core. (R-MCP10)

## 2. Tool annotations → permission defaults (with the trust rule)

- `ToolAnnotations`: `readOnlyHint` (default **false**), `destructiveHint` (default **true**),
  `idempotentHint` (false), `openWorldHint` (**true**), `title`. Defaults matter: an
  **unannotated tool is a destructive open-world write** by spec default.
- The spec is explicit: annotations are **untrusted hints** — "clients should never make tool use
  decisions based on ToolAnnotations received from untrusted servers." The reference pattern is
  ChatGPT Developer Mode: anything without `readOnlyHint` is treated as a write and **confirmed
  per call**, with inspectable JSON payloads; "remember approval" is conversation-scoped.
- Hub adoption: annotations **inform display and defaults, never silently escalate** — auto-run
  eligibility requires `readOnlyHint` AND owner-trusted server; everything else asks; deletes/
  destructive always ask (consistent with the dock's D-AS4 posture). The app already **scans,
  token-meters and diffs annotations** (`mcp_tool_scans.annotations`, `annotationsTokens`,
  `annotationsChanged`) — the approval card can show them with zero new plumbing. (R-MCP3)

## 3. Scaling tool counts: deferred loading + tool search is the solved pattern

- **Anthropic API**: `defer_loading: true` per tool + a server-side search tool
  (`tool_search_tool_regex_20251119` / `_bm25_`); discovered tools enter context as
  `tool_reference` blocks auto-expanded by the API; up to 10,000 deferred tools. Published
  numbers: **~85% context reduction** (55K-token multi-server setup → 3–5 loaded tools) and MCP-
  eval accuracy **49%→74% (Opus 4)**, 79.5%→88.1% (Opus 4.5). Guidance: defer when >10 tools /
  >10K tokens; keep 3–5 hot tools resident.
- **Claude Code**: deferred MCP tools are **ON BY DEFAULT** — only names + server instructions
  load at start; a `ToolSearch` tool discovers definitions on demand; `ENABLE_TOOL_SEARCH=
  true|false|auto|auto:N` (auto = load eagerly if all definitions fit within ~10% of the context
  window); per-server `alwaysLoad: true` and per-tool `_meta anthropic/alwaysLoad` pins.
- Legacy alternative: hard caps (Cursor ~40 active tools, Windsurf 100) + manual toggles.
- Hub adoption: the app **already has** `TOOL_LOADING_MODES = ["eager","deferred"]` with an
  on-demand discovery tool in the run engine. The Hub makes it a per-session choice with the
  Claude-Code auto heuristic, per-server/tool pins — and, uniquely, **shows the measured context
  savings live** (the app's whole reason to exist). (R-MCP2)

## 4. Mid-call interactivity: elicitation, progress, cancellation

- **Elicitation** (`elicitation/create`): *form mode* — flat object of primitives (string w/
  format/pattern, number, boolean, single/multi-select enums, defaults; **no nesting**);
  *URL mode* (2025-11-25) — out-of-band interactions with `elicitationId` +
  `notifications/elicitation/complete`, error `-32042` for elicitation-gated calls. Client UX
  MUSTs: show which server asks, decline/cancel affordances, review-before-send, **never collect
  credentials via form mode**, display the full URL, never auto-open/prefetch, highlight domain.
- Hub adoption: the app already generates forms from JSON schemas (tool playground,
  `schema-params.ts`) — elicitation renders through the same generator; the session enters the
  Unified-Sessions `waiting_input` phase with the wait budget running. (R-MCP4)
- **Progress**: `_meta.progressToken` → `notifications/progress {progress, total?, message?}`
  (monotonic, rate-limited). **Cancellation**: `notifications/cancelled` fire-and-forget. Hub:
  progress bar + message on the running tool part; a cancel control on every cancellable tool;
  elapsed ticker regardless (B2/R-UX3). (R-MCP5)
- **Tasks** (experimental 2025-11-25, reworked in the RC): treat as watch-item; the Hub's own
  long-running story is missions + SessionClock, not MCP tasks. (deferred)

## 5. Results: structured output, two error channels, output caps

- `outputSchema` + `structuredContent` (JSON Schema 2020-12; text block mirrored for
  back-compat) → validate and render **typed** (tables/values), don't re-stringify.
- Two error channels: protocol errors vs `isError: true` execution errors — execution errors go
  **back to the model** for self-correction (SEP-1303 makes input-validation errors execution
  errors on purpose).
- Output caps (Claude Code reference numbers): **warn at 10K tokens, hard cap 25K**
  (`MAX_MCP_OUTPUT_TOKENS`), server-declared per-tool ceiling honored to 500K chars, oversized
  results **spilled to disk and replaced by a file reference**. Hub: same numbers as env
  defaults; spill target = the session workspace; per-call request/response tokens metered (the
  playground already measures this). (R-MCP6, R-MCP7)

## 6. Prompts and resources are UI surfaces, not just protocol

- **Prompts** are "user-controlled" by definition; the canonical surfacing is **slash commands**
  (Claude Code: `/mcp__server__prompt [args]`, dynamically discovered, args parsed per
  definition). The app already persists `mcp_prompt_scans` — the Hub's composer command menu
  lists them offline and refreshes live. (R-MCP8)
- **Resources**: `resources/list` + RFC 6570 templates + `completion/complete`;
  `subscribe`/`updated` for live context; annotations `audience`/`priority`/`lastModified` rank
  auto-inclusion. Claude Code surfaces them as @-mentions with fuzzy autocomplete. The app
  already persists `mcp_resource_scans`. Hub: resource picker in the composer (@-mention),
  attached resources become **metered context**; auto-inclusion stays off by default. (R-MCP9)

## 7. Auth, security, transparency

- OAuth stack (2025-11-25): RFC 9728 protected-resource metadata (+ header-optional fallback),
  RFC 8414/OIDC discovery, PKCE S256-or-refuse, RFC 8707 `resource`, registration order
  pre-registered → **CIMD** → DCR → manual, incremental scopes via 403 `insufficient_scope`.
  The app's `oauth/` module already implements the discovery/PKCE flow — reuse untouched.
- Security MUSTs a client owns: **no token passthrough**, HTTPS-only + private-IP blocking on
  server-provided URLs, reject `javascript:`/`data:`/`file:` schemes, show exact stdio commands
  untruncated before launch (server registration stays a Settings/owner act — sessions never
  register servers). (R-MCP12)
- Transparency: per-server status chip (connected / OAuth needed / error, reconnect with
  backoff, `list_changed` honored live), server/tool **icons** (SEP-973) where provided.
  (R-MCP11)

## 8. Anthropic advanced tool use (engine-side options for the Hub's AI-SDK path)

- **Parallel tool use** is default-on for Claude 4+ (all `tool_result`s in one user message).
- **`input_examples`** (launch beta `advanced-tool-use-2025-11-20`): published 72%→90% accuracy
  on complex parameters — worth adding to hub built-in tool definitions.
- **Programmatic tool calling** (code-execution container calls tools; results bypass model
  context; 24–37% token savings): powerful but container-coupled — **deferred** for the Hub
  (missions already fan out without it).
- **Context editing** (`context-management-2025-06-27`: clear_tool_uses/clear_thinking) and
  **server-side compaction** (`compact-2026-01-12`): the Hub's own compaction (R-SES8) is
  engine-agnostic across 6 provider kinds, so these are provider-specific accelerators, not the
  design. **Memory tool** (`memory_20250818`, GA): validates the propose-then-save file-backed
  memory pattern (D-AH11).
- **Fine-grained tool streaming**: per-tool `eager_input_streaming: true` — relevant to showing
  large tool inputs as they stream (R-UX1 input-streaming state).

## What the Hub adopts (summary → R-MCP1…12)

Grants per server **and per tool** (D-AH7) · deferred loading + tool-search with live savings
display (dogfood) · annotation-informed approval defaults with the untrusted-hint rule ·
elicitation via the existing form generator + `waiting_input` · progress/cancel on tool parts ·
structured-output typed rendering + model-visible execution errors · 10K/25K output caps with
workspace spill · prompts as slash commands · resources as attachable metered context · OAuth
reuse · security MUSTs · spec-revision isolation. Deferred: MCP tasks extension, MCP Apps
extension, programmatic tool calling, sampling/roots (deprecated).
