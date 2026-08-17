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
import type { DecryptedCredential } from "./registry.js";
import type { SubscriptionAuthResolver } from "./subscription-auth.js";

export class ProviderRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly secrets: SecretStore,
    // Claude subscription (roadmap/claude-subscription/, WP 0.2, D-CS7): resolves the signed-in Claude
    // subscription's OAuth token from `assistant_credentials`. Optional so every existing/
    // non-`claude_subscription` path + test constructs the repository unchanged; a
    // `claude_subscription` credential without a resolver configured is auth-broken.
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

    this.db
      .prepare(
        `INSERT INTO provider_credentials (
          id, kind, label, base_url, api_key_encrypted, created_at, updated_at
        ) VALUES (
          @id, @kind, @label, @baseUrl, @apiKeyEncrypted, @createdAt, @updatedAt
        )`,
      )
      .run({
        id,
        kind: parsed.kind,
        label: parsed.label,
        baseUrl: parsed.baseUrl ?? null,
        apiKeyEncrypted,
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
    });
    const now = new Date().toISOString();

    // Preserve the stored key when the update omits apiKey; rotate (or clear) when present.
    const apiKeyEncrypted =
      update.apiKey === undefined
        ? current.api_key_encrypted
        : merged.apiKey?.trim()
          ? this.secrets.encryptText(merged.apiKey.trim())
          : null;

    this.db
      .prepare(
        `UPDATE provider_credentials
          SET kind = @kind,
              label = @label,
              base_url = @baseUrl,
              api_key_encrypted = @apiKeyEncrypted,
              updated_at = @updatedAt
        WHERE id = @id`,
      )
      .run({
        id,
        kind: merged.kind,
        label: merged.label,
        baseUrl: merged.baseUrl ?? null,
        apiKeyEncrypted,
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
  // Claude subscription (roadmap/claude-subscription/, WP 0.2, D-CS7): a `claude_subscription`
  // credential carries NO stored key at all — its `apiKey` is ALWAYS the signed-in subscription's
  // resolved OAuth token (from `assistant_credentials`), reusing the `apiKey` field. A broken/absent
  // sign-in throws {@link brokenSubscriptionAuthError} rather than returning a partial/
  // unauthenticated credential.
  getDecrypted(id: string): DecryptedCredential {
    const row = this.getRow(id);
    if (row.kind === "claude_subscription") {
      const subscription = this.requireSubscriptionAuth().resolve();
      return { kind: row.kind, apiKey: subscription.token };
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

  /** The configured subscription-auth resolver, or a broken-auth-shaped 500 if none was wired. */
  private requireSubscriptionAuth(): SubscriptionAuthResolver {
    if (!this.subscriptionAuth) {
      throw httpError(500, "Claude subscription auth resolution is not configured.");
    }
    return this.subscriptionAuth;
  }

  /**
   * redact() → {@link ProviderCredential}. Carries `hasKey` (never the key value) plus the additive,
   * non-secret `authBroken` flag.
   *
   * Claude subscription (WP 0.2, D-CS7): a `claude_subscription` credential stores no key — it resolves
   * auth from the signed-in subscription instead. `authBroken` is computed by ATTEMPTING resolution
   * (attempt, catch, flip a boolean — never throws out of redact, never surfaces the token): `false`
   * when signed in, `true` when not signed in / the resolver isn't configured. It is left UNSET for
   * every ordinary api-key credential.
   */
  private redact(row: ProviderCredentialRow): ProviderCredential {
    let authBroken: boolean | undefined;
    if (row.kind === "claude_subscription") {
      try {
        this.requireSubscriptionAuth().resolve();
        authBroken = false;
      } catch {
        // Not signed in / resolver not configured ⇒ auth broken. Never propagates, never leaks a token.
        authBroken = true;
      }
    }
    return {
      id: row.id,
      kind: row.kind,
      label: row.label,
      baseUrl: row.base_url ?? undefined,
      hasKey: Boolean(row.api_key_encrypted),
      authBroken,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
