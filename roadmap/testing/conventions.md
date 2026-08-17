# Conventions every WP assumes

Shared rules and repo patterns so each WP spec stays focused on its own work. If a WP contradicts
this file, the WP is wrong — fix the WP.

## Stack ground truth

- **pnpm** workspace (`pnpm@9.15.4`). Not npm/yarn. Packages: `apps/api`, `apps/web`,
  `packages/shared`, `packages/brand-ui` (retired). Scoped `@mcp-token-footprint/*`, wired
  `workspace:*`.
- **TypeScript, ESM** (`"type":"module"`, `NodeNext`), strict + `noUncheckedIndexedAccess`. **Relative
  imports end in `.js`** (e.g. `import { x } from "./x.js"`) even for `.ts` sources.
- **API:** Fastify 5, `better-sqlite3`, `@modelcontextprotocol/sdk` ^1.12, `zod` ^3.24, `pino`,
  `nanoid`. **Web:** React 19, Vite 6, `lucide-react`, `@elabs-ai/components-*` (Tailwind v4).
- One SQLite file (`better-sqlite3`, synchronous). One Docker container, port 8080.

## The quality gate (definition of done)

A WP is done only when, from the repo root:

```bash
pnpm typecheck && pnpm test && pnpm build && pnpm lint
```

is green (linting is **Biome**, `biome.json`; the root `.github/workflows/ci.yml` runs the same set
on push + PR). Report completion honestly: "done"
means you ran the gate. Lead with anything you did **not** verify (especially visual/UX claims, which
must be checked against the running app at `http://localhost:8080`, never a mock).

## Contract-first workflow (do this for every wire change)

1. Add/adjust the **type** in `packages/shared/src/types.ts` and the **zod schema** in
   `packages/shared/src/schemas.ts` (and any `constants.ts` enum), export from `index.ts`.
2. `pnpm --filter @mcp-token-footprint/shared build` (api/web import the built package).
3. Implement the **API** handler against the schema.
4. Consume it in **web**.

Both ends type-check against one definition. Never define a wire shape in `api` or `web` directly.

## API layering & conventions

- Feature folder under `apps/api/src/<feature>/` with `repository.ts` (owns SQL), `service.ts` (owns
  orchestration), `routes.ts` (thin; validates with a shared zod schema, calls the service).
- Register routes in `apps/api/src/index.ts` with `await registerXRoutes(server, …deps)`, following
  the existing `registerServerRoutes` / `registerScanRoutes` calls. Construct repos/services at the
  top of `index.ts` like the existing ones.
- **Errors:** throw typed errors with a `statusCode`; the central handler in `index.ts` maps
  `ZodError → 400` and otherwise honors `error.statusCode` (default 500). Don't hand-roll error
  bodies. Helpers in `apps/api/src/utils/errors.ts`.
- **Additive only** on `/api/*`. New routes/fields fine; breaking changes graduate to `/api/v2`.
- IDs via `nanoid`; timestamps ISO strings (`new Date().toISOString()`). JSON columns hold
  `stableStringify`'d values (`apps/api/src/utils/json.ts`).

## Persistence

- Schema is one idempotent SQL string in `apps/api/src/db/schema.ts` (`CREATE TABLE IF NOT EXISTS`,
  `CREATE INDEX IF NOT EXISTS`). **Add new tables by appending blocks** — never rewrite existing ones.
  For a new column on an existing table, append an `ALTER TABLE … ADD COLUMN` guarded by a try/catch
  or a `PRAGMA table_info` check (additive migrations only).
- Row shapes + mappers go in `apps/api/src/db/rows.ts`. Repos take the `Database` handle (and
  `SecretStore` if they touch secrets), like `ServerRepository`/`ScanRepository`.

## Runtime & security boundary (hard)

- The agent loop, LLM provider calls, MCP connections, and secret decryption run **only in
  `apps/api`**. The browser receives **redacted** configs (booleans like `hasKey`, never values) and
  streamed events.
- Secrets use `apps/api/src/secrets/secret-store.ts` (`SecretStore`: `encryptText`/`decryptText`/
  `encryptJson`/`readJson`/`normalizeJson`, AES-256-GCM, `enc:v1:` prefix). New secret-bearing repos
  migrate plaintext → encrypted on construction (mirror `ServerRepository.migratePlaintextSecrets`).
- Never persist provider API keys or MCP secrets inside a run transcript. Redact known-secret tool
  arguments before storing `run_steps.payload_json`. Tool output is untrusted (store as data, render
  read-only, never `eval`/HTML-inject).

## Web conventions

- **No router.** View switch is `activeView: ViewKey` in `apps/web/src/App.tsx`; `ViewKey` + nav live
  in `apps/web/src/components/AppShell.tsx`. State is `useState` + `localStorage` + `fetch`. No Redux/
  Zustand/React Query/react-router (owner-gated to add any).
- API access via `apps/web/src/lib/api.ts` (`apiGet/apiPost/apiPut/apiDelete`). The SSE helper is
  added in WP 3.1.
- **brand-ui only** (`.claude/rules/brand-ui-only.md`, enforced by the `enforce-brand-ui` hook):
  every visible element is a `@elabs-ai/components-*` component; raw `<div>/<span>/<section>` for layout only.
  `className` is **layout only** — never recolor/retypeset; use a component's `variant`/`size`.
- **Tokens only** (`.claude/rules/styling-and-tokens.md`): `bg-background`, `bg-card`, `bg-muted`,
  `text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary`/`text-primary-foreground`,
  the `destructive` token, `--chart-1..5`, `ring-ring`. **No raw hex/rgb, no palette colors.**
  `tabular-nums` on comparing numbers. **Two themes** must read correctly: `light` (default)
  and `dark` — the two reference themes the library ships (see
  `.claude/rules/styling-and-tokens.md` "Themes (2)" + `apps/web/src/lib/theme.ts`); theme switching
  lives in **Settings**, not a top-nav switcher. Verify by looking (owner, at the running app).
- When `@elabs-ai/components-*` lacks something, it's a real upstream gap: compose from primitives in
  `apps/web/src/components/` or raise it; don't hand-roll. Reference: `vendor/brand-ui-agent-kit/`.

## Token counting

Reuse the `TokenCounter` interface (`apps/api/src/token-counting/types.ts`:
`countText`/`countJson`/`countToolDefinition`) and the three profiles in `profiles.ts`
(`generic_o200k` default, `generic_cl100k`, `raw_json_rough`). **Provider-actual** usage is *not* a
`TokenCounter` — it comes from the provider response and is handled separately (WP 1.4).

## Testing

Node test runner via `tsx`, files at `apps/api/test/*.test.ts` (see `server-routes.test.ts`,
`secret-store.test.ts` for the style). Web has no test harness yet — WP-level "acceptance" for web is
manual against the running app plus typecheck/build. Add API tests for every engine behavior.

## Naming

TS files **kebab-case**; React components **PascalCase**. Co-locate API tests as `name.test.ts`.
Feature web code under `apps/web/src/features/<area>/`.

## Working a WP — checklist

- [ ] Read the WP's **Prerequisites**, the linked **scope decision**, **UI section**, and **References**.
- [ ] Make shared contract changes first (if any), rebuild shared.
- [ ] Implement following the layering/patterns above and the existing sibling files cited in the WP.
- [ ] Add/extend tests per the WP's **Acceptance**.
- [ ] `pnpm typecheck && pnpm test && pnpm build`.
- [ ] Self-review against `.claude/rules/*`; for UI, check both themes (`light` + `dark`) in the running app.
