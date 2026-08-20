---
type: "Agent Command"
title: "New Documentation Subject"
description: "Transactionally create a conformant DC documentation subject for one area of the system."
tags: ["agent", "command", "documentation", "okf"]
timestamp: "2026-08-20T00:00:00Z"
status: "active"
argument-hint: "[the part of the system this documents]"
---

Create a new documentation subject.

`Docu/` is organized by **subject** — one folder per part of the system (the connector SDK, the
Qlik write connector, the sync engine), not one per roadmap item. A single roadmap item usually
delivers into several subjects, and a subject accumulates increments over many roadmap items.

Before creating one, check whether an existing subject already covers the area:

```text
python3 .claude/scripts/okf.py status
```

Clarify the title, what the subject covers, what it explicitly excludes, and where its code lives.
Then invoke:

```text
python3 .claude/scripts/okf.py new-docu \
  --title "<title>" \
  --subject "<one line: what this part of the system is>" \
  --scope-in "<what this subject documents>" \
  --scope-out "<what it does not>" \
  --code-location "packages/<package>/"
```

Repeat `--code-location` as needed. Do not allocate tags or create the folder manually.

A new subject starts at status `draft` with an empty `## Delivered increments` section. It stays
`draft` until real work lands in it — `complete-roadmap` fills the section and can promote the
status. Documentation at `review` or `current` with no recorded increment is a conformance
violation.
