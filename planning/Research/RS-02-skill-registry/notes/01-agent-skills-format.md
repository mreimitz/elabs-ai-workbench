---
type: "Research Note"
title: "01 \u2014 Agent Skills format (ground truth)"
description: "Sourced from the Anthropic Agent Skills docs and the open"
tags: ["research", "RS-02"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# 01 — Agent Skills format (ground truth)

Sourced from the Anthropic Agent Skills docs and the open
[Agent Skills specification](https://agentskills.io/specification) (fetched 2026-07-01). This is the
format the ingester must parse and the inspector must present.

## What a Skill is

A Skill is a **directory** whose only required member is a `SKILL.md` file. It packages
instructions, metadata, and optional resources (scripts, references, assets) that an agent loads
**on demand**. The directory name must equal the skill `name`.

```
skill-name/
├── SKILL.md          # REQUIRED: YAML frontmatter + Markdown body
├── scripts/          # optional: executable code (python/bash/js)
├── references/       # optional: extra docs loaded on demand (REFERENCE.md, FORMS.md, …)
├── assets/           # optional: templates, images, data files, schemas
└── …                 # any additional files/subfolders
```

## `SKILL.md` frontmatter schema (authoritative)

YAML frontmatter delimited by `---`, followed by a Markdown body.

| Field | Required | Constraints |
|---|---|---|
| `name` | **yes** | 1–64 chars; lowercase `a–z`, `0–9`, hyphens; no leading/trailing hyphen; no `--`; must equal the parent directory name; must not contain reserved words `anthropic`/`claude` (Anthropic surfaces) or XML tags. |
| `description` | **yes** | 1–1024 chars, non-empty, no XML tags; should state *what it does* **and** *when to use it*. |
| `license` | no | License name or reference to a bundled license file. |
| `compatibility` | no | ≤500 chars; environment requirements (intended product, packages, network). |
| `metadata` | no | Arbitrary `string → string` map. **This is where `version` lives by convention** (`metadata.version: "1.0"`). |
| `allowed-tools` | no | Space-separated pre-approved tool list (experimental; e.g. `Bash(git:*) Read`). |

Minimal + full examples:

```yaml
---
name: pdf-processing
description: Extract PDF text, fill forms, merge files. Use when handling PDFs.
license: Apache-2.0
compatibility: Requires Python 3.14+ and uv
metadata:
  author: example-org
  version: "1.0"
allowed-tools: Bash(git:*) Read
---
```

**Key takeaway for versioning:** there is **no first-class `version` field** in the spec. The
convention is `metadata.version` (a free-form string). We therefore cannot rely on it being present,
monotonic, or unique — see [`04-versioning-and-diff.md`](../outputs/04-versioning-and-diff.md) for how we
derive a version label (prefer `metadata.version`, else the git short-SHA, else an auto-incrementing
`v1, v2, …`).

## Progressive disclosure = three token-cost levels

This is the crux of why the skill is a *footprint* object:

| Level | When loaded | Typical cost | Content |
|---|---|---|---|
| **L1 — Metadata** | always (system prompt) | ~100 tok/skill | `name` + `description` frontmatter |
| **L2 — Instructions** | when the skill triggers | < ~5k tok | the `SKILL.md` Markdown body |
| **L3 — Resources** | as referenced | effectively unlimited | files under `scripts/`, `references/`, `assets/`, executed/read via bash |

Authoring guidance: keep `SKILL.md` under ~500 lines; move detail into `references/`; keep file
references one level deep. The inspector should compute and display L1/L2/L3 token subtotals per
version (reusing `TokenCounter`), because that is the model-context story the app exists to tell.

## Packaging & distribution (what we must ingest)

- **Folder** (Claude Code): `.claude/skills/<name>/SKILL.md` or `~/.claude/skills/…`. Filesystem,
  no upload.
- **`.zip`** (claude.ai upload): a zipped skill directory. **This is our primary upload path.** The
  zip may contain the skill dir at the root or nested one level (`skill-name/SKILL.md`); the ingester
  must locate the directory that contains `SKILL.md`.
- **Single file**: the ask allows "a skill file" — we accept a lone `SKILL.md` (a metadata-only
  skill) as a degenerate one-file skill.
- **GitHub repo**: two shapes, both real:
  - **Single-skill repo** — `SKILL.md` at (or near) the repo root.
  - **Monorepo** — many skills under a folder (e.g. `anthropics/skills` keeps them under `skills/…`,
    with a `.claude-plugin/` marketplace manifest and a `template/`). A repo can therefore yield
    **N skills**. The importer must **discover all `SKILL.md` files** and let the user pick which
    directory(ies) to register; each registered skill is bound to `(repo, ref, subpath)`.

## Security posture (informs the "enterprise-grade" bar)

Anthropic is explicit: **treat skills like installing software; only use trusted sources.** A skill
can carry scripts that instruct an agent to do harmful things, and skills that fetch external URLs
are especially risky. The inspector should make auditing easy:

- Surface every bundled **script** and its language, prominently.
- Flag files that reference **external URLs / network fetches**.
- Show file sizes and a full, walkable tree so nothing is hidden in a subfolder.
- Never auto-execute anything during ingestion or inspection.

This is a feature, not a caveat: "enterprise-grade skill inspector" = *auditable* skill inspector.

## Sources

- [Agent Skills — overview (Anthropic/Claude Platform docs)](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)
- [Agent Skills — specification (agentskills.io)](https://agentskills.io/specification)
- [Extend Claude with skills — Claude Code docs](https://code.claude.com/docs/en/skills)
- [anthropics/skills repository](https://github.com/anthropics/skills) (monorepo + `.claude-plugin/` example)
- [SKILL.md format reference (agensi.io)](https://www.agensi.io/learn/skill-md-format-reference)

# Citations

None.
