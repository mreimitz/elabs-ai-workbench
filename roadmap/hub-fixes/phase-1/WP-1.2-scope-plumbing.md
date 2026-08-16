# WP 1.2 — scope plumbing honesty (persist, PATCH, grant-aware rail, builtins)

**Phase:** 1 · **Size:** M · **Depends on:** — · **Model:** Sonnet · **Agent profile:** API + web plumbing

## Objective

Make the session's `toolScope` real everywhere it is shown or edited: the Context rail reflects the
actual scope, scope is editable after create, and the scope's `builtins` selection is honored. This
kills RC3 (display half) and the write-once trap.

## Why / evidence

`analysis.md` RC3. The rail's tool list comes from `buildHubContextMcpCatalogProvider`, which grants
every scanned server `"all"` and never reads `session.toolScope`
(`apps/api/src/hub/routes.ts:1428-1462`). `PATCH /api/hub/sessions/:id` accepts only
title/model/autonomy (`routes.ts:1732-1737`). The live defect session had `toolScope: null` while
the owner believed it was scoped. `resolveHubMcpGrants` ignores `scope.builtins`
(`apps/api/src/index.ts:430` always `DEFAULT_CHAT_BUILTIN_NAMES`).

## Design

- **Shared (additive):** `toolScope?: HubToolGrants | null` on `HubSessionPatch` +
  `hubSessionPatchSchema`. `null` = clear back to auto.
- **API:** PATCH persists scope (`repository.updateSession`); the context inspector provider takes
  the session and applies its scope exactly like `resolveHubMcpGrants` does (scoped ⇒ only listed
  servers/tools; auto ⇒ all scanned, and the payload says so via a new additive
  `tools.scopeMode: "scoped" | "auto"` field). `resolveHubMcpGrants` honors `scope.builtins` when
  present (absent/empty-array semantics: absent field ⇒ defaults; explicit `[]` ⇒ defaults too, to
  avoid bricking a session; document this).
- **Web:** Context rail Tools section header shows `Scoped` vs `Auto (all reachable)` + a
  **Manage** affordance opening a dialog that reuses `ToolGrantPicker` and PATCHes the scope.
  `NewSessionDialog` unchanged except: when a crew is selected, show a hint that agent tool access
  comes from the crew roles' Access tabs (grants themselves are Phase-2 territory).

## Files (exclusive)

- `packages/shared/src/types.ts`, `packages/shared/src/schemas.ts` (additive)
- `apps/api/src/hub/routes.ts` (PATCH + inspector provider), `apps/api/src/hub/repository.ts`
- `apps/api/src/index.ts` (the `scope.builtins` honor inside `resolveHubMcpGrants` ONLY — WP 1.3 owns the rest of that function's surfacing changes; keep the diff minimal)
- `apps/web/src/features/hub/meta-rail/ContextSection.tsx`, `use-meta-rail-data.ts`, new `ManageToolScopeDialog.tsx` (+ tests), `NewSessionDialog.tsx` (hint only)

## Acceptance

- [ ] PATCH round-trip test: scope set → context payload lists only scoped servers with `scopeMode:"scoped"`; cleared → all + `"auto"`.
- [ ] Inspector provider unit test proving it applies `toolScope` (the RC3 regression test).
- [ ] `builtins` honor test (scoped builtins subset reaches the toolset; empty ⇒ defaults).
- [ ] Rail shows scope state + Manage dialog edits it (component tests, both themes token-safe).
- [ ] Additive-only shared diff; existing e2e replay unaffected.
- [ ] Gate green.
