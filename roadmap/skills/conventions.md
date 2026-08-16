# Skills plan — conventions (every WP assumes these)

Shared rules for all Skills work packages. These mirror the repo rules (`CLAUDE.md`, `.claude/rules/`)
and the Testing plan's conventions; deviations are called out per WP.

## Quality gate (definition of done)
`pnpm typecheck && pnpm test && pnpm build && pnpm lint` must pass from the repo root (linting is
**Biome**, `biome.json`; the root `.github/workflows/ci.yml` runs the same set on push + PR). A WP is
done only when the gate is green **and** its Acceptance checklist is met.

## Contract-first
Any wire shape changes land in `packages/shared` **first** (`types.ts`, `schemas.ts`, `constants.ts`,
re-exported from `index.ts`), then the API, then the web. WP 1.0 owns the whole Skills contract so
later WPs never reshape it. Additive `/api` routes only (versionless MVP).

## API runtime / secret boundary
Only `apps/api` touches the network, the filesystem, `git`, and decrypted secrets. The web receives
**redacted** data only. The single skill secret is a GitHub PAT — encrypt it with the existing
`SecretStore` (`enc:v1:` AES-256-GCM), never return it (expose `hasAuth: boolean` only), mirror
`ServerRepository`'s public/internal split.

## Storage model
Content-addressed blobs: `skill_blobs` keyed by `sha256`; `skill_files` map `(version_id, path) →
blob_sha`. Versions are immutable. `nanoid()` ids. Multi-table writes in `db.transaction(...)`.
Schema via `CREATE TABLE IF NOT EXISTS` in `db/schema.ts` + additive `ensureColumn` migrations in
`db/database.ts`; row types in `db/rows.ts`. Blob GC (`DELETE … WHERE sha256 NOT IN (SELECT blob_sha
FROM skill_files)`) runs inside any skill/version delete transaction.

## Token accounting
Reuse `apps/api/src/token-counting/` (`TokenCounter`, default `generic_o200k`). Count L1 (name +
description), L2 (SKILL.md body), L3 (all other text files); binary files → 0 tokens. Store level
subtotals on `skill_versions` and per-file totals on `skill_files`. Follows the same profile the
scans pipeline uses so skill and server footprints are comparable.

## Security posture
The app **never executes** skill content (Phase 1 inspects; Phase 2's `read_skill_file` only *reads*).
Surface scripts and external-URL references in the inspector. Enforce size caps at ingest
(`SKILL_MAX_FILE_BYTES`, `SKILL_MAX_TOTAL_BYTES`, a file-count cap = zip-bomb guard). Never auto-run.

## New dependencies (owner-approved 2026-07-01, WP 1.0)
`@fastify/multipart` (uploads), `fflate` (unzip + zip build), `diff`/jsdiff (line-count deltas),
`yaml` (frontmatter). All MIT/BSD, pure-JS, no native compile. `git` used via CLI (no dep). No new
**web** dependency — the inspector composes existing `@brand/*` (`FileTree`@ai, `DiffEditor`/
`CodeEditor`@editor, `MarkdownEditor`@editor, `DataTable`@data, MetricCard@charts, Dialog/Tabs/
ResizablePanelGroup/Badge/StatePanel@ui).

## UI rules
`@brand/*` components only (enforced by `enforce-brand-ui` hook). Semantic oklch tokens, no raw
colors (`check-tokens` hook). Two themes (`qlik-bright` default + `qlik-dark`) — every surface must
read correctly in both. `className` is layout-only; use component `variant`/`size` for looks. State
is `useState` + `localStorage`; API via `apiGet/apiPost/apiPut/apiDelete` + an `apiUpload` helper for
multipart. Feedback via `pushToast`.

## Nav
Skills is its **own** `SidebarGroup` (label "Skills"), rendered **between** the MCP-analyzer and
Testing groups in `AppShell.tsx` (order MCP → Skills → Testing). Extend `ViewKey` with `"skills"`;
`SKILL_NAV_ITEMS = [{ key:"skills", label:"Skills", icon: Sparkles }]`.

## Naming / tests
TS files kebab-case; React components PascalCase; co-locate tests as `name.test.ts`. API tests are
keyless (mock where a network/secret would be needed); GitHub tests use a local `file://` fixture
remote. Honest reporting: lead with what you did **not** verify (visual/a11y claims cite the running
app at `localhost:8080`, not a mock).

## Reference
Design detail per topic in [`../../research/skill-registry/`](../../research/skill-registry/):
data model `03`, versioning/diff `04`, API `05`, ingestion/GitHub `06`, UI `07`, attachment `08`,
skill-loading research `11`. Cite these instead of duplicating.
