---
type: "Guide Page"
title: "12. App assistant (the dock)"
description: "The app includes a built-in App assistant \u2014 an AI helper that lives in a dock on the right"
tags: ["documentation", "DC-12"]
timestamp: "2026-08-20T13:47:37Z"
status: "current"
---
# 12. App assistant (the dock)

The app includes a built-in **App assistant** — an AI helper that lives in a dock on the right
side of the window and can answer questions about your data and help you act on it. This page is
a short overview.

> Looking for the full-page, multi-model, multi-agent **Assistant** (missions, artifacts, memory,
> research mode) instead? That's a different, larger surface — see
> [16. Assistant →](../DC-13-assistant-hub/16-assistant-hub.md). This dock is the lighter-weight in-app helper; the two
> are separate by design.

## Opening it

Click **App assistant** in the top bar (or press **⌘J** / **Ctrl+J**) to open or close the dock.
Many screens also have **"Analyze…"** entry points that open the dock already focused on what
you're looking at — for example, a scan or a failed run.

## What it can do

- **Answer questions about your own data** — your servers, scans, skills, and runs. Because it
  can read what's in the app, you can ask things like why a scan looks the way it does, or what's
  driving a server's footprint.
- **Help you act** — it can navigate you to the right screen, and it can make changes on your
  behalf.

## Changes are approval-gated

The App assistant doesn't quietly change your data. Actions that write something are **gated
behind your approval** — you're asked before a change is made, and deletions always ask. For
example, editing a [skill](../DC-07-skills/08-skills.md) produces a **new immutable version** rather than
overwriting what was there.

## Signing it in

The App assistant runs on Claude, and you connect it in [Settings](../DC-14-settings-and-features/13-settings.md) using **your
own Claude subscription** (a one-time in-app sign-in) or an **Anthropic API key**. It only has
access to your app's data, not the rest of your machine.

> If you hit a usage limit on one sign-in method, the app offers an explicit action to retry on
> the other — it never switches silently.

---

Next: [Settings →](../DC-14-settings-and-features/13-settings.md)
