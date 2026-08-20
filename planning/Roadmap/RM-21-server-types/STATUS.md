---
type: "Status Ledger"
title: "Server types \u2014 STATUS (authoritative ledger)"
description: "Plan: README.md. Locked decisions D-ST1\u2013D-ST6 live there."
tags: ["roadmap", "RM-21"]
timestamp: "2026-08-20T13:47:37Z"
status: "active"
---
# Server types — STATUS (authoritative ledger)

Plan: [`README.md`](./item.md). Locked decisions D-ST1–D-ST6 live there.

## Phase 1 — Contract, schema, API

- [x] **1.1** Shared contract + migration v25 + `server-types` CRUD API + `typeId` on server CRUD +
  tests — done 2026-07-12. Landed: `SERVER_TYPE_STATUSES` + `ServerType*` types/zod + additive
  `typeId` on `ServerConfigInput`/update schema (`packages/shared`); `server_types` table +
  `mcp_servers.type_id` in `schema.ts` + migration **v25** (`database.ts`, guarded additive);
  `ServerTypeRow`/`ServerRow.type_id` (`rows.ts`); new `apps/api/src/server-types/`
  (repository + routes: `GET/POST /api/server-types`, `GET/PUT/DELETE /api/server-types/:id`,
  member counts, 409 duplicate name case-insensitive, D-ST4 delete-detaches); `typeId` handling +
  400 unknown-type guard in `servers/repository.ts`; registered in `index.ts`. New
  `apps/api/test/server-types.test.ts` (6 tests: CRUD, 404/400/409, additive+redaction-safe wire,
  detach-on-delete, v25 forward + fresh no-op). Existing hardcoded `LATEST_SCHEMA_VERSION = 24`
  assertions bumped to 25 in 4 test files (benchmarks-collections/-contract/-suites,
  migrations, skill-ide-server-binding). **Verified:** `pnpm typecheck` green (all 3 packages),
  `pnpm lint` clean, shared+api `build` green, **all 1,580 API tests pass** (run in 6 batches in a
  Linux sandbox copy with a linux-arm64 better-sqlite3 prebuild). **NOT verified:** the web
  `vite build` (the sandbox lacks linux-arm64 lightningcss/esbuild/rollup natives and installing
  them into the working tree was not acceptable) — no web code changed and web typecheck is green,
  but the owner should run `pnpm build` once on the host. Also fixed 3 pre-existing Biome errors
  (unrelated) in `roadmap/illustrations/examples/Agent.example.tsx` that were failing `pnpm lint`.

## Phase 2 — Servers UI

- [x] **2.1** ServerRail type grouping + status badges + type filter — done 2026-07-12, merged to `main` (`f6ed893`, branch `wp/server-types/2.1`). Re-validated by orchestrator in-worktree AND post-merge on `main`: typecheck ✓ · lint ✓ · web tests 831✓ (incl. new `ServerRail.test.tsx`) · build ✓. Landed: additive web api client `listServerTypes()` (`lib/api.ts`); `ServerRail` groups servers under type headers (name-asc, empty sections dropped) with a lifecycle **status badge** per header (`@elabs-ai/components-ui` `Badge` tones: production=success, release_candidate=info, beta=warning, deprecated=secondary — new `ServerTypeStatusBadge.tsx`), member count, an "Untyped" tail group (null **or** dangling `typeId`), and a **type filter** (`@elabs-ai/components-ui` `Select`; hidden when no type in use → degrades to today's flat list); row/selection/scan/edit/delete behavior preserved verbatim in an extracted `ServerList`. Wiring landed in `App.tsx` (ServerRail is the AppShell `secondaryContent`, not `ServersView`), so `ServersView.tsx`/`ServerWizard.tsx` stay free for 2.2. brand-ui + semantic tokens only. **Unverified (owner-acceptance):** the both-theme (`light`/`dark`) + keyboard-focus visual walk of the grouped rail, badges, and filter against the running app.
- [x] **2.2** Wizard/edit type picker + Manage-types dialog — done 2026-07-12, merged to `main` (`8425568`, branch `wp/server-types/2.2`). Validated by orchestrator in-worktree (forked from `main` tip; full gate green: typecheck ✓ · lint ✓ · web tests 836✓ incl. new `ManageServerTypesDialog.test.tsx` · build ✓). The merged committed tree == the validated worktree tree — 2.2's web files (`App.tsx`, `features/servers/*`, `lib/api.ts`) do **not** overlap a second in-flight owner change (auto-rating/grading, `apps/api`+`packages/shared`) that was uncommitted in the tree at merge time, so the gate was **not** re-run on that dirty overlay (it would conflate the two). Landed: additive type CRUD client (`create/update/deleteServerType`); optional **Type picker** in the add/edit server wizard (create + edit, `typeId` on both transports, `UNTYPED_OPTION` sentinel for Radix, prefilled on edit); type name (`Badge`) + status (`ServerTypeStatusBadge`, reused) on the server-detail **toolbar** + **profile** Descriptions (dangling `typeId` → Untyped, no crash); **Manage-types dialog** (`ManageServerTypesDialog.tsx`) — list↔form modes, create/rename/restatus/edit-description, 409 duplicate-name inline on the field (S14), delete via `ConfirmDialog` stating member count + D-ST4 detach ("sets those servers to Untyped — never deletes the servers"); reachable at empty-fleet (rail-header `Tags` button always rendered; `EmptyState` CTA when no types); `onChanged`→`App.refreshAll` reloads types AND servers. brand-ui + tokens only. **Unverified (owner-acceptance):** both-theme + keyboard visual walk of the wizard picker, detail badges, and Manage-types dialog (incl. nested ConfirmDialog focus); live CRUD against a real fleet (create/rename/restatus/real-409/real-delete-detaches).

## Phase 3 — Skill type binding

- [x] **3.1** Type-name resolution + representative server (D-ST3) + additive binding wire — done 2026-07-12, merged to `main` (`dafae5d`, branch `wp/server-types/3.1`; integration fix `f3e4ed4`). Re-validated by orchestrator in-worktree AND post-merge on `main`: typecheck ✓ · lint ✓ · **full test suite api 1598/1598 + web 831** ✓ (new `server-types-binding.test.ts` 15/15; existing `skill-ide-server-binding` + bound-tools/scaffold no regression) · build ✓. Landed: additive strictly-optional `typeId?`/`resolvedVia?` on `SkillServerBinding` (types + zod, contract-first; a plain server match stays **byte-identical** — new fields appear only on a type match); `resolveBindings()` precedence **persisted-override → exact-server (unique→id, ambiguous→null, never a type fall-through) → type-name (case-insensitive) → null**; representative member = newest successful scan (`pickRepresentativeServer`, tiebreak `scanned_at` DESC then `id` ASC; no successful-scan member → honest `serverId:null` with `typeId`/`resolvedVia:"type"` still set); `serverTypes?`/`scans` DI threaded through all 4 call sites, optional so unwired callers degrade to server-only. Pure persisted reads — no MCP, no secrets. **Merge note:** WP 3.1's insertion of `serverTypes?` before `options` in `registerSkillRoutes` was a *semantic* conflict with the concurrently-landed github-account feature (`c8667e1`); git auto-merged textually but `github-account.test.ts`'s positional `options` arg then bound to `serverTypes`, dropping the account wiring (tsx runs tests untyped, so typecheck missed it). Fixed forward in `f3e4ed4` by inserting the `serverTypes` slot in that test caller; production `index.ts` was already correct.
- [x] **3.2** Skill IDE surfaces (bindings panel, scaffold-from-type) — done 2026-07-12, merged to `main` (`7cea932`, branch `wp/server-types/3.2`). Validated by orchestrator in-worktree (forked from `main` tip; full gate green: typecheck ✓ · lint ✓ (776 files) · **api 1630/1630 + web 885** ✓ incl. new `binding-display.test.ts` / `bind-server-candidates` type cases / `ToolsPalette.render.test.tsx` / `server-types-scaffold.test.ts` · build ✓). Merged committed tree == validated worktree tree — 3.2's files (`packages/shared`, `apps/api/src/skills`, `apps/web/src/features/skills/*`) don't overlap a **third** concurrent in-flight owner change (testing/reports, uncommitted in the tree at merge time), so not re-run on that dirty overlay. Landed: **(A)** `fetchSkillBindings` + `binding-display.ts` fuse frontmatter names × resolved bindings (3.1 `typeId`/`resolvedVia`) × type/server directories → the ToolsPalette renders a type-resolved chip distinctly (type name + `ServerTypeStatusBadge` + resolved representative, honest "no representative yet" when no member has a completed scan; never guesses); **(B)** `BindServerDialog` gains a "Types" section (`deriveBindTypeCandidates`; bind writes the type name via `addFrontmatterServer`; `name-collision`/`already-bound` disabled per 3.1 precedence) + scaffold-from-type (Server|Type toggle in the New-skill wizard; client `pickRepresentative` mirrors the API's `pickRepresentativeServer` exactly). **Scaffold wire:** additive optional `bindTypeName` on `ScaffoldFromServerInput` (contract-first) — source server = the D-ST3 representative's tool surface, frontmatter names the **type**, **no** persisted override created so resolution stays dynamic; API validates (400 unknown type / 400 type-name-is-also-a-server-name); omitted → byte-identical to every existing scaffold-from-server caller. brand-ui + tokens only. **Unverified (owner-acceptance):** both-theme + keyboard visual walk of the type chips, the dialog Types section, and the wizard Server/Type toggle; live bind/scaffold-from-type against a real fleet (representative resolving/re-resolving as members change).

## Phase 4 — Downstream awareness (owner-gated · OPTIONAL) — **COMPLETE**

> Owner opted in 2026-07-12; both WPs done and merged.

- [x] **4.1** Environment/compare pickers show type + status — done 2026-07-12, merged to `main` (`ee00b90`, branch `wp/server-types/4.1`). Validated by orchestrator in-worktree (base == main tip; full gate green: typecheck ✓ · lint ✓ (777) · web tests 894 ✓ incl. new `CompareView.test.tsx` + extended `EnvironmentEditor.test.tsx` · build ✓). Read-only/additive, **web-only, no App.tsx change**. Landed: EnvironmentEditor allowed-server rows + AddServerModal picker rows show type name (`Badge`) + lifecycle status (`ServerTypeStatusBadge`, reused), "Untyped" when none, **deprecated** de-emphasized (`text-muted-foreground`, still selectable), dangling-`typeId` safe; `EnvironmentsView` self-fetches types best-effort (`.catch → []`, never fails the load); `CompareView` self-fetches types (no App.tsx contact) + gains a **type filter** on the A/B pickers (ServerRail sentinel pattern; hidden when no type in use; current pick always kept selectable) + `name · Type · Status` muted option copy (`textValue` preserved for typeahead), deprecated fully muted. brand-ui + tokens only. **Unverified (owner-acceptance):** both-theme + keyboard walk of the env picker rows, the compare type filter, and the option-copy suffix (a narrow Select trigger may clip the suffix — dropdown shows it in full); live behavior against a real typed/deprecated fleet.
- [x] **4.2** Attach environment server by type — done 2026-07-12, merged to `main` (`wp/server-types/4.2`; merge on top of `7e59d66`). Validated by orchestrator in-worktree (full gate green: typecheck ✓ · lint ✓ (778) · web tests 900 ✓ incl. new `AddServerModal.test.tsx` (6) · build ✓). **Web-only, additive; `AllowedServer` wire byte-identical.** Landed: `AddServerModal` step 0 gains a **Server | Type** source toggle (`@elabs-ai/components-ui` `RadioGroup`); Type mode lists types (status badge, member count, resolved representative) — picking one resolves the D-ST3 representative **at attach time** (reuses `deriveBindTypeCandidates` → newest success scan, tiebreak `scanned_at` DESC / `id` ASC — the tiebreak lives in exactly one place) and stores the **concrete member `serverId`** in the allow-list; resolution shown transparently ("Resolves to <member> · N tools" + a "type → member" line in step 1). Honest eligibility: no-scanned-member and representative-already-added are disabled; deprecated de-emphasis carried over. **Documented divergence (accepted):** the modal resolves from its `latestScans` (latest scan **per server**), so `deriveBindTypeCandidates` only considers members whose LATEST scan is a success — a member with an older success but a failed latest scan is excluded (conservative: never resolves to a tool-less member, and keeps the representative consistent with the tools step 1 shows). This can differ from the full-scan-history D-ST3 representative used for skill binding; loading full history was out of this WP's `AddServerModal`-only footprint. **Unverified (owner-acceptance):** both-theme + keyboard walk of the source toggle + type list + step-1 resolution line; live attach-by-type against a real fleet.

## Follow-up fixes

- **2026-07-12 — WP 3.2 binding UI reachability fix** (merged to `main`, branch
  `fix/skill-binding-overview-files`). WP 3.2 built the "Bind server… → Types" picker + resolved-
  binding chips into `design/ToolsPalette.tsx`, which is mounted **only** in the skill inspector's
  **Design** tab — and that tab is HIDDEN (owner decision **O2b**; deep-links bounce to Files). So
  the bind-a-type UI shipped **unreachable**. Fix: new host-agnostic `SkillBindingsPanel`
  (`apps/web/src/features/skills/SkillBindingsPanel.tsx`) reusing `BindServerDialog`, the
  candidate/chip/frontmatter helpers, and the `save-draft` flow (the parked `ToolsPalette` was NOT
  touched), mounted in a **"Servers" card on the Overview tab** and a **compact strip on the Files
  tab** (blocked while the Files workspace has unsaved edits; read-only when viewing a non-head
  version). Full gate green (web tests 904). The *working* path pre-fix was already hand-editing
  `servers:` in the Files SKILL.md editor (O1/O2 — Files is the single editor, with bound-tool
  completions/hovers + validation markers). **Unverified (owner-acceptance):** both-theme + keyboard
  walk of the two new surfaces; live bind/unbind + type→representative against a real skill+fleet.

## Decision log

- **2026-07-12 — Migration `user_version` 25 claimed** by this workstream (D-ST6): `server_types`
  table + `mcp_servers.type_id` (nullable, `REFERENCES server_types(id) ON DELETE SET NULL`),
  additive `ensureColumn` + `CREATE TABLE IF NOT EXISTS`, guarded on table presence per the v24
  minimal-fixture pattern. `schema.ts` fresh shape updated in lockstep. Any parallel workstream
  claims v26+.
- **2026-07-12 — D-ST1/D-ST3 owner choices recorded**: status lives on the type (one type per
  server); skill type-binding resolves to a representative member (newest successful scan) for
  validation, honest-unbound when none.

## Owner-acceptance (pending)

Phases 1–3 landed behind the gate (typecheck · lint · full test · build green per WP); the
following need the owner + a real fleet/tenant and were **not** verifiable headlessly:

- **Phase 2 visual** — both-theme (`light`/`dark`) + keyboard walk of: the grouped
  ServerRail (type headers, status badges, type filter, Untyped tail); the wizard **type picker**
  (create + edit); the server-detail **toolbar + profile** type/status badges; and the
  **Manage-types dialog** (create/rename/restatus, inline 409, delete-detaches `ConfirmDialog` +
  nested-dialog focus).
- **Phase 2 live** — CRUD against a real fleet: create/rename/restatus, a real duplicate-name 409,
  and a real delete detaching real members to Untyped.
- **Phase 3 live** — a real skill bound to a type (e.g. Acme-SaaS) whose tools validate against the
  representative member (newest successful scan); the representative re-resolving as members/scans
  change.
- **Phase 3.2 visual** — both-theme + keyboard walk of the Skill IDE: the **type chip** (type name
  + status + resolved representative + "no representative yet"), the Bind dialog **Types section**
  (name-collision / already-bound disabled reasons), and the New-skill wizard **Server|Type toggle**
  + scaffold-from-type.

## Plan status (2026-07-12) — **ALL WPs COMPLETE**

All 6 WPs across all 4 phases merged to `main`, each behind the gate: 1.1, 2.1, 2.2, 3.1, 3.2,
4.1, 4.2. Merge commits: 2.1 `f6ed893` · 3.1 `dafae5d` (+fix `f3e4ed4`) · 2.2 `8425568` ·
3.2 `7cea932` · 4.1 `ee00b90` · 4.2 (merge on `7e59d66`). **The only remaining work is the
owner-acceptance visual/live walks itemized above** (both-theme + keyboard walks of every new
surface, and live behavior against a real fleet/tenant — none verifiable headlessly). The
server-types feature is functionally complete and shippable.
