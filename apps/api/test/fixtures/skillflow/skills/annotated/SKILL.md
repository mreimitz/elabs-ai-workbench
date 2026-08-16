---
name: annotated
description: A small skill used to test skillflow annotation parsing. Use only as a fixture, never for real data.
---

# Annotated

A minimal skill, shaped like zero-annotation but smaller, with a couple of
skillflow annotations sketched in as a work-in-progress convention.

<!-- skillflow:gatekeeper id=route-input -->
## Route the input

If the input is CSV, parse it with the header-row convention. Otherwise if JSON, parse it as an
array of records.

## Run the check

Run `scripts/validate.py` against the parsed input and inspect its exit code.

<!-- skillflow:gate id=check-output -->
## Check the output

Only continue once the check above exits 0. Read `reference/notes.md` for what each non-zero code
means before deciding whether to retry.
