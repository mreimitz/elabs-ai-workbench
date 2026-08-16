# Phase 4 — Collections & GitHub two-way sync (WP specs)

## WP 4.1 — Contract + schema: collections, membership, file format
**Size:** M · **Depends on:** 1.1 · shared + API migration

**Objective:** the Collection entity (B10) and the on-disk contract (B12) — serializers first,
git later.

**Files:** `packages/shared` (`Collection` (redacted: `hasPat` boolean, never the value),
`TestFile`/`SuiteFile` zod schemas — the **on-disk** shapes with `externalKey`, `formatVersion:
1`; sync-state shapes `{ ahead, behind, dirty, conflicts[] }`); migration: `collections` table,
`tests.collection_id` + `suites.collection_id` (nullable), `external_key` columns (generated
on first export/import, unique per collection); `apps/api/src/collections/` (new:
repository + service + routes — CRUD + membership assign/remove; PAT stored via the existing
`secrets/` store); `serializer.ts` (DB row ⇄ file: deterministic key order, 2-space indent,
trailing newline; **no local ids, no provider/server references, no secrets** — asserted).
Tests `benchmarks-collections-contract.test.ts` incl. a golden-file snapshot.

**Acceptance:** serialize → deserialize round-trips losslessly; golden files byte-stable across
runs; a test with attachments serializes with a `warnings: attachments-not-synced` marker; PAT
never in any response (asserted); moving a test between collections re-keys safely; gate green.

## WP 4.2 — Git engine: clone, export/commit, fetch + merge, conflicts
**Size:** L · **Depends on:** 4.1 · API

**Objective:** real-git two-way sync (B11) with the skills-git trust model.

**Files:** `apps/api/src/collections/git-sync.ts` — working clone per collection at
`DATA_DIR/collections/<id>` (clone on bind; re-clone on corruption); **extract & reuse** the
credential/SSRF/redaction/timeout helpers from `apps/api/src/skills/git-service.ts` (shared
module, one implementation — same move WP 7.1 made for publish); sync pipeline:
(1) materialize local state into the worktree (serializer), (2) commit if dirty (author
`mcp-token-footprint <local@benchmarks>`, message `sync: <n> changed`), (3) fetch, (4) status →
`{ahead, behind, diverged}`, (5) fast-forward or `git merge` (never rebase-rewrite, **never
force-push**), (6) conflicts → parse `git status` porcelain → per-file conflict entries (both
sides' parsed content returned for the UI), resolution endpoint writes chosen/edited content,
commits, pushes. Import-bootstrap: bind an existing repo+path → pull all files → create
tests/suites (externalKey adopted). Routes: `POST /api/collections/:id/sync`,
`GET /api/collections/:id/status`, `POST /api/collections/:id/resolve`. Tests
`benchmarks-git-sync.test.ts` against **local `file://` bare repos** (fully offline — the WP 7.1
pattern), covering: clean push, clean pull, both-changed merge, true conflict + resolution,
remote-deleted vs local-edited.

**Acceptance:** the offline matrix above green; PAT proven absent from responses AND captured
logs; no force-push code path exists (asserted by grepping the argv builder in a test); sync is
idempotent when nothing changed (`unchanged`); zod-invalid remote file → sync fails cleanly
naming the file, DB untouched; gate green. ⚠ live-GitHub path (private repo, PAT) is
owner-acceptance.

## WP 4.3 — Sync UI: collection manager + conflict resolution
**Size:** L · **Depends on:** 4.2 · Web-only

**Objective:** the operator surface for B10/B11.

**Files:** `apps/web/src/features/testing/collections/` — `/testing/collections` (list: repo,
branch, sync state badges ahead/behind/dirty/conflict; create/bind wizard: repo URL + path +
branch + PAT (write-only field), import-bootstrap option; per-collection detail: membership
management (assign tests/suites), **diff preview before sync** (added/changed/removed, field-level
diff via existing diff composition), sync action with busy/progress, **conflict resolution
screen**: per-file side-by-side (take-local / take-remote / edit merged), resolve → re-sync).
Test/suite editors show a collection badge + picker.

**Acceptance:** live walk against a local bare repo: bind → export → edit both sides → sync →
resolve a real conflict → both sides converge; PAT field never echoes a stored value; destructive
choices confirmed; empty/loading/error states; both themes; gate green.

## WP 4.4 — InsightBench importer
**Size:** M · **Depends on:** 4.1 · API + minimal UI

**Objective:** one-way import of the colleague's dataset/results (B13) so the 425-question suite
is runnable here.

**Files:** `apps/api/src/collections/insightbench-import.ts` —
`POST /api/collections/import/insightbench` (multipart or path: `questions.json` and/or answered
result files): app entry → tags `[app-name]` + `category` + difficulty mapping (1–2 easy /
3 medium / 4 hard — the prototype's `DIFF_LEVEL_MAP`), question → test (`qlik_question` →
userPrompt, name from question text, `gt_insight`/`gt_insight_value` → expectations,
`gt_code` → `referenceLogic{kind:'code',language:'python'}`); unanswerable-insight regex port
(`convert_to_benchmarks.py` patterns) → `answerable:false`; one suite per import (ordered by
app/question); dedupe by content hash on re-import. Small web entry point: an Import action on
the collections screen. Fixture test with a trimmed real `questions.json` sample.

**Acceptance:** fixture import produces the expected tests/suite (counts, one spot-checked
expectation incl. referenceLogic body, an `answerable:false` case); re-import is idempotent;
import never writes his format back (no exporter exists — asserted); gate green.
