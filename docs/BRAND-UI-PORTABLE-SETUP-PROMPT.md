# Portable Brand UI setup prompt

This document has two parts:

1. an inventory of the Brand UI integration in `mcp-token-footprint`;
2. a copy-ready prompt for reproducing that integration in another project.

> **Rewritten for `@elabs-ai/components-*` v4.0.0 (public npm).** The previous revision of this
> document described the private-tarball era: nine GitHub Release archives committed under
> `vendor/brand/`, `file:` dependencies, a `GH_TOKEN` fetch step, a `PROVENANCE.md` checksum ledger,
> a vendored agent kit, and a bespoke `brand:update` updater. **All of that is gone.** The packages
> are public on npmjs.org, so the entire supply-chain layer collapses into `pnpm add`. What remains
> portable — and what this prompt is now really about — is the *policy, enforcement and migration*
> layer.

## What is wired into this repository

### Dependencies

- Eight runtime packages in `apps/web/package.json` at `^4.0.0`:
  `@elabs-ai/components-ai`, `-charts`, `-data`, `-editor`, `-flow`, `-icons`, `-tokens`, `-ui`.
  `@elabs-ai/components-cli` is a root `devDependency`.
- Installed from **public npmjs.org**. There is **no `.npmrc`**, no scope registry line, no
  `_authToken`, and no CI token. Install is anonymous.
- Every package ships **in lockstep** at the same version — never mix majors.
- Peers the app owns itself, because each holds a global or a React context and a second copy breaks
  at runtime: `monaco-editor` (`-editor`), `@xyflow/react` (`-flow` and the `-ai` canvas),
  `ai` `^6` (`-ai`), and `tailwindcss` `^4` (`-tokens`; must be the same instance that processes the
  token CSS). All packages are ESM-only; React `^18.2 || ^19`.
- No vendored artifacts, so Docker build stages copy nothing extra — dependency installation is a
  plain `pnpm install --frozen-lockfile`.

### Runtime and build integration

- React consumes the upstream packages directly; the old local
  `@mcp-token-footprint/brand-ui` adapter is retired.
- Tailwind v4 is integrated through `@tailwindcss/vite`.
- `apps/web/src/styles/app.css` imports the **engine** and then **each theme explicitly**:

  ```css
  @import "@elabs-ai/components-tokens/styles.css";        /* engine only */
  @import "@elabs-ai/components-tokens/themes/light.css";  /* opt-in */
  @import "@elabs-ai/components-tokens/themes/dark.css";   /* opt-in */
  ```

  Theme CSS is opt-in since v4; `styles.css` alone renders a neutral `:root` base, not the themes.
  The file also carries an explicit `@source` for every installed package that emits utility class
  names — a missing `@source` renders that package's components **unstyled with no error**.
- `apps/web/src/main.tsx` mounts `ThemeProvider`, `TooltipProvider`, and one `Toaster`.
  It also imports `@elabs-ai/components-editor/monaco-environment` and `@xyflow/react/dist/style.css`.
- The application exposes `light` (default) and `dark` — the two reference themes the library ships.
  A "system" preference resolves to one of them. Note `ThemeName` is `string`, not a union, so the
  compiler will not catch a typo'd theme name; narrow with `isBuiltInThemeName` or
  `useTheme().themes`. `ThemeProvider` also accepts `allowedThemes` if a subset must be enforced.
- One deliberate app-side token override: the **light** focus ring (`--ring` / `--sidebar-ring`),
  because upstream v4 aliases `--ring` to the brand lime `--primary`, which measures 1.30–1.42:1 on
  light and fails WCAG 2.4.7 / 1.4.11. Gated by tests.
- Styling is restricted to semantic token utilities. Component `className` is for layout,
  while component variants and sizes control appearance. The chart ramp is `--chart-1` … `--chart-12`.

### Agent context, CLI, and MCP

- The CLI is invoked as `pnpm exec brand-ui`. Useful commands: `info`, `search`, `docs`, `audit`,
  `context`, `scan`, `map`, `codemod`, `scaffold`, and `mcp`. `--json` is supported by `info`,
  `search`, `scan`, `map`, `audit` and `docs`.
- `.mcp.json` registers the stdio MCP server with:
  `node ./node_modules/@elabs-ai/components-cli/bin/brand-ui.mjs mcp`.
- `brand-ui context` generates a portable ground-truth snapshot; this repo keeps it at
  [`brand-ui-context.md`](./brand-ui-context.md). The snapshot is a convenience — `brand-ui docs
  <Component>` is the authority, because it reads props from source.
- `CLAUDE.md` tells agents that Brand UI is the UI source of truth, points them at the rules and the
  CLI, and forbids guessing component props.

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

### Updating

Updating is now `pnpm up "@elabs-ai/components-*@^X"` across every package at once, plus a re-check
of the peer table (a major can promote a dependency to a peer, as v4 did for `monaco-editor`), then
the quality gate. It stays **owner-gated** — a version bump needs approval before commit. The old
bespoke `brand:update` staging/checksum/rollback machinery existed only because the packages were
private tarballs; it is not needed and should not be recreated.

---

## Copy-ready prompt

Paste everything inside the following block into the root of the destination repository.

```text
You are the technical owner of this repository. Implement a production-grade integration of the
@elabs-ai/components-* Brand UI design system (public npm). Do not merely add dependencies:
reproduce the runtime, agent-context, CLI/MCP, policy, enforcement, and verification layers described
below. Inspect this repository first and adapt paths/configuration to its actual stack. Preserve
unrelated work and merge existing configuration; do not overwrite it wholesale.

Fixed inputs and defaults
=========================

- Packages (public on npmjs.org, no auth, all at the SAME version — they ship in lockstep):
  @elabs-ai/components-tokens   (required: themes + ThemeProvider + the Tailwind token entry)
  @elabs-ai/components-ui       (required: all foundation/app components, cn)
  @elabs-ai/components-icons    (brand glyphs + BrandLogo)
  @elabs-ai/components-data     (DataTable, SearchInput, FilterBar, FacetFilter, ColumnPicker)
  @elabs-ai/components-ai       (ChatShell, Conversation, Message, PromptInput, Tool, Reasoning)
  @elabs-ai/components-charts   (MetricCard, ChartCard, chart primitives)
  @elabs-ai/components-editor   (Monaco CodeEditor/DiffEditor, MarkdownEditor)
  @elabs-ai/components-flow     (branded React Flow canvas)
  @elabs-ai/components-maps     (MapLibre)      — only if the app has maps
  @elabs-ai/components-marketing(Hero, CTA, …)  — only for marketing surfaces
  @elabs-ai/components-viewer   (FileViewer)    — only if the app views arbitrary files
  @elabs-ai/components-cli      (dev tooling; root devDependency)
  Install only what is used. There is NO -blueprint package; it was removed with no replacement.
- Peers the APP must install itself (each owns a global or a React context — two copies break at
  runtime), only when the matching package is installed:
  monaco-editor   with -editor
  maplibre-gl     with -maps
  @xyflow/react   with -flow or the -ai canvas
  ai (Vercel AI SDK ^6) with -ai
  tailwindcss ^4  must be the SAME instance that processes the token CSS
- All packages are ESM-only. React ^18.2 || ^19.
- Reference themes: light (the library DEFAULT_THEME) and dark. Author your own with defineTheme +
  ThemeProvider's `themes` registry only if genuinely required; a custom theme must define the full
  token contract, including --chart-1 … --chart-12.
- Default density for a dense/operator app: compact.
- Migration scope: full Brand UI parity. Existing visible UI should ultimately use
  @elabs-ai/components-* components and semantic tokens. If the repository is too large for a safe
  single-pass migration, complete all infrastructure/enforcement work and leave a quantified,
  ordered migration ledger; do not claim the UI migration is complete.
- Version updates are owner-gated: automation may prepare and verify an update, but must not commit,
  push, or silently accept breaking API changes.

Goal and measurable acceptance criteria
=======================================

The result is accepted only when:

1. All selected @elabs-ai/components-* packages are installed from public npm at one identical
   version, in the correct package manifests, and the lockfile is regenerated.
2. NO registry/auth configuration was added: no @elabs-ai:registry line, no _authToken, no CI token.
   (Add a registry line only for a genuine private mirror.)
3. Every peer listed above that a chosen package requires is a DIRECT dependency of the app, and
   exactly one copy of each resolves.
4. The Brand UI CLI works locally for info, search, docs, and audit.
5. The Brand UI stdio MCP server is merged into .mcp.json without damaging existing servers.
6. The frontend imports the token ENGINE plus one stylesheet PER THEME it ships, scans every
   installed package that emits Tailwind classes, mounts the required providers once, and performs
   any package-specific one-time setup.
7. light and dark both work; light is the fallback; a persisted unsupported theme cannot take over
   the app. A "system" preference, if exposed, resolves only to a shipped theme. Because ThemeName is
   `string` and not a union, theme names are narrowed with isBuiltInThemeName / useTheme().themes or
   constrained with ThemeProvider's allowedThemes — never by an unchecked string literal.
8. Agent rules state that component APIs must be checked with the CLI/types, visible UI is
   library-first, raw colors are forbidden, and className is layout-only.
9. Claude edit hooks and repository-level validation detect raw interactive HTML, raw colors,
   forbidden legacy/second-kit imports, inaccessible icon-only controls, and bypassed error-toast
   policy. The full-file/CI check must not rely only on Claude's edited-text hooks.
10. Install, typecheck, tests, production build, lint, Brand UI audit, and relevant visual checks are
    actually run. Report exact results and any pre-existing baseline findings.

Blocking conditions
===================

Stop and ask me only if one of these is true:

- the repository is not a React web project and no React frontend target exists;
- adopting Brand UI requires replacing an incompatible framework or a high-risk major React upgrade;
- an existing policy explicitly conflicts with the fixed requirements above.

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
5. Resolve the current version with `npm view @elabs-ai/components-ui version` unless a tag was
   supplied. Do not assume the version shown in this prompt is current.
6. Publish a short implementation map with resolved paths, conflicts, and migration size. Continue
   without waiting when the fixed requirements resolve the decision.

Phase 2 — dependency and build wiring
=====================================

1. Add @elabs-ai/components-cli at the workspace/root tooling level.
2. Add the runtime packages to the actual frontend package. Put them in devDependencies only when the
   frontend is statically bundled and the production runtime does not load them from node_modules.
   For SSR or runtime externalization, use dependencies.
3. Read every package's package.json. Satisfy and align peer dependencies deliberately — the peer
   list is authoritative, not this prompt. Keep one compatible React/ReactDOM copy; do not force a
   React major based on stale documentation. Prove exactly one copy of each context-owning peer
   resolves.
4. Regenerate the lockfile with the repository's package manager, then prove a frozen/immutable
   install succeeds.
5. If the frontend uses Vite + Tailwind v4, install/configure `@tailwindcss/vite` and add its plugin
   exactly once. For another supported bundler, use its correct Tailwind v4 integration.
6. In the global CSS entry:
   - import `@elabs-ai/components-tokens/styles.css` (the ENGINE) before application overrides;
   - import `@elabs-ai/components-tokens/themes/<name>.css` for EVERY theme the app ships. This is
     opt-in since v4; the engine alone renders a neutral :root base and none of the themes;
   - add an explicit `@source` for every installed package whose dist contains class strings, using
     paths correct relative to that CSS file. VERIFY each one resolves on disk — a missing @source
     renders that package unstyled with no error;
   - retain only token-backed application overrides; do not copy source-project-specific density,
     print, or dock CSS.
7. At the application root, adapt and mount:
   `ThemeProvider(defaultTheme="light", defaultDensity="compact")`
   -> `TooltipProvider`
   -> router/application;
   mount one `Toaster`. Keep existing provider order when another provider has a real ordering
   requirement.
8. If -editor is used, import `@elabs-ai/components-editor/monaco-environment` once before any editor
   mounts. If -flow is used, import the required @xyflow/react stylesheet once.
9. Implement theme handling around the shipped themes. Coerce invalid persisted values before
   ThemeProvider mounts (a stale slug is rejected and the app lands on the default). If adding system
   preference, store it separately and resolve it to a concrete theme without first-paint flash. Add
   focused tests.
10. ACCESSIBILITY, non-optional: measure the focus ring against every surface it can be drawn on, in
    every theme, and assert 3:1 (WCAG 2.4.7 / 1.4.11) in a test. On the light theme the shipped
    --ring aliases the brand lime --primary and measures ~1.2-1.4:1, which is invisible focus for a
    keyboard user; override --ring in a [data-theme="light"]-scoped block. If the theme nests a dark
    rail inside a light content area, --sidebar-ring needs its own value too, since it aliases --ring.

Phase 3 — CLI, MCP, and agent context
=====================================

1. Add package scripts appropriate to the package manager, at minimum:
   - brand:info    -> brand-ui info
   - brand:audit   -> brand-ui audit <resolved frontend source path>
   - brand:context -> brand-ui context
2. Merge this MCP entry into an existing `.mcp.json`:

   "brand-ui": {
     "command": "node",
     "args": ["./node_modules/@elabs-ai/components-cli/bin/brand-ui.mjs", "mcp"]
   }

   Preserve every unrelated MCP server. If workspace layout means the CLI is installed elsewhere,
   use the real stable path and verify it from the repository root.
3. Generate the portable ground-truth snapshot with `brand-ui context` and commit it where the
   repository keeps docs. Treat it as a convenience; `brand-ui docs <Component>` is the authority.
4. Verify CLI output with representative calls:
   brand-ui info
   brand-ui search "button"
   brand-ui docs Button ThemeProvider
   brand-ui audit <frontend-source> --json
5. Verify the MCP process starts and responds to an MCP initialize/tool-list smoke test; do not leave
   an orphan process.

Phase 4 — repository policy and enforcement
===========================================

Create or adapt concise repository-specific Claude rules. Do not paste stale app names, paths,
versions, or assumptions from another project.

Required rules:

1. `.claude/rules/brand-ui-only.md`
   - visible interactive/component UI comes from @elabs-ai/components-*;
   - layout-only semantic HTML is allowed;
   - Button asChild + anchor is used for button-styled navigation;
   - no second component/styling/icon system;
   - no raw interactive HTML when a Brand UI component exists;
   - any escape hatch is rare, reasoned inline (`brand-ui-allow: <reason>`), reviewed, and counted.
2. `.claude/rules/library-first.md`
   - search CLI/types before coding and NEVER guess props or trust memory;
   - if `brand-ui docs` lists anti-patterns for a component, follow them;
   - compose existing primitives before creating local wrappers, and delete a local wrapper once
     upstream ships the prop it was standing in for;
   - real gaps are raised upstream instead of becoming silent permanent forks.
3. `.claude/rules/styling-and-tokens.md`
   - semantic token utilities only; no hex/rgb/hsl or Tailwind palette colors;
   - component variants/sizes own appearance; className owns layout;
   - use `cn` from @elabs-ai/components-ui;
   - theme CSS is opt-in per theme; adding a theme means adding its @import;
   - the chart ramp is --chart-1 … --chart-12 and cycles all twelve before repeating;
   - verify every shipped theme visually.
4. `.claude/rules/dependencies.md`
   - document the package roles, the lockstep version rule, the peers the app owns and why,
     the CLI/MCP as ground truth, and owner-gated updates.
5. Add/adapt rules for interaction/accessibility, loading versus streaming versus terminal errors,
   icon-only controls, and route-versus-dialog behavior where those concepts apply.
6. Update CLAUDE.md (or the repository's equivalent agent guide) with the design-system source of
   truth, package map, CLI commands, MCP, theme policy, and gates.

Create hooks that work with the destination's real frontend source roots:

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

Phase 5 — migrate and validate the application
==============================================

1. Use `brand-ui scan`, `map`, and `codemod --dry-run` where supported; inspect proposed changes
   before applying them.
2. Replace existing component-kit UI with the appropriate package:
   - foundations/app UI -> @elabs-ai/components-ui
   - data tables/filtering -> @elabs-ai/components-data
   - brand glyphs -> @elabs-ai/components-icons
   - tokens/themes -> @elabs-ai/components-tokens
   - charts -> @elabs-ai/components-charts
   - assistant/conversation UI -> @elabs-ai/components-ai
   - editors/markdown -> @elabs-ai/components-editor
   - graph/flow UI -> @elabs-ai/components-flow
3. Preserve behavior, accessibility, routing, test selectors where reasonable, and data contracts.
   Do not combine a design-system migration with unrelated product redesign.
4. Remove an old UI kit only after its imports and runtime usage reach zero. Keep generic icons only
   when explicitly sanctioned; do not introduce a third icon library.
5. Watch for defaults that changed rather than APIs that broke — those are the ones typecheck cannot
   catch. In particular: BentoGrid's cursor glow is opt-in via `spotlight` (the grid rests flat and
   lifts on hover); the decoration dial paints backgrounds and chart fills ONLY, so controls render
   identically at 0 and 10; Inter is the UI face everywhere (Source Sans 3 is not vendored — ship it
   yourself if a local theme referenced it); the status palette and chart ramp were retuned. Decide
   each one deliberately and record the decision at the call site.
6. For an existing app, record the initial audit baseline, fail on newly introduced findings, and
   burn down blocking findings. For a new app, require zero blocking findings. Do not misrepresent
   `brand-ui audit` advisory findings as build failures unless policy says so.
7. Run the repository's complete quality gate and a frozen/immutable reinstall.
8. Start the real app and inspect representative pages at desktop and mobile widths in every shipped
   theme. Check focus (see Phase 2 step 10), keyboard navigation, overlays, empty/loading/error
   states, icon-only controls, long content, charts/editors/flows that are actually used, and console
   errors.
9. Visual-regression baselines WILL change — BrandLogo, the default palette and the fonts are a
   different visual identity. Show the diffs before updating baselines; never refresh them silently.
   Do not claim visual parity from unit tests alone.

Required final report
=====================

Lead with the outcome. Include:

- resolved frontend/workspace paths and package manager;
- the installed version and the full package list;
- files created/changed, grouped by dependencies, runtime, agent tooling, enforcement, and tests;
- dependency/peer/API migration decisions and any deviations;
- counts of migrated and remaining old-kit/raw-UI usages;
- CLI/MCP smoke-test evidence;
- exact install/typecheck/test/build/lint/audit/visual commands and results;
- the focus-ring measurement per theme, with the numbers;
- remaining baseline findings or migration ledger, each with owner, priority, and acceptance test;
- confirmation that no registry/auth configuration was added and no commit/push was performed.

Do not call the work complete if package versions differ from each other, the MCP entry was not
tested, the app was not checked in every shipped theme, focus visibility was not measured, or any
required gate was skipped. If something is blocked, state the blocker and the smallest action I must
take.
```
