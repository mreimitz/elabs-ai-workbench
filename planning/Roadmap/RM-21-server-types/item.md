---
type: "Roadmap Item"
title: "Server types — a first-class grouping for MCP servers"
description: "Give MCP servers a first-class type, so servers sharing a tool surface and configuration shape can be grouped, filtered and bound to as a type rather than one server at a time."
tags: ["roadmap", "RM-21"]
timestamp: "2026-08-20T13:47:37Z"
status: "active"
---

# Server types — a first-class grouping for MCP servers

## Goal

Give MCP servers a first-class type, so servers sharing a tool surface and configuration shape can be grouped, filtered and bound to as a type rather than one server at a time.

## Why it matters

A skill authored against one production server broke the moment it was pointed at that server's staging twin, because binding was per-server.

## Milestones

- [ ] Phase 1 — contract, schema and API.
- [ ] Phase 2 — the Servers UI.
- [ ] Phase 3 — skill type binding.
- [ ] Phase 4 — downstream awareness.

## Linked research

No linked research yet.

## Plan overview (from the original plan README)

Owner directive (2026-07-12): MCP servers need a first-class **type** (grouping) concept. Example:
most the vendor servers are type **Acme-SaaS** (current production); **acme-stage** is beta / release
candidate. Servers of one type share the same tool surface and configuration shape, so a skill
authored against one of them should bind to the **type**, not to a single server. The Servers view
must let the owner create and manage types (not just servers) and group/filter servers by type and
lifecycle status.

Living state: [`STATUS.md`](./STATUS.md) (driven by `/next-wp server-types`).

## What we're building

1. **`ServerType` entity** — `{ id, name (unique), status, description? }` with lifecycle
   `status ∈ production | release_candidate | beta | deprecated` carried **on the type** (D-ST1).
   Each server has **at most one** type (`mcp_servers.type_id`, nullable, `ON DELETE SET NULL`).
   CRUD API (`/api/server-types`) + member counts.
2. **Servers view grouping & management** — `ServerRail` groups servers under type headers
   (untyped servers in an "Untyped" tail group), type + status badges on the server detail
   toolbar/profile, a type picker in the add-server wizard and edit form, and a **Manage types**
   surface (create / rename / restatus / delete, with member counts and a delete-detaches
   confirmation).
3. **Skill → type binding** — skill frontmatter `servers:` entries may name a **type** as well as
   a server. A type-bound entry resolves to the type's **representative server** (D-ST3: the member
   with the newest successful scan) for tool validation / bound-tools / scaffolding, while runs keep
   using whatever member the environment actually attaches. Existing exact-name bindings are
   untouched; ambiguity still resolves to `null` (never a guess).
4. **Type awareness downstream** — environment (scenario) server pickers show type/status; a type
   filter on compare pickers; per-type roll-up hooks reserved for the planned Advisor fleet report
   and Security-posture scores (documented, not built here).

## Locked decisions

- **D-ST1 — status lives on the type.** Lifecycle status (production / release_candidate / beta /
  deprecated) is a property of the `ServerType`, not of individual servers. One server ↔ at most
  one type. (Owner choice 2026-07-12 over per-server status and over free-form multi-tags.)
- **D-ST2 — Collection-shaped entity.** `server_types` mirrors the `collections` precedent: small
  first-class table, nanoid ids, unique name (`COLLATE NOCASE`), additive wire types in
  `packages/shared` first. No reserved/default type — `type_id = NULL` ("Untyped") is the default
  state, not a seeded row.
- **D-ST3 — representative-server resolution for skills.** A type-bound skill resolves, at
  validation time, to the member server with the **newest successful scan** (deterministic
  tiebreak: newest `scanned_at`, then server `id`). If the type has no members with a successful
  scan → honest unbound (`serverId: null`), same contract as today. At **run time** nothing
  changes: the environment's attached member server is what executes. (Owner choice 2026-07-12
  over validate-against-all-members and over metadata-only.)
- **D-ST4 — deleting a type detaches, never deletes.** `DELETE /api/server-types/:id` sets members'
  `type_id` to NULL (FK `ON DELETE SET NULL`) and clears type-bindings to honest-unbound. The UI
  confirms with the member count (destructive-action rule).
- **D-ST5 — additive wire only.** `ServerConfig.typeId?` / `ServerConfigInput.typeId?: string|null`
  are optional; every existing server response stays byte-compatible. Redaction is untouched —
  a type carries **no secrets, no connection config** (it is a label + status, not a config
  template; config sharing stays a per-server concern).
- **D-ST6 — migration claim: `user_version` **25**.** `server_types` table + guarded
  `ensureColumn(mcp_servers.type_id)`; `schema.ts` fresh shape updated in lockstep.

## Impact analysis (what this touches)

| Area | Impact |
| --- | --- |
| `apps/api/src/db/schema.ts` + `database.ts` | New `server_types` table; `mcp_servers.type_id` column; migration v25 (additive — no rebuild; `ensureColumn` + `CREATE TABLE IF NOT EXISTS`, guarded for minimal fixtures per the v24 pattern). |
| `packages/shared` | New `SERVER_TYPE_STATUSES` const, `ServerType*` types + zod schemas; additive `typeId` on `ServerConfigInput`/`ServerConfig`/update schema. |
| `apps/api/src/server-types/` (new) | Repository + routes: list (with `memberCount`) / create / get / update / delete; 409 duplicate name, 400 unknown status, 404 unknown id. |
| `apps/api/src/servers/` | `create`/`update` accept + validate `typeId` (400 on unknown); `toPublicServer` surfaces `typeId`. INSERT/UPDATE column lists + `ServerRow`. |
| `apps/web/features/servers/` | `ServerRail` grouping + filter; wizard/edit type picker; toolbar + profile badges; Manage-types dialog (all `@elabs-ai/components-*`, both themes). |
| `apps/api/src/skills/` (+ skillflow tool validation) | `resolveBindings()` learns type names; binding wire gains additive `typeId?`/`resolvedVia?`; representative-server selection (D-ST3). `skill_server_bindings` unchanged structurally. |
| Testing / environments | Read-only benefit first (type/status shown in server pickers); attach-by-type is a Phase 4 option, not required. |
| Compare / compatibility / reports | No contract change; type surfaces as a filter/label. Type-level aggregate compare is explicitly out of scope (compare stays pairwise scan-vs-scan). |
| Planned workstreams | Advisor **fleet report** and Security-posture per-server scores get a natural per-type grouping key; CI baselines may later be per-type. Documented as consumers, not built here. |

**Not touched:** secrets/redaction model, scan pipeline, run engine, `scenario_servers` shape,
`skill_server_bindings` PK, compare engine, any `/api` breaking change.

## Where the app benefits

1. **Skills stop being pinned to one box.** Today a skill's `servers:` frontmatter must match
   exactly one registered server; two servers sharing the same tool surface (prod vs. stage) make
   the name ambiguous → honest-unbound → no tool validation at all. A type gives the "these N
   servers are the same product" fact a name the skill can bind to.
2. **The Servers rail scales.** A flat name-sorted list stops working at fleet size; grouping by
   type with status badges makes prod vs. beta vs. RC legible at a glance.
3. **Safer operations.** Status on the type marks *deprecated* / *beta* fleets explicitly —
   pickers (environments, compare) can warn or de-emphasize non-production servers.
4. **Drift detection gets a target.** "Do all members of Acme-SaaS have the same tool surface as
   the representative?" is a well-posed future check (security-posture / advisor), impossible while
   grouping lives only in the owner's head.
5. **Fleet-level analytics unlocked.** Advisor's planned fleet report, CI per-type baselines, and
   posture roll-ups all need exactly this grouping key.

## Invariants

- A type carries **no secrets and no connection config** — the runtime boundary and redaction
  model are untouched.
- Wire changes are **additive-only**; every existing response stays byte-compatible.
- Skill binding **never guesses**: type resolution is deterministic (D-ST3) or `null`.
- New UI is `@elabs-ai/components-*` only and reads correctly in **both themes**.
- Gate: `pnpm typecheck && pnpm test && pnpm build && pnpm lint` green per WP.

## WP index

### Phase 1 — Contract, schema, API
| WP | Title | Depends on | Size |
|---|---|---|---|
| 1.1 | Shared contract + migration v25 + `server-types` CRUD API + `typeId` on server CRUD + tests | — | M |

### Phase 2 — Servers UI
| WP | Title | Depends on | Size |
|---|---|---|---|
| 2.1 | ServerRail type grouping + status badges + type filter | 1.1 | M |
| 2.2 | Wizard/edit type picker + Manage-types dialog (create/rename/restatus/delete w/ member count) | 1.1 | M |

### Phase 3 — Skill type binding
| WP | Title | Depends on | Size |
|---|---|---|---|
| 3.1 | `resolveBindings()` type-name resolution + representative-server selection (D-ST3) + additive binding wire + tests | 1.1 | M |
| 3.2 | Skill IDE surfaces: bindings panel shows type + resolved representative; scaffold-from-type | 3.1, 2.2 | M |

### Phase 4 — Downstream awareness (optional, owner-gated)
| WP | Title | Depends on | Size |
|---|---|---|---|
| 4.1 | Environment/compare pickers show type + status; deprecated de-emphasis | 2.1 | S |
| 4.2 | Attach-environment-server **by type** (resolve member at attach time) | 4.1 | M |

## Definition of done

Gate green per WP; both-theme visual check for Phase 2+; honest reporting of anything not
verified against the running app. Migration v25 verified against a pre-v25 DB fixture
(`migrations.test.ts` pattern) and fresh-DB no-op parity.
