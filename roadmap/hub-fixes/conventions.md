# hub-fixes — shared conventions (every WP assumes these)

## Quality gate (definition of done)

- Per WP: `corepack pnpm@9.15.4` → `pnpm typecheck && pnpm test && pnpm lint` (Biome). All green, zero new skips.
- `pnpm build` runs at **batch integration** (orchestrator, before ticking the batch) — parallel builds OOM.
- WP-specific tests named in each spec's Acceptance are part of the gate.

## Repo rules that bind here

- **Contract-first, additive-only:** any wire/DB change starts in `packages/shared/src/{types,schemas}.ts` (types + zod together). Never break existing event/e2e replay shapes; `HubEvent` grows by union extension only.
- **Runtime/secret boundary:** secrets stay server-side (`apps/api`), never in shared or web, never in git. Provider keys resolve through the existing credential seams only.
- **brand-ui only:** web UI uses `@elabs-ai/components-*` components + semantic tokens; both themes (`light`, `dark`) must hold. No raw hex, no ad-hoc CSS beyond token-driven classes. See `.claude/rules/*`.
- **Naming:** kebab-case files, PascalCase components; tests colocated (`*.test.ts` / `*.test.tsx`).
- **DB:** migrations bump the next free `user_version` (check `apps/api/src/db/database.ts` head at claim time; v50 was the last known here). This workstream expects **no new migration** unless a WP says so explicitly.

## Testing discipline

- No live providers or live MCP servers in the gate. Engine behavior is proven with stubs/fakes (existing patterns: `session-service.hub-mcp-grants.test.ts`, `e2e/fixtures/hub-stub-llm-server.ts`).
- Anything only provable live (real the vendor call, real web search, both-theme visual walk) is recorded as **owner-acceptance** in the WP and in `STATUS.md`, never faked, never ticked as tested.
- e2e (`pnpm exec playwright test`) is owned by WPs that change engine flows (2.1, 3.2, 6.1); keep the stub LLM server deterministic.

## Behavior-freeze guarantees (do not regress)

- Existing eager-mode MCP behavior and the `testing/tool-bridge.ts` translation stay byte-compatible.
- Event-sourced replay: a pre-fix session (including `oNiw1PCAmxc5_ietGD_0h`-shaped logs) must still render.
- The structured agent runner remains selectable via `HUB_AGENT_RUNNER=structured` for one release (D-HF7).

## Evidence pointers

Every WP cites `analysis.md` sections (RC1…RC7) instead of restating them. File:line references in
specs were verified 2026-07-19 against the working tree; re-verify line numbers before editing, the
anchors are the function names.
