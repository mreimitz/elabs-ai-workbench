import crypto from "node:crypto";
import {
  CSRF_INSTALL_ID_BYTES,
  CSRF_TOKEN_BYTES,
  CSRF_TOKEN_SETTING_KEY,
  looksLikeCsrfInstallId,
  looksLikeCsrfToken,
} from "@mcp-token-footprint/shared";

/** What one install is identified by in the browser: a cookie-name discriminator and the token. */
export type CsrfInstall = { installId: string; token: string };

/** The narrow slice of `AppSettingsRepository` this needs — so a test can pass a plain object. */
export type CsrfTokenStore = {
  get(key: string): unknown | undefined;
  put(key: string, value: unknown): void;
};

/**
 * Resolve this install's browser CSRF token, minting and persisting one on first boot.
 *
 * **Per install, not per process.** A token minted per process would invalidate every open tab on
 * every `docker compose restart` — the operator would get a 403 on their next click and no
 * explanation beyond "reload the page". It lives in the existing `app_settings` KV, so this costs no
 * table, no column and no migration.
 *
 * It is **not a secret in the credential sense**: it authenticates nobody, it is deliberately readable
 * by the SPA's own JavaScript, and knowing it buys an attacker nothing unless they can also make the
 * victim's browser send it — which `SameSite=Strict` plus the origin check is what prevents. It is
 * excluded from the diagnostics bundle all the same, on the principle that a value with no reason to
 * be in a pasted bug report should not be in one.
 *
 * Returns `undefined` only if the store is unusable (a read-only database). The guard treats that as
 * "skip the CSRF check" rather than "refuse everything": bricking the UI over a degraded side-table
 * would be a worse outcome than falling back to the Host and cross-site checks, which still stand.
 */
export function resolveCsrfToken(store: CsrfTokenStore): CsrfInstall | undefined {
  try {
    const existing = store.get(CSRF_TOKEN_SETTING_KEY);
    if (
      typeof existing === "object" &&
      existing !== null &&
      looksLikeCsrfInstallId((existing as CsrfInstall).installId) &&
      looksLikeCsrfToken((existing as CsrfInstall).token)
    ) {
      return existing as CsrfInstall;
    }

    // A value written before the cookie name carried an install id was a bare token string. Keep the
    // token (so any tab holding it is not needlessly invalidated) and give it an id.
    const token =
      typeof existing === "string" && looksLikeCsrfToken(existing)
        ? existing
        : crypto.randomBytes(CSRF_TOKEN_BYTES).toString("base64url");
    const install: CsrfInstall = {
      installId: crypto.randomBytes(CSRF_INSTALL_ID_BYTES).toString("base64url"),
      token,
    };
    store.put(CSRF_TOKEN_SETTING_KEY, install);
    return install;
  } catch {
    return undefined;
  }
}
