---
type: "Documentation"
title: "MCP server connections"
description: "How the workbench connects to MCP servers over stdio and streamable HTTP, including authentication, OAuth and server types."
tags: ["documentation", "DC-02"]
timestamp: "2026-08-20T14:02:56Z"
status: "current"
---

# MCP server connections

## Subject

How the workbench connects to MCP servers over stdio and streamable HTTP, including authentication, OAuth and server types.

## Scope

**In:** The add-server wizard, transports, auth and OAuth, connectivity testing, and grouping servers by type.

**Out:** Scanning a server and reading its footprint, which is its own subject.

## Where the code lives

- `apps/api/src/servers/`
- `apps/api/src/oauth/`
- `apps/web/src/features/servers/`

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
