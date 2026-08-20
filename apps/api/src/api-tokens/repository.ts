import {
  type ApiToken,
  type ApiTokenScope,
  isApiTokenScope,
} from "@mcp-token-footprint/shared";
import type { AppDatabase } from "../db/database.js";

/**
 * `api_tokens` SQL (planning/Roadmap/RM-08-ci/ WP 1.1). Owns every statement against the table and nothing else —
 * hashing, token generation and the auth posture live in `service.ts` / `guard.ts`.
 *
 * **No method on this class ever accepts or returns a plaintext token.** The repository only ever
 * sees the SHA-256 hex digest, so a plaintext cannot leak through this layer even by accident.
 */

/** The stored row shape, one-to-one with the DDL in `db/schema.ts`. */
type ApiTokenRow = {
  id: string;
  label: string;
  token_hash: string;
  token_prefix: string;
  scopes_json: string;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
};

/** What the guard needs to authorize a request: identity + scopes + the expiry it must honor. */
export type ApiTokenAuthRow = {
  id: string;
  label: string;
  /**
   * The stored DISPLAY prefix (`API_TOKEN_PREFIX_LENGTH` characters after `mcpfp_`), so an
   * audit line can name WHICH token acted without the plaintext ever being in scope. Read from the
   * row, never re-derived from the presented credential — this layer must not see a plaintext.
   */
  tokenPrefix: string;
  scopes: ApiTokenScope[];
  expiresAt: string | null;
  lastUsedAt: string | null;
};

/**
 * Parse a stored `scopes_json` blob defensively. A hand-edited or truncated row must not throw on the
 * hot auth path; an unparseable/unknown scope is dropped, which fails CLOSED (fewer scopes, never
 * more) — the shared zod schema is what guarantees a well-formed blob on the way in.
 */
function readScopes(json: string): ApiTokenScope[] {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((scope): scope is ApiTokenScope => isApiTokenScope(scope));
  } catch {
    return [];
  }
}

function toApiToken(row: ApiTokenRow): ApiToken {
  return {
    id: row.id,
    label: row.label,
    tokenPrefix: row.token_prefix,
    scopes: readScopes(row.scopes_json),
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
  };
}

export class ApiTokenRepository {
  constructor(private readonly db: AppDatabase) {}

  /** Every token, newest first — redacted by construction (`ApiToken` has no secret field). */
  list(): ApiToken[] {
    const rows = this.db
      .prepare(
        `SELECT id, label, token_hash, token_prefix, scopes_json, created_at, last_used_at, expires_at
           FROM api_tokens
          ORDER BY created_at DESC, id DESC`,
      )
      .all() as ApiTokenRow[];
    return rows.map(toApiToken);
  }

  /** Insert an already-hashed token. `hash` is the SHA-256 hex of the plaintext, never the plaintext. */
  insert(input: {
    id: string;
    label: string;
    hash: string;
    tokenPrefix: string;
    scopes: ApiTokenScope[];
    createdAt: string;
    expiresAt: string | null;
  }): ApiToken {
    this.db
      .prepare(
        `INSERT INTO api_tokens (id, label, token_hash, token_prefix, scopes_json, created_at, last_used_at, expires_at)
         VALUES (@id, @label, @hash, @tokenPrefix, @scopesJson, @createdAt, NULL, @expiresAt)`,
      )
      .run({
        id: input.id,
        label: input.label,
        hash: input.hash,
        tokenPrefix: input.tokenPrefix,
        scopesJson: JSON.stringify(input.scopes),
        createdAt: input.createdAt,
        expiresAt: input.expiresAt,
      });
    return {
      id: input.id,
      label: input.label,
      tokenPrefix: input.tokenPrefix,
      scopes: input.scopes,
      createdAt: input.createdAt,
      lastUsedAt: null,
      expiresAt: input.expiresAt,
    };
  }

  /**
   * The auth lookup: a single indexed hit on the UNIQUE `token_hash`, never a scan-and-compare over
   * every row. Returns `undefined` for an unknown (or revoked) token; expiry is the caller's check so
   * the guard can distinguish "no such token" from "expired" in its own logging.
   */
  findByHash(hash: string): ApiTokenAuthRow | undefined {
    const row = this.db
      .prepare(
        `SELECT id, label, token_prefix, scopes_json, expires_at, last_used_at FROM api_tokens WHERE token_hash = ?`,
      )
      .get(hash) as
      | {
          id: string;
          label: string;
          token_prefix: string;
          scopes_json: string;
          expires_at: string | null;
          last_used_at: string | null;
        }
      | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      label: row.label,
      tokenPrefix: row.token_prefix,
      scopes: readScopes(row.scopes_json),
      expiresAt: row.expires_at,
      lastUsedAt: row.last_used_at,
    };
  }

  /** Stamp a successful authentication. Throttled by the caller — see `API_TOKEN_LAST_USED_THROTTLE_MS`. */
  touch(id: string, at: string): void {
    this.db.prepare("UPDATE api_tokens SET last_used_at = ? WHERE id = ?").run(at, id);
  }

  /** Revocation is removal of the row: immediate, with no tombstone (nothing consumes one yet). */
  delete(id: string): boolean {
    return this.db.prepare("DELETE FROM api_tokens WHERE id = ?").run(id).changes > 0;
  }
}
