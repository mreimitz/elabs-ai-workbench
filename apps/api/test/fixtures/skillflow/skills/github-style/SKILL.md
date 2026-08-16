---
name: github-style
description: Query a public issue tracker's REST API and summarize open issues matching a label. Use when a user asks for a status digest of an upstream repo.
license: MIT
metadata:
  author: example-org
  version: "0.3.0"
---

# GitHub Style

An imported skill for summarizing issues from a public tracker.

## Fetch issues

Run `scripts/fetch.sh <owner> <repo> <label>` to pull the current open issues for a label. The
script writes a JSON array to stdout; check its exit code before trusting the output.

### Handling rate limits

If the fetch fails with a rate-limit error, wait and retry once. Read `reference/api-notes.md` for
the exact header the API uses to report the reset time.

## Summarize

Group the fetched issues by sub-label and produce one paragraph per group, oldest issue first.

## Publish

Hand the summary back as a single markdown block; do not write it to a file.
