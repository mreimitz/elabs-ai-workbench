import type { FormEvent, ReactNode } from "react";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Spinner,
  cn,
} from "@brand/ui";

/**
 * Tier 2 of the modal system (audit §S17) — the SIMPLE FORM tier.
 *
 * When to use: a short create/edit form (≤6 fields) that fits WITHOUT internal scroll. Fixed at
 * ~640px wide (the S17 fix: "≤6 fields, md ~640px, no internal scroll") — wider than the app's old
 * 512px scroll tubes but not the full wide modal. If a form needs sections, an Advanced group, or
 * more than ~8 fields, graduate to `WideDialog` (see the decision rule in `index.ts`).
 *
 * Conventions baked in:
 *  - The whole body is a `<form>`; the primary button is `type="submit"`, so Enter submits.
 *  - Footer order is Cancel | Primary, primary bottom-right (`DialogFooter` → `sm:justify-end`).
 *  - `primaryLabel` is the CONSEQUENCE ("Save as new version", "Create environment"), never "Save".
 *  - Submit stays enabled until the request starts, then shows a spinner (`busy`) —
 *    interaction-guidelines. Use `submitDisabled` only for genuine validation blocks.
 */
export function FormDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** Consequence label for the primary submit button. */
  primaryLabel: string;
  cancelLabel?: string;
  onSubmit: () => void;
  /** In-flight: spinner on the primary button + both actions disabled. */
  busy?: boolean;
  /** Validation gate — disables submit with no spinner. */
  submitDisabled?: boolean;
  /** The form fields (compose `DialogSection`s here for grouping). */
  children: ReactNode;
  /** Optional extra footer content pinned to the left of the actions (e.g. a hint). */
  footerStart?: ReactNode;
}) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (props.busy || props.submitDisabled) return;
    props.onSubmit();
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {/* ~640px: wider than the default max-w-lg (512px) tube. className is layout-only (width). */}
      <DialogContent className="sm:max-w-[640px]">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{props.title}</DialogTitle>
            {props.description != null ? (
              <DialogDescription>{props.description}</DialogDescription>
            ) : null}
          </DialogHeader>

          <div className="flex flex-col gap-5">{props.children}</div>

          <DialogFooter className={cn(props.footerStart != null && "sm:justify-between")}>
            {props.footerStart != null ? (
              <div className="flex items-center text-caption text-muted-foreground">
                {props.footerStart}
              </div>
            ) : null}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={props.busy}>
                  {props.cancelLabel ?? "Cancel"}
                </Button>
              </DialogClose>
              <Button type="submit" disabled={props.busy || props.submitDisabled}>
                {props.busy ? <Spinner className="size-4" aria-hidden /> : null}
                <span>{props.primaryLabel}</span>
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
