import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { ProviderRepository } from "../src/providers/repository.js";
import {
  AssistantSubscriptionAuth,
  brokenSubscriptionAuthError,
  type SubscriptionAuthResolver,
  type SubscriptionCredentialReader,
} from "../src/providers/subscription-auth.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { toErrorMessage } from "../src/utils/errors.js";

// Claude subscription (roadmap/claude-subscription/, WP 0.2, D-CS7). All paths are exercised with a
// STUBBED assistant-credential reader + a real in-memory DB — no Claude CLI / real sign-in is ever
// touched here (that is the executor's job, a later WP).

const databases: AppDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function createDatabase(): AppDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  databases.push(db);
  return db;
}

/** A stub reader with at most one `claude_oauth` credential, mirroring AssistantRepository's shape. */
function reader(credential?: { id: string; token: string }): SubscriptionCredentialReader {
  return {
    listCredentials: () =>
      credential ? [{ id: credential.id, kind: "claude_oauth" as const }] : [],
    getDecrypted: (id: string) => {
      if (!credential || credential.id !== id) throw new Error("not found");
      return { token: credential.token };
    },
  };
}

// ── AssistantSubscriptionAuth.resolve — the pure resolution logic (a stubbed reader) ───────────────

test("resolve — a signed-in subscription yields its decrypted OAuth token", () => {
  const auth = new AssistantSubscriptionAuth(reader({ id: "cred-1", token: "sk-ant-oat01-secret" }));
  assert.equal(auth.resolve().token, "sk-ant-oat01-secret");
});

test("resolve — no stored claude_oauth credential (never signed in) is broken", () => {
  const auth = new AssistantSubscriptionAuth(reader());
  const err = assertThrows(() => auth.resolve());
  assert.equal((err as { statusCode?: number }).statusCode, 400);
  assert.match(toErrorMessage(err), /not signed in/i);
});

test("resolve — a credential row with a blank/whitespace token is broken (no partial credential)", () => {
  const auth = new AssistantSubscriptionAuth(reader({ id: "cred-1", token: "   " }));
  assert.throws(() => auth.resolve(), /not signed in/i);
});

test("brokenSubscriptionAuthError is a fixed, secret-free 400 message (no token/bearer/header)", () => {
  const err = brokenSubscriptionAuthError();
  assert.equal((err as { statusCode?: number }).statusCode, 400);
  assert.equal(
    /bearer|token|header/i.test(toErrorMessage(err)),
    false,
    "the message names no secret-shaped material",
  );
});

// ── ProviderRepository — getDecrypted + redact() wiring for the claude_subscription kind ───────────

const OAUTH_TOKEN = "sk-ant-oat01-subscription-secret";

function repoWith(db: AppDatabase, resolver?: SubscriptionAuthResolver): ProviderRepository {
  return new ProviderRepository(db, new SecretStore(Buffer.alloc(32, 9)), resolver);
}
const okResolver: SubscriptionAuthResolver = { resolve: () => ({ token: OAUTH_TOKEN }) };
const brokenResolver: SubscriptionAuthResolver = {
  resolve: () => {
    throw brokenSubscriptionAuthError();
  },
};

test("create — a claude_subscription credential needs no apiKey (keyless by design, D-CS7)", () => {
  const db = createDatabase();
  const repo = repoWith(db, okResolver);

  const cred = repo.create({ kind: "claude_subscription", label: "Claude (subscription)" });

  assert.equal(cred.hasKey, false, "a claude_subscription credential stores no own key");
  assert.equal(cred.kind, "claude_subscription");
  const row = db
    .prepare("SELECT api_key_encrypted FROM provider_credentials WHERE id = ?")
    .get(cred.id) as { api_key_encrypted: string | null };
  assert.equal(row.api_key_encrypted, null, "no key is ever persisted for this kind");
});

test("signed-in claude_subscription — getDecrypted resolves the subscription token as apiKey; redact says not broken", () => {
  const db = createDatabase();
  const repo = repoWith(db, okResolver);
  const cred = repo.create({ kind: "claude_subscription", label: "Claude (subscription)" });

  // Redacted view: no key, not broken.
  assert.equal(cred.hasKey, false);
  assert.equal(cred.authBroken, false, "a resolvable subscription is not broken");
  assert.equal((cred as { apiKey?: unknown }).apiKey, undefined, "the token never leaks in redact()");

  // Decrypted (internal) view: the resolved OAuth token as apiKey, no baseUrl.
  const dec = repo.getDecrypted(cred.id);
  assert.equal(dec.kind, "claude_subscription");
  assert.equal(dec.apiKey, OAUTH_TOKEN, "the resolved subscription token is the apiKey");
  assert.equal(dec.baseUrl, undefined);

  // The resolved token must NEVER appear in any redacted response.
  assert.equal(JSON.stringify(repo.list()).includes(OAUTH_TOKEN), false);
  assert.equal(JSON.stringify(repo.get(cred.id)).includes(OAUTH_TOKEN), false);
  assert.equal(JSON.stringify(cred).includes(OAUTH_TOKEN), false);
});

test("not signed in — provider is still listed (authBroken:true) but getDecrypted refuses with a clear error", () => {
  const db = createDatabase();
  const repo = repoWith(db, brokenResolver);
  const cred = repo.create({ kind: "claude_subscription", label: "Claude (subscription)" });

  // Listed with an "auth broken" state (never removed, never a fake credential).
  assert.equal(cred.authBroken, true);
  assert.equal(
    repo.list().find((c) => c.id === cred.id)?.authBroken,
    true,
    "the broken provider stays in the list",
  );

  // Runs/roster refuse: getDecrypted throws, non-leaking.
  const err = assertThrows(() => repo.getDecrypted(cred.id));
  assert.equal((err as { statusCode?: number }).statusCode, 400);
  assert.match(toErrorMessage(err), /not signed in/i);
});

test("claude_subscription credential with NO resolver configured — redact marks authBroken, getDecrypted throws (never silently unauth)", () => {
  const db = createDatabase();
  const repo = repoWith(db); // no resolver wired
  const cred = repo.create({ kind: "claude_subscription", label: "Unconfigured" });

  assert.equal(cred.authBroken, true, "no resolver configured ⇒ auth-broken");
  const err = assertThrows(() => repo.getDecrypted(cred.id));
  assert.equal((err as { statusCode?: number }).statusCode, 500);
});

test("an existing anthropic credential is unaffected by the subscription resolver being wired", () => {
  const db = createDatabase();
  const repo = repoWith(db, okResolver);
  const cred = repo.create({ kind: "anthropic", label: "Prod", apiKey: "sk-ant-secret" });
  // `authBroken` is a subscription-only signal: an own-key credential leaves it unset.
  assert.equal(cred.authBroken, undefined);
  assert.equal(repo.getDecrypted(cred.id).apiKey, "sk-ant-secret", "own-key path unchanged");
});

function assertThrows(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail("expected the call to throw");
}
