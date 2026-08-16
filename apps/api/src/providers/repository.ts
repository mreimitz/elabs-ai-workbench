import { nanoid } from "nanoid";
import type {
  ProviderCredential,
  ProviderCredentialInput,
  ProviderCredentialUpdate,
} from "@mcp-token-footprint/shared";
import { providerCredentialInputSchema } from "@mcp-token-footprint/shared";
import type { AppDatabase } from "../db/database.js";
import type { ProviderCredentialRow } from "../db/rows.js";
import type { SecretStore } from "../secrets/secret-store.js";
import { httpError } from "../utils/errors.js";
import type { LinkedAuthResolver } from "./linked-auth.js";
import type { DecryptedCredential } from "./registry.js";
import type { SubscriptionAuthResolver } from "./subscription-auth.js";

export class ProviderRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly secrets: SecretStore,
    // Qlik Answers (WP 0.2, D-QA1): resolves a linked MCP server's OAuth token / auth headers into a
    // bearer + tenant origin. Optional so callers with no `qlik_answers` linked credentials (every
    // existing api-key-only path + test) construct the repository unchanged; a LINKED credential
    // without a resolver configured is treated as auth-broken (never silently unauthenticated).
    private readonly linkedAuth?: LinkedAuthResolver,
    // Claude subscription (roadmap/claude-subscription/, WP 0.2, D-CS7): resolves the signed-in Claude
    // subscription's OAuth token from `assistant_credentials`. Optional for the same reason as
    // `linkedAuth` — every existing/non-`claude_subscription` path + test constructs the repository
    // unchanged; a `claude_subscription` credential without a resolver configured is auth-broken.
    private readonly subscriptionAuth?: SubscriptionAuthResolver,
  ) {}

  list(): ProviderCredential[] {
    const rows = this.db
      .prepare("SELECT * FROM provider_credentials ORDER BY updated_at DESC")
      .all() as ProviderCredentialRow[];
    return rows.map((row) => this.redact(row));
  }

  get(id: string): ProviderCredential {
    return this.redact(this.getRow(id));
  }

  create(input: ProviderCredentialInput): ProviderCredential {
    const parsed = providerCredentialInputSchema.parse(input);
    const now = new Date().toISOString();
    const id = nanoid();
    const apiKeyEncrypted = parsed.apiKey?.trim()
      ? this.secrets.encryptText(parsed.apiKey.trim())
      : null;
    const mcpServerId = parsed.mcpServerId?.trim() ? parsed.mcpServerId.trim() : null;

    this.db
      .prepare(
        `INSERT INTO provider_credentials (
          id, kind, label, base_url, api_key_encrypted, mcp_server_id, created_at, updated_at
        ) VALUES (
          @id, @kind, @label, @baseUrl, @apiKeyEncrypted, @mcpServerId, @createdAt, @updatedAt
        )`,
      )
      .run({
        id,
        kind: parsed.kind,
        label: parsed.label,
        baseUrl: parsed.baseUrl ?? null,
        apiKeyEncrypted,
        mcpServerId,
        createdAt: now,
        updatedAt: now,
      });

    return this.get(id);
  }

  update(id: string, update: ProviderCredentialUpdate): ProviderCredential {
    const current = this.getRow(id);
    const merged = providerCredentialInputSchema.parse({
      kind: update.kind ?? current.kind,
      label: update.label ?? current.label,
      baseUrl: update.baseUrl ?? current.base_url ?? undefined,
      // apiKey is write-only: a provided value rotates the key, omitting it keeps the stored one.
      apiKey: update.apiKey,
      // mcpServerId is a link, not a secret: a provided value re-links, omitting it keeps the stored one.
      mcpServerId: update.mcpServerId ?? current.mcp_server_id ?? undefined,
    });
    const now = new Date().toISOString();

    // Preserve the stored key when the update omits apiKey; rotate (or clear) when present.
    const apiKeyEncrypted =
      update.apiKey === undefined
        ? current.api_key_encrypted
        : merged.apiKey?.trim()
          ? this.secrets.encryptText(merged.apiKey.trim())
          : null;
    const mcpServerId = merged.mcpServerId?.trim() ? merged.mcpServerId.trim() : null;

    this.db
      .prepare(
        `UPDATE provider_credentials
          SET kind = @kind,
              label = @label,
              base_url = @baseUrl,
              api_key_encrypted = @apiKeyEncrypted,
              mcp_server_id = @mcpServerId,
              updated_at = @updatedAt
        WHERE id = @id`,
      )
      .run({
        id,
        kind: merged.kind,
        label: merged.label,
        baseUrl: merged.baseUrl ?? null,
        apiKeyEncrypted,
        mcpServerId,
        updatedAt: now,
      });

    return this.get(id);
  }

  delete(id: string): void {
    const result = this.db.prepare("DELETE FROM provider_credentials WHERE id = ?").run(id);
    if (result.changes === 0) {
      throw httpError(404, "Provider credential not found");
    }
  }

  // INTERNAL ONLY — never leaves the API process; never exposed by a route.
  //
  // Qlik Answers dual-auth (WP 0.2, D-QA1): a credential linked to an MCP server (`mcp_server_id` set)
  // resolves its `apiKey`/`baseUrl` from that server's OAuth token / auth headers instead of a stored
  // key — transparently, so callers (roster WP 0.3, executor WP 1.1) read the same `apiKey`+`baseUrl`
  // regardless of source. A broken link throws {@link brokenLinkError} (clear + non-leaking) rather
  // than returning a partial, unauthenticated credential. `mcp_server_id` is only ever set on
  // `qlik_answers` rows, so every other kind takes the unchanged own-key path.
  //
  // Claude subscription (roadmap/claude-subscription/, WP 0.2, D-CS7): a `claude_subscription`
  // credential carries NO stored key at all — its `apiKey` is ALWAYS the signed-in subscription's
  // resolved OAuth token (from `assistant_credentials`), reusing the `apiKey` field the same way the
  // qlik_answers linked path reuses it for a resolved bearer. A broken/absent sign-in throws
  // {@link brokenSubscriptionAuthError} rather than returning a partial/unauthenticated credential.
  getDecrypted(id: string): DecryptedCredential {
    const row = this.getRow(id);
    if (row.kind === "claude_subscription") {
      const subscription = this.requireSubscriptionAuth().resolve();
      return { kind: row.kind, apiKey: subscription.token };
    }
    if (row.mcp_server_id) {
      const linked = this.requireLinkedAuth().resolve(row.mcp_server_id);
      return {
        kind: row.kind,
        baseUrl: linked.baseUrl,
        apiKey: linked.apiKey,
        mcpServerId: row.mcp_server_id,
      };
    }
    return {
      kind: row.kind,
      baseUrl: row.base_url ?? undefined,
      apiKey: row.api_key_encrypted ? this.secrets.decryptText(row.api_key_encrypted) : undefined,
    };
  }

  migratePlaintextSecrets(): number {
    const rows = this.db
      .prepare("SELECT id, api_key_encrypted FROM provider_credentials")
      .all() as Array<Pick<ProviderCredentialRow, "id" | "api_key_encrypted">>;
    const update = this.db.prepare(
      "UPDATE provider_credentials SET api_key_encrypted = @apiKeyEncrypted WHERE id = @id",
    );
    let migrated = 0;

    const transaction = this.db.transaction(() => {
      for (const row of rows) {
        if (!row.api_key_encrypted || this.secrets.isEncrypted(row.api_key_encrypted)) continue;

        update.run({
          id: row.id,
          apiKeyEncrypted: this.secrets.encryptText(row.api_key_encrypted),
        });
        migrated += 1;
      }
    });

    transaction();
    return migrated;
  }

  private getRow(id: string): ProviderCredentialRow {
    const row = this.db.prepare("SELECT * FROM provider_credentials WHERE id = ?").get(id) as
      | ProviderCredentialRow
      | undefined;
    if (!row) {
      throw httpError(404, "Provider credential not found");
    }

    return row;
  }

  /** The configured linked-auth resolver, or a broken-link-shaped 500 if none was wired. */
  private requireLinkedAuth(): LinkedAuthResolver {
    if (!this.linkedAuth) {
      throw httpError(500, "Linked-server auth resolution is not configured.");
    }
    return this.linkedAuth;
  }

  /** The configured subscription-auth resolver, or a broken-auth-shaped 500 if none was wired. */
  private requireSubscriptionAuth(): SubscriptionAuthResolver {
    if (!this.subscriptionAuth) {
      throw httpError(500, "Claude subscription auth resolution is not configured.");
    }
    return this.subscriptionAuth;
  }

  /**
   * redact() → {@link ProviderCredential}. Carries `hasKey` (never the key value) plus the additive
   * Qlik Answers auth-provenance fields (D-QA1) — all non-secret:
   *  - unlinked credential → `authSource: "api_key"`, no `linkedServerId`/`authBroken`.
   *  - linked credential   → `linkedServerId` (an id), `authSource: "linked_server"`, and `authBroken`
   *    computed by ATTEMPTING resolution (in a try/catch — never throws out of redact, never surfaces
   *    a token). A missing resolver or an unresolvable link ⇒ `authBroken: true`.
   *
   * Claude subscription (WP 0.2, D-CS7): a `claude_subscription` credential is neither of those two
   * shapes — it stores no key AND is not linked to an MCP server, so it resolves auth from the
   * signed-in subscription instead. `authBroken` is computed the SAME way (attempt resolution, catch,
   * flip a boolean — never throws out of redact, never surfaces the token): `false` when signed in,
   * `true` when not signed in / the resolver isn't configured. `authSource` is left UNSET for this
   * kind — neither `"api_key"` nor `"linked_server"` is accurate, and the wire type (`packages/shared`,
   * frozen by WP 0.1) enumerates only those two literals; `authBroken` alone carries the signed-in
   * status this WP's acceptance needs, and `kind === "claude_subscription"` already tells a caller
   * this is a subscription credential.
   */
  private redact(row: ProviderCredentialRow): ProviderCredential {
    const linkedServerId = row.mcp_server_id ?? undefined;
    let authBroken: boolean | undefined;
    let authSource: ProviderCredential["authSource"];
    if (linkedServerId) {
      authSource = "linked_server";
      try {
        this.requireLinkedAuth().resolve(linkedServerId);
        authBroken = false;
      } catch {
        // Any failure (server gone, no usable auth, resolver not configured) ⇒ auth broken. The caught
        // error never propagates and is never included in the response — only the boolean flag is.
        authBroken = true;
      }
    } else if (row.kind === "claude_subscription") {
      try {
        this.requireSubscriptionAuth().resolve();
        authBroken = false;
      } catch {
        // Not signed in / resolver not configured ⇒ auth broken. Never propagates, never leaks a token.
        authBroken = true;
      }
    } else {
      authSource = "api_key";
    }
    return {
      id: row.id,
      kind: row.kind,
      label: row.label,
      baseUrl: row.base_url ?? undefined,
      hasKey: Boolean(row.api_key_encrypted),
      linkedServerId,
      authSource,
      authBroken,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
