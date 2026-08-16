---
name: data-report
description: Turn a raw data export into a formatted summary report. Use when a user hands you a CSV or JSON extract and wants a human-readable report back.
---

# Data Report

This skill turns a raw export into a short, readable report.

## Gather inputs

Locate the export file the user attached. Confirm its extension before doing anything else — the
next step branches on it.

If the input is CSV, treat the first row as a header and every other row as a record. Otherwise if
JSON, expect a top-level array of objects with consistent keys. Anything else is out of scope for
this skill.

## Validate the data

Run `scripts/validate.py` against the input file and check it exits 0 before continuing. A non-zero
exit means the data failed a structural check (missing column, malformed row, empty file) — read
the script's stderr for which one.

If validation fails, fix the obvious problem (trim a stray column, drop an empty trailing row) and
repeat until the validation passes, at most 3 times. If it still fails after that, stop and tell the
user what's wrong instead of guessing further.

## Generate the report

Read `reference/format-spec.md` for the exact section order and heading conventions the report must
follow. Populate `assets/template.html` with the validated records, keeping the existing structure
intact — only the data rows change.

## Verify the output

Re-open the generated report and confirm every section from the format spec is present and no
placeholder tokens were left unfilled. Only hand the report back once this check passes.
