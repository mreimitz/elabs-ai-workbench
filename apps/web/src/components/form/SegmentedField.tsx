import { Label, Text, ToggleGroup, ToggleGroupItem, cn } from "@brand/ui";
import type { ReactNode } from "react";

export interface SegmentedOption {
  value: string;
  label: string;
  /** Optional leading glyph. */
  icon?: ReactNode;
  /** Disable this single option (e.g. an unavailable mode). */
  disabled?: boolean;
}

export interface SegmentedFieldProps {
  id: string;
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  options: SegmentedOption[];
  /** Help/explainer rendered under the control (S12: "Tool loading → segmented toggle with explainer below"). */
  help?: ReactNode;
  disabled?: boolean;
  className?: string;
}

/**
 * Label + segmented control + help slot — the S12 fix for ordered/small-cardinality scales rendered
 * as dropdowns (reasoning effort, tool loading eager/deferred, theme, difficulty). Built on
 * `@brand/ui` `ToggleGroup` (single-select). Selection is sticky: clicking the active segment does
 * not clear it (Radix would emit `""`), so there's always exactly one choice.
 */
export function SegmentedField({
  id,
  label,
  value,
  onChange,
  options,
  help,
  disabled,
  className,
}: SegmentedFieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id} id={`${id}-label`}>
        {label}
      </Label>
      <ToggleGroup
        type="single"
        value={value}
        disabled={disabled}
        aria-labelledby={`${id}-label`}
        onValueChange={(next) => {
          // Ignore the empty emission from clicking the already-selected segment — keep it sticky.
          if (next) onChange(next);
        }}
        className="w-fit"
      >
        {options.map((option) => (
          <ToggleGroupItem
            key={option.value}
            id={option.value === value ? id : undefined}
            value={option.value}
            disabled={option.disabled}
            aria-label={option.label}
          >
            {option.icon ? (
              <span className="mr-1.5 inline-flex" aria-hidden>
                {option.icon}
              </span>
            ) : null}
            {option.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {help ? (
        <Text variant="meta" className="text-muted-foreground">
          {help}
        </Text>
      ) : null}
    </div>
  );
}
