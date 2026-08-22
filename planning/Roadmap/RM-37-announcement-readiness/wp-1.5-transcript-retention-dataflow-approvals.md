---
type: "Work Package Spec"
title: "WP 1.5 — Transcript retention + export redaction, metadata-only scope, Anthropic egress data-flow statement, mission/auto-accept approval gaps"
description: "Phase 1 of item.md. Ledger: STATUS.md. Gives run transcripts a retention default and a redacting export, adds a metadata-only tier under the read scope, writes the data-flow statement for provider and Anthropic egress into the product and the guide, closes the two external-mutation approval gaps, and tightens service-token hygiene; team-server auth stays RM-25."
tags: ["roadmap", "RM-37"]
timestamp: "2026-08-22T07:10:00Z"
status: "final"
---
# WP 1.5 — Transcript retention + export redaction, metadata-only scope, Anthropic egress data-flow statement, mission/auto-accept approval gaps

Phase 1 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md).

## Scope

Run storage and export (`apps/api/src/testing/run-repository.ts:1661-1716` `redactValue`/`truncateString`,
`apps/api/src/db/schema.ts:449` `run_steps.payload_json`, `apps/api/src/db/maintenance.ts:157-178`
run-retention policy, `apps/api/src/grading/issue-routes.ts:118-129` issue exports, the run console's
"Export session log"), the workbench-MCP / assistant projections (`apps/api/src/mcp-server/tools.ts`
`runs_get`/`run_report`/`scans_tools`, `apps/api/src/assistant/tools/util.ts:108-131` `compactStep`,
`packages/shared/src/api-tokens.ts` scopes, `packages/shared/src/workbench-mcp.ts:140`), Hub mission
gating (`apps/api/src/hub/tools/approval-policy.ts:88-118`, `apps/api/src/hub/hitl.ts:65-79`), the
assistant permission classifier (`apps/api/src/assistant/permission-classifier.ts:93,128-150`,
`apps/api/src/assistant/tools/action-tools.ts:116-156`), service tokens
(`apps/api/src/api-tokens/service.ts:89-101`, `apps/web/src/features/settings/TokensSection.tsx:120-130,329`),
the guide (`planning/user-guide/DC-13-assistant-hub/16-assistant-hub.md:118`, `DC-24-security-posture/`,
`DC-08-testing-console/`) and Settings › About. Out of scope: the loopback Origin/Host/CSRF defence,
security headers, rate limiting and git env minimisation (wp-0.4: SEC-01, SEC-07, SEC-09, SEC-10),
container trust (wp-0.3: SEC-11), the posture false positive (wp-0.5: SEC-08), paths in `/api/health`
(wp-1.4: SEC-13), and team-server auth, roles, per-user audit and SSO (RM-25: SEC-19). SEC-15 and
SEC-18 record no change; their tests stay.

## Actions

1. **Retention default**: a fresh DB stamps a run-retention policy (`byStatus` for every terminal status
   in `RUN_STATUSES` — completed, stopped, error, aborted, ended — `olderThanDays: 180`; pinned runs
   exempt as today) and a daily prune job applies the saved policy when
   `enabled` is true (new flag on the policy, default true on fresh installs, false on upgraded ones);
   Settings › Storage shows the policy as a sentence ("Runs older than 180 days are removed nightly;
   pinned runs are kept") with the next run time and a "Keep everything" switch. **P1**
2. **Redaction on export**: every file that leaves the app — session log export, `/api/issues/export/*`,
   `run_report`'s inline document — gets a "Redact tool payloads" option, on by default, that replaces
   tool arguments/results with `[redacted · n bytes]` and keeps step names, timing and token counts;
   `redactValue` gains value-shape patterns (bearer/JWT, `ghp_`/`github_pat_`, `xoxb-`, `AKIA…`) in
   addition to the key-name match. Tests cover both modes. **P1**
3. **State what a run stores**: guide page "What a run stores and for how long" (DC-08) — transcripts,
   prompts, tool arguments and results are stored unencrypted in `app.sqlite`; secrets are encrypted;
   retention per action 1; export redaction per action 2. Settings › Storage links it. Transcript
   encryption-at-rest is recorded as a decision (build with `SecretStore`, or keep the documented
   boundary) in `./STATUS.md`'s decision log, not built here. **P1**
4. **Metadata-only tier**: add a `metadata` projection under the existing `read` scope without widening
   the frozen scope list — `runs_get`, `run_report`, `scans_tools` and the assistant `compactStep` omit
   `payloadPreview`, `assistantText`, `reasoningText` unless the caller is the loopback browser or a
   token minted with the new per-token option "include transcript content" (off by default). Settings ›
   API tokens labels the option "read = full run transcripts, including tool outputs" and
   `GET /api/mcp/llms.txt` states the same. **P1**
5. **Data-flow statement**: guide page "Data & egress" (DC-24): what leaves the machine (prompts,
   transcripts, SKILL.md, scan data used as assistant context), to which hosts per provider kind
   (configured provider endpoints; `api.anthropic.com` / `claude.ai` for the subscription and Assistant
   paths), under whose account, the retention statement of each provider (links), and a network
   egress allow-list table. Settings › About gains a "Data & egress" block linking it plus the line
   "Single-user, local; team server planned (RM-25)". README "Data & security" gains the sentence
   "Model calls go to the provider you configured (or a local Ollama model); nothing else leaves the
   machine." **P1**
6. **Hub mission approval truth**: `resolveMissionApprovalGate` (`approval-policy.ts:88-118`) gates a
   call when `annotations.destructiveHint === true` unless the crew carries a new `allowDestructive`
   opt-in (default off); the plan-launch approval card lists the granted servers with "runs these tools
   without asking" and names the destructive tools that will still ask; `16-assistant-hub.md:118` is
   rewritten to describe exactly this. **P1**
7. **`mcp_tool_call` never auto-accepts**: `classifyTool` (`permission-classifier.ts:128-142`) returns
   an always-ask class for `mcp_tool_call` and any action tool that reaches an external server unless the
   target tool declares `readOnlyHint: true`; `autoAcceptEligible` (`:150`) is false for that class; the
   dock's approval card shows server + tool + `destructiveHint`. Test: auto-accept on + `mcp_tool_call`
   on a tool without `readOnlyHint` → `permission_request` emitted. **P1**
8. **Skill security gate**: attaching a skill whose analysis carries `skill-surface.injection-phrasing`
   (`apps/api/src/security/skill-analyzer.ts:98`) to an auto-accept-enabled assistant session or Hub crew
   requires an explicit confirm naming the finding. **P2**
9. **Service-token hygiene**: new tokens prefill "Expires" with 90 days (`TokensSection.tsx:329`),
   the row shows Expires and Last used first, and a "Rotate" action mints a replacement with the same
   scopes and revokes the old one after the new secret is shown once (`service.ts:89-101`). **P2**
10. **Calibration export note**: the export dialog and the markdown header state "reviewer notes are
    exported as written" (`apps/api/src/grading/calibration-markdown.ts`). **P3**
11. **Git PAT off argv**: `apps/api/src/git/git-credential.ts:102` passes the token through a
    short-lived `GIT_ASKPASS` helper instead of the clone URL. **P3**

## Acceptance

- [ ] Fresh DB: policy present and enabled; upgraded DB: unchanged and disabled; the nightly job prunes
      only matching, unpinned runs (test with a fixture of each status).
- [ ] With redaction on, no exported file contains a tool argument or result (test seeds a distinctive
      payload string); with it off, the file is byte-identical to today's export.
- [ ] A `read` token without the transcript option gets `runs_get`/`run_report`/`scans_tools` responses
      with no `payloadPreview`, `assistantText` or `reasoningText` fields; loopback keeps them (tests).
- [ ] The guide pages exist, are served at `/docs` (wp-1.4) and are linked from Settings › About and
      Storage; README carries the egress sentence.
- [ ] A mission agent's destructive-annotated call is gated unless `allowDestructive`; the guide line
      matches the code (test on `resolveMissionApprovalGate`; a doc test greps the guide for the
      old sentence).
- [ ] `mcp_tool_call` under auto-accept emits a `permission_request` unless the target is `readOnlyHint: true`.
- [ ] New tokens carry an expiry by default; rotate works end-to-end (test).
- [ ] Gate green: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`.

## Effort

**L** — eleven changes across storage, exports, two approval paths, tokens and documentation, each
small but each with its own test; the encryption-at-rest decision is recorded, not built.

## Sources

SEC-02 · SEC-03 · SEC-04 · SEC-05 · SEC-06 · SEC-12 · SEC-14 · SEC-16 · SEC-17 · SEC-19 (→ RM-25) ·
SEC-15 / SEC-18 (no change) · MK-24 (egress sentence) · PS-27 (single-user line).
