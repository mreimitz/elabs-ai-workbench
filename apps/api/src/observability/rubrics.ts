// Observability — review queue lite (planning/Roadmap/RM-17-observability/, WP4.5, D-OB22, FINAL WP).
//
// Structured human review WITHOUT multi-annotator/reservation machinery (D-OB22, single owner): a
// persisted, named RUBRIC — a checklist of keys, each `thumbs`/`scale5`/`note` — walked keyboard-first
// over a filtered set of runs by the web review surface. A "review session" itself is DELIBERATELY
// EPHEMERAL (a source RunFilter/saved view + a rubric, picked at review time in the web UI) — NEVER a
// new persisted entity; this module is the ONLY thing WP4.5 persists. Every verdict a reviewer records
// is written through the EXISTING WP1.5 `run_feedback` API (`observability/feedback.ts`, `POST
// /api/runs/:id/feedback`, source `'human'`, `key` = the rubric key's own name) — this repository
// carries NO feedback data of its own and is never read by grading/suites/compare (D-OB15/AR6).
//
// Mirrors `views.ts`'s repository shape (the name/JSON-blob round-trip pattern): `keys_json` is
// VALIDATED against the shared `reviewRubricInputSchema`/`reviewRubricPatchSchema` on every write AND
// re-validated on every READ (cheap insurance against a hand-edited/legacy row), so a stored rubric
// always re-renders identically. Case-insensitive UNIQUE `name` (server_types/run_views/
// dashboard_charts pattern) backstops the repository's pre-check against a race.

import { nanoid } from "nanoid";
import type { ReviewRubric, ReviewRubricInput, ReviewRubricPatch } from "@mcp-token-footprint/shared";
import { reviewRubricInputSchema, reviewRubricPatchSchema } from "@mcp-token-footprint/shared";
import type { AppDatabase } from "../db/database.js";
import type { ReviewRubricRow } from "../db/rows.js";
import { httpError } from "../utils/errors.js";

export class ReviewRubricRepository {
  constructor(private readonly db: AppDatabase) {}

  list(): ReviewRubric[] {
    const rows = this.db
      .prepare("SELECT * FROM review_rubrics ORDER BY name COLLATE NOCASE ASC")
      .all() as ReviewRubricRow[];
    return rows.map(toPublic);
  }

  get(id: string): ReviewRubric {
    return toPublic(this.getRow(id));
  }

  create(input: ReviewRubricInput): ReviewRubric {
    const parsed = reviewRubricInputSchema.parse(input);
    this.assertNameFree(parsed.name);

    const now = new Date().toISOString();
    const id = nanoid();

    this.db
      .prepare(
        `INSERT INTO review_rubrics (id, name, instructions, keys_json, created_at, updated_at)
         VALUES (@id, @name, @instructions, @keysJson, @createdAt, @updatedAt)`,
      )
      .run({
        id,
        name: parsed.name,
        instructions: parsed.instructions ?? null,
        keysJson: JSON.stringify(parsed.keys),
        createdAt: now,
        updatedAt: now,
      });

    return this.get(id);
  }

  /** A real partial update — an omitted field keeps its current stored value. Supplying `keys`
   *  REPLACES the whole array (not a per-key merge). */
  update(id: string, patch: ReviewRubricPatch): ReviewRubric {
    const parsed = reviewRubricPatchSchema.parse(patch);
    const current = this.getRow(id);

    if (parsed.name !== undefined && parsed.name.toLowerCase() !== current.name.toLowerCase()) {
      this.assertNameFree(parsed.name);
    }

    const name = parsed.name ?? current.name;
    const instructions =
      parsed.instructions !== undefined ? parsed.instructions : current.instructions;
    const keysJson = parsed.keys !== undefined ? JSON.stringify(parsed.keys) : current.keys_json;

    this.db
      .prepare(
        `UPDATE review_rubrics
            SET name = @name, instructions = @instructions, keys_json = @keysJson, updated_at = @updatedAt
          WHERE id = @id`,
      )
      .run({
        id,
        name,
        instructions,
        keysJson,
        updatedAt: new Date().toISOString(),
      });

    return this.get(id);
  }

  /** Hard delete — a rubric is a stored checklist, never soft-deleted/archived (mirrors run_views /
   *  dashboard_charts). Deleting a rubric NEVER touches any `run_feedback` row a review already wrote
   *  under its key names — those rows are ordinary human feedback, independent of the rubric. */
  delete(id: string): void {
    const result = this.db.prepare("DELETE FROM review_rubrics WHERE id = ?").run(id);
    if (result.changes === 0) {
      throw httpError(404, "Review rubric not found");
    }
  }

  private assertNameFree(name: string): void {
    const row = this.db.prepare("SELECT 1 FROM review_rubrics WHERE name = ? COLLATE NOCASE").get(name);
    if (row) {
      throw httpError(409, `A review rubric named "${name}" already exists`);
    }
  }

  private getRow(id: string): ReviewRubricRow {
    const row = this.db.prepare("SELECT * FROM review_rubrics WHERE id = ?").get(id) as
      | ReviewRubricRow
      | undefined;
    if (!row) {
      throw httpError(404, "Review rubric not found");
    }
    return row;
  }
}

// Reparse `keys_json` through the shared zod on every READ too (not just at write time) — cheap
// insurance against a hand-edited/legacy row, mirroring `views.ts`'s `filter_json` discipline.
function toPublic(row: ReviewRubricRow): ReviewRubric {
  return {
    id: row.id,
    name: row.name,
    ...(row.instructions !== null ? { instructions: row.instructions } : {}),
    keys: reviewRubricInputSchema.shape.keys.parse(JSON.parse(row.keys_json)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
