# Kickoff prompt — assistant-operability

Paste the block below into a fresh coding-agent session to drive the whole workstream with parallel
worktree subagents via `/next-wp`.

```text
You are the orchestrator for the **assistant-operability** workstream in this repo
(mcp-token-footprint). Goal: make it a hard, gated rule that every app route exposes an assistant
interface, and bring the Hub (Agents & Crews) up to that bar — the right-side dock currently shows
generic global suggestions on /assistant/agents because the Hub is in none of the assistant registries.

## Read first (in order)
1. roadmap/assistant-operability/README.md — mission, decisions D-AO1–D-AO6, WP index, the settled
   Design + Backfill appendix, invariants.
2. roadmap/assistant-operability/STATUS.md — the ledger you read and tick.
3. .claude/rules/brand-ui-only.md (the rule-doc template for WP 1.2) + .claude/rules/quality-gates.md
   + .claude/rules/routes-vs-dialogs.md.
4. The registries you'll touch: packages/shared/src/assistant-starters.ts (resolveStarterSurface ~L612,
   AssistantStarterSurface L54, COMPARE_ROUTES L581), packages/shared/src/assistant-ui-registry.ts,
   apps/web/src/features/assistant/assistant-context.tsx (resolveEntityPin), and
   apps/api/src/assistant/starters.ts (isScopableSurface ~L141).
5. The route table apps/web/src/App.tsx (~L1270–1433) and the test pattern to model the gate on:
   apps/api/test/assistant-starters-catalog.test.ts.

## Operating rules
- Drive via `/next-wp assistant-operability`: pick the next `[ ]` WP whose `depends:` are all `[x]`,
  dispatch one worktree subagent per WP, validate against the WP's Acceptance + the full gate, then
  tick the ledger (`— done <date> · wp/assistant-operability/<id>`) or send it back to refine.
- Contract-first: shared → api → web. The manifest + surfaces land in packages/shared first.
- Parallel-safety / batching: WP 1.1 runs SOLO (it creates the manifest everything references).
  After 1.1: run 1.2 (docs-only) and 4.1 (hook-only) in parallel with the shared/api track; on the
  shared/api track run 2.1 → 3.1 sequentially (both touch assistant-starters/tools); 3.2 (web) after
  3.1; 4.2 after 2.1. Never batch two WPs whose Files overlap.
- Guardrails (do not violate):
  * Do NOT touch ASSISTANT_ENTITY_KINDS / SCOPE_WRITE_TOOLS / deriveAssistantScope — the frozen
    write-scope security boundary (D-AO3). Add route-keyed `agents`/`hub` surfaces, not entity kinds.
  * Mandatory api fix (WP 2.1): extend isScopableSurface to also exclude `hub`/`agents`, else
    deriveStarters throws on SCOPE_WRITE_TOOLS[surface] === undefined. Add a starters-service test.
  * The manifest is an assertion harness — do NOT regenerate resolveStarterSurface/resolveEntityPin
    from it; pin them with Test C instead.
  * Reference the route manifest in the rule/gate — never the non-existent *-analyze.ts builders; fix
    those stale comments in assistant-starters.ts while you're there.
  * No DB migration; no new runtime dependency.
  * Any visible change: verify by looking in BOTH themes (light + dark) on the running app
    (Docker :8080 — `pnpm dev` breaks on @elabs-ai/components-editor ?worker).
- Gate before every tick: `pnpm typecheck && pnpm test && pnpm build && pnpm lint` green.

## Model tiers
Opus for WP 1.1 (manifest + gate design) and 1.2 (rule doc / judgment). Sonnet for 2.1, 3.1, 3.2,
4.1, 4.2. If you add an adversarial review pass per phase, run it at the top tier available.
```
