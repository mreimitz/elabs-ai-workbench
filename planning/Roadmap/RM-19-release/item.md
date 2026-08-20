---
type: "Roadmap Item"
title: "Release & delivery — the offline hand-off bundle"
description: "Package the app so someone with only Docker Desktop, no repository access and no registry can run it: a saved image plus self-detecting launchers in one directory."
tags: ["roadmap", "RM-19"]
timestamp: "2026-08-20T13:58:42Z"
status: "planned"
---

# Release & delivery — the offline hand-off bundle

## Goal

Package the app so someone with only Docker Desktop, no repository access and no registry can run it: a saved image plus self-detecting launchers in one directory.

## Why it matters

The app builds from source with Docker Compose, which recipients outside a private repository cannot do.

## Milestones

- [ ] Define the offline bundle format.
- [ ] Build the image and the launchers.
- [ ] Verify a cold start on a clean machine.

## Linked research

No linked research yet.
