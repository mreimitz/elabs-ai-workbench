# Team server — implementation plan · **PRIORITY: MEDIUM (after `roadmap/ci/` Phase 1)**

Owner directive (2026-07-04): the app must be operable as a **shared instance for multiple
users** — authentication, roles, audit, and operational safety — while remaining a self-hosted
single container. This revises the earlier "single-owner local, no auth" scope statement in
older plan docs (that framing described those plans' scope, not a permanent product boundary).
**Still a non-goal: multi-tenancy.** One instance = one team = one database.

Living state: [`STATUS.md`](./STATUS.md) (driven by `/next-wp team-server`).

## What we're building

1. **Authentication**: local accounts (username + password via Node's built-in `scrypt` — no
   new dependency), session cookies (httpOnly, SameSite), first-run admin bootstrap, all
   `/api/*` routes gated (health excepted). OIDC SSO as a follow-on WP — the only candidate
   new dependency in this plan, **owner-gated** per the dependency rules.
2. **Roles**: `admin` (users, tokens, settings, maintenance) · `editor` (servers, scans,
   scenarios, tests, suites, skills, collections) · `viewer` (read + report export). Enforcement
   matrix per API family, tested per route family.
3. **Audit log**: append-only mutation log (who, what, when, entity ref) + a filterable view.
   No payload bodies (secrets discipline), just actions + refs.
4. **Service tokens** (consumes `roadmap/ci/` WP 1.1): tokens become per-user with role scoping.
5. **Operational safety**: backup/restore (snapshot + restore of `DATA_DIR` incl. secret key,
   with integrity check), retention policy UI over the existing prune/vacuum/checkpoint
   endpoints, WAL/concurrency review at multi-writer load (better-sqlite3 stays; the
   repository layer remains the storage seam — revisit only if measured contention forces it).

## Invariants

- Passwords/sessions/tokens: hashed/opaque at rest, never logged, never exported; the existing
  secret-encryption model is untouched. No plaintext credential ever crosses the wire twice
  (shown once at creation).
- Authorization is enforced **in the API** (the web UI only hides affordances). Every role
  test asserts both allowed and denied paths.
- Existing single-user deployments upgrade cleanly: first boot after migration creates the
  admin from an env bootstrap variable and keeps all data.
- Docker stays one container; no external auth service required for local accounts.

## WP index

### Phase 1 — Accounts & enforcement
| WP | Title | Depends on | Size |
|---|---|---|---|
| 1.1 | Contract + schema: users, sessions, roles; scrypt auth; bootstrap; route gating | ci 1.1 (token table alignment) | L |
| 1.2 | Role enforcement matrix per API family + tests | 1.1 | L |
| 1.3 | UI: login, user management (admin), role-aware affordances | 1.2 | M |

### Phase 2 — Audit & ops
| WP | Title | Depends on | Size |
|---|---|---|---|
| 2.1 | Audit log (append-only) + filterable view | 1.1 | M |
| 2.2 | Backup/restore + retention policy UI + concurrency review under multi-user load | 1.1 | L |

### Phase 3 — SSO (owner-gated dependency)
| WP | Title | Depends on | Size |
|---|---|---|---|
| 3.1 | OIDC login (authorization-code + PKCE); dependency decision logged first | 1.2 | L |

Migrations: claim the next free `user_version` at kickoff via the cross-workstream decision-log
convention.

## Definition of done (every WP)

Gate green from repo root + acceptance; ledger discipline per [`STATUS.md`](./STATUS.md).
