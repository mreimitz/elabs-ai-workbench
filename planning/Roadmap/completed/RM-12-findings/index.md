# UI audit and remediation programme (2026-06)

## Concepts

* [UI Audit — Detailed Findings](01-ui-audit-findings.md) - Each finding: what was observed (with evidence), why it's wrong (rubric), the fix (exact
* [Prioritized Fix Plan](02-prioritized-fix-plan.md) - Phased remediation for the findings in 01-ui-audit-findings.md. Ordered by
* [Servers view — deep dive (the "smart layout" re-audit)](03-servers-deep-dive.md) - This doc corrects an under-call in the first pass. I graded the Servers view on structural
* [Execution Plan — UI remediation (orchestrator runbook)](04-execution-plan.md) - Audience: a coding agent (the orchestrator) that will spin up subagents to implement every
* [Remediation status — what shipped](05-remediation-status.md) - Execution of 04-execution-plan.md on branch ui-remediation.
* [Hardening wave status — what shipped (Wave 1, ui-findings2)](06-hardening-status.md) - Follow-on to 05-remediation-status.md. Branch ui-findings2
* [Cross-server / tool-level compare — status (Wave 2, ui-findings2)](07-cross-server-compare-status.md) - Closes audit §C4 and north-star 4 ("diff across servers, including tool-level"). Branch
* [Pass-3 audit + compare-depth live verification (Round 3, ui-findings3)](08-pass3-audit.md) - Round 3 picks up after PR 1 merged (origin/main @ 5da8228, which also carries the concurrent
* [Testing → Runs → Run — session-view rework (findings + plan)](08-runs-session-rework.md) - The owner reported six problems with the run-session console (Testing → Runs → open a run)
* [Resource / prompt footprint (Round 4, ui-findings4)](09-resource-prompt-footprint.md) - Closes the last unbuilt north-star 1 capability: a scan now captures resources, resource
* [09 — Session Views: Chat / Raw / Analytics tabs, Gantt timeline, and chat‑render consistency](09-session-views-and-analytics.md) - Concept + execution plan, grounded by the read‑only map (workflow wfdab150b9-9e0). Single‑owner
* [Resource / prompt execution (Round 5, ui-findings5)](10-resource-prompt-execution.md) - Extends the tool playground (north-star 5) to MCP resources and prompts: read a
* [Resource / prompt cross-server compare (Round 6, ui-findings6)](11-resource-prompt-compare.md) - Completes the diff-across-servers story (north-star 3/4) for the entities Round 4 added
* [Wave-0 contracts (published by A0)](_contracts.md) - Fixed names every later agent (A1, then Wave 1) consumes. Do not rename — A1 wires the density
* [UI audit and remediation programme (2026-06)](item.md) - Record the enterprise-grade UI/UX evaluation of the shipped footprint analyzer and drive its prioritized remediation, hardening and cross-server compare follow-ups.
