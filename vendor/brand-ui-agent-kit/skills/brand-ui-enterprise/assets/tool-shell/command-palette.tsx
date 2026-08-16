"use client";
/**
 * ⌘K command palette — Command in a Dialog, wired to UiState.paletteOpen.
 * Verify the Command* exports/props with `brand-ui docs` (cmdk-based).
 */
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@brand/ui";
import { useUiState } from "./ui-state";

export type PaletteCommand = {
  id: string;
  label: string;
  group?: string;
  onRun: () => void;
};

export function CommandPalette({ commands }: { commands: PaletteCommand[] }) {
  const { paletteOpen, setPaletteOpen } = useUiState();
  const groups = commands.reduce<Record<string, PaletteCommand[]>>((acc, c) => {
    const g = c.group ?? "Commands";
    (acc[g] ??= []).push(c);
    return acc;
  }, {});

  return (
    <CommandDialog open={paletteOpen} onOpenChange={setPaletteOpen}>
      <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        {Object.entries(groups).map(([group, items]) => (
          <CommandGroup key={group} heading={group}>
            {items.map((c) => (
              <CommandItem
                key={c.id}
                onSelect={() => {
                  setPaletteOpen(false);
                  c.onRun();
                }}
              >
                {c.label}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
