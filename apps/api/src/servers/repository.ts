import { nanoid } from "nanoid";
import type {
  ServerAuthInput,
  ServerAuthType,
  ServerConfig,
  ServerConfigInput,
  ServerConfigUpdate,
} from "@mcp-token-footprint/shared";
import { serverConfigInputSchema } from "@mcp-token-footprint/shared";
import type { AppDatabase } from "../db/database.js";
import type { ServerRow } from "../db/rows.js";
import type { SecretStore } from "../secrets/secret-store.js";
import { httpError } from "../utils/errors.js";
import { parseJsonObject } from "../utils/json.js";

export type InternalServerConfig = ServerConfigInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
  authType: ServerAuthType;
  authHeaderName?: string;
};

type StoredAuth = {
  authType: ServerAuthType;
  authHeaderName: string | null;
  headers: Record<string, string>;
};

export class ServerRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly secrets: SecretStore,
  ) {}

  list(): ServerConfig[] {
    const rows = this.db
      .prepare("SELECT * FROM mcp_servers ORDER BY updated_at DESC")
      .all() as ServerRow[];
    return rows.map((row) => toPublicServer(row, this.secrets, this.readOAuthClientId(row.id)));
  }

  getPublic(id: string): ServerConfig {
    return toPublicServer(this.getRow(id), this.secrets, this.readOAuthClientId(id));
  }

  getInternal(id: string): InternalServerConfig {
    return toInternalServer(this.getRow(id), this.secrets);
  }

  create(input: ServerConfigInput): ServerConfig {
    const parsed = serverConfigInputSchema.parse(input);
    this.assertTypeExists(parsed.typeId);
    const now = new Date().toISOString();
    const id = nanoid();
    const storedAuth = resolveCreateAuth(parsed);

    this.db
      .prepare(
        `INSERT INTO mcp_servers (
          id, name, transport, command, args_json, url, headers_json, env_json,
          auth_type, auth_header_name, type_id, created_at, updated_at
        ) VALUES (
          @id, @name, @transport, @command, @argsJson, @url, @headersJson, @envJson,
          @authType, @authHeaderName, @typeId, @createdAt, @updatedAt
        )`,
      )
      .run({
        id,
        name: parsed.name,
        transport: parsed.transport,
        command: parsed.transport === "stdio" ? (parsed.command ?? null) : null,
        argsJson: JSON.stringify(parsed.args ?? []),
        url: parsed.transport === "streamable_http" ? (parsed.url ?? null) : null,
        headersJson: this.secrets.encryptJson(storedAuth.headers),
        envJson: this.secrets.encryptJson(parsed.transport === "stdio" ? (parsed.env ?? {}) : {}),
        authType: storedAuth.authType,
        authHeaderName: storedAuth.authHeaderName,
        typeId: parsed.typeId ?? null,
        createdAt: now,
        updatedAt: now,
      });

    this.persistOAuthClient(id, parsed.auth);
    return this.getPublic(id);
  }

  update(id: string, update: ServerConfigUpdate): ServerConfig {
    const current = toInternalServer(this.getRow(id), this.secrets);
    const merged = serverConfigInputSchema.parse({
      name: update.name ?? current.name,
      transport: update.transport ?? current.transport,
      command: update.command ?? current.command,
      args: update.args ?? current.args ?? [],
      env: update.env ?? current.env ?? {},
      url: update.url ?? current.url,
      headers: update.headers ?? current.headers ?? {},
      // `null` explicitly clears the type assignment; omitted keeps the current one (D-ST5).
      typeId: update.typeId === undefined ? (current.typeId ?? null) : update.typeId,
    });
    this.assertTypeExists(merged.typeId);
    const storedAuth = resolveUpdateAuth(update, current, merged.transport);
    const now = new Date().toISOString();

    this.db
      .prepare(
        `UPDATE mcp_servers
          SET name = @name,
              transport = @transport,
              command = @command,
              args_json = @argsJson,
              url = @url,
              headers_json = @headersJson,
              env_json = @envJson,
              auth_type = @authType,
              auth_header_name = @authHeaderName,
              type_id = @typeId,
              updated_at = @updatedAt
        WHERE id = @id`,
      )
      .run({
        id,
        name: merged.name,
        transport: merged.transport,
        command: merged.transport === "stdio" ? (merged.command ?? null) : null,
        argsJson: JSON.stringify(merged.args ?? []),
        url: merged.transport === "streamable_http" ? (merged.url ?? null) : null,
        headersJson: this.secrets.encryptJson(storedAuth.headers),
        envJson: this.secrets.encryptJson(merged.transport === "stdio" ? (merged.env ?? {}) : {}),
        authType: storedAuth.authType,
        authHeaderName: storedAuth.authHeaderName,
        typeId: merged.typeId ?? null,
        updatedAt: now,
      });

    this.persistOAuthClient(id, update.auth);
    return this.getPublic(id);
  }

  delete(id: string): void {
    const result = this.db.prepare("DELETE FROM mcp_servers WHERE id = ?").run(id);
    if (result.changes === 0) {
      throw httpError(404, "Server not found");
    }
  }

  migratePlaintextSecrets(): number {
    const rows = this.db
      .prepare("SELECT id, env_json, headers_json FROM mcp_servers")
      .all() as Array<Pick<ServerRow, "id" | "env_json" | "headers_json">>;
    const update = this.db.prepare(
      `UPDATE mcp_servers
        SET env_json = @envJson,
            headers_json = @headersJson
      WHERE id = @id`,
    );
    let migrated = 0;

    const transaction = this.db.transaction(() => {
      for (const row of rows) {
        const env = this.secrets.normalizeJson(row.env_json, {});
        assertSecretRecord(env.value, row.id, "env_json");
        const headers = this.secrets.normalizeJson(row.headers_json, {});
        assertSecretRecord(headers.value, row.id, "headers_json");

        if (!env.migrated && !headers.migrated) continue;

        update.run({
          id: row.id,
          envJson: env.stored,
          headersJson: headers.stored,
        });
        migrated += 1;
      }
    });

    transaction();
    return migrated;
  }

  /** 400 guard: a create/update may only assign an existing server type (planning/Roadmap/completed/RM-21-server-types). */
  private assertTypeExists(typeId: string | null | undefined): void {
    if (!typeId) return;
    const row = this.db.prepare("SELECT 1 FROM server_types WHERE id = ?").get(typeId);
    if (!row) {
      throw httpError(400, `Unknown server type: ${typeId}`);
    }
  }

  private getRow(id: string): ServerRow {
    const row = this.db.prepare("SELECT * FROM mcp_servers WHERE id = ?").get(id) as
      | ServerRow
      | undefined;
    if (!row) {
      throw httpError(404, "Server not found");
    }

    return row;
  }

  /** The configured OAuth client id (public identifier) from the credentials row, if any. */
  private readOAuthClientId(serverId: string): string | undefined {
    const row = this.db
      .prepare("SELECT client_information_json FROM mcp_oauth_credentials WHERE server_id = ?")
      .get(serverId) as { client_information_json: string | null } | undefined;
    if (!row?.client_information_json) return undefined;
    const info = this.secrets.readJson<{ client_id?: string }>(row.client_information_json, {});
    return info?.client_id?.trim() ? info.client_id : undefined;
  }

  /**
   * Persist the OAuth client id/secret entered on the server form so it survives a save (the
   * `mcp_servers` row has no slot for it). Changing the client id invalidates any prior
   * authorization, so tokens/verifier are reset only when the id actually changes — an unrelated
   * edit that keeps the same id must not drop a working authorization.
   */
  private persistOAuthClient(serverId: string, auth: ServerAuthInput | undefined): void {
    if (!auth || auth.type !== "oauth") return;
    const clientId = auth.clientId?.trim();
    if (!clientId) return;
    const clientSecret = auth.clientSecret?.trim();
    const existing = this.readOAuthClientId(serverId);
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO mcp_oauth_credentials (server_id, created_at, updated_at)
        VALUES (?, ?, ?) ON CONFLICT(server_id) DO NOTHING`,
      )
      .run(serverId, now, now);

    const clientInfo: Record<string, string> = { client_id: clientId };
    if (clientSecret) clientInfo.client_secret = clientSecret;
    const encoded = this.secrets.encryptJson(clientInfo);

    if (existing !== clientId) {
      this.db
        .prepare(
          `UPDATE mcp_oauth_credentials
            SET client_information_json = @info, tokens_json = NULL, code_verifier = NULL, updated_at = @now
          WHERE server_id = @serverId`,
        )
        .run({ serverId, info: encoded, now });
    } else if (clientSecret) {
      this.db
        .prepare(
          `UPDATE mcp_oauth_credentials SET client_information_json = @info, updated_at = @now WHERE server_id = @serverId`,
        )
        .run({ serverId, info: encoded, now });
    }
  }
}

function toPublicServer(
  row: ServerRow,
  secrets: SecretStore,
  oauthClientId?: string,
): ServerConfig {
  const args = parseJsonObject<string[]>(row.args_json, []);
  const env = secrets.readJson<Record<string, string>>(row.env_json, {});
  assertSecretRecord(env, row.id, "env_json");
  const headers = secrets.readJson<Record<string, string>>(row.headers_json, {});
  assertSecretRecord(headers, row.id, "headers_json");

  return {
    id: row.id,
    name: row.name,
    transport: row.transport,
    command: row.command ?? undefined,
    args,
    url: row.url ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    hasEnvSecrets: Object.keys(env).length > 0,
    hasHeaderSecrets: Object.keys(headers).length > 0,
    authType: row.auth_type,
    authHeaderName: row.auth_header_name ?? undefined,
    oauthClientId,
    typeId: row.type_id ?? undefined,
  };
}

function toInternalServer(row: ServerRow, secrets: SecretStore): InternalServerConfig {
  const headers = secrets.readJson<Record<string, string>>(row.headers_json, {});
  assertSecretRecord(headers, row.id, "headers_json");
  const env = secrets.readJson<Record<string, string>>(row.env_json, {});
  assertSecretRecord(env, row.id, "env_json");

  return {
    id: row.id,
    name: row.name,
    transport: row.transport,
    command: row.command ?? undefined,
    args: parseJsonObject<string[]>(row.args_json, []),
    url: row.url ?? undefined,
    headers,
    env,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    authType: row.auth_type,
    authHeaderName: row.auth_header_name ?? undefined,
    typeId: row.type_id ?? undefined,
  };
}

function resolveCreateAuth(input: ServerConfigInput): StoredAuth {
  if (input.transport !== "streamable_http") {
    return { authType: "none", authHeaderName: null, headers: {} };
  }

  if (input.auth) {
    return authInputToStored(input.auth, input.headers ?? {}, true);
  }

  const headers = input.headers ?? {};
  if (Object.keys(headers).length > 0) {
    return { authType: "custom_headers", authHeaderName: null, headers };
  }

  return { authType: "none", authHeaderName: null, headers: {} };
}

function resolveUpdateAuth(
  update: ServerConfigUpdate,
  current: InternalServerConfig,
  nextTransport: ServerConfigInput["transport"],
): StoredAuth {
  if (nextTransport !== "streamable_http") {
    return { authType: "none", authHeaderName: null, headers: {} };
  }

  if (update.auth) {
    return authInputToStored(update.auth, current.headers ?? {}, false);
  }

  if (update.headers) {
    return { authType: "custom_headers", authHeaderName: null, headers: update.headers };
  }

  if (current.transport === "streamable_http") {
    return {
      authType: current.authType,
      authHeaderName: current.authHeaderName ?? null,
      headers: current.headers ?? {},
    };
  }

  return { authType: "none", authHeaderName: null, headers: {} };
}

function authInputToStored(
  auth: ServerAuthInput,
  currentHeaders: Record<string, string>,
  creating: boolean,
): StoredAuth {
  if (auth.type === "none") {
    return { authType: "none", authHeaderName: null, headers: {} };
  }

  if (auth.type === "oauth") {
    return { authType: "oauth", authHeaderName: null, headers: {} };
  }

  if (auth.type === "custom_headers") {
    return { authType: "custom_headers", authHeaderName: null, headers: auth.headers ?? {} };
  }

  if (auth.type === "bearer") {
    if (auth.token?.trim()) {
      return {
        authType: "bearer",
        authHeaderName: "Authorization",
        headers: { Authorization: `Bearer ${auth.token.trim()}` },
      };
    }

    if (!creating && currentHeaders.Authorization) {
      return { authType: "bearer", authHeaderName: "Authorization", headers: currentHeaders };
    }

    throw new Error("Bearer token is required");
  }

  if (auth.key?.trim()) {
    return {
      authType: "api_key",
      authHeaderName: auth.headerName,
      headers: { [auth.headerName]: auth.key.trim() },
    };
  }

  if (!creating && currentHeaders[auth.headerName]) {
    return { authType: "api_key", authHeaderName: auth.headerName, headers: currentHeaders };
  }

  throw new Error("API key is required");
}

function assertSecretRecord(
  value: unknown,
  serverId: string,
  column: string,
): asserts value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Stored ${column} for server ${serverId} must be a JSON object`);
  }

  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") {
      throw new Error(`Stored ${column}.${key} for server ${serverId} must be a string`);
    }
  }
}
