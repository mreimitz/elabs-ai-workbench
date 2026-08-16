import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  bearerToken,
  checkFacadeAuth,
  loadOrMintFacadeKey,
  timingSafeEqualStr,
} from "../src/openai-facade/auth.js";
import {
  hashMessages,
  messageText,
  priorMessages,
  ThreadAffinityCache,
} from "../src/openai-facade/affinity-cache.js";
import {
  classifyUpstream,
  extractAeCode,
  FacadeError,
  parseRetryAfterSeconds,
} from "../src/openai-facade/mapping.js";
import type { ChatMessage } from "../src/openai-facade/types.js";

// ── auth: facade-key mint (mcp-secret file pattern) + constant-time check ────────────────────────

test("loadOrMintFacadeKey mints a 0600 key once and reuses it on restart; explicit key wins", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "facade-key-"));
  const keyPath = path.join(dir, "openai-facade.key");
  try {
    const first = loadOrMintFacadeKey({ keyPath });
    assert.ok(first.startsWith("mcpfp-"), "minted token carries the facade prefix");
    const second = loadOrMintFacadeKey({ keyPath });
    assert.equal(second, first, "the same key is reused on the next boot (persisted)");
    // Persisted 0600 (owner-only) — the file exists and holds exactly the token.
    assert.equal(fs.readFileSync(keyPath, "utf8").trim(), first);
    const mode = fs.statSync(keyPath).mode & 0o777;
    assert.equal(mode, 0o600, "key file is owner-read/write only");
    // An explicit key short-circuits the file entirely.
    assert.equal(loadOrMintFacadeKey({ keyPath, explicitKey: "provided-key" }), "provided-key");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("bearerToken parses `Authorization: Bearer <token>` (case-insensitive), else undefined", () => {
  assert.equal(bearerToken("Bearer abc123"), "abc123");
  assert.equal(bearerToken("bearer abc123"), "abc123");
  assert.equal(bearerToken("  Bearer   spaced-token  "), "spaced-token");
  assert.equal(bearerToken("Basic abc"), undefined);
  assert.equal(bearerToken(undefined), undefined);
  assert.equal(bearerToken("Bearer "), undefined);
});

test("checkFacadeAuth throws a 401 invalid_api_key on a missing/wrong key, passes on the right one", () => {
  assert.doesNotThrow(() => checkFacadeAuth("Bearer right-key", "right-key"));
  for (const bad of [undefined, "Bearer wrong", "right-key" /* no Bearer */]) {
    const err = assertThrowsFacade(() => checkFacadeAuth(bad, "right-key"));
    assert.equal(err.httpStatus, 401);
    assert.equal(err.code, "invalid_api_key");
  }
});

test("timingSafeEqualStr compares equal-length and different-length strings without throwing", () => {
  assert.equal(timingSafeEqualStr("abc", "abc"), true);
  assert.equal(timingSafeEqualStr("abc", "abd"), false);
  assert.equal(timingSafeEqualStr("short", "a-much-longer-string"), false);
  assert.equal(timingSafeEqualStr("", ""), true);
});

// ── mapping: AE-code extraction, Retry-After parsing, upstream classification ────────────────────

test("extractAeCode reads the REST-envelope, flat, and scan shapes", () => {
  assert.equal(extractAeCode({ errors: [{ code: "AE-4", title: "Prompt is rejected" }] }), "AE-4");
  assert.equal(extractAeCode({ code: "AE-6" }), "AE-6");
  assert.equal(extractAeCode({ nested: { deep: "prefix AE-3 suffix" } }), "AE-3");
  assert.equal(extractAeCode({ unrelated: true }), undefined);
  assert.equal(extractAeCode("AE-6 rate limited"), "AE-6");
});

test("parseRetryAfterSeconds handles delta-seconds and HTTP-dates", () => {
  assert.equal(parseRetryAfterSeconds("5"), 5);
  assert.equal(parseRetryAfterSeconds("0"), 0);
  assert.equal(parseRetryAfterSeconds(null), undefined);
  assert.equal(parseRetryAfterSeconds("not-a-number-or-date"), undefined);
  const future = new Date(Date.now() + 3000).toUTCString();
  const secs = parseRetryAfterSeconds(future);
  assert.ok(secs !== undefined && secs >= 2 && secs <= 4, `date parsed to ~3s (got ${secs})`);
});

test("classifyUpstream maps 429/AE-6 → 429+Retry-After, 401/403/AE-3 → 401, else → 502", () => {
  const headers = (h: Record<string, string> = {}) => ({
    get: (n: string) => h[n.toLowerCase()] ?? null,
  });

  const rl = classifyUpstream(429, {}, headers({ "retry-after": "7" }), "stream");
  assert.equal(rl.httpStatus, 429);
  assert.equal(rl.code, "rate_limit_exceeded");
  assert.equal(rl.retryAfterSeconds, 7);

  const rlAe = classifyUpstream(400, { errors: [{ code: "AE-6" }] }, headers(), "thread");
  assert.equal(rlAe.httpStatus, 429);
  assert.equal(rlAe.retryAfterSeconds, 1, "defaults Retry-After to 1s when no header");

  const auth = classifyUpstream(403, { errors: [{ code: "AE-3" }] }, headers(), "stream");
  assert.equal(auth.httpStatus, 401);

  const upstream = classifyUpstream(500, {}, headers(), "messages");
  assert.equal(upstream.httpStatus, 502);
  assert.equal(upstream.code, "upstream_error");
});

// ── affinity cache: hash prior turns → thread; append reuses, edit forks; LRU + TTL ──────────────

const u = (content: string): ChatMessage => ({ role: "user", content });
const a = (content: string): ChatMessage => ({ role: "assistant", content });

test("messageText flattens string / multimodal-array / null content", () => {
  assert.equal(messageText("plain"), "plain");
  assert.equal(
    messageText([
      { type: "text", text: "a" },
      { type: "text", text: "b" },
    ]),
    "ab",
  );
  assert.equal(messageText([{ type: "image_url", image_url: { url: "x" } }]), "");
  assert.equal(messageText(null), "");
  assert.equal(messageText(undefined), "");
});

test("priorMessages drops the newest turn (the prompt about to be sent)", () => {
  assert.deepEqual(priorMessages([u("a"), a("b"), u("c")]), [u("a"), a("b")]);
  assert.deepEqual(priorMessages([]), []);
});

test("hashMessages is stable and content-driven (image parts don't change identity)", () => {
  assert.equal(hashMessages("m", [u("hi")]), hashMessages("m", [u("hi")]));
  assert.notEqual(hashMessages("m", [u("hi")]), hashMessages("m", [u("bye")]));
  assert.notEqual(hashMessages("m1", [u("hi")]), hashMessages("m2", [u("hi")]));
});

test("affinity: an append-only conversation reuses one thread; an edited history forks", () => {
  const cache = new ThreadAffinityCache();
  // Turn 1: [u1]. prior = [] → miss.
  assert.equal(cache.lookup("model", [u("q1")]), undefined);
  cache.store("model", [u("q1")], "answer-1", "thread-A");
  // Turn 2: [u1, a1, u2]. prior = [u1, a1] == turn-1 store key → hit → same thread.
  assert.equal(cache.lookup("model", [u("q1"), a("answer-1"), u("q2")]), "thread-A");
  cache.store("model", [u("q1"), a("answer-1"), u("q2")], "answer-2", "thread-A");
  // Turn 3: [u1, a1, u2, a2, u3]. prior matches turn-2 store → hit.
  assert.equal(
    cache.lookup("model", [u("q1"), a("answer-1"), u("q2"), a("answer-2"), u("q3")]),
    "thread-A",
  );
  // Edited history (different u1) → miss → a fresh thread would be created.
  assert.equal(cache.lookup("model", [u("EDITED"), a("answer-1"), u("q2")]), undefined);
});

test("affinity: LRU evicts the oldest over capacity; TTL expires stale entries", () => {
  let clock = 1000;
  const cache = new ThreadAffinityCache({ maxEntries: 2, ttlMs: 100, now: () => clock });
  cache.store("m", [u("1")], "a", "t1");
  cache.store("m", [u("2")], "a", "t2");
  cache.store("m", [u("3")], "a", "t3"); // evicts t1 (oldest)
  assert.equal(cache.size(), 2);
  // A lookup keys on the PRIOR messages (all but the newest turn), so the next-turn shape is
  // [stored-user, stored-answer, new-user] → prior === the stored conversation.
  assert.equal(cache.lookup("m", [u("1"), a("a"), u("next")]), undefined, "t1 was evicted");
  assert.equal(cache.lookup("m", [u("3"), a("a"), u("next")]), "t3");
  // TTL: advance past ttl → the entry expires.
  clock += 1000;
  assert.equal(
    cache.lookup("m", [u("3"), a("a"), u("next")]),
    undefined,
    "t3 expired past its TTL",
  );
});

function assertThrowsFacade(fn: () => void): FacadeError {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof FacadeError, "threw a FacadeError");
    return error;
  }
  throw new Error("expected the call to throw a FacadeError");
}
