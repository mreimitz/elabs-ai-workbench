import { useMemo } from "react";
import type { RunStep } from "@mcp-token-footprint/shared";
import { StatePanel, Text } from "@brand/ui";
import { CodeEditor } from "@brand/editor";
import { safeJson } from "../../lib/format";
import { READ_ONLY_OPTIONS } from "../../lib/monaco";

/**
 * The Application panel's read-only preview pane (WP 3.9, UI §3.4). Given the selected response
 * `RunStep`, it renders that step's content read-only — the "see the actual response" surface of the
 * responses browser. Only `llm_response` and `tool_result` steps reach here (the tree only offers
 * those); anything else (or nothing selected) shows the empty `StatePanel`.
 *
 * SECURITY (`.claude/rules/mcp-and-security.md`): every payload here is UNTRUSTED tool/LLM output. It
 * is rendered read-only **as text / JSON** only — structured payloads via the read-only Monaco
 * `CodeEditor` (no `eval`, no execution of the content), prose via a `Text` node. Never
 * `dangerouslySetInnerHTML`, never parsed into markup. Secrets are already redacted server-side (the
 * `payload` is redacted); we make no attempt to un-redact.
 */

export type ArtifactPreviewProps = {
  /** The selected response step to preview, or `null` when nothing (or a non-response) is selected. */
  step: RunStep | null;
  /**
   * Whether `step` is the run's LAST response step. Only then can the final assistant prose
   * (`finalText`/`finalReasoning`, the run's accumulated `deltas`) honestly be shown — per-turn
   * assistant text is NOT persisted, so earlier `llm_response` steps have no prose to preview.
   */
  isLastResponse?: boolean;
  /** The final turn's accumulated assistant text (`stream.deltas.text`). */
  finalText?: string;
  /** The final turn's accumulated reasoning (`stream.deltas.reasoning`). */
  finalReasoning?: string;
};

export function ArtifactPreview({
  step,
  isLastResponse = false,
  finalText = "",
  finalReasoning = "",
}: ArtifactPreviewProps) {
  if (!step || (step.type !== "llm_response" && step.type !== "tool_result")) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-4">
        <StatePanel
          kind="empty"
          title="Select a response to preview"
          description="Pick an LLM response or tool result from the tree to see its read-only content here."
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {step.type === "tool_result" ? (
        <ToolResultPreview step={step} />
      ) : (
        <LlmResponsePreview
          step={step}
          isLastResponse={isLastResponse}
          finalText={finalText}
          finalReasoning={finalReasoning}
        />
      )}
    </div>
  );
}

// ── tool_result ─────────────────────────────────────────────────────────────────────────────────

function ToolResultPreview({ step }: { step: RunStep }) {
  const obj = asObject(step.payload);
  const error = obj && typeof obj.error === "string" ? obj.error : null;

  if (error !== null) {
    return (
      <PreviewFrame caption={`Tool error · ${step.toolName ?? step.label}`}>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {/* Escaped prose only — never interpreted as markup. The destructive token reads in both themes. */}
          <Text className="whitespace-pre-wrap break-words text-destructive">{error}</Text>
        </div>
      </PreviewFrame>
    );
  }

  // `tool_result` (ok) → `{ toolCallId, result }`; `result` is the real previewable response content.
  // When `payload` itself isn't an object (an unusual shape), `obj` is null and there's no `result`
  // key — fall back to the whole (already-redacted) payload so we still show its real content rather
  // than a bare `"null"`.
  const result = obj && "result" in obj ? obj.result : null;
  const jsonValue = obj === null ? step.payload : result;

  if (typeof result === "string") {
    return (
      <PreviewFrame caption={`Tool result · ${step.toolName ?? step.label}`}>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {/* String results are escaped prose — never HTML. */}
          <Text className="whitespace-pre-wrap break-words">{result}</Text>
        </div>
      </PreviewFrame>
    );
  }

  // Structured (object/array/etc.) → read-only JSON on Monaco.
  return (
    <JsonPreview
      caption={`Tool result (structured) · ${step.toolName ?? step.label}`}
      value={safeJson(jsonValue)}
      ariaLabel={`Tool result for ${step.toolName ?? step.label}`}
    />
  );
}

// ── llm_response ────────────────────────────────────────────────────────────────────────────────

function LlmResponsePreview({
  step,
  isLastResponse,
  finalText,
  finalReasoning,
}: {
  step: RunStep;
  isLastResponse: boolean;
  finalText: string;
  finalReasoning: string;
}) {
  const hasFinalProse =
    isLastResponse && (finalText.trim().length > 0 || finalReasoning.trim().length > 0);

  // Be honest: per-turn assistant prose is NOT persisted. Only the FINAL turn's accumulated text is
  // available (streamed to the conversation pane). Show it only for the last response step.
  if (hasFinalProse) {
    return (
      // The text shown here is the run's accumulated `deltas.text`, which appends across ALL turns
      // (it never resets per turn), so on a multi-turn run it is not strictly "the final message".
      <PreviewFrame caption="Assistant message (accumulated)">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {finalText.trim().length > 0 ? (
            <Text className="whitespace-pre-wrap break-words">{finalText}</Text>
          ) : null}
          {finalReasoning.trim().length > 0 ? (
            <div className="flex flex-col gap-1">
              <Text variant="meta" tone="muted">
                Reasoning
              </Text>
              <Text tone="muted" className="whitespace-pre-wrap break-words">
                {finalReasoning}
              </Text>
            </div>
          ) : null}
        </div>
      </PreviewFrame>
    );
  }

  // No prose available for this (non-final) turn: preview the redacted token-accounting payload, with
  // an honest muted caption explaining where the per-turn prose actually lives.
  return (
    <JsonPreview
      caption="Token-accounting payload (redacted)"
      hint="Per-turn assistant prose streams to the conversation pane and is not separately persisted — showing the redacted token-accounting payload for this response."
      value={safeJson(step.payload)}
      ariaLabel={`Token-accounting payload for ${step.label}`}
    />
  );
}

// ── shared frames ─────────────────────────────────────────────────────────────────────────────────

/** A captioned, fixed-layout frame: a header row + a flex-1 body. Mounts no Monaco itself. */
function PreviewFrame({
  caption,
  hint,
  children,
}: {
  caption: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-none flex-col gap-0.5 border-b border-border px-4 py-2">
        <Text variant="meta" tone="muted" className="truncate" title={caption}>
          {caption}
        </Text>
        {hint ? (
          <Text variant="caption" tone="muted" className="break-words">
            {hint}
          </Text>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/**
 * The single read-only Monaco preview (the ONE mounted editor instance for the panel). Lives inside a
 * `flex-1 min-h-0` body so Monaco's `automaticLayout` has a bounded height to lay out into.
 */
function JsonPreview({
  caption,
  hint,
  value,
  ariaLabel,
}: {
  caption: string;
  hint?: string;
  value: string;
  ariaLabel: string;
}) {
  return (
    <PreviewFrame caption={caption} hint={hint}>
      <div className="min-h-0 flex-1 overflow-hidden">
        <CodeEditor
          value={value}
          language="json"
          readOnly
          height="100%"
          ariaLabel={ariaLabel}
          options={READ_ONLY_OPTIONS}
        />
      </div>
    </PreviewFrame>
  );
}

// ── defensive payload extractor (payload is redacted `unknown`) ──────────────────────────────────

function asObject(payload: unknown): Record<string, unknown> | null {
  return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
}

// ── derivation helper (used by ApplicationPanel) ─────────────────────────────────────────────────

/**
 * Index of the LAST `llm_response` step in `steps`, or -1 if none. The Application panel uses this to
 * decide whether the selected response is the final turn (the only one whose accumulated prose is
 * available in the live `deltas`).
 */
export function lastLlmResponseIndex(steps: RunStep[]): number {
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    if (steps[i]?.type === "llm_response") return i;
  }
  return -1;
}
