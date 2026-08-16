---
name: multi-command
description: A skill exposing two slash commands over a shared analysis pipeline. Use when a user wants to analyze a data export or produce a daily report from one.
keywords:
  - analyze data
  - daily report
---

# Multi Command

This skill bundles two slash commands that share a common data pipeline. Pick the command that
matches what the user is asking for.

## /analyze

Run the analysis pipeline over the user's export and surface the key findings.

### Load the input

Read `reference/spec.md` for the exact column layout the analyzer expects before parsing anything
about the export.

### Run the checks

Run `scripts/check.py` against the parsed input and confirm it exits 0 before trusting the numbers.
A non-zero exit code means a structural check failed.

## /report daily

Produce the formatted daily report from an already-analyzed dataset.

### Fill the template

Populate `assets/template.html` with the summarized rows, keeping the existing structure intact. If
the data has not been analyzed yet, see /analyze first and come back once that command passes.
