import { useState } from "react";
import { Button, Text } from "@elabs-ai/components-ui";
import { Maximize2 } from "lucide-react";
import { CodeSnippet } from "./CodeSnippet";
import { PayloadDialog } from "./PayloadDialog";
import { useTraceStep } from "./trace-context";

/**
 * The detail surface for a Trace **leaf** (Arguments / Result / Request / Reasoning / Response /
 * Prompt). It renders as a compact, **scrollable** read-only preview (`CodeSnippet`) with a header
 * row carrying the label and an **Expand** button in the top-right corner. Expanding opens the
 * shared `PayloadDialog` — the whole payload in Monaco, plus the inspector's `PacketTabs` for the
 * leaf's backing `RunStep` (resolved here from the Trace step context).
 *
 * SECURITY (`mcp-and-security.md`): the payload is UNTRUSTED, already-redacted tool/LLM output. It is
 * shown read-only as text only (no `eval`, no `dangerouslySetInnerHTML`); we make no attempt to
 * un-redact.
 */

export function TraceLeafDetail({
  value,
  label,
  language = "json",
  ariaLabel,
  isError = false,
  detailStepId,
}: {
  value: string;
  label?: string;
  language?: "json" | "markdown";
  ariaLabel?: string;
  isError?: boolean;
  /** The backing step → the modal's right-side `PacketTabs` (omitted when no step backs this leaf). */
  detailStepId?: string;
}) {
  const [open, setOpen] = useState(false);
  const step = useTraceStep(detailStepId);
  const heading = label ?? "Detail";

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        {label ? (
          <Text variant="meta" tone="muted">
            {label}
          </Text>
        ) : (
          <span />
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setOpen(true)}
          aria-label={`Expand ${heading}`}
        >
          <Maximize2 aria-hidden />
          <span>Expand</span>
        </Button>
      </div>

      {/* Compact, scrollable inline preview — the full content opens in the modal. */}
      <CodeSnippet
        value={value}
        language={language}
        ariaLabel={ariaLabel ?? heading}
        maxHeightClassName="max-h-56"
      />

      <PayloadDialog
        open={open}
        onOpenChange={setOpen}
        heading={heading}
        value={value}
        language={language}
        isError={isError}
        step={step}
      />
    </div>
  );
}
