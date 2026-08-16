import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { loadSecretKey, parseSecretKey, SecretStore } from "../src/secrets/secret-store.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("encrypts JSON without storing plaintext and decrypts it with the same key", () => {
  const store = new SecretStore(crypto.randomBytes(32));
  const stored = store.encryptJson({ API_TOKEN: "super-secret" });

  assert.match(stored, /^enc:v1:/);
  assert.equal(stored.includes("super-secret"), false);
  assert.deepEqual(store.readJson(stored, {}), { API_TOKEN: "super-secret" });
});

test("rejects encrypted values when the key is wrong", () => {
  const stored = new SecretStore(Buffer.alloc(32, 1)).encryptJson({ API_TOKEN: "super-secret" });
  const wrongStore = new SecretStore(Buffer.alloc(32, 2));

  assert.throws(() => wrongStore.readJson(stored, {}), /could not be decrypted/);
});

test("loads an explicit base64 key", () => {
  const key = crypto.randomBytes(32);

  assert.deepEqual(parseSecretKey(key.toString("base64")), key);
});

test("generates and reuses a local key file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-token-footprint-"));
  tempDirs.push(dir);
  const keyPath = path.join(dir, "mcp-secret.key");

  const first = loadSecretKey({ keyPath });
  const second = loadSecretKey({ keyPath });

  assert.equal(first.byteLength, 32);
  assert.deepEqual(second, first);
  assert.equal(fs.existsSync(keyPath), true);
});
