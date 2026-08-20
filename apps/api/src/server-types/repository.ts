import { nanoid } from "nanoid";
import type { ServerType, ServerTypeInput, ServerTypeUpdate } from "@mcp-token-footprint/shared";
import { serverTypeInputSchema, serverTypeUpdateSchema } from "@mcp-token-footprint/shared";
import type { AppDatabase } from "../db/database.js";
import type { ServerTypeRow } from "../db/rows.js";
import { httpError } from "../utils/errors.js";

/**
 * Server types (planning/Roadmap/completed/RM-21-server-types, D-ST1/D-ST2): a first-class named group of MCP servers that
 * share one tool surface. Lifecycle status lives on the type. Carries NO secrets and NO connection
 * config, so nothing here touches the SecretStore. Deleting a type detaches members (the
 * `mcp_servers.type_id` FK is ON DELETE SET NULL — D-ST4), never deletes servers.
 */
export class ServerTypeRepository {
  constructor(private readonly db: AppDatabase) {}

  list(): ServerType[] {
    const rows = this.db
      .prepare("SELECT * FROM server_types ORDER BY name COLLATE NOCASE ASC")
      .all() as ServerTypeRow[];
    return rows.map((row) => this.toPublic(row));
  }

  get(id: string): ServerType {
    return this.toPublic(this.getRow(id));
  }

  create(input: ServerTypeInput): ServerType {
    const parsed = serverTypeInputSchema.parse(input);
    this.assertNameFree(parsed.name);
    const now = new Date().toISOString();
    const id = nanoid();

    this.db
      .prepare(
        `INSERT INTO server_types (id, name, status, description, created_at, updated_at)
        VALUES (@id, @name, @status, @description, @createdAt, @updatedAt)`,
      )
      .run({
        id,
        name: parsed.name,
        status: parsed.status,
        description: parsed.description ?? null,
        createdAt: now,
        updatedAt: now,
      });

    return this.get(id);
  }

  update(id: string, update: ServerTypeUpdate): ServerType {
    const parsed = serverTypeUpdateSchema.parse(update);
    const current = this.getRow(id);
    const name = parsed.name ?? current.name;
    if (parsed.name && parsed.name.toLowerCase() !== current.name.toLowerCase()) {
      this.assertNameFree(parsed.name);
    }

    this.db
      .prepare(
        `UPDATE server_types
          SET name = @name, status = @status, description = @description, updated_at = @updatedAt
        WHERE id = @id`,
      )
      .run({
        id,
        name,
        status: parsed.status ?? current.status,
        // `null` explicitly clears the description; omitted keeps the current one.
        description:
          parsed.description === undefined ? current.description : (parsed.description ?? null),
        updatedAt: new Date().toISOString(),
      });

    return this.get(id);
  }

  /** D-ST4: detaches members (FK SET NULL), never deletes servers. */
  delete(id: string): void {
    const result = this.db.prepare("DELETE FROM server_types WHERE id = ?").run(id);
    if (result.changes === 0) {
      throw httpError(404, "Server type not found");
    }
  }

  /** 400 guard used by the servers repository when a create/update assigns a `typeId`. */
  assertExists(id: string): void {
    const row = this.db.prepare("SELECT 1 FROM server_types WHERE id = ?").get(id);
    if (!row) {
      throw httpError(400, `Unknown server type: ${id}`);
    }
  }

  private memberCount(id: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM mcp_servers WHERE type_id = ?")
      .get(id) as { n: number };
    return row.n;
  }

  private assertNameFree(name: string): void {
    const row = this.db
      .prepare("SELECT 1 FROM server_types WHERE name = ? COLLATE NOCASE")
      .get(name);
    if (row) {
      throw httpError(409, `A server type named "${name}" already exists`);
    }
  }

  private getRow(id: string): ServerTypeRow {
    const row = this.db.prepare("SELECT * FROM server_types WHERE id = ?").get(id) as
      | ServerTypeRow
      | undefined;
    if (!row) {
      throw httpError(404, "Server type not found");
    }
    return row;
  }

  private toPublic(row: ServerTypeRow): ServerType {
    return {
      id: row.id,
      name: row.name,
      status: row.status,
      description: row.description ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      memberCount: this.memberCount(row.id),
    };
  }
}
