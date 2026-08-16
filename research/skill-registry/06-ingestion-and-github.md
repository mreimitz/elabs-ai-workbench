# 06 — Ingestion pipeline, GitHub import, security

Lives in `apps/api/src/skills/` — `ingest-service.ts` (parse/validate/store), `git-service.ts`
(GitHub fetch), `repository.ts` (persistence), `routes.ts`. Only the API touches the filesystem,
`git`, and decrypted secrets (runtime boundary, `CLAUDE.md` §5).

## Upload path (`.zip` / single file)

1. **Receive** via `@fastify/multipart` (streamed to a temp dir under `DATA_DIR/tmp/<nanoid>/`,
   size-capped). Accept `application/zip`, `application/octet-stream`, or `text/markdown`.
2. **Unpack.** For a `.zip`, unzip with **`fflate`** (tiny, pure-JS, ESM, synchronous `unzipSync`) —
   no native build, enforce file-count + per-file + total-size caps while iterating (zip-bomb guard).
   For a lone `SKILL.md`/file, treat it as a one-file tree.
3. **Locate skill root.** Find the directory containing `SKILL.md`. Accept it at archive root or
   nested one level (`skill-name/SKILL.md`); rebase all paths relative to that dir. If multiple
   `SKILL.md` exist in one archive, reject with guidance ("archive contains N skills — upload one
   skill per archive") — uploads are single-skill; monorepos come via GitHub.
4. **Validate frontmatter** (see below) → `manifest`.
5. **Store** through the shared `createVersion` routine ([`04`](./04-versioning-and-diff.md)): hash
   every file → blobs, classify `kind`, count tokens, compute `tree_sha`, insert version+files.
6. **Cleanup** the temp dir in a `finally`.

## GitHub path (import + "pull latest")

Uses the **`git` CLI** (present: git 2.43) via `node:child_process`, not a library — it generalizes
to GitHub/GitLab/Bitbucket/self-hosted and matches how the app already spawns processes for MCP
stdio. No new npm dep for git.

**Probe / discovery** (`POST /api/skills/probe`):
```
tmp = DATA_DIR/tmp/<nanoid>
git clone --depth 1 --filter=blob:none --sparse --branch <ref> <repoUrl> tmp   # auth via helper below
scan tmp for **/SKILL.md (bounded depth) → candidates[] = { subpath, name, description }
resolve HEAD commit sha
rm -rf tmp
```
Return `candidates` so the wizard can list every skill a monorepo exposes and let the user pick one
(or several, each registered as its own skill bound to its `subpath`).

**Import a chosen skill** (`POST /api/skills` with `source:'github'`, `subpath`):
```
shallow clone <ref>; sparse-checkout set <subpath>   (or full checkout if subpath == '')
read files under <subpath> → in-memory {path, bytes}[] rebased to skill root
record commit sha → skills.github_last_sha ; store repo/ref/subpath ; PAT → SecretStore (github_auth_ref)
run createVersion(source='github', imported_from='github-pull')
rm -rf tmp
```

**Pull latest** (`POST /api/skills/:id/pull`):
```
re-clone the tracked ref, resolve commit sha
if sha == github_last_sha → { unchanged: true } (fast path, no hashing)
else read files → createVersion; if tree_sha unchanged → { unchanged: true }
else new SkillVersion; update github_last_sha; UI routes to Diff(prev→new)
```

**Auth for private repos.** A PAT is provided in the wizard, encrypted with `SecretStore`
(`github_auth_ref`), and injected **without touching disk** via an ephemeral env-based credential:
`GIT_ASKPASS`/`credential.helper` fed from an env var, or the `https://<token>@host/…` URL form kept
only in-process. The token is **never** returned to the web (only `hasAuth: boolean`), exactly like
MCP header/env secrets. Respect the environment's outbound network policy — if egress is blocked,
the clone fails and surfaces a clear error.

## Frontmatter validation

A `parseSkillManifest(skillMdText)` in `apps/api/src/skills/manifest.ts` (pure, unit-tested):

- Split YAML frontmatter (`---` … `---`) from the body. Parse YAML (Node has no YAML parser built-in
  — either add a tiny dep like `yaml`, or hand-parse the flat frontmatter; the frontmatter is simple
  key/scalar + one nested `metadata` map, so a minimal parser is viable and dep-free — **decision in
  [`10`](./10-open-questions.md)**).
- Validate against the spec ([`01`](./01-agent-skills-format.md)): `name` regex + length + reserved
  words; `description` non-empty ≤1024; optional fields' length caps; **warn** (don't hard-fail) if
  `name !== skill dir name`. Collect issues into `manifest_errors_json`; set `manifest_valid = 0`
  when required fields are missing/invalid, but **still store the version** so the user can inspect a
  malformed skill (enterprise inspectors must show broken artifacts, not swallow them).
- Compute L1 tokens from `name + description`, L2 from the body, via `TokenCounter`.

## Token accounting integration

Reuse `apps/api/src/token-counting/` (`TokenCounter`, default `generic_o200k`). Per file: count
tokens for text, 0 for binary. Aggregate to the three levels on the version row. This is the same
counter the scan pipeline uses, so skill footprints are directly comparable to server footprints in
the app's existing vocabulary.

## Security surfacing (the "enterprise-grade" bar)

The app **never executes** skill content. The inspector makes audit trivial:

- **Scripts panel** — list every `kind:'script'` file (by extension: `.py/.sh/.js/.ts/…`) up front.
- **External-reference flags** — a cheap scan of text files for `http(s)://`, `curl`, `wget`,
  `fetch(`, `requests.`, `urllib`, etc. → a "network references" badge on files and the skill.
- **Full tree visibility** — nothing hidden in subfolders; binary files shown with size + hash.
- **Provenance** — each version records its source (`upload` filename or git commit sha + repo),
  giving an audit trail of "where did this come from and when."
- Reuse Anthropic's trust guidance verbatim in an inline `Alert` on first import from an untrusted
  source.

## New runtime dependencies (API only)

| Dep | Why | Alternative rejected |
|---|---|---|
| `@fastify/multipart` | accept `.zip`/file uploads with size limits | raw-body content-type parser (works but reimplements multipart; the official plugin is the justified choice) |
| `fflate` | unzip archives, pure-JS/ESM, zero native deps, tiny | `adm-zip`/`unzipper` (heavier, native/stream complexity) |
| `diff` (jsdiff) | server-side line-count deltas for the tree summary badges | omit line counts (visual diff still works via Monaco; add only if we want the badges) |
| `yaml` *(maybe)* | robust frontmatter parse | dep-free minimal parser (viable; see [`10`](./10-open-questions.md)) |

All are widely-used, MIT/BSD, no native compilation. `git` is used via CLI (no dep). Per `CLAUDE.md`
§9, adding these is owner-approved territory — enumerated here for that sign-off.
