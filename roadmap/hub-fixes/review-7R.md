# hub-fixes WP 7.R — adversarial review report

**Date:** 2026-07-20 · **Branch:** `wp/hub-fixes/7.R` (base = fully-integrated workstream at
`ee76e45`, all 20 prior WPs merged) · **Reviewer profile:** adversarial (try to BREAK the invariants,
not rubber-stamp them).

## Method

Every invariant was attacked with a real probe: a hostile input, a **forged** plan JSON, a crafted
`tool_search` query, the SSRF address/redirect matrix, or a documented grep/command over the fixed
code. New keeper regression tests were added where a genuine adversarial edge was uncovered:

- `apps/api/test/hub-wp7r-adversarial.test.ts` — 10 API probes (grant confinement, promotion,
  SSRF matrix). **All pass.**
- `apps/web/src/features/hub/SourcesPanel.test.tsx` — 7 new probes appended (`safeHref`
  hostile-scheme confinement). **All pass** (20/20 in the file).

Throwaway empirical probes (scratchpad, not committed) were used to establish the guards' actual
behavior before writing assertions (SSRF literal-URL matrix, forged-plan intersection, promotion
accumulation).

**Verdict: all 7 invariants HOLD.** One **accepted-risk** is recorded under INV2 (per-search vs
per-turn promotion cap) and one **minor by-design note** under INV3 (granted-but-unscanned server).
**No confirmed defect** required a fix on a `7.fix` branch — the two docs + regression tests are the
only deltas. Nothing was weakened to make a probe pass.

---

## INV1 — Grant confinement · **PASS**

**Claim:** no session or agent can call a tool outside its effective scope — not via `tool_search`
promotion (WP1.1), not via plan grants exceeding parent scope (WP2.3 `effectiveAgentGrants`), not via
`web.*` when un-granted or killed (WP5.1).

**Probes & evidence**

1. **Forged plan JSON granting out-of-scope servers.** A scoped parent (`{servers:{qlik:"all"}}`)
   with a forged child plan naming `secretdb` + `filesystem` (which the parent never granted).
   `effectiveAgentGrants(plan, parentScope)` (`apps/api/src/hub/tools/grants.ts:69`) drops both
   entirely — result is `{servers:{qlik:"all"}, builtins:[...]}`. Applied at the child-spawn seam
   (`orchestrator.ts:475-494`, `parentScope = getSession(mission.sessionId).toolScope ?? null`).
   *Probe:* `hub-wp7r-adversarial.test.ts` INV1 tests 1–2; existing `hub-tools-grants.test.ts`
   (10-case intersection table), `hub-missions.test.ts:1115` (PATCH route strips a grant outside the
   parent catalog with a plan note).
2. **Catalog is ground truth (defense-in-depth).** Even handed the forged grant directly,
   `resolveMcpGrants(grant, catalog)` (`grants.ts:21`) only yields entries for servers actually in
   the resolved catalog — an unknown/ungranted server never materializes as a callable tool.
   *Probe:* INV1 test 3.
3. **`tool_search` cannot promote an ungranted tool.** Promotion draws EXCLUSIVELY from
   `mcpDeferred` (`registry.ts:84,90-98`), which is `resolveMcpGrants(...)`-filtered. A tool never
   granted is absent from the deferred catalog, so it can neither match nor promote. *Probe:* INV2
   test 1 (below).
4. **`web.*` gating (WP5.1).** `composeWebTools` (`web.ts:520`): a mission **agent** is NEVER
   granted web tools by default (`capabilityDefault = !isAgentSession && ...`); the kill-switch
   `HUB_WEB_TOOLS=off` removes BOTH everywhere. `web.fetch` is deliberately excluded from
   `ALL_BUILTINS`'s default set (`WEB_BUILTINS` separate). *Evidence:* `hub-web-builtins.test.ts`
   (gating matrix, agent-never-default, kill-switch).

**Minimal repro (green):**
`cd apps/api && npx tsx --test test/hub-wp7r-adversarial.test.ts` → INV1 tests pass.

---

## INV2 — Promotion safety · **PASS** (with one documented ACCEPTED-RISK)

**Claim:** promotion cap holds under adversarial repeated searches; ungranted names in a crafted
query never become active; the per-turn promoted set resets between turns.

**Probes & evidence**

1. **Hostile query naming ungranted tools promotes nothing.** A query
   `"delete_all_users admin drop_table secret exfiltrate"` over a deferred catalog holding only
   `qlik_search` → 0 matches, empty `promoted` set. Structurally guaranteed: `searchDeferredTools`
   only searches `deferredCatalog` (`tool-search.ts:52-71`) and promotion adds only names present in
   it (`:110-127`). *Probe:* INV2 test 1.
2. **Per-turn reset.** `resolveHubToolRegistry` builds a **fresh** `promoted = new Set()` every call
   (`registry.ts:89`), and it is called once per turn (`session-service.ts:811` dispatch;
   `:630` agent). Turn 2's set starts empty regardless of turn 1's promotions. *Probe:* INV2 test 2;
   existing `hub-tool-registry.test.ts:341,355` ("promotion starts empty each turn").
3. **Per-search cap holds.** Each `tool_search.execute` prices matches and stops adding once the
   running total would exceed `maxTokens`; over-cap matches return as data with a "narrow your query"
   note (`tool-search.ts:104-140`). *Evidence:* `hub-tool-registry.test.ts:380,408`.

**ACCEPTED-RISK (LOCKED):** the promotion budget is **per-search, not per-turn**. The code comment
is explicit ("one search can never resident-load a huge slice", `tool-search.ts:12-13`). Under
adversarial **repeated** `tool_search` calls, cumulative promotion accumulates past a single
per-search cap. Rationale for accepting (not fixing):

- **Not a grant-confinement break** — every promoted tool is already granted (INV1). This is a
  context-budget concern, not a security boundary.
- **Bounded** by the 20-step turn cap (`HUB_DEFAULT_MAX_STEPS = 20`, `turn-engine.ts:98`,
  `stepCountIs(maxSteps)` in `stopWhen` `:1075-1076`) and by the granted catalog's own size.
- **Self-limiting** — each promoted tool costs the model its own context; hub budgets are explicitly
  "advisory in v1" (`turn-engine.ts:761`). The app is single-owner/local.
- Converting to a per-turn cumulative cap would **degrade legitimate multi-search research turns**
  (they'd start hitting "narrow your query" refusals) — a UX regression for no security gain.

Locked by `hub-wp7r-adversarial.test.ts` "INV2 (accepted-risk, LOCKED): repeated tool_search calls
accumulate promotions past ONE per-search cap" so any future per-search→per-turn change is a
deliberate, reviewed decision. **If the owner wants the hardening**, it is a small additive change:
thread a shared running-total (a `promotedTokens` ref alongside the `promoted` set) into
`ToolSearchPromotion` and check it across searches — tightening only, never weakening.

---

## INV3 — Silent-failure elimination · **PASS**

**Claim:** every MCP connection-failure path emits `mcp_server_status` + the prompt truth line
(WP1.3). Grep the grant-resolution chain for remaining swallow-and-continue paths.

**Probes & evidence**

- **`getHubMcpSession` (`index.ts:373-398`)** catches an open failure and returns
  `{session:undefined, reason}` — the reason is **surfaced**, not swallowed (it also `log.warn`s).
- **`resolveHubMcpGrants` (`index.ts:432-504`)** builds `serverStatuses[]` for **every** attempted
  server (connected or error) and always returns a non-null result even when every server failed
  (`:490-503`) — the old silent `if (sessions.size === 0) return null` is gone.
- **`session-service.ts:1097-1125`** turns `serverStatuses` into a deduped `mcp_server_status`
  event AND builds a per-turn "Unreachable this turn: `<server>` (`<reason>`)" prompt line **every**
  turn — the model gets the current truth, not the misleading "no MCP tools are granted" fallback.
- **Grep of the chain** (`grep -nE 'return null|continue|catch'` over `index.ts:373-505`): the only
  `return null`s are `registered.length === 0` (no servers registered → nothing to report) and
  `Object.keys(grantServers).length === 0` (no grantable servers — none scanned / all scoped out;
  **nothing was attempted**, so there is no connection to report). Neither is a connection-failure
  swallow. The `catch` at `index.ts:667` is `resolveCrew` (a bad `crewId` → the service 404s),
  outside the grant chain.

*Evidence:* existing `hub-mcp-grants.test.ts:565` ("a dropped granted server gets a persisted status
event, the prompt states the truth, and the surviving server's tool still resolves") and `:617`
("all-fail ⇒ no more silent null — status events + the prompt line still land").

**Minor by-design note (not a defect):** a scoped session naming a server that EXISTS but has
**zero scanned tools** takes the `defs.length === 0 → continue` path and, if it's the only grant,
falls to `return null` (built-ins only) **without** a status event. This is not a connection failure
(nothing was attempted; there is genuinely nothing to route). Surfacing a "granted server has no
scan" hint would be a nice UX touch but is out of RC3.4's scope. Recorded, not fixed.

---

## INV4 — Mission integrity · **PASS**

**Claim:** budget trip on real costs (WP2.4); HITL deny-never-runs + timeout auto-deny (WP2.5);
debate round-2 briefs contain ONLY other debaters' openings (WP4.4); replay of a pre-fix event log
shaped like the live defect session `oNiw1PCAmxc5_ietGD_0h`.

**Probes & evidence** (all covered by existing, gate-green tests — re-run and confirmed):

- **Budget trip on real cost:** `hub-missions.test.ts:563` (tripped total-cost budget stops
  launching + synthesizes PARTIAL), `hub-topologies.test.ts:440` (trip at a debate round boundary),
  `hub-wp4r-final-review.test.ts:478` (crosses the hard cap, production synthesizer). WP2.4 made cost
  **real** (`hub-missions.test.ts:604`, per-agent cost/tokens land on `agent_report` + rollup) so the
  cap can actually fire (the analysis's "`costUsd:0` hardcoded" side-finding is closed).
- **HITL deny-never-runs:** `hub-mission-approval.test.ts:171` ("always_ask DENY is counted; the
  tool never runs"), `:139` (auto/threshold auto-decline a gated call, deny-never-runs), `:473`
  (e2e: DENY records `output-denied`, the agent proceeds honestly — never a fabricated result).
- **Timeout auto-deny:** `hub-mission-approval.test.ts:183` + `:501` (an unanswered card times out →
  auto-denied with a visible note; the mission still terminates). Logic in `approval-policy.ts`
  `raceApprovalTimeout` (`:143-174`) — timeout wins ⇒ `"deny"`.
- **Debate round-2 visibility:** `hub-topologies.test.ts:330` ("round-2 briefs carry the OTHER
  debaters' openings only — never the debater's OWN opening") + `:739` (`composeDebateRoundBrief`
  folds only opposing reports). Logic: `otherActiveLatestReports` excludes `j === i`
  (`topologies.ts:290-302`), round-1 brief is `undefined` (bare, no cross-visibility,
  `topologies.ts:247-251`).
- **Pre-fix replay (`oNiw1PCAmxc5_ietGD_0h`-shaped):** the defect session is mission mode with
  `agent_report`s carrying `[1]` citations and a `mission_synthesis` message starting `## Synthesis:`
  with `citations:[{id:"1"}]`. Replay/reconstruct is covered by `hub-topologies.test.ts:465` (an OLD
  sequential-debate log still replays), `hub-missions.test.ts:726` (the whole mission replays INERT
  from `hub_events` alone), and the web RC4 live-shape regression
  `ConversationPane.citations.test.tsx:223-260` (`##` renders as a real heading not literal text,
  `[1]` woven as an inline chip in the heading AND prose, orphan `[99]` stays literal, an uncited
  turn is byte-identical). This is exactly the shape that previously hit RC4's raw-markdown branch.

---

## INV5 — Rendering safety · **PASS**

**Claim:** hostile citation titles/snippets + hostile markdown (script tags, `data:`/`javascript:`
URLs, chips inside table cells) through WP3.1's renderer; GenUI synthesis parts still pass the
allowlist validator (WP3.2).

**Probes & evidence**

- **Hostile citation title/snippet → inert text.** Titles/snippets flow into JSX text
  interpolation (never `dangerouslySetInnerHTML`), so React escapes them. *Evidence:*
  `SourcesPanel.test.tsx:61` (`<img src=x onerror=...>` never becomes a real element) + `:126`
  (same through the `p` weave override).
- **Hostile citation URL → no clickable href (NEW).** `safeHref` (`SourcesPanel.tsx:52-62`) only
  turns http(s) into a link target; `javascript:`/`data:`/`vbscript:` (incl. a leading-space
  evasion) yield `undefined` → the row renders inert text, and the inline chip's tooltip carries the
  label alone (no URL). *Probe:* the 7 new `SourcesPanel.test.tsx` "safeHref hostile-scheme
  confinement" tests. This was the one genuinely UNTESTED rendering-safety edge — now locked.
- **Hostile markdown structure (chips in table cells, headings, lists).** WP3.1 weaves `[n]` via a
  Streamdown `components` override and re-points tables at `@brand/ui Table*`. *Evidence:*
  `SourcesPanel.test.tsx:97` (table/th/td render real Table structure with woven cells),
  `ConversationPane.citations.test.tsx:224-254`.
- **Markdown BODY sanitization (script tags / `javascript:` links inside the answer text)** is
  delegated to **Streamdown** (`@brand/ai`'s `MessageResponse`), the vendored renderer
  purpose-built for untrusted LLM output. WP3.1 did not change that boundary; the app's own
  contribution (citation title/snippet/url weaving) is escaped/`safeHref`-guarded and tested. This is
  a **library trust boundary** (documented, not a defect); jsdom cannot render Streamdown, so its
  sanitization is not unit-tested here — a live both-theme render of a hostile-markdown answer is an
  owner-acceptance item.
- **GenUI synthesis parts validated server-side.** `runSynthesisTurn` grants only the GenUI
  `present`/`prompt_user` tools (`resolveSynthesisToolset`, `session-service.ts:959-973`); the
  `present` tool runs `validateGenuiSpec` server-side over the same catalog allowlist the browser
  uses (`genui/present-tool.ts:82-92`) and returns a bounded repair path on a validation miss.
  *Evidence:* `hub-mission-synthesis-turn.test.ts`, `hub-genui.test.ts`.

---

## INV6 — SSRF / web · **PASS**

**Claim:** the `web.fetch` guard vs redirect→private chains, DNS-rebind shapes, IPv6 literals +
IPv4-mapped/NAT64, huge bodies, non-GET, credentialed URLs.

**Probes & evidence** (`web.ts`; new probes in `hub-wp7r-adversarial.test.ts` INV6 tests + existing
`hub-web-builtins.test.ts`):

| Attack | Result | Where |
|---|---|---|
| redirect → private/loopback | refused (redirect re-enters the full guard) | `guardedFetch:275-279`; existing test `:203`, new "redirect to non-http/creds" probe |
| DNS rebind (name resolves public then private) | connection pinned to the **validated** IP, host re-resolved+re-checked per hop; deny-if-**any** resolved IP blocked | `guardedFetch:259-274`, `fetchOnce host: ip` `:310`; existing `:203` (`mixed.example`) |
| IPv4-mapped literal `[::ffff:169.254.169.254]` | blocked (embedded v4 judged) | `isBlockedIpv6:151-153`; new INV6 test 1 |
| NAT64 `[64:ff9b::a00:1]` (of a private v4) | blocked; NAT64 of a **public** v4 correctly allowed | `isBlockedIpv6:151-153`; new INV6 test 1 |
| decimal/hex/octal host (`http://2130706433/`, `0x7f000001`, `017700000001`) | Node's URL parser normalizes to `127.0.0.1` → blocked statically | `assertPublicHttpUrl:191-194`; new INV6 test 2 |
| DNS name → private (`localhost`, `metadata.internal`) | passes static check, refused at **connect** time on resolve | `guardedFetch:262-266`; new INV6 test 3 |
| huge body | truncated at the 2 MB byte cap, socket destroyed | `fetchOnce:341-352`, `DEFAULT_WEB_FETCH_OPTIONS.maxBytes`; existing spill test `:265` |
| non-GET | structurally impossible — the tool only issues `method:"GET"`, no method input | `fetchOnce:314`, `webFetchInput` (url only) |
| embedded credentials (direct + via redirect) | refused | `assertPublicHttpUrl:188-190`; new INV6 test 4 |
| redirect loop past hop cap | refused ("Too many redirects") | `guardedFetch:276`; existing test `:243` |

Empirically confirmed against the real code (scratchpad probe): every private-target literal +
name-to-private + redirect evasion is refused; a genuine public URL/redirect is allowed. No leak
found.

---

## INV7 — UI honesty · **PASS** (structural; full visual walk is owner-acceptance)

**Claim:** graph shape vs actual event timestamps for all four topologies (+ debate rounds); rail
scope display vs the `/context` payload's `scopeMode`; cost displays vs usage rows (honest absence
for pre-fix logs).

**Probes & evidence**

- **Rail scope vs `/context` (RC3.1 fix).** The context inspector now filters by the session's own
  scope — `buildHubContextMcpCatalogProvider(..., session.toolScope ?? null)`
  (`routes.ts:1365-1368,1486-1517`), the SAME rule as `resolveHubMcpGrants`. The pre-fix bug (all 5
  servers shown regardless of scope) is closed. `scopeMode`/`toolScope` are additive shared fields
  (WP1.2). *Evidence:* `hub-context-inspector.test.ts`, `meta-rail/ContextSection.test.tsx`,
  `ManageToolScopeDialog.test.tsx`.
- **Topology graph truthfulness (WP4.1/4.4).** Debate now renders as parallel-openings row +
  rebuttal row + a terminal `Synthesis (resolver)` node — matching the real round-based execution;
  org-chart debate edges are directed "sees + rebuts", the misleading facing-pairs are gone.
  *Evidence:* `topology-graph.test.tsx:58` (round shape), `workforce/org-chart/topology-edges.test.ts`
  (directed debate edges), `hub-topologies.test.ts:285` (round-1 run intervals genuinely OVERLAP —
  the graph's parallelism matches the timestamps).
- **Cost honest absence (WP2.4).** `Mission.test.tsx:416` — "a pre-fix log with no cost on its
  `agent_report` events shows no fabricated spend"; `:381` — real per-agent cost renders on the grid
  card + Status tab + header spent/max when it IS present. Rollups reconcile with `hub/usage.ts`.

The **visual** half — both-theme legibility, the graph reading correctly against a live mission's
timestamps, the rail chips, the spend bar — is inherently a browser walk and is listed in
`owner-acceptance-walk.md`. Nothing is claimed here as visually verified.

---

## Summary table

| # | Invariant | Verdict | New probe |
|---|---|---|---|
| 1 | Grant confinement | **PASS** | `hub-wp7r-adversarial` INV1 ×3 |
| 2 | Promotion safety | **PASS** + accepted-risk (per-search cap) | INV2 ×3 |
| 3 | Silent-failure elimination | **PASS** (minor by-design note) | grep + existing |
| 4 | Mission integrity | **PASS** | existing (cited) |
| 5 | Rendering safety | **PASS** | `SourcesPanel` safeHref ×7 |
| 6 | SSRF / web | **PASS** | `hub-wp7r-adversarial` INV6 ×4 |
| 7 | UI honesty | **PASS** (structural; visual → owner) | existing (cited) |

**No confirmed defect.** No `wp/hub-fixes/7.fix` branch was needed. The only code delta is two new
keeper regression tests + these two docs. No security guard was weakened.

## Things I could NOT probe without live credentials / a browser

These are honestly deferred to `owner-acceptance-walk.md` (never faked here):

- A real scoped-Qlik tool call end-to-end (needs the running instance + Qlik OAuth).
- A real mission with a real provider key + a live MCP server (real transcript / real cost / live
  budget enforcement / live HITL approval round-trip in the board).
- `web.search` behind a real provider key on one provider (billing + native-tool behavior).
- Streamdown's markdown-body sanitization rendered live (jsdom can't render it).
- Both-theme (`qlik-bright` + `qlik-dark`) + keyboard walks of every new surface (rail chips,
  board grid, approval queue, spend bar, expand modal, clarify card, Auto/mode chips, plan-card
  grants, topology graph vs live timestamps).
- Migration v51 applying cleanly on an existing deployed DB.
