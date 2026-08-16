import { forwardRef, useId, type ReactNode } from "react";
import { Button, type ButtonProps, Tooltip, TooltipContent, TooltipTrigger, cn } from "@brand/ui";

/**
 * IconButton — the ONE affordance for an icon-only control (D-TB5, icon-affordances rule).
 * =============================================================================================
 *
 * WHY IT EXISTS
 *   Audit finding D-7: of ~124 icon-only buttons in this app, the *sighted mouse user* got three
 *   different hover behaviours — a styled Radix `Tooltip` (~11%), a bare native `title` (~16%,
 *   ~1.5s OS delay, invisible to assistive tech), and `aria-label`-only (~72%, nothing on hover).
 *   D-TB5 collapses that to ONE mechanism and makes the wrong thing impossible: this primitive
 *   derives BOTH the tooltip text AND the `aria-label` from a single `label` prop, so a call site
 *   can neither forget the tooltip nor let the two names diverge — and there is deliberately NO
 *   `title` prop / escape hatch (the type omits it).
 *
 * WHAT IT IS
 *   A `@brand/ui` `Button` (icon child, `size="icon"` by default, visible focus ring inherited)
 *   wrapped in a Radix `Tooltip`. The `TooltipTrigger` is a thin wrapper `<span>`, NOT the Button
 *   itself, so the tooltip still fires on a **disabled** control: a disabled Button carries
 *   `disabled:pointer-events-none`, so hover falls through to the wrapper span, and when a
 *   `disabledReason` is shown the span is also keyboard-focusable (the disabled Button is not) so
 *   the reason is reachable without a mouse. An enabled Button is itself focusable/hoverable and
 *   its focus bubbles to the wrapper, so no extra tab stop is added in the common case.
 *
 * DISABLED REASON (D-6 / D-TB5)
 *   When `disabled` and a `disabledReason` is given, the reason is shown in the tooltip AND wired
 *   to the Button's `aria-describedby` (via an always-present `sr-only` node) so it reaches screen
 *   readers even while the tooltip is closed. The `aria-label` still carries the control's name.
 *
 * USAGE
 *   <IconButton label="Refresh" onClick={onRefresh}>
 *     <RefreshCw aria-hidden />
 *   </IconButton>
 *
 *   <IconButton
 *     label="Export comparison"
 *     disabled={!canExport}
 *     disabledReason="Add a second run to export a comparison."
 *   >
 *     <Download aria-hidden />
 *   </IconButton>
 *
 * Every visible element is `@brand/ui` or a `lucide-react` / `@brand/icons` glyph; semantic tokens
 * only; `className` is layout-only. Needs the app-root `TooltipProvider` (already mounted).
 *
 * TOUCH TARGET FLOOR (P0 mobile audit T4, 2026-07-25 critique)
 *   Measured live at 390px: 270 of 465 interactive elements were under 44×44, 94 of those under even
 *   the WCAG 2.2 24×24 AA floor. Every `IconButton` now carries a `min-h-11`/`min-w-11` (44×44) floor
 *   gated to `@media (pointer: coarse)` (touchscreens) — a mouse/trackpad keeps the existing dense
 *   desktop sizing (`size="icon"` = 36px, `"icon-sm"` = 32px) untouched. `min-height`/`min-width`
 *   always win over a smaller `width`/`height` per the CSS box model, so this floors the RENDERED box
 *   without fighting the `size` prop. This is the ONE place the floor is applied — `AppShell`'s own
 *   `SidebarTrigger` (measured 23×23) is a sibling task's fix, not this file's.
 */
export type IconButtonProps = Omit<
  ButtonProps,
  // `label` is the single source of truth for the name — no raw `aria-label`/`aria-labelledby`
  // override (they must not diverge from the tooltip), no native `title` (D-TB5 bans it), and the
  // icon comes through `children`. `asChild` would dissolve the Button into a Slot and break the
  // icon-child + disabled-wrapper composition, so it is not accepted here.
  "aria-label" | "aria-labelledby" | "title" | "children" | "asChild"
> & {
  /**
   * The single source of truth for the control's name. Becomes BOTH the Radix tooltip text AND the
   * `aria-label` — derived from this one prop, so the two can never diverge (D-TB5).
   */
  label: string;
  /**
   * The icon glyph — a `lucide-react` / `@brand/icons` element. Mark it `aria-hidden` at the call
   * site; the accessible name comes from `label`, not the glyph.
   */
  children: ReactNode;
  /**
   * Optional reason surfaced when the button is `disabled`: shown in the tooltip AND wired to
   * `aria-describedby` so it reaches assistive tech (D-6 / D-TB5). Ignored when the button is
   * enabled.
   */
  disabledReason?: ReactNode;
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, children, disabledReason, disabled, size = "icon", className, ...rest },
  ref,
) {
  const reasonId = useId();
  const hasReason = Boolean(disabled) && disabledReason != null && disabledReason !== "";
  // The tooltip shows the disabled reason when there is one; otherwise it shows the name. The name
  // still reaches AT via `aria-label`, and the reason via `aria-describedby`, so nothing is lost.
  const tooltip = hasReason ? disabledReason : label;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* The wrapper span is the ACTUAL Radix trigger (see the docblock). `inline-flex` shrink-
            wraps the button; the focus-ring classes only bite when the span is keyboard-focusable
            (the disabled-with-reason case) and are inert otherwise. */}
        <span
          className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          tabIndex={hasReason ? 0 : undefined}
        >
          <Button
            ref={ref}
            size={size}
            disabled={disabled}
            aria-label={label}
            aria-describedby={hasReason ? reasonId : undefined}
            className={cn(
              // P0 mobile audit T4 — 44×44 touch-target floor on a COARSE (touch) pointer only; a
              // mouse/trackpad's `pointer: fine` leaves the dense desktop `size` untouched.
              "[@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11",
              className,
            )}
            {...rest}
          >
            {children}
          </Button>
          {hasReason ? (
            <span id={reasonId} className="sr-only">
              {disabledReason}
            </span>
          ) : null}
        </span>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
});
