// Assistant gen-UI (dock chat enhancement, 2026-07) — the PURE parser for the assistant's two
// structured output blocks. The system prompt (apps/api/src/assistant/system-prompt.ts, "Follow-up
// suggestions" / "Metric tiles") teaches the model to emit:
//
//   ```followups            → 1–3 short next-step prompts, rendered as tappable chips under the
//   ["…", "…"]                LAST settled assistant turn (click = send). Stripped from the prose.
//   ```
//
//   ```metrics              → 2–6 headline numbers, rendered as a grid of `@brand/ui` MetricCards
//   [{"label","value",…}]     in place of a bullet list of numbers.
//   ```
//
// Everything else stays ordinary markdown (rendered by ChatMarkdown). Design rules:
//  - STREAMING-SAFE: an UNTERMINATED special fence while the turn is still streaming is dropped
//    (it's mid-arrival — never flash raw JSON); once the turn settles, an unterminated fence is
//    kept as plain markdown so malformed output stays visible rather than silently vanishing.
//  - FAIL-OPEN: an unparseable `metrics` body renders as a normal ```json code block; an
//    unparseable `followups` body tolerates a plain-line / bulleted list before giving up.
//  - A special fence inside an ORDINARY code fence is NOT special (generic fences are copied
//    through verbatim, matching ChatMarkdown's own fence discipline).

export type AssistantMetric = {
  label: string;
  value: string;
  delta?: string;
  deltaDirection?: "up" | "down" | "neutral";
  hint?: string;
};

export type AssistantMessageSegment =
  | { kind: "markdown"; key: string; text: string }
  | { kind: "metrics"; key: string; metrics: AssistantMetric[] };

export type ParsedAssistantMessage = {
  segments: AssistantMessageSegment[];
  followups: string[];
};

const MAX_FOLLOWUPS = 3;
const MAX_METRICS = 6;
const MAX_FOLLOWUP_CHARS = 90;

const SPECIAL_FENCE_RE = /^\s*```(followups|metrics)\s*$/;
const ANY_FENCE_RE = /^\s*(```|~~~)/;
const CLOSING_FENCE_RE = /^\s*(```|~~~)\s*$/;

export function parseAssistantMessage(text: string, streaming: boolean): ParsedAssistantMessage {
  const lines = text.split("\n");
  const segments: AssistantMessageSegment[] = [];
  const followups: string[] = [];
  let plain: string[] = [];
  let keyN = 0;

  const flush = (): void => {
    const markdown = plain.join("\n").trim();
    plain = [];
    if (markdown.length > 0) segments.push({ kind: "markdown", key: `md${keyN++}`, text: markdown });
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const special = SPECIAL_FENCE_RE.exec(line);

    if (!special) {
      if (ANY_FENCE_RE.test(line)) {
        // An ordinary code fence: copy through verbatim up to (and including) its close, so a
        // ```followups line INSIDE a normal fence is never treated as a structured block.
        plain.push(line);
        i++;
        while (i < lines.length) {
          const inner = lines[i] ?? "";
          plain.push(inner);
          i++;
          if (CLOSING_FENCE_RE.test(inner)) break;
        }
        continue;
      }
      plain.push(line);
      i++;
      continue;
    }

    // A special fence: capture its body up to the closing ``` (which must be a bare fence line).
    const lang = special[1] as "followups" | "metrics";
    const body: string[] = [];
    let closed = false;
    let j = i + 1;
    while (j < lines.length) {
      const inner = lines[j] ?? "";
      j++;
      if (CLOSING_FENCE_RE.test(inner)) {
        closed = true;
        break;
      }
      body.push(inner);
    }

    if (!closed) {
      if (streaming) {
        // Mid-arrival — swallow silently; the settled turn will re-parse the complete block.
        i = j;
        continue;
      }
      // Settled but unterminated: keep it visible as plain markdown rather than losing content.
      plain.push(line, ...body);
      i = j;
      continue;
    }

    const raw = body.join("\n").trim();
    if (lang === "followups") {
      followups.push(...parseFollowups(raw));
    } else {
      const metrics = parseMetrics(raw);
      if (metrics && metrics.length > 0) {
        flush();
        segments.push({ kind: "metrics", key: `mx${keyN++}`, metrics });
      } else if (raw.length > 0) {
        // Unparseable metrics: fail open as a visible JSON code block.
        plain.push("```json", ...body, "```");
      }
    }
    i = j;
  }
  flush();

  return { segments, followups: dedupe(followups).slice(0, MAX_FOLLOWUPS) };
}

/** The copyable plain-text form of a parsed message (markdown verbatim; metric tiles as lines). */
export function assistantMessageCopyText(parsed: ParsedAssistantMessage): string {
  return parsed.segments
    .map((segment) =>
      segment.kind === "markdown"
        ? segment.text
        : segment.metrics
            .map((m) => `${m.label}: ${m.value}${m.delta ? ` (${m.delta})` : ""}`)
            .join("\n"),
    )
    .join("\n\n")
    .trim();
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}

/** JSON array of strings preferred; falls back to one suggestion per (optionally bulleted) line. */
function parseFollowups(raw: string): string[] {
  if (raw.length === 0) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((item): item is string => typeof item === "string")
        .map(cleanFollowup)
        .filter((item) => item.length > 0);
    }
  } catch {
    // fall through to the line-based tolerance below
  }
  return raw
    .split("\n")
    .map((line) => cleanFollowup(line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")))
    .filter((line) => line.length > 0);
}

function cleanFollowup(item: string): string {
  const trimmed = item.trim().replace(/^["']|["']$/g, "").trim();
  return trimmed.length > MAX_FOLLOWUP_CHARS ? `${trimmed.slice(0, MAX_FOLLOWUP_CHARS - 1)}…` : trimmed;
}

/** JSON array of {label, value, delta?, hint?}; returns null when the shape isn't usable. */
function parseMetrics(raw: string): AssistantMetric[] | null {
  if (raw.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const metrics: AssistantMetric[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;
    const candidate = item as Record<string, unknown>;
    const label = stringish(candidate.label);
    const value = stringish(candidate.value);
    if (!label || !value) continue;
    const delta = stringish(candidate.delta);
    const metric: AssistantMetric = { label, value };
    if (delta) {
      metric.delta = delta;
      metric.deltaDirection = deltaDirection(candidate.deltaDirection, delta);
    }
    const hint = stringish(candidate.hint);
    if (hint) metric.hint = hint;
    metrics.push(metric);
    if (metrics.length >= MAX_METRICS) break;
  }
  return metrics.length > 0 ? metrics : null;
}

function stringish(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function deltaDirection(explicit: unknown, delta: string): "up" | "down" | "neutral" {
  if (explicit === "up" || explicit === "down" || explicit === "neutral") return explicit;
  const first = delta.trim().charAt(0);
  if (first === "-" || first === "−") return "down";
  if (first === "+") return "up";
  return "neutral";
}
