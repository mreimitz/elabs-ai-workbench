import { useCallback, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  buttonVariants,
} from "@elabs-ai/components-ui";

/**
 * A tiny reusable "warn before discarding unsaved input" guard for the editor/wizard dialogs
 * (interaction-guidelines: "Warn before discarding unsaved input"). Wraps a dialog's `onOpenChange`
 * so a user-initiated close (Escape, overlay click, the X, or a Cancel button) is INTERCEPTED when
 * the form is dirty and routed to a confirm `AlertDialog` instead of closing outright.
 *
 * Programmatic success closes (after a save) must call the parent's `onOpenChange(false)` DIRECTLY —
 * that bypasses this guard, so a just-saved form never prompts to discard.
 */
export function useUnsavedChangesGuard(dirty: boolean, onOpenChange: (open: boolean) => void) {
  const [confirming, setConfirming] = useState(false);

  // Use as the Dialog's `onOpenChange` and any Cancel button handler.
  const requestOpenChange = useCallback(
    (open: boolean) => {
      if (!open && dirty) {
        setConfirming(true);
        return;
      }
      onOpenChange(open);
    },
    [dirty, onOpenChange],
  );

  const confirmDiscard = useCallback(() => {
    setConfirming(false);
    onOpenChange(false);
  }, [onOpenChange]);

  const cancelDiscard = useCallback(() => setConfirming(false), []);

  return { requestOpenChange, confirming, confirmDiscard, cancelDiscard };
}

/** The confirm dialog rendered alongside a guarded editor. Driven by {@link useUnsavedChangesGuard}. */
export function DiscardChangesDialog(props: {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <AlertDialog open={props.open} onOpenChange={(open) => !open && props.onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
          <AlertDialogDescription>
            This form has changes that haven’t been saved. If you close now, those changes are lost.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={props.onCancel}>Keep editing</AlertDialogCancel>
          {/* Destructive variant must ride on AlertDialogAction's own className (same shape App.tsx
              uses for its delete confirms) so tailwind-merge keeps bg-destructive over the injected
              primary. */}
          <AlertDialogAction
            className={buttonVariants({ variant: "destructive" })}
            onClick={props.onConfirm}
          >
            Discard changes
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
