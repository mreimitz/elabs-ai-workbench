import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { stableStringify } from "../utils/json.js";

const ENCRYPTION_PREFIX = "enc:v1";
const AAD = Buffer.from("mcp-token-footprint:secrets:v1", "utf8");
const KEY_BYTES = 32;
const IV_BYTES = 12;

export class SecretStore {
  constructor(private readonly key: Buffer) {
    if (key.byteLength !== KEY_BYTES) {
      throw new Error(`Secret encryption key must be ${KEY_BYTES} bytes`);
    }
  }

  isEncrypted(value: string | null | undefined): boolean {
    return Boolean(value?.startsWith(`${ENCRYPTION_PREFIX}:`));
  }

  encryptText(plaintext: string): string {
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(AAD);

    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return [ENCRYPTION_PREFIX, encode(iv), encode(authTag), encode(ciphertext)].join(":");
  }

  decryptText(stored: string): string {
    if (!this.isEncrypted(stored)) {
      return stored;
    }

    const parts = stored.split(":");
    if (parts.length !== 5 || parts[0] !== "enc" || parts[1] !== "v1") {
      throw new Error("Stored secret has an unsupported encrypted format");
    }

    const [, , ivPart, authTagPart, ciphertextPart] = parts;
    if (!ivPart || !authTagPart || !ciphertextPart) {
      throw new Error("Stored secret is missing encrypted payload fields");
    }

    try {
      const decipher = crypto.createDecipheriv("aes-256-gcm", this.key, decode(ivPart));
      decipher.setAAD(AAD);
      decipher.setAuthTag(decode(authTagPart));
      return Buffer.concat([decipher.update(decode(ciphertextPart)), decipher.final()]).toString(
        "utf8",
      );
    } catch (error) {
      throw new Error("Stored secret could not be decrypted with the configured key", {
        cause: error,
      });
    }
  }

  encryptJson(value: unknown): string {
    return this.encryptText(stableStringify(value));
  }

  readJson<T>(stored: string | null | undefined, fallback: T): T {
    if (!stored) return fallback;

    const plaintext = this.decryptText(stored);
    try {
      return JSON.parse(plaintext) as T;
    } catch (error) {
      throw new Error("Stored secret JSON is invalid", { cause: error });
    }
  }

  normalizeJson<T>(
    stored: string | null | undefined,
    fallback: T,
  ): { value: T; stored: string; migrated: boolean } {
    const value = this.readJson(stored, fallback);
    if (this.isEncrypted(stored)) {
      return { value, stored: stored!, migrated: false };
    }

    return {
      value,
      stored: this.encryptJson(value),
      migrated: true,
    };
  }
}

export function loadSecretKey(options: { explicitKey?: string; keyPath: string }): Buffer {
  if (options.explicitKey?.trim()) {
    return parseSecretKey(options.explicitKey);
  }

  fs.mkdirSync(path.dirname(options.keyPath), { recursive: true });

  try {
    return parseSecretKey(fs.readFileSync(options.keyPath, "utf8"));
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      throw error;
    }
  }

  const key = crypto.randomBytes(KEY_BYTES);
  try {
    fs.writeFileSync(options.keyPath, `${key.toString("base64")}\n`, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      return parseSecretKey(fs.readFileSync(options.keyPath, "utf8"));
    }

    throw error;
  }

  return key;
}

export function parseSecretKey(value: string): Buffer {
  const trimmed = value.trim();
  const key = Buffer.from(trimmed, "base64");
  if (key.byteLength !== KEY_BYTES) {
    throw new Error("MCP_SECRET_KEY must be a base64-encoded 32-byte key");
  }

  return key;
}

function encode(value: Buffer): string {
  return value.toString("base64url");
}

function decode(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
