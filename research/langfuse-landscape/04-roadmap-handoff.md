# 04 — Roadmap handoff: what this research became

**Date:** 2026-08-18 · **Status:** entries drafted and committed as **PROPOSED — pending
owner lock**; ledger pointer-merges tracked below. This doc is the index from evidence
(docs 00–03) to plan; the entries themselves live in `roadmap/` (status, as always, only in
the `STATUS.md` ledgers once WPs are picked up).

## Entries created

| Where | What | IDs |
|---|---|---|
| [`roadmap/ci/mcp-server.md`](../../roadmap/ci/mcp-server.md) | **Workbench MCP server** — new "Phase MCP" inside CI & headless automation: streamable-HTTP MCP mount on the API, localhost trust → service-token scopes, read-first then scoped writes, self-scan CI gate | D-MCP1–6 (proposed), WP M.1–M.4 |
| [`roadmap/observability/amendment-2026-08-langfuse.md`](../../roadmap/observability/amendment-2026-08-langfuse.md) | **Additive amendment to the locked D-OB plan** — design imports routed to their exact WPs (URL-serialized filters, corrected-output feedback, chart→feed drill-down, Ratio metric, Pulse outlier strip, pricing-editor scope+, chart-composer spec, metric-scaled Gantt, rule state machine + GH-Actions channel, boolean share-true metrics, per-run webhook, issues-visual guidance) | AM-OB1–14 (proposed) |
| [`roadmap/observability/phase-3-console/WP-3.5-agent-graph.md`](../../roadmap/observability/phase-3-console/WP-3.5-agent-graph.md) | **New WP: agent-graph lens over a run** (aggregated/expanded modes, @xyflow/react, after WP-3.1) | AM-OB9 → WP-3.5 |
| [`roadmap/auto-rating/wp-judge-preview-and-rerate.md`](../../roadmap/auto-rating/wp-judge-preview-and-rerate.md) | Judge-settings **live preview** (ephemeral, capped) + **bounded re-rate window** (append-only revisions, AR6 intact) | owner-gated backlog |
| [`roadmap/testing/wp-compare-launcher-followons.md`](../../roadmap/testing/wp-compare-launcher-followons.md) | **Comparison grade labels** (Improvement/Regression/Tradeoff/Tie), **pairwise preference capture** (blocked on obs WP-1.5), **launcher variant matrix** (A/B plans as one suite-run) | owner-gated backlog |
| `CLAUDE.md` | Capability-table rows updated: ci row (+MCP server, Phase MCP pointer), observability row (+research link, amendment pointer) | — |

Deliberately **not** filed as WPs: OTLP export + MCP `_meta` context propagation (one-page
options in `01 §G12`), scheduled blob exports, user-configurable evaluators, prompt-mgmt
clone, guardrails (see `01 §Priority-6` and "not worth building" rationale).

## Pending pointer-merges (apply to the live files; drafted here so nothing is lost)

1. **`roadmap/ci/README.md`** — add under the plan/phases overview:
   > **Phase MCP — workbench MCP server** (proposed 2026-08-18, pending owner lock): the
   > bench itself MCP-operable by external agents — plan, decisions D-MCP1–6, and WP M.1–M.4
   > in [`mcp-server.md`](./mcp-server.md). WP M.1 is independent of Phase 1 (localhost
   > trust); M.2+ consume Phase 1 service tokens.
2. **`roadmap/ci/STATUS.md`** — append a "Phase MCP (proposed)" section with rows
   WP M.1 read-only server core · WP M.2 token scopes on the mount · WP M.3 scoped write
   tools · WP M.4 agent onboarding + self-scan gate — all `pending owner lock`.
3. **`roadmap/observability/STATUS.md`** — append an "Amendment 2026-08-18 (proposed)" note:
   AM-OB1–14 per [`amendment-2026-08-langfuse.md`](../../roadmap/observability/amendment-2026-08-langfuse.md);
   items become acceptance criteria on their target WPs on owner lock; WP-3.5 added to the
   Phase 3 list as `proposed`.
4. **`roadmap/auto-rating/STATUS.md`** — one backlog line pointing at
   `wp-judge-preview-and-rerate.md` (owner-gated, alongside Phase 5).
5. **`roadmap/testing/STATUS.md`** — one backlog line pointing at
   `wp-compare-launcher-followons.md` (owner-gated; Part B blocked on observability WP-1.5).

## Owner-lock checklist (the decisions actually being asked)

- [ ] Lock Phase MCP scope + D-MCP1–6 (esp. D-MCP2 localhost trust, D-MCP3 scope-=-consent
      writes, D-MCP5 self-scan gate) — or re-scope to read-only-only.
- [ ] Lock AM-OB1–14 individually (each droppable); decide renumbering (absorb into WP
      acceptance criteria vs. D-OB29+).
- [ ] Accept WP-3.5 into Phase 3 (after WP-3.1) or park it.
- [ ] Confirm the two backlog wp-docs (auto-rating, testing) as owner-gated backlog.
- [ ] Priority call: does WP M.1 (MCP server core) run before Unified Sessions Wave 1 or
      after? (It is contract-independent; nothing in D-US/D-OB depends on it.)

## Sequencing picture (unchanged by this amendment)

Unified Sessions (D-US, first) → Observability waves per D-OB27/28 with AM items riding
their target WPs → CI Phase 1 ∥ Phase MCP (M.1 may run earlier; M.2+ after tokens) →
backlog wp-docs when the owner pulls them. The moat WPs (nothing here) stay untouched:
this amendment is imports and one new lens, not a strategy change — see
[`01-gap-analysis.md`](./01-gap-analysis.md) §Where-we-lead.
