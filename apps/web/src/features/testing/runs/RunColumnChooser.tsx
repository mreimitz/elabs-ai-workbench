import {
  Button,
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@brand/ui";
import { Columns3 } from "lucide-react";
import {
  PREVIEW_MODES,
  PREVIEW_MODE_LABELS,
  RUN_TABLE_COLUMNS,
  RUN_TABLE_COLUMN_LABELS,
  type RunColumnsPreference,
  type RunTableColumnKey,
} from "./run-columns";

export type RunColumnChooserProps = {
  preference: RunColumnsPreference;
  onChange: (next: RunColumnsPreference) => void;
};

/**
 * Column visibility + preview-cell chooser (Observability WP 2.3 DESIGN: "Column chooser + preview
 * cell: persisted per view"). `@brand/data` `ColumnPicker` binds to a TanStack `Table` instance, which
 * the Runs feed's hand-built (nested suite-summary + pinned-column) table deliberately does not use —
 * see `RunsView`'s own doc comment — so this composes `DropdownMenu` + `Checkbox`/`Select` primitives
 * directly (library-first: no TanStack table backing exists here to hand `ColumnPicker`).
 */
export function RunColumnChooser({ preference, onChange }: RunColumnChooserProps) {
  const visibleSet = new Set(preference.visible);

  const toggleColumn = (key: RunTableColumnKey, on: boolean) => {
    const next = on
      ? [...preference.visible, key]
      : preference.visible.filter((k) => k !== key);
    onChange({ ...preference, visible: RUN_TABLE_COLUMNS.filter((k) => next.includes(k)) });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Columns3 aria-hidden className="size-3.5" />
          <span>Columns</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
        <div className="flex flex-col gap-1 px-2 py-1">
          {RUN_TABLE_COLUMNS.map((key) => {
            const id = `run-column-${key}`;
            return (
              <label
                key={key}
                htmlFor={id}
                className="flex cursor-pointer items-center gap-2 rounded-sm px-1 py-1 hover:bg-accent"
              >
                <Checkbox
                  id={id}
                  checked={visibleSet.has(key)}
                  onCheckedChange={(value) => toggleColumn(key, value === true)}
                />
                <span>{RUN_TABLE_COLUMN_LABELS[key]}</span>
              </label>
            );
          })}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Preview cell</DropdownMenuLabel>
        <div className="px-2 py-1.5">
          <Select
            value={preference.previewMode}
            onValueChange={(value) =>
              onChange({ ...preference, previewMode: value as RunColumnsPreference["previewMode"] })
            }
          >
            <SelectTrigger aria-label="Preview cell content">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PREVIEW_MODES.map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {PREVIEW_MODE_LABELS[mode]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
