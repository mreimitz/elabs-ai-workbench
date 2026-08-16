# 04 — Versioning & deep "what-changed" diff

## Version model

A **version** is an immutable snapshot (`skill_versions` + its `skill_files`). Versions are created,
never edited. `seq` gives a total order per skill; `current_version_id` tracks the newest.

Both source types funnel through **one** create-version routine:

```
ingest(files: {path, bytes}[], source) →
  1. locate skill root (dir containing SKILL.md); rebase all paths to it
  2. parse + validate SKILL.md frontmatter → manifest {name, description, …}
  3. for each file: sha256(bytes), upsert skill_blob, classify kind, count tokens (text only)
  4. tree_sha = sha256( sort(path + ':' + blob_sha).join('\n') )
  5. if skill.current_version.tree_sha === tree_sha → STOP (no change)
  6. else insert skill_version(seq = prev+1, label, l1/l2/l3 token subtotals, …) + skill_files
  7. set skills.current_version_id; recompute cached description; GC orphan blobs
```

### Deriving the version label (spec has no `version` field)

Priority order (from [`01`](./01-agent-skills-format.md) — `metadata.version` is only a convention):

1. `manifest.metadata.version` if present **and** not already used by an existing version of this
   skill (e.g. `"1.0"`).
2. For GitHub imports: the **git short SHA** (`source_ref[0:7]`).
3. Fallback: `"v{seq}"`.

The label is display-only; `seq` and `tree_sha` are the machine keys. The UI always shows
`label · seq · short source_ref · date`.

## Change detection

- **Upload:** every accepted upload runs `ingest`; step 5 makes a re-upload of identical bytes a
  no-op ("already up to date — identical contents"). A changed upload → new version.
- **GitHub "pull latest":** fetch the tracked `github_ref`, resolve `github_subpath`, read files,
  run `ingest`. If the resolved commit SHA equals `github_last_sha` we can short-circuit before even
  hashing; otherwise `tree_sha` still guards against commits that didn't touch the skill subdir.
  On a new version we route the UI straight to the **Diff** view (prev → new) so "pull = see what
  changed" is one click.

## Full-tree diff algorithm

Given versions **A** (from) and **B** (to), each a `Map<path, blob_sha>`:

```
added      = paths in B not in A
removed    = paths in A not in B
modified   = paths in both where A.sha !== B.sha
unchanged  = paths in both where A.sha === B.sha
renamed    = detect over (added, removed): an added path and a removed path sharing the same
             blob_sha are reported as a rename (old → new), and pulled out of added/removed.
```

Per-entry we attach: `kind`, both sizes, both token_totals, and `tokenDelta = B.tokens − A.tokens`.
The response also carries **roll-up deltas**: `filesAdded/Removed/Modified/Renamed`,
`bytesDelta`, and the headline **token deltas per level** (`l1Δ`, `l2Δ`, `l3Δ`, `totalΔ`) — the
"what did this version cost me" number the product is about.

This is O(files) with hash compares only — no content scan for the tree summary. It works
identically for uploaded and GitHub skills because both are just `skill_files` maps by the time we
diff (satisfies R6).

### Per-file line diff

For a **modified text file**, the actual line-level diff is rendered by **Monaco `DiffEditor`**
(`@brand/editor`) in the browser, given `original` (A's blob text) and `modified` (B's blob text).
The API just serves both file contents (`GET …/diff/file?from&to&path`). No server-side diff library
is needed for the *visual* diff.

For the tree summary's `+adds / −dels` line counts (nice-to-have badges), the API computes a cheap
line delta with the `diff` (jsdiff) package. Binary modified files report `binary changed` with no
line diff.

### Why not store diffs?

Diffs are derived on demand from two immutable versions; they're O(files) and sub-millisecond at
this scale. Storing them would add cache-invalidation burden for no benefit. (A future optimization
could memoize the tree-summary per `(from,to)` pair, but it's unnecessary for a single-owner tool.)

## Token-delta comparison (the "deep" part)

Beyond file-level changes, the diff foregrounds **context-cost change**, reusing `TokenCounter`:

- **L1 (metadata) delta** — did `name`/`description` change? This is the always-loaded cost every
  conversation pays, so even a one-word `description` edit matters.
- **L2 (body) delta** — how much did the `SKILL.md` body grow/shrink (the on-trigger cost)?
- **L3 (resources) delta** — net token change across `references/`, `scripts/`, `assets/`.

Presented as a compact delta strip (↑/↓ with token counts, colored via semantic
`chart`/`success`/`destructive` tokens) atop the file-level diff — mirroring how scan-to-scan
compare already shows token deltas (`features/compare/CompareView.tsx`).

## Manifest (frontmatter) diff

Because frontmatter is structured, the inspector also shows a **field-level manifest diff**
(name/description/license/compatibility/metadata/allowed-tools changed between A and B) as a small
`Descriptions`-style before/after table — more legible than reading YAML lines in the code diff.
