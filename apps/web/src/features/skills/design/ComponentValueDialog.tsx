import { useEffect, useState } from "react";
import { Text } from "@elabs-ai/components-ui";
import { FormDialog } from "../../../components/dialogs";
import { SelectField } from "../../../components/SelectField";
import type { ComponentPlacementInput, SkillComponentSpec } from "./skill-components";

// ── RM-30 WP 7.7 — the one picker a value-carrying component opens ────────────────────────────────
// Three of the nine components reference something that must RESOLVE — a script, a bundled file, a
// bound server's tool. A placeholder there is not a rename-it-later convenience the way "New section"
// is; it is a dangling reference, which is precisely what the Problems panel exists to flag. So those
// three ask, once, in a one-field FormDialog (the D-UX6 tier for ≤6 fields), and say plainly that
// there is nothing to pick rather than inventing a name.

/** The resolver's own value shape — carried whole so nothing has to be parsed back out of a string. */
export type ComponentValue = NonNullable<ComponentPlacementInput["value"]>;

export type ComponentValueOption = {
  /** A unique key for the `Select` (never parsed — {@link value} is what gets staged). */
  key: string;
  label: string;
  /** A second line (a server name, a file kind) — optional. */
  hint?: string;
  value: ComponentValue;
};

export type ComponentValueDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The component asking. `null` while closed. */
  spec: SkillComponentSpec | null;
  /** The section the value will be attached to — named so the author knows what they are editing. */
  sectionLabel: string | null;
  options: ComponentValueOption[];
  /** What to say when `options` is empty — the honest "nothing to pick" state. */
  emptyReason: string;
  onPick: (value: ComponentValue) => void;
};

export function ComponentValueDialog({
  open,
  onOpenChange,
  spec,
  sectionLabel,
  options,
  emptyReason,
  onPick,
}: ComponentValueDialogProps) {
  const [key, setKey] = useState("");

  // Re-seed on every open (and whenever the option set changes underneath): a stale selection from
  // the previous component would silently stage the wrong reference.
  const firstKey = options[0]?.key ?? "";
  useEffect(() => {
    if (open) setKey(firstKey);
  }, [open, firstKey]);

  const kind = spec?.needsValue ?? "file";
  const fieldLabel = kind === "tool" ? "Tool" : kind === "script" ? "Script" : "File";
  const label = spec ? spec.label.toLowerCase() : "component";

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={spec ? `Add a ${label}` : "Add a component"}
      description={
        sectionLabel !== null
          ? `It will be referenced from “${sectionLabel}”. Nothing is saved until you save the draft.`
          : undefined
      }
      primaryLabel={`Add the ${label}`}
      submitDisabled={key === ""}
      onSubmit={() => {
        const picked = options.find((option) => option.key === key);
        if (!picked) return;
        onPick(picked.value);
      }}
    >
      {options.length === 0 ? (
        <Text tone="muted" className="text-pretty">
          {emptyReason}
        </Text>
      ) : (
        <>
          <SelectField
            id="component-value"
            label={fieldLabel}
            value={key}
            options={options.map((option) => ({
              value: option.key,
              label: option.hint ? `${option.label} — ${option.hint}` : option.label,
            }))}
            onChange={setKey}
          />
          <Text variant="meta" tone="muted" className="text-pretty">
            The reference is appended to the section body as a sentence, so the projector lifts it
            back into the flow on the next save.
          </Text>
        </>
      )}
    </FormDialog>
  );
}
