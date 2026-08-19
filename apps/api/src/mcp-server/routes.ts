import { WORKBENCH_MCP_LLMS_TXT_PATH, WORKBENCH_MCP_MOUNT_PATH } from "@mcp-token-footprint/shared";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { buildWorkbenchLlmsTxt, resolveDocumentOrigin } from "./llms-txt.js";
import { createWorkbenchMcpServer } from "./server.js";
import { buildWorkbenchToolDefinitions, type WorkbenchMcpDeps } from "./tools.js";

// ==================================================================================================
// Workbench MCP server — the Fastify mount (D-MCP1)
// ==================================================================================================
// Streamable HTTP on `/api/mcp`, served by the SAME Fastify process as every other route: no sidecar,
// no second port, no second copy of the repositories.
//
// **Stateless** (`sessionIdGenerator: undefined`, `enableJsonResponse: true`): a fresh `McpServer` +
// transport per POST, closed when the request settles. The surface is read-only, so the server never
// initiates a notification and there is nothing for a session to hold between requests — a session map
// would only add memory, an eviction policy, and a way to leak. It also makes the mount trivially
// safe under the app's restart-and-reconcile posture: there is no session to orphan.
//
// Because the mount is stateless, the two session-shaped verbs answer **405**:
//   • `GET`    — the standalone SSE stream exists to deliver server-initiated messages; a read-only
//                stateless server has none. The MCP client SDK treats 405 on GET as "this server does
//                not offer that", which matters because the app's own MCP client will scan this mount.
//   • `DELETE` — session termination, when there is no session to terminate.
//
// **Feature flag (D-MCP6):** `/api/mcp` is claimed by the `mcp_server` feature in
// `packages/shared/src/feature-flags.ts`. The root `onRequest` guard `registerFeatureRoutes` installs
// in `index.ts` therefore 403s every verb here while the switch is off — including this file's own 405
// answers — with no code in this module. A test proves it rather than assuming it.

/** JSON-RPC "method not allowed" body — same shape the SDK's own transport returns for a bad verb. */
const METHOD_NOT_ALLOWED = {
  jsonrpc: "2.0" as const,
  error: { code: -32000, message: "Method Not Allowed" },
  id: null,
};

export function registerWorkbenchMcpRoutes(app: FastifyInstance, deps: WorkbenchMcpDeps): void {
  app.post(WORKBENCH_MCP_MOUNT_PATH, async (request: FastifyRequest, reply: FastifyReply) => {
    const server = createWorkbenchMcpServer(deps);
    const transport = new StreamableHTTPServerTransport({
      // Stateless — see the banner. `enableJsonResponse` makes a request/response POST answer with a
      // plain JSON body instead of a one-shot SSE stream.
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    // Hand the raw socket to the transport and take the reply out of Fastify's hands, so Fastify does
    // not also try to send a response over the one the transport is writing.
    reply.hijack();
    reply.raw.on("close", () => {
      void transport.close().catch(() => undefined);
      void server.close().catch(() => undefined);
    });

    try {
      await server.connect(transport);
      // Pass the body Fastify ALREADY parsed: the request stream is consumed by the time we get here,
      // so letting the transport re-read it would hang.
      await transport.handleRequest(request.raw, reply.raw, request.body);
    } catch (error) {
      request.log.error({ err: error }, "Workbench MCP request failed");
      // Never leak a stack trace to the client. If the transport already started the response there is
      // nothing left to say — just end the socket.
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { "content-type": "application/json" });
        reply.raw.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal server error" },
            id: null,
          }),
        );
      } else {
        reply.raw.end();
      }
      void transport.close().catch(() => undefined);
      void server.close().catch(() => undefined);
    }
  });

  const methodNotAllowed = async (_request: FastifyRequest, reply: FastifyReply) =>
    reply.code(405).header("allow", "POST").send(METHOD_NOT_ALLOWED);

  app.get(WORKBENCH_MCP_MOUNT_PATH, methodNotAllowed);
  app.delete(WORKBENCH_MCP_MOUNT_PATH, methodNotAllowed);

  // ── The agent-onboarding doc (WP M.4) ────────────────────────────────────────────────────────
  // `llms.txt`-style plain text at `/api/mcp/llms.txt`, so a host that finds the mount can also find
  // out what is behind it without a browser. It sits UNDER the mount path on purpose: the
  // `mcp_server` feature's `/api/mcp` prefix therefore covers it with no second declaration, so the
  // doc disappears with the endpoint it documents (proven by a test, not assumed).
  //
  // The tool list is rebuilt from `buildWorkbenchToolDefinitions` per request — the same definitions
  // the MCP server registers, so name and description can never drift from `tools/list`. Building
  // them is ~20 closures over repository handles that already exist; nothing here touches the DB.
  app.get(WORKBENCH_MCP_LLMS_TXT_PATH, async (request: FastifyRequest, reply: FastifyReply) => {
    const document = buildWorkbenchLlmsTxt({
      origin: resolveDocumentOrigin(request.headers.host, request.protocol === "https"),
      tools: buildWorkbenchToolDefinitions(deps).map((definition) => ({
        name: definition.name,
        description: definition.description,
      })),
    });
    return reply.type("text/plain; charset=utf-8").send(document);
  });
}
