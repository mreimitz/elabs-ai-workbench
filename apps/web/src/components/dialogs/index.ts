/**
 * The modal system — four tiers (audit §S17 · WP 1.5).
 *
 * The app used to open five different modal strategies with no rule (a 512px scroll tube for a
 * 1,739px form, a 1520px two-column editor, a full-screen playground …). This kit replaces that
 * with FOUR tiers and one decision rule. Pick the tier by field count / complexity — never by
 * habit:
 *
 * ┌────────────────┬────────────────────────────────────────────────────────────────────────────┐
 * │ Tier           │ Use when…                                                                   │
 * ├────────────────┼────────────────────────────────────────────────────────────────────────────┤
 * │ ConfirmDialog  │ A yes/no decision, ≤2 actions, NO fields (delete, discard, publish).        │
 * │  (sm)          │ Built on AlertDialog — focus traps on the safe action.                      │
 * ├────────────────┼────────────────────────────────────────────────────────────────────────────┤
 * │ FormDialog     │ A short form, ≤6 fields, fits with NO internal scroll. ~640px wide.          │
 * │  (md ~640px)   │ Standard footer: Cancel | Primary, primary bottom-right.                    │
 * ├────────────────┼────────────────────────────────────────────────────────────────────────────┤
 * │ WideDialog     │ COMPLEX config: grouped sections, an Advanced group, or MORE THAN 8 FIELDS  │
 * │  (≥960px)      │ → WideDialog. Left-rail sections OR top tabs, fixed header + sticky footer,  │
 * │                │ only the active section scrolls, dirty-state discard guard.                  │
 * ├────────────────┼────────────────────────────────────────────────────────────────────────────┤
 * │ WorkbenchDialog│ A full working surface — playground, live two-pane editor, schema form +    │
 * │  (full-screen) │ result. Nearly full-screen; reach for it only when WideDialog can't hold it. │
 * └────────────────┴────────────────────────────────────────────────────────────────────────────┘
 *
 * THE DECISION RULE (S17):
 *   ≤2 actions, no fields        → ConfirmDialog
 *   ≤6 fields, no internal scroll → FormDialog
 *   >8 fields, or sections /      → WideDialog   ← ">8 fields → WideDialog"
 *     an Advanced group
 *   a full working surface       → WorkbenchDialog
 *   (7–8 fields is the borderline: prefer FormDialog if they're flat and fit; move to WideDialog the
 *    moment you need grouping, an Advanced group, or the body starts to scroll.)
 *
 * Shared conventions across ALL tiers:
 *   • The primary action is ALWAYS bottom-right; Cancel to its left.
 *   • The primary button label states the CONSEQUENCE ("Save as new version", "Delete skill"),
 *     never a bare "OK"/"Save".
 *   • Group fields with `DialogSection` (a real section heading, not a field-sized label);
 *     collapse expert options into an `AdvancedGroup` (closed by default, summarised when closed).
 *   • Editing tiers (WideDialog, WorkbenchDialog) take a `dirty` flag and warn before discarding
 *     unsaved edits via the shared `useUnsavedChangesGuard` pattern.
 */
export { ConfirmDialog } from "./ConfirmDialog";
export { FormDialog } from "./FormDialog";
export { WideDialog, type WideDialogSection } from "./WideDialog";
export { WorkbenchDialog } from "./WorkbenchDialog";
export { DialogSection, AdvancedGroup } from "./DialogSection";
