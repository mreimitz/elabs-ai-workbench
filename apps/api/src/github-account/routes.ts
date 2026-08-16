import type { FastifyInstance } from "fastify";
import {
  githubClientIdInputSchema,
  githubDevicePollInputSchema,
  type GithubAccountStatus,
  type GithubDevicePoll,
  type GithubDeviceStart,
} from "@mcp-token-footprint/shared";
import type { GithubAccountService } from "./service.js";

/**
 * The app-wide GitHub account routes (Settings sign-in via the OAuth device flow). Everything here
 * is redacted: the access token is stored encrypted and NEVER returned; the client only ever sees
 * {@link GithubAccountStatus} (identity + scopes), the human `user_code`, and the opaque `flowId`.
 */
export function registerGithubAccountRoutes(
  app: FastifyInstance,
  account: GithubAccountService,
): void {
  // The redacted account state (drives the Settings card + the dialogs' fallback hints).
  app.get("/api/github/account", async (): Promise<GithubAccountStatus> => account.status());

  // Configure the owner-registered OAuth App client id (public config — not a secret).
  app.put("/api/github/client-id", async (request): Promise<GithubAccountStatus> => {
    const input = githubClientIdInputSchema.parse(request.body);
    return account.setClientId(input.clientId);
  });

  // Start a device flow: returns the code to type on github.com/login/device + the poll handle.
  app.post(
    "/api/github/device/start",
    async (): Promise<GithubDeviceStart> => account.startDeviceFlow(),
  );

  // One poll of an in-flight flow (the client waits the returned `interval` between calls).
  app.post("/api/github/device/poll", async (request): Promise<GithubDevicePoll> => {
    const input = githubDevicePollInputSchema.parse(request.body);
    return account.pollDeviceFlow(input.flowId);
  });

  // Sign out (drops the token + identity; keeps the configured client id).
  app.delete("/api/github/account", async (): Promise<GithubAccountStatus> => account.disconnect());
}
