import {
  API_TOKEN_ROUTE_SCOPES,
  WORKBENCH_MCP_DEFAULT_LIST_LIMIT,
  WORKBENCH_MCP_MAX_LIST_LIMIT,
  WORKBENCH_MCP_MOUNT_PATH,
  WORKBENCH_MCP_RESOURCE_TEMPLATES,
  WORKBENCH_MCP_SERVER_NAME,
  WORKBENCH_MCP_SERVER_VERSION,
  WORKBENCH_MCP_TOOL_FAMILIES,
  WORKBENCH_MCP_TOOL_SCOPES,
  type ApiTokenScope,
  type WorkbenchMcpToolName,
} from "@mcp-token-footprint/shared";
import { workbenchMcpDefinitionTokenBudget } from "../data-pack/thresholds.js";

// ==================================================================================================
// Workbench MCP server — the `llms.txt`-style usage doc (planning/Roadmap/RM-08-ci/mcp-server.md, WP M.4)
// ==================================================================================================
// Served as plain text at `GET /api/mcp/llms.txt`: the one page an external agent (or the human
// pointing one at this bench) reads to learn what lives behind the mount and how to reach it.
//
// **Everything enumerable is DERIVED, never retyped.** The tool list comes from the definitions the
// server actually registers (name + the same description `tools/list` returns), grouped by
// `WORKBENCH_MCP_TOOL_FAMILIES`; the resource templates, the limit semantics and the definition
// budget come from the shared contract. A tool added to the mount therefore appears here on the next
// request, and a tool renamed cannot leave a stale name behind — the failure mode this file exists to
// avoid is a doc that confidently advertises a call that no longer exists.
//
// **No secrets, no local paths.** The document names endpoints, tools and URI templates only. The one
// piece of request-derived text is the host the reader dialed (so the printed URL is the one that
// works from where they are), and it is validated against a strict host pattern before it is echoed.

/** What the renderer needs from one registered tool — deliberately the `tools/list` projection. */
export type WorkbenchLlmsTxtTool = {
  name: WorkbenchMcpToolName;
  description: string;
};

export type WorkbenchLlmsTxtInput = {
  /** Origin the reader reached this instance on, e.g. `http://127.0.0.1:8080`. */
  origin: string;
  /** Every tool the mount registers, in registration order. */
  tools: readonly WorkbenchLlmsTxtTool[];
};

/** The origin printed when the request carries no usable `Host` header (the app's documented dev URL). */
export const WORKBENCH_MCP_DEFAULT_ORIGIN = "http://127.0.0.1:8080";

/**
 * A host is only echoed back into the served document when it looks like a host: letters, digits,
 * dots, dashes, an optional port, or a bracketed IPv6 literal. Anything else (a header carrying
 * whitespace, a newline, markup) falls back to the documented default rather than being reflected —
 * a served document is not the place to trust a client-supplied string.
 */
const SAFE_HOST = /^[A-Za-z0-9.-]+(:\d{1,5})?$|^\[[0-9A-Fa-f:.]+\](:\d{1,5})?$/;

/** Resolve the origin to print, from a request's `Host` header + whether it arrived over TLS. */
export function resolveDocumentOrigin(host: string | undefined, secure = false): string {
  if (!host || !SAFE_HOST.test(host)) return WORKBENCH_MCP_DEFAULT_ORIGIN;
  return `${secure ? "https" : "http"}://${host}`;
}

/**
 * The scope a token needs merely to OPEN the mount, read out of the shared route table rather than
 * retyped (D-MCP8). If someone ever removes the rule, this reads "an execute" — which is what the
 * coarse method rule would then actually demand — instead of confidently advertising a stale `read`.
 */
function mountScopeNames(): readonly ApiTokenScope[] {
  const rule = API_TOKEN_ROUTE_SCOPES.find(
    (candidate) => candidate.method === "POST" && candidate.path === WORKBENCH_MCP_MOUNT_PATH,
  );
  return rule ? rule.scopes : [];
}

function mountScopeSentence(): string {
  const scopes = mountScopeNames();
  return scopes.length > 0 ? scopes.map((scope) => `\`${scope}\``).join(" or ") : "an execute";
}

/**
 * The per-tool scope lines, derived from `WORKBENCH_MCP_TOOL_SCOPES` over the tools THIS instance
 * registers. When every tool wants the same scope as the door itself, that collapses to one sentence;
 * once a tool asks for MORE (WP M.3's write tools) it becomes a real per-tool list — derived, so this
 * file never needs editing when the surface grows.
 *
 * The "plus" is stated explicitly, because it is the one thing a token-minting operator gets wrong
 * (D-MCP8): an execute scope on its own cannot even open this endpoint, so a write-capable agent needs
 * `read` AND the execute scope, not the execute scope instead of `read`.
 */
function toolScopeLines(tools: readonly WorkbenchLlmsTxtTool[]): string[] {
  const scoped = tools.map((tool) => ({
    name: tool.name,
    scope: WORKBENCH_MCP_TOOL_SCOPES[tool.name],
  }));
  const doorScopes = new Set<string>(mountScopeNames());
  const beyondDoor = scoped.filter(
    (entry) => entry.scope !== undefined && !doorScopes.has(entry.scope),
  );
  if (beyondDoor.length === 0) {
    const distinct = [...new Set(scoped.map((entry) => entry.scope))];
    const only = distinct[0];
    if (distinct.length === 1 && only !== undefined) {
      return [
        `- Every tool on this server needs the \`${only}\` scope — nothing here asks for more.`,
      ];
    }
    return [];
  }
  return [
    "- Most tools need nothing beyond that door scope. These ask for one MORE scope ON TOP of it —",
    "  a token needs BOTH, and an execute scope on its own cannot open this endpoint at all:",
    ...beyondDoor.map((entry) => `  - ${entry.name} — \`${entry.scope}\` plus ${mountScopeSentence()}`),
  ];
}

/** Render the usage doc. Pure — same inputs, same bytes. */
export function buildWorkbenchLlmsTxt(input: WorkbenchLlmsTxtInput): string {
  const mountUrl = `${input.origin}${WORKBENCH_MCP_MOUNT_PATH}`;
  const byName = new Map(input.tools.map((tool) => [tool.name, tool]));
  const mountScope = mountScopeSentence();
  const scopeLines = toolScopeLines(input.tools);
  const lines: string[] = [];

  lines.push(
    `# ${WORKBENCH_MCP_SERVER_NAME} — workbench MCP server (v${WORKBENCH_MCP_SERVER_VERSION})`,
    "",
    "> This page is generated from the running server's own contract, so every tool, resource",
    "> template and limit below is the surface THIS instance serves right now.",
    "",
    "## What this is",
    "",
    "AI Workbench measures what MCP servers and Agent Skills cost inside a model's context, drives",
    "them through real agent sessions, grades the answers, and keeps the history. This endpoint is",
    "the workbench itself, exposed over the Model Context Protocol: an agent or a CI job can read",
    "everything it has already measured without opening the browser UI.",
    "",
    "It is the analyzer, not the analyzed. Servers you registered for scanning are DATA here; the",
    "tools below read the measurements, they do not proxy the other servers' tools.",
    "",
    "## Connect",
    "",
    `- URL: ${mountUrl}`,
    "- Transport: streamable HTTP, stateless. POST only — GET and DELETE answer 405 (there is no",
    "  session to resume and no server-initiated stream to subscribe to).",
    "- Auth: none from localhost, matching the rest of this app's local trust posture. From any",
    `  other machine, send Authorization: Bearer mcpfp_… — see "Access & scopes" below.`,
    `- Claude Code: claude mcp add --transport http workbench ${mountUrl}`,
    '- Any host with a JSON config (Cursor, Claude Desktop, …): { "mcpServers": { "workbench":',
    `  { "type": "http", "url": "${mountUrl}" } } }`,
    "- CI / curl: POST a JSON-RPC envelope with",
    '  accept: application/json, text/event-stream — e.g. {"jsonrpc":"2.0","id":1,',
    '  "method":"tools/list","params":{}}',
    "- Turned off? Settings › Features › Workbench MCP server. While off, every request here",
    '  answers 403 with code "feature_disabled" — including this page.',
    "",
    "## What it does, and what it never does",
    "",
    "Most of this surface reads. A few tools act, and they say so in their own descriptions: they",
    "cost real wall-clock time or real provider spend, each needs its own scope on top of the door",
    "scope, and each answers with a ticket to poll rather than blocking — see the Actions family",
    "below, if this instance has one.",
    "",
    "Nothing here deletes anything, prunes anything, revokes anything, edits configuration, or",
    "manages tokens — at any scope, at any phase. No handler returns a secret value either: server",
    "configs come back redacted (booleans saying whether an env/header secret or a GitHub token is",
    "set, never the value).",
    "",
    "## Access & scopes",
    "",
    "- From localhost: no credential, and no scope check. Every tool below is reachable.",
    `- From anywhere else: a service token is required, and it must carry the ${mountScope} scope just`,
    "  to open this endpoint — initialize and tools/list are reads, so a token without it cannot",
    "  speak the protocol here at all.",
    ...scopeLines,
    "- No token can delete anything, and no token can manage tokens. Neither is switchable.",
    "- Refused? The reply names the scope it wanted. Ask the operator to create a token with it in",
    "  Settings › API tokens; a token's scopes are fixed when it is created.",
    "",
    "## Tools",
    "",
    `${input.tools.length} tools, grouped by what they answer.`,
    "",
  );

  for (const family of WORKBENCH_MCP_TOOL_FAMILIES) {
    lines.push(`### ${family.label}`, "", family.when, "");
    for (const name of family.tools) {
      const tool = byName.get(name);
      // A family naming an unregistered tool is a gate failure elsewhere (the shared partition test);
      // here we simply never print a tool the server does not actually have.
      if (!tool) continue;
      lines.push(`- ${tool.name} — ${tool.description}`);
    }
    lines.push("");
  }

  lines.push(
    "## Resources",
    "",
    "The long documents are resources rather than tool results, so a host can pull one on demand",
    "instead of paying for it inside every answer. `resources/list` enumerates the runs and scans",
    "this instance actually holds; these are the templates:",
    "",
    ...Object.values(WORKBENCH_MCP_RESOURCE_TEMPLATES).map((template) => `- ${template}`),
    "",
    "## List semantics",
    "",
    `- Every list-shaped tool takes an optional limit. Default ${WORKBENCH_MCP_DEFAULT_LIST_LIMIT}, hard maximum ${WORKBENCH_MCP_MAX_LIST_LIMIT} —`,
    "  a larger value is a validation error, not a dump.",
    '- Every list result carries total and truncated, so "8 servers" is never confused with "the',
    '  first 8 of 400". When truncated is true, narrow the query or page with offset where the tool',
    "  offers one (scans_tools).",
    "- Ids are opaque strings. Start from a list tool, then drill in — do not construct ids.",
    "",
    "## Definition footprint",
    "",
    "This server pays attention to what it costs you, because measuring that is its day job. The",
    `serialized tools/list payload is held under a budget of ${workbenchMcpDefinitionTokenBudget()} tokens under the app's`,
    "default tokenizer profile — the price of knowing this server exists, paid on every conversation.",
    "The budget is asserted by the test suite and by a CI job that points the app's own discovery",
    "scanner at this mount (pnpm mcp:self-scan), so the number is measured, never assumed.",
    "",
  );

  return `${lines.join("\n")}\n`;
}
