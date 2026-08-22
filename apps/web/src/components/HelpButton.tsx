import { CircleHelp } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { IconButton } from "./IconButton";
import { helpButtonLabel, resolveHelpTarget } from "../features/docs/help-map";

/**
 * HelpButton — the ONE help affordance, in the top bar, on every route (RM-18 WP 1.2).
 * =================================================================================================
 *
 * WHY IT IS HERE AND NOT IN EACH VIEW
 *   The WP asks for "per-view help links". Putting one in each view would be ~40 file edits, a
 *   collision with every other work package in flight, and — worse — a convention with no enforcement,
 *   so the next new view would ship without one. One control in `AppShell`'s top-bar `end` slot is
 *   rendered once for every route, and the route→subject mapping is one table
 *   (`features/docs/help-map.ts`). A new route gets help by adding a line there.
 *
 * D-TB5 (`.claude/rules/icon-affordances.md`)
 *   This is an icon-only control, so it is an `IconButton`: the tooltip text and the `aria-label` are
 *   derived from ONE `label` prop and cannot diverge, and there is no native `title`. The glyph is
 *   decorative (`aria-hidden`); the name comes from the label.
 *
 * IT NEVER DEAD-ENDS
 *   `resolveHelpTarget` always returns a real route — the mapped subject, or the guide index. The
 *   control does not disappear on an unmapped page and does not navigate to a not-found; the label
 *   changes to say which of the two the reader is about to get.
 *
 * `useLocation` is read here rather than passed in, so `AppShell` needs exactly one line for this.
 */
export function HelpButton() {
  const location = useLocation();
  const navigate = useNavigate();
  const target = resolveHelpTarget(location.pathname);

  return (
    <IconButton
      variant="ghost"
      onClick={() => navigate(target)}
      label={helpButtonLabel(location.pathname)}
    >
      <CircleHelp aria-hidden />
    </IconButton>
  );
}
