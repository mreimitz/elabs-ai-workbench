---
type: "Research Output"
title: "03 \u2014 Data model"
description: "New tables live in apps/api/src/db/schema.ts (created with CREATE TABLE IF NOT EXISTS, evolved"
tags: ["research", "RS-02"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# 03 — Data model

New tables live in `apps/api/src/db/schema.ts` (created with `CREATE TABLE IF NOT EXISTS`, evolved
with `ensureColumn` — same as every other table). All IDs are `nanoid()`. All timestamps are ISO
strings. Row types go in `apps/api/src/db/rows.ts`.

## Entity model

```
skill (1) ────< skill_version (N)      one skill, ordered immutable versions
skill_version (1) ────< skill_file (N) a version is a path→blob map
skill_file (N) >──── skill_blob (1)    content-addressed; files reference blobs by sha256
skill (1) ────< scenario_skill (N)     Phase 2 attachment (mirrors scenario_servers)
```

**Design choice — content-addressed blob store.** File *contents* are stored once, keyed by
`sha256`, in `skill_blobs`; a `skill_file` row is just `(version_id, path) → blob_sha`. Benefits:
(1) uploading v2 of a skill where only `SKILL.md` changed stores exactly one new blob; (2) the
full-tree diff between two versions is a cheap join/compare of `path → blob_sha` maps — identical
hash ⇒ unchanged, no byte comparison needed; (3) rename detection falls out (same `blob_sha`, new
`path`). This is the standard git object model, scaled down.

## DDL

```sql
-- The logical skill (stable identity across versions).
CREATE TABLE IF NOT EXISTS skills (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,                 -- SKILL.md `name` (== skill dir name)
  display_name       TEXT NOT NULL,                 -- user-facing label (defaults to name)
  slug               TEXT NOT NULL UNIQUE,          -- url-safe unique key within the app
  source_type        TEXT NOT NULL CHECK (source_type IN ('upload', 'github')),
  description         TEXT,                          -- cached from the current version's frontmatter
  current_version_id TEXT REFERENCES skill_versions(id) ON DELETE SET NULL,
  -- GitHub binding (NULL for uploads):
  github_repo_url    TEXT,                           -- e.g. https://github.com/anthropics/skills
  github_ref         TEXT,                           -- branch or tag tracked for "pull latest"
  github_subpath     TEXT,                           -- dir within the repo that holds SKILL.md
  github_auth_ref    TEXT,                           -- encrypted PAT blob (SecretStore), NULL if public
  github_last_sha    TEXT,                           -- last imported commit sha (change detection)
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

-- An immutable snapshot of the skill's folder tree.
CREATE TABLE IF NOT EXISTS skill_versions (
  id             TEXT PRIMARY KEY,
  skill_id       TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  seq            INTEGER NOT NULL,                    -- 1,2,3… monotonic per skill (ordering + fallback label)
  version_label  TEXT NOT NULL,                       -- metadata.version || git short-sha || "v{seq}"
  tree_sha       TEXT NOT NULL,                        -- sha256 over the sorted (path, blob_sha) list
  source_kind    TEXT NOT NULL CHECK (source_kind IN ('upload', 'github')),
  source_ref     TEXT,                                 -- upload filename | git commit sha
  -- Parsed SKILL.md frontmatter (validated), stored as JSON:
  manifest_json  TEXT NOT NULL DEFAULT '{}',           -- { name, description, license?, compatibility?, metadata?, allowedTools? }
  manifest_valid INTEGER NOT NULL DEFAULT 1,           -- 0 if frontmatter failed validation
  manifest_errors_json TEXT NOT NULL DEFAULT '[]',
  -- Aggregate metrics (default token profile):
  token_profile      TEXT NOT NULL,
  file_count         INTEGER NOT NULL,
  total_bytes        INTEGER NOT NULL,
  l1_metadata_tokens INTEGER NOT NULL DEFAULT 0,       -- name+description (always-loaded cost)
  l2_body_tokens     INTEGER NOT NULL DEFAULT 0,       -- SKILL.md body (on-trigger cost)
  l3_resource_tokens INTEGER NOT NULL DEFAULT 0,       -- everything else (on-demand cost)
  total_tokens       INTEGER NOT NULL DEFAULT 0,
  imported_from      TEXT NOT NULL CHECK (imported_from IN ('upload', 'github-pull')),
  note               TEXT,                              -- optional user note per version
  created_at         TEXT NOT NULL,
  UNIQUE (skill_id, seq)
);

-- Deduplicated file contents (content-addressed).
CREATE TABLE IF NOT EXISTS skill_blobs (
  sha256      TEXT PRIMARY KEY,
  content     BLOB NOT NULL,                            -- raw bytes (text or binary)
  size        INTEGER NOT NULL,
  is_binary   INTEGER NOT NULL DEFAULT 0,               -- heuristic: NUL byte / non-UTF8
  created_at  TEXT NOT NULL
);

-- The path→blob map for a version, plus per-file metrics.
CREATE TABLE IF NOT EXISTS skill_files (
  id           TEXT PRIMARY KEY,
  version_id   TEXT NOT NULL REFERENCES skill_versions(id) ON DELETE CASCADE,
  path         TEXT NOT NULL,                            -- posix path relative to skill root, e.g. references/FORMS.md
  blob_sha     TEXT NOT NULL REFERENCES skill_blobs(sha256),
  size         INTEGER NOT NULL,
  is_binary    INTEGER NOT NULL DEFAULT 0,
  is_skill_md  INTEGER NOT NULL DEFAULT 0,               -- the root SKILL.md
  kind         TEXT NOT NULL DEFAULT 'other'
                 CHECK (kind IN ('skill_md','reference','script','asset','other')),
  token_total  INTEGER NOT NULL DEFAULT 0,               -- 0 for binary
  UNIQUE (version_id, path)
);

-- Phase 2 — scenario attachment (mirrors scenario_servers).
CREATE TABLE IF NOT EXISTS scenario_skills (
  scenario_id       TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  skill_id          TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  version_mode      TEXT NOT NULL DEFAULT 'latest' CHECK (version_mode IN ('latest','pinned')),
  pinned_version_id TEXT REFERENCES skill_versions(id) ON DELETE CASCADE,
  PRIMARY KEY (scenario_id, skill_id)
);
```

### Indices

```sql
CREATE INDEX IF NOT EXISTS idx_skill_versions_skill_seq   ON skill_versions(skill_id, seq DESC);
CREATE INDEX IF NOT EXISTS idx_skill_files_version        ON skill_files(version_id, path ASC);
CREATE INDEX IF NOT EXISTS idx_skill_files_blob           ON skill_files(blob_sha);
CREATE INDEX IF NOT EXISTS idx_scenario_skills_skill      ON scenario_skills(skill_id);
```

## Notes & invariants

- **`current_version_id`** always points at the highest-`seq` version after an import; the UI can
  still open any historical version. `ON DELETE SET NULL` avoids a circular-delete problem; deleting
  a skill cascades to its versions/files (and `scenario_skills`) but blobs are cleaned by a small GC
  (below).
- **`tree_sha`** is the change-detection key. On import we compute it; if it equals the current
  version's `tree_sha` we create **no** new version (GitHub "pull latest" is then a no-op that
  reports "already up to date").
- **Blob GC.** Because blobs are shared, deletion can't cascade. A `deleteOrphanBlobs()` sweep
  (`DELETE FROM skill_blobs WHERE sha256 NOT IN (SELECT blob_sha FROM skill_files)`) runs after any
  skill/version delete inside the same transaction. Cheap at this scale (single-owner local app).
- **Binary handling.** `is_binary` files store bytes in the blob but `token_total = 0` and are shown
  in the explorer as "binary — N bytes" with a download/preview affordance, never fed to the diff
  line viewer (diff shows "binary changed" by hash).
- **Redaction.** Skills carry no per-file secrets, so `skill_files`/`skill_blobs` are safe to expose
  (content is the point). The **only** secret is `github_auth_ref` (a PAT), encrypted via
  `SecretStore` and surfaced to the web as a boolean `hasGithubAuth` only — same pattern as
  `hasEnvSecrets`.
- **Size guardrails.** Enforce per-file (e.g. 5 MB) and per-skill (e.g. 50 MB) caps at ingest to
  keep the SQLite row/blob sizes sane; configurable via env (`SKILL_MAX_FILE_BYTES`,
  `SKILL_MAX_TOTAL_BYTES`). Reject archives exceeding a file-count cap (zip-bomb guard).

## Storage alternative considered

Storing files on disk under `DATA_DIR/skills/<skill>/<version>/…` instead of blobs in SQLite was
considered. Rejected for Phase 1: the app's persistence story is "one SQLite file" (`CLAUDE.md` §3,
§7), Docker mounts a single `/data` volume, and content-addressed blobs give dedupe + trivial diff
for free. If skills grow large (big binary assets), a future migration can move `skill_blobs.content`
to files keyed by `sha256` without touching the rest of the schema.

# Citations

None.
