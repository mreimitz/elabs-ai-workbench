# Portable Brand UI setup prompt

This document has two parts:

1. an inventory of the Brand UI integration in `mcp-token-footprint`;
2. a copy-ready prompt for reproducing that integration in another project.

## What is wired into this repository

### Supply chain and dependency pinning

- Nine private GitHub Release tarballs are committed under `vendor/brand/`:
  `@brand/ai`, `@brand/charts`, `@brand/cli`, `@brand/data`, `@brand/editor`,
  `@brand/flow`, `@brand/icons`, `@brand/tokens`, and `@brand/ui`.
- The release source is the private repository `mreimitz/qlabs-components`.
- The eight application packages are `file:` dependencies in `apps/web/package.json`.
  `@brand/cli` is a root `devDependency`.
- `pnpm-lock.yaml` records the local tarball paths and their sha512 integrity.
- `vendor/brand/PROVENANCE.md` records the release/tag, sha256 values, package purpose,
  version-skew policy, and the owner-gated update procedure.
- `.env.example` documents `GH_TOKEN` and `GITHUB_TOKEN` as manual build/tooling inputs.
  The running application never reads them.
- Docker build stages copy `vendor/` before dependency installation. The Brand UI packages
  are build-time dependencies for this statically bundled web app and are omitted from the
  final runtime image.

### Runtime and build integration

- React consumes the upstream packages directly; the old local
  `@mcp-token-footprint/brand-ui` adapter is retired.
- Tailwind v4 is integrated through `@tailwindcss/vite`.
- `apps/web/src/styles/app.css` imports `@brand/tokens/styles.css` and has an explicit
  `@source` for every installed package that emits utility class names.
- `apps/web/src/main.tsx` mounts `ThemeProvider`, `TooltipProvider`, and one `Toaster`.
  It also imports `@brand/editor/monaco-environment` and `@xyflow/react/dist/style.css`.
- The application exposes `qlik-bright` and `qlik-dark`, with `qlik-bright` as the fallback.
  Its theme helper prevents the additional `blueprint` theme from being persisted or selected
  and supports a system preference that resolves to one of the two allowed themes.
- Styling is restricted to semantic token utilities. Component `className` is for layout,
  while component variants and sizes control appearance.
- The app uses all eight runtime packages extensively. At the time of this inventory,
  `@brand/*` references appeared across 539 TypeScript/TSX source files.

### Agent context, CLI, and MCP

- The matching release's complete agent kit is committed at `vendor/brand-ui-agent-kit/`:
  five Brand UI skills, playbooks/templates, `brand-ui.manifest.json`, `llms.txt`, and
  per-package `llms/*.txt`.
- The CLI is invoked as `pnpm exec brand-ui`. Its useful commands include:
  `info`, `search`, `docs`, `audit`, `scan`, `map`, `codemod`, `scaffold`, and `mcp`.
- `.mcp.json` registers the stdio MCP server with:
  `node ./node_modules/@brand/cli/bin/brand-ui.mjs mcp`.
- `CLAUDE.md` tells agents that Brand UI is the UI source of truth, points them to the
  rules/kit/CLI, and forbids guessing component props.

### Claude rules, hooks, and commands

The reusable Brand UI policy lives mainly in:

- `.claude/rules/brand-ui-only.md`
- `.claude/rules/library-first.md`
- `.claude/rules/styling-and-tokens.md`
- `.claude/rules/dependencies.md`
- `.claude/rules/icon-affordances.md`
- `.claude/rules/interaction-guidelines.md`
- `.claude/rules/loading-states.md`
- `.claude/rules/routes-vs-dialogs.md`
- `.claude/rules/quality-gates.md`

Enforcement and review are wired through:

- `.claude/hooks/enforce-brand-ui.mjs`: rejects raw interactive HTML and imports from the
  retired adapter in edited web source;
- `.claude/hooks/check-tokens.mjs`: rejects newly edited raw color literals;
- `.claude/hooks/no-title-on-icon-button.mjs`: enforces the tooltip/accessibility contract
  for icon-only buttons;
- `.claude/hooks/no-bare-toast-error.mjs`: routes error notifications through the persistent
  error wrapper;
- `.claude/settings.json`: runs those hooks after Claude edit/write operations;
- `.claude/commands/audit-brand-usage.md`: provides a report-only Brand UI audit command.

The repository also contains application-specific guardrail tests for token contrast,
icon-button behavior, persistent error notifications, and other UI decisions. Those should
be adapted to the destination rather than copied blindly.

### Important correction about updating

There is currently **no automated Brand UI update routine** in this repository.
`vendor/brand/PROVENANCE.md` describes a manual, owner-gated process. The historical
`.claude/commands/brand-ui-update.md` was an inactive tombstone that explicitly said
`scripts/brand-ui-update.sh` did not exist; it was deleted in commit `be40ee09`.

The prompt below preserves the existing integration model and asks the destination agent to
add the missing production-grade update automation.

---

## Copy-ready prompt

Paste everything inside the following block into the root of the destination repository.

```text
You are the technical owner of this repository. Implement a production-grade integration of the
private @brand/* Brand UI design system. Do not merely add dependencies: reproduce the supply-chain,
runtime, agent-context, CLI/MCP, policy, enforcement, update, and verification layers described
below. Inspect this repository first and adapt paths/configuration to its actual stack. Preserve
unrelated work and merge existing configuration; do not overwrite it wholesale.

Fixed inputs and defaults
=========================

- Upstream release repository: mreimitz/qlabs-components (private)
- Release selection: latest stable GitHub Release by default; support an explicit tag override
- Packages to vendor:
  @brand/ai
  @brand/charts
  @brand/cli
  @brand/data
  @brand/editor
  @brand/flow
  @brand/icons
  @brand/tokens
  @brand/ui
- Canonical tarball directory: vendor/brand/
- Canonical agent-kit directory: vendor/brand-ui-agent-kit/
- Allowed application themes: qlik-bright and qlik-dark
- Default theme: qlik-bright
- Default density: compact
- Migration scope: full Brand UI parity. Existing visible UI should ultimately use @brand/*
  components and semantic tokens. If the repository is too large for a safe single-pass migration,
  complete all infrastructure/enforcement work and leave a quantified, ordered migration ledger;
  do not claim the UI migration is complete.
- Version updates are owner-gated: automation may prepare and verify an update, but must not commit,
  push, or silently accept breaking API changes.

Goal and measurable acceptance criteria
=======================================

The result is accepted only when:

1. All selected @brand/* packages come from one release tag, are committed as local tarballs, and
   are referenced with relative file: dependencies from the correct package manifests.
2. The lockfile pins those tarballs with integrity metadata, and PROVENANCE.md records the release
   URL/tag, fetch date, package versions, sha256 checksums, and update procedure.
3. The matching brand-ui agent kit is vendored, its Brand UI skills are discoverable by Claude Code,
   and no package/kit version skew remains.
4. The Brand UI CLI works locally for info, search, docs, and audit.
5. The Brand UI stdio MCP server is merged into .mcp.json without damaging existing servers.
6. The frontend imports Brand token CSS, scans every installed @brand package that emits Tailwind
   classes, mounts the required providers once, and performs any package-specific one-time setup.
7. qlik-bright and qlik-dark both work; qlik-bright is the fallback; a persisted unsupported theme
   cannot take over the app. A “system” preference, if exposed, must resolve only to those two themes.
8. Agent rules state that component APIs must be checked with the CLI/types/manifest, visible UI is
   library-first, raw colors are forbidden, and className is layout-only.
9. Claude edit hooks and repository-level validation detect raw interactive HTML, raw colors,
   forbidden legacy/second-kit imports, inaccessible icon-only controls, and bypassed error-toast
   policy. The full-file/CI check must not rely only on Claude’s edited-text hooks.
10. A real, documented `brand:update` workflow can stage the latest stable or requested tag,
    validate it before replacement, update package paths and the agent kit together, regenerate the
    lockfile/provenance, detect API/peer changes, and run the quality gate.
11. Install, typecheck, tests, production build, lint, Brand UI checks, and relevant visual checks
    are actually run. Report exact results and any pre-existing baseline findings.

Blocking conditions
===================

Stop and ask me only if one of these is true:

- the repository is not a React web project and no React frontend target exists;
- authenticated access to the private release/assets is unavailable;
- the release is missing an expected package or matching agent-kit asset;
- adopting Brand UI requires replacing an incompatible framework or a high-risk major React upgrade;
- an existing policy explicitly conflicts with the fixed requirements above.

Never print, persist, or commit GH_TOKEN/GITHUB_TOKEN. Prefer the authenticated gh CLI. If auth is
missing, state the exact prerequisite (`gh auth login` or an appropriately scoped token) and stop.

Phase 1 — discovery and design
==============================

Before editing:

1. Read repository instructions (AGENTS.md, CLAUDE.md, package-manager config, workspace config).
2. Locate the React frontend(s), application entry, global stylesheet, package manifests, lockfile,
   build config, CI, Docker files, existing .claude rules/hooks/settings, and .mcp.json.
3. Identify package manager and workspace layout. Keep the existing package manager; do not convert
   the project merely to match the reference repository.
4. Inventory existing UI/styling/icon libraries, raw interactive elements, raw colors, theme logic,
   providers, toasts, tables, editors, charts, graph/flow surfaces, and tests.
5. Inspect the selected release’s asset list before downloading. Resolve the tag dynamically with
   `gh release view --repo mreimitz/qlabs-components --json tagName` unless an explicit tag was
   supplied. Do not assume the version shown in this prompt is current.
6. Publish a short implementation map with resolved paths, conflicts, and migration size. Continue
   without waiting when the fixed requirements resolve the decision.

Phase 2 — secure, reproducible vendoring
=======================================

Implement secure staging, not an in-place blind download:

1. Download release assets into a newly created temporary directory. Fetch `brand-*.tgz` and the
   matching `brand-ui-agent-kit-<version>.zip`.
2. Before touching current vendor files, validate:
   - all nine expected package tarballs exist exactly once;
   - every archive is readable and its embedded package.json has the expected @brand name;
   - all package versions match the selected release;
   - the agent kit is readable, contains KIT-README.md, skills/, playbooks/,
     brand-ui.manifest.json, and llms.txt, and declares the same version;
   - no archive path traversal or unexpected absolute paths are present.
3. Only after validation, replace old-version tarballs and the old agent kit as one logical update.
   Preserve a recoverable backup until install and validation finish. Never recursively delete an
   unresolved or broad path.
4. Create/update `vendor/brand/PROVENANCE.md` with:
   source repository and release URL/tag, retrieval method, retrieval date, package name/version,
   sha256 per tarball, lockfile sha512/integrity note, kit version, version-skew policy, and the
   complete update/rollback procedure.
5. Document blank `GH_TOKEN=` and `GITHUB_TOKEN=` examples only if this repository uses an example
   env file. State that they are tooling-only and never read by the runtime. Never add real values.
6. Ensure build contexts and ignore files include the vendored artifacts when dependency
   installation occurs (including Docker, if present).

Phase 3 — dependency and build wiring
=====================================

1. Add @brand/cli at the workspace/root tooling level using the correct relative file: path.
2. Add the eight runtime packages to the actual frontend package with correct relative file: paths.
   Put them in devDependencies only when the frontend is statically bundled and the production
   runtime does not load them from node_modules. For SSR or runtime externalization, use dependencies.
3. Read every tarball’s package.json. Satisfy and align peer dependencies deliberately. Keep one
   compatible React/ReactDOM copy; do not force a React major based on stale documentation.
4. Align direct shared dependencies when required by current package metadata (for example
   @xyflow/react for @brand/flow). Do not add optional heavy peers unless an installed/used package
   requires them.
5. Regenerate the existing lockfile with the repository’s package manager, then prove a frozen or
   immutable install succeeds.
6. If the frontend uses Vite + Tailwind v4, install/configure `@tailwindcss/vite` and add its plugin
   exactly once. For another supported bundler, use its correct Tailwind v4 integration rather than
   copying Vite config.
7. In the global CSS entry:
   - import `@brand/tokens/styles.css` before application overrides;
   - add an explicit `@source` for every installed @brand package whose dist contains class strings,
     using paths correct relative to that CSS file;
   - retain only token-backed application overrides; do not copy source-project-specific density,
     print, or assistant-dock CSS.
8. At the application root, adapt and mount:
   `ThemeProvider(defaultTheme="qlik-bright", defaultDensity="compact")`
   -> `TooltipProvider`
   -> router/application;
   mount one `Toaster`.
   Keep existing provider order when another provider has a real ordering requirement.
9. If @brand/editor is used, import `@brand/editor/monaco-environment` once before any editor mounts.
   If @brand/flow is used, import the required @xyflow/react stylesheet once.
10. Implement a typed theme allow-list around qlik-bright/qlik-dark. Coerce invalid persisted values
    before ThemeProvider mounts. If adding system preference, store preference separately and resolve
    it to an allowed concrete theme without first-paint flash. Add focused tests.

Phase 4 — CLI, MCP, and agent kit
================================

1. Keep the release kit canonically at vendor/brand-ui-agent-kit/.
2. Make its five `brand-ui*` skill directories discoverable in this repository’s `.claude/skills/`
   by copying/syncing them from the canonical kit during initial setup and every update. Do not
   replace unrelated local skills. Keep playbooks, manifest, llms.txt, and per-package llms files in
   the canonical vendor directory.
3. Add package scripts appropriate to the package manager, at minimum:
   - brand:info -> brand-ui info
   - brand:audit -> brand-ui audit <resolved frontend source path>
   - brand:update -> the updater implemented in Phase 6
4. Merge this MCP entry into an existing `.mcp.json`:

   "brand-ui": {
     "command": "node",
     "args": ["./node_modules/@brand/cli/bin/brand-ui.mjs", "mcp"]
   }

   Preserve every unrelated MCP server. If workspace layout means the CLI is installed elsewhere,
   use the real stable path and verify it from the repository root.
5. Verify CLI output with representative calls:
   brand-ui info
   brand-ui search "button"
   brand-ui docs Button ThemeProvider
   brand-ui audit <frontend-source> --json
6. Verify the MCP process starts and responds to an MCP initialize/tool-list smoke test; do not leave
   an orphan process.

Phase 5 — repository policy and enforcement
===========================================

Create or adapt concise repository-specific Claude rules. Do not paste stale app names, paths,
versions, or assumptions from another project.

Required rules:

1. `.claude/rules/brand-ui-only.md`
   - visible interactive/component UI comes from @brand/*;
   - layout-only semantic HTML is allowed;
   - Button asChild + anchor is used for button-styled navigation;
   - no second component/styling/icon system;
   - no raw interactive HTML when a Brand UI component exists;
   - any escape hatch is rare, reasoned inline (`brand-ui-allow: <reason>`), reviewed, and counted.
2. `.claude/rules/library-first.md`
   - search CLI/manifest/types before coding and never guess props;
   - compose existing primitives before creating local wrappers;
   - real gaps are raised upstream instead of becoming silent permanent forks.
3. `.claude/rules/styling-and-tokens.md`
   - semantic token utilities only; no hex/rgb/hsl or Tailwind palette colors;
   - component variants/sizes own appearance; className owns layout;
   - use `cn` from @brand/ui;
   - verify both allowed themes visually.
4. `.claude/rules/dependencies.md`
   - document vendoring, package roles, file: paths, agent kit, CLI/MCP, peer alignment, and
     owner-gated updates.
5. Add/adapt rules for interaction/accessibility, loading versus streaming versus terminal errors,
   icon-only controls, and route-versus-dialog behavior where those concepts apply.
6. Update CLAUDE.md (or the repository’s equivalent agent guide) with the design-system source of
   truth, package map, CLI commands, MCP, agent-kit location, theme policy, update command, and gates.

Create hooks that work with the destination’s real frontend source roots:

- `enforce-brand-ui.mjs`: reject raw button/input/select/textarea/table/dialog markup when covered by
  Brand UI, imports from retired/local adapters, and imports from forbidden second UI kits.
- `check-tokens.mjs`: reject raw hex/rgb/hsl and non-semantic palette utilities in application source.
- `no-title-on-icon-button.mjs`: reject native title on textless Button/IconButton; standardize an
  IconButton wrapper whose one `label` drives both tooltip and aria-label. Disabled reasons must be
  perceivable by keyboard and assistive technology.
- `no-bare-toast-error.mjs`: if the project uses Brand UI toast, route error toasts through one
  wrapper that keeps errors visible until dismissed and announces them accessibly.

Merge hook registrations into `.claude/settings.json`; preserve existing hooks and permissions.
Add focused automated tests for hook parsing and escape hatches. Claude PostToolUse hooks inspect
edits, not the entire repository, so also create a full-file validation command used locally and in
CI. It should report `file:line`, distinguish legacy baseline from new violations during migration,
and fail on regressions.

Add a report-only `.claude/commands/audit-brand-usage.md` that invokes both deterministic local
checks and `brand-ui audit`, explains baseline behavior, and never silently rewrites the app.

Phase 6 — implement the missing updater
========================================

Create a cross-platform, reviewable updater (prefer a Node script plus gh/tar/unzip subprocesses)
and expose it as `brand:update`. It must:

1. accept `--tag <tag>`; otherwise resolve the latest stable release;
2. support `--dry-run` that performs discovery/download/validation/diff reporting without replacing;
3. require authenticated gh access without printing tokens;
4. stage in a unique temp directory and validate all archives as described in Phase 2;
5. report current -> target versions and release notes/link before replacement;
6. compare exported type surfaces or `.d.ts` exports for removed/renamed APIs and report all consumed
   exports affected in this repository;
7. inspect new peer dependencies and flag React/shared-peer divergence;
8. update all file: dependency paths without changing unrelated manifest formatting/content;
9. update the canonical agent kit and sync its five skills into `.claude/skills/`;
10. regenerate the lockfile and PROVENANCE.md checksums;
11. add/update every required CSS @source entry;
12. run CLI smoke tests, full-file Brand UI validation, typecheck, tests, production build, and lint;
13. leave a clear rollback path and never commit/push automatically;
14. fail non-zero on missing assets, version skew, validation failure, or a quality-gate failure;
15. preserve staged evidence/logs long enough to diagnose failure, but never secrets.

Also create `.claude/commands/brand-ui-update.md` as a thin, active wrapper around `brand:update`.
The command must require owner approval for the version bump and summarize API/peer changes and
verification evidence.

Phase 7 — migrate and validate the application
==============================================

1. Use `brand-ui scan`, `map`, and `codemod --dry-run` where supported; inspect proposed changes
   before applying them.
2. Replace existing component-kit UI with the appropriate @brand package:
   - foundations/app UI -> @brand/ui
   - data tables/filtering -> @brand/data
   - brand glyphs -> @brand/icons
   - tokens/themes -> @brand/tokens
   - charts -> @brand/charts
   - assistant/conversation UI -> @brand/ai
   - editors/markdown -> @brand/editor
   - graph/flow UI -> @brand/flow
3. Preserve behavior, accessibility, routing, test selectors where reasonable, and data contracts.
   Do not combine a design-system migration with unrelated product redesign.
4. Remove an old UI kit only after its imports and runtime usage reach zero. Keep generic icons only
   when explicitly sanctioned; do not introduce a third icon library.
5. For an existing app, record the initial audit baseline, fail on newly introduced findings, and
   burn down blocking findings. For a new app, require zero blocking findings. Do not misrepresent
   `brand-ui audit` advisory findings as build failures unless policy says so.
6. Run the repository’s complete quality gate and a frozen/immutable reinstall.
7. Start the real app and inspect representative pages at desktop and mobile widths in both
   qlik-bright and qlik-dark. Check focus, keyboard navigation, overlays, empty/loading/error states,
   icon-only controls, long content, charts/editors/flows that are actually used, and console errors.
8. If visual automation already exists, add focused screenshots/e2e coverage. Do not claim visual
   parity from unit tests alone.

Required final report
=====================

Lead with the outcome. Include:

- resolved frontend/workspace paths and package manager;
- selected release tag and all vendored package/kit versions;
- files created/changed, grouped by supply chain, runtime, agent tooling, enforcement, and tests;
- dependency/peer/API migration decisions and any deviations;
- counts of migrated and remaining old-kit/raw-UI usages;
- CLI/MCP smoke-test evidence;
- exact install/typecheck/test/build/lint/audit/visual commands and results;
- remaining baseline findings or migration ledger, each with owner, priority, and acceptance test;
- confirmation that no secret was stored and no commit/push was performed.

Do not call the work complete if the package/kit versions differ, the updater is only documentation,
the MCP entry was not tested, the app was not checked in both themes, or any required gate was
skipped. If something is blocked, state the blocker and the smallest action I must take.
```

