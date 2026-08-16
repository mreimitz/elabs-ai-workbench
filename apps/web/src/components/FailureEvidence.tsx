import { cn, Text } from "@brand/ui";
import { Braces, TriangleAlert } from "lucide-react";

/**
 * The CONCRETE failure evidence of an `error_forensics` finding / rating-issue occurrence — the
 * arguments ACTUALLY sent on the failing tool call (redacted JSON) and the EXACT error text returned.
 * Shared by the run-console Report tab (`FindingRow`) and the Issues registry (`IssuesPanel`
 * occurrence rows) so the same finding reads identically per-run and rolled-up.
 *
 * Both fields are optional (older findings, non-tool categories, or a call with no captured args lack
 * them) — the component renders NOTHING when neither is present, so a caller can always mount it
 * unconditionally. Values arrive already redacted + length-bounded from the API and are shown VERBATIM
 * in token-styled `<pre>` blocks (a structural element, no tokenizer): they wrap, scroll when tall, and
 * read in both themes. Deliberately dependency-light (no `@brand/ai`/Shiki) so it drops into any
 * surface without pulling a heavy render graph.
 */
export function FailureEvidence({
  toolName,
  sentArguments,
  errorMessage,
  className,
}: {
  toolName?: string;
  sentArguments?: string;
  errorMessage?: string;
  className?: string;
}) {
  if (!sentArguments && !errorMessage) return null;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {sentArguments ? (
        <EvidenceBlock
          icon={<Braces aria-hidden className="size-3.5 text-muted-foreground" />}
          label={`Sent parameters${toolName ? ` · ${toolName}` : ""}`}
          value={sentArguments}
          ariaLabel="Arguments actually sent on the failing tool call"
        />
      ) : null}
      {errorMessage ? (
        <EvidenceBlock
          icon={<TriangleAlert aria-hidden className="size-3.5 text-destructive" />}
          label="Exact error"
          value={errorMessage}
          ariaLabel="Exact error returned"
        />
      ) : null}
    </div>
  );
}

function EvidenceBlock({
  icon,
  label,
  value,
  ariaLabel,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  ariaLabel: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-center gap-1.5">
        {icon}
        <Text variant="meta" tone="muted" className="font-medium uppercase tracking-wide">
          {label}
        </Text>
      </div>
      <pre
        aria-label={ariaLabel}
        className="max-h-40 min-w-0 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted px-2.5 py-2 font-mono text-caption text-foreground"
      >
        {value}
      </pre>
    </div>
  );
}
