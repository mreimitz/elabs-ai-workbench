import { useState } from "react";
import { Alert, AlertDescription, AlertTitle, Badge, Button, Text, cn } from "@brand/ui";
import { AlertTriangle, ChevronDown, Sparkles } from "lucide-react";
import type { CompareCaveat, CompareVerdict } from "./compare-runs";

/**
 * The verdict band (audit §H3) — the workspace zone directly under the compare bar that says, in
 * sentences, *what differs and why*. It has two layers:
 *
 *   1. VERDICT (H3, wired in WP 4.2/4.5) — the computed recommendation + its top-3 reasons (each a
 *      link into Flow mode). WP 4.1 leaves this a TYPED, EMPTY slot: pass a {@link CompareVerdict}
 *      to `verdict` and it renders; WP 4.1 always passes `null`, so only the caveats show. This is
 *      the extension point — do not compute a verdict here, hand one in from the mode that has the
 *      token-slice / grade data.
 *
 *   2. CAVEATS (H3 / T9h) — when runs aren't comparable. Per compare-redesign §3.1 C2 the workspace
 *      now surfaces caveats as a `⚠ n` chip + popover on the compare bar, NOT as a permanent band, so
 *      this band renders ONLY the **blocking** caveats (mixed tests — the runs answered different
 *      prompts, so a verdict would be meaningless). Informational caveats (status/turn mismatch,
 *      ungraded) live in the bar chip alone. Pass the full caveat list; the band filters to blocking.
 *
 * The band renders nothing when there is neither a verdict nor a blocking caveat (a clean, comparable
 * set with no computed verdict yet just shows the modes below).
 */
export function VerdictBand({
  caveats,
  verdict = null,
  onFocus,
}: {
  caveats: CompareCaveat[];
  /** WP 4.2/4.5 extension point — the computed verdict sentence. WP 4.1 passes `null`. */
  verdict?: CompareVerdict | null;
  /** Invoked when a verdict reason is clicked, with its opaque focus token (Flow drill loop). */
  onFocus?: (focus: string) => void;
}) {
  const blocking = caveats.filter((caveat) => caveat.blocking);
  if (blocking.length === 0 && !verdict) return null;

  return (
    <div className="flex flex-col gap-2">
      {verdict ? <VerdictSentence verdict={verdict} onFocus={onFocus} /> : null}
      {blocking.length > 0 ? <CaveatList caveats={blocking} /> : null}
    </div>
  );
}

const VERDICT_TONE: Record<CompareVerdict["tone"], "info" | "success" | "warning"> = {
  recommend: "success",
  neutral: "info",
  caution: "warning",
};

/** The computed verdict + its reason links (rendered only when WP 4.2/4.5 supplies one). */
function VerdictSentence({
  verdict,
  onFocus,
}: {
  verdict: CompareVerdict;
  onFocus?: (focus: string) => void;
}) {
  return (
    <Alert variant={VERDICT_TONE[verdict.tone]}>
      <Sparkles aria-hidden className="size-4" />
      <AlertTitle className="text-pretty">{verdict.headline}</AlertTitle>
      {verdict.reasons.length > 0 ? (
        <AlertDescription>
          <ul className="mt-1 flex flex-col gap-0.5">
            {verdict.reasons.map((reason, index) => (
              <li key={index}>
                {reason.focus && onFocus ? (
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto whitespace-normal p-0 text-left"
                    onClick={() => onFocus(reason.focus!)}
                  >
                    {reason.text}
                  </Button>
                ) : (
                  <Text variant="meta" className="text-pretty">
                    {reason.text}
                  </Text>
                )}
              </li>
            ))}
          </ul>
        </AlertDescription>
      ) : null}
    </Alert>
  );
}

/** The comparability caveats — capped at three visible, the rest behind an "all caveats" expander. */
function CaveatList({ caveats }: { caveats: CompareCaveat[] }) {
  const [expanded, setExpanded] = useState(false);
  const CAP = 3;
  const overflow = caveats.length - CAP;
  const visible = expanded ? caveats : caveats.slice(0, CAP);

  return (
    <Alert variant="warning">
      <AlertTriangle aria-hidden className="size-4" />
      <AlertTitle className="flex items-center gap-2">
        <span>Not directly comparable</span>
        <Badge variant="outline" className="tabular-nums font-normal">
          {caveats.length}
        </Badge>
      </AlertTitle>
      <AlertDescription>
        <ul className="mt-1 flex flex-col gap-1">
          {visible.map((caveat, index) => (
            <li key={`${caveat.kind}-${index}`} className="text-pretty">
              {caveat.text}
            </li>
          ))}
        </ul>
        {overflow > 0 ? (
          <Button
            variant="link"
            size="sm"
            className="mt-1 h-auto gap-1 p-0"
            onClick={() => setExpanded((value) => !value)}
          >
            <span>{expanded ? "Show fewer" : `Show ${overflow} more`}</span>
            <ChevronDown
              aria-hidden
              className={cn("size-3.5 transition-transform", expanded && "rotate-180")}
            />
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
