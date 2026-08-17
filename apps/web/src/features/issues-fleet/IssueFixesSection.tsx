import { useState } from "react";
import { Check, Copy, Wrench } from "lucide-react";
import { Badge, Button, Text } from "@elabs-ai/components-ui";
import { BUCKET_LABELS, FIX_TARGET_META, type FleetIssue } from "./issue-lib";

/** Local copy-with-feedback hook — mirrors `ResourcePromptRun.tsx`'s `useCopy` recipe exactly. */
function useCopy(content: string) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }
  return { copied, copy };
}

/**
 * The detail's "drafted fixes" section (WP5.3 spec §Design) — the forensics fix target (bucket +
 * fixTarget chips, the SAME vocabulary `IssuesPanel`'s row chips use) plus the drafted fix text,
 * with a COPY button (the delta this tab adds over `IssuesPanel`'s read-only panel — a fix meant to
 * be pasted into an issue tracker / PR description). Still a SUGGESTION, never auto-applied.
 */
export function IssueFixesSection({ issue }: { issue: FleetIssue }) {
  const fix = FIX_TARGET_META[issue.fixTarget];
  const { copied, copy } = useCopy(issue.draftFix);

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Wrench aria-hidden className="size-3.5 text-muted-foreground" />
          <Text variant="meta" tone="muted" className="font-medium uppercase tracking-wide">
            Draft fix
          </Text>
          <Badge variant="outline">{BUCKET_LABELS[issue.bucket]}</Badge>
          <Badge variant={fix.variant}>{fix.label}</Badge>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void copy()} aria-label="Copy draft fix">
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </Button>
      </div>
      <Text className="break-words text-pretty">{issue.draftFix}</Text>
    </div>
  );
}
