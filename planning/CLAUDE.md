---
type: "Agent Instruction"
title: "Workbench Planning Bundle Operating Rules"
description: "Mandatory structure, OKF conformance, research, roadmap and delivery rules for agents working in the workbench planning bundle."
tags: ["agent", "instruction", "okf"]
timestamp: "2026-08-20T13:47:37Z"
status: "active"
---

# Workbench Planning Bundle Operating Rules

This concept governs how Claude Code and other agents behave inside `planning/`. These are hard
rules. Hooks, generators and the validator enforce them, but agents must follow them proactively.

The application's own rules live at the repository root — `../CLAUDE.md` and
`../.claude/rules/`. Those govern the code. This file governs the knowledge graph.

---

## 1. Purpose

`planning/` is one Open Knowledge Format v0.1 bundle. Four knowledge domains exist:

- **`Research/`** — where investigation happens (provider limits, observability landscape,
  session contracts, skill formats). One subfolder per research topic.
- **`Roadmap/`** — where plans, sequencing and intent are documented. Each item carries a
  `STATUS.md` work-package ledger. Finished items move to `Roadmap/completed/`.
- **`user-guide/`** — what has actually been built, organized by subject. One subfolder per part
  of the system. A subject holds both the delivery record (`doc.md`) and that part of the
  user-facing guide.
- **`.claude/`** — agent controls, generation templates and conformance tooling.

Work flows one way through them: research informs a roadmap item, the roadmap item is built
against its ledger, and on completion the delivery is recorded in `user-guide/` and the item is
retired to `Roadmap/completed/`. Section 5 makes that a hard rule.

Every `.md` file is either an OKF concept with strict frontmatter or a reserved `index.md` /
`log.md`. Run `python3 planning/.claude/scripts/okf.py --root planning validate` (or
`pnpm okf:validate`) after material changes.

`tools/` is scaffold infrastructure, not an OKF knowledge domain. It contains code, configuration
and tests only. Markdown is forbidden under `tools/`, and the root knowledge index must not list it.

---

## 2. Tagging convention (MANDATORY)

Every research topic, roadmap item and documentation subject gets a stable, zero-padded tag.

| Domain        | Tag prefix | Example  | Meaning                 |
| ------------- | ---------- | -------- | ----------------------- |
| Research      | `RS`       | `RS-01`  | Research topic 1        |
| Roadmap       | `RM`       | `RM-01`  | Roadmap item 1          |
| Documentation | `DC`       | `DC-01`  | Documentation subject 1 |

Rules:
- Folder names are `RS-NN-short-slug` / `RM-NN-short-slug` / `DC-NN-short-slug`
  (e.g. `RM-21-security-posture`).
- `NN` is two digits, zero-padded, **never reused** even after a topic is archived. A completed
  roadmap item keeps its number forever; moving it to `Roadmap/completed/` does not free it.
- The tag is the primary key. Reference items by tag in notes, commits and roadmap entries
  (e.g. "blocked by RS-03", "feeds RM-02").
- Tags are allocated by `.claude/scripts/okf.py`; do not create or reuse them manually.

---

## 3. Research folder rules (HARD RULE — enforced by hook)

> **Every research document MUST live inside a `Research/RS-NN-*/` topic folder.**
> Writing a file directly into `Research/` (loose, outside a topic folder) is forbidden.

- Start topics with `/new-research`; the transactional generator creates the complete structure.
- All sources, notes and outputs for that topic stay inside its folder:
  - `sources/` — raw captured material (PDFs, fetched pages, exports, transcripts).
  - `notes/` — working notes, synthesis, intermediate thinking.
  - `outputs/` — finished deliverables (memos, tables, comparison matrices, briefs).
- `topic.md` is the authoritative topic concept; `index.md` is its navigation front door.
- Non-Markdown artifacts **in `sources/`** require a same-stem `Source Reference` concept.
- Research notes, research outputs and decisions always include a `# Citations` section, using
  `None.` when there is nothing to cite.
- Do not scatter a topic's files across multiple folders. One topic = one folder = one tag.

---

## 4. Roadmap folder rules (HARD RULE — enforced by hook)

- `Roadmap/roadmap.md` is the **single master plan concept**. It holds the live list of all `RM`
  items and links every active `RS` topic and `DC` subject. `sync-indexes` regenerates its body.
- Detailed planning for any item goes in its own `Roadmap/RM-NN-<slug>/` subfolder, never loose
  in `Roadmap/`.
- `index.md` and `roadmap.md` are the only Markdown files allowed directly in `Roadmap/`.
- Each roadmap item links the research it depends on or produces (by `RS-NN` tag).
- **Every item's live work-package state is its own `STATUS.md` ledger** — the checkbox format
  `/next-wp` maintains. `STATUS.md` is a `Status Ledger` concept; the work-package specs beside
  it are `Work Package Spec` concepts. The ledger is authoritative for per-WP status; `item.md`
  carries goal, milestones and links.
- `Roadmap/` holds only unfinished work. Completed items live in
  `Roadmap/completed/RM-NN-<slug>/` and are put there by the generator, never by hand.

---

## 5. Implementation lifecycle (HARD RULE — enforced by hook and validator)

> **Every piece of implementation work follows the same path: it is on the roadmap, it gets
> built against its ledger, its delivery is documented in `user-guide/`, and the roadmap item
> moves to `Roadmap/completed/`. An item is not finished until all four have happened.**

1. **Plan it.** Work that is not an `RM-NN` roadmap item does not get built. Create it with
   `/new-roadmap`.
2. **Build it.** Execute against the item's `STATUS.md` ledger, normally through the
   repository-root `/next-wp` skill. A work package is done only after the project quality gate
   passes and its box is ticked.
3. **Document it.** `user-guide/` is organized by subject, not by roadmap item — one folder per
   part of the system, created with `/new-docu`. A documentation concept records **what shipped
   versus what was planned**: the delivery, how it differed from the plan, where the code lives,
   and what was deliberately left out. One roadmap item usually writes into several subjects.
4. **Retire it.** Run `/complete-roadmap`. In one transaction it moves the item folder to
   `Roadmap/completed/`, sets its status to `done`, ticks its milestones, writes a `### RM-NN`
   increment into each named documentation subject, re-points bundle links and revalidates.

The generator refuses to complete an item while the bundle is invalid, while **any box in the
item's `STATUS.md` ledger is still open**, or without at least one documentation subject to
record the delivery. `--no-ledger` exists only for an item that never had a ledger; it is not a
way past an open box.

Enforcement is mechanical, not advisory:

- `PROFILE032` — a roadmap item with status `done` outside `Roadmap/completed/`.
- `PROFILE035` — an item under `Roadmap/completed/` whose status is not `done`.
- `PROFILE036` — a completed item that no documentation subject records.
- `PROFILE037` / `PROFILE039` — documentation missing or not filling its
  `## Delivered increments` section.
- `PROFILE038` — an increment that does not link the item it claims to document.

The first two reach the pre-write hook, so flipping a status by hand is blocked at the moment of
the edit rather than discovered later.

After completing an item, apply the stale-reference report the generator prints — it lists the
repository-root guides and rules that still point at the old path — and confirm with
`check-references` that none remain.

---

## 6. The front page follows the work (HARD RULE)

When a work package's last box ticks, **in the same commit**: update the capability table in
`../README.md`, move what the work package made real out of "planned" and into what the app does
today, correct anything the work package made false, and add a `../CHANGELOG.md` entry. Verify
each claim against the running app or a passing test — never from the work-package description.
A ledger box does not tick while the front page still describes software that does not match.

---

## 7. Workflow for a new research topic

When the user wants to start research, **run the intake** rather than guessing scope.

1. Trigger the intake skill (`/new-research`, or the `research-intake` skill). It asks a short,
   editable sequence of questions to pin down objective, scope, sources, deliverable and success
   criteria.
2. Allocate the next free `RS-NN`.
3. Run the generator to allocate and atomically create `Research/RS-NN-<slug>/`.
4. Confirm `topic.md`, indexes, subdirectories and log are complete.
5. Synchronize `Roadmap/roadmap.md` and the managed indexes.
6. Only then begin gathering sources and writing notes — inside the new folder.

For file-driven intake, `/doc-intake` asks for a research-entry name, converts one local file or
a directory recursively, and creates the complete RS topic only after every visible file converts.

---

## 8. Working style

- Capture sources before synthesizing; keep a provenance trail in `sources/` so claims are
  traceable.
- Distinguish raw capture (`sources/`), thinking (`notes/`) and deliverables (`outputs/`).
- When citing web material, paraphrase; never paste large verbatim passages.
- Cross-link by tag. The tag graph (which RS feeds which RM, which RM shipped into which DC) is
  the project's memory.
- Keep `roadmap.md`, `topic.md`, `item.md` and every `STATUS.md` honest.
- Update a concept's UTC `timestamp` whenever its meaning changes — the pre-write hook rejects a
  meaningful edit that leaves the timestamp untouched.
- Prefer bundle-root links; an `RS-03` topic links to its bundle-root concept path.

---

## 9. What NOT to do

- ❌ Do not write loose files into `Research/`, `Roadmap/` or `user-guide/` roots.
- ❌ Do not create `README.md` anywhere in the bundle; use reserved `index.md` for navigation.
- ❌ Do not create live Markdown from unfinished templates.
- ❌ Do not create Markdown under `tools/`; tooling is outside the OKF knowledge graph.
- ❌ Do not create a tagged folder by hand, or edit `.claude/tag-registry.json`.
- ❌ Do not reuse a retired tag number.
- ❌ Do not start a topic without objective and scope recorded in `topic.md`.
- ❌ Do not hand-move a roadmap item into `Roadmap/completed/`; use `/complete-roadmap`.
- ❌ Do not set a roadmap item's status to `done` by hand; the hook rejects it.
- ❌ Do not complete a roadmap item without recording what shipped in a
  `user-guide/DC-NN-*/doc.md`.
- ❌ Do not tick a ledger box while the repository front page still describes software that does
  not match.
- ❌ Do not bypass a hook block by renaming a path to dodge the check — fix the structure instead.
- ❌ Do not finish work while either conformance layer reports a violation.
