# 02 — State of the art: skill handling

Verified against live docs 2026-07-17. Sources: agentskills.io (spec + client-implementation +
skill-creation guides), platform.claude.com (Agent Skills / skills-guide),
code.claude.com/docs/en/skills, anthropics/claude-code CHANGELOG, anthropics/skills,
claude.com/blog (Dec 18, 2025 open-standard announcement), developers.openai.com/codex/skills,
cursor.com/docs/skills, docs.github.com (Copilot agent skills). Normative requirements:
`roadmap/assistant-hub/requirements.md` (R-SK*).

## 1. The standard (and why the app's registry is already spec-shaped)

- Agent Skills became an **open standard** (agentskills.io, Dec 18 2025); 40+ clients including
  OpenAI Codex, Cursor (which **deprecated its rules system in favor of skills**), GitHub
  Copilot, Gemini CLI. `.agents/skills/` emerged as the cross-client directory convention; zip
  (≤30 MB, single top-level dir matching `name`) is the exchange shape.
- Spec constraints worth enforcing-but-leniently (warn-and-load; reject only on missing
  description / unparseable YAML): `name` 1–64 lowercase+hyphens matching the directory;
  `description` 1–1024 chars carrying **what + when**; optional `license`, `compatibility`
  (≤500), `metadata` (string map — `version`/`author` live here by convention);
  `allowed-tools` (experimental). Body: **SKILL.md < 500 lines**, references **one level deep**.
- Progressive disclosure with published numbers: **L1 catalog entry ~50–100 tokens**
  (name+description), **L2 body < 5K tokens** on activation, **L3 referenced files** loaded only
  when needed. *The app's skills inspector already meters exactly L1/L2/L3 — the SOTA metric set.*

## 2. How the reference harness budgets and lists skills (the numbers to copy)

Claude Code's L1 listing mechanics are the most concrete published token discipline anywhere:

- Each entry (description + `when_to_use`) is **truncated at 1,536 chars**
  (`skillListingMaxDescChars`).
- The whole listing has a **budget of ~1% of the model's context window**
  (`skillListingBudgetFraction`); on overflow it **drops descriptions starting with the
  least-invoked skills** (names always remain).
- `/context` reports the post-budget listing size; `/doctor` names the biggest contributors;
  the catalog is **omitted entirely when zero skills** are attached.
- Per-skill states without editing the skill (`skillOverrides`): `on` · `name-only` (budget
  lever) · `user-invocable-only` (hidden from the model, still typable) · `off`.

## 3. Invocation & lifecycle mechanics

- **Model-driven activation, never harness keyword matching**: the model picks from the L1
  catalog via a **Skill tool whose name parameter is enum-constrained** to valid skills
  (integration guide) — prevents hallucinated names.
- **Slash commands merged into skills**: `/skill-name args` with `$ARGUMENTS` /
  `$ARGUMENTS[N]` / named args + `argument-hint`; stacked invocation (`/a /b task`, first + 5).
- Invocation-control frontmatter: `disable-model-invocation: true` (user-only; **description
  removed from context entirely**) · `user-invocable: false` (model-only; hidden from the `/`
  menu). Extra harness fields: per-skill `model` / `effort` overrides, `paths` globs gating
  auto-activation, `context: fork` + `agent` (run the skill in an isolated subagent),
  subagents' `skills:` field preloading **full content**, skill-scoped `hooks`.
- Lifecycle costs are explicit: invoked content **persists for the whole session**; identical
  re-invocations **dedupe** ("already loaded" note); on compaction each invoked skill re-attaches
  its **first 5,000 tokens within a combined 25,000-token budget**, most-recent-first.
- `allowed-tools` is a **per-turn permission grant** in Claude Code (clears next message) —
  advisory, harness policy still governs. Hot-reload: skill dirs are watched; edits apply
  in-session.
- Security posture: audit-before-install; watch for instructions steering agents to untrusted
  network sources; Claude Code ships `disableSkillShellExecution` acknowledging injected
  `` !`cmd` `` preprocessing as a risk class. *The app's stance — store, meter, inspect, never
  execute — is the strictest end of this spectrum and stays (skills invariant).*

## 4. Hosted management (API + claude.ai)

- API: `/v1/skills` — **immutable versions** (epoch-timestamp ids) + a **`latest` alias**;
  pin-for-prod / latest-for-dev guidance; ≤8 skills per request; 30 MB zip cap; metadata injected
  into the system prompt, body loaded by the agent itself. claude.ai: per-skill on/off toggles,
  Personal/Shared/Organization grouping, admin provisioning (default-on, user can toggle off),
  partner Skills Directory, build-a-skill-from-described-workflow with preview-before-enable.
- *The app's registry already implements the version model (immutable versions, auto-latest vs
  pinned attachment, GitHub pull provenance, full-tree diff) — attachment UX for hub sessions
  mirrors scenario attachment.*

## 5. Trigger quality is a measurable property (and the app owns the harness for it)

Published methodology (agentskills.io + skill-creator): the description "carries the entire
burden of triggering"; third-person phrasing; what + when + concrete trigger keywords; test with
**~20 labeled queries** (8–10 should-trigger incl. non-obvious phrasings; 8–10 should-not incl.
**near-misses**), **3 runs each → trigger rate vs 0.5 threshold**, **60/40 train/validation
split**, ≤~5 revision iterations, never paste failed keywords verbatim. Anti-patterns: vague
descriptions, time-sensitive content, unqualified MCP tool names (use `Server:tool`), "voodoo
constants", Windows paths, deferring error handling to the model.

*Dogfood fit: this eval loop is literally a suite run (test × repetition matrix + graders) — the
app's Benchmarks + Skill IDE quality engine can score trigger quality without executing the
skill.*

## What the Hub adopts (summary → R-SK1…8)

L1 listing with the 1%-budget + 1,536-char truncation + least-invoked demotion, shown live with
real token numbers (dogfood) · enum-constrained on-demand L2/L3 loading with dedupe +
compaction-protection budgets · slash invocation with args + per-attachment invocation controls
(`on`/`name-only`/`user-only`) · frontmatter superset parsed and displayed, never silently
dropped (portability report) · per-session L1/L2/L3 cost breakdown in the context inspector ·
trigger-quality badge wired to the existing suite/quality engines · `context: fork` semantics
mapped to mission roles · pinned/auto-latest version attachment with provenance + diff links.
Out of scope (invariant): executing anything — scripts and `` !`cmd` `` preprocessing are
surfaced by the security panel, never run.
