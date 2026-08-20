---
type: "Agent Command"
title: "Document Intake"
description: "Convert one local file or directory into a new validated RS research topic."
tags: ["agent", "command", "research", "document-intake"]
timestamp: "2026-07-24T12:20:07Z"
status: "active"
argument-hint: "<local file or directory>"
---

# Document Intake

Create one new research topic from one local file or an entire local directory.

Before running:

1. Resolve the supplied local path.
2. Always ask, **“What should this research entry be named?”** unless the user already supplied
   an explicit name in the same request.
3. If `tools/.venv/` is missing, ask permission before running `python3 tools/bootstrap.py`,
   because bootstrapping downloads and installs the pinned MarkItDown dependencies.

Then run:

```text
python3 tools/doc_intake.py "<local-path>" --title "<research-entry-name>"
```

Directories are processed recursively as one RS topic. Hidden files are skipped. Symlinks,
unsupported files, duplicates, unsafe archives, empty conversions, and any partial conversion
fail the entire operation without consuming an RS tag.

Use `--force-new` only when the user explicitly requests duplicate source content.

Report the created tag and path, number of converted files, and both OKF validation results.
