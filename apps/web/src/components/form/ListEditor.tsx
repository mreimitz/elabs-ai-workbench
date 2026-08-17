import { Button, Input, Text, cn } from "@elabs-ai/components-ui";
import { Plus, Trash2 } from "lucide-react";
import { IconButton } from "../IconButton";

export interface ListEditorProps {
  /** Controlled list — one string per row. */
  value: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
  addLabel?: string;
  disabled?: boolean;
  /** Disable spellcheck (default true) — these are usually args/flags/identifiers, not prose. */
  spellCheck?: boolean;
  /** aria-label for the group (e.g. "Command arguments"). */
  "aria-label"?: string;
  className?: string;
}

/**
 * One string per row → `string[]` — the S11 replacement for the raw `Args JSON` textarea (one arg
 * per row instead of a hand-written JSON array with a leftover example). Add/remove rows; paste is
 * never blocked and `spellCheck` defaults off for arg/flag/identifier content.
 */
export function ListEditor({
  value,
  onChange,
  placeholder = "Add a value…",
  addLabel = "Add item",
  disabled,
  spellCheck = false,
  className,
  ...aria
}: ListEditorProps) {
  const update = (index: number, next: string) =>
    onChange(value.map((item, i) => (i === index ? next : item)));
  const remove = (index: number) => onChange(value.filter((_, i) => i !== index));
  const add = () => onChange([...value, ""]);

  return (
    <div className={cn("flex flex-col gap-2", className)} aria-label={aria["aria-label"]}>
      {value.length === 0 ? (
        <Text variant="meta" className="text-muted-foreground">
          No items yet.
        </Text>
      ) : (
        <ul className="flex flex-col gap-2">
          {value.map((item, index) => (
            // Positional rows keyed by index — reordering isn't supported, so the index is stable.
            <li key={index} className="flex items-center gap-2">
              <Input
                value={item}
                onChange={(e) => update(index, e.target.value)}
                placeholder={placeholder}
                disabled={disabled}
                spellCheck={spellCheck}
                autoComplete="off"
                aria-label={`Item ${index + 1}`}
                className="min-w-0 flex-1"
              />
              <IconButton
                type="button"
                variant="ghost"
                disabled={disabled}
                onClick={() => remove(index)}
                label={`Remove item ${index + 1}`}
                className="shrink-0"
              >
                <Trash2 aria-hidden />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={add}
        className="w-fit"
      >
        <Plus aria-hidden />
        <span>{addLabel}</span>
      </Button>
    </div>
  );
}
