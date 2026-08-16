import { httpError } from "../utils/errors.js";

/**
 * Claude subscription (roadmap/claude-subscription/, WP 0.2, D-CS7) — resolve a `claude_subscription`
 * provider credential's auth from the OWNER'S SIGNED-IN Claude subscription (`assistant_credentials`,
 * the single `claude_oauth` row — the SAME sign-in the embedded Assistant dock uses). This mirrors the
 * `qlik_answers` linked-auth resolver (`linked-auth.ts`): auth is resolved from ANOTHER store at run
 * time rather than a standalone stored key, and a broken/absent sign-in surfaces a clear, non-leaking
 * "auth broken" error rather than a partial credential.
 *
 * A `claude_subscription` credential carries NO key of its own (D-CS7) — this resolver is its ONLY
 * auth source. This lives BEHIND the runtime boundary (apps/api only): the decrypted OAuth token is
 * read here and handed to the caller (the run path, later WP) as a bearer; it never leaves the
 * process, appears in a response, or appears in an error message.
 */
export interface SubscriptionAuthResolver {
  /**
   * Resolve the signed-in subscription's OAuth token, or throw {@link brokenSubscriptionAuthError}
   * when nothing usable is signed in. Never returns a partial/empty result.
   */
  resolve(): { token: string };
}

/** Minimal `AssistantRepository` slice the resolver needs (mirrors `LinkedServerReader`/`LinkedOAuthReader`). */
export interface SubscriptionCredentialReader {
  listCredentials(): Array<{ id: string; kind: string }>;
  getDecrypted(id: string): { token: string };
}

/**
 * The single clear, non-leaking error for "not signed in" / a broken subscription credential.
 * Deliberately generic (no token, no header) so it is safe to surface in any run/roster response.
 */
const BROKEN_SUBSCRIPTION_MESSAGE =
  "Claude subscription is not signed in — sign in from the Assistant settings to use this provider.";

/** A clear 400 for a broken/absent sign-in — NEVER embeds a token or other secret. */
export function brokenSubscriptionAuthError(): ReturnType<typeof httpError> {
  return httpError(400, BROKEN_SUBSCRIPTION_MESSAGE);
}

/** The one `assistant_credentials` kind this resolver looks for (mirrors `AssistantAuthService`). */
const CLAUDE_OAUTH_KIND = "claude_oauth";

export class AssistantSubscriptionAuth implements SubscriptionAuthResolver {
  constructor(private readonly assistant: SubscriptionCredentialReader) {}

  resolve(): { token: string } {
    // Single-credential model (D-AS1, mirrored by AssistantAuthService.currentCredential): at most
    // one `claude_oauth` row; list is created_at DESC, so the first match is the current one.
    const credential = this.assistant
      .listCredentials()
      .find((c) => c.kind === CLAUDE_OAUTH_KIND);
    if (!credential) throw brokenSubscriptionAuthError();

    const token = this.assistant.getDecrypted(credential.id).token?.trim();
    if (!token) throw brokenSubscriptionAuthError();

    return { token };
  }
}
