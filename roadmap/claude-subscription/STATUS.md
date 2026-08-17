# Claude subscription as a run model — work-package status ledger · **PRIORITY: (owner to set)**

Living state for the **claude-subscription** plan, read and updated by
`/next-wp claude-subscription`. A box is ticked **only** when the WP's Acceptance is met and the gate
(`pnpm typecheck && pnpm test && pnpm build && pnpm lint`) is green.

**Legend:** `[ ]` open · `[x]` done. Done lines: `… — done <YYYY-MM-DD> · wp/claude-subscription/<id>`.

> Plan + locked decisions D-CS1–D-CS10 in [`README.md`](./README.md). Reference implementation to
> generalize: [`../../apps/api/src/grading/claude-cli-judge.ts`](../../apps/api/src/grading/claude-cli-judge.ts).
> Pattern to mirror: the `vendor_assistant` executor branch + estimated-metric markers.
>
> **Kickoff: owner-locked 2026-07-13** — all ten decisions locked (README §2). **Phases 0–3 DONE
> 2026-07-13** — all 13 WPs built + gate green (API 1731 tests) on the local branch
> `claude-subscription/integration` (worktree `.claude/worktrees/cs-integration`), **not merged to
> `main`, not pushed** — the `integration → main` merge is the owner's. Migration **v29**
> (`runs.cost_basis`) is the latest claimed here (0.2 claimed v28). Only the Owner-acceptance items
> below remain (need a live signed-in subscription — can't run headless).
>
> **Migration note:** WP 0.2 widens the `provider_credentials.kind` CHECK and **claims the next free
> `user_version` at claim time** — re-verify `apps/api/src/db/database.ts` `MIGRATIONS` (sibling
> ledgers — auto-rating, vendor-assistant — have consumed versions up through the v20s; do not hardcode).
>
> **Contention note:** `packages/shared` (WP 0.1) and `apps/api/src/testing/run-service.ts` (WP 1.2)
> are hot files other sessions touch — start those WPs only when no sibling session is writing them.
>
> **Naming rule:** internal kind `claude_subscription`, executor `claude-subscription-executor`;
> never bare "assistant" (collides with `apps/api/src/assistant/*`), never `claude_cli` (already the
> judge-ledger provider id).

## Phase 0 — Contract, credential & roster
- [x] WP 0.1 — shared contract: `PROVIDER_KINDS` + `"claude_subscription"`, zod, additive types
      (reuse `estimatedTokens`; add `costBasis`/`meteringEstimated` step+KPI flags)
      — done 2026-07-13 · wp/claude-subscription/0.1
- [x] WP 0.2 — credential + auth resolution + migration (widen `provider_credentials.kind` CHECK,
      claim next free `user_version`): resolve OAuth token from `assistant_credentials`;
      "auth broken" surfacing when not signed in
      — done 2026-07-13 · wp/claude-subscription/0.2 · migration **v28**; `subscription-auth.ts`
      resolver + `ProviderRepository.getDecrypted`/`redact`. NOTE: `authSource` left unset for the
      kind (wire enum frozen by 0.1) — `authBroken` carries the signed-in signal; a future
      shared-contract WP could add a `subscription` `authSource`.
- [x] WP 0.3 — roster (`ASSISTANT_MODEL_ROSTER`) in `model-catalog` + `modelFor` throws for the kind
      + Settings→Providers create form (no key; shows sign-in state)
      — done 2026-07-13 · wp/claude-subscription/0.3 · `model-catalog` returns
      `ASSISTANT_DEFAULT_MODEL_ROSTER`; keyless create form reads existing `getAssistantAuthStatus`.
      (Both-theme + keyboard walk of the new Settings form is owner-acceptance — not run headless.)

## Phase 1 — Executor (single runs)
- [x] WP 1.1 — `claude-subscription-executor`: multi-turn `AgentSessionDriver` loop (generalize the
      judge one-shot), event→`run_steps`/KPI mapping so the console renders identically (D-CS3)
      — done 2026-07-13 · wp/claude-subscription/1.1 · new module + 12 stub-driver tests. Token
      counts EXACT (`turn_done.usage`→`usageActual`, cache-inclusion verified vs `TokenUsageActual`
      contract); `meteringEstimated` on turn-granular llm steps; DI seams for 1.2/1.3/1.4/1.5/2.1.
      **For WP 1.2:** interactive runs terminate `stopped`/`aborted` (never `completed`) — reconcile
      with the AI-SDK interactive convention; and `resolveAuth` must yield an `AssistantAuthSource`
      (the judge's path via `AssistantAuthService`), not 0.2's token-in-`apiKey`.
- [x] WP 1.2 — `RunService.execute()` `claude_subscription` branch (run-service.ts:398-406);
      **not** clean-session (MCP + skills wired)
      — done 2026-07-13 · wp/claude-subscription/1.2 · `resolveClaudeSubscription` (redacted-kind read,
      branch before vendor so unsigned `getDecrypted` can't mask honest auth); 2 optional `RunService`
      seams + `index.ts` wires `SdkAgentSessionDriver` + subscription-only `resolveJudgeAuth` (D-CS7).
      MCP/skills are seams (`mcpServers:{}`) not yet populated — WP 1.3/1.4.
- [x] WP 1.3 — MCP tools via SDK `mcpServers`; allow-list → `disallowedTools`/patterns; local
      (estimated, marked) `tool_result` metering; transport-error vs tool-`isError` semantics
      — done 2026-07-13 · wp/claude-subscription/1.3 · new `subscription-tools.ts` (server→`mcpServers`
      + `mcp__server__tool` patterns); **default-deny `canUseTool` gate** enforces the allow-list;
      estimated+marked `tool_result` metering (never inflates `usageActual`); OAuth Bearer in child
      config. Live SDK enforcement + OAuth-against-real-server = owner-acceptance (stub-tested).
- [x] WP 1.4 — skills materialized read-only into the SDK workspace (`additionalDirectories`),
      estimated metering, never executed
      — done 2026-07-13 · wp/claude-subscription/1.4 · `subscription-skill-tools.ts` materializes
      skills read-only + an in-process `read_skill_file`/`list_skill_files` disclosure server
      (chosen over native SDK loading — L2/L3 needs the blocked Read/Bash; verified vs sdk.d.ts).
      Metering rides the 1.3 seam (estimated, marked); L1 block via `withSkillsBlock`; never executed.
      Live SDK skill-loading = owner-acceptance.
- [x] WP 1.5 — cost (D-CS8): shadow-price exact tokens via `MODEL_PRICING`; feed the cost cap +
      `cost_usd`; tag `costBasis: "subscription_reference"`
      — done 2026-07-13 · wp/claude-subscription/1.5 · `costUsd = Σ estimateCost(model, usageActual)`
      (reuses the API-keyed pricing); cap trips `stopped_guardrail` on `costUsd >= maxCostUsd`
      (verified sign; both-direction tests); unpriced-model+cap → honest fail-fast. Cap granularity =
      per settled turn (SDK owns the intra-message loop).

## Phase 2 — Suite runs & concurrency
- [x] WP 2.1 — orchestrator runs the kind unchanged; shared run+judge subscription semaphore (extend
      `AUTO_RATING_MAX_CONCURRENCY`); per-provider concurrency cap (D-CS2, D-CS10)
      — done 2026-07-13 · wp/claude-subscription/2.1 · new `subscription-concurrency.ts`
      (`SubscriptionConcurrencyPool` = one shared gate + per-provider registry); `index.ts` injects the
      ONE instance into both the CLI judge and `RunService` (total in-flight ≤ `autoRatingMaxConcurrency`,
      proven by tests); per-provider slot acquired outside the shared gate (no deadlock); orchestrator
      unchanged (test).
- [x] WP 2.2 — suite report renders with shadow-cost estimate + marker; no separate path; no crash on
      absent logprobs
      — done 2026-07-13 · wp/claude-subscription/2.2 · shadow cost aggregates through the same path;
      "est. · subscription" marker via testGroup findings + narrative (no shared edit; reads
      `costBasis` from the persisted kpi event); all-subscription suite generates with honest null
      score + neutral agreement (no logprob crash). **FINDING for WP 3.1:** `costBasis`/
      `meteringEstimated` are only on the (live+persisted) **kpi event**, NOT in `getSummary()` — so
      the Runs feed / Compare (RunSummary) don't carry the marker yet; WP 3.1 must make `costBasis`
      available on read (derive from provider kind, or a small additive migration) before rendering.

## Phase 3 — Accuracy markers & polish (D-CS4)
- [x] WP 3.1 — UI "est." / "subscription-reference" markers on cost + estimated-metering KPIs (run
      console rail, Runs feed, Compare, suite report), reusing the `estimatedTokens` marker; both themes
      — done 2026-07-13 · wp/claude-subscription/3.1 · **read-path fix**: migration **v29** adds
      `runs.cost_basis` (persist at finalize → `toRunSummary`), so Runs feed + Compare carry `costBasis`;
      `SubscriptionCostMarker` (`@brand` Badge+Tooltip, both-theme by construction) on rail/feed/Compare/
      suite report. Both-theme + keyboard visual walk = owner-acceptance.
- [x] WP 3.2 — JSON + Markdown reports carry `costBasis`/`meteringEstimated` + footnote
      — done 2026-07-13 · wp/claude-subscription/3.2 · JSON run report `statistics.costBasis`
      (conditional) + suite-run per-cell `costBasis`; Markdown `SUBSCRIPTION_COST_FOOTNOTE` blockquote
      (reference estimate, marginal $0, exact counts, estimated metering/granularity, single-sample).
      `meteringEstimated` not persisted (WP 3.1) → footnote prose is the marker. Normal runs unchanged.
- [x] WP 3.3 — auto-rating: subscription run still rated; handle run-vs-judge contention (D-CS10);
      note logprob absence
      — done 2026-07-13 · wp/claude-subscription/3.3 · verified (doc + tests, no logic change): no
      kind-gate skip (`reviewRun` unconditional; `GradeService` eligibility kind-agnostic); D-CS10 —
      the run's own CLI-judge shares the ONE `SubscriptionConcurrencyPool.shared` gate (end-to-end
      test, bound=1); logprob absence → `single_sample` honestly.

## Owner-acceptance (needs a signed-in subscription; can't run headless here)
- [ ] Live single run on the subscription drives an MCP server end-to-end and renders identically to
      an API-keyed Claude run (D-CS3), with the cost marked "est. · subscription" (D-CS4/8)
- [ ] Live suite mass-run completes with the shared semaphore holding memory in check (D-CS2/10)
- [ ] Both-theme + keyboard walk of the accuracy markers in the console, Runs feed, and reports
- [ ] Not-signed-in path shows "auth broken" + an honest run error, never a fake result (D-CS7)
