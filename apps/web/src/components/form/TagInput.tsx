import { Badge, Input, cn } from "@brand/ui";
import { X } from "lucide-react";
import { type KeyboardEvent, useState } from "react";
import { IconButton } from "../IconButton";

export interface TagInputProps {
  /** Controlled list of tags. */
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  /** Reject duplicates (default true). */
  dedupe?: boolean;
  disabled?: boolean;
  /** aria-label for the text input (e.g. "Tags"). */
  "aria-label"?: string;
  className?: string;
}

/** Split a pasted/typed blob into candidate tags on commas and newlines. */
function tokenize(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/**
 * Free-form tags entered as chips — commit on **Enter** or **comma**, and a paste containing commas
 * splits into several chips at once (S11/S12 tag entry). Backspace on an empty field removes the last
 * chip; each chip has a remove button. Paste is never blocked; `spellCheck` is off (tags aren't prose).
 */
export function TagInput({
  value,
  onChange,
  placeholder = "Add a tag…",
  dedupe = true,
  disabled,
  className,
  ...aria
}: TagInputProps) {
  const [draft, setDraft] = useState("");

  const commit = (tokens: string[]) => {
    if (tokens.length === 0) return;
    let next = value;
    for (const token of tokens) {
      if (dedupe && next.includes(token)) continue;
      next = [...next, token];
    }
    if (next !== value) onChange(next);
    setDraft("");
  };

  const removeAt = (index: number) => onChange(value.filter((_, i) => i !== index));

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit(tokenize(draft));
    } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
      e.preventDefault();
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-background p-1.5",
        disabled && "cursor-not-allowed opacity-60",
        className,
      )}
    >
      {value.map((tag, index) => (
        <Badge key={tag} variant="secondary" className="gap-1 pr-1">
          <span className="truncate">{tag}</span>
          <IconButton
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={disabled}
            onClick={() => removeAt(index)}
            label={`Remove ${tag}`}
            className="size-4 shrink-0"
          >
            <X aria-hidden />
          </IconButton>
        </Badge>
      ))}
      <Input
        value={draft}
        onChange={(e) => {
          const raw = e.target.value;
          // A paste/typed value that already contains a delimiter commits immediately.
          if (/[,\n]/.test(raw)) commit(tokenize(raw));
          else setDraft(raw);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => commit(tokenize(draft))}
        placeholder={value.length === 0 ? placeholder : ""}
        disabled={disabled}
        spellCheck={false}
        autoComplete="off"
        aria-label={aria["aria-label"] ?? "Add a tag"}
        className="min-w-24 flex-1 border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
      />
    </div>
  );
}
