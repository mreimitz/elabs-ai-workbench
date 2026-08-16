import type {
  OAuthClientProvider,
  OAuthDiscoveryState,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthRepository } from "./repository.js";

export class StoredOAuthProvider implements OAuthClientProvider {
  authorizationUrl: URL | null = null;

  constructor(
    private readonly oauth: OAuthRepository,
    private readonly serverId: string,
    private readonly redirectUri: string,
    private readonly stateValue: string,
  ) {}

  get redirectUrl() {
    return this.redirectUri;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [this.redirectUri],
      client_name: "MCP Token Footprint",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  state(): string {
    return this.stateValue;
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    return this.oauth.getCredentials(this.serverId).clientInformation;
  }

  saveClientInformation(clientInformation: OAuthClientInformationMixed): void {
    this.oauth.saveClientInformation(this.serverId, clientInformation);
  }

  tokens(): OAuthTokens | undefined {
    return this.oauth.getCredentials(this.serverId).tokens;
  }

  saveTokens(tokens: OAuthTokens): void {
    this.oauth.saveTokens(this.serverId, tokens);
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    this.authorizationUrl = authorizationUrl;
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.oauth.saveCodeVerifier(this.serverId, codeVerifier);
  }

  codeVerifier(): string {
    const verifier = this.oauth.getCredentials(this.serverId).codeVerifier;
    if (!verifier) throw new Error("OAuth code verifier is missing");
    return verifier;
  }

  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): void {
    this.oauth.invalidate(this.serverId, scope);
  }

  saveDiscoveryState(state: OAuthDiscoveryState): void {
    this.oauth.saveDiscoveryState(this.serverId, state);
  }

  discoveryState(): OAuthDiscoveryState | undefined {
    return this.oauth.getCredentials(this.serverId).discoveryState;
  }
}
