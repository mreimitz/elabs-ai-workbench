# WP 3.4 — Conversation pane (left)

**Phase:** 3 · **Size:** M · **Depends on:** 3.3

## Objective
The left pane: streaming conversation with reasoning, tool-call cards, and the interactive composer.

## Why / references
UI concept [`../10-…ui-concept.md`](../../10-testing-ui-concept.md) **§3** (conversation + tool-call
card wireframe). SOTA chat patterns: [`../references.md`](../references.md) → *IntuitionLabs*,
*TheFrontKit* (streaming + reasoning + tool execution displays are table stakes). Events from WP 2.2.

## Files (new)
- `apps/web/src/features/testing/ConversationPane.tsx`
- `apps/web/src/features/testing/ToolCallCard.tsx`
- `apps/web/src/features/testing/Composer.tsx`

## Design (brand-ui only)
- **Messages:** user turns in a muted `Card` with attachment `Badge` chips; assistant turns stream
  `Text` from `RunEvent {delta, channel:"text"}`.
- **Thinking:** `RunEvent {delta, channel:"reasoning"}` into a collapsible disclosure (muted) with a
  token-count `Badge`. (Confirm `@brand/ui` Collapsible/Accordion; else compose a `Button`-toggled
  region — UI §11 gap.)
- **Tool-call card (the composite, UI §3):** header = tool name + server `Badge` + `StatusBadge`
  (pending/running/ok/error) + duration + token chip; expands to args + result via
  `components/CodeBlock.tsx`. An `Inspect ↗` `Button` selects the matching packet in the right-pane
  log (WP 3.6) — shared selection state (lift to `RunConsole`).
- **Composer (interactive only):** `Textarea` + attachment `Button` + send `Button` → `sendTurn`.
  In automated mode, replace with a quiet locked note. Submit stays enabled until the request starts,
  then spinner (`.claude/rules/interaction-guidelines.md`).

## Acceptance
- Text streams token-by-token; reasoning collapses; tool cards show status + expand to I/O.
- `Inspect ↗` cross-highlights the right-pane packet (and vice-versa).
- Automated mode shows the locked-input note; interactive mode sends turns.
- Long content truncates/wraps (`min-w-0`, `break-words`); empty state before first token.
- Both themes correct; gate: typecheck + build green.
