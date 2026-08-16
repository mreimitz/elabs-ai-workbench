# WP 7.R — adversarial review + owner-acceptance walk assembly

**Phase:** 7 · **Size:** M · **Depends on:** Phase 1, Phase 2, Phase 3, Phase 4, Phase 5, Phase 6 · **Model:** Opus · **Agent profile:** adversarial reviewer

## Objective

Attack the workstream's invariants before calling it done, and assemble the owner-acceptance walk
for everything only provable live. Findings become bounded fix WPs (`wp/hub-fixes/7.fix`), never
silent patches.

## Invariants to probe (minimum set)

1. **Grant confinement:** no session or agent can call a tool outside its effective scope — not
   via `tool_search` promotion (WP 1.1), not via plan grants exceeding parent scope (WP 2.3), not
   via `web.*` when un-granted or killed (WP 5.1). Probe with hostile prompts and forged plan JSON.
2. **Promotion safety:** promotion cap holds under adversarial repeated searches; ungranted names
   in a crafted `tool_search` query never become active; per-turn set resets between turns.
3. **Silent-failure elimination:** every connection failure path emits `mcp_server_status` +
   prompt truth line (WP 1.3); grep the diff for remaining swallow-and-continue paths in the grant
   resolution chain.
4. **Mission integrity:** budget trip on real costs (WP 2.4) under a runaway-agent stub;
   HITL deny-never-runs and timeout auto-deny (WP 2.5); debate round visibility rules (WP 4.4:
   round-2 briefs contain only OTHER debaters' openings); replay of pre-fix event logs (incl. a
   fixture shaped like live session `oNiw1PCAmxc5_ietGD_0h`).
5. **Rendering safety:** hostile citation titles/snippets and hostile markdown (script tags, data
   URLs, table-cell chips) through WP 3.1's renderer; GenUI synthesis parts still pass the
   allowlist validator (WP 3.2).
6. **SSRF/web:** WP 5.1 guard vs redirect chains, DNS rebinding shapes, IPv6 literals, huge bodies.
7. **UI honesty:** graph shape vs actual event timestamps for all four topologies (+ rounds);
   rail scope display vs `/context` payload; cost displays vs usage rows.

## Deliverables

- Review report in this folder (`review-7R.md`): probes run, PASS/FAIL each, minimal repros.
- Bounded fixes on `wp/hub-fixes/7.fix` for confirmed defects; ledger updated.
- `owner-acceptance-walk.md` for this plan: the live checklist (scoped Qlik call; mission with
  real MCP tools + live expand-modal transcript; both-theme walks of rail/board/modal/clarify;
  live `web.search` on one provider; container mitigation removal check from WP 0.1 once WP 1.1
  shipped) with exact click-paths and expected outcomes.

## Acceptance

- [ ] Every invariant above probed with evidence (commands/fixtures cited); failures fixed on `7.fix` or explicitly ledgered as accepted risk by the owner.
- [ ] `owner-acceptance-walk.md` complete and honest (nothing claimed as verified that needs live credentials).
- [ ] Full gate + build + e2e green on the integrated branch.
