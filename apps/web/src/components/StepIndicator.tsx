import { Fragment } from "react";
import { Separator, Text, cn } from "@brand/ui";

/**
 * The numbered step rail for the two full-page wizards (ServerWizard, SkillWizard), where it was
 * previously duplicated verbatim. Steps up to and including the current one read as "done/active"
 * (filled), the rest muted, with a short separator between them.
 *
 * a11y (critique 2026-07-25T20-00-10Z, T9 item 6): renders as a real ordered list (`<ol>`/`<li>`) —
 * this IS a sequence, not an unordered group of chips — with `aria-current="step"` on the active
 * item (the ARIA-standard way to mark a step-indicator's current step) and an sr-only "Step N of M:
 * <label>" per item so a screen reader gets the count + position that the sighted number badge +
 * label already convey visually. The visible badge/label stay `aria-hidden` so nothing is announced
 * twice (the sr-only sentence is each item's ONE accessible name); the separators between steps are
 * decorative and excluded from the list content itself.
 */
export function StepIndicator({
  steps,
  current,
}: {
  steps: { id: string; label: string }[];
  current: string;
}) {
  const activeIndex = steps.findIndex((item) => item.id === current);
  return (
    <ol className="flex flex-wrap items-center gap-2" aria-label="Progress">
      {steps.map((item, index) => {
        const isActive = index === activeIndex;
        return (
          <Fragment key={item.id}>
            <li
              className="flex items-center gap-2"
              aria-current={isActive ? "step" : undefined}
            >
              <span
                aria-hidden
                className={cn(
                  "flex size-6 items-center justify-center rounded-full border text-meta font-medium",
                  index <= activeIndex
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground",
                )}
              >
                {index + 1}
              </span>
              <Text
                aria-hidden
                variant="meta"
                className={cn(
                  isActive ? "font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                {item.label}
              </Text>
              <span className="sr-only">
                Step {index + 1} of {steps.length}: {item.label}
              </span>
            </li>
            {index < steps.length - 1 ? <Separator aria-hidden className="w-6" /> : null}
          </Fragment>
        );
      })}
    </ol>
  );
}
