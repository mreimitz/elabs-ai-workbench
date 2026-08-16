# 00 — Anatomy of a Fable 5 session (the reference harness)

What "behave like a Fable 5 session" concretely means, distilled from Claude Code v2.1.x and
Claude Cowork documentation + changelog as of 2026-07-17 (docs live at `code.claude.com/docs`;
Cowork help at `support.claude.com`). Twelve behaviors, each with the exact mechanics worth
copying. The Hub mapping at the end binds each to requirement ids.

## B1 — The transcript is typed parts over an event log

A message is an ordered array of typed parts (text, reasoning, tool call with lifecycle state,
files, sources, custom data), never a flat string; the whole session state is reconstructible by
replaying the event log (AG-UI's founding rule; see doc 03). Claude Code persists sessions as
JSONL event transcripts (`~/.claude/projects/<project>/<session-id>.jsonl`), and every UI —
terminal, web, mobile — is a projection of the same log. Compaction is itself an event
(`compact_boundary` with `preTokens`). *The Hub's `hub_events` design is already this; the
requirement is to never leak a flat-string shortcut into the renderer.*

## B2 — A live task-list widget, not prose plans

Fable sessions plan in a **visible checklist**: `TaskCreate`/`TaskGet`/`TaskList`/`TaskUpdate`
(dependencies supported; `TodoWrite` retired v2.1.142). Rendering rules that matter: up to ~5
tasks visible at once (toggleable, Ctrl+T), pending/in-progress/complete states, **persists
across context compaction**, and lifecycle transitions are hookable and *blockable*
(`TaskCreated`/`TaskCompleted` — e.g. "tests must pass before a task may complete"). Long-running
tool rows show a **live elapsed-time ticker** "so long-running tool calls visibly tick instead of
looking stuck" (v2.1.210).

## B3 — Sub-work is a visible, steerable tree that runs in the background

Subagents (the Agent tool, renamed from Task in v2.1.63) run **in the background by default**
(v2.1.198+): the main loop keeps working and only foregrounds an agent when it needs the result.
The UI shows a **panel of the full agent tree** — descendant counts `(+N)`, per-agent
model/status, completed agents linger marked-done, a footer count of agents **waiting on input**
(color-emphasized), stop-all shortcut. Agents are **resumable by id/name** with their transcript
intact (`SendMessage`), definable in frontmatter (`model`, `tools`, `skills` preload,
`mcpServers`, `memory`, `isolation: worktree`, `effort`, `color`). Two trust mechanics at the
report boundary: **injection-scan markers** on instruction-shaped subagent output (v2.1.210), and
a cut-off agent returns **partial output + an explicit cut-off note** rather than silent loss.

## B4 — Plan mode is a lifecycle, not a toggle

Enter plan mode (Shift+Tab cycle / `/plan` / `EnterPlanMode`) → read-only research (delegated to
cheap read-only agents) → `ExitPlanMode` presents the plan with approval options that **set the
follow-on permission mode** ("Yes, and use auto mode" / "Yes, manually approve" / keep
planning), the plan is **editable before approval** (Ctrl+G opens it in an editor), and
**accepting the plan auto-names the session**. Cursor 2.2 went further: plans saved as editable
files on disk, selected to-dos delegable to new agents (doc 03 §4).

## B5 — Two steering verbs, both durable

The official contract: **Esc** = hard interrupt (cancel the running tool, *keep completed work*,
wait for direction); **typing + Enter while it works** = soft queue — the message is read at the
next action boundary and steers without stopping. Queued-message durability is treated as a bug
class (lost-on-max-turns fixed v2.1.199; undeliverable replies to background agents are saved and
delivered on restart, v2.1.208). Bonus channel: `/btw` runs a side question against full session
context in a dismissible overlay **while the agent works** — no history pollution, forkable into
a real session.

## B6 — Checkpoints on every prompt; rewind is a menu

Every user prompt snapshots tracked files (100 checkpoints kept, stored **with the
conversation**, 30-day cleanup). `/rewind` (or double-Esc) offers per-point: restore code /
restore conversation / both / **summarize from here** / summarize up to here — with inline focus
instructions and an in-transcript "Summarized conversation" marker. Limits are explicit and
honest: bash side effects and external edits are **not** tracked; checkpoints are local undo, git
is history.

## B7 — Context is a first-class gauge

`/context` breaks down what is consuming the window (system prompt, memory files, env, **deferred
MCP tool names**, skill descriptions); the statusline JSON exposes
`context_window.used_percentage` / `remaining_percentage` / size / per-background-task context.
When the window fills: **older tool outputs are cleared first** (hot/cold split — recent tool
results stay verbatim, older offloaded), full summarization only after that, steered by
user-supplied "Compact Instructions"; repeated refill triggers a **thrashing error instead of a
loop**. Compaction is **visible** (marker in-stream) and **hookable** (`PreCompact` blockable /
`PostCompact`).

## B8 — Permission UX = a visible mode dial + scoped rules + an escalation log

A persistent mode badge at all times (Manual ⏸ / accept-edits ⏵⏵ / plan / auto), cycled by one
key. "Don't ask again" writes **scoped rules** (session/project/user; param-level matching
`Tool(param:value)`). Protected paths never auto-approve. Auto mode runs a **separate classifier
model** over non-read actions, honors **boundaries stated in conversation** ("don't push") as
block signals, pauses itself after repeated blocks, and keeps a **"Recently denied" log with
one-key retry-with-manual-approval**. MCP servers can force per-call prompts
(`_meta anthropic/requiresUserInteraction`).

## B9 — Progressive disclosure: three zoom levels over one log

Default: tool calls collapse to one summarizing line ("Called slack 3 times", edit diffstats) with
expand on click/keyboard. Transcript view (Ctrl+O): per-message timestamps **and the model used
per assistant message**, streamed thinking visible. `/focus`: last prompt + one-line summaries +
final response only. Rendering guardrails: >200-row tables truncate with notice, images become
positional chips, generated files are clickable attachment cards, screen-reader mode announces
state changes.

## B10 — Cost and time are ambient chrome

The statusline carries a running **cost estimate** (`cost.total_cost_usd`, labeled estimate),
wall-clock vs API duration, and per-background-task model + context size. Nothing blocks on cost;
it is glanceable at all times. (AI SDK 7 telemetry mirrors this server-side: timing, tokens, cost
per execution — doc 03 §2.)

## B11 — Off-surface continuity

Return after ≥3 idle minutes → an auto-generated **session recap**; ghost-text prompt
suggestions reuse the prompt cache. Completion and needs-input reach the user off-surface:
`Notification` hook, desktop + phone push (`PushNotification` when Remote Control is connected),
Cursor 2.2-style notifications carry **approval actions**. Sessions are portable objects: resume
by name/id/PR-URL, fork (`/branch`, grouped under the root session), teleport local↔cloud, steer
from web/mobile; cloud provisioning shows a **checklist with queued messages** before the agent
even starts. Cowork's product contract: *"describe an outcome, step away, and come back to
finished work."*

## B12 — Trust affordances are structural, not decorative

Typed findings instead of prose (`ReportFindings` file/summary/failure-scenario), citations as
typed parts, reasoning streamed as **summaries** (raw CoT stays opaque), injection-scan markers on
subagent reports, partial-work preservation with explicit cut-off notes, `/context` transparency,
and a per-message model chip. Verification is rendered, not asserted.

## Hub mapping

| Behavior | Hub requirement ids (see `roadmap/assistant-hub/requirements.md`) |
|---|---|
| B1 typed parts / event log | R-SES1, R-SES2 |
| B2 task widget | R-SES4 |
| B3 background sub-work tree | R-UX4 (mission board), R-SES3 (steer), D-AH8 |
| B4 plan lifecycle | R-SES5, R-UX6 |
| B5 steering verbs | R-SES3 |
| B6 checkpoints/rewind | R-SES6 |
| B7 context gauge | R-SES7, R-SES8 |
| B8 permission dial + rules | R-MCP3, R-UX1, D-AH6 autonomy dial |
| B9 progressive disclosure | R-UX2 |
| B10 cost/time chrome | R-UX8 |
| B11 continuity + notifications | R-SES9, R-SES12, R-UX11 |
| B12 trust affordances | R-UX5, R-UX9, R-SES11 |

Primary sources: code.claude.com/docs (interactive-mode, sub-agents, permission-modes,
checkpointing, context-window, sessions, hooks, statusline, tools-reference, fullscreen,
claude-code-on-the-web), anthropics/claude-code CHANGELOG.md (v2.1.142–2.1.211),
support.claude.com Cowork articles 13345190 + 15520349.
