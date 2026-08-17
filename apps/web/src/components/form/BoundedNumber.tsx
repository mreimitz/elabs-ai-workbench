import { NumberInput, Text, cn } from "@elabs-ai/components-ui";
import { decimalsFromStep, normalizeNumber } from "./numeric";

export interface BoundedNumberProps {
  /** id forwarded to the input (wire a `<Label htmlFor>` to it). */
  id?: string;
  /** Controlled value. `null` means "no limit" and renders the placeholder. */
  value: number | null;
  /** Emits the normalised (clamped + rounded) value, or `null` when cleared. */
  onChange: (value: number | null) => void;
  min?: number;
  max?: number;
  /** Step increment (default 1). Also infers `decimals` when that isn't given. */
  step?: number;
  /** Fractional digits to round/display to. Defaults to the precision implied by `step`. */
  decimals?: number;
  /** Shown when empty — the "no limit / no cap" affordance (S12). Default "No limit". */
  placeholder?: string;
  /** Unit rendered after the field, e.g. "tokens", "$". */
  unit?: string;
  disabled?: boolean;
  "aria-label"?: string;
  "aria-describedby"?: string;
  className?: string;
}

/**
 * A bounded numeric field that treats **empty as a real state** — "No limit" / "No cap" — instead of
 * a stepper you increment away from `∞` (S12: guardrail Max turns/tokens/cost, launcher cost cap).
 *
 * Wraps `@elabs-ai/components-ui` `NumberInput` (clamps to `[min,max]` on blur, never per-keystroke, so typing a
 * long token budget isn't fought). Clearing the field emits `null`. An optional `unit` suffix and a
 * `decimals`/`step`-derived precision keep the display clean.
 */
export function BoundedNumber({
  id,
  value,
  onChange,
  min,
  max,
  step = 1,
  decimals,
  placeholder = "No limit",
  unit,
  disabled,
  className,
  ...aria
}: BoundedNumberProps) {
  const places = decimals ?? decimalsFromStep(step);

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <NumberInput
        id={id}
        value={value}
        min={min}
        max={max}
        step={step}
        clamp
        disabled={disabled}
        placeholder={placeholder}
        formatOptions={{ maximumFractionDigits: places }}
        onValueChange={(next) =>
          onChange(next === null ? null : normalizeNumber(next, { min, max, decimals: places }))
        }
        aria-label={aria["aria-label"]}
        aria-describedby={aria["aria-describedby"]}
        className="min-w-0 flex-1"
      />
      {unit ? (
        <Text variant="meta" className="shrink-0 whitespace-nowrap tabular-nums">
          {unit}
        </Text>
      ) : null}
    </div>
  );
}
