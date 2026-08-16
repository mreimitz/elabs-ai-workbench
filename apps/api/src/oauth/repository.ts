import type { OAuthDiscoveryState } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthClientInput } from "@mcp-token-footprint/shared";
import type { AppDatabase } from "../db/database.js";
import type { OAuthCredentialRow, OAuthFlowRow } from "../db/rows.js";
import type { SecretStore } from "../secrets/secret-store.js";

/**
 * OAuth authorization flows are short-lived (a user completes the redirect within minutes). A flow row
 * older than this TTL is treated as EXPIRED — `getFlow` rejects it (returns null) and the startup sweep
 * deletes it — so a stale `state` can never be replayed and rows don't accumulate forever (issue #10).
 */
export const OAUTH_FLOW_TTL_MS = 10 * 60_000; // 10 min

type OAuthCredentialState = {
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  codeVerifier?: string;
  discoveryState?: OAuthDiscoveryState;
};

export class OAuthRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly secrets: SecretStore,
  ) {}

  getCredentials(serverId: string): OAuthCredentialState {
    const row = this.db
      .prepare("SELECT * FROM mcp_oauth_credentials WHERE server_id = ?")
      .get(serverId) as OAuthCredentialRow | undefined;
    if (!row) return {};

    return {
      clientInformation: this.readJson<OAuthClientInformationMixed>(row.client_information_json),
      tokens: this.readJson<OAuthTokens>(row.tokens_json),
      codeVerifier: row.code_verifier ? this.secrets.decryptText(row.code_verifier) : undefined,
      discoveryState: this.readJson<OAuthDiscoveryState>(row.discovery_state_json),
    };
  }

  hasTokens(serverId: string): boolean {
    return Boolean(this.getCredentials(serverId).tokens?.access_token);
  }

  saveClientInformation(serverId: string, clientInformation: OAuthClientInformationMixed): void {
    this.ensureRow(serverId);
    this.db
      .prepare(
        `UPDATE mcp_oauth_credentials
          SET client_information_json = @clientInformationJson,
              updated_at = @updatedAt
        WHERE server_id = @serverId`,
      )
      .run({
        serverId,
        clientInformationJson: this.secrets.encryptJson(clientInformation),
        updatedAt: new Date().toISOString(),
      });
  }

  saveConfiguredClientInformation(serverId: string, oauthClient: OAuthClientInput): void {
    const clientId = oauthClient.clientId?.trim();
    if (!clientId) return;

    this.ensureRow(serverId);

    // The client secret is never returned to the browser, so re-running OAuth from the edit wizard
    // sends the client id with a BLANK secret. Preserve the previously-stored secret in that case —
    // overwriting it with a secret-less record silently downgrades a confidential client to a public
    // one, so the next token exchange/refresh omits the secret and the provider rejects it (the owner
    // then assumes the secret expired and keeps minting new ones). Mirror
    // ServerRepository.persistOAuthClient: only drop a working authorization (tokens + verifier) when
    // the client id actually changes.
    const existing = this.getCredentials(serverId).clientInformation;
    const clientSecret = oauthClient.clientSecret?.trim() || existing?.client_secret;
    const clientIdChanged = existing?.client_id !== clientId;

    const clientInformationJson = this.secrets.encryptJson({
      client_id: clientId,
      ...(clientSecret ? { client_secret: clientSecret } : {}),
    });
    const updatedAt = new Date().toISOString();

    this.db
      .prepare(
        clientIdChanged
          ? `UPDATE mcp_oauth_credentials
              SET client_information_json = @clientInformationJson,
                  tokens_json = NULL,
                  code_verifier = NULL,
                  updated_at = @updatedAt
            WHERE server_id = @serverId`
          : `UPDATE mcp_oauth_credentials
              SET client_information_json = @clientInformationJson,
                  updated_at = @updatedAt
            WHERE server_id = @serverId`,
      )
      .run({ serverId, clientInformationJson, updatedAt });
  }

  saveTokens(serverId: string, tokens: OAuthTokens): void {
    this.ensureRow(serverId);
    this.db
      .prepare(
        `UPDATE mcp_oauth_credentials
          SET tokens_json = @tokensJson,
              updated_at = @updatedAt
        WHERE server_id = @serverId`,
      )
      .run({
        serverId,
        tokensJson: this.secrets.encryptJson(tokens),
        updatedAt: new Date().toISOString(),
      });
  }

  saveCodeVerifier(serverId: string, codeVerifier: string): void {
    this.ensureRow(serverId);
    this.db
      .prepare(
        `UPDATE mcp_oauth_credentials
          SET code_verifier = @codeVerifier,
              updated_at = @updatedAt
        WHERE server_id = @serverId`,
      )
      .run({
        serverId,
        codeVerifier: this.secrets.encryptText(codeVerifier),
        updatedAt: new Date().toISOString(),
      });
  }

  saveDiscoveryState(serverId: string, discoveryState: OAuthDiscoveryState): void {
    this.ensureRow(serverId);
    this.db
      .prepare(
        `UPDATE mcp_oauth_credentials
          SET discovery_state_json = @discoveryStateJson,
              updated_at = @updatedAt
        WHERE server_id = @serverId`,
      )
      .run({
        serverId,
        discoveryStateJson: this.secrets.encryptJson(discoveryState),
        updatedAt: new Date().toISOString(),
      });
  }

  clear(serverId: string): void {
    this.db.prepare("DELETE FROM mcp_oauth_credentials WHERE server_id = ?").run(serverId);
    this.db.prepare("DELETE FROM mcp_oauth_flows WHERE server_id = ?").run(serverId);
  }

  createFlow(state: string, serverId: string): void {
    this.db
      .prepare(
        `INSERT INTO mcp_oauth_flows (state, server_id, created_at, completed_at, error_message)
        VALUES (?, ?, ?, NULL, NULL)`,
      )
      .run(state, serverId, new Date().toISOString());
  }

  getFlow(state: string): OAuthFlowRow | null {
    const row = this.db.prepare("SELECT * FROM mcp_oauth_flows WHERE state = ?").get(state) as
      | OAuthFlowRow
      | undefined;
    if (!row) return null;
    // Issue #10 — enforce the flow TTL: an expired flow is rejected as if it never existed (callers
    // surface "state was not recognized or has expired"), so a stale `state` can't be replayed.
    if (this.isFlowExpired(row)) return null;
    return row;
  }

  /** True when a flow row is older than {@link OAUTH_FLOW_TTL_MS} (a malformed timestamp is not expired). */
  private isFlowExpired(row: OAuthFlowRow): boolean {
    const createdMs = Date.parse(row.created_at);
    if (Number.isNaN(createdMs)) return false;
    return Date.now() - createdMs > OAUTH_FLOW_TTL_MS;
  }

  /**
   * Delete all flow rows older than the TTL. Wired at startup in `index.ts` (and safe to call
   * periodically) so stale flow rows are reclaimed rather than accumulating forever. Returns the count.
   */
  sweepExpiredFlows(): number {
    const cutoff = new Date(Date.now() - OAUTH_FLOW_TTL_MS).toISOString();
    const result = this.db.prepare("DELETE FROM mcp_oauth_flows WHERE created_at < ?").run(cutoff);
    return result.changes;
  }

  deleteFlow(state: string): void {
    this.db.prepare("DELETE FROM mcp_oauth_flows WHERE state = ?").run(state);
  }

  completeFlow(state: string, errorMessage?: string): void {
    this.db
      .prepare(
        `UPDATE mcp_oauth_flows
          SET completed_at = ?,
              error_message = ?
        WHERE state = ?`,
      )
      .run(new Date().toISOString(), errorMessage ?? null, state);
  }

  invalidate(
    serverId: string,
    scope: "all" | "client" | "tokens" | "verifier" | "discovery",
  ): void {
    if (scope === "all") {
      this.clear(serverId);
      return;
    }

    const column =
      scope === "client"
        ? "client_information_json"
        : scope === "tokens"
          ? "tokens_json"
          : scope === "verifier"
            ? "code_verifier"
            : "discovery_state_json";
    this.ensureRow(serverId);
    this.db
      .prepare(
        `UPDATE mcp_oauth_credentials SET ${column} = NULL, updated_at = ? WHERE server_id = ?`,
      )
      .run(new Date().toISOString(), serverId);
  }

  private ensureRow(serverId: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO mcp_oauth_credentials (server_id, created_at, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(server_id) DO NOTHING`,
      )
      .run(serverId, now, now);
  }

  private readJson<T>(stored: string | null): T | undefined {
    return stored ? (this.secrets.readJson<unknown>(stored, undefined) as T) : undefined;
  }
}
