---
type: "Research Topic"
title: "Skill Registry & Inspector"
description: "Design a Skills capability for the workbench: register Agent Skills from an upload or a GitHub repository, version them, pull new versions, inspect their footprint and security surface, and attach them to test environments."
tags: ["research", "RS-02"]
timestamp: "2026-08-20T13:58:38Z"
status: "active"
---

# Skill Registry & Inspector

## Objective

Design a Skills capability for the workbench: register Agent Skills from an upload or a GitHub repository, version them, pull new versions, inspect their footprint and security surface, and attach them to test environments.

## Why now / what it feeds

Skills are the second context-consuming surface beside MCP tool definitions, and the workbench had no way to measure or manage them.

## Scope

**In:** The Agent Skills format, ingestion paths and size caps, the data model, versioning and full-tree diff, the API surface, the inspector UI, scenario attachment, and how real products load skills.

**Out:** Executing skill content, authoring skills, and any hosted skill marketplace.

## Deliverable

A phased implementation plan with a data model, API surface and UI plan, plus a machine-readable work-package breakdown.

## Success criteria

A coding agent can build the registry and inspector from these documents without further design decisions.
