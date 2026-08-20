// Observability — saved views (planning/Roadmap/RM-17-observability/, WP1.4).
//
// Name + reuse ANY {@link RunFilter}: a saved view is a stored filter + opaque presentation hints,
// selectable in the runs feed (WP2.3, later) and referenced by deep links. `filter_json` is VALIDATED
// against the shared `runFilterSchema` (the SAME validator `GET /api/runs`/`GET /api/metrics/*` apply)
// on every write, so a stored filter re-executes IDENTICALLY to the same inline filter. A view stores
// the FILTER — it NEVER snapshots results (derived-never-authoritative doctrine, conventions §1).
//
// `columns`/`sort` are presentation hints the web UI owns (column visibility/order, a table sort) —
// opaque to the API beyond the `runViewInputSchema`/`runViewPatchSchema` serialized byte-size cap
// (`RUN_VIEW_PRESENTATION_MAX_BYTES`); this module never reads or interprets their shape, only
// round-trips the JSON.

import { nanoid } from "nanoid";
import type { RunView, RunViewInput, RunViewPatch } from "@mcp-token-footprint/shared";
import { runFilterSchema, runViewInputSchema, runViewPatchSchema } from "@mcp-token-footprint/shared";
import type { AppDatabase } from "../db/database.js";
import type { RunViewRow } from "../db/rows.js";
import { httpError } from "../utils/errors.js";

export class RunViewRepository {
  constructor(private readonly db: AppDatabase) {}

  list(): RunView[] {
    const rows = this.db
      .prepare("SELECT * FROM run_views ORDER BY name COLLATE NOCASE ASC")
      .all() as RunViewRow[];
    return rows.map(toPublic);
  }

  get(id: string): RunView {
    return toPublic(this.getRow(id));
  }

  create(input: RunViewInput): RunView {
    const parsed = runViewInputSchema.parse(input);
    this.assertNameFree(parsed.name);

    const now = new Date().toISOString();
    const id = nanoid();

    this.db
      .prepare(
        `INSERT INTO run_views (id, name, filter_json, columns_json, sort_json, created_at, updated_at)
         VALUES (@id, @name, @filterJson, @columnsJson, @sortJson, @createdAt, @updatedAt)`,
      )
      .run({
        id,
        name: parsed.name,
        filterJson: JSON.stringify(parsed.filter),
        columnsJson: parsed.columns === undefined ? null : JSON.stringify(parsed.columns),
        sortJson: parsed.sort === undefined ? null : JSON.stringify(parsed.sort),
        createdAt: now,
        updatedAt: now,
      });

    return this.get(id);
  }

  /** A real partial update — an omitted field keeps its current stored value. */
  update(id: string, patch: RunViewPatch): RunView {
    const parsed = runViewPatchSchema.parse(patch);
    const current = this.getRow(id);

    if (parsed.name !== undefined && parsed.name.toLowerCase() !== current.name.toLowerCase()) {
      this.assertNameFree(parsed.name);
    }

    const name = parsed.name ?? current.name;
    const filterJson =
      parsed.filter !== undefined ? JSON.stringify(parsed.filter) : current.filter_json;
    const columnsJson =
      parsed.columns !== undefined ? JSON.stringify(parsed.columns) : current.columns_json;
    const sortJson = parsed.sort !== undefined ? JSON.stringify(parsed.sort) : current.sort_json;

    this.db
      .prepare(
        `UPDATE run_views
            SET name = @name, filter_json = @filterJson, columns_json = @columnsJson,
                sort_json = @sortJson, updated_at = @updatedAt
          WHERE id = @id`,
      )
      .run({
        id,
        name,
        filterJson,
        columnsJson,
        sortJson,
        updatedAt: new Date().toISOString(),
      });

    return this.get(id);
  }

  /** Hard delete — a view is derived (just a filter), never soft-deleted/archived. */
  delete(id: string): void {
    const result = this.db.prepare("DELETE FROM run_views WHERE id = ?").run(id);
    if (result.changes === 0) {
      throw httpError(404, "Saved view not found");
    }
  }

  private assertNameFree(name: string): void {
    const row = this.db.prepare("SELECT 1 FROM run_views WHERE name = ? COLLATE NOCASE").get(name);
    if (row) {
      throw httpError(409, `A saved view named "${name}" already exists`);
    }
  }

  private getRow(id: string): RunViewRow {
    const row = this.db.prepare("SELECT * FROM run_views WHERE id = ?").get(id) as
      | RunViewRow
      | undefined;
    if (!row) {
      throw httpError(404, "Saved view not found");
    }
    return row;
  }
}

// Reparse `filter_json` through the shared RunFilter zod on every READ too (not just at write time) —
// cheap insurance against a hand-edited/legacy row, and it keeps the returned `filter` a real
// `RunFilter` (not an unchecked `JSON.parse` cast). `columns`/`sort` stay OPAQUE `JSON.parse` (the API
// never validates their shape).
function toPublic(row: RunViewRow): RunView {
  return {
    id: row.id,
    name: row.name,
    filter: runFilterSchema.parse(JSON.parse(row.filter_json)),
    columns: row.columns_json !== null ? JSON.parse(row.columns_json) : undefined,
    sort: row.sort_json !== null ? JSON.parse(row.sort_json) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
