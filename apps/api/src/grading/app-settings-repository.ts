import type { AppDatabase } from "../db/database.js";
import type { AppSettingRow } from "../db/rows.js";

/**
 * Generic key/value store over the `app_settings` table (WP 1.3). Values are JSON blobs; the store is
 * intentionally schema-agnostic — callers validate the shape they read (e.g. the judge-settings routes
 * run `judgeSettingsSchema` over `get(APP_SETTING_JUDGE_KEY)`). References only, NEVER key material
 * (the default judge holds a `providerCredentialId`, not an API key — B3).
 *
 * `put` is an UPSERT (last write wins) stamping `updated_at`; `get` returns the parsed JSON value, or
 * `undefined` for a missing key or a value that fails to parse (a corrupt row is treated as absent).
 */
export class AppSettingsRepository {
  constructor(private readonly db: AppDatabase) {}

  /** The parsed JSON value for `key`, or `undefined` when the key is absent (or the row is unparseable). */
  get(key: string): unknown | undefined {
    const row = this.db.prepare("SELECT value_json FROM app_settings WHERE key = ?").get(key) as
      | Pick<AppSettingRow, "value_json">
      | undefined;
    if (!row) return undefined;
    try {
      return JSON.parse(row.value_json);
    } catch {
      // A corrupt/legacy value is treated as absent rather than throwing into the caller.
      return undefined;
    }
  }

  /** Upsert `value` (JSON-serialized) under `key`, stamping `updated_at`. Last write wins. */
  put(key: string, value: unknown): void {
    const updatedAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO app_settings (key, value_json, updated_at)
         VALUES (@key, @valueJson, @updatedAt)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      )
      .run({ key, valueJson: JSON.stringify(value ?? null), updatedAt });
  }
}
