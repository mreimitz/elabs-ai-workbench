/**
 * Facade authentication (WP4.1). The facade is guarded by a **locally-minted** bearer key — the same
 * file pattern as the MCP secret key ({@link import("../secrets/secret-store.js").loadSecretKey}): a
 * random 32-byte token persisted to a `0600` file under `DATA_DIR`, minted once and reused on
 * restart. Clients present it as `Authorization: Bearer <key>`. The key is NEVER logged and NEVER
 * forwarded to the Qlik tenant (the tenant call uses the SEPARATE stored Qlik credential, resolved
 * by {@link import("./types.js").OpenAiFacadeDeps.resolveModel}) — research 04 §5/§6.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { facadeError } from "./mapping.js";

/** Human-readable prefix so a leaked token is recognizable as this app's facade key (not the raw base64). */
const FACADE_KEY_PREFIX = "mcpfp-";
const KEY_BYTES = 32;

/**
 * Load the facade key from `keyPath`, or mint + persist a new one (0600) the first time. Mirrors
 * {@link import("../secrets/secret-store.js").loadSecretKey}: an explicit key wins; otherwise the
 * file is read, and on `ENOENT` a fresh key is written with `wx` (a concurrent minter that lost the
 * race re-reads the winner's file). Returns the token string clients authenticate with.
 */
export function loadOrMintFacadeKey(options: { explicitKey?: string; keyPath: string }): string {
  const explicit = options.explicitKey?.trim();
  if (explicit) return explicit;

  fs.mkdirSync(path.dirname(options.keyPath), { recursive: true });

  try {
    const existing = fs.readFileSync(options.keyPath, "utf8").trim();
    if (existing) return existing;
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") throw error;
  }

  const token = `${FACADE_KEY_PREFIX}${crypto.randomBytes(KEY_BYTES).toString("base64url")}`;
  try {
    fs.writeFileSync(options.keyPath, `${token}\n`, { flag: "wx", mode: 0o600 });
    return token;
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      return fs.readFileSync(options.keyPath, "utf8").trim();
    }
    throw error;
  }
}

/** Pull the presented bearer token out of an `Authorization` header, or `undefined` when absent/malformed. */
export function bearerToken(authorization: string | undefined): string | undefined {
  if (!authorization) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  const token = match?.[1]?.trim();
  return token && token.length > 0 ? token : undefined;
}

/**
 * Enforce the facade key on a request. A missing or mismatched bearer token throws a `401`
 * OpenAI-envelope error (`invalid_api_key`). The comparison is length-safe + constant-time so a
 * failed check leaks no information about the key. The key value is never included in the error.
 */
export function checkFacadeAuth(authorization: string | undefined, facadeKey: string): void {
  const presented = bearerToken(authorization);
  if (!presented || !timingSafeEqualStr(presented, facadeKey)) {
    throw facadeError({
      httpStatus: 401,
      type: "invalid_request_error",
      code: "invalid_api_key",
      message:
        "Incorrect API key provided. Authenticate with the facade key as `Authorization: Bearer <key>`.",
    });
  }
}

/** Constant-time string comparison that never short-circuits on differing lengths. */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  // `timingSafeEqual` requires equal-length buffers; hash both to a fixed width first so a length
  // mismatch itself is compared in constant time rather than returning early.
  const hashA = crypto.createHash("sha256").update(bufA).digest();
  const hashB = crypto.createHash("sha256").update(bufB).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
