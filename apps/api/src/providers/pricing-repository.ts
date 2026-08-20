// Observability — DB-backed model pricing map (planning/Roadmap/RM-17-observability/, WP2.6, D-OB22).
//
// The repository over `model_pricing`: CRUD for owner-added `user` rows (`seed` rows are read-only)
// plus the RESOLVER (`resolve`) the pricing seam installs at startup. Resolution is deterministic and
// keyed on the MODEL ID, never on the (best-effort) provider label:
//
//   1. candidates = rows whose `model_match` matches the model AND `effective_from <= at`;
//   2. MOST-SPECIFIC tier wins: any EXACT match beats every regex match;
//   3. within the winning tier, the NEWEST `effective_from` wins (a future-dated row is inert until
//      its date; provider then created_at only break exact ties — practically never decisive).
//
// A malformed stored regex NEVER crashes resolution (it just doesn't match). Invalid regex is
// rejected 400 at WRITE (compile-checked here over the effective value — belt-and-braces with the
// shared zod refinement). MONEY INVARIANT: this module only reads/writes `model_pricing`; it NEVER
// touches `runs`/`run_steps`, so no already-recorded run cost is ever recomputed by a price edit.
//
// ReDoS note: catastrophic-backtracking patterns can't be timed-out around a synchronous `RegExp`
// without a worker. The exposure is bounded instead by (a) the shared 200-char cap on `model_match`,
// (b) resolution only ever testing SHORT (~40-char) model-id strings, and (c) this being a
// single-owner local tool where only the owner authors patterns.

import { nanoid } from "nanoid";
import type {
  ModelPricingEntry,
  ModelPricingInput,
  ModelPricingPatch,
} from "@mcp-token-footprint/shared";
import type { AppDatabase } from "../db/database.js";
import type { ModelPricingRow } from "../db/rows.js";
import { httpError } from "../utils/errors.js";
import type { PricingResolveOptions, PricingResolver, ResolvedPrice } from "./pricing.js";

export class PricingRepository implements PricingResolver {
  constructor(private readonly db: AppDatabase) {}

  /** All entries — seed + user — ordered for a stable Settings table (seed grouped, newest first). */
  list(): ModelPricingEntry[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM model_pricing
          ORDER BY source ASC, provider ASC, model_match ASC, effective_from DESC`,
      )
      .all() as ModelPricingRow[];
    return rows.map(toPublic);
  }

  get(id: string): ModelPricingEntry {
    return toPublic(this.getRow(id));
  }

  /** Create a `user` entry. `effectiveFrom` defaults to now; a regex `modelMatch` is compile-checked. */
  create(input: ModelPricingInput): ModelPricingEntry {
    const isRegex = input.isRegex ?? false;
    this.assertRegexCompiles(isRegex, input.modelMatch);
    const now = new Date().toISOString();
    const id = nanoid();
    this.db
      .prepare(
        `INSERT INTO model_pricing
           (id, provider, model_match, is_regex, input_per_mtok, output_per_mtok,
            cache_read_per_mtok, cache_write_per_mtok, effective_from, created_at, source)
         VALUES
           (@id, @provider, @modelMatch, @isRegex, @inputPerMTok, @outputPerMTok,
            @cacheReadPerMTok, @cacheWritePerMTok, @effectiveFrom, @createdAt, 'user')`,
      )
      .run({
        id,
        provider: input.provider,
        modelMatch: input.modelMatch,
        isRegex: isRegex ? 1 : 0,
        inputPerMTok: input.inputPerMTok,
        outputPerMTok: input.outputPerMTok,
        cacheReadPerMTok: input.cacheReadPerMTok ?? null,
        cacheWritePerMTok: input.cacheWritePerMTok ?? null,
        effectiveFrom: normalizeEffectiveFrom(input.effectiveFrom),
        createdAt: now,
      });
    return this.get(id);
  }

  /**
   * Patch a `user` entry. A `seed` row is read-only (400 — override it by ADDING a newer user row).
   * The merged (effective) `is_regex`/`model_match` is compile-checked so a patch can't smuggle in a
   * bad regex.
   */
  update(id: string, patch: ModelPricingPatch): ModelPricingEntry {
    const row = this.getRow(id);
    if (row.source === "seed") {
      throw httpError(400, "Seed pricing entries are read-only; add a user entry to override one.");
    }
    const nextIsRegex = patch.isRegex ?? row.is_regex === 1;
    const nextModelMatch = patch.modelMatch ?? row.model_match;
    this.assertRegexCompiles(nextIsRegex, nextModelMatch);

    this.db
      .prepare(
        `UPDATE model_pricing SET
           provider = @provider,
           model_match = @modelMatch,
           is_regex = @isRegex,
           input_per_mtok = @inputPerMTok,
           output_per_mtok = @outputPerMTok,
           cache_read_per_mtok = @cacheReadPerMTok,
           cache_write_per_mtok = @cacheWritePerMTok,
           effective_from = @effectiveFrom
         WHERE id = @id`,
      )
      .run({
        id,
        provider: patch.provider ?? row.provider,
        modelMatch: nextModelMatch,
        isRegex: nextIsRegex ? 1 : 0,
        inputPerMTok: patch.inputPerMTok ?? row.input_per_mtok,
        outputPerMTok: patch.outputPerMTok ?? row.output_per_mtok,
        cacheReadPerMTok:
          patch.cacheReadPerMTok !== undefined ? patch.cacheReadPerMTok : row.cache_read_per_mtok,
        cacheWritePerMTok:
          patch.cacheWritePerMTok !== undefined ? patch.cacheWritePerMTok : row.cache_write_per_mtok,
        effectiveFrom:
          patch.effectiveFrom !== undefined
            ? normalizeEffectiveFrom(patch.effectiveFrom)
            : row.effective_from,
      });
    return this.get(id);
  }

  /** Delete a `user` entry (a `seed` row is read-only → 400). */
  delete(id: string): void {
    const row = this.getRow(id);
    if (row.source === "seed") {
      throw httpError(400, "Seed pricing entries are read-only and cannot be deleted.");
    }
    this.db.prepare("DELETE FROM model_pricing WHERE id = ?").run(id);
  }

  /**
   * Resolve a model's price at an instant. Returns `undefined` when no entry matches (the caller then
   * falls back to the code table). See the module header for the precedence rules.
   */
  resolve(model: string, opts?: PricingResolveOptions): ResolvedPrice | undefined {
    const at = opts?.at ?? new Date().toISOString();
    const rows = this.db
      .prepare("SELECT * FROM model_pricing WHERE effective_from <= @at")
      .all({ at }) as ModelPricingRow[];

    const matches = rows.filter((row) => matchesModel(row, model));
    if (matches.length === 0) return undefined;

    const exact = matches.filter((row) => row.is_regex === 0);
    const pool = exact.length > 0 ? exact : matches;
    pool.sort((a, b) => compareCandidates(a, b, opts?.provider));
    const winner = pool[0];
    return winner ? toResolved(winner) : undefined;
  }

  private getRow(id: string): ModelPricingRow {
    const row = this.db.prepare("SELECT * FROM model_pricing WHERE id = ?").get(id) as
      | ModelPricingRow
      | undefined;
    if (!row) throw httpError(404, "Pricing entry not found");
    return row;
  }

  /** Compile-check a regex `model_match` (the authoritative 400 at write). Exact matches always pass. */
  private assertRegexCompiles(isRegex: boolean, modelMatch: string): void {
    if (!isRegex) return;
    try {
      // eslint-disable-next-line no-new
      new RegExp(modelMatch);
    } catch (error) {
      throw httpError(
        400,
        `Invalid regular expression: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

/** Does a row's `model_match` match this model id? A malformed stored regex never throws — it just
 *  doesn't match (so resolution can't crash on a bad pattern that somehow bypassed the write check). */
function matchesModel(row: ModelPricingRow, model: string): boolean {
  if (row.is_regex === 0) return row.model_match === model;
  try {
    return new RegExp(row.model_match).test(model);
  } catch {
    return false;
  }
}

/** Sort key: newest `effective_from` first, then a provider-hint match, then newest `created_at`. */
function compareCandidates(a: ModelPricingRow, b: ModelPricingRow, provider?: string): number {
  if (a.effective_from !== b.effective_from) return a.effective_from < b.effective_from ? 1 : -1;
  const ap = provider && a.provider === provider ? 1 : 0;
  const bp = provider && b.provider === provider ? 1 : 0;
  if (ap !== bp) return bp - ap;
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
  return 0;
}

function toResolved(row: ModelPricingRow): ResolvedPrice {
  const resolved: ResolvedPrice = {
    inPer1M: row.input_per_mtok,
    outPer1M: row.output_per_mtok,
  };
  if (row.cache_read_per_mtok !== null) resolved.cachedInPer1M = row.cache_read_per_mtok;
  if (row.cache_write_per_mtok !== null) resolved.cacheWritePer1M = row.cache_write_per_mtok;
  return resolved;
}

function toPublic(row: ModelPricingRow): ModelPricingEntry {
  return {
    id: row.id,
    provider: row.provider,
    modelMatch: row.model_match,
    isRegex: row.is_regex === 1,
    inputPerMTok: row.input_per_mtok,
    outputPerMTok: row.output_per_mtok,
    ...(row.cache_read_per_mtok !== null ? { cacheReadPerMTok: row.cache_read_per_mtok } : {}),
    ...(row.cache_write_per_mtok !== null ? { cacheWritePerMTok: row.cache_write_per_mtok } : {}),
    effectiveFrom: row.effective_from,
    source: row.source,
    createdAt: row.created_at,
  };
}

/** Normalize an ISO instant to canonical `YYYY-MM-DDTHH:mm:ss.sssZ` so `effective_from` string
 *  comparisons stay lexicographic == chronological. Defaults to now. */
function normalizeEffectiveFrom(value: string | undefined): string {
  return new Date(value ?? Date.now()).toISOString();
}
