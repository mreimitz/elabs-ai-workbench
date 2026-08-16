# WP 1.2 — Dock write tools + HTTP CRUD accept `crewId` members

**Phase:** 1 — Author-time integrity · **Size:** M · **Depends on:** 1.1 · **Model:** Sonnet

## Objective

Wire the nested-crew authoring surface all the way through the two write paths operators and the
dock actually use — `hub_crew_create`/`hub_crew_update` (the Assistant Hub MCP write tools) and
`POST`/`PATCH /api/hub/crews` (the HTTP CRUD routes) — so a crew member can reference another crew
end-to-end, WP 1.1's repository cycle/exists/depth rejections surface as clean errors on **both**
paths, and every response (including `hub_crews_list`) actually echoes the new nested member counts
(D-CN5). This closes the authoring loop opened by 0.1 (wire) and 1.1 (repo validation + counts)
without adding any new validation logic of its own.

## Why / references

- **D-CN1** — nesting is deterministic saved-crew composition only; this WP is pure authoring
  plumbing, no execution-engine change.
- **D-CN4** — two-layer cycle/depth guard: this WP proves the *author-time* layer (built in 1.1)
  surfaces correctly through the dock tool path and the HTTP path, without re-implementing it.
- **D-CN5** — `crewId?` on `HubCrewMember` + `.superRefine`/`.strict()` (0.1); `memberCrewIds[]` +
  `memberAgentCount`/`memberCrewCount`/`totalAgentCount` on the crew summary (1.1). This WP's job is
  making sure every response actually carries them.
- **D-CN9** — frozen security boundary: `hub_crew_create`/`hub_crew_update` stay in
  `SCOPE_EXEMPT_ACTION_TOOLS`, `write`-classified, approval-gated; no tool name, entity kind, or
  scope-map entry changes.
- Anchors: `apps/api/src/assistant/tools/hub-write-tools.ts:110` (`hub_crew_create`), `:126`
  (`hub_crew_update`); `apps/api/src/assistant/tools/hub-read-tools.ts:94` (`summarizeCrew`), `:103`
  (`memberAgentIds`), `:144` (`hub_crews_list`); `apps/api/src/hub/routes.ts:2677`
  (`POST /api/hub/crews`), `:2688` (`PATCH /api/hub/crews/:id`);
  `packages/shared/src/assistant-scope.ts:119` (`SCOPE_EXEMPT_ACTION_TOOLS`);
  `apps/api/test/assistant-scope.test.ts:133-179` (the WP 5.1 D-AO7 set-equality + entity-kind
  tests that must stay green, untouched).

## Design

No new validation logic lives here — cycle/exists/depth checks live in
`HubRepository.createCrew`/`updateCrew` (WP 1.1). This WP is plumbing + proof across the two
existing entry points that already funnel through that repo.

- **`hub_crew_create`/`hub_crew_update`** (`hub-write-tools.ts:110-140`): the
  `.parse()` → `deps.hub.createCrew/updateCrew()` → `summarizeCrew()` shape is untouched — it is
  *already* additive once 0.1 widens `hubCrewInputSchema`'s member shape and 1.1 adds the repo
  checks. Concretely:
  1. Update both tool description strings to state that a member may reference either an existing
     `agentId` **or** another crew's `crewId` (nesting a sub-crew), and that a cyclic / over-depth /
     missing `crewId` comes back as a clean tool error, not a crash — mirroring the existing
     "create N agents → reference their ids" chaining note with a "create sub-crews → reference
     their ids in a parent crew" analogue.
  2. `summarizeCrew` is today a **pure, dependency-free** projection (`hub-read-tools.ts:94`,
     `crew: HubCrew` only) — a recursive `totalAgentCount`/`memberCrewCount` rollup needs to walk
     *other* crews, which a bare `HubCrew` cannot do. Confirm WP 1.1's landed `summarizeCrew` shape
     first: if it now takes an extra resolver/repo argument to compute the recursive rollup, update
     **both** call sites (`hub-write-tools.ts:121`, `:138`) to pass it (e.g. `deps.hub`) so the
     JSON actually carries the recursive counts, not just the direct-children ones. If 1.1 instead
     precomputes the rollup without an extra call-site argument, this step is a no-op — do not
     invent plumbing that isn't needed.
- **`hub_crews_list`** (`hub-read-tools.ts:144-161`): today `capped.items.map(summarizeCrew)` calls
  the same pure projection with no repo access — same concern as above. Update the `.map(...)` call
  site so every listed crew (including nested ones) carries its recursive counts, and refresh the
  tool description to mention nested crews (e.g. "N agents, M crews (T total)").
- **HTTP routes** (`routes.ts:2677` `POST /api/hub/crews`, `:2688` `PATCH /api/hub/crews/:id`):
  these two handlers are already minimal (`.parse()` → repo call → return the raw `HubCrew`) and
  need **no shape change** — `HubCrew.members` is typed against the (now-widened) shared schema, so
  a `crewId` member round-trips as-is. Verify, don't hand-roll: a rejection thrown by 1.1's repo
  checks (`httpError(400/404, …)`) must reach the client with the matching status code through the
  existing central error handler (`apps/api/src/index.ts:1321` `setErrorHandler`) — the generic
  `ZodError → 400` / `error.statusCode` path already covers this; add no new error-mapping code.
- **Error surfacing is proved, not built.** `safeTool` (`assistant/tools/util.ts:22`) already
  converts *any* thrown error (including 1.1's typed `httpError`s) into a clean `isError`
  `CallToolResult` via `toErrorMessage`; the central Fastify error handler already honors
  `error.statusCode`. Both are generic and untouched by this WP — its Acceptance is tests proving
  the existing generic plumbing carries 1.1's new rejection types cleanly on both paths, not new
  code.
- **Scope/security:** do not touch `ASSISTANT_HUB_WRITE_TOOL_NAMES` (`hub-write-tools.ts:55-60`),
  `packages/shared/src/assistant-scope.ts`, or `ASSISTANT_ENTITY_KINDS`
  (`packages/shared/src/constants.ts`). Run `assistant-scope.test.ts` unmodified and confirm it
  stays green.

## Files

- `apps/api/src/assistant/tools/hub-write-tools.ts` *(modify)* — `hub_crew_create`/`hub_crew_update`
  description text + `summarizeCrew` call-site wiring for nested counts (only if 1.1's signature
  needs it).
- `apps/api/src/assistant/tools/hub-read-tools.ts` *(modify)* — `hub_crews_list` description text +
  `summarizeCrew` call-site wiring in its `.map(...)`.
- `apps/api/src/hub/routes.ts` *(modify only if verification finds a gap — expected to need no
  behavior change, comment-only around `:2677`/`:2688`)* — confirm `crewId` members round-trip and
  1.1's repo rejections map to the right HTTP status.
- `apps/api/test/assistant-hub-write-tools.test.ts` *(modify)* — nested-crew create/update via tool,
  a cyclic-create rejection, `memberCrewIds`/count assertions.
- `apps/api/test/assistant-hub-read-tools.test.ts` *(modify)* — `hub_crews_list` nested-count
  assertions.
- `apps/api/test/hub-agent-routes.test.ts` *(modify)* — nested-crew create/patch via HTTP, a
  cyclic-create 400 assertion (mirrors the existing "color validation 400s on both create and
  patch" pattern at `:369`).
- `apps/api/test/assistant-scope.test.ts` *(verify only — no edits expected)* — rerun to confirm the
  D-AO7 set-equality + entity-kind tests still pass untouched.

## Acceptance

- [ ] `hub_crew_create` accepts a member with `crewId` (no `agentId`) referencing an existing crew
      and persists it; the crew round-trips via `hub_crews_list` / `GET /api/hub/crews/:id` with
      that member intact.
- [ ] `hub_crew_update` replacing `members` with a mix of `agentId`- and `crewId`-members succeeds,
      and the response's `memberCrewIds` lists exactly the crew-reference members.
- [ ] The `hub_crew_create`/`hub_crew_update` tool response includes `memberAgentCount`,
      `memberCrewCount`, and a recursively-computed `totalAgentCount` proven correct for a 2-level
      nesting fixture (crew C references crew B which references 2 agents ⇒ C's
      `totalAgentCount` = 2).
- [ ] A `hub_crew_create`/`hub_crew_update` whose members would create a cycle (directly or
      transitively) comes back as a clean `isError` tool result — not a thrown exception — with a
      message naming the offending crew.
- [ ] `POST /api/hub/crews` and `PATCH /api/hub/crews/:id` accept the same `crewId`-bearing members
      and return 400 (not 500) on the same cyclic input, matching the tool-path rejection.
- [ ] `hub_crews_list` echoes `memberCrewIds`/`memberAgentCount`/`memberCrewCount`/`totalAgentCount`
      for every listed crew, including nested ones.
- [ ] `assistant-scope.test.ts`'s `SCOPE_EXEMPT_ACTION_TOOLS` set-equality test and the sibling WP
      5.1 (D-AO7) tests pass with **zero diff** to that file — no tool name added, removed, or
      renamed.
- [ ] `git diff` shows no changes to `ASSISTANT_ENTITY_KINDS`, `SCOPE_WRITE_TOOLS`, or
      `deriveAssistantScope` (`packages/shared/src/assistant-scope.ts` / `constants.ts`).
- [ ] Gate green (`pnpm typecheck && pnpm test && pnpm build && pnpm lint`).

## Notes

- **Parallel-safety:** solo once 1.1 lands (README build-order step 4: `{1.2}` alone) — sole owner
  of `hub-write-tools.ts` at this point. `hub-read-tools.ts`'s `summarizeCrew`/`hub_crews_list` are
  shared ground with 1.1 (which authors the counts) — land strictly **after** 1.1 merges rather than
  in parallel with it, to avoid a merge conflict on the same function.
- Before writing any call-site plumbing, read 1.1's actual landed `summarizeCrew` signature — if it
  turns out to need no extra argument at the call site, the "wiring" work collapses to description
  text + tests only; don't invent unneeded indirection.
- Do not add a depth/env constant here — `HUB_MISSION_MAX_DEPTH`/`HUB_MISSION_MAX_TOTAL_AGENTS` are
  0.1/0.3's remit. This WP only proves that whatever depth-exceeded rejection 1.1 throws surfaces
  cleanly through both paths.
- No owner-acceptance dependency — fully verifiable inside the gate (no running-app/provider-key
  requirement).
