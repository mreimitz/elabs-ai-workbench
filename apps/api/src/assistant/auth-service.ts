// Assistant (WP 0.2) — Claude sign-in orchestration (D-AS1/D-AS2/D-AS14). Composes:
//   • AssistantRepository — encrypted credential store + the single-row fallback pointer.
//   • ProviderRepository  — validates that an API-key fallback references an anthropic-kind credential.
//   • ClaudeOauthFlowManager — the single-flight `claude setup-token` PTY flow.
//
// This service is the ONLY place credentials are written for the assistant, and it NEVER returns the
// token: every public method resolves to the redacted `AssistantAuthStatus`. The captured token flows
// repo → SecretStore → SQLite and is dropped from memory immediately; it is never logged or serialized.
//
// EXTENSION SEAM: `setSignOutHook` lets WP 1.1 register a callback that kills live SDK sessions when
// the owner signs out. `signOut` always invokes it (default no-op), so WP 1.1 only has to register.
import type { AssistantAuthStartResponse, AssistantAuthStatus } from "@mcp-token-footprint/shared";
import type { ProviderRepository } from "../providers/repository.js";
import { httpError } from "../utils/errors.js";
import type { ClaudeOauthFlowManager } from "./claude-auth.js";
import type { AssistantCredentialSummary, AssistantRepository } from "./repository.js";
import type { AssistantAuthSource } from "./spawn-env.js";

const MS_PER_DAY = 86_400_000;

/** Fired on sign-out. WP 1.1 registers a real implementation to kill live sessions; default no-op. */
export type AssistantSignOutHook = () => void | Promise<void>;

export class AssistantAuthService {
  private signOutHook: AssistantSignOutHook = () => {};

  constructor(
    private readonly repo: AssistantRepository,
    private readonly providers: ProviderRepository,
    private readonly flow: ClaudeOauthFlowManager,
  ) {}

  /**
   * Register the sign-out kill-hook (WP 1.1 wires this to kill live SDK sessions). Idempotent —
   * the last registration wins. Called once at startup; never from a request path.
   */
  setSignOutHook(hook: AssistantSignOutHook): void {
    this.signOutHook = hook;
  }

  /** The redacted auth status (never the token). `models` stays `[]` until WP 1.2 fills the roster. */
  getStatus(): AssistantAuthStatus {
    const credential = this.currentCredential();
    const fallbackId = this.repo.getFallbackProviderCredentialId();
    const status: AssistantAuthStatus = {
      signedIn: credential !== undefined,
      fallbackConfigured: fallbackId !== null,
      models: [],
    };
    if (fallbackId !== null) status.fallbackProviderCredentialId = fallbackId;
    if (credential) {
      status.tokenCreatedAt = credential.createdAt;
      status.tokenAgeDays = tokenAgeDays(credential.createdAt);
    }
    return status;
  }

  /** Begin the PTY sign-in flow; returns the auth URL + a single-flight flow id. */
  async startOauth(): Promise<AssistantAuthStartResponse> {
    return this.flow.start();
  }

  /** Write the pasted code to the flow, capture + store the token (encrypted), return status. */
  async completeOauth(flowId: string, code: string): Promise<AssistantAuthStatus> {
    const token = await this.flow.complete(flowId, code);
    this.replaceOauthCredential(token);
    return this.getStatus();
  }

  /** Cancel the active PTY flow (kill + clear). Idempotent. */
  cancelOauth(flowId?: string): AssistantAuthStatus {
    this.flow.cancel(flowId);
    return this.getStatus();
  }

  /** Manual paste path (D-AS2): store an already-shape-validated `sk-ant-oat01-…` token, encrypted. */
  storeToken(token: string): AssistantAuthStatus {
    this.replaceOauthCredential(token);
    return this.getStatus();
  }

  /**
   * Set (or clear, with `null`) the API-key fallback pointer (D-AS14). A non-null id MUST reference an
   * existing anthropic-kind provider credential; anything else → 400. Only the reference is stored.
   */
  setFallback(providerCredentialId: string | null): AssistantAuthStatus {
    if (providerCredentialId !== null) {
      const match = this.providers.list().find((provider) => provider.id === providerCredentialId);
      if (!match) {
        throw httpError(400, "That provider credential does not exist.");
      }
      if (match.kind !== "anthropic") {
        throw httpError(
          400,
          "The API-key fallback must reference an Anthropic provider credential.",
        );
      }
    }
    this.repo.setFallbackProviderCredentialId(providerCredentialId);
    return this.getStatus();
  }

  /**
   * Auto-Rating (WP 2.2, AR14/AR16/D-AS9) — resolve the DECRYPTED subscription credential as a spawn-env
   * {@link AssistantAuthSource} for the Claude-CLI judge's one-shot child, or `null` when no subscription
   * is signed in (the caller's judge chain then falls through — never a fake result).
   *
   * SECRET BOUNDARY (mirrors `.claude/rules/mcp-and-security.md`): this is the ONE assistant-auth method
   * that returns plaintext. It decrypts SERVER-SIDE ONLY (within the API runtime) and its result is
   * consumed solely by {@link buildAssistantSpawnEnv} to build the throwaway child env — it MUST NEVER be
   * returned over HTTP, logged, or serialized. It is deliberately distinct from {@link getStatus}, which
   * stays redacted. Only the subscription (`claude_oauth`) source is used for the CLI judge; the API-key
   * fallback pointer is NOT consulted here (the CLI judge runs on the subscription, per the plan).
   */
  resolveJudgeAuth(): AssistantAuthSource | null {
    const credential = this.currentCredential();
    if (!credential) return null;
    const decrypted = this.repo.getDecrypted(credential.id);
    return { kind: "claude_oauth", token: decrypted.token };
  }

  /** Sign out: delete the stored Claude credential(s), fire the kill-hook, return status. Idempotent. */
  async signOut(): Promise<AssistantAuthStatus> {
    this.deleteOauthCredentials();
    // Abandon any in-flight PTY sign-in flow too (signing out mid-`claude setup-token` should not leave
    // a live PTY around). Idempotent — a no-op when no flow is active (WP 0.2 review nit).
    this.flow.cancel();
    // WP 1.1 kill-hook: ends every live SDK session (registered via setSignOutHook in index.ts).
    await this.signOutHook();
    return this.getStatus();
  }

  // ── internals ────────────────────────────────────────────────────────────────────────────────────

  private currentCredential(): AssistantCredentialSummary | undefined {
    // Single-credential model (D-AS1): at most one `claude_oauth` row; list is created_at DESC.
    return this.repo.listCredentials().find((credential) => credential.kind === "claude_oauth");
  }

  private deleteOauthCredentials(): void {
    for (const credential of this.repo.listCredentials()) {
      if (credential.kind === "claude_oauth") this.repo.deleteCredential(credential.id);
    }
  }

  /** Replace any existing stored token with the new one — keeps exactly one `claude_oauth` row. */
  private replaceOauthCredential(token: string): void {
    this.deleteOauthCredentials();
    this.repo.createCredential({ kind: "claude_oauth", token });
  }
}

function tokenAgeDays(createdAt: string): number {
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) return 0;
  return Math.max(0, Math.floor((Date.now() - created) / MS_PER_DAY));
}
