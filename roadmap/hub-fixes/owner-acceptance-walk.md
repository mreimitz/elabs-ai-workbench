# hub-fixes — owner-acceptance walk

**Assembled by WP 7.R (2026-07-20).** This is the ONE honest live checklist for everything the
`hub-fixes` workstream could NOT prove in the gate — anything needing a running instance, real
provider keys, a live MCP server, a real the vendor tenant, or a browser (both-theme + keyboard). It
consolidates every owner-acceptance item recorded across `STATUS.md`'s WP tick-notes and its
Owner-acceptance section into exact click-paths + expected outcomes.

**Nothing below is verified.** The gate proves engine behavior against stubs/fakes; these items are
the live truth the stubs can't establish. Reference: `analysis.md` (RC1–RC7), `review-7R.md`
(the adversarial probes that DID pass in the gate).

**How to run:** `docker compose up -d --build` → open `http://localhost:8080/`. Enter provider keys
in **Settings → Providers**. The Assistant Hub is the nav item **Assistant** (`/assistant`); the
dock is the right-hand "App assistant". Do each check in **both** themes (Settings → theme →
`Qlik Bright`, then `Qlik Dark`) unless noted, and confirm keyboard reachability (Tab/Enter/Space,
visible focus ring) on every new interactive control.

---

## 0 · Pre-flight (deploy + config decisions)

- [ ] **Migration v51 applies cleanly on the EXISTING deployed DB.** WP6.1 added the workstream's
  only migration (`LATEST_SCHEMA_VERSION = 51`, `db/database.ts:1553,1710`): a self-guarded,
  idempotent, FK-safe rebuild of `hub_sessions` to widen `mode`'s CHECK to admit `'auto'`. Take a
  DB backup first (prudent, though the rebuild is row-preserving + FK-checked). Bring the container
  up; confirm boot succeeds, existing sessions still open, and `PRAGMA user_version` reads `51`.
  *Expected:* no data loss, no boot error; a new session can be created with mode `auto`.

- [ ] **DECISION — remove WP0.1's eager override now that WP1.1 shipped `auto`?**
  `docker-compose.yml:27` still pins `HUB_TOOL_LOADING_DEFAULT: eager` (the Phase-0 same-day
  mitigation). The code default is now `auto` (`.env.example:154`; `env.ts:296`), which safely loads
  a small scoped catalog eager and DEFERS a large unscoped one (with `tool_search` promotion) instead
  of blowing the prompt budget. **The live RC1/RC3 proof works under either mode.** Choose:
  - Keep `eager` → simplest, long-tested path; but a large unscoped session re-hits the ~245k-token
    cost the analysis flagged. Best paired with always creating **scoped** sessions.
  - Remove the line (fall back to `auto`) → recommended once you've done the scoped-the vendor proof below;
    lets big catalogs defer gracefully.
  *Action:* decide, edit `docker-compose.yml`, recreate the container. Record the choice.

- [ ] **Register at least one MCP server + scan it** (Servers → Add server → run a discovery scan) so
  the Hub has a real tool surface to grant. For the the vendor checks, register `acme-demo` (or your
  the vendor cloud MCP server) with working OAuth.

---

## 1 · MCP truth in a main session (RC1 / RC3)

- [ ] **Scoped-the vendor tool call end-to-end (the core RC1/RC3 proof).**
  Assistant → **New session** → **MCP & tools** tab → switch to **Scoped** → tick ONLY
  `acme-demo` → create. Ask a question that needs the server (e.g. "search my the vendor apps for
  sales"). *Expected:* a `vendor_*` tool call appears with an **approval card**; approve it; it returns
  real data; the answer renders. (Pre-fix, no MCP tool was ever callable — RC1.) In `auto`/`deferred`
  mode you may first see a `tool_search` step that promotes the tool, then the call.

- [ ] **Rail Tools section shows ONLY the scoped server (RC3.1).** Open the meta-rail **Context**
  section on that scoped session. *Expected:* it lists `acme-demo` only, NOT all registered
  servers. Compare an **Auto** (unscoped) session — it should list every reachable server. (Both
  themes.)

- [ ] **Manage tools after create (RC3.3 write-once fix).** On the scoped session, open the rail's
  **Manage tools** editor (`ManageToolScopeDialog`), change the grant, save. *Expected:* the scope
  persists (PATCH), the next turn honors it. (Both themes; keyboard-open the dialog.)

- [ ] **Real failing-MCP path (RC3.4).** Force a broken/expired server (e.g. let the the vendor OAuth
  expire, or point a server at a dead URL) and take a turn that needs it. *Expected:* the rail shows
  an **error chip** with the reason (not a silent drop); the model's answer/prompt states
  "Unreachable this turn: `<server>` (`<reason>`)" instead of the misleading "no MCP tools are
  granted"; a **Retry** affordance is present; after fixing auth, Retry / next turn reconnects (chip
  → connected). (Both themes.) *Needs a genuinely broken server or a live OAuth expiry.*

---

## 2 · Missions become real tool-using sessions (RC2, RC6)

- [ ] **A real mission with real MCP tools (RC2 — the linchpin).** With a provider key + the live MCP
  server, create/launch a mission (crew-bound or planner-proposed) whose agents are granted the
  server. Approve the plan. *Expected:* an agent's child session runs **real turns** — it calls a
  granted tool, the call + result stream into its transcript, a **real** report comes back, and the
  board shows **real** per-agent cost/tokens (not `costUsd:0`). (Stub-proven in the gate; live is
  owner-acceptance.)

- [ ] **Live expand-modal transcript (RC6.2/6.4).** On the running mission board, click the
  **Maximize** (top-right of the topology graph) → the full-screen expand modal. Select an agent
  node (click, and via keyboard). *Expected:* the right panel **streams that agent's child-session
  transcript live** (text + tool-call cards); closing the modal unsubscribes (no leaked stream).
  Check at 1280 and 1920 widths, both themes. *(Note: selecting a REBUTTAL node `::rN` falls back to
  the default agent gracefully — documented WP4.4 follow-up, not a crash.)*

- [ ] **Mission agent grid + detail box (RC6.3).** Reported agents render in a responsive 2-up grid;
  click a card (mouse + keyboard) → the detail box tabs (Status / Live / Report) open. (Both themes;
  hover + focus feel.)

- [ ] **Truthful topology graph vs live timestamps (RC6.1).** Launch a **debate** mission. On the
  board + org-chart, confirm the graph reads as: a parallel **openings** row → a **rebuttal** row
  with "sees + rebuts" edges → a terminal **Synthesis (resolver)** node, and that the per-topology
  legend line is present. Cross-check the agent report timestamps: round-1 debaters should overlap
  (parallel), rebuttals see prior openings. Repeat for pipeline / parallel / best-of-N. (Both themes.)

- [ ] **Live HITL approval round-trip in the board (WP2.5, D-HF6).** Run a mission with autonomy
  `always_ask` and agents that make MCP calls. *Expected:* each gated call queues to the board's
  **approval queue** (`MissionApprovalQueue`); approving resumes that agent's slot; **denying** makes
  the tool fail into the transcript with an honest report note (never a fabricated result); leaving a
  card unanswered auto-denies after the timeout (`HUB_MISSION_APPROVAL_TIMEOUT_S`, default 300 s) with
  a visible note and the mission still terminates. (Both themes; keyboard the approve/deny buttons.)

- [ ] **Live planner proposes real grants (RC2.4).** In an Auto/mission session, ask a data question
  that warrants a mission. *Expected:* the proposed `MissionPlanCard` shows **per-agent server chips**
  drawn from your reachable catalog (not "no tools"); hallucinated server ids are stripped with a plan
  note; unconfigured "Finish configuring…" roles show a warning before launch; the effective-grant
  subtitle reflects plan ∩ parent scope. Edit a grant on the card and confirm it constrains to the
  picker. (Both themes.)

---

## 3 · Answer rendering (RC4)

- [ ] **Mission synthesis renders as MARKDOWN with inline chips + GenUI (WP3.1/3.2).** Complete a
  mission whose synthesis carries citations. *Expected:* the final answer renders as **real markdown**
  (headings, tables, lists — not literal `##`/`|---|`), `[n]` markers are **inline citation chips**
  (hover shows source), and where the model chose a widget the synthesis shows a GenUI `present`
  Table/StatGroup/Chart. (Pre-fix, any citation-bearing answer rendered as raw markdown — RC4.) Also
  confirm a LEGACY pre-fix mission log still renders (replay). (Both themes — check chip contrast.)

- [ ] **Hostile-markdown answer renders safely (INV5 live).** If you can prompt an answer containing
  `<script>`/`javascript:` links, confirm nothing executes and no active link is produced. (Streamdown
  sanitization is a library boundary; jsdom can't test it — verify live. `review-7R.md` §INV5.)

---

## 4 · Internet capability (RC5, D-HF2)

- [ ] **Live `web.search` on at least one provider.** In a normal (non-agent) session on a
  search-capable model (Anthropic / OpenAI / Google), ask something that needs current info.
  *Expected:* the provider's **native web search** runs, results become **hub citations** (numbered,
  hover-able), and the usage surface shows a truthful `webSearches` count (no fabricated $). On an
  unsupported model (openai_compatible / ollama) the prompt honestly says web.search is unavailable
  and suggests `web.fetch`. Confirm `HUB_WEB_TOOLS=off` removes both tools everywhere. *(SSRF guard
  for `web.fetch` is gate-proven offline — `review-7R.md` §INV6 — but a live public fetch is worth a
  smoke check.)*

- [ ] **Research-server onboarding surfacing (WP5.2).** In a research session with no research MCP
  server and no web capability, confirm the honest hint appears ("paste your own API key; none
  bundled") and the plan-card web-capability notice; the deep-link lands on `/servers` (one click from
  Add-server → the research presets). (Both themes.)

---

## 5 · Mode routing + composer clarity (RC7)

- [ ] **`auto` session mode routes per message (WP6.1).** Create an **Auto** session (the new
  default). Ask a trivial question → it answers directly as chat. Ask a decomposable/multi-step ask →
  it proposes a mission plan (never silently starts one — the plan-approval gate still applies). Ask
  an ambiguous ask → a GenUI **clarify card** appears ("Quick answer / Run a mission (≈$X, N
  agents)"); pick each branch and confirm it acts on the choice. (Both themes; keyboard the clarify
  card buttons.)

- [ ] **Composer mode + autonomy chips (WP6.2).** Confirm the composer shows a **SessionModeChip**
  (icon + label) beside the model chip that switches auto↔chat↔research (mission is never an offered
  switch target); the autonomy control now reads **"Autonomy:"** with a 3-level tooltip — the two are
  visibly distinct axes (the confusion that produced the original report). Both chips are real
  focusable buttons with distinct aria-labels; Tab/Enter across browsers. (Both themes.)

---

## 6 · Consolidated both-theme + keyboard visual walk

Do a single pass in **Qlik Bright** then **Qlik Dark**, keyboard-only where possible, over every new
surface (each must be legible, focus-visible, and read correctly in both themes):

- [ ] Rail **Tools/Context** section + per-server **connection chips** + **Retry** (WP1.2/1.3).
- [ ] **Manage tools** scope dialog (WP1.2).
- [ ] Mission **board grid** + **approval queue** + **spend bar** / per-agent cost badge (WP2.4/2.5/4.2).
- [ ] Mission **expand modal** + live transcript panel, at 1280 + 1920 (WP4.3).
- [ ] Debate **topology graph** (openings/rebuttal rows, "sees + rebuts" edges, resolver node,
  legend) — board AND org-chart (WP4.1/4.4).
- [ ] **Clarify card** + **Auto/mode chips** + **autonomy** label/tooltip (WP6.1/6.2).
- [ ] **MissionPlanCard** per-agent grant chips + effective-grant subtitle + unconfigured-role warning
  (WP2.2/2.3).
- [ ] Synthesis answer: markdown + inline citation **chip contrast**, Sources footer, GenUI widget
  (WP3.1/3.2).
- [ ] Research hint / web-capability notice copy (WP5.2).

---

## 7 · Notes / known non-blockers

- The WP4.4/4.1 hub-UI Playwright tests are **flaky/broken on the local macOS box** (pre-existing,
  verified against the pre-2.1 baseline) — treat **CI** as the reference for the full e2e suite, not
  local runs. WP 7.R re-confirmed this (see the report-back).
- `review-7R.md` records one **accepted-risk** (INV2: promotion cap is per-search, not per-turn —
  not a confinement break) and one **minor by-design note** (INV3: a granted-but-unscanned server
  isn't surfaced as a status). Neither blocks acceptance; both are the owner's call to harden later.
- The old `HUB_AGENT_RUNNER=structured` one-shot runner is retained for one release (D-HF7) as a
  byte-compatible rollback; production default is `session` (`.env.example:221`).
