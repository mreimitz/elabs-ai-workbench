import { Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@brand/ui";

/**
 * Label-above stack — for **dialogs and form bodies** only. Importing this into a toolbar module
 * is banned (D-TB9) and a lint failure (WP 4.1). Toolbar single-selects use bare `Select` +
 * `SelectTrigger aria-label` to keep controls on one baseline.
 */
export function SelectField(props: {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  options: { value: string; label: string }[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={props.id}>{props.label}</Label>
      <Select value={props.value} onValueChange={props.onChange} disabled={props.disabled}>
        <SelectTrigger id={props.id} className="w-full">
          <SelectValue placeholder={props.placeholder ?? "Select…"} />
        </SelectTrigger>
        <SelectContent>
          {props.options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
