/**
 * Qlik Answers **cloud-assistants** `actions/stream` parser (roadmap/qlik-answers/, Phase 4c).
 *
 * The stream is line-oriented SSE/NDJSON, but each frame is a **JSON-RPC / JSON-Patch** op that
 * incrementally builds the answer's Adaptive Card — NOT a plain token stream. Verified against a live
 * tenant (2026-07-11), a run emits ~140 `{"method":"delta","params":{…}}` frames of two shapes:
 *
 *   - **structural** — `params.op ("add"|"replace")` + `params.path` (a JSON-Pointer) + an object
 *     `params.value`: creates the card skeleton, a `Qlik.Stepper` ("Answers Agent") and its TextBlocks;
 *   - **text-append** — NO `op`, a string `params.path` (…/text) + a string `params.value`: the actual
 *     streamed **tokens**, appended into that text field.
 *
 * The text-append frames ARE the live agent process: the `<plan>` (Understanding / Subject / Rewritten
 * Question), the activity ("Let me start by discovering the relevant assets"), the **search/tool
 * findings** (keywords, master measures, matched fields), and the `<final>` answer — all streamed into
 * the stepper's `toggleContent`. This parser surfaces them as {@link QlikStreamChunk}s so the run console
 * can show the reasoning/tool activity live (channel `reasoning`), exactly like the native Qlik UI. The
 * settled answer is still fetched from `…/messages` — the stream is the *process*, not the source of truth.
 *
 * Only the text-append frames carry text; structural `op` frames create empty containers (nothing to
 * show) and are skipped. A frame's `messageId` (top-level or nested under `params`) is surfaced so the
 * caller keeps the last one. Robust to the old simple shapes (top-level `output`/`text`) as a fallback.
 */

/** One meaningful thing peeled off the `actions/stream` body. */
export type QlikStreamChunk =
  /** Streamed agent-process text (the plan, activity, tool/search findings, answer composition). */
  | { kind: "reasoning"; text: string }
  /** Streamed main-answer text, when the tenant streams it into the card body (rare; usually via messages). */
  | { kind: "answer"; text: string }
  /** The answer message's id (the caller keeps the LAST one). */
  | { kind: "messageId"; messageId: string };

/** JSON-Pointer segments that mark the reasoning stepper (vs the main answer body). */
function isReasoningPath(path: string): boolean {
  return path.includes("/steps/") || path.includes("/toggleContent/");
}

export class QlikAnswersSseParser {
  private buffer = "";
  private lastReasoningPath = "";
  private lastAnswerPath = "";

  /** Feed the next raw (UTF-8 decoded) chunk; returns the chunks it completed, in stream order. */
  push(text: string): QlikStreamChunk[] {
    this.buffer += text;
    const out: QlikStreamChunk[] = [];
    let newlineIdx = this.buffer.indexOf("\n");
    while (newlineIdx !== -1) {
      const line = this.buffer.slice(0, newlineIdx);
      this.buffer = this.buffer.slice(newlineIdx + 1);
      this.parseFrame(line, out);
      newlineIdx = this.buffer.indexOf("\n");
    }
    return out;
  }

  /** Flush at end-of-stream: parse any trailing line that arrived without a terminating newline. */
  finish(): QlikStreamChunk[] {
    const line = this.buffer;
    this.buffer = "";
    const out: QlikStreamChunk[] = [];
    this.parseFrame(line, out);
    return out;
  }

  private parseFrame(rawLine: string, out: QlikStreamChunk[]): void {
    const line = rawLine.trim();
    if (line.length === 0) return;
    if (line.startsWith(":") || line.startsWith("event:") || line.startsWith("id:")) return;
    const payloadStr = line.startsWith("data:") ? line.slice("data:".length).trim() : line;
    if (payloadStr === "[DONE]") return;
    if (!(payloadStr.startsWith("{") || payloadStr.startsWith("["))) return;
    let value: unknown;
    try {
      value = JSON.parse(payloadStr);
    } catch {
      return; // keep-alive / partial / non-JSON — tolerate
    }

    const messageId = extractMessageId(value);
    if (messageId) out.push({ kind: "messageId", messageId });

    const record = asRecord(value);
    const params = asRecord(record?.params);
    // Primary: a text-append frame (no `op`, string path → …/text, string value = the streamed token).
    if (
      params &&
      params.op === undefined &&
      typeof params.path === "string" &&
      typeof params.value === "string"
    ) {
      if (params.value.length === 0) return;
      const reasoning = isReasoningPath(params.path);
      const prefix = this.sectionPrefix(reasoning, params.path);
      out.push(
        reasoning
          ? { kind: "reasoning", text: prefix + params.value }
          : { kind: "answer", text: prefix + params.value },
      );
      return;
    }
    // Fallback tolerance for a plain-text stream (top-level output/content/text) — treated as answer text.
    const legacy = extractDeltaText(value);
    if (legacy) out.push({ kind: "answer", text: legacy });
  }

  /** A blank line between two distinct stepper/body sections (a new JSON-Pointer path) for readability. */
  private sectionPrefix(reasoning: boolean, path: string): string {
    if (reasoning) {
      const changed = this.lastReasoningPath !== "" && this.lastReasoningPath !== path;
      this.lastReasoningPath = path;
      return changed ? "\n\n" : "";
    }
    const changed = this.lastAnswerPath !== "" && this.lastAnswerPath !== path;
    this.lastAnswerPath = path;
    return changed ? "\n\n" : "";
  }
}

/**
 * A small stateful cleaner for the streamed reasoning: strips the assistant's `<plan>`/`<final>` wrapper
 * tags (the content inside them is the real reasoning) while holding back a trailing PARTIAL tag (e.g. a
 * chunk ending `"<pla"`) until the next chunk completes it — so a tag split across two frames is stripped
 * cleanly instead of leaking. `flush()` releases anything held at end-of-stream.
 */
export class QlikReasoningCleaner {
  private held = "";

  push(chunk: string): string {
    let text = this.held + chunk;
    this.held = "";
    text = text.replace(/<\/?(?:plan|final)>/gi, "");
    // Hold a trailing fragment that could still become a <plan>/</plan>/<final>/</final> tag.
    const match = text.match(/<\/?(?:p(?:l(?:a(?:n)?)?)?|f(?:i(?:n(?:a(?:l)?)?)?)?)?$/i);
    if (match && match.index !== undefined && match[0].length > 0) {
      this.held = text.slice(match.index);
      text = text.slice(0, match.index);
    }
    return text;
  }

  flush(): string {
    const remainder = this.held;
    this.held = "";
    return remainder;
  }
}

/**
 * Find a `messageId` on a frame: top-level, then under `data`/`params`/`payload`, then a shallow scan of
 * dict/array values. First match wins.
 */
export function extractMessageId(obj: unknown): string | undefined {
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = extractMessageId(item);
      if (found) return found;
    }
    return undefined;
  }
  const record = asRecord(obj);
  if (!record) return undefined;
  if (typeof record.messageId === "string" && record.messageId.length > 0) return record.messageId;
  for (const key of ["data", "params", "payload"] as const) {
    const nested = asRecord(record[key]);
    if (nested) {
      const found = extractMessageId(nested);
      if (found) return found;
    }
  }
  for (const value of Object.values(record)) {
    if (value !== null && typeof value === "object") {
      const found = extractMessageId(value);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Best-effort plain answer text from a NON-patch frame (legacy tolerance): a top-level `output` string, a
 * `content[].text` array, or a bare `text`/`delta` string. Returns undefined for a JSON-Patch frame
 * (those carry text under `params`, handled separately).
 */
export function extractDeltaText(obj: unknown): string | undefined {
  const record = asRecord(obj);
  if (!record) return undefined;
  if ("params" in record) return undefined; // a JSON-RPC/patch frame — not a plain-text frame
  if (typeof record.output === "string" && record.output.length > 0) return record.output;
  if (Array.isArray(record.content)) {
    const text = record.content
      .map((part) => {
        const p = asRecord(part);
        return typeof p?.text === "string" ? p.text : "";
      })
      .join("");
    if (text.length > 0) return text;
  }
  if (typeof record.delta === "string" && record.delta.length > 0) return record.delta;
  if (typeof record.text === "string" && record.text.length > 0) return record.text;
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
