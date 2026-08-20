import crypto from "node:crypto";
import {
  API_TOKEN_HASH_ALGORITHM,
  API_TOKEN_LAST_USED_THROTTLE_MS,
  API_TOKEN_PREFIX,
  API_TOKEN_PREFIX_LENGTH,
  API_TOKEN_SECRET_BYTES,
  type ApiToken,
  type ApiTokenCreateInput,
  type ApiTokenCreateResponse,
  type ApiTokenScope,
  looksLikeApiToken,
} from "@mcp-token-footprint/shared";
import { nanoid } from "nanoid";
import type { ApiTokenAuthRow, ApiTokenRepository } from "./repository.js";

/**
 * Service tokens (planning/Roadmap/RM-08-ci/ WP 1.1) — generation, hashing, and the authenticate step the guard calls.
 *
 * **The plaintext token lives in exactly two places and nowhere else:** the value returned once from
 * {@link ApiTokenService.create}, and the `Authorization` header a caller presents. It is never
 * persisted, never returned by the list endpoint, never put into an error message, and never logged —
 * not at any level. Everything downstream of {@link hashToken} is a digest.
 *
 * No new dependency: token bytes come from `node:crypto`'s CSPRNG.
 */

/**
 * Hash a plaintext token for storage/lookup. Plain SHA-256 over the FULL token (`mcpfp_` marker
 * included) — deliberate, not an oversight: the input is a 256-bit uniformly random secret this app
 * generated, so there is no dictionary to run against it and a slow KDF would only add latency to the
 * hot auth path. (`planning/Roadmap/RM-25-team-server/` uses scrypt because ITS input is a human-chosen password.)
 * Do not "fix" this to bcrypt/scrypt without changing what is being hashed.
 */
export function hashToken(plaintext: string): string {
  return crypto.createHash(API_TOKEN_HASH_ALGORITHM).update(plaintext, "utf8").digest("hex");
}

/** Mint a fresh plaintext token: `mcpfp_` + 43 base64url chars (256 bits from the CSPRNG). */
export function generateToken(): string {
  return `${API_TOKEN_PREFIX}${crypto.randomBytes(API_TOKEN_SECRET_BYTES).toString("base64url")}`;
}

/** The display half of a plaintext token (`mcpfp_ab12cd34…`) — never enough to authenticate with. */
export function tokenPrefixOf(plaintext: string): string {
  return plaintext.slice(
    API_TOKEN_PREFIX.length,
    API_TOKEN_PREFIX.length + API_TOKEN_PREFIX_LENGTH,
  );
}

/** Why an `authenticate` attempt failed — the guard maps these onto its 401 codes. */
export type ApiTokenAuthFailure = "malformed" | "unknown" | "expired";

export type ApiTokenAuthResult =
  | { ok: true; token: AuthenticatedApiToken }
  | { ok: false; reason: ApiTokenAuthFailure };

/** What a successfully authenticated request carries (attached to `request.apiToken`). */
export type AuthenticatedApiToken = {
  id: string;
  label: string;
  /**
   * The DISPLAY prefix from the stored row (`ab12cd34`, the characters after `mcpfp_`) — enough to
   * say WHICH token acted in an audit line, never enough to authenticate with. Added by WP M.2 for
   * the MCP mount's per-tool-call audit line; it comes from the row, never from the presented
   * plaintext, so no code path downstream of `authenticate` can accidentally hold a credential.
   */
  tokenPrefix: string;
  scopes: ApiTokenScope[];
};

export class ApiTokenService {
  constructor(
    private readonly repository: ApiTokenRepository,
    /** Injectable clock so the throttle + expiry are testable without sleeping. */
    private readonly now: () => Date = () => new Date(),
  ) {}

  list(): ApiToken[] {
    return this.repository.list();
  }

  /**
   * Mint a token. The returned `secret` is the ONLY time the plaintext exists outside the caller's
   * `Authorization` header — the row holds its SHA-256 digest and an 8-character display prefix.
   * Duplicate scopes are collapsed so a token's granted set reads exactly as it was intended.
   */
  create(input: ApiTokenCreateInput): ApiTokenCreateResponse {
    const secret = generateToken();
    const token = this.repository.insert({
      id: nanoid(),
      label: input.label.trim(),
      hash: hashToken(secret),
      tokenPrefix: tokenPrefixOf(secret),
      scopes: [...new Set(input.scopes)],
      createdAt: this.now().toISOString(),
      expiresAt: input.expiresAt ?? null,
    });
    return { token, secret };
  }

  /** Revoke (delete) a token. `false` when there was no such token. */
  revoke(id: string): boolean {
    return this.repository.delete(id);
  }

  /**
   * Authenticate a presented plaintext token.
   *
   * Fails closed at every step: an obviously-malformed value never reaches the DB, an unknown digest is
   * `unknown`, and a token past its `expires_at` is `expired` rather than valid. On success the token's
   * `last_used_at` is stamped — THROTTLED, so a polling CI job does not turn every authenticated
   * request into a SQLite write.
   *
   * The `plaintext` argument is never logged and never echoed into the returned value.
   */
  authenticate(plaintext: string): ApiTokenAuthResult {
    if (!looksLikeApiToken(plaintext)) return { ok: false, reason: "malformed" };

    const row = this.repository.findByHash(hashToken(plaintext));
    if (!row) return { ok: false, reason: "unknown" };

    const now = this.now();
    if (row.expiresAt !== null && Date.parse(row.expiresAt) <= now.getTime()) {
      return { ok: false, reason: "expired" };
    }

    this.touchIfStale(row, now);
    return {
      ok: true,
      token: {
        id: row.id,
        label: row.label,
        tokenPrefix: row.tokenPrefix,
        scopes: row.scopes,
      },
    };
  }

  /** Write `last_used_at` only when the stored value is older than the throttle window (or absent). */
  private touchIfStale(row: ApiTokenAuthRow, now: Date): void {
    if (row.lastUsedAt !== null) {
      const age = now.getTime() - Date.parse(row.lastUsedAt);
      // A stored timestamp that fails to parse yields NaN; `NaN < x` is false, so it falls through to
      // a write — the right direction for a corrupt value (refresh it) rather than never writing again.
      if (age < API_TOKEN_LAST_USED_THROTTLE_MS) return;
    }
    this.repository.touch(row.id, now.toISOString());
  }
}
