import { Button, Input, Text, cn } from "@elabs-ai/components-ui";
import { Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { IconButton } from "../IconButton";

/** One key/value pair. Order is preserved (it's an array, not a record) so blank rows can exist. */
export interface KeyValuePair {
  key: string;
  value: string;
}

export interface KeyValueEditorProps {
  /** Controlled list of pairs. */
  value: KeyValuePair[];
  onChange: (pairs: KeyValuePair[]) => void;
  /** Mask values (env secrets / headers) as password fields with a per-row reveal toggle (S11). */
  secret?: boolean;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  addLabel?: string;
  disabled?: boolean;
  /** aria-label for the whole group (e.g. "Environment variables"). */
  "aria-label"?: string;
  className?: string;
}

/**
 * Add/remove key/value rows — the S11 replacement for the raw `Env JSON` textarea in the add-server
 * wizard. Each row is an explicit `key` + `value` input, so there's no JSON to mis-type; `secret`
 * masks the value column (env/header secrets) with a per-row reveal toggle. Paste is never blocked
 * and identifiers get `spellCheck={false}`.
 */
export function KeyValueEditor({
  value,
  onChange,
  secret = false,
  keyPlaceholder = "KEY",
  valuePlaceholder = secret ? "value (hidden)…" : "value…",
  addLabel = "Add row",
  disabled,
  className,
  ...aria
}: KeyValueEditorProps) {
  // Track which rows have been revealed (index-keyed). Only meaningful when `secret`.
  const [revealed, setRevealed] = useState<Set<number>>(new Set());

  const update = (index: number, patch: Partial<KeyValuePair>) => {
    onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };
  const remove = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
    setRevealed((prev) => {
      const next = new Set<number>();
      // Reindex reveal flags around the removed row so a later row doesn't inherit a stale toggle.
      for (const i of prev) {
        if (i < index) next.add(i);
        else if (i > index) next.add(i - 1);
      }
      return next;
    });
  };
  const add = () => onChange([...value, { key: "", value: "" }]);
  const toggleReveal = (index: number) =>
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  return (
    <div className={cn("flex flex-col gap-2", className)} aria-label={aria["aria-label"]}>
      {value.length === 0 ? (
        <Text variant="meta" className="text-muted-foreground">
          No rows yet.
        </Text>
      ) : (
        <ul className="flex flex-col gap-2">
          {value.map((row, index) => {
            const isRevealed = revealed.has(index);
            return (
              // Positional rows keyed by index — reordering isn't supported, so the index is stable.
              <li key={index} className="flex items-center gap-2">
                <Input
                  value={row.key}
                  onChange={(e) => update(index, { key: e.target.value })}
                  placeholder={keyPlaceholder}
                  disabled={disabled}
                  spellCheck={false}
                  autoComplete="off"
                  aria-label={`Key ${index + 1}`}
                  className="min-w-0 flex-1"
                />
                <Input
                  type={secret && !isRevealed ? "password" : "text"}
                  value={row.value}
                  onChange={(e) => update(index, { value: e.target.value })}
                  placeholder={valuePlaceholder}
                  disabled={disabled}
                  spellCheck={false}
                  autoComplete="off"
                  aria-label={`Value ${index + 1}`}
                  className="min-w-0 flex-1"
                />
                {secret ? (
                  <IconButton
                    type="button"
                    variant="ghost"
                    disabled={disabled}
                    onClick={() => toggleReveal(index)}
                    label={isRevealed ? `Hide value ${index + 1}` : `Show value ${index + 1}`}
                    aria-pressed={isRevealed}
                    className="shrink-0"
                  >
                    {isRevealed ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                  </IconButton>
                ) : null}
                <IconButton
                  type="button"
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => remove(index)}
                  label={`Remove row ${index + 1}`}
                  className="shrink-0"
                >
                  <Trash2 aria-hidden />
                </IconButton>
              </li>
            );
          })}
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
