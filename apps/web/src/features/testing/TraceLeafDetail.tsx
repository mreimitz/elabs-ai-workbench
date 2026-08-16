import { useState } from "react";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Text,
} from "@brand/ui";
import { CodeEditor } from "@brand/editor";
import { READ_ONLY_OPTIONS } from "../../lib/monaco";
import { Maximize2 } from "lucide-react";
import { CodeSnippet } from "./CodeSnippet";
import { PacketTabs } from "./PacketInspector";
import { useTraceStep } from "./trace-context";

/**
 * The detail surface for a Trace **leaf** (Arguments / Result / Request / Reasoning / Response /
 * Prompt). It renders as a compact, **scrollable** read-only preview (the `<pre>`-in-`ScrollArea`
 * `CodeSnippet`) with a header row carrying the label and an **Expand** button in the top-right
 * corner. Expanding opens a near-fullscreen `Dialog`: the **whole** payload on the left in the
 * read-only Monaco `CodeEditor` (`@brand/editor`), and on the right the SAME detail panel
 * (`PacketTabs`) the right-side inspector Sheet shows — resolved from the leaf's backing `RunStep`.
 *
 * SECURITY (`mcp-and-security.md`): the payload is UNTRUSTED, already-redacted tool/LLM output. It is
 * shown read-only as text only (Monaco `readOnly`, no `eval`, no `dangerouslySetInnerHTML`); we make
 * no attempt to un-redact.
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
      <CodeSnippet value={value} ariaLabel={ariaLabel ?? heading} maxHeightClassName="max-h-56" />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="full" className="flex min-h-0 flex-col gap-0 p-0">
          <DialogHeader className="shrink-0 border-b border-border px-5 py-3 text-left">
            <DialogTitle className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="min-w-0 truncate">{heading}</span>
              {isError ? (
                <Badge variant="destructive" className="font-normal">
                  error
                </Badge>
              ) : null}
            </DialogTitle>
            <DialogDescription>
              The full payload (read-only, already redacted). The detail panel mirrors the
              inspector.
            </DialogDescription>
          </DialogHeader>

          <div className="flex min-h-0 flex-1">
            {/* Left — the whole payload in Monaco. The flex-1/min-h-0 parent gives `height="100%"`
                a bounded box to lay out into (Monaco `automaticLayout`). */}
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
              <CodeEditor
                value={value}
                language={language}
                readOnly
                height="100%"
                ariaLabel={`${heading} (full)`}
                options={READ_ONLY_OPTIONS}
              />
            </div>

            {/* Right — the same detail panel the inspector Sheet shows, for the backing step. */}
            {step ? (
              <div className="flex w-[24rem] shrink-0 flex-col overflow-y-auto border-l border-border p-4">
                <PacketTabs step={step} />
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
