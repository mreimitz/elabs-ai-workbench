import type { HubCrewColor } from "@mcp-token-footprint/shared";
import { Label, RadioGroup, RadioGroupItem, cn } from "@elabs-ai/components-ui";
import { CREW_COLOR_KEYS, crewAccentClasses } from "../../lib/hub-ux";

/** Human labels for the five accent swatches. Deliberately neutral ("Color N") rather than a guessed
 *  hue name ("blue") — the SAME `--chart-N` token resolves to a different hue per theme (D-HUX8),
 *  so a hue-based label would be wrong half the time. */
const COLOR_LABELS: Record<HubCrewColor, string> = {
  "chart-1": "Color 1",
  "chart-2": "Color 2",
  "chart-3": "Color 3",
  "chart-4": "Color 4",
  "chart-5": "Color 5",
};

const NONE_VALUE = "__none__";

/**
 * Assistant Hub UX WP2.4 (D-HUX6/D-HUX8) — the crew Profile section's color picker: EXACTLY the five
 * theme-aware `--chart-1…5` swatches (`CREW_COLOR_KEYS` from `lib/hub-ux.ts`, the same source WP2.1's
 * `OrgRail` dot and WP2.5's org-chart group tint read), writing the `chart-N` token string. This is
 * the one place in the app a crew color is deliberately shown as a FILL — everywhere else (avatar
 * ring, card top border, rail dot, org-chart tint) it stays a small accent per D-HUX8; a picker swatch
 * has to show the actual color to be usable as a picker, so it's exempt from the "never a fill" rule.
 * A sixth "No color" option clears the accent back to `null` (an explicit choice, not just "forget to
 * pick one" — an existing crew with a saved color can be reset without deleting the crew).
 */
export function CrewColorPicker({
  value,
  onChange,
  disabled,
}: {
  value: HubCrewColor | null;
  onChange: (next: HubCrewColor | null) => void;
  disabled?: boolean;
}) {
  const selected = value ?? NONE_VALUE;
  return (
    <RadioGroup
      aria-label="Crew color"
      value={selected}
      onValueChange={(next) => onChange(next === NONE_VALUE ? null : (next as HubCrewColor))}
      className="flex flex-row flex-wrap gap-3"
    >
      {CREW_COLOR_KEYS.map((key) => {
        const accent = crewAccentClasses(key);
        const id = `crew-color-${key}`;
        const active = value === key;
        return (
          <Label
            key={key}
            htmlFor={id}
            className={cn(
              "flex size-9 cursor-pointer items-center justify-center rounded-full border-2 p-0.5 transition-colors",
              active ? "border-ring" : "border-transparent",
              disabled && "cursor-not-allowed opacity-50",
            )}
            title={COLOR_LABELS[key]}
          >
            <RadioGroupItem
              id={id}
              value={key}
              disabled={disabled}
              className={cn("size-7 border-0", accent.dot)}
            />
            <span className="sr-only">{COLOR_LABELS[key]}</span>
          </Label>
        );
      })}

      <Label
        htmlFor={`crew-color-${NONE_VALUE}`}
        className={cn(
          "flex size-9 cursor-pointer items-center justify-center rounded-full border-2 border-dashed p-0.5 text-muted-foreground transition-colors",
          selected === NONE_VALUE ? "border-ring" : "border-border",
          disabled && "cursor-not-allowed opacity-50",
        )}
        title="No color"
      >
        <RadioGroupItem
          id={`crew-color-${NONE_VALUE}`}
          value={NONE_VALUE}
          disabled={disabled}
          className="size-7 border-0 bg-transparent"
        />
        <span className="sr-only">No color</span>
      </Label>
    </RadioGroup>
  );
}
