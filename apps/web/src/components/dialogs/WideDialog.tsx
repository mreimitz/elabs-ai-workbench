import type { ReactNode } from "react";
import { useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  cn,
} from "@brand/ui";
import { DiscardChangesDialog, useUnsavedChangesGuard } from "../UnsavedChangesGuard";

/**
 * Tier 3 of the modal system (audit §S17) — the COMPLEX CONFIG tier.
 *
 * When to use: anything more than a simple form — a create/edit surface with grouped fields,
 * an Advanced section, or more than ~8 fields (Edit test, Run launcher, Edit environment). At least
 * 960px wide with either a LEFT-RAIL of sections (`nav="rail"`, the house pattern from the
 * environment editor's two-column layout) or TOP TABS (`nav="tabs"`). The header and footer are
 * fixed; only the active section's content scrolls (S22 scroll contract). The footer is sticky, so
 * the primary action is always visible however long the form.
 *
 * Dirty-state guard: pass `dirty` and a user-initiated close (Escape, overlay, X) is intercepted by
 * the shared `useUnsavedChangesGuard` → `DiscardChangesDialog` (the same discard-changes pattern the
 * editors already use). A programmatic close after a successful save must call `onOpenChange(false)`
 * directly to bypass the guard.
 *
 * Conventions baked in: mandatory fields in the first section; primary action bottom-right in the
 * sticky footer; `primaryLabel` states the consequence ("Save as new version").
 */

export interface WideDialogSection {
  id: string;
  label: string;
  /** Optional glyph rendered before the label in the rail/tab. */
  icon?: ReactNode;
  content: ReactNode;
}

export function WideDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** Right-aligned header controls, next to the title (e.g. a page-hook action). Same slot/placement
   *  convention as `WorkbenchDialog`'s `headerActions` (tier 4) — kept OUTSIDE `DialogTitle` so an
   *  action's own label never bleeds into the dialog's accessible name. */
  headerActions?: ReactNode;
  sections: WideDialogSection[];
  /** Section navigation: a left rail (default) or a top tab strip. */
  nav?: "rail" | "tabs";
  /** Controlled active section; omit to let the dialog own it. */
  activeSectionId?: string;
  onActiveSectionChange?: (id: string) => void;
  /**
   * Consequence label for the primary submit button in the sticky footer. Required for the DEFAULT
   * footer; ignored when a custom `footer` is supplied.
   */
  primaryLabel?: string;
  cancelLabel?: string;
  /** Fired by the DEFAULT footer's primary button; ignored when a custom `footer` is supplied. */
  onSubmit?: () => void;
  busy?: boolean;
  submitDisabled?: boolean;
  /** Warn-before-discard when the form has unsaved edits (reuses the shared guard). */
  dirty?: boolean;
  /** Optional left-aligned footer content (e.g. a summary of what will be saved). */
  footerStart?: ReactNode;
  /**
   * A CUSTOM sticky footer (replaces the default Cancel | Primary row). For a surface whose footer
   * can't be one primary — a linear wizard with per-step Back/Continue/commit actions, or a
   * post-save interstitial — pass the whole footer node here and it renders inside the same
   * bordered, sticky footer container. When provided, `primaryLabel`/`onSubmit`/`footerStart` are
   * ignored. Own your layout with a `flex w-full …` wrapper if you need Back grouped left.
   */
  footer?: ReactNode;
}) {
  const nav = props.nav ?? "rail";
  const firstId = props.sections[0]?.id ?? "";
  const [internalActive, setInternalActive] = useState(firstId);
  const activeId = props.activeSectionId ?? internalActive;
  const setActive = (id: string) => {
    if (props.onActiveSectionChange) props.onActiveSectionChange(id);
    else setInternalActive(id);
  };

  const { requestOpenChange, confirming, confirmDiscard, cancelDiscard } = useUnsavedChangesGuard(
    props.dirty ?? false,
    props.onOpenChange,
  );

  const activeSection = props.sections.find((s) => s.id === activeId) ?? props.sections[0];

  const footer =
    props.footer != null ? (
      // Custom footer: the caller owns the actions (a wizard's per-step Back/Continue, an
      // interstitial's offer/decline). Same bordered, sticky container as the default footer.
      <div className="flex shrink-0 items-center gap-2 border-t border-border bg-card px-6 py-4">
        {props.footer}
      </div>
    ) : (
      <div
        className={cn(
          "flex shrink-0 items-center gap-2 border-t border-border bg-card px-6 py-4",
          props.footerStart != null ? "justify-between" : "justify-end",
        )}
      >
        {props.footerStart != null ? (
          <div className="flex min-w-0 items-center text-caption text-muted-foreground">
            {props.footerStart}
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={props.busy}
            onClick={() => requestOpenChange(false)}
          >
            {props.cancelLabel ?? "Cancel"}
          </Button>
          <Button
            type="button"
            disabled={props.busy || props.submitDisabled}
            onClick={() => {
              if (props.busy || props.submitDisabled) return;
              props.onSubmit?.();
            }}
          >
            {props.busy ? <Spinner className="size-4" aria-hidden /> : null}
            <span>{props.primaryLabel}</span>
          </Button>
        </div>
      </div>
    );

  return (
    <>
      <Dialog open={props.open} onOpenChange={requestOpenChange}>
        {/* ≥960px, STABLE balanced height (`h-[min(85vh,760px)]`, not content-driven `max-h-…`) so
            switching sections never resizes the modal; capped at 760px so a short section isn't
            over-tall, floored to 85vh on short viewports. p-0/gap-0 so the header, scroll body, and
            sticky footer own their own padding. Rows: header (auto) · body (1fr, scrolls) · footer
            (auto) — the body scrolls internally, keeping the outer height fixed across sections. */}
        <DialogContent
          // No description → opt out of Radix's aria-describedby requirement (sanctioned escape).
          {...(props.description == null ? { "aria-describedby": undefined } : {})}
          className="grid h-[min(85vh,760px)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-[min(1040px,95vw)]"
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

          {nav === "tabs" ? (
            <Tabs
              value={activeId}
              onValueChange={setActive}
              className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-0"
            >
              <div className="shrink-0 border-b border-border px-6 pt-3">
                <TabsList>
                  {props.sections.map((s) => (
                    <TabsTrigger key={s.id} value={s.id}>
                      {s.icon != null ? <span className="me-1.5 inline-flex">{s.icon}</span> : null}
                      {s.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>
              {props.sections.map((s) => (
                <TabsContent
                  key={s.id}
                  value={s.id}
                  className="min-h-0 overflow-y-auto px-6 py-5 data-[state=inactive]:hidden"
                >
                  {s.content}
                </TabsContent>
              ))}
            </Tabs>
          ) : (
            <div className="grid min-h-0 grid-cols-[13rem_minmax(0,1fr)]">
              <nav
                aria-label="Sections"
                className="flex min-h-0 flex-col gap-0.5 overflow-y-auto border-e border-border bg-muted/30 p-2"
              >
                {props.sections.map((s) => {
                  const isActive = s.id === activeId;
                  return (
                    <Button
                      key={s.id}
                      type="button"
                      variant="ghost"
                      aria-current={isActive ? "step" : undefined}
                      className={cn(
                        "h-auto justify-start gap-2 px-3 py-2 text-start font-normal",
                        isActive && "bg-accent font-medium text-accent-foreground",
                      )}
                      onClick={() => setActive(s.id)}
                    >
                      {s.icon != null ? (
                        <span className="inline-flex shrink-0">{s.icon}</span>
                      ) : null}
                      <span className="min-w-0 truncate">{s.label}</span>
                    </Button>
                  );
                })}
              </nav>
              <div className="min-h-0 overflow-y-auto px-6 py-5">{activeSection?.content}</div>
            </div>
          )}

          {footer}
        </DialogContent>
      </Dialog>
      <DiscardChangesDialog open={confirming} onConfirm={confirmDiscard} onCancel={cancelDiscard} />
    </>
  );
}
