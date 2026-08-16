// Observability — custom chart composer persistence (roadmap/observability/, WP2.7, D-OB22).
//
// CRUD + reorder + clone over `dashboard_charts` (migration v45) — user-defined charts on the Testing
// dashboard (measure(s) [SAME-UNIT constraint] + filter/groupBy/bucket + chart type). Mirrors
// `views.ts`'s repository shape (the name/filter round-trip pattern): `config_json` is VALIDATED
// against the shared `dashboardChartConfigSchema` on every write (create/update/clone) AND
// re-validated on every READ (cheap insurance against a hand-edited/legacy row), so a stored config
// always re-executes IDENTICALLY against `/api/metrics/*`. This module holds NO aggregation logic of
// its own — `computeRunMetrics`/`computeScanMetrics` (observability/metrics.ts) stay the only place a
// number is derived; the web composer calls those endpoints directly for its live preview.
//
// `position` is a dense 0..N-1 ordering, renumbered after every create/delete so the display order
// never accumulates a gap. `reorder` requires the FULL current id set (no partial reorder) — a
// missing, foreign, or duplicate id is a 400, never a silent drop.

import { nanoid } from "nanoid";
import type { DashboardChart, DashboardChartInput, DashboardChartPatch } from "@mcp-token-footprint/shared";
import {
  dashboardChartConfigSchema,
  dashboardChartInputSchema,
  dashboardChartPatchSchema,
} from "@mcp-token-footprint/shared";
import type { AppDatabase } from "../db/database.js";
import type { DashboardChartRow } from "../db/rows.js";
import { httpError } from "../utils/errors.js";

export class DashboardChartRepository {
  constructor(private readonly db: AppDatabase) {}

  list(): DashboardChart[] {
    const rows = this.db
      .prepare("SELECT * FROM dashboard_charts ORDER BY position ASC, created_at ASC")
      .all() as DashboardChartRow[];
    return rows.map(toPublic);
  }

  get(id: string): DashboardChart {
    return toPublic(this.getRow(id));
  }

  create(input: DashboardChartInput): DashboardChart {
    const parsed = dashboardChartInputSchema.parse(input);
    const id = nanoid();
    const now = new Date().toISOString();
    const position = this.nextPosition();

    this.db
      .prepare(
        `INSERT INTO dashboard_charts (id, name, config_json, position, created_at, updated_at)
         VALUES (@id, @name, @configJson, @position, @createdAt, @updatedAt)`,
      )
      .run({
        id,
        name: parsed.name,
        configJson: JSON.stringify(parsed.config),
        position,
        createdAt: now,
        updatedAt: now,
      });

    return this.get(id);
  }

  /** A real partial update — an omitted field keeps its current stored value. Never touches
   *  `position` (use {@link reorder}). */
  update(id: string, patch: DashboardChartPatch): DashboardChart {
    const parsed = dashboardChartPatchSchema.parse(patch);
    const current = this.getRow(id);

    const name = parsed.name ?? current.name;
    const configJson =
      parsed.config !== undefined ? JSON.stringify(parsed.config) : current.config_json;

    this.db
      .prepare(
        `UPDATE dashboard_charts SET name = @name, config_json = @configJson, updated_at = @updatedAt
          WHERE id = @id`,
      )
      .run({ id, name, configJson, updatedAt: new Date().toISOString() });

    return this.get(id);
  }

  /** `POST /api/dashboard-charts/:id/clone` — a new chart with the SAME config, appended at the end
   *  of the display order. Never mutates the source. */
  clone(id: string): DashboardChart {
    const source = this.getRow(id);
    return this.create({
      name: `${source.name} (copy)`,
      config: dashboardChartConfigSchema.parse(JSON.parse(source.config_json)),
    });
  }

  /** Hard delete — a chart is a stored config, never soft-deleted/archived (mirrors run_views). The
   *  remaining charts' positions are renumbered so the display order stays dense (no gap). */
  delete(id: string): void {
    const result = this.db.prepare("DELETE FROM dashboard_charts WHERE id = ?").run(id);
    if (result.changes === 0) throw httpError(404, "Custom chart not found");
    this.renumber();
  }

  /**
   * `POST /api/dashboard-charts/reorder` — apply a NEW display order. `orderedIds` must be EXACTLY the
   * current chart id set (every existing id present exactly once); a missing, foreign, or duplicate id
   * is a 400 (never a silent partial reorder). Returns the reordered list.
   */
  reorder(orderedIds: string[]): DashboardChart[] {
    const current = this.list();
    const currentIds = new Set(current.map((c) => c.id));
    const seen = new Set<string>();
    for (const id of orderedIds) {
      if (!currentIds.has(id)) throw httpError(400, `Unknown chart id in reorder: ${id}`);
      if (seen.has(id)) throw httpError(400, `Duplicate chart id in reorder: ${id}`);
      seen.add(id);
    }
    if (seen.size !== currentIds.size) {
      throw httpError(400, "reorder must include every existing chart id exactly once");
    }

    const now = new Date().toISOString();
    this.db.transaction(() => {
      const stmt = this.db.prepare(
        "UPDATE dashboard_charts SET position = @position, updated_at = @updatedAt WHERE id = @id",
      );
      orderedIds.forEach((id, index) => {
        stmt.run({ id, position: index, updatedAt: now });
      });
    })();

    return this.list();
  }

  private nextPosition(): number {
    const row = this.db
      .prepare("SELECT MAX(position) AS maxPosition FROM dashboard_charts")
      .get() as { maxPosition: number | null } | undefined;
    return (row?.maxPosition ?? -1) + 1;
  }

  /** Renumber every remaining chart to a dense 0..N-1 order (preserving relative order) — called
   *  after a delete so the sequence never accumulates a gap. */
  private renumber(): void {
    const rows = this.db
      .prepare("SELECT id FROM dashboard_charts ORDER BY position ASC, created_at ASC")
      .all() as Array<{ id: string }>;
    const stmt = this.db.prepare("UPDATE dashboard_charts SET position = @position WHERE id = @id");
    rows.forEach((row, index) => stmt.run({ id: row.id, position: index }));
  }

  private getRow(id: string): DashboardChartRow {
    const row = this.db.prepare("SELECT * FROM dashboard_charts WHERE id = ?").get(id) as
      | DashboardChartRow
      | undefined;
    if (!row) throw httpError(404, "Custom chart not found");
    return row;
  }
}

// Row -> public chart. Re-validates the persisted `config_json` through the shared zod (cheap
// insurance against a hand-edited/legacy row), mirroring `views.ts`'s `toPublic`.
function toPublic(row: DashboardChartRow): DashboardChart {
  return {
    id: row.id,
    name: row.name,
    config: dashboardChartConfigSchema.parse(JSON.parse(row.config_json)),
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
