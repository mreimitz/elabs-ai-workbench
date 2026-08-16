# 10 — Decisions log (all resolved)

Every open question is now answered by the owner (2026-07-01). This is the authoritative decision
record the work packages build against.

| # | Question | Decision |
|---|---|---|
| **Q1** | What does "attach a skill to a scenario" feed the agent-under-test? | **Faithful + eager toggle.** L1 `<available_skills>` block always injected; a read-only `read_skill_file` disclosure tool for L2/L3 on demand (metered like MCP tool calls); plus an optional per-attachment **eager** toggle that inlines the SKILL.md body for worst-case comparison. Grounded in [`11-skill-loading-in-real-products.md`](./11-skill-loading-in-real-products.md). |
| **Q2** | "Show SKILL.md as a subscription" — which meaning? | **Both.** Auto-surface the rendered SKILL.md as the overview **and** add a subscribe-to-updates watcher for GitHub skills. |
| **Q3** | Monorepo import granularity | **One skill per chosen subpath.** The probe lists every `SKILL.md` dir; each selected dir is its own independently-versioned skill. |
| **Q4** | YAML frontmatter: dep or hand-parse? | **Add `yaml`** (robust parse). Part of the approved dep set. |
| **Q5** | New API dependencies sign-off | **Approve all four:** `@fastify/multipart`, `fflate`, `diff`, `yaml`. |
| **Q6** | Pinned version deleted while a scenario references it | **Block the delete.** A version pinned by any scenario cannot be deleted; the user must detach/re-pin first. |
| **Q7** | In-app skill editing | **Deferred** (future WP). Imports stay read-only in Phase 1/2. |
| **Q8** | Bare `SKILL.md` upload vs require `.zip` | **Accept both** — a `.zip` directory or a lone `SKILL.md` (one-file skill). |
| **Q9** | Side-menu placement | **Own top-level nav section**, order **MCP → Skills → Testing** (its own `SidebarGroup`). |
| **+** | Private GitHub repos in v1 | **Yes — private + public.** PAT encrypted via `SecretStore`, never returned to the web (`hasAuth` boolean only). |
| **+** | Update-check cadence | **On Skills-view open + a manual "Check for updates" button.** No background poller. |
| **+** | Export a skill version | **Yes** — download any version as a `.zip` of its exact tree (round-trips uploads and GitHub). |
| **+** | Cross-skill compare | **Not now.** Per-skill version diff is enough for Phase 1; cross-skill compare is a possible later add. |
| **+** | Kickoff | **Build it.** Finish planning → break into WPs (`roadmap/skills/`) → drive with `next-wp` (parallel worktree agents, validate, tick off, iterate) until implemented, tested, green. |

## Consequences threaded into the plan

- **Block-delete (Q6)** → `DELETE /api/skills/:id/versions/:vid` and skill delete must 409 when a
  `scenario_skills.pinned_version_id` references the target (Phase 2 adds the check; Phase 1 ships the
  guard hook so the contract is stable). See [`03-data-model.md`](./03-data-model.md),
  [`05-api-surface.md`](./05-api-surface.md).
- **Export (add)** → `GET /api/skills/:id/versions/:vid/export` streams a `.zip` rebuilt from the
  content-addressed blobs. Web: a "Download .zip" action in the inspector.
- **Update watcher (Q2/cadence)** → `GET /api/skills/:id/upstream` returns
  `{ hasUpdate, upstreamSha }` by a lightweight `git ls-remote` (no clone); the Skills view checks
  tracked GitHub skills on open + a manual button; a badge appears when newer.
- **Private repos (add)** → PAT captured in the wizard, encrypted, used via an ephemeral git
  credential; surfaced as `hasAuth` only.
