# Skill IDE — an enterprise IDE for Agent Skills

## Concepts

* [Skill IDE — architecture & locked decisions](00-architecture.md) - Successor plan to ../skillflow/ (all 13 WPs shipped). Skill IDE turns the
* [Skill IDE plan — conventions](conventions.md) - The SkillFlow conventions apply verbatim to every Skill IDE
* [Skill IDE — an enterprise IDE for Agent Skills](item.md) - Turn the Skills and SkillFlow features into a full IDE: per-command entry-point flows, canvas flow editing, a file and folder workspace, a quality engine, scan-aware tool validation, trigger management, publish to GitHub and unified flow-and-code editing.
* [Skill IDE — kickoff prompt for the implementing agent](kickoff-prompt.md) - Operational prompt, not a spec. Paste into a fresh Claude Code (Opus) session at the repo
* [Phase 1 — Command-aware graph core (WP specs)](phase-1-graph-core.md) - Size: M · Depends on: — · Solo (owns packages/shared)
* [Phase 2 — Flow editor v2 (WP specs)](phase-2-flow-editor.md) - Size: L · Depends on: 1.2 · API
* [Phase 3 — Workspace: files & folders (WP specs)](phase-3-workspace.md) - Size: L · Depends on: — (independent of Phase 1; serialize vs WP 1.1 on packages/shared) · API
* [Phase 4 — Quality (WP specs)](phase-4-quality.md) - Size: L · Depends on: 1.2 · API
* [Phase 5 — MCP-aware smart validation (WP specs)](phase-5-mcp-validation.md) - Size: L · Depends on: 1.2 · API
* [Phase 6 — Keywords & triggers (WP spec)](phase-6-triggers.md) - Size: M · Depends on: 1.2, 2.1
* [Phase 7 — Publish to GitHub (WP specs)](phase-7-publish.md) - Size: L · Depends on: — · API
* [Phase 8 — Server-bound skill authoring (WP specs) · locked decision I9](phase-8-server-binding.md) - Owner-locked 2026-07-04. Runs AFTER the current W3–W6 waves (recommended: W7 8.1 →
* [Phase 9 — Unified Flow/Code editing + education layer (WP specs) · locked decision I10](phase-9-unified-editing.md) - Owner-locked 2026-07-04. Runs AFTER Phase 8 (recommended waves: W10 9.1 → W11 9.2 ∥ 9.3
* [Skill IDE — code-reality index (verified 2026-07-04)](references.md) - Facts an executing agent would otherwise have to rediscover (or worse, guess). Everything below
* [Skill IDE — work-package status ledger · PRIORITY: HIGH](STATUS.md) - Living state for the Skill IDE plan, read and updated by /next-wp skill-ide. A box is
