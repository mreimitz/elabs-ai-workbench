import { Badge, NumberInput, Slider, cn } from "@brand/ui";
import { RotateCcw } from "lucide-react";
import { decimalsFromStep, normalizeNumber } from "./numeric";
import { IconButton } from "../IconButton";

export interface SliderNumberProps {
  /** id forwarded to the numeric input (wire a `<Label htmlFor>` to it). */
  id?: string;
  /**
   * Controlled value. When `allowDefault` is set, `null` means "use the provider default" and the
   * slider parks at `min` while a marker shows.
   */
  value: number | null;
  /** Emits the normalised (clamped + rounded) value, or `null` when reset to provider default. */
  onChange: (value: number | null) => void;
  min: number;
  max: number;
  /** Step increment (default 1). Also infers `decimals` when that isn't given. */
  step?: number;
  /**
   * Fractional digits to round/display to — this is what kills the `0.30000000000000004` artifact
   * (S12: continuous 0–1 floats like temperature / top_p). Defaults to the precision implied by `step`.
   */
  decimals?: number;
  /** When true, an empty (`null`) value is allowed and shown as the provider-default marker. */
  allowDefault?: boolean;
  /** Copy for the provider-default marker + input placeholder. Default "Provider default". */
  defaultLabel?: string;
  disabled?: boolean;
  "aria-label"?: string;
  className?: string;
}

/**
 * Slider + synced numeric input for a **bounded continuous scale** with an explicit
 * **"provider default"** state — the S12 fix for Temperature / Top P being `−/+` steppers on 0–1
 * floats. Drag the slider or type an exact value; both stay in lockstep and every emission is
 * clamped to `[min,max]` and rounded to `decimals` (no float dust). When `allowDefault`, a Reset
 * control returns the field to `null` (provider default) and a badge shows that state.
 */
export function SliderNumber({
  id,
  value,
  onChange,
  min,
  max,
  step = 1,
  decimals,
  allowDefault = false,
  defaultLabel = "Provider default",
  disabled,
  className,
  ...aria
}: SliderNumberProps) {
  const places = decimals ?? decimalsFromStep(step);
  const isDefault = value === null;
  // Radix Slider needs a concrete number; park an unset value at `min` (marker communicates "default").
  const sliderValue = isDefault ? min : value;

  const emit = (next: number) => onChange(normalizeNumber(next, { min, max, decimals: places }));

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center gap-3">
        <Slider
          value={[sliderValue]}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          aria-label={aria["aria-label"]}
          onValueChange={(vals) => {
            const first = vals[0];
            if (typeof first === "number") emit(first);
          }}
          className="min-w-0 flex-1"
        />
        {/* Wider when a provider-default marker can occupy the input, so "Provider default" isn't clipped. */}
        <div className={cn("flex shrink-0 items-center gap-1", allowDefault ? "w-40" : "w-28")}>
          <NumberInput
            id={id}
            value={value}
            min={min}
            max={max}
            step={step}
            clamp
            disabled={disabled}
            placeholder={allowDefault ? defaultLabel : undefined}
            formatOptions={{ maximumFractionDigits: places }}
            onValueChange={(next) => (next === null ? onChange(null) : emit(next))}
            aria-label={aria["aria-label"]}
            className="min-w-0 flex-1 tabular-nums"
          />
          {allowDefault && !isDefault ? (
            <IconButton
              type="button"
              variant="ghost"
              disabled={disabled}
              label={`Reset to ${defaultLabel.toLowerCase()}`}
              onClick={() => onChange(null)}
              className="shrink-0"
            >
              <RotateCcw aria-hidden />
            </IconButton>
          ) : null}
        </div>
      </div>
      {allowDefault && isDefault ? (
        <Badge variant="secondary" className="w-fit">
          {defaultLabel}
        </Badge>
      ) : null}
    </div>
  );
}
