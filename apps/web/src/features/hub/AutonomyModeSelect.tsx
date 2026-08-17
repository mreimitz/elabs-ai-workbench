// Assistant Hub — AUTONOMY AS A COMPOSER MODE. A compact composer-footer control (mirroring the
// Claude "Modes" popover) for how aggressively the assistant may act without asking. It governs LIVE
// HITL tool-approval gating (turn-engine.ts): `Ask every time` gates every side-effecting MCP tool
// call on an approval card; `Auto` auto-runs read-only-on-trusted tools; `Ask above a threshold`
// behaves like `Auto` at the tool floor (its agent/cost ceilings govern MISSION launch approval).
// HARD budget caps are enforced server-side regardless of the mode — the footer note says so.
//
// This is the mode-menu form of the setting (replacing the old `ViewToolbar` `AutonomyDial` Select):
// a trigger button (ShieldCheck + the current level's short label) that opens a `@elabs-ai/components-ui` `Popover`
// listing the three levels as selectable rows — each with its label + one-line hint and a check on the
// active one — exactly like the Modes menu. brand-ui only + both themes: a `@elabs-ai/components-ui` `Popover`,
// `Button` rows, `Text`, a `ShieldCheck`/`Check` glyph; the composer's footer button (`PromptInputButton`)
// as the trigger so it sits flush with the other footer controls (Plan first, model, commands).
//
// The levels/labels/hints are the SAME set the dial used (kept verbatim so nothing about the
// governance meaning shifts as the surface moves from a Select to a mode menu). The write is
// optimistic-then-confirmed by the parent (it PATCHes the session and restores on failure).
//
// hub-fixes WP6.2 (RC7 fix): this chip's bare label ("Auto") was, by the owner's own account, trivially
// misread as the SESSION mode — Composer.tsx now has its own, separate `SessionModeChip` for that axis
// (session mode: chat/research/mission/auto), placed next to the model chip. To make the two chips read
// as unmistakably different dials at a glance, this one's visible label always carries an "Autonomy:"
// prefix, its `aria-label` names the active level in full, and its hover tooltip enumerates all three
// levels (not just the one-line summary it had before) — no change to the governance/write behavior.

import { PromptInputButton } from "@elabs-ai/components-ai";
import { Button, Popover, PopoverContent, PopoverTrigger, Text, cn } from "@elabs-ai/components-ui";
import type { HubAutonomyLevel } from "@mcp-token-footprint/shared";
import { Check, ShieldCheck } from "lucide-react";
import { useState } from "react";

/** The three autonomy levels — labels + one-line hints copied verbatim from the old `AutonomyDial`'s
 *  `AUTONOMY_OPTIONS` (governance meaning unchanged), plus a compact `short` for the mode trigger. */
const AUTONOMY_OPTIONS: {
  value: HubAutonomyLevel;
  label: string;
  short: string;
  hint: string;
}[] = [
  {
    value: "always_ask",
    label: "Ask every time",
    short: "Ask every time",
    hint: "Every tool that can change something waits for your approval.",
  },
  {
    value: "threshold",
    label: "Ask above a threshold",
    short: "Threshold",
    hint: "Read-only tools run automatically; missions ask above the configured size / cost.",
  },
  {
    value: "auto",
    label: "Auto",
    short: "Auto",
    hint: "Read-only tools on trusted servers run automatically; destructive tools always ask.",
  },
];

/** Kept from the dial — the one invariant the mode can never relax. */
const HARD_CAP_NOTE = "Hard budget caps are always enforced, whatever the mode.";

/** hub-fixes WP6.2 (RC7) — the hover tooltip now names all three levels (not just a one-line summary),
 *  built from {@link AUTONOMY_OPTIONS} so it can never drift out of sync with the popover rows below.
 *  Exported for the unit test (the `@elabs-ai/components-ai` test stub swallows the `tooltip` prop, so the string's
 *  content is asserted directly rather than through a DOM query). */
export const AUTONOMY_TOOLTIP = `Autonomy — how freely the assistant may act without asking. ${AUTONOMY_OPTIONS.map(
  (option) => `${option.label}: ${option.hint}`,
).join(" ")}`;

export function AutonomyModeSelect({
  value,
  onChange,
  disabled,
}: {
  value: HubAutonomyLevel;
  onChange: (next: HubAutonomyLevel) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const current = AUTONOMY_OPTIONS.find((option) => option.value === value) ?? AUTONOMY_OPTIONS[0];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {/* owner-feedback (2026-07-26): icon-only — the labelled chip ate the composer footer row. The
            ShieldCheck glyph carries the affordance; the full "Autonomy: <level>" lives in the
            aria-label (also the test query handle) and the tooltip enumerates all three levels, so the
            active level is one hover away and it can never be misread as the session-mode chip. */}
        <PromptInputButton
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={disabled}
          aria-label={`Autonomy: ${current?.label ?? "Ask every time"}`}
          tooltip={AUTONOMY_TOOLTIP}
        >
          <ShieldCheck className="size-3.5" aria-hidden="true" />
        </PromptInputButton>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-1">
        <Text variant="meta" tone="muted" className="block px-2 py-1.5">
          Autonomy mode
        </Text>
        <ul className="flex flex-col gap-0.5">
          {AUTONOMY_OPTIONS.map((option) => {
            const active = option.value === value;
            return (
              <li key={option.value}>
                <Button
                  type="button"
                  variant="ghost"
                  aria-current={active ? "true" : undefined}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className="h-auto w-full items-start justify-start gap-2 whitespace-normal px-2 py-1.5 text-left"
                >
                  <Check
                    aria-hidden="true"
                    className={cn("mt-0.5 size-4 shrink-0", active ? "opacity-100" : "opacity-0")}
                  />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-body font-medium leading-tight">{option.label}</span>
                    <span className="text-caption leading-snug text-muted-foreground">
                      {option.hint}
                    </span>
                  </span>
                </Button>
              </li>
            );
          })}
        </ul>
        <Text variant="meta" tone="muted" className="mt-1 block border-t px-2 pt-2 pb-1">
          {HARD_CAP_NOTE}
        </Text>
      </PopoverContent>
    </Popover>
  );
}
