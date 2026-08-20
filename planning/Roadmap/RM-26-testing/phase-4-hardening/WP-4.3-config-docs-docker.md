---
type: "Work Package Spec"
title: "WP 4.3 \u2014 Config, docs, Docker"
description: "Phase: 4 \u00b7 Size: S \u00b7 Depends on: Phase 0\u20132"
tags: ["roadmap", "RM-26"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 4.3 — Config, docs, Docker

**Phase:** 4 · **Size:** S · **Depends on:** Phase 0–2

## Objective
Wire configuration, document the feature, and confirm the new deps build in the single container.

## Why / references
`apps/api/src/config/env.ts` + `.env.example` own config; `CLAUDE.md` carries the status table;
`Dockerfile`/`docker-compose.yml` build the single container (port 8080).

## Tasks
- **Config (`config/env.ts` + `.env.example`):** add `ATTACHMENTS_DIR` (default `DATA_DIR/attachments`)
  and document optional provider-key env fallbacks (keys normally live encrypted in the DB via the UI;
  env is only a convenience). Note the pricing table location (WP 1.5) as maintained-in-code.
- **Docs:** update the `CLAUDE.md` "Current state vs. target" table to add the Testing rows; add a
  short "Testing" section pointing at `roadmap/testing/`. Update
  `roadmap/07-open-questions.md` with the resolved/again-open items (transport=SSE, pricing
  maintenance, multimodal attachments).
- **Docker:** confirm `ai` + `@ai-sdk/*` and `@elabs-ai/components-charts` install and build inside the image;
  ensure `ATTACHMENTS_DIR` lives on the persistent `/data` volume (alongside the DB + secret key);
  rebuild `docker compose up --build` and load `http://localhost:8080`.

## Acceptance
- `docker compose up --build` produces a working container serving the new UI; attachments + DB +
  secret key persist across restarts on the `/data` volume.
- `.env.example` documents every new variable; `CLAUDE.md` reflects the new capability.
- Gate: typecheck + test + build green.
