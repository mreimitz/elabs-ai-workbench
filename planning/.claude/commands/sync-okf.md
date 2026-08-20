---
type: "Agent Command"
title: "Synchronize OKF"
description: "Regenerate managed indexes and the master roadmap, then validate the bundle."
tags: ["agent", "command", "okf", "index"]
timestamp: "2026-07-24T00:00:00Z"
status: "active"
---

# Synchronize OKF

Run:

```text
python3 .claude/scripts/okf.py sync-indexes
```

Review the changed-file count and report both validation layers.
