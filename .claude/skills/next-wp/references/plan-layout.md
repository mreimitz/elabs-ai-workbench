# Plan folder layout

A *plan* this skill can run is a folder of numbered **work-package (WP) specs** plus a **STATUS
ledger**. The canonical example in this repo is `roadmap/testing/`.

## Required shape

```
PLAN/
├── README.md            master index: WP table, dependency graph, recommended build order
├── conventions.md       shared rules every WP assumes (gate, contract-first, boundaries, naming)
├── references.md        external + internal references (optional but recommended)
├── STATUS.md            the living ledger (see status-ledger.md) — created if missing
└── phase-*/             one folder per phase
    └── WP-<id>-<slug>.md one spec per work package
```

## What a WP spec must contain

Each `WP-<id>-*.md` is self-contained. The skill relies on these sections:

- **Title** — `# WP <id> — <goal>` (the `<id>` is like `0.3`, `1.4`, `3.5`).
- **Header line** — `**Phase:** … · **Size:** … · **Depends on:** <ids | —>`. The **Depends on**
  list is how the skill computes which WPs are unblocked.
- **Files** — the files the WP creates/modifies. The skill reads this to choose a **parallel-safe**
  batch (no two parallel WPs editing the same file).
- **Acceptance** — the checklist the orchestrator validates against before ticking the WP off.
- Optional: **Objective**, **Why / references**, **Design**, **Implementation steps**, **Notes**.

## How the skill uses the folder

1. `README.md` → recommended build order + the WP index.
2. `conventions.md` → the rules and the quality gate every sub-agent must follow.
3. `phase-*/WP-*.md` → per-WP **Depends on**, **Files**, **Acceptance**.
4. `STATUS.md` → current open/done state (the source of truth for what's left).

## Adapting to another project

Override these defaults when the plan isn't this repo's:
- **Plan root**: anywhere, not just `roadmap/`.
- **Quality gate**: whatever `conventions.md` defines (this repo: `pnpm typecheck && pnpm test &&
  pnpm build`).
- **Rules**: this repo enforces contract-first, an API runtime/secret boundary, and brand-ui-only;
  other projects substitute their own. The orchestration loop is unchanged.
