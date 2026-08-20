---
type: "Agent Command"
title: "New Roadmap Item"
description: "Transactionally create a conformant RM roadmap item and synchronize the master plan."
tags: ["agent", "command", "roadmap", "okf"]
timestamp: "2026-07-24T00:00:00Z"
status: "active"
argument-hint: "[short name of the plan or initiative]"
---

Create a new roadmap item.

Clarify the title, goal, why it matters, milestones, and related `RS-NN` tags. Then invoke:

```text
python3 .claude/scripts/okf.py new-roadmap \
  --title "<title>" \
  --goal "<goal>" \
  --why-it-matters "<reason>" \
  --milestone "<first milestone>" \
  --research "RS-NN"
```

Repeat `--milestone` and `--research` as needed. Do not allocate tags or edit the master roadmap
manually. Confirm the generated tag, path, and validation result.
