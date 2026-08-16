import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle, cn } from "@brand/ui";
import { DiscardChangesDialog, useUnsavedChangesGuard } from "../UnsavedChangesGuard";

/**
 * Tier 4 of the modal system (audit §S17) — the WORKBENCH tier.
 *
 * When to use: a full-overlay working surface — the tool playground, a large two-pane editor, a
 * schema-driven form with a live result pane. Nearly full-screen (95vw × 90vh); the header is
 * fixed, the body fills and owns its own scroll/split layout, and an optional footer stays pinned.
 * This is the biggest tier — reach for it only when a `WideDialog` genuinely can't hold the surface
 * (see the decision rule in `index.ts`).
 *
 * Dirty-state guard: pass `dirty` to intercept a user-initiated close via the shared
 * `useUnsavedChangesGuard` → `DiscardChangesDialog`.
 */
export function WorkbenchDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** Right-aligned header controls (e.g. a toolbar / secondary actions). */
  headerActions?: ReactNode;
  /** The working surface. Fills the body and owns its own layout + scroll. */
  children: ReactNode;
  /** Optional pinned footer (e.g. primary action bottom-right — the house convention). */
  footer?: ReactNode;
  /** Warn-before-discard when there are unsaved edits. */
  dirty?: boolean;
}) {
  const { requestOpenChange, confirming, confirmDiscard, cancelDiscard } = useUnsavedChangesGuard(
    props.dirty ?? false,
    props.onOpenChange,
  );

  return (
    <>
      <Dialog open={props.open} onOpenChange={requestOpenChange}>
        {/* Full overlay (size="full" → 95vw × 90vh). p-0/gap-0 so header/body/footer own padding.
            Rows: header (auto) · body (1fr, fills + scrolls) · optional footer (auto). */}
        <DialogContent
          size="full"
          // No description → opt out of Radix's aria-describedby requirement (sanctioned escape).
          {...(props.description == null ? { "aria-describedby": undefined } : {})}
          className={cn(
            "grid gap-0 p-0",
            props.footer != null
              ? "grid-rows-[auto_minmax(0,1fr)_auto]"
              : "grid-rows-[auto_minmax(0,1fr)]",
          )}
        >
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-6 py-4 pe-12">
            <div className="flex min-w-0 flex-col gap-1">
              <DialogTitle className="text-title leading-tight">{props.title}</DialogTitle>
              {props.description != null ? (
                <DialogDescription>{props.description}</DialogDescription>
              ) : null}
            </div>
            {props.headerActions != null ? (
              <div className="flex shrink-0 items-center gap-2">{props.headerActions}</div>
            ) : null}
          </div>

          <div className="min-h-0 overflow-auto">{props.children}</div>

          {props.footer != null ? (
            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border bg-card px-6 py-4">
              {props.footer}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
      <DiscardChangesDialog open={confirming} onConfirm={confirmDiscard} onCancel={cancelDiscard} />
    </>
  );
}
