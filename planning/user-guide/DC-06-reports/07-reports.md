---
type: "Guide Page"
title: "7. Export reports"
description: "Any measurement you make can be saved as a report to share, archive, or process further. This"
tags: ["documentation", "DC-06"]
timestamp: "2026-08-20T13:47:37Z"
status: "current"
---
# 7. Export reports

Any measurement you make can be saved as a report to share, archive, or process further. This
is the simplest way to get results out of the app.

## What you can export

- **Scan reports** — a single scan's summary and ranked tool footprint.
- **Server reports** — a report focused on a server.
- **Run reports** — the results of a [Testing](../DC-08-testing-console/09-testing.md) run.

## Two formats

Each report is available in two formats, and which you pick depends on what you'll do with it:

- **Markdown** — a clean, readable document. Best when you want to *read* the report, paste it
  into a document or ticket, or share it with someone. It renders as formatted text with tables.
- **JSON** — the same information in a structured, machine-readable form. Best when you want to
  *process* the report — feed it into a script, store it, or diff it yourself.

## How to export

From a scan (for example on the **Scans** screen or a server's latest scan), choose **Export**
and pick the format. The report is generated on the spot from the saved measurement, so it
always reflects exactly what you're looking at.

Run reports work the same way from a completed run in the [Testing console](../DC-08-testing-console/09-testing.md).

## Tips

- **Markdown for humans, JSON for tools.** If you're not sure, Markdown is the friendlier
  starting point.
- **Reports are point-in-time.** They capture the scan or run as it was measured, including the
  [token profile](../DC-01-getting-started/01-key-concepts.md) used — handy for keeping a record before and after a
  change.

---

Next: [Skills →](../DC-07-skills/08-skills.md)
