---
type: "Agent Command"
title: "New Research"
description: "Run structured intake and transactionally create a conformant RS topic."
tags: ["agent", "command", "research", "okf"]
timestamp: "2026-07-24T00:00:00Z"
status: "active"
argument-hint: "[optional one-line topic description]"
---

Use the `research-intake` skill to start a new research topic.

If the user provided a description here: "$ARGUMENTS" — treat it as the starting objective,
pre-fill what you can, and only ask the intake questions that remain genuinely open.
If nothing was provided, run the full intake from `.claude/skills/research-intake/questions.md`.

After intake is complete, invoke:

```text
python3 .claude/scripts/okf.py new-research \
  --title "<title>" \
  --objective "<objective>" \
  --why-now "<decision or downstream work>" \
  --scope-in "<included scope>" \
  --scope-out "<excluded scope>" \
  --deliverable "<deliverable and audience>" \
  --success-criteria "<measurable completion criteria>"
```

Do not manually copy or increment folders. The generator allocates the tag, creates the complete
OKF structure, synchronizes indexes and roadmap knowledge, and validates both conformance layers.
