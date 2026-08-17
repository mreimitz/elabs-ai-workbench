import type { ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Spinner,
  buttonVariants,
  cn,
} from "@elabs-ai/components-ui";

/**
 * Tier 1 of the modal system (audit §S17) — the CONFIRM tier.
 *
 * When to use: a yes/no decision with ≤2 actions and no fields (delete, discard, publish,
 * regenerate). Built on `@elabs-ai/components-ui` `AlertDialog`, which traps initial focus on the SAFE action —
 * the reason destructive confirms must NOT be a plain `Dialog` (brand-ui anti-pattern).
 *
 * Conventions baked in:
 *  - Primary (confirm) action is bottom-right; Cancel sits to its left (AlertDialogFooter →
 *    `sm:justify-end`).
 *  - `confirmLabel` is the CONSEQUENCE, not "OK" — e.g. "Delete skill", "Discard changes",
 *    "Publish to GitHub" (S17 consequence-labeled primary button convention).
 *  - `tone="destructive"` paints the confirm button `bg-destructive` (irreversible actions).
 */
export function ConfirmDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** Consequence label for the primary button (e.g. "Delete skill") — never a bare "OK". */
  confirmLabel: string;
  cancelLabel?: string;
  /** Destructive actions paint the confirm button red and read as irreversible. */
  tone?: "default" | "destructive";
  onConfirm: () => void;
  /** Show a spinner + block the confirm button while the action is in flight. */
  busy?: boolean;
  /** Optional extra body content between the description and the footer. */
  children?: ReactNode;
}) {
  const tone = props.tone ?? "default";
  return (
    <AlertDialog open={props.open} onOpenChange={props.onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{props.title}</AlertDialogTitle>
          {props.description != null ? (
            <AlertDialogDescription>{props.description}</AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        {props.children != null ? (
          <div className="text-body text-foreground">{props.children}</div>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={props.busy}>
            {props.cancelLabel ?? "Cancel"}
          </AlertDialogCancel>
          {/* Destructive variant rides on AlertDialogAction's own className so tailwind-merge keeps
              bg-destructive over the injected primary (same shape App.tsx / UnsavedChangesGuard use). */}
          <AlertDialogAction
            disabled={props.busy}
            className={cn(tone === "destructive" && buttonVariants({ variant: "destructive" }))}
            onClick={props.onConfirm}
          >
            {props.busy ? <Spinner className="size-4" aria-hidden /> : null}
            <span>{props.confirmLabel}</span>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
