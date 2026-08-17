import type { ComponentProps } from "react";
import { CodeBlock } from "@elabs-ai/components-ai";
import { Text } from "@elabs-ai/components-ui";

/**
 * A compact, read-only code/JSON viewer for the inline tool-call args/results inside the
 * conversation pane (WP 3.4) and the permission/inspector cards. Now the `@elabs-ai/components-ai` `CodeBlock`
 * (Shiki-tokenized, `wrap` for narrow embeds) — the lightweight library code component this file's
 * previous `<pre>`-in-`ScrollArea` escape predated. The heavyweight Monaco `CodeEditor`
 * (`@elabs-ai/components-editor`) remains reserved for full editor surfaces (e.g. `features/scans/ToolDetailPanel`);
 * mounting Monaco per streaming card is still wrong here — `CodeBlock` is purely presentational and
 * token-themed, so it reads in both themes.
 *
 * The public API is unchanged from the hand-rolled version (`value`/`label`/`ariaLabel`/
 * `maxHeightClassName`) so every call site keeps working; `language` is new (default `"json"` — the
 * dominant payload here) for callers that show plain text or code.
 */
export function CodeSnippet({
  value,
  label,
  ariaLabel,
  maxHeightClassName = "max-h-64",
  language = "json",
}: {
  value: string;
  /** Optional caption above the block. */
  label?: string;
  ariaLabel?: string;
  /** Layout-only height clamp so a giant payload scrolls rather than blowing out the card. */
  maxHeightClassName?: string;
  /** Shiki language for tokenization. Defaults to `"json"` (tool args/results). */
  language?: ComponentProps<typeof CodeBlock>["language"];
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {label ? (
        <Text variant="meta" tone="muted">
          {label}
        </Text>
      ) : null}
      <CodeBlock
        aria-label={ariaLabel ?? label}
        code={value}
        language={language}
        wrap
        className={`min-w-0 overflow-y-auto ${maxHeightClassName}`}
      />
    </div>
  );
}
