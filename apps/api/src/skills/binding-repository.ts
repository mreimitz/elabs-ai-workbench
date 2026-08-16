import type { SkillServerBinding } from "@mcp-token-footprint/shared";
import type { AppDatabase } from "../db/database.js";
import type { SkillServerBindingRow } from "../db/rows.js";

/**
 * Owns the `skill_server_bindings` table (Skill IDE WP 8.1 / I9.1): a skill's portable frontmatter
 * `servers:` names resolved to EXACT registered servers (or an honest unbound `null`). Pure SQL owner
 * — no MCP connection, reads no secret material, no name→id resolution (that stays with the servers
 * repository / the route). Read/upsert only.
 */
export class SkillBindingRepository {
  constructor(private readonly db: AppDatabase) {}

  /** The persisted binding rows for a skill, sorted by server_name (deterministic order). */
  listForSkill(skillId: string): SkillServerBinding[] {
    const rows = this.db
      .prepare(
        "SELECT skill_id, server_name, server_id FROM skill_server_bindings WHERE skill_id = ? ORDER BY server_name ASC",
      )
      .all(skillId) as SkillServerBindingRow[];
    return rows.map((row) => ({ serverName: row.server_name, serverId: row.server_id }));
  }

  /**
   * REPLACE a skill's bindings with exactly `bindings` (the PUT contract). Runs in one transaction:
   * delete every existing row for the skill, then insert the provided set. A `serverId: null` row is
   * an explicit unbound state. Later duplicates of a `serverName` overwrite earlier ones (PK upsert).
   */
  replaceForSkill(skillId: string, bindings: SkillServerBinding[]): void {
    const tx = this.db.transaction(() => {
      this.db.prepare("DELETE FROM skill_server_bindings WHERE skill_id = ?").run(skillId);
      const insert = this.db.prepare(
        `INSERT INTO skill_server_bindings (skill_id, server_name, server_id)
         VALUES (@skillId, @serverName, @serverId)
         ON CONFLICT (skill_id, server_name) DO UPDATE SET server_id = excluded.server_id`,
      );
      for (const binding of bindings) {
        insert.run({ skillId, serverName: binding.serverName, serverId: binding.serverId });
      }
    });
    tx();
  }
}
