# Assistant — work-package status ledger · **PRIORITY: HIGH**

Living state for the **Assistant** plan (embedded Claude agent chat), read and updated by
`/next-wp assistant`. A box is ticked **only** when that WP's Acceptance is met and the gate
(`pnpm typecheck && pnpm test && pnpm build && pnpm lint`) is green.

**Legend:** `[ ]` open · `[x]` done. Done lines record date + branch:
`… — done <YYYY-MM-DD> · wp/assistant/<id>`.

> Decisions locked in [`decisions.md`](./decisions.md) (D-AS1–D-AS26); architecture + WP specs in
> [`00-plan.md`](./00-plan.md). **Refinement R1** (page-scope lock · skill-structure awareness ·
> live edits) — plan [`refinement-01-scope-structure-live-edits.md`](./refinement-01-scope-structure-live-edits.md),
> WPs in the **Refinement R1** section below (D-AS19–D-AS23; no migration). **Refinement R2**
> (per-entity threads · release-on-reply · thread names/dates) — plan
> [`refinement-02-session-management.md`](./refinement-02-session-management.md), **Refinement R2**
> section below (D-AS24–D-AS26; no migration). **Refinement R3** (session starters — per-entity
> suggested prompts) — plan [`refinement-03-session-starters.md`](./refinement-03-session-starters.md)
> (incl. the authored catalog), **Refinement R3** section below (D-AS27–D-AS29; no migration). Policy/billing context (§2 of the plan) was researched
> **2026-07-10** — re-verify at each phase start (the Agent SDK subscription-billing change is
> paused, not resolved).
> **Agent execution:** [`execution-plan.md`](./execution-plan.md) (Opus 4.8 orchestrator ·
> per-WP models · parallel waves) + [`kickoff-prompt.md`](./kickoff-prompt.md) (owner handover).
> Waves: W1 `0.1 ∥ 0.3` → W2 `0.2` → W3 `1.1 ∥ 1.2` → W4 `1.3` → W5 `1.4 ∥ 2.1` →
> W6 `2.2 ∥ 3.1` → W7 `2.3 ∥ 3.2` → W8 `3.3`.
>
> **Integration base (orchestrated build, W0):** WP branches fork from / merge into **`ux/integration`**
> (the branch that carries these plan docs; content-current with `origin/main` after the owner's PR #49
> `ux/integration → main` merge — local `main` is stale, 184 behind origin, and is NOT used). The
> orchestrator does **not** merge `ux/integration → main` (owner's job, per execution-plan §8).
> **Schema renumber:** the plan's "v19" was already taken by a Testing-UX suite-run index migration, so
> the Assistant tables are **v20** (WP 0.1: credentials/threads/events) and **v21** (WP 0.2:
> `assistant_settings` fallback pointer, anticipated by plan §4). Both additive + forward-safe;
> `LATEST_SCHEMA_VERSION` is now 21.

## Phase 0 — Auth & plumbing
- [x] WP 0.1 — shared contract (types/zod/constants) + migration **v20** (`assistant_credentials`,
      `assistant_threads`, `assistant_events`) + repository — done 2026-07-10 · wp/assistant/0.1 (3d98e3c).
      Additive `CREATE TABLE IF NOT EXISTS` (v17 pattern); events append-only w/ per-thread monotonic
      `seq` + `UNIQUE(thread_id,seq)`; SecretStore-encrypted credential w/ INTERNAL-only `getDecrypted()`.
      Frozen W3 contract in `shared` (`AssistantToolContext` / `buildAssistantTools` as opaque doc-typed
      placeholders — no api/SDK import). Renumbered v19→**v20** (v19 taken); bumped the 4 flagged
      `LATEST_SCHEMA_VERSION` literal locks **+ 2 more** the agent found in `skill-ide-server-binding`.
      Tests +16 (forward-safe migration: a v19 DB gains the 3 tables & keeps rows; seq monotonicity;
      credential encrypted-at-rest & never returned). Orchestrator added a both-or-neither
      `entityKind`/`entityId` refine (reviewer nit). **NOT verified:** no route/API surface yet (WP 0.2/1.1).
- [x] WP 0.2 — Claude auth (PTY `setup-token` + paste + fallback ref + sign-out; Settings **Assistant**
      card) — done 2026-07-10 · wp/assistant/0.2 (1ca9320). `PtyDriver` DI seam (`node-pty` lazily
      required; scripted-fake tests — never a real PTY/CLI/Anthropic call). Routes: `GET auth/status`,
      `POST auth/oauth/{start,complete,cancel}`, `POST auth/token`, `PUT auth/fallback`, `DELETE auth`
      (`registerAssistantRoutes` in `apps/api/src/assistant/routes.ts`, wired in `index.ts`, extensible
      for WP 1.1). Single-flight (409); url/token/hard timeouts kill the PTY + blank the buffer on settle.
      **Token proven ABSENT from every response AND the captured pino stream** (2 tests mirroring skills
      WP 7.1); encrypted at rest via `SecretStore`; `getDecrypted()` INTERNAL-only w/ zero route callers.
      Fallback = anthropic-kind `provider_credentials` REFERENCE (400 on missing/non-anthropic); new
      migration **v21** + `assistant_settings` (1-row pointer, FK `ON DELETE SET NULL`) — additive,
      forward-safe, 6 version-literal locks bumped 20→21. Settings `AssistantCard` all `@elabs-ai/components-*`; password
      paste field (autoComplete off / spellCheck false / never prefilled); sign-out confirm; "powered by
      your Claude subscription", no "Claude Code" copy. Tests +11 API / +3 web. **Opus security review:
      SHIP** (token-leak surface defended in depth). Nits logged: (a) auth-URL raw `<code>` → could be
      `CodeBlock`; (b) `signOut` doesn't cancel an in-flight PTY flow → orphan child until the unref'd
      10-min timeout (no token in that buffer) → **handed to WP 1.1's sign-out kill-hook wiring**; (c) paste
      schema checks prefix+length, not post-prefix charset. **NOT verified:** live OAuth against claude.ai +
      real Settings visuals in both themes (owner-acceptance).
- [x] WP 0.3 — deps & container — done 2026-07-10 · wp/assistant/0.3 (741f1ad). Pinned **exact**
      `@anthropic-ai/claude-agent-sdk@0.3.206` + `node-pty@1.1.0` (the only 2 new runtime deps);
      `spawn-env.ts` minimal child env (exactly one auth var; `MCP_SECRET_KEY`/`DATABASE_PATH` proven
      absent by test); env config (`ASSISTANT_MAX_TURNS`/`_IDLE_TIMEOUT_MS`/`_MAX_ACTIVE_SESSIONS`/
      `_SESSION_RETENTION_DAYS`/`_DATA_DIR`) + `.env.example`; `docker-compose.yml` `init: true`; README
      egress note; manual `apps/api/scripts/assistant-smoke.ts` (**not** in `pnpm test`). Verified the
      real SDK `.d.ts`: `query({prompt,options})`; **`options.env` REPLACES the child env** (matches the
      D-AS17 sandbox rule). Deviation (sound): a `pnpm patch` chmods node-pty's darwin `spawn-helper`
      exec bit (upstream packaging bug, macOS-only; Dockerfile `COPY patches` proven necessary). Docker
      image **built + exercised** (node-pty PTY spawns, SDK linux CLI present, `/api/health` OK). Tests
      +17. **NOT verified:** no real Anthropic API call (needs the owner's token — owner-acceptance).

## Phase 1 — Session engine + read-only dock (MVP)
- [x] WP 1.1 — session engine (manager + `AgentSessionDriver` seam + SSE + lifecycle) — done
      2026-07-10 · wp/assistant/1.1 (85e53cb). Streaming-input `query()` driver behind a DI seam
      (scripted-fake tests — never real `query()`/child/Anthropic); verified EVERY SDK `Options` field
      vs the 0.3.206 `.d.ts` (`env` replaces the child env, `includePartialMessages`, `settingSources:[]`,
      `resume`, `maxTurns`, `model`, `mcpServers`, `cwd`, `disallowedTools`, `abortController`). Manager:
      thread→session map, monotonic-`seq` fan-out, bounded replay buffer (2000), **settled-only**
      persistence (deltas stream, never stored), `detach` for the delete race. Lifecycle: idle-park (kill
      child, keep `sdkSessionId`) → resume, active cap (409), stop (abort in-flight), startup orphan
      reconciliation. SSE copies the `streamRun` template (+ fixed an SSE header-flush bug). Sign-out
      kill-hook wired (+ cancels an in-flight PTY oauth flow → closes WP 0.2 nit b). Tests +22.
      **NOT verified:** real `query()` streaming / live park-resume / real SDK error shapes (owner-acceptance).
- [x] WP 1.2 — read toolset (23 tools) + context envelope + system prompt + model roster — done
      2026-07-10 · wp/assistant/1.2 (9a2ea2f). `buildAssistantTools(deps)` via `createSdkMcpServer`+`tool()`/
      zod, calling existing repositories directly (in-process — no HTTP, no secrets); compact JSON + explicit
      `truncated` markers. `servers_list`/`collections` redaction PROVEN at the repo layer (booleans only).
      `renderContextEnvelope` + `ASSISTANT_SYSTEM_PROMPT` (untrusted-content/injection warning + no-"Claude
      Code" identity + "fetch don't guess"). Model roster = static `ASSISTANT_DEFAULT_MODEL_ROSTER` + env
      override (`supportedModels()` needs a live session — honestly documented); `GET /api/assistant/models`.
      Tests +71. Drift (sound): `runs_search` skillId/since/until layered client-side; suiteRuns split into
      two dep fields; environments tools operate on the frozen `scenario` wire entity.
- [x] W3 integration (orchestrator, merge cc383a0): resolved `routes.ts`/`index.ts` conflicts; wired 1.2's
      `buildAssistantTools` (adapter over the 9-repo `AssistantToolDeps` bag) + `renderContextEnvelope` into
      1.1's manager. **Opus review found 2 cross-WP MUST-FIX, fixed by the orchestrator before tick:**
      (1) `ASSISTANT_SYSTEM_PROMPT` was never passed to `query()` — now threaded manager→driver→`sdkOptions`
      as a custom string (NOT the `claude_code` preset), defaulted so it can't be silently dropped;
      regression test added. (2) `park()` now removes the session from `live` synchronously (mirrors
      `detachThread`) — closes a race that dropped a message + wedged the thread at `running`. Combined gate:
      **1013 API + 457 web tests**, build + lint green. Logged for WP 3.3: `maxTurns` is per-**session** not
      per-message (correct comments/error wording); `limit_error` should carry the driver's `kind`
      (auth vs rate_limit) for the retry-on-key UX. (Pre-existing trait: `apps/api/tsconfig.json` excludes
      `test/` from typecheck, so test type-drift isn't gate-caught — tests still run green via tsx.)
- [x] WP 1.3 — dock UI (AppShell `dockContent` slot + `AssistantDock` + `use-assistant-stream`) — done
      2026-07-10 · wp/assistant/1.3 (76e6c15). Additive AppShell dock props (resizable desktop split +
      mobile `Sheet` + TopNav toggle + ⌘J), hidden until signed in; `AssistantProvider` + the FROZEN public
      API `openAssistant({prompt?,entity?})` via `useAssistant()` (envelope derived from route); `AssistantDock`
      from `@elabs-ai/components-ai` (`ChatShell`/`Conversation`/`Composer`/`AgentTimeline`/`Shimmer` — props verified vs
      the `.d.ts`; `Reasoning*` deliberately unused — the v1 wire has no reasoning channel) mirroring
      `ConversationPane`/`ToolCallCard`; `use-assistant-stream` mirrors `use-run-stream` (seq dedup, replay,
      errors only on a genuine pre-terminal drop). The agent drove it via Playwright in BOTH themes (toggle
      absent when signed out, dock renders, ⌘J, send + error toast, thread switcher) and fixed a composer
      no-op bug. Tests +27 web (→484). `brand-ui audit` clean; no raw colors/HTML; no "Claude Code" copy.
      **Sonnet review SHIP-WITH-NITS; orchestrator fixed the one correctness finding:** a double-send while
      streaming could mis-bucket a turn → now guarded at BOTH layers (composer `!streaming` guard mirroring
      `testing/Composer` + backend `sendMessage` `turnInFlight`→409, tested). Logged nits: ⌘J reclaims the
      browser's Ctrl+J (per D-AS5 — owner keyboard walk); the Assistant toggle reuses the Skills `Sparkles`
      glyph (cosmetic). **NOT verified:** live streaming conversation (needs token), mobile-`Sheet` path,
      resize-drag, full keyboard-only walk, tool-call/permission cards with live data (owner-acceptance).
- [x] WP 1.4 — page hooks v1 ("Analyze this run" / "Why did this fail?" / "Analyze recent runs") — done
      2026-07-10 · wp/assistant/1.4 (4cecb47). Pure helpers (`buildRunAnalyzeAction`/`isFailedRunPhase`/
      `buildSkillAnalyzeRequest`) + `@elabs-ai/components-ui` Buttons in RunBar/RunConsole (run entity; fail-variant on
      error/context_overflow/assertions_failed) and SkillInspector (skill entity), calling ONLY the public
      `openAssistant()` (no dock internals touched). Tests +16 web. **NOT verified:** both-theme visuals,
      live dock open with a token.

## Phase 2 — Writes & approvals
- [x] WP 2.1 — write-permission protocol (D-AS4) — done 2026-07-10 · wp/assistant/2.1 (1f6e21d).
      `canUseTool` choke point verified vs the 0.3.206 `.d.ts` (`(toolName,input,{signal,toolUseID})→
      PermissionResult`); SDK-free `permission-classifier` (gated-BY-DEFAULT; read = exact allowlist
      build-bound to WP 1.2's tools; deletes ALWAYS ask; `ui_` navigation auto-allow) + a
      `DriverStartOptions.canUseTool` seam (the fake driver invokes it in tests). Promise-map settles
      EXACTLY once across POST allow/deny · fail-closed timeout auto-deny (`ASSISTANT_PERMISSION_TIMEOUT_MS`
      300s) · stop/park/detach/delete/sign-out — no leak/zombie; double-POST → 404. `permission_request` +
      `permission_decision` persisted (auto-accept path too); replayed decisions render inert. Web:
      `AssistantPermissionCard` (`@elabs-ai/components-*`; diff via `CodeSnippet`) + auto-accept `Switch`+badge ("deletes
      always ask"); composer blocked while pending, Stop still works. Tests +20 API / +9 web. **Opus
      (Phase-2) review: SHIP-WITH-NITS; orchestrator hardened the 2 latent classifier gaps before W6/W7 add
      real mutating tools:** delete detection is now case-insensitive + a destructive-synonym net
      (delete/destroy/purge/wipe/remove/drop) + the authoritative `EXPLICIT_DELETE_TOOLS` set; the delete
      guard runs BEFORE the `ui_` check (closes `ui_delete_*`); +2 classifier tests. Fixed a misleading
      detach comment. **⚠ WP 2.2/2.3 MUST add each destructive tool's bare name to `EXPLICIT_DELETE_TOOLS`;
      WP 3.1 `ui_` tools MUST be navigation-only.** **NOT verified:** live agent write with a real token;
      both-theme permission-card visuals; the real SDK per-request `canUseTool` signal backstop (owner-acceptance).
- [x] WP 2.2 — skill workspace loop (D-AS13) — done 2026-07-10 · wp/assistant/2.2 (0b5108b). Per-thread
      workspace `<assistantDataDir>/ws/<threadId>/` via the SDK's `additionalDirectories`;
      `skills_open_workspace` (materialize; path-traversal + symlink-escape guarded) → native `Edit`/`Write`
      edits (confined by `cwd`+`additionalDirectories`; the DB + secret key are SIBLINGS, unreachable) →
      `skills_commit_workspace` → `SkillRepository.createVersion(sourceRef ASSISTANT_EDIT_SOURCE_REF)` as a
      NEW immutable version (single tx; `{unchanged:true}` dedup). Native file tools classified
      (Read/Glob/Grep auto-allow; Edit/Write/MultiEdit gated auto-accept-eligible writes;
      `ASSISTANT_DISALLOWED_TOOLS` expanded — Bash/network/NotebookEdit/subagents/scheduling out). Workspace
      survives idle park (keyed by threadId), cleaned on commit/delete. `AssistantDiffCard` (`@elabs-ai/components-*`,
      reuses `SkillDiffView`). E2E asserted (analyze→open→edit→approve→commit→new version + confinement +
      cleanup). Tests +26 API / +8 web. SDK drift documented (no `LS` tool → `Glob`). **Opus review: path
      traversal + createVersion immutability + confinement all CLEAN.** **NOT verified:** real agent editing
      via a live SDK child; both-theme diff-card visuals.
- [x] WP 2.3 — remaining app-data write tools (D-AS3) — done 2026-07-10 · wp/assistant/2.3 (48509aa).
      15 write tools (tests_create/update/delete + expectations_set + attachments_manage; environments_
      create/update/delete + attach/detach_skill; servers_update_config; collections_modify; suites_create/
      update/delete), each delegating to the EXISTING validated service/repository (no raw SQL, no
      re-implemented validation), returning a compact confirmation + a REAL entity-link (no fabricated URLs).
      **Deletes gated ALWAYS-ASK:** tests_delete/environments_delete/suites_delete in `EXPLICIT_DELETE_TOOLS`
      (+ the verb net); reversible unlink/detach correctly stay auto-accept-eligible writes.
      `servers_update_config` schema = NON-SECRET subset only (name/transport/command/args/url) — env/header/
      auth impossible by construction; the repo update MERGES (can't wipe a secret by omission). Inventory
      build-binding = read ∪ workspace ∪ ui ∪ write (exact). Tests +38 API incl. a belt-and-braces
      "no write-schema key is a secret" test (word-boundary matcher; guards the `environmentId` false-positive).
      **Opus (Phase-2) review: SHIP** — secrets unreachable by construction AND re-validated at MCP dispatch
      (an approval `updatedInput` can't smuggle a field the schema didn't declare); all deletes always-ask.
      Drift: attachments support only "add" (no delete endpoint exists in the app). **NOT verified:** a live
      agent invoking these writes (owner-acceptance).

## Phase 3 — Drive-the-UI & breadth
- [x] WP 3.1 — UI-action tools + addressable-view registry + client executor (D-AS8/D-AS16) — done
      2026-07-10 · wp/assistant/3.1 (fe483e0), integrated at merge 55efdc4. Shared ALLOWLIST registry
      (run+turn / skill+tab+version / scan / server / suite_run / compare / settings; zod-validated params —
      a bad view/params yields a tool error, NEVER a navigation, and emits no `ui_action` event);
      `ui_navigate`/`ui_open_run_turn`/`ui_open_skill`/`ui_open_diff` (navigation-ONLY, auto-allow via the
      `ui` band); `ui_action` relay; a new SSE `replay_complete` marker + `liveSinceSeq` for live-vs-replay;
      client executor (react-router navigate — live = instant, replay = inert `AssistantUiActionChip`); added
      real `?turn=` run-console deep-linking. Tests +19 API / +12 web. **Opus review: MUST-FIX (2, both fixed
      by the orchestrator before tick, both fail-safe — no rogue navigation):** (1) `ui_navigate` emitted the
      RESOLVED params (`{scanId}`) but the client re-resolves via `resolveAssistantUiAction("navigate",…)`
      which needs `{view,params}` → live nav + chip label silently broke (masked because the dock test used
      the correct shape while the API emitted the wrong one) → `uiResult` now echoes the RAW args uniformly +
      API test corrected; (2) `executedUiActionIdsRef` (per-thread positional ids) wasn't reset on a thread
      switch → a new thread's first live nav was dropped → now reset on `activeThreadId` change. Gate: 1081
      API + 529 web green. **NOT verified:** live agent-driven navigation with a token; both-theme chip
      visuals; a full API→event→client round-trip test (each side tested against the shared registry
      separately). W6 merge: additive conflicts in `tools/index.ts`/inventory test/`AssistantDock.test.tsx`
      resolved; `threadId` wired per-session into the workspace tool deps.
- [x] WP 3.2 — page hooks v2 — done 2026-07-10 · wp/assistant/3.2 (b07f2a4). 5 "Analyze…" hooks via the
      WP 1.4 template (suites feed → `suite_run`; compare → `compare` + both run ids in the prompt; scan →
      `scan`; server → `server`, shown when the last scan failed; compatibility → `scan`/`run`), each a pure
      helper + a `@elabs-ai/components-ui` Button gated on `authConfigured`, calling ONLY the public `openAssistant()`.
      Tests +21 web. **Opus review: SHIP with a nit** — the "insert as context" HELPERS (`insert-as-context.ts`)
      are built + unit-tested but their 2 row-action ENTRY POINTS (compare drill drawer + scan tool table) are
      **NOT wired** into the UI (reviewer: "acceptable partial" — pure, tested, no dead import). **➜ Open
      follow-up:** wire the 2 insert-as-context entry points (or drop the helpers) — carried in Open
      follow-ups below. **NOT verified:** both-theme visuals, live dock.
- [x] WP 3.3 — hardening sweep — done 2026-07-10 · wp/assistant/3.3. **Limit-error UX (D-AS14):**
      the driver's `limit_error` `kind` (auth vs rate_limit — WP 1.1 nit) now threads
      driver→manager→persisted event→dock; new `POST /api/assistant/threads/:id/retry-source
      {source}` is the ONLY path that ever changes a thread's `authSource` — validates the TARGET
      is configured (409) before tearing anything down, 400s if already on that source, tears down
      the live session, records a settled `source_switch` audit event, flips `authSource`, and
      re-sends the last user message so the failed turn retries on the new source (proven by test:
      a normal `sendMessage` never touches `authSource`; only the explicit action does; the retried
      session's spawn env carries exactly the new source's ONE auth var). New
      `AssistantLimitErrorBanner` (dock) offers a one-click "Retry on …" ONLY when that source is
      actually configured (else a Settings link — never a silent fallback), plus an auth-kind
      re-sign-in/re-check hint; only the TRAILING turn is interactive. **Token-expiry warning** now
      also surfaces in the dock header (badge, subscription threads only), not just Settings.
      **Retention:** new `POST /api/maintenance/prune-assistant` (`assistant/retention.ts`) — day-
      based thread+event pruning (skips live threads), an UNCONDITIONAL orphaned `ws/`/`threads/`
      directory sweep (closed a real gap found along the way: `deleteThread` never removed the
      scratch cwd, only the workspace root — fixed), and a stale-SDK-session-transcript sweep
      bounded to the app's OWN scoped `CLAUDE_CONFIG_DIR` (deliberately NOT the SDK's
      `listSessions`/`deleteSession` — those resolve their root from `process.env.CLAUDE_CONFIG_DIR`
      at call time with no override, which from this process would hit the OPERATOR's real
      `~/.claude` — a documented, verified-against-the-`.d.ts` finding, not a guess); reachable from
      Settings → Storage & maintenance too. **Docs:** README's egress section extended with a
      Concurrency & memory note (~1 GiB/session, the `ASSISTANT_MAX_ACTIVE_SESSIONS` cap, idle-park,
      `/data` growth via the new prune endpoint); `.env.example` gained the previously-undocumented
      `ASSISTANT_PERMISSION_TIMEOUT_MS`/`ASSISTANT_MODEL_ROSTER` + a note that the expiry threshold
      is a fixed constant, not an env var; corrected the `maxTurns` wording (WP 1.1 nit) everywhere
      it appeared, including the user-facing `error_max_turns` message, which previously misleadingly
      said "for this message". Tests **+24 API** (retry-source manager+route, retention pure-function +
      route, `kind` threading) / **+16 web** (banner component, dock integration, expiry badge, timeline
      `kind` threading). Gate green: **1143 API + 566 web tests** (was 1119/550), typecheck/build/lint
      clean. **Opus (final) review: SHIP-WITH-NITS** — the D-AS14 single-writer / validate-before-teardown /
      single-auth-var switch and the app-data-dir-bounded retention (avoids the operator's `~/.claude`, skips
      live threads, no traversal) are both correct + well-tested; no must-fixes. Nits logged below (retry
      re-send duplicates the last user_message if resume-across-sources works; a retry that hits the
      active-session cap flips the source but 409s the resend). **NOT verified:** live subscription-limit → api-key fallback with a real account
      (resume-across-sources is attempted via the existing unconditional `resume: sdkSessionId` path
      but whether the SDK/API honors it across DIFFERENT credentials is unverified without a live
      account); both-theme/keyboard walk of the banner + expiry badge; container-restart-mid-thread
      resume (owner-acceptance, see below).

## Refinement R1 — page-scope lock · skill-structure awareness · live edits (owner, 2026-07-10)
Decisions **D-AS19–D-AS23**; plan [`refinement-01-scope-structure-live-edits.md`](./refinement-01-scope-structure-live-edits.md).
No migration (scope derived · workspace events transient · live read off disk). Waves:
**A** `R1.1` → **B** `R1.2 ∥ R1.3` → **C** `R1.4 ∥ R1.5` → **D** review+gate.
- [x] R1.1 — scope model + `SCOPE_WRITE_TOOLS` + per-message `canUseTool` hard-lock + envelope/system-prompt
      reworded as an instruction + entity-pin reconciliation — done 2026-07-11 · wp/assistant/R1.1
      (29f5d36; merged 003907b; review-fixes 71915ad). Pure/SDK-free `packages/shared/src/assistant-scope.ts`
      (`AssistantScope`, `SCOPE_WRITE_TOOLS`, `WRITE_TOOL_TARGETS`, `deriveAssistantScope`, `isWriteToolInScope`,
      `describeScopeDenial`, `INTENTIONALLY_UNSCOPED_WRITE_TOOLS`). `handlePermission` derives scope from the
      CURRENT envelope + HARD-denies out-of-scope/id-mismatched/unscoped writes BEFORE the auto-accept + owner
      branch (model-visible reason; `permission_request`+`permission_decision{deny}` audit trail; **no new event
      type, no migration — schema v21**). Envelope + system prompt reworded hint→instruction. Native
      `Edit/Write/MultiEdit` exempted (workspace edit mechanism; SDK-confined, reachable only via scope-gated
      open/commit). Web `assistant-context.tsx` documents the 9-kind↔scope↔derivable-pin map; **scenario/test
      pins NOT URL-derivable today** (deferred, no invented routes), compare inherently unscoped (read-only).
      **Opus reviews (per-wave + Wave D): scope lock HOLDS — adversarially proven no out-of-scope/id-mismatch/
      unscoped write passes `canUseTool`.** Review fix applied: `suite_run` made read-only (a run page could
      `suites_delete`/silently `suites_update` ANY suite; `suites_*` now `INTENTIONALLY_UNSCOPED` until a `suite`
      entity kind exists — a D-AS7 change) + native-name-collision guard + out-of-scope delete-class wired test.
      Tests +~34 API / +4 web. **NOT verified:** no live-token/real-agent path (scripted-fake driver only).
- [x] R1.2 — skill-scope context (file tree + rendered SKILL.md + "read all before editing") + bundled read-only
      skill-authoring reference + `additionalDirectories` in skill scope — done 2026-07-11 · wp/assistant/R1.2
      (16a9c72; merged 28de85f; Wave-B fix 2620c1a). `startSession` adds the ref dir to `additionalDirectories`
      only on skill scope; `renderSkillContext` injects a size-capped `<skill-context>` block on skill scope
      (tree ≤200, SKILL.md ≤20k, truncation markers; degrades gracefully). Dockerfile copies
      `apps/api/resources/skill-authoring` as root before `USER node` → OS read-only for `node` (verified by a
      real docker build+run; dev-box-writable caveat). **⚠ D-AS21 FALLBACK: the real Anthropic skill-creator was
      NOT vendorable offline here — a DISTILLED best-practices reference shipped instead (flagged in-file for the
      owner to swap).** Wave-B review fix: `renderSkillContext` no longer claims the unmounted
      `docs/skill-authoring.md` is readable (points at the reachable bundled ref + inlines the rule↔anchor
      expectation). Path via `packageRoot`; `ASSISTANT_SKILL_AUTHORING_DIR` override. Tests +14 API. No migration.
      **NOT verified:** no live-token path; api-only.
- [x] R1.3 — transient `workspace_opened/_file_changed/_committed` frames (pump detects native Edit/Write/MultiEdit
      under the workspace root) + `GET …/threads/:id/workspace/:skillId/{files,file}` live read — done 2026-07-11 ·
      wp/assistant/R1.3 (3e5a940; merged 0abb741). Frames TRANSIENT (no `seq`, NOT persisted, NOT in
      `ASSISTANT_EVENT_TYPES` → **no migration**), fanned via `fanWorkspaceFrame` (like `fanDelta`); the dock
      reducer ignores them. Native-write path correlated via `LiveSession.pendingNativeWrites`
      (`existedBefore`→created/modified); a write outside the workspace root or a failed write emits nothing. New
      `readWorkspaceFile` (path-traversal + symlink-escape guarded; 404 unknown-thread, 400 no-open-workspace;
      skill files only, no DB/secret). Tests +21 API (+1 web). **NOT verified:** frames proven via the
      scripted-fake driver, not a real SDK Edit.
- [x] R1.4 — live Files view: working-copy mode, diff-vs-base, debounced auto-navigate, rebase on commit —
      done 2026-07-11 · wp/assistant/R1.4 (fa39106; merged 141fd4d). `assistant-context.tsx` exposes
      `activeAssistantThreadId`; new `use-live-skill-workspace.ts` (pure `reduceLiveWorkspaceFrame` + hook:
      GET-check for late subscribers, own SSE subscription, debounced refetch + `autoOpenNonce`);
      `LiveSkillWorkspaceView.tsx` (brand-ui `Tree` + `@elabs-ai/components-editor` DiffEditor); `SkillInspector.tsx` writes
      `?tab=files&file=…` + rebases via `handleDesignSaved` on commit. Real both-theme visual check (live mode
      via mocked endpoints — a real agent edit needs a token). Tests +23 web. No migration/dep/wire change.
      **NOT verified:** live agent-driven edit end-to-end. **➜ see S2 + N1/N2 in R1 follow-ups below.**
- [x] R1.5 — dock **Scope chip** from the envelope + re-scope on navigation — done 2026-07-11 · wp/assistant/R1.5
      (8a4365d; merged f4ec310). Pure `assistant-scope-chip.ts` (`scopeChipCopy` over `deriveAssistantScope`;
      scenario→"Environment"); `@elabs-ai/components-ui` Badge on its own dock-header row (moved there after a visual check
      caught it crushing the switcher). Scoped→"Scope: <Kind> <id>", unscoped→"Read-only — open an entity to
      enable edits". Real both-theme visual check. Tests +16 web. **➜ see S1 in R1 follow-ups below.**
- [x] R1 review — **opus Wave D holistic security review** — done 2026-07-11. **Scope lock HOLDS** (adversarially
      proven against the merged code, incl. after R2's `session-manager.ts` rework: no out-of-scope/id-mismatched/
      unscoped write passes `canUseTool`; native exemption exact-set + non-abusable; `suite_run` read-only; the
      R2-release vs R1.3-frame ordering is safe by construction). No migration; no secret leak; runtime boundary
      intact; transient frames never persisted; contract-first. **SHIP-WITH-FIXES** — 2 owner-prioritized
      should-fixes (S1, S2) + accept/defer follow-ups below; nothing blocks. Full gate green: **API 1294 pass**,
      web pass, build + lint clean.

### R1 Owner-acceptance (needs a live Claude token — owner's walk; R1 is on `ux/integration`, not merged to `main`)
- [ ] Skill page → "enhance this skill from recent runs" → reads runs but ONLY edits the skill; an attempt to
      touch the environment is denied with a visible reason (Rule 1 / D-AS19).
- [ ] The assistant reads `references/*` before editing and follows the bundled skill-authoring reference
      (Rule 2 / D-AS20/D-AS21).
- [ ] Edits appear LIVE in the Files view with the UI auto-navigating to each changed file; review the
      accumulated diff, approve the single `skills_commit_workspace` → new version (Rule 3 / D-AS22). Both themes + keyboard.
- [ ] The dock Scope chip reads correctly as you navigate (D-AS23), both themes + keyboard.

### R1 open follow-ups (owner to prioritize/accept — none block; the scope lock is verified sound)
- **S1 (owner-gated, D-AS23):** the Scope chip shows "Scope: Run/Scan/Suite-run <id>" on read-only pages where
  `SCOPE_WRITE_TOOLS[kind]` is EMPTY (no write reachable) — R1.5 implemented D-AS23 literally. Consider showing the
  read-only copy where the writable set is empty (1-line change; deviates from D-AS23's letter → your call).
- **S2:** R1.4's live mirror can silently replace the owner's unsaved local Files-explorer edits (SkillFileExplorer
  doesn't expose dirty state today). Gate the live-mode swap behind a discard-confirm/toast.
- **skill-creator vendoring (D-AS21 partial):** R1.2 shipped a DISTILLED fallback (real Anthropic skill-creator not
  vendorable offline here) — swap in the real one when available. `docs/skill-authoring.md` is named but not mounted;
  bundle it into `resources/skill-authoring/` (+ a byte-equal drift-guard test) if you want the agent to read it.
- **R1.1 finding 2 (reversible, live today):** `collections_modify` `remove_test`/`remove_suite` under `collection`
  scope aren't id-matched → can re-home a child of ANOTHER collection (membership only, no data loss). Fix = a DB
  ownership check.
- **R1.1 finding 3 (LATENT — unreachable today):** `scenario`/`test` child-tool writes aren't id-matched; no URL
  yields a `scenario`/`test` pin, so unreachable now. MUST be closed (DB ownership check) BEFORE scenario/test pins land.
- **R1.4 minor (N1/N2, accept/defer):** `baseVersionId` late-subscribe can be stale; two SSE subscriptions per
  thread when dock+skill page are both open.

## Refinement R2 — per-entity threads · release-on-reply · thread names/dates (owner, 2026-07-11)
Decisions **D-AS24–D-AS26**; plan [`refinement-02-session-management.md`](./refinement-02-session-management.md).
No migration. Waves: **A** `R2.1 ∥ R2.2` → **B** review+gate. Independent of R1 (coordinate at merge
if both in flight — both touch the dock / entity pins).
- [x] R2.1 — entity-scoped switcher + names/dates in the dock — done 2026-07-11 · wp/assistant/R2.1
      (1aa8e29; merged b574355). Create-**pinned**-to-entity in both `handleNewThread` and the lazy
      send-create; `refreshThreads` fetches the current entity's threads server-filtered
      (`listAssistantThreads({kind,id})`) with a **"Show all threads"** toggle — the client-side
      pinned/recent split is gone (the server filter IS the list). Title + **relative date**
      (`formatRelativeTime`, new pure `lib/format.ts`, `tabular-nums`) in the header trigger + rows;
      inline **rename** (Pencil → `Input`; Enter/blur commits `updateAssistantThread({title})`,
      Escape/empty cancels client-side); **refresh-after-turn** (awaiting→settled) surfaces R2.2's
      refined title + fresh ordering. **Correctness fix:** the active thread is tracked in its own state
      (`activeThreadObj`) so the header keeps rendering it when it isn't in the current filtered list
      (the conversation follows you across pages). No `shared`/`api` change (client fns already existed);
      no migration/dep. Tests +18 web (dock 13→24, +7 `formatRelativeTime`). **NOT verified:** live dock /
      both-theme visuals (owner-acceptance).
- [x] R2.2 — release-on-reply lifecycle + auto-titling — done 2026-07-11 · wp/assistant/R2.2
      (7a03398; merged 43975ac). `onTurnComplete`→`scheduleRelease`→`park()` behind
      `ASSISTANT_RELEASE_GRACE_MS` (default **0**: synchronous park at grace 0 — re-entrancy-safe via
      `teardownLive`'s identity guard; release-timer + idle backstop at grace>0) — the cap slot frees the
      moment a turn ends. **Wedge closed:** `limit_error`/`error` pump paths reset `turnInFlight` +
      `scheduleRelease` (idempotent), so nothing stays `running` holding a slot even without a trailing
      `turn_done`; `stop` still parks; resume unchanged (`resume: sdkSessionId`); the SSE channel survives
      park/resume. **Auto-titling:** deterministic slug (pure `auto-title.ts`) on the first user message
      (guards: title still default AND no prior `user_message` — rename-safe); best-effort LLM refine
      after the first **successful** turn — a bounded one-shot on `ASSISTANT_TITLE_MODEL`
      (`claude-haiku-4-5`), **never in `live` / never cap-counted**, hard-timeout
      (`ASSISTANT_TITLE_TIMEOUT_MS` 15s) + silent fallback, fire-and-forget so it never delays the
      reply/release; `updated_at` touched on send. Shared consts + `env`
      (`ASSISTANT_RELEASE_GRACE_MS`/`_AUTO_TITLE`/`_TITLE_MODEL`/`_TITLE_TIMEOUT_MS`) + `.env.example` +
      `index.ts` wiring; **no migration (v21), no new dep. `ASSISTANT_AUTO_TITLE` default ON** (owner may
      disable — see Owner-acceptance). Tests +26 API (12 pure slug + 14 lifecycle/titling; scripted fake
      driver, fully offline). **NOT verified:** real `query()`/child/Anthropic call — real resume-context
      reload + real LLM title generation (owner-acceptance).
- [x] R2 review — **opus**, 2026-07-11 · **SHIP-WITH-NITS** (no blockers). Independently confirmed: no
      session stays `running` holding a cap slot after ANY terminal path (turn_done/limit/error/stop/park/
      detach/clean-end); grace-0 sync park is re-entrancy-safe; resume-after-release keeps `sdkSessionId`
      (and the title one-shot's `session` event is consumed by the one-shot, NOT the pump, so it can't
      clobber the thread's resumable id); the one-shot is never in `live`/never cap-counted/leak-free; SSE
      survives park/resume; entity scoping is server-side with no client leakage; **merge integrity intact**
      (both auto-merged test harnesses carry all 4 R2 config fields AND R1.1-review's scope-lock hardening).
      **2 nits fixed by the orchestrator before tick** (b064300): (a) the title one-shot now carries an
      explicit **deny-all `canUseTool`** (D-AS17 defense-in-depth — no tool can ever run in it, not merely
      the SDK default for the deliberately-allowed native file tools); (b) corrected an inline-rename
      comment (the PATCH schema `min(1)` rejects an empty title, it does not coerce). 2 low-severity notes
      logged below. **Full gate GREEN on `ux/integration` @ b064300** (R2 + the parallel R1.2/R1.3 merges +
      the fix): typecheck clean · **API 1176→1239** · **web 583→602 (+5 skipped)** · build · Biome lint
      (656 files). Merge SHAs: R2.1 b574355 · R2.2 43975ac · fix b064300.

## Refinement R3 — session starters (per-entity suggested prompts) (owner, 2026-07-11)
Decisions **D-AS27–D-AS29**; plan [`refinement-03-session-starters.md`](./refinement-03-session-starters.md)
(the authored catalog lives there). No migration. Curated + data-aware (no LLM) · click prefills
(never sends) · analysis + scope-respecting actions. Waves: **A** `R3.1` → **B** `R3.2` + review.
- [x] R3.1 — shared session-starter catalog + data-aware `GET /api/assistant/starters` — done
      2026-07-11 · wp/assistant/R3.1 (fe007c8). New `packages/shared/src/assistant-starters.ts`
      (`AssistantStarter{id,label,prompt,kind,writeTool?}`; `AssistantStarterSurface = "global" |
      "compatibility" | AssistantEntityKind`; a base catalog for all 11 surfaces + `SKILL_TAB_STARTERS`
      + an `ASSISTANT_CONDITIONAL_STARTERS` registry + the pure `resolveStarterSurface`;
      `ASSISTANT_STARTERS_VERSION=1`); `assistantStartersQuerySchema`; `apps/api/src/assistant/starters.ts`
      `deriveStarters` (modeled on `deriveNextSteps` — resolve surface → prepend fired conditionals +
      skill-tab overrides → append base → **runtime scope-filter** every action starter against
      `SCOPE_WRITE_TOOLS`); additive thin `GET /api/assistant/starters` wired via
      `AssistantRouteDeps.starters`. Deterministic, read-only — **no LLM / no migration / no new dep**.
      **Deviation (sound):** the endpoint takes an additive `route` param (on top of the plan's
      `?entityKind&entityId&tab`) so the route-only surfaces `compare`/`compatibility` (which publish no
      entity pin today) resolve without a fabricated pin — a pinned `entityKind` wins over `route`;
      `/testing/environments` (scenario) + `test` are deliberately NOT mapped (no URL pin → deferred +
      recorded, see R3.2 note). 6 of 7 conditionals implemented (global failed-scan count + low run
      pass-rate [≤0.5 over the last 20 runs, min 5 terminal]; server/scan last-scan-failed; skill
      L2-over-budget; run failed/context_overflow/assertions_failed; suite_run low pass-rate); the skill
      `[?quality score low]` conditional is **SKIPPED** — `analyzeSkillQuality` needs an async L1/L2
      recount (not a cheap per-request read); its starter is authored + scope-checked in the registry but
      never emitted until a cheap quality cache exists. Additive `RunFilter.limit` (SQL `LIMIT`) added so
      the global pass-rate read is bounded. **Opus-orchestrated sonnet review = FIX-FIRST → all fixed:**
      the conditional-starter registry closes the D-AS29 cross-check gap (base + tab + conditional action
      starters are all scope-checked; a future one is auto-covered); the runtime scope-filter is
      **mutation-proven** (a test-only injected-catalog seam feeds a crafted out-of-scope action →
      asserted stripped; neutering the filter fails the suite); the two hot-path global reads are now cheap
      (`listSummariesByServer[0].status` not `getDetail`; bounded `listRuns({limit})`). Gate green on
      merged `ux/integration`: **API 1178→1291** (whole branch, incl. the concurrently-landed R1/R2),
      typecheck/build/lint clean. **NOT verified:** no live Claude token (pure shared+API); chip rendering
      + both-theme visuals are R3.2.
- [x] R3.2 — dock empty-state **starter chips** in `PendingPanel` — done 2026-07-11 · wp/assistant/R3.2
      (f0c94dc). `getAssistantStarters(envelope)` (`apps/web/src/lib/api.ts`) + `use-assistant-starters.ts`
      (keyed on the envelope PRIMITIVES, `active`-flag cleanup, fetch errors swallowed → `[]`) →
      `PendingPanel` renders the returned starters as `@elabs-ai/components-ai` `Suggestions`/`Suggestion` chips (props
      verified vs the vendored `.d.ts` — a token-driven `Button`); click → `openAssistant({prompt:
      starter.prompt, entity})` — **prefill only, never sends** (entity = the current envelope's `{kind,id}`
      only when BOTH are pinned, else undefined; the full `prompt` is passed, not the short `label`).
      Graceful fallback to today's plain empty state on loading / error / zero-starters (no error slot in
      the empty state). Refetches on entity/tab/route change. Folded all 7 `*-analyze.ts` builders to source
      wording from the shared catalog (`getBaseStarter` lookup + the named conditional exports) — each
      builder's signature + returned `entity` unchanged; `run-analyze` keeps its `{label,request}` +
      failed-phase variant. **Two intent-preserving divergences** kept OUT of the action catalog as plain
      shared string-builders (so they can't emit an out-of-scope action): `skill-analyze` stays
      analysis-only (NOT the catalog's `skills_commit_workspace` action "Improve from recent runs"), and
      `compare-analyze` keeps its full run-id list — both byte-identical to the pre-fold wording; all
      affected `*-analyze.test.ts` updated in lockstep. **web +10 tests** (chip render · click
      prefills-not-sends · loading/error/zero fallback · refetch-on-nav · `api.test.ts` query building).
      Rebased onto the concurrently-advanced base (R1.4/R1.5/auto-rating landed mid-wave); resolved one
      additive `AssistantDock.test.tsx` conflict so the R1.5 scope-chip block + the R3.2 chip block coexist.
      **NOT verified:** live dock with a real Claude token; both-theme visual shots (owner-acceptance).
- [x] R3 review — done 2026-07-11 (Opus-orchestrated sonnet). **Verdict: SHIP** — no out-of-scope write can
      be suggested: the R3.1 catalog cross-check + the FIX-2 mutation-proof runtime-filter test pass 51/51
      on the R3.2 tip, and the two new folding builders return plain strings (never `AssistantStarter`s) and
      are absent from the catalog/registry. Prefill-never-send, the fetch hook (primitive-keying + `active`
      cleanup + error-swallow), and the graceful fallback are confirmed + test-covered; chips are the real
      `@elabs-ai/components-ai` `Suggestion`/`Suggestions`; the fold preserves every button's intent. Gate green on merged
      `ux/integration`: **API 1178→1306 · web 651 passed + 5 skipped · build · lint** (whole branch, incl.
      the concurrently-landed R1.2–R1.5 / R2 / auto-rating). One NIT logged in Open follow-ups. **Both-theme
      visual shots remain owner-acceptance** (see R3 Owner-acceptance below).

### R3 Owner-acceptance (needs the owner: live sign-in + both-theme/keyboard walk)
- [ ] Open a new thread on a **server / scan / skill / run / suite-run / compare / collection /
      compatibility** page → the empty state shows relevant starter chips; a **failed scan / failed run /
      L2-over-budget skill / low suite pass-rate** surfaces its **data-aware** starter; the unpinned
      dashboard shows the cross-cutting `global` starters.
- [ ] Clicking a starter **prefills** the composer (you press send) — it never auto-sends. Action starters
      (server "Adjust config", skill edits, collection "Organize") appear only on their in-scope page and
      go through the normal approval; read-only surfaces (run/scan/compare/compatibility) show analysis
      starters only.
- [ ] Both themes (`light` + `dark`) + keyboard: the chip row reads correctly and is
      reachable/focusable in the dock empty state.
- [ ] (Deferred + recorded, NOT a defect) **Environment/Test** starters are authored but NOT emitted until
      `/testing/environments` publishes a `scenario`/`test` URL pin (coordinate with the R1.1 pin work);
      **skill tab** variants are authored but dormant until the skill page emits `?tab=` (it uses `?mode=`
      today); the skill **`[?quality score low]`** conditional is authored + scope-checked but not emitted
      until a cheap quality-score cache exists (`analyzeSkillQuality` isn't a cheap per-request read).

## Refinement R4 — MCP invocation · cross-entity issue filing · fresh session on open (owner, 2026-07-14)
Decisions **D-AS30–D-AS33** (see [`decisions.md`](./decisions.md)). No migration (`rating_issues.bucket`/
`fix_target` are plain TEXT; the occurrence `category` column is TEXT — only the shared **type** widens with
`manual`). Owner "narrow exemption" + "always start fresh on expand" + "ask per MCP call" choices.
- [x] R4 — three fixes, built + gate-green — done 2026-07-14.
      **(1) MCP invocation:** new `ScanService.listTools(serverId)` (live `tools/list`, reuses the existing
      auth-provider path) + a new tool module `apps/api/src/assistant/tools/action-tools.ts` exposing
      `mcp_tools_list` (read) + `mcp_tool_call` (gated) — both delegate to the app's in-process bridge
      (`ScanService`), so secrets stay in `apps/api` and each call's request/response token & byte cost is
      measured. **(2) Issue filing:** `rating_issues_list` (read) + `rating_issue_file` (gated) reuse the
      Rating Issues registry via a new `fileManualRatingIssue` helper (`grading/issue-service.ts`) —
      requires the analyzed `runId`, resolves target name + pins the run's skill version, light-dedups by
      (target, normalized title), occurrences carry `category:"manual"`. **(3) Scope-exemption:**
      `SCOPE_EXEMPT_ACTION_TOOLS` (`packages/shared/src/assistant-scope.ts`) + an `isScopeExemptActionTool`
      bypass in `handlePermission` — the two action tools are reachable from any page (still approval-gated);
      entity-config writes stay scope-locked. **(4) Fresh session on expand:** a plain dock expand
      (toggle/⌘J) opens BLANK via a one-shot `consumeFreshSessionOpen` flag (`assistant-context.tsx` →
      `AssistantDock.tsx`); a page reload / page-hook open still auto-selects/pins. System prompt updated
      (scope paragraph + capability note). **(5) Auto-accept ("write mode") toggle fix** (owner-reported
      "Could not change auto-accept / Not found"): the create schema/`createThread` now honor an optional
      `autoAccept` (it was silently dropped on create), and `handleToggleAutoAccept` handles a stale-thread
      **404 gracefully** by (re)creating a thread carrying the chosen write mode — mirroring the existing
      `handleModelChange` 404 path — instead of dead-ending on an error toast. **Gate green:** typecheck ·
      **API 1813** (+ new `action-tools.test.ts`, scope/classifier/permission, `createThread` autoAccept) ·
      **web 947** (+ dock fresh-session + auto-accept-404 + context `consumeFreshSessionOpen` tests) · build ·
      lint. API **boot-smoke** verified (fresh DB migrates, new deps wire up, `/api/health` +
      `/api/assistant/{models,auth/status}` respond, no startup error).
      **NOT verified (needs the owner's Claude sign-in):** the agent actually invoking a registered MCP
      server tool + filing an issue live; the browser dock's fresh-on-open UX + both-theme walk.

### R4 Owner-acceptance (needs the owner: live sign-in + both-theme/keyboard walk)
- [ ] On a run page, ask the assistant to **list a registered server's tools** (`mcp_tools_list`) and
      **call one** (`mcp_tool_call`) — the approval card shows server + tool + arguments; the result + token
      cost render; toggling per-thread auto-accept lets a follow-up call run without a prompt.
- [ ] From the same run, ask it to **file an issue against the skill the run used** (`rating_issue_file`) —
      approval, then the issue appears on the skill's Issues (`GET /api/skills/:id/issues`) and the export;
      re-filing the same title adds a sighting rather than a duplicate.
- [ ] **Opening the dock starts a blank session** each time (toggle/⌘J); the previous threads are still
      listed in the switcher; a page-hook "Analyze…" open still lands on its pinned thread.
- [ ] Both themes + keyboard walk of the new approval cards / results in the dock.

## Parked workstreams (owner-gated; not scheduled)
- **Real Claude account identity via our own OAuth exchange (parked 2026-07-28):** the UI cannot show
  *which* Claude account the stored subscription token belongs to — Anthropic scopes `setup-token`
  credentials to **inference only** (`/api/oauth/profile`, `/api/oauth/claude_cli/roles` and
  `/api/oauth/validate` all 403 with the live token; the token is opaque, the CLI prints no account and
  persists none). Surfacing it means running the OAuth exchange ourselves with a `user:profile` scope,
  which swaps the long-lived token for an access+refresh pair and changes every consumer
  (`spawn-env.ts`, `resolveJudgeAuth`, `providers/subscription-auth.ts`, the roster probe). Full
  evidence + the two build options: [`wp-oauth-identity.md`](./wp-oauth-identity.md). **Shipped instead
  (2026-07-28):** the shared `ClaudeSubscriptionAuthPanel` states the constraint in-place, reports what
  is genuinely known (signed-in state, token age, stored-on date, expiry warning), and adds a
  confirm-gated **Reset token** action + switch-account guidance to *both* Settings → Assistant and the
  Providers credential modal; per-credential provider settings moved into a `FormDialog`.

## Open follow-ups (non-blocking; reviewer nits carried forward)
- **`getBaseStarter` throw-path (R3.2 review NIT):** the "unknown starter id" guard in
  `packages/shared/src/assistant-starters.ts` has no direct unit test — implicitly covered (a bad id fails
  every `*-analyze.test.ts` that calls it). Add a one-liner if the file is touched again.
- **Insert-as-context entry points (WP 3.2):** `insert-as-context.ts` helpers exist + are unit-tested but
  the 2 UI row-actions (compare drill drawer, scan tool table) aren't wired. Wire them or drop the helpers.
- **`servers_update_config` description (WP 2.3 nit):** note that switching `transport` drops the other
  transport's stored auth/headers (matches canonical repo behavior; approval-gated — a description-only tweak).
- **Test typecheck gap (pre-existing repo trait):** `apps/api/tsconfig.json` excludes `test/`, so test
  type-drift isn't gate-caught (tests still run green via tsx). Not an Assistant defect; noted for awareness.
- **Resume-across-sources (WP 3.3 finding):** `retrySource` attempts the SAME unconditional
  `resume: sdkSessionId` path every other session start uses — the SDK's `Options.resume` doc has no
  auth/credential binding in its type contract, but whether the live API actually honors a resume whose
  earlier turns were authenticated under a DIFFERENT credential (subscription org vs. api-key account) is
  unverified without a live account. If it turns out not to work, the failure is loud (a fresh
  `error`/`limit_error` on the resumed turn), never silent — carried to owner-acceptance below.
- **`retrySource` edge cases (WP 3.3 final-review nits, low severity, no spend/security impact):** the
  re-send persists the last `user_message` a second time (if resume-across-sources ever works, the model
  would see it twice — resumed history + new send); and a retry that arrives while the active-session cap
  is full flips `authSource` + records `source_switch` but 409s the re-send (a second banner click then
  400s "already on api_key", forcing a manual re-type). Both are rare and loud, not silent.
- **`source_switch` has no dedicated timeline chip (WP 3.3, deliberate scope cut):** the event persists +
  replays (audit trail intact) but the dock doesn't render a distinct "Switched to API key" marker in the
  transcript — the auth-source badge update + the new user turn already give visible feedback. Low-value
  polish if picked up later.
- **R2 title-refine skips a first turn that errored (deliberate):** the LLM refine fires only on the FIRST
  *successful* turn (`isFirstCompletedTurn` = `turn_done` count == 1, gated on `!errored`); a thread whose
  first turn errored keeps the deterministic title only. Acceptable for a best-effort feature.
- **R2 redundant `turn_done` on a failed SDK result (cosmetic, R2 review note):** a failed `result` maps
  to `[error, turn_done]`; with grace 0 the `error` handler releases, then the buffered `turn_done` is
  still appended (harmless — status stays `error`, no refine, `park` no-ops). Log-only redundancy; no
  cap/leak impact (verified it can't re-park a replacement session).
- **Clean stream-end with no `turn_done` leaves DB `status = "running"` (pre-existing, surfaced in R2
  review — NOT an R2 regression):** the pump's `catch` only sets `error` on a non-abort drop, so a clean
  iterator return with `turnInFlight` still true skips it. The **cap slot is still freed**
  (`teardownLive`); only a stale cosmetic status that self-heals on the next message. Not reachable via the
  real driver (every turn ends in `result`→`turn_done`).

## Owner-acceptance (needs the owner: subscription sign-in, live walks)
- [ ] Live in-app sign-in (PTY flow) with the real Max/Pro account; paste fallback verified.
      **(2026-07-10 owner run: the "Sign in with Claude" button 502'd `ASSISTANT_AUTH_PARSE_FAILED` in the
      Docker image — root-caused to a real bug in `resolveClaudeBinary()`: it resolved the SDK's bundled
      platform CLI from the API's module scope, which under pnpm's nested layout is `MODULE_NOT_FOUND`, so
      it fell back to a bare `claude` on PATH the image doesn't have. FIXED — now resolves from the SDK's
      own scope + prefers the glibc variant; the bundled `claude` (2.1.206) is present + executable in the
      image. **Requires `docker compose up --build` to take effect.** Paste path is the unaffected
      always-works fallback.)** **(2026-07-10 second fix: after the resolver fix the CLI spawned but
      claude.ai returned "Missing redirect_uri" — the PTY was `cols: 120`, so the CLI's TUI hard-wrapped the
      ~350-char authorize URL and `parseAuthUrl`'s `\S+` captured only up to the wrap [mid-`redirect_uri`].
      FIXED — `cols: 1000`. Verified in the container via node-pty A/B: 120 → truncated URL, 1000 → the full
      346-char URL with `redirect_uri` + `state`. Also needs `docker compose up --build`. Remaining owner
      step: complete the round-trip [authorize in browser → paste code → token captured] with the real
      account + container egress to claude.com/claude.ai.)**
- [ ] Canonical flow 1: run-console failure triage on a real failed run.
- [ ] Canonical flow 2: skill page → analyze recent runs → agent edits skill → approve → new
      version visible with correct diff.
- [ ] Subscription limit hit → explicit "Retry on API key" action on the dock's limit-error banner
      (WP 3.3) — confirm it actually retries (no silent spend on the wrong source) and that the
      resumed conversation carries over (or, if resume-across-sources turns out unsupported, that the
      failure surfaces loudly rather than silently dropping the retry).
- [ ] Both themes + keyboard walk of: the dock generally; the Settings → Assistant card (sign-in flow,
      paste field, fallback picker, sign-out confirm); the Settings → Storage & maintenance card's new
      "Prune assistant threads" row; and specifically the WP 3.3 additions — the limit-error banner
      (retry button / Settings-link fallback / re-sign-in hint) and the dock header's "Expiring soon"
      token-expiry badge.
- [ ] Container restart mid-thread → thread resumes (orphan reconciliation to `idle` + a synthesized
      error event on restart is unit-tested; a REAL Docker restart with a live child was not exercised).

### Refinement R2 (per-entity threads · release-on-reply · thread names/dates)
- [ ] On an MCP server (or skill/scan/run/etc.) page, the dock switcher shows **only that entity's**
      threads; "+ New thread" there is **pinned** to it; "Show all threads" reveals the global list.
- [ ] Rapidly using several threads no longer triggers "too many sessions" — after each reply the session
      **releases** and the next message **resumes** the same conversation. (Real cross-session context
      reload needs a live token; the offline tests prove the `resume: sdkSessionId` wiring only.)
- [ ] New threads get a meaningful **name** (message-derived immediately; upgraded to a crisp LLM title
      after the first reply when `ASSISTANT_AUTO_TITLE` is on — a real, small spend on the thread's auth
      source) and show a **relative date**; inline **rename** works. Both themes + keyboard.
- [ ] Decide `ASSISTANT_AUTO_TITLE` default: shipped **ON** (D-AS26's intended behavior; a bounded one-shot
      on `claude-haiku-4-5` with a silent deterministic fallback). Set `ASSISTANT_AUTO_TITLE=false` to run
      the deterministic title only (no extra spend).
