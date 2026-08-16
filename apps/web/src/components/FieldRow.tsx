import { Children, cloneElement, isValidElement, type ReactNode } from "react";
import { Label, Text, cn } from "@brand/ui";

/** The subset of ARIA props `FieldRow` injects onto the control child. */
type ControlAriaProps = {
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "aria-required"?: boolean;
};

/**
 * One labelled form-field row: a `Label` (wired to the control via `htmlFor={id}`), the control,
 * and an optional inline validation message. The single abstraction that replaces the four that had
 * drifted apart — `FieldRow` in ServerWizard + SkillWizard (had `wide`), `Field` in EnvironmentEditor
 * (had `error`), and the inline `div.flex-col` rows in TestEditor. Supports both `wide`
 * (spans two columns in a 2-col grid) and `error` (a `role="alert"` destructive message).
 *
 * The error message is programmatically associated with the control (finding 4 / D-IC6): the error
 * `<Text>` gets a stable `id`, and the first element child (the actual control — some `FieldRow`
 * consumers also render a trailing helper `Text` or a conditional loading state alongside it) is
 * cloned with `aria-describedby` (merged, space-joined, with any `aria-describedby` the caller
 * already set) and `aria-invalid` while an error is present. Without an error, a caller-supplied
 * `aria-describedby` passes through untouched and no `aria-invalid` is added.
 *
 * `required` renders ONE consistent required marker (a token-coloured `*`, `aria-hidden` — screen
 * readers get the semantic instead) after the label AND sets `aria-required` on the cloned control,
 * so a required field is announced correctly and marked identically everywhere — never a bare
 * string-concatenated `" *"` on some labels and nothing on others (T7 / audit "no required marker").
 */
export function FieldRow({
  id,
  label,
  error,
  wide,
  required,
  children,
}: {
  id: string;
  label: ReactNode;
  error?: string;
  wide?: boolean;
  required?: boolean;
  children: ReactNode;
}) {
  const errorId = `${id}-error`;
  let controlFound = false;
  const content = Children.toArray(children).map((child) => {
    if (controlFound || !isValidElement<ControlAriaProps>(child)) return child;
    controlFound = true;
    const callerDescribedBy = child.props["aria-describedby"];
    return cloneElement(child, {
      "aria-describedby": error
        ? [callerDescribedBy, errorId].filter(Boolean).join(" ")
        : callerDescribedBy,
      "aria-invalid": error ? true : child.props["aria-invalid"],
      "aria-required": required ? true : child.props["aria-required"],
    });
  });

  return (
    <div className={cn("flex flex-col gap-1.5", wide && "sm:col-span-2")}>
      <Label htmlFor={id}>
        {label}
        {required ? (
          <span className="text-destructive" aria-hidden>
            {" *"}
          </span>
        ) : null}
      </Label>
      {content}
      {error ? (
        <Text id={errorId} variant="meta" className="text-destructive" role="alert">
          {error}
        </Text>
      ) : null}
    </div>
  );
}
