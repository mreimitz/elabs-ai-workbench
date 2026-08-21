import type { RunStep } from "@mcp-token-footprint/shared";
import { Badge } from "@elabs-ai/components-ui";
import { CodeEditor } from "@elabs-ai/components-editor";
import { WorkbenchDialog } from "../../components/dialogs";
import { READ_ONLY_OPTIONS } from "../../lib/monaco";
import { PacketTabs } from "./PacketInspector";

/**
 * The near-fullscreen "see the whole payload" modal, shared by every surface that shows a clamped
 * preview of one: the Trace leaf (`TraceLeafDetail`) and the conversation pane's tool card
 * (`ToolCallCard`'s Parameters / Result blocks). The whole payload sits on the left in the read-only
 * Monaco `CodeEditor` (`@elabs-ai/components-editor`); on the right, when a backing `RunStep` is known, the
 * SAME detail panel (`PacketTabs`) the inspector Sheet shows.
 *
 * It is the modal-system's **workbench** tier (`components/dialogs`, audit §S17) — a full working
 * surface with its own two-pane layout, which is exactly what that tier models. It takes an
 * already-resolved `step` rather than reading the Trace's step context, so the chat card — rendered
 * outside that provider — gets the identical modal instead of a lesser one.
 *
 * SECURITY (`mcp-and-security.md`): the payload is UNTRUSTED, already-redacted tool/LLM output. It is
 * shown read-only as text only (Monaco `readOnly`, no `eval`, no `dangerouslySetInnerHTML`); we make
 * no attempt to un-redact.
 */
export function PayloadDialog({
  open,
  onOpenChange,
  heading,
  value,
  language = "json",
  isError = false,
  step,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Dialog title — also the editor's accessible name (`"<heading> (full)"`). */
  heading: string;
  value: string;
  language?: "json" | "markdown";
  isError?: boolean;
  /** The backing step → the right-side `PacketTabs`. `null` ⇒ payload only. */
  step: RunStep | null;
}) {
  return (
    <WorkbenchDialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="min-w-0 truncate">{heading}</span>
          {isError ? (
            <Badge variant="destructive" className="font-normal">
              error
            </Badge>
          ) : null}
        </span>
      }
      description="The full payload (read-only, already redacted). The detail panel mirrors the inspector."
    >
      <div className="flex h-full min-h-0">
        {/* Left — the whole payload in Monaco. The h-full/min-h-0 parent gives `height="100%"`
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
    </WorkbenchDialog>
  );
}
