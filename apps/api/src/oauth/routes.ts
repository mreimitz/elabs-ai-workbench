import type { FastifyInstance } from "fastify";
import { oauthStartRequestSchema } from "@mcp-token-footprint/shared";
import type { OAuthService } from "./service.js";

export async function registerOAuthRoutes(app: FastifyInstance, oauth: OAuthService) {
  app.post("/api/oauth/start", async (request) => {
    const { serverId, oauthClient } = oauthStartRequestSchema.parse(request.body);
    return oauth.start(serverId, oauthClient);
  });

  app.get("/api/oauth/status/:serverId", async (request) => {
    const { serverId } = request.params as { serverId: string };
    return oauth.status(serverId);
  });

  app.delete("/api/oauth/status/:serverId", async (request) => {
    const { serverId } = request.params as { serverId: string };
    return oauth.clear(serverId);
  });

  app.get("/api/oauth/callback", async (request, reply) => {
    const query = request.query as { code?: string; state?: string; error?: string };
    const result = await oauth.finish(query);
    reply.header("content-type", "text/html; charset=utf-8");
    return renderCallbackPage(result.ok, result.message, result.serverId);
  });
}

function renderCallbackPage(ok: boolean, message: string, serverId?: string): string {
  const title = ok ? "Authentication complete" : "Authentication failed";
  const escapedTitle = escapeHtml(title);
  const escapedMessage = escapeHtml(message);

  // Fast-path the reauth modal that opened this popup: notify the opener (same-origin, payload
  // carries NO secrets) and close. The opener also polls /api/oauth/status, so this is best-effort —
  // if there's no opener (a plain tab) the page just shows the result + the Return link.
  const signalScript = `<script>
    (function () {
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(
            { type: "mcp-oauth-callback", serverId: ${JSON.stringify(serverId ?? null)}, ok: ${ok ? "true" : "false"} },
            window.location.origin
          );
          setTimeout(function () { window.close(); }, 300);
        }
      } catch (e) { /* opener gone / cross-origin — fall back to the Return link */ }
    })();
  </script>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapedTitle}</title>
    <style>
      body { font: 14px system-ui, sans-serif; margin: 0; min-height: 100dvh; display: grid; place-items: center; background: #f7f8fa; color: #172033; }
      main { width: min(28rem, calc(100vw - 2rem)); border: 1px solid #d9dee7; border-radius: 8px; background: white; padding: 1.25rem; }
      h1 { margin: 0 0 .5rem; font-size: 1rem; }
      p { margin: 0 0 1rem; color: #596579; line-height: 1.5; }
      a { color: #00873f; font-weight: 600; text-decoration: none; }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapedTitle}</h1>
      <p>${escapedMessage}</p>
      <a href="/">Return to MCP Token Footprint</a>
    </main>
    ${signalScript}
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
