---
type: "Agent Command"
title: "Complete Roadmap Item"
description: "Retire a finished roadmap item: record what shipped in Docu and move the item to Roadmap/completed/."
tags: ["agent", "command", "roadmap", "documentation", "lifecycle", "okf"]
timestamp: "2026-08-20T00:00:00Z"
status: "active"
argument-hint: "[the RM-NN tag that has finished]"
---

Retire a finished roadmap item. This is the **only** sanctioned way to complete work.

Never mark an item done by hand. The pre-write hook rejects a `Roadmap Item` whose status is
`done` while it still sits directly under `Roadmap/` (PROFILE032), and it rejects an item under
`Roadmap/completed/` whose status is anything else (PROFILE035). Renaming a path to dodge the
check is itself a violation.

## Before running

The command refuses unless all of the following hold:

- the bundle validates clean;
- every task on the item's board in `tools/agent-plan/tasks.json` has status `done`;
- at least one existing `DC-NN` documentation subject is named, none of them superseded or
  archived, and none already recording this item.

If the item has no board at all, pass `--no-task-board`. The waiver is written into the item's
`log.md`, not just printed, so the bundle carries the evidence.

Create any missing documentation subject first with `/new-docu`.

## Run

```text
python3 .claude/scripts/okf.py complete-roadmap \
  --tag "RM-NN" \
  --docu "DC-NN" \
  --shipped "<one line: what the software now does>" \
  --deviation "<how the delivery differed from the plan>" \
  --gap "<what was deliberately left out>" \
  --code-path "packages/<package>/" \
  --docu-status current
```

Repeat `--docu`, `--deviation`, `--gap` and `--code-path` as needed. In one transaction the
command moves the item folder to `Roadmap/completed/`, sets its status to `done`, ticks its
milestones (`--keep-milestones` opts out), writes a `### RM-NN` increment into each named
subject, appends to every affected log, regenerates the master roadmap and the indexes, and
validates. Any failure rolls the whole thing back.

## Afterwards

The command prints every reference outside the OKF bundle that still points at the old path —
the repository-root guides and the `inputs` entries in `tools/agent-plan/tasks.json`. It never
edits outside its own root. Apply those edits yourself, then confirm:

```text
python3 .claude/scripts/okf.py check-references --tag "RM-NN"
```

That must report no stale references before the work is finished.

## Recovery

The individual steps are atomic but the sequence is not, so a hard kill mid-run can leave a
partial state. Recover with `git checkout -- planning/` followed by `sync-indexes`. A crashed run
may also leave `.claude/.tag-allocation.lock` behind; remove it only after confirming no other
run is in progress.
