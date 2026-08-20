---
type: "Documentation"
title: "Skills registry, inspector and IDE"
description: "How Agent Skills are registered, versioned, inspected, measured, designed and authored in the workbench."
tags: ["documentation", "DC-07"]
timestamp: "2026-08-20T14:02:56Z"
status: "current"
---

# Skills registry, inspector and IDE

## Subject

How Agent Skills are registered, versioned, inspected, measured, designed and authored in the workbench.

## Scope

**In:** Registration and GitHub import, versioning and diffs, the token footprint and security surface, attachment to test environments, the visual designer and the skill IDE.

**Out:** Executing skill content, which the workbench never does.

## Where the code lives

- `apps/api/src/skills/`
- `apps/api/src/skillflow/`
- `apps/web/src/features/skills/`

## Delivered increments

### RM-21 — Server types — a first-class grouping for MCP servers

Completed 2026-08-20. Roadmap item: [RM-21](/Roadmap/completed/RM-21-server-types/item.md).

**Shipped:** MCP servers now carry a first-class type: the Servers rail groups them under type headers with a lifecycle status badge and a type filter, the add and edit wizard offers a type picker, a Manage-types dialog creates, renames, re-statuses and deletes types (deleting a type detaches its members rather than deleting servers), and a skill can bind to a type name instead of one server — resolving at read time to the type member with the newest successful scan.

**Planned vs delivered:** Phase 4 was planned as owner-gated and optional; the owner opted in on 2026-07-12, so both of its work packages shipped. The environment attach-by-type modal resolves its representative from each server's latest scan only, so a member whose latest scan failed is excluded even if an older scan succeeded — a documented, deliberately conservative divergence from the full-history representative used for skill binding.

**Known gaps:** The bind-a-type UI first shipped inside the hidden Design tab and was unreachable until a follow-up moved it onto the Overview and Files tabs. The both-theme and keyboard walks of the grouped rail, the wizard picker, the Manage-types dialog and the attach-by-type modal, and live behaviour against a real typed fleet, were never run — they remain owner acceptance.

**Where the code lives:**

- `apps/api/src/server-types/`
- `apps/web/src/features/servers/`
- `apps/web/src/features/skills/SkillBindingsPanel.tsx`
