import { Link } from "react-router-dom";
import { Button, Card, CardContent, CardHeader, CardTitle, Text, cn } from "@brand/ui";
import { AlertTriangle, ArrowRight, Info, Lightbulb } from "lucide-react";
import type { NextStep, NextStepTone } from "./next-steps-derive";

/**
 * The next-steps action cards (audit §H7) — rule-based suggestions rendered at the FOOT of Summary
 * mode (compare-redesign §3.3: "actions read as a footer — now do X"), each wired to an existing
 * surface pre-filled. The rules are computed by {@link deriveNextSteps} (pure); this component only
 * renders them + owns the one side effect the pure layer can't: react-router navigation.
 *
 * Export is deliberately NOT one of these cards (S2 — the compare bar's `Export` split button is the
 * one canonical export action; see `CompareBar.tsx`'s `ExportMenu` and `downloadText` below, which it
 * still uses).
 *
 * DEEP-LINK NOTE: the target views (Environments / Servers / the Skill inspector) currently key their
 * sub-tab + row selection off internal state, not the URL, so a link lands on the right SURFACE
 * pre-filled to that object's page — the finest focus those routes expose today. Deeper sub-tab focus
 * is a follow-up on those views (outside this WP's file domain).
 */
export function NextSteps({ steps }: { steps: NextStep[] }) {
  if (steps.length === 0) return null;

  return (
    <section className="flex flex-col gap-2" aria-labelledby="next-steps-heading">
      <Text id="next-steps-heading" asChild variant="meta" tone="muted" className="font-semibold">
        <h2>Next steps</h2>
      </Text>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {steps.map((step) => (
          <NextStepCard key={step.id} step={step} />
        ))}
      </div>
    </section>
  );
}

const TONE_ICON: Record<NextStepTone, typeof Lightbulb> = {
  recommend: Lightbulb,
  caution: AlertTriangle,
  info: Info,
};

const TONE_ICON_CLASS: Record<NextStepTone, string> = {
  recommend: "text-success",
  caution: "text-warning",
  info: "text-muted-foreground",
};

function NextStepCard({ step }: { step: NextStep }) {
  const Icon = TONE_ICON[step.tone];
  return (
    <Card className="flex flex-col">
      <CardHeader className="gap-1.5">
        <CardTitle className="flex items-start gap-2">
          <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", TONE_ICON_CLASS[step.tone])} />
          <span className="text-pretty">{step.title}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col justify-between gap-3">
        <Text variant="meta" tone="muted" className="text-pretty">
          {step.body}
        </Text>
        <Button variant="outline" size="sm" className="w-fit" asChild>
          <Link to={step.action.to}>
            <span>{step.action.label}</span>
            <ArrowRight aria-hidden />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

/** Trigger a browser download of `text` as `filename` — the one DOM side effect the pure export can't. */
export function downloadText(filename: string, mime: string, text: string) {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
