import { Card, Heading, Text, cn } from "@elabs-ai/components-ui";
import { ArrowRight } from "lucide-react";
import { StatusBadge } from "../../../../components/StatusBadge";
import { RunLetterBadge } from "../RunLetterBadge";
import { SUITE_TONE_TEXT, deriveSuiteVerdict, type SuiteCompareData } from "./suite-data";

/**
 * The suite-vs-suite verdict strip (audit §G13.6) — the sentence-level answer the reviewer came for:
 * "did the benchmark matrix get better, cheaper, or both?". A header identifies the two suite runs by
 * their workspace LETTER (Ⓐ baseline → Ⓑ comparison) with each run's terminal {@link StatusBadge};
 * below it, pass rate · mean grade · exec cost · total tokens each show A → B and the toned Δ (D-UX9:
 * green better, red worse, neutral tie). Every Δ is comparison − baseline.
 */
export function SuiteVerdictStrip({ compare }: { compare: SuiteCompareData }) {
  const { baseline, comparison } = compare;
  const metrics = deriveSuiteVerdict(compare);

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <SuiteRunTag
          letter={baseline.letter}
          color={baseline.color}
          baseline
          label="Baseline"
          status={baseline.suiteRun.status}
        />
        <ArrowRight aria-hidden className="size-4 text-muted-foreground" />
        <SuiteRunTag
          letter={comparison.letter}
          color={comparison.color}
          label="Comparison"
          status={comparison.suiteRun.status}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {metrics.map((metric) => (
          <div
            key={metric.key}
            className="flex flex-col gap-1 rounded-md border border-border bg-card p-3"
          >
            <Text variant="meta" tone="muted">
              {metric.label}
            </Text>
            <div className="flex items-baseline gap-1.5">
              <Text as="span" className="tabular-nums">
                {metric.baseText}
              </Text>
              <ArrowRight aria-hidden className="size-3 shrink-0 text-muted-foreground" />
              <Heading level={4} className="tabular-nums">
                {metric.comparisonText}
              </Heading>
            </div>
            {metric.deltaText ? (
              <Text
                as="span"
                variant="meta"
                className={cn("tabular-nums", SUITE_TONE_TEXT[metric.tone])}
              >
                {metric.deltaText}
              </Text>
            ) : (
              <Text as="span" variant="meta" tone="muted">
                not comparable
              </Text>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

function SuiteRunTag({
  letter,
  color,
  status,
  label,
  baseline = false,
}: {
  letter: string;
  color: string;
  status: string;
  label: string;
  baseline?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <RunLetterBadge letter={letter} color={color} baseline={baseline} size="md" />
      <Text as="span" className="font-medium">
        {label}
      </Text>
      <StatusBadge status={status} />
    </span>
  );
}
