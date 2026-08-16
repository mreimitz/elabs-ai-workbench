/**
 * Thread-affinity cache (WP4.1; research 04 §4 M1(b)). A Qlik Answers thread accepts only NEW
 * prompts — history can't be replayed into it — so a stateless Chat Completions `messages[]` array
 * is bridged to a stateful thread by **affinity**: an append-only conversation reuses one thread and
 * sends only the newest user turn, which is semantically identical to the internal executor.
 *
 * The mapping:
 *   - **lookup** for an incoming request keys on `hash(model + messages[0..n-1])` — every message
 *     EXCEPT the newest user turn (the prompt about to be sent).
 *   - **store**, after the answer settles, keys on `hash(model + [...messages, {assistant, answer}])` —
 *     the full conversation INCLUDING the answer we just produced.
 *
 * So turn *k+1*'s lookup (`...` up to turn *k*'s answer, which the client echoes back) hits the entry
 * turn *k*'s store wrote → the same thread is reused and only the newest message is sent. A first
 * turn (or any single-turn automated call) never hits (nothing is ever stored under the empty-prefix
 * key) → a fresh thread, which is correct thread-per-request behavior. An **edited/forked** history
 * yields a different prefix hash → a miss → a new thread → documented amnesia (WP4.R probes this).
 *
 * Bounded LRU + TTL; the app is single-instance/local, so an in-process map suffices (research §6).
 */

import crypto from "node:crypto";
import type { ChatContentPart, ChatMessage } from "./types.js";

const DEFAULT_MAX_ENTRIES = 500;
const DEFAULT_TTL_MS = 30 * 60_000; // 30 min — matches Qlik's longer wait default (D-US7)

type Entry = { threadId: string; expires: number };

export class ThreadAffinityCache {
  private readonly map = new Map<string, Entry>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(opts?: { maxEntries?: number; ttlMs?: number; now?: () => number }) {
    this.maxEntries = Math.max(1, opts?.maxEntries ?? DEFAULT_MAX_ENTRIES);
    this.ttlMs = Math.max(1, opts?.ttlMs ?? DEFAULT_TTL_MS);
    this.now = opts?.now ?? Date.now;
  }

  /**
   * Look up the thread for an incoming request: keyed on the prior messages (everything except the
   * newest user turn). Returns the cached `threadId` on a live hit (and refreshes its LRU recency +
   * TTL), or `undefined` on a miss / expired entry.
   */
  lookup(model: string, messages: ChatMessage[]): string | undefined {
    const key = hashMessages(model, priorMessages(messages));
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expires <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    // LRU touch: re-insert so it becomes most-recent.
    this.map.delete(key);
    entry.expires = this.now() + this.ttlMs;
    this.map.set(key, entry);
    return entry.threadId;
  }

  /**
   * Record the thread AFTER the answer settled, keyed on the FULL conversation including the answer
   * we produced (so the next append-only turn's {@link lookup} hits). Evicts the oldest entry when
   * over capacity (LRU).
   */
  store(model: string, messages: ChatMessage[], answer: string, threadId: string): void {
    const withAnswer: ChatMessage[] = [...messages, { role: "assistant", content: answer }];
    const key = hashMessages(model, withAnswer);
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { threadId, expires: this.now() + this.ttlMs });
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  /** Current live entry count (test/introspection aid). */
  size(): number {
    return this.map.size;
  }
}

/** The prior messages an incoming request's lookup keys on — everything except the newest turn. */
export function priorMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.length > 0 ? messages.slice(0, -1) : [];
}

/**
 * Stable hash of `model` + a normalized message list. Each message is reduced to `role` + its text
 * content (multimodal image parts don't affect thread identity), so two structurally-identical
 * histories hash equally regardless of incidental field ordering.
 */
export function hashMessages(model: string, messages: ChatMessage[]): string {
  const normalized = messages.map((m) => ({ role: m.role, content: messageText(m.content) }));
  const payload = JSON.stringify({ model, messages: normalized });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

/** Flatten a message's content to plain text (string as-is; array → its `text` parts joined; null → ""). */
export function messageText(content: ChatMessage["content"]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part: ChatContentPart) => (typeof part?.text === "string" ? part.text : ""))
      .join("");
  }
  return "";
}
