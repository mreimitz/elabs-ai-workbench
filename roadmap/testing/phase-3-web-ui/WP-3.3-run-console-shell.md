# WP 3.3 — Run console shell + lifecycle

**Phase:** 3 · **Size:** L · **Depends on:** 3.1, 2.2

## Objective
The locked two-pane console frame: the top run-bar, the resizable split, the pre-run state, and all
run lifecycle states. This is the container WP 3.4–3.7 fill.

## Why / references
UI concept [`../10-…ui-concept.md`](../../10-testing-ui-concept.md) **§2** (top-level frame + run-bar
wireframe), **§6** (pre-run), **§7** (lifecycle + replay). Component/token mapping in UI §9–§10.
`RunEvent` status handling = WP 0.3 / 2.2.

## Files (new)
- `apps/web/src/features/testing/RunConsole.tsx`  — the page
- `apps/web/src/features/testing/RunBar.tsx`       — identity, mode, status, guardrail meters, Stop
- *(a resizable split — see Gaps)*

## Design — run-bar (UI §2)
- Left: test name, scenario + model chip, mode chip, `● LOCKED` `StatusBadge`.
- Center: status (`Running ⟳` with elapsed / `Completed` / `Stopped` / `context_overflow` / `Error`).
- Right: three guardrail `Progress` meters (turns / tokens / spend, `tabular-nums`) and the **Stop**
  `Button` (`variant="destructive"`, confirms mid-stream). In **replay**, Stop → scrubber + `Export`
  (WP 3.7/4.2).

## Design — frame
- Full-width: the console wants horizontal room. Render outside the padded `<main>` (collapse the
  sidebar to icons, or add a `fullBleed` affordance to `AppShell`'s `<main>` — keep it minimal).
- Two panes: left conversation (~58%), right monitoring (~42%), with a resizable divider.
- **Pre-run (UI §6):** a `StatePanel`/`EmptyState` showing the resolved frozen config (model, allowed
  tools count, profiles, guardrails) + `▷ Run automated` / `💬 Run interactive` buttons. The right
  pane shows the **turn-0 static footprint** (system + selected tool defs) on the chart baseline
  (reuse scan/token data) before the model runs.
- **Lifecycle:** map `RunEvent {status}` → run-bar state; terminal outcomes render distinctly —
  `stopped_guardrail` (which meter, destructive), `context_overflow` (destructive `Alert`), `error`
  (`ErrorState`), `completed`. Surface via `toast` + inline, never silently.

## Gaps (UI §11)
- **Resizable split-pane** isn't in the listed `@elabs-ai/components-ui` set. Compose minimally (a draggable divider
  with `bg-border`, keyboard-resizable) in `apps/web/src/components/`, and raise the gap with the
  owner — don't hand-roll a heavy lib.

## Acceptance
- From pre-run, `▷ Run automated` starts a run; run-bar reflects live status + guardrail meters; Stop
  works (with confirm).
- Each terminal state renders distinctly and is announced (toast + inline).
- Split is resizable and keyboard-accessible; both themes correct.
- Gate: typecheck + build green; manual check at `http://localhost:8080`.
