# Assistant — Refinement R2: per-entity threads · release-on-reply · thread names & dates

> Owner-driven refinement (2026-07-11) after real use of the shipped assistant. Three session/thread
> issues. Locked decisions **D-AS24–D-AS26** in [`decisions.md`](./decisions.md); ledger section
> **Refinement R2** in [`STATUS.md`](./STATUS.md). Execution model = [`execution-plan.md`](./execution-plan.md)
> (Opus 4.8 orchestrator · parallel worktree subagents · gate = `pnpm typecheck && pnpm test &&
> pnpm build && pnpm lint`). Integration base **`ux/integration`**. **No migration** (schema stays
> v21 — `title`, `createdAt`, `updatedAt`, `entityKind/entityId` all already exist). Can run
> independently of R1, or after it on the same branch.

## The three issues (owner)
1. **Threads aren't scoped to the page.** I see every thread regardless of which entity I'm on. On an
   MCP server page, "threads" should list only that server's threads.
2. **"Too many sessions are running."** A session should stop when the answer is replied; a new prompt
   should resume it — sessions can't run endlessly.
3. **Threads have no name.** Everything says "New thread". A thread needs a name and a date so I know
   what it was about and how old it is.

## Root causes (grounded in the shipped code)
- **Issue 1.** New threads are created **unpinned** — the dock calls `createAssistantThread({})`
  (`AssistantDock.tsx` handlers ~237/323), so no `entityKind/entityId` is ever set; and the switcher
  loads the **global** list (`refreshThreads` → `listAssistantThreads()` **no arg**, ~136-144) and
  only derives a "Pinned" subset client-side. The server-side entity filter is **fully built and
  correct** (`repository.listThreads` WHERE `entity_kind`/`entity_id`, `repository.ts:100-119`;
  route `?entity=kind:id`, `routes.ts:288-301`; api client `listAssistantThreads(entity)`,
  `api.ts:394-402`) — just unused by the switcher's display.
- **Issue 2.** `onTurnComplete` (`session-manager.ts:643-648`) **arms a 10-min idle timer** instead
  of releasing; the session stays in the `live` map (holding a cap slot) until it idles out. The cap
  is `this.live.size >= maxActiveSessions` (default **2**, `sendMessage` ~327-332). `park()`
  (`703-714`) already does exactly the right release — kills the child, removes it from `live` (frees
  the slot), **keeps `sdkSessionId`** — and resume is wired (`startSession` `resume: sdkSessionId`,
  ~530). It's simply triggered 10 minutes too late.
- **Issue 3.** `title` is hard-defaulted `"New thread"` (`repository.ts:85`) and **never generated**;
  the dock creates with no title and renders `thread.title` only — **no date anywhere** in the
  feature (grep clean). A rename path already exists end-to-end (`assistantThreadUpdateSchema` title,
  PATCH route, `updateAssistantThread`) but the dock only ever PATCHes `{model}`/`{autoAccept}`.

## Design (what changes)

### D-AS24 — Threads are entity-scoped
- **Create pinned.** When a thread is created while the dock has a current entity (from
  `currentEnvelope`), pass that entity to `createAssistantThread({entity})` so it's pinned. (The
  create schema already accepts an entity pin — a pair.)
- **Switcher shows the current entity's threads.** On an entity page, `refreshThreads` fetches
  `listAssistantThreads(currentEntity)` (server-filtered, already `ORDER BY updated_at DESC`) as the
  primary list; a small **"All threads"** toggle/link fetches the global list when needed. On a
  non-entity/global page, it shows all. Drop the client-side "Pinned" derivation in favor of the
  server filter.

### D-AS25 — Release the session on reply; resume on the next message
- **Release at turn completion.** In `onTurnComplete` (the single choke point), **`park()` the
  session as soon as the turn finishes** instead of arming the 10-min timer — kills the child, frees
  the cap slot, keeps `sdkSessionId`. A small **configurable grace** `ASSISTANT_RELEASE_GRACE_MS`
  (default **0**; a few seconds keeps warm for instant follow-ups) sits in front of `park()`; the
  existing idle timeout stays as a backstop for the grace window. Effect: normally **≤1 active
  session**, so the cap 409 essentially disappears.
- **Resume unchanged.** The next `sendMessage` finds no live session → `startSession` re-spawns with
  `resume: sdkSessionId` (small spin-up). The SSE stream is thread-level (not session-level), so it
  stays connected across park/resume.
- **Robustness (close the wedge the map flagged).** Ensure the `limit_error`/`error` pump paths also
  converge to a release (reset `turnInFlight`, release/backstop) so a turn can never leave a session
  `running` forever holding a slot; keep the friendlier cap message. `stop` still parks.

### D-AS26 — Thread names + dates (auto-title now, LLM-refined after the first reply)
- **Immediate deterministic title.** On the **first** user message (`sendMessage`, when the thread has
  no prior user_message / still default title), set `title` from the message text (trimmed, collapsed
  whitespace, ~≤60 chars, sentence-ish) via the existing `repository.updateThread`. Free, instant.
- **LLM-refined title after the first turn.** After the first turn completes, a **best-effort,
  bounded, feature-flagged** one-shot title request (`ASSISTANT_AUTO_TITLE` on/off,
  `ASSISTANT_TITLE_MODEL` — a cheap model) summarizes the first user message + assistant reply into a
  crisp ≤6-word title and PATCHes it. It runs as a **separate short-lived query that is NOT registered
  in `live`** (never consumes a cap slot), with a hard timeout; **on any failure it silently keeps the
  deterministic title.** Never blocks the reply.
- **Render title + relative date.** The switcher rows and header render the title **and a relative
  timestamp** (e.g. "2h ago") from `updatedAt` (bump `updated_at` on send so ordering/age are fresh);
  add an inline **rename** affordance (PATCH `{title}` already works end-to-end). The switcher
  refreshes after a turn so the refined title appears.

## Work packages (waves · models)

**Wave A** (disjoint surfaces — web/dock vs api/session-manager)
- **R2.1 — entity-scoped switcher + names/dates in the dock** (`web` + api client; maybe promote the
  `AssistantThreadFilter` type to `shared`) · **sonnet**. Create-pinned-to-entity; switcher fetches
  the current entity's threads + "All threads" toggle; render title + relative date; inline rename;
  refresh-after-turn. Consumes titles the API provides (renders whatever's there — parallel-safe with
  R2.2). Tests: on an entity page the list is the server-filtered set; a new thread is pinned;
  title+date render; rename PATCHes.
- **R2.2 — release-on-reply lifecycle + auto-titling** (`api`/`session-manager` + `env` + shared
  consts) · **opus** (lifecycle races + cap correctness). `onTurnComplete` → `park()` (grace
  `ASSISTANT_RELEASE_GRACE_MS`, default 0); error/limit paths converge to release (no wedge holds a
  slot); deterministic title on first message; best-effort non-cap-counted LLM-refine after the first
  turn (`ASSISTANT_AUTO_TITLE`/`ASSISTANT_TITLE_MODEL`, hard-timeout, silent fallback); `updated_at`
  touched on send. Tests (offline, scripted driver): a finished turn releases the session + frees the
  cap slot immediately; the next message resumes via `resume: sdkSessionId`; two quick threads no
  longer 409; an errored turn never leaves a session holding a slot; the title helper never enters
  `live`/never counts toward the cap and falls back on failure.

**Wave B** — **opus review** (verify: no session can stay `running` and hold a slot after a turn;
resume-after-release preserves context; the title one-shot can't consume a cap slot or leak a child;
entity scoping shows exactly the current entity's threads) + full gate + refresh Owner-acceptance.

## Owner-acceptance (needs a live token)
- On an MCP server page, the switcher shows **only that server's** threads; "+ New thread" there is
  pinned to it; "All threads" reveals the global list.
- Rapidly using several threads no longer triggers "too many sessions"; after each reply the session
  releases and the next message resumes the same conversation.
- New threads get a meaningful **name** (message-derived immediately, upgraded to a crisp title after
  the first reply) and show a **relative date**; rename works. Both themes + keyboard.

## Non-goals / notes
- No migration; no new runtime dependency. LLM-refined titling is optional (feature-flagged) and
  best-effort — the deterministic title is the guaranteed floor.
- Release-on-reply trades a small per-message spin-up for never hitting the cap — the owner-accepted
  trade. `ASSISTANT_RELEASE_GRACE_MS` tunes it.
- If run independently of R1, R2.1 includes the minimal current-entity derivation it needs for the
  kinds it scopes (R1.1 reconciles pins more broadly — coordinate at merge if both are in flight).
