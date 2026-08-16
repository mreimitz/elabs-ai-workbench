import { toast } from "@brand/ui";

type ToastErrorMessage = Parameters<typeof toast.error>[0];
type ToastErrorOptions = Parameters<typeof toast.error>[1];

/**
 * Design-remediation T5 (item 9) — a dedicated ASSERTIVE live region for error announcements.
 *
 * Sonner renders its whole toast viewport inside ONE region hard-wired to `aria-live="polite"`
 * (region-level, no per-toast override, and its `<Toaster>` config lives at the app root outside
 * this module). A settled failure surfaced through {@link notifyError} is a persistent
 * (`duration: Infinity`) message the operator must notice NOW — polite lets a screen reader finish
 * whatever it was reading first, which for an error is the wrong priority. So, in ADDITION to the
 * visible toast, the message text is pushed into this separate `role="alert"` /
 * `aria-live="assertive"` node, which interrupts and announces immediately. The visible toast, its
 * copy, and the `toast.error` call are untouched — this is a pure a11y side-channel.
 */
const ERROR_LIVE_REGION_ID = "app-error-announcer";

function announceErrorAssertive(message: string): void {
  if (typeof document === "undefined" || document.body == null) return;
  let region = document.getElementById(ERROR_LIVE_REGION_ID);
  if (region == null) {
    region = document.createElement("div");
    region.id = ERROR_LIVE_REGION_ID;
    region.setAttribute("role", "alert");
    region.setAttribute("aria-live", "assertive");
    region.setAttribute("aria-atomic", "true");
    // Present for assistive tech, invisible on screen — the visible surface is the toast itself.
    region.className = "sr-only";
    document.body.appendChild(region);
  }
  const target = region;
  // Clear first, then set on the next frame, so a repeat of the SAME message still re-announces
  // (a live region only fires on a text change).
  target.textContent = "";
  const set = () => {
    target.textContent = message;
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(set);
  else set();
}

/**
 * Interface Craft WP 3.1 (finding 5, D-IC7) — the single authority for error notifications. Every
 * error toast in the app goes through this wrapper instead of calling `toast.error` directly, so no
 * call site can set (or forget to unset) its own error duration.
 *
 * It forwards `description`/`action`/anything else the caller passes, but always **forces**
 * `duration: Infinity` — an error toast stays on screen until the operator dismisses it. A
 * 4-second error is unreadable for many users and unreachable by keyboard; `duration` is applied
 * last so a caller-supplied value can never sneak a finite duration through.
 *
 * Design-remediation T5 (item 9): a string message is ALSO announced through the assertive live
 * region above (Sonner's own region is polite) so a settled failure interrupts a screen reader.
 * The `toast.error` call itself is byte-identical — the announcement is a side-channel only.
 */
export function notifyError(
  message: ToastErrorMessage,
  options?: ToastErrorOptions,
): ReturnType<typeof toast.error> {
  if (typeof message === "string") announceErrorAssertive(message);
  return toast.error(message, { ...options, duration: Infinity });
}
