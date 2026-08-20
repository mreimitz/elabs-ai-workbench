import { SegmentedField } from "@elabs-ai/components-ui";
import { LayoutGrid, Rows3 } from "lucide-react";
import type { EntityViewMode } from "./types";

/**
 * The grid ⇄ table switch for an overview page (RM-32 D-OD2).
 *
 * `SegmentedField` rather than a bare `ToggleGroup`: Radix's `type="single"` group emits `""` when
 * the ALREADY-ACTIVE segment is re-clicked, which would clear a control that must always hold
 * exactly one value. `SegmentedField` swallows that emission and adds selection-follows-focus for
 * arrow keys (the WAI-ARIA radiogroup pattern) — both behaviours we would otherwise have to
 * re-derive here.
 *
 * The field's label is visually hidden: in a toolbar row the control is understood from its two
 * icons, but the group still needs an accessible name, and each segment carries its own.
 */
export function ViewModeToggle(props: {
  value: EntityViewMode;
  onChange: (mode: EntityViewMode) => void;
}) {
  return (
    <SegmentedField
      label={<span className="sr-only">View</span>}
      value={props.value}
      onValueChange={(value) => props.onChange(value === "table" ? "table" : "grid")}
      options={[
        {
          value: "grid",
          label: (
            <>
              <LayoutGrid aria-hidden className="size-4" />
              <span className="sr-only">Grid view</span>
            </>
          ),
        },
        {
          value: "table",
          label: (
            <>
              <Rows3 aria-hidden className="size-4" />
              <span className="sr-only">Table view</span>
            </>
          ),
        },
      ]}
    />
  );
}
