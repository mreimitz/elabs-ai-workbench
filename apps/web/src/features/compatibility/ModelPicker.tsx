import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  cn,
} from "@brand/ui";
import { Check, ChevronDown } from "lucide-react";

export type ModelPickerOption = { value: string; label: string };

/**
 * The model-column picker for the compatibility heatmap (CP3).
 *
 * Replaces the @brand/data `FacetFilter` here: in this view the roster is a *required* control, but
 * FacetFilter's dashed, chevron-less pill read as a disabled input (audit CP3). This is a real,
 * clearly-interactive picker composed from @brand/ui primitives — a solid outline trigger carrying
 * an explicit count + a `▾` affordance, opening a multi-select menu with a "reset to default" action.
 *
 * Empty selection is meaningful: it means "use the server's default column set" (the request omits
 * `models`). When the heatmap has resolved, we can show how many columns that default actually is.
 */
export function ModelPicker({
  options,
  selected,
  onSelectedChange,
  defaultCount,
}: {
  options: ModelPickerOption[];
  selected: string[];
  onSelectedChange: (next: string[]) => void;
  /** How many columns the DEFAULT set resolves to (from the rendered heatmap), when known. */
  defaultCount?: number;
}) {
  const selectedSet = new Set(selected);
  const toggle = (value: string) => {
    const next = new Set(selectedSet);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onSelectedChange([...next]);
  };

  const label =
    selected.length > 0
      ? `${selected.length} model${selected.length === 1 ? "" : "s"}`
      : defaultCount !== undefined
        ? `${defaultCount} models · Default set`
        : "Default set";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="w-full justify-between font-normal"
          aria-label={`Models: ${label}. Choose which model columns to show`}
        >
          <span className="min-w-0 truncate">{label}</span>
          <ChevronDown aria-hidden className="size-4 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[min(24rem,60vh)] w-64 overflow-y-auto">
        <DropdownMenuLabel>Model columns</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options.map((opt) => {
          const checked = selectedSet.has(opt.value);
          // Selection state must reach assistive tech: role="menuitemcheckbox" + aria-checked make
          // this a real checkbox item (the old tick was aria-hidden — a sighted-only signal). Radix's
          // menu Item spreads caller props AFTER its default role="menuitem", so the override lands.
          // The leading Check is now purely decorative (aria-checked is the source of truth); its
          // slot is reserved so labels stay aligned whether checked or not. onSelect preventDefault
          // keeps the menu open across toggles.
          return (
            <DropdownMenuItem
              key={opt.value}
              role="menuitemcheckbox"
              aria-checked={checked}
              onSelect={(event) => {
                event.preventDefault();
                toggle(opt.value);
              }}
              className="gap-2"
            >
              <Check
                aria-hidden
                className={cn("size-4 shrink-0", checked ? "opacity-100" : "opacity-0")}
              />
              <span className="min-w-0 truncate">{opt.label}</span>
            </DropdownMenuItem>
          );
        })}
        {selected.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onSelectedChange([])}>
              Reset to default set
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
