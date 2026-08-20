---
type: "Research Note"
title: "03 \u2014 State of the art: interaction & visual feedback for agentic sessions"
description: "Verified against live docs 2026-07-17. Sources: ai-sdk.dev (AI SDK 7), elements.ai-sdk.dev,"
tags: ["research", "RS-06"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# 03 — State of the art: interaction & visual feedback for agentic sessions

Verified against live docs 2026-07-17. Sources: ai-sdk.dev (AI SDK 7), elements.ai-sdk.dev,
docs.ag-ui.com, perplexity.ai help center, help.openai.com, cursor.com/changelog (2.0–2.2),
docs.devin.ai, smashingmagazine.com (Feb 2026), code.claude.com/docs, support.claude.com.
Normative requirements: `roadmap/assistant-hub/requirements.md` (R-UX*, R-SES*).

## 1. The parts model + tool state machine (AI SDK 7)

- **UIMessage parts** (AI SDK 7, current major): a message is ordered typed parts — `text`,
  `reasoning` (+ `reasoning-file`), `file`, `source-url`/`source-document` (citations),
  `tool-<name>`, `dynamic-tool`, and custom `data-<name>` parts. Rendering is a switch over
  `part.type` + `part.state`.
- **Tool part lifecycle (exact state names)**: `input-streaming → input-available →
  (approval-requested → approval-responded) → output-available | output-error | output-denied`,
  with `approval.isAutomatic` marking dial-approved calls. **Approvals are states in the same
  lifecycle, not a modal system** — the single most important pattern for the Hub's approval
  cards. Model-facing tool errors are masked by default and customized deliberately.
- **Data parts reconciled by id**: writing a `data-*` part again with the same id **updates the
  widget in place** — the canonical mechanism for live-updating widgets (task list, mission
  board, budget meter); transient parts stream without persisting (ephemeral status).
- AI SDK 7's production layer names the Hub's server needs: durable agents, **persistent
  resumable streams** (multiple clients attach/detach), tool approval as a server concept,
  telemetry with token/cost breakdowns. The Unified-Sessions contract already covers the Hub's
  equivalents (cursor SSE resume, capabilities, clock).

## 2. AI Elements ↔ `@elabs-ai/components-ai` (the build vocabulary is confirmed)

AI Elements (~50 components) and the vendored `@elabs-ai/components-ai` (see `vendor/brand-ui-agent-kit/llms/ai.txt`)
carry the same catalog — every planned surface has a purpose-built component: `Conversation`,
`Message` (+ branching — `MessageBranch*` in `@elabs-ai/components-ai`), `PromptInput*` (+ `PromptInputCommand`
slash menu, attachments, `SpeechInput`), `Reasoning`, `ChainOfThought`, `Sources`,
`InlineCitation`, `Suggestion`, **`Task`**, **`Plan`**, **`Queue`**, **`Checkpoint`**,
**`Context`** (usage display), **`Confirmation`**/`ApprovalCard`, `Tool`, `ModelSelector`,
`Shimmer`, `Artifact`, `CodeBlock`, `Terminal`, `Sandbox`, `WebPreview`, `FileTree`,
`ProducedAssetTree`, `StackTrace`, `TestResults`, `Commit`, canvas primitives
(`Canvas`/`Node`/`Edge`/`Controls`/`Panel`), `Persona`, voice components. Boundary rule (playbook):
these are presentational — the app owns transport. **Requirement consequence: the Hub composes,
never hand-rolls, and the mission board / task widget / context gauge all have first-party parts.**

## 3. AG-UI (protocol validation for `hub_events`)

- AG-UI is the open event protocol for agent↔UI: lifecycle (`RunStarted` with
  `runId`/`threadId`/**`parentRunId`** for lineage, `RunFinished`, `StepStarted/Finished`), text
  and tool-call streaming events, **state as snapshot + RFC 6902 JSON Patch deltas**,
  `ActivitySnapshot/Delta` for structured in-progress work (PLAN, SEARCH), reasoning-as-summary
  events (raw CoT carried opaquely/encrypted). Adoption is real (14.7k stars; Microsoft Agent
  Framework, Google ADK, AWS Strands, Pydantic AI, LlamaIndex; Claude Agent SDK community
  integration).
- The philosophy — **client state fully reconstructible by replaying events; snapshots + deltas;
  parent lineage enabling time-travel/branching** — is exactly the `hub_events` design and the
  1.R review invariant. Keep it strict.

## 4. Patterns worth stealing (each mapped to a Hub surface)

1. **Perplexity deep research**: clarifying questions BEFORE a broad run; live activity feed of
   *which sources are being read and what's being learned*; key findings stream **before** the
   final report; **follow-up questions can be added while research runs**; the report streams
   **into an editable, shareable file**. → research mode: plan card, live activity, steering
   queue, report-as-artifact. (R-SES3, R-UX3, R-UX10, D-AH12)
2. **Perplexity answer UX**: numbered inline citations bound to a sources rail + suggested
   follow-ups under every answer. → R-UX5, R-UX10.
3. **ChatGPT scheduled tasks**: task pills in-chat, results land in the originating chat,
   push/email on completion. → mission terminals → notification center (R-UX11); scheduling
   itself stays future scope.
4. **ChatGPT canvas / Claude artifacts**: the side-by-side editable deliverable panel — versioned,
   iteratively updated, separate from the transcript. → D-AH12 canvas + review workflow.
5. **ChatGPT memory UX**: memories are inspectable/editable/deletable — transparency as the
   trust mechanism. → D-AH11 propose-then-save + Memory view.
6. **Cursor 2.x**: up to 8 parallel agents isolated via worktrees; **multi-agent judging**
   (auto-evaluate parallel solutions, recommend best with explanatory comments) — the Hub's
   `best_of_n` topology with a blind judge; **plans saved as editable files**; **system
   notifications carrying approval actions**. → WP2.2, R-UX11.
7. **Devin**: Ask (read-only) vs Agent mode split; @-mention **previous sessions** as context;
   post-session **Session Insights** (timeline + feedback + an improved prompt). → modes
   (D-AH5), session-as-context (future flag), mission retro card (flag).
8. **Claude Code micro-patterns**: plan-accept auto-names the session; session recap after idle;
   ghost-text suggestions; provisioning checklist with queued messages; elapsed-time tickers;
   "Called X 3 times" collapse; per-message model chip in transcript view. → R-SES5/9, R-UX2/3.

## 5. The agentic-UX pattern language (Smashing, Feb 2026 — with target metrics)

Six named patterns to design against (and measure):

- **Intent Preview** — pre-action plan summary with Proceed/Edit/Handle-myself; healthy state:
  >85% of previews accepted un-edited. → the mission plan card (D-AH6).
- **Autonomy Dial** — Observe & Suggest → Plan & Propose → Act with Confirmation → Act
  Autonomously, set per task type. → D-AH6's `always_ask`/`threshold`/`auto` + R-MCP3 defaults.
- **Explainable Rationale** — "Because you said X, I did Y" attached to actions. → plan
  rationale field (already in `plan_json`), approval cards, synthesis citing agent reports.
- **Confidence Signal** — calibrated uncertainty display (fights automation bias). → agent
  report `confidence` (D-AH9) rendered, not buried.
- **Action Audit & Undo** — chronological action log + time-limited undo; "knowing a mistake can
  be easily undone creates psychological safety"; healthy reversion rate <5%. → audit timeline
  (D-AH13) + artifact version revert + checkpoint restore (R-SES6, R-UX7).
- **Escalation Pathway** — ask-when-unsure; healthy escalation frequency 5–15%. → threshold
  autonomy + `waiting_input` + AskUserQuestion-style structured asks (flag for missions).

## 6. Long-running feedback rules (cross-source consensus)

- **Dead air is a defect**: every running row ticks (elapsed timers), phases render as chips
  (queued+position / starting / waiting / stopping), first token gets shimmer, spawn/provision
  shows a checklist.
- **Reasoning etiquette**: stream **summaries**, keep raw CoT opaque (AG-UI encrypted-value
  pattern; Claude Code renders thinking de-emphasized/collapsible).
- **Errors preserve work**: partial output + explicit cut-off note beats error-only; retries are
  visible and bounded; a denied action lands in a retry-able denied log; compaction thrash stops
  with an error, never loops.
- **Cost/time ambient**: running $ estimate labeled as estimate; active vs total duration split
  (Unified Sessions already records both); per-agent model + context bar on the board.
- **Trust is structural**: citations as typed parts; typed findings; injection-scan markers on
  subagent reports (Claude Code v2.1.210) — the Hub's agent reports get the same treatment at
  the synthesis boundary (flag → WP2.R adversarial case).

## What the Hub adopts (summary → R-UX1…12, R-SES1…12)

The AI-SDK tool state machine incl. approval states rendered inline · data-part-style
reconciled-by-id live widgets (task list, board, meters) · three-zoom progressive disclosure ·
liveness rules (tickers, phase chips, shimmer, checklists) · Perplexity-grade citations + follow-
ups · Intent-Preview plan cards with rationale + confidence rendering · audit + undo pairing ·
ambient cost/time chrome · notification-center wiring for waiting/terminal events · reasoning-as-
summaries · errors-preserve-work · both-theme + keyboard + screen-reader-announcement discipline.

# Citations

None.
