---
type: "Work Package Spec"
title: "WP M.2 \u2014 service-token scopes on the workbench MCP mount"
description: "Phase MCP of mcp-server.md. Ledger: STATUS.md. Shared rules"
tags: ["roadmap", "RM-08"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP M.2 — service-token scopes on the workbench MCP mount

Phase MCP of [`mcp-server.md`](./mcp-server.md). Ledger: [`STATUS.md`](./STATUS.md). Shared rules:
the [testing conventions](/Roadmap/RM-26-testing/conventions.md) + the repo rules in `.claude/rules/`.

**Depends on:** WP 1.1 (service tokens — done 2026-08-19, `wp/ci/1.1`), WP M.1 (the read-only MCP
mount — done 2026-08-19, `wp/ci/M.1`).
**Consumed by:** WP M.3 (scoped write tools — it adds tools to the mechanism this WP builds, and
adds nothing to the mechanism itself).

---

## Locked decisions this WP implements

- **D-MCP2 (locked 2026-08-19)** — on localhost the mount follows the app's no-auth-by-design
  posture; non-local exposure requires a service token.
- **D-MCP3 (locked 2026-08-19)** — scope = consent for headless callers; **deletes are excluded at
  every phase**.
- **D-C2 / D-C4 (locked 2026-08-19)** — the guard's posture and the **frozen** scope tuple
  `read` · `scan:run` · `runs:launch` · `suites:run`. **This WP does not add, rename or remove a
  scope.** It maps the existing four onto routes and tools.
- **D-C10 (locked 2026-08-19, WP 1.3)** — `POST /api/assertions/evaluate` is read-only but takes a
  POST, so the coarse rule demands an execute scope from a remote token. WP 1.3 recorded the fix as
  *this* WP's mapping work; it lands here.

### Decisions to lock in this WP (record them in the ledger's decision log)

- **D-MCP7 — a tokenless loopback caller keeps FULL access to the mount, including the write tools
  WP M.3 adds** (owner, at this WP's kickoff). This is the posture the rest of the API already has —
  a loopback caller can `POST /api/runs` from `curl` today with no credential — and the mount does
  not get a stricter rule than the API it is mounted on. **Scope enforcement therefore applies only
  to a request that authenticated with a token.** The switch that changes this is the existing
  `API_AUTH_REQUIRED=true`, which forces token auth on loopback for the whole API, mount included —
  **no new environment variable** (an off-switch beside an auth check is the foot-gun WP 1.1
  called out; two overlapping auth knobs is the same foot-gun twice).
- **D-MCP8 — `read` is the price of admission to the mount.** The route mapping below requires
  `read` for `POST /api/mcp`, because `initialize` / `tools/list` / `resources/read` are reads and a
  client cannot speak MCP without them. A write-capable agent therefore holds `read` **plus** its
  write scope; a `scan:run`-only token cannot open the mount at all. State this in the docs — it is
  the one thing a token-minting operator can get wrong.
- **D-MCP9 — per-route scope mapping RELAXES conservatively, and the path match proves it.** WP 1.1
  matches a governed path on the **union** of the raw and percent-decoded forms, because for
  *deciding what is governed* the inclusive answer is the safe one. A route→scope entry does the
  opposite job — it *lowers* what a request needs — so it must match on the **intersection**: a rule
  applies only when the raw form and the decoded form **both** match it. An ambiguous path
  (`/%61pi/mcp`) therefore falls back to the coarse method rule rather than inheriting the relaxed
  one. Same helper module, opposite direction, on purpose; pinned by a table that fails if either
  direction is swapped.

---

## What we're building

1. **A per-route scope map** in `packages/shared/src/api-tokens.ts` — declared once, consulted by
   the guard before its coarse method rule falls in behind it. Two entries in this WP:
   `POST /api/mcp → read` and `POST /api/assertions/evaluate → read`.
2. **A per-tool scope declaration** for the mount — every registered MCP tool names the scope it
   needs, pinned to the registered surface by a key-set test, so **WP M.3 cannot add a write tool
   without declaring its scope**.
3. **Enforcement at tool dispatch** — a token-authenticated call to a tool whose scope the token
   lacks returns a readable MCP error result naming the missing scope; a tokenless loopback call is
   unaffected (D-MCP7).
4. **An audit line per tool call** — tool name, the calling token's **display prefix** (never the
   secret), outcome, duration — on the existing Fastify/pino logger.
5. **Docs** — the mount's scope requirements in
   [`user-guide/20-workbench-mcp-server.md`](/user-guide/DC-16-workbench-mcp-server/20-workbench-mcp-server.md) and
   [`user-guide/21-service-tokens.md`](/user-guide/DC-17-service-tokens/21-service-tokens.md), and in the served
   `llms.txt` so an agent that is refused can read why.

### Explicitly NOT in this WP

The write tools themselves (WP M.3 — this WP ships the mechanism and zero write tools) · any change
to the scope vocabulary (D-C4 froze it) · any delete capability (D-MCP3, at every phase) · a second
auth knob (D-MCP7) · OAuth / per-user auth (that is `roadmap/team-server/`) · any web UI change (no
new `<Route>`; `ASSISTANT_ROUTE_MANIFEST` must have a zero-byte diff) · a migration (this WP
persists nothing new).

---

## Design (implement this, don't redesign it)

### 1. The route map — `packages/shared/src/api-tokens.ts`

WP 1.1 deliberately left per-route mapping to this WP, so extending that module is this WP's job.
**What must not change:** `API_TOKEN_SCOPES`, `API_TOKEN_EXECUTE_SCOPES`, and the meaning of
`requiredScopesForMethod` (keep it exported and unchanged — it is the fallback, and its tests stay).

Add, additively:

```ts
/** One route→scope rule. `match: "exact"` is a whole-path equality; "prefix" governs a subtree. */
export type ApiTokenRouteScopeRule = {
  method: "GET" | "HEAD" | "OPTIONS" | "POST" | "PUT" | "PATCH";
  path: string;
  match: "exact" | "prefix";
  scopes: readonly ApiTokenScope[];
};

/**
 * The per-route overrides. Everything NOT listed keeps the coarse method rule, so this table can
 * only ever RELAX a specific route — never widen the default, never cover a DELETE.
 */
export const API_TOKEN_ROUTE_SCOPES: readonly ApiTokenRouteScopeRule[] = [
  { method: "POST", path: "/api/mcp", match: "exact", scopes: ["read"] },            // D-MCP8
  { method: "POST", path: "/api/assertions/evaluate", match: "exact", scopes: ["read"] }, // D-C10
];
```

Rules the table itself must obey, asserted by tests rather than trusted:

- **No `DELETE` rule may exist**, ever (D-MCP3). `method` deliberately has no `"DELETE"` member, so
  this is a compile error rather than a review catch — and a test asserts no rule's path is under
  `/api/tokens` either (the guard refuses that first, but a rule pretending otherwise would be a
  trap for the next reader).
- **Every rule's `scopes` is non-empty.** An empty array would read as "no scope needed" and hand a
  route to any authenticated token.
- The mount rule is **exact**, not a prefix: `/api/mcp/llms.txt` is a `GET` and already needs only
  `read` from the coarse rule; a prefix here would silently relax any future `POST /api/mcp/*`.

The resolver:

```ts
/**
 * The scopes ANY ONE of which satisfies this request, or `null` when none can (a DELETE).
 * Consults {@link API_TOKEN_ROUTE_SCOPES} first, then falls back to {@link requiredScopesForMethod}.
 *
 * `pathMatches` is injected because the API must match on the RAW-and-DECODED **intersection**
 * (D-MCP9) using `utils/request-path.ts`, while a plain-string caller (a test, a doc generator) can
 * pass a simple equality. There is no default that silently does the wrong one.
 */
export function requiredScopesForRoute(
  method: string,
  pathMatches: (rulePath: string, match: "exact" | "prefix") => boolean,
): readonly ApiTokenScope[] | null;
```

`DELETE` short-circuits to `null` **before** the table is consulted, so no ordering accident can
grant one.

### 2. The guard — `apps/api/src/api-tokens/guard.ts`

One change inside `scopeCheck`: replace the `requiredScopesForMethod(method)` call with
`requiredScopesForRoute(method, matcher)`, where the matcher is built from the already-normalized
`RequestPath`:

```ts
const matcher = (rulePath: string, match: "exact" | "prefix") =>
  match === "exact"
    ? requestPathEqualsStrict(path, rulePath)
    : requestPathIsUnderStrict(path, rulePath);
```

`*Strict` are **new** helpers in `apps/api/src/utils/request-path.ts` that require **both** the raw
and the decoded form to match (D-MCP9), sitting beside the existing union-matching
`requestPathEquals` / `requestPathIsUnder`, which keep their current inclusive behaviour for
deciding what is governed. Do not change the existing two — their semantics are load-bearing and
were bought with a real bypass.

Everything else about the guard is untouched: the token-CRUD refusal still runs first, `DELETE` is
still refused outright, loopback still passes without a token, a presented token is still always
verified, and loopback is still decided from the socket.

### 3. The mount — per-tool scopes

**Declare the scope with the tool, in `packages/shared/src/workbench-mcp.ts`:**

```ts
/**
 * The scope each registered tool needs from a TOKEN-AUTHENTICATED caller. Every tool in WP M.1's
 * read surface is `read`; WP M.3's write tools name their execute scope here and nowhere else.
 * A test asserts this record's key set equals the registered tool names exactly — so a new tool
 * with no scope, or a scope for a tool that does not exist, fails the gate.
 */
export const WORKBENCH_MCP_TOOL_SCOPES: Record<string, ApiTokenScope> = { … };
```

**Carry the caller's authority into the per-request server.** The mount already builds a fresh
`McpServer` per POST, so this is a parameter, not state:

```ts
export type WorkbenchMcpCaller = {
  /** The scopes the calling token holds, or `null` for a trusted tokenless loopback call (D-MCP7). */
  grantedScopes: readonly ApiTokenScope[] | null;
  /** `mcpfp_ab12cd34` — the DISPLAY prefix, for the audit line. `null` when there is no token. */
  tokenPrefix: string | null;
  /** One audit line per tool call. Injected so a test can capture it without a logger. */
  audit: (entry: { tool: string; ok: boolean; durationMs: number; refusedScope?: string }) => void;
};
```

`registerWorkbenchMcpRoutes` builds it from `request.apiToken` (which WP 1.1's guard already
attaches) and `request.log`. **`grantedScopes: null` means every tool is allowed** — that is
D-MCP7, and it is the only reason a tokenless local agent keeps working exactly as it does today.

**Enforce at dispatch, in one place** — the loop in `createWorkbenchMcpServer` that registers each
definition wraps the handler:

- Look up the tool's required scope in `WORKBENCH_MCP_TOOL_SCOPES`. A tool **missing** from the map
  is refused (fail closed) — belt and braces behind the key-set test.
- `grantedScopes === null` → allowed.
- Otherwise the scope must be present, else return an **`isError` result** (not a transport error,
  not a thrown exception) whose text names the missing scope and where to grant it, e.g.
  *"This tool needs the `scan:run` scope. The token you connected with does not have it — create one
  in Settings › API tokens."* An `isError` result is what a host shows to the model, which is the
  only way the agent learns what to ask its operator for.
- Emit exactly one audit line per call — allowed or refused, success or failure.

**Resources** (`resources.ts`) need no per-resource scope in this WP: D-MCP8 means every
token-authenticated caller that reached the mount already holds `read`, and every resource is a
read. Say so in a comment rather than leaving the reader to work it out.

### 4. Docs

- `user-guide/20-workbench-mcp-server.md` — a short **"Connecting from another machine"** section:
  loopback needs nothing; a remote host needs a token with **`read`** (D-MCP8), and the header goes
  in the host's MCP config. Note that write tools do not exist yet (WP M.3).
- `user-guide/21-service-tokens.md` — add the mount and the assertions endpoint to whatever
  route/scope table that page carries, so "which scope do I tick" has one answer.
- `apps/api/src/mcp-server/llms-txt.ts` — one line in the served doc stating the mount needs `read`
  when a token is presented. It is rendered from the registered surface, so keep it generated, not
  hand-typed, wherever the existing code already generates.

---

## Files

**New** — `apps/api/test/mcp-server-scopes.test.ts` (mount enforcement + audit), plus test cases
added to the existing `apps/api/test/api-tokens-guard.test.ts` and the shared token tests.

**Modified** — `packages/shared/src/api-tokens.ts` (the map + resolver; the frozen vocabulary
untouched) · `packages/shared/src/workbench-mcp.ts` (the tool→scope record) ·
`apps/api/src/utils/request-path.ts` (the two strict matchers) ·
`apps/api/src/api-tokens/guard.ts` (one call swapped) ·
`apps/api/src/mcp-server/{routes,server,tools}.ts` (caller context, enforcement, audit) ·
`apps/api/src/mcp-server/llms-txt.ts` · `user-guide/20-workbench-mcp-server.md` ·
`user-guide/21-service-tokens.md` · `CLAUDE.md` (§6/§7 — the mount's scope requirement).

**Must have a zero-line diff:** `apps/web/src/**`, `packages/shared/src/assistant-route-manifest.ts`,
`apps/api/src/db/**` (**no migration**), `pnpm-lock.yaml`, `apps/cli/**` (the CLI does not speak MCP),
and — inside `api-tokens.ts` — `API_TOKEN_SCOPES` / `API_TOKEN_EXECUTE_SCOPES` /
`requiredScopesForMethod`'s behaviour (extended around, never edited).

---

## Acceptance

- **A1** — `API_TOKEN_ROUTE_SCOPES` + `requiredScopesForRoute` are declared once in
  `packages/shared/src/api-tokens.ts`; the frozen vocabulary and `requiredScopesForMethod` are
  unchanged and their existing tests still pass untouched.
- **A2 (D-MCP8)** — a **`read`-only** token may `POST /api/mcp` and complete `initialize` +
  `tools/list` + a real tool call; before this WP the same token was refused with `scope_forbidden`
  (assert both directions, so the test proves the change rather than restating the new behaviour).
- **A3 (D-C10)** — a `read`-only token may `POST /api/assertions/evaluate`; WP 1.3's endpoint now
  works for the token class it was always meant for.
- **A4 (fail-closed)** — an **unmapped** POST (`/api/servers/:id/scan`, `/api/run-plans`) still
  requires an execute scope, and a `read`-only token is still refused there.
- **A5 (D-MCP9)** — a percent-encoded ambiguous path does **not** inherit a relaxed rule: a
  `read`-only token hitting `/%61pi/mcp` is refused (the coarse rule applies), while `/api/mcp` is
  allowed. Pinned by a table that fails if the strict matcher is swapped for the union one.
- **A6 (D-MCP3)** — no rule in the table can express a `DELETE` (the type forbids it), no rule
  targets `/api/tokens*`, and every rule's `scopes` is non-empty; a token-authenticated `DELETE` to
  the mount is still refused.
- **A7 (per-tool)** — `WORKBENCH_MCP_TOOL_SCOPES`' key set equals the registered tool names exactly
  (a test that fails on a tool with no scope **and** on a scope with no tool), and every WP M.1 tool
  maps to `read`.
- **A8 (enforcement)** — with a fabricated write-scoped tool definition (no real write tool exists
  yet), a token lacking that scope gets an **`isError` result naming the missing scope**, not a
  transport error and not a stack trace; a token holding it succeeds; a tool absent from the map is
  refused.
- **A9 (D-MCP7)** — a **tokenless loopback** call reaches every tool, including the fabricated
  write-scoped one, exactly as it does today; and with `API_AUTH_REQUIRED=true` the same tokenless
  loopback call is refused at the HTTP layer.
- **A10 (audit)** — exactly one audit line per tool call, carrying the tool name, the outcome, the
  duration, and the token's **display prefix**; a test asserts the full plaintext token appears in
  **no** log line, for both an allowed and a refused call.
- **A11 (docs)** — `user-guide/20-…` explains connecting from another machine and that the mount
  needs `read`; `user-guide/21-…`'s scope guidance covers the mount and the assertions endpoint; the
  served `llms.txt` states the requirement and is still generated, not hand-typed.
- **A12 (gate)** — `pnpm typecheck && pnpm test && pnpm build && pnpm lint` green from the repo root.
  Two **pre-existing** failures may remain and must be reported as such, not fixed here: the two
  `apps/api/test/compatibility-data.test.ts` dataset failures and the Biome 1 MiB-cap error on
  `research/token-context-comparison/comparison/all-models.json` (both from `4eddf6f`). **Note: the
  owner may be fixing the dataset one in the working tree while this WP runs** — if those two tests
  pass on your branch, say so; do not touch those files either way.
- **A13 (no drive-by scope)** — no migration, no new dependency, no new environment variable
  (D-MCP7), no `<Route>`, no web change, no write tool; the zero-diff list above holds.
