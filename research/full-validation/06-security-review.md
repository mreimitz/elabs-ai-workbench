# 06 — Security Review

**Target:** MCP Token Footprint (Fastify API + React 19 SPA, SQLite, connects to arbitrary MCP servers, stores encrypted credentials, ingests skill zips, runs LLM/provider calls and a spawned Claude-CLI assistant).
**Type:** Defensive audit for a release candidate. This is the project's own code being hardened — no exploit development.
**Date:** 2026-07-11
**Method:** Read-only inspection of `apps/api/src`, `apps/web/src`, `packages/shared`, `Dockerfile`, `docker-compose.yml`. Every citation below was read in the actual source; the five highest-impact findings were re-verified directly (line quotes confirmed).

---

## Threat model summary

The intended security model (from `.claude/rules/mcp-and-security.md` and CLAUDE.md §7):

- **API-only secret access.** Only `apps/api` spawns MCP stdio children, makes MCP HTTP calls, or decrypts secrets. The browser receives **redacted** configs (booleans only).
- **Encryption at rest.** MCP `env`/`headers`, OAuth material, provider API keys, and GitHub PATs are encrypted before SQLite persistence; the API never returns secret values.
- **Zip-bomb / zip-slip caps** on skill ingestion (both upload and GitHub paths).
- **No auth, no CORS, no multi-tenant** — accepted for a local single-owner tool bound to loopback.

Two deployment postures are graded separately:

| Posture | Description | Auth | Network |
| --- | --- | --- | --- |
| **Local (current)** | Single owner, `HOST=127.0.0.1` default, one trusted operator | None (by design) | Loopback |
| **Team-server (planned)** | Shared instance, multiple users, `roadmap/team-server/` | Local accounts + roles (planned) | LAN / shared host |

The critical shift for team-server: today the operator is the only actor and is fully trusted, so "user-supplied URL/command/path" is semi-trusted. On a shared instance, one user's input becomes an attack on the host and on other users' stored credentials — which is where the path-traversal, SSRF, and no-auth findings escalate.

---

## Coverage — what was reviewed

1. **Secrets & crypto:** `secrets/secret-store.ts`, `config/env.ts`, all of `oauth/`, all of `providers/`, `servers/repository.ts` redaction, `git/git-credential.ts`, `skills/git-service.ts`, `assistant/spawn-env.ts`, assistant read tools. Plus a repo-wide logging sweep for secret leakage.
2. **Skill/zip ingestion:** `skills/ingest-service.ts`, `caps.ts`, `git-service.ts`, `routes.ts`, `repository.ts` file-serving, `assistant/workspace.ts`, `collections/git-sync.ts`.
3. **Injection:** all 19 `*/repository.ts` + `db/*` for SQL; `mcp/client.ts` + `assistant/session-driver.ts` + `spawn-env.ts` + all `child_process` uses for command injection; report/static/skill-file routes for path traversal & header injection.
4. **SSRF:** probe endpoint, streamable-HTTP MCP, `servers/asset-proxy.ts`, `qlik-detect.ts`, `qlik-answers-probe.ts`, GitHub import, collections git sync.
5. **Web XSS & storage:** full `apps/web/src` sweep for `dangerouslySetInnerHTML`/`innerHTML`/etc.; markdown pipeline (Streamdown/`@brand/ai`), Mermaid config, SKILL.md rendering, skill file viewer/SVG, `href` construction, all `localStorage` keys, provider-key write-only invariant.
6. **Transport/container:** `index.ts` CORS/auth/rate-limit/error-handler/static, `Dockerfile`, `docker-compose.yml`, dependency versions.
7. **Logging:** tool-playground call route, MCP client `callTool`, runs engine, Fastify logger config, Qlik Answers debug lines.

---

## Summary table

| # | Finding | Local | Team-server | File |
| --- | --- | --- | --- | --- |
| H1 | Collection conflict-`resolve` path traversal → arbitrary host file write/delete | Medium | **High** | `collections/git-sync.ts:196` |
| M1 | Asset-proxy follows redirects, forwards stored credential off-origin (SSRF + cred leak) | Medium | **High** | `servers/routes.ts:169` |
| M2 | GitHub-import `subpath` path traversal → read arbitrary host files into a skill | Low | **Medium** | `skills/git-service.ts:300` |
| M3 | Unconditional `console.error` dumps Qlik tenant roster to logs (leftover "REMOVE" debug) | Medium | Medium | `providers/model-catalog.ts:301` |
| M4 | docker-compose publishes the unauthenticated API on `0.0.0.0:8080` | Low | **High** | `docker-compose.yml:11` |
| L1 | Git `ref`/`branch` not guarded against leading-dash argument injection | Low | Low | `skills/git-service.ts:404`, `collections/git-sync.ts:611` |
| L2 | `runGit` inherits full `process.env` (incl. `MCP_SECRET_KEY`) into git child | Low | Low | `git/git-credential.ts:57` |
| L3 | GitHub PAT passed in argv URL — visible in process listing during clone | Low | Medium | `git/git-credential.ts:102` |
| L4 | Native 500s echo `error.message` to the client (minor info disclosure) | Low | Low | `index.ts:482` |
| L5 | Protocol-relative markdown link (`//evil.com`) escapes router as off-site nav | Low | Low | `assistant/AssistantMessageBody.tsx:110` |
| L6 | Gated Qlik Answers debug dumps response bodies to stderr when env flag set | Low | Low | `testing/qlik-answers-executor.ts:169` |
| I1 | SKILL.md/LLM markdown safety depends entirely on a vendored sanitizer (no app-side pin/test) | Info | Info | `features/skills/SkillOverview.tsx:514` |
| I2 | No CORS / CSRF protection (state-changing POSTs triggerable cross-site) | Info | Medium | `index.ts` (absent) |

**Counts:** 0 Critical · 1 High · 4 Medium · 6 Low · 2 Info.
(Severity taken at the higher of the two postures where they differ; H1 is the team-server grade.)

---

## Findings by severity

### HIGH

#### H1 — Collection conflict-`resolve` path traversal → arbitrary host file write/delete
**File:** `apps/api/src/collections/git-sync.ts:196` · sink `:199`, `:206` · route schema `apps/api/src/collections/routes.ts:17`
**Local: Medium · Team-server: High** (verified directly)

The resolve route accepts an unconstrained path:

```ts
// collections/routes.ts:17
path: z.string().min(1),        // only .min(1) — no ../ / absolute / NUL guard
```

The sink joins it straight onto the clone directory and writes/deletes **before git ever validates it**:

```ts
// collections/git-sync.ts:196-206
const abs = path.join(clonePath, ...res.path.split("/"));
if (res.resolution === "edited") {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, res.content ?? "");         // attacker-controlled path + content
  ...
} else {
  ...
  fs.rmSync(abs, { force: true });                  // attacker-controlled delete
```

`res.path = "../../../../home/user/.bashrc"` makes `abs` resolve outside `clonePath`, giving arbitrary-file write (with attacker-chosen content) and delete. The `git add -- res.path` afterward uses `--` (so no argv injection) and will fail for an out-of-tree path — but the filesystem write has already executed. Precondition: a merge must be in progress (`:190`), i.e. the caller first drives a conflicted sync against a bound repo they control. Feasible for anyone who can reach the collections API. `/data` (holding `app.sqlite` + `mcp-secret.key`) is a write target.

**Fix:** validate every `res.path` with the same discipline as `workspace.ts:assertSafeRelativePath` (reject absolute, any `..` segment, NUL), and assert `path.resolve(abs)` stays within `path.resolve(clonePath)` before any `fs` op. The safe-path helper already exists in the codebase — reuse it.

---

### MEDIUM

#### M1 — Asset-proxy follows redirects and forwards the stored credential off-origin (SSRF + credential leak)
**File:** `apps/api/src/servers/routes.ts:169` (verified directly)
**Local: Medium · Team-server: High**

```ts
const response = await fetch(fetchUrl, { headers: config.headers ?? {} });
```

`resolveAssetFetchUrl` (`servers/asset-proxy.ts:88-108`) correctly pins the **initial** URL to the MCP server's origin (same-origin check, image-MIME-only, 5 MB cap — all sound). But this `fetch` uses undici's default `redirect: "follow"`. A malicious or compromised configured MCP server returns an on-origin `assets_get` URL that then 302-redirects to an internal address (e.g. `http://169.254.169.254/…`). undici strips `Authorization`/`Cookie` cross-origin but does **not** strip arbitrary custom headers — and `config.headers` is exactly where a custom auth header (`X-API-Key`, etc.) lives. So the redirect both reaches an internal host (SSRF) and forwards the stored server credential to an attacker-chosen destination. There is also no `signal`/timeout, so a hanging fetch stalls the request.

**Fix:** `redirect: "manual"` and re-run the same-origin check on `response.headers.get("location")` (or refuse all 3xx); add an `AbortSignal` timeout; consider stripping non-standard auth headers on any allowed redirect.

#### M2 — GitHub-import `subpath` path traversal → read arbitrary host files into a skill
**File:** `apps/api/src/skills/git-service.ts:300` · schema `packages/shared/src/schemas.ts:909`
**Local: Low · Team-server: Medium**

```ts
const root = sparse ? path.join(tmpDir, ...subpath.split("/")) : tmpDir;
...
const files = readTreeFiles(root, this.caps);
```

`subpath` is validated only as `z.string().trim().default("")` — no `..`/absolute rejection. `subpath = "../../../../etc"` escapes `tmpDir`; `readTreeFiles` then stats and reads every file under that host directory into the stored skill version (later downloadable via the file/raw/export routes → local file disclosure). Mitigations: the resolved root must contain a `SKILL.md` (`:310`) before anything is persisted, and the ingest caps bound total bytes/files — so `/etc` (no SKILL.md) is read transiently but not stored. A repo containing a symlink + a crafted subpath widens it. Still an unsanitized containment escape reading into `/data`-adjacent trees.

**Fix:** reject `subpath` with absolute or `..` segments in the schema; additionally assert `path.resolve(root)` is within `path.resolve(tmpDir)` before `readTreeFiles`.

#### M3 — Unconditional debug dump of Qlik Answers roster to stderr (leftover "REMOVE" code)
**File:** `apps/api/src/providers/model-catalog.ts:301` (verified directly)
**Local: Medium · Team-server: Medium**

```ts
// TEMP DEBUG (qlik retrieval diagnosis) — REMOVE. Raw assistant objects incl. knowledgeBases/spaceId.
console.error("[QA-DEBUG roster]", JSON.stringify(record?.data).slice(0, 6000));
```

Unlike the sibling `qaDebug()` helpers (gated behind `QLIK_ANSWERS_DEBUG`), this line is **unconditional** and runs on every `GET /api/providers/:id/models` for a `qlik_answers` credential, writing up to 6000 chars of the tenant's raw assistants list (names, `knowledgeBases`, `spaceId`) to server stderr. No bearer token is in `record.data`, so this is tenant-metadata disclosure into logs rather than a credential leak — but it is explicitly self-labeled temporary and must not ship.

**Fix:** delete the line (or gate it behind `qaDebug`/`QLIK_ANSWERS_DEBUG` like the others).

#### M4 — docker-compose publishes the unauthenticated API on all host interfaces
**File:** `docker-compose.yml:11` (verified directly) · `:15` `HOST: "0.0.0.0"`
**Local: Low · Team-server: High**

```yaml
ports:
  - "8080:8080"
```

Combined with `HOST: "0.0.0.0"` and no auth layer anywhere in `index.ts`, this binds `0.0.0.0:8080` on the host, exposing the entire API (create servers, trigger git imports, read scans, proxy assets, drive the assistant) to anyone on the LAN. The app's own default is safe (`host: "127.0.0.1"`, `config/env.ts:74`), but the Docker deployment deliberately overrides it and the compose mapping does not restrict the host side. This is the single biggest gap for the planned team-server posture until real auth lands.

**Fix:** bind to loopback on the host side — `"127.0.0.1:8080:8080"`. (`HOST=0.0.0.0` inside the container is required for the port map to reach Node; the restriction belongs on the host mapping.) Do not expose beyond loopback until the team-server auth (`roadmap/team-server/`) is built.

---

### LOW

#### L1 — Git `ref`/`branch` not guarded against a leading `-` (argument-injection hardening)
**File:** `apps/api/src/skills/git-service.ts:404`, `apps/api/src/collections/git-sync.ts:611`/`:620` · schemas `packages/shared/src/schemas.ts:908`/`:622`/`:956`

```ts
({ stdout } = await this.git(["ls-remote", authRepoUrl, ref], process.cwd()));
```

`ref`/`branch` are `z.string().trim().min(1)` with no leading-dash/charset guard, and here they are bare positionals (no `--` terminator). git parses options anywhere on the line, so `--upload-pack=…`/`--sort=…`/`--output=…` would be interpreted as options. **Not** command injection: `runGit` uses `execFile` (no shell) and the transport is forced `https://`, so the classic `--upload-pack` local-RCE does not fire — this is option-injection only. Clone paths pass `ref` as the value of `--branch`, so they are already safe. Worth closing as defense-in-depth (particularly before team-server).

**Fix:** reject refs/branches beginning with `-` (or restrict to a git-ref-safe charset) and pass positional refs after a `--` separator where the subcommand supports it.

#### L2 — `runGit` passes the full `process.env` to the git child
**File:** `apps/api/src/git/git-credential.ts:57` (verified directly)

```ts
env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "", ...options.env },
```

The spawned `git` inherits the API's entire environment including `MCP_SECRET_KEY`, `DATABASE_PATH`, and any `ANTHROPIC_API_KEY`. Inconsistent with the exemplary minimal env built for the assistant child (`spawn-env.ts`) and the stdio-MCP transport (curated `getDefaultEnvironment()`). Not directly exploitable (no shell; git needs PATH/HOME), but it removes a defense-in-depth layer that would matter if L1 ever became exploitable.

**Fix:** pass a minimal allowlist env (`PATH`, `HOME`, `GIT_*`, proxy vars), mirroring `buildAssistantSpawnEnv`.

#### L3 — GitHub PAT passed inside the argv URL (visible in process listing)
**File:** `apps/api/src/git/git-credential.ts:102-114` (`withToken`), used at `skills/git-service.ts:117,274,401`
**Local: Low · Team-server: Medium**

```ts
url.username = "x-access-token";
url.password = token;
return url.toString();
```

The `https://x-access-token:<PAT>@host/...` string is handed to `git` as an argv element. During the clone/`ls-remote` window any local user can read the token via `ps auxww` / `/proc/<pid>/cmdline`. `redactUrl` correctly covers logs and error responses, but not the live process table. Strictly better than a credential file, but argv is world-readable on a shared host.

**Fix:** feed the credential out-of-band — `git -c http.extraHeader="Authorization: Basic <base64>"` (header value not in the URL) or a `GIT_ASKPASS` helper — so the secret never appears in argv.

#### L4 — Native 500 errors echo `error.message` to the client
**File:** `apps/api/src/index.ts:482`

```ts
return reply.code(statusCode).send({ error: toErrorMessage(error), ...(code ? { code } : {}) });
```

`toErrorMessage` returns `error.message` for any `Error`. No stack trace is sent (good) and the full error is logged server-side, but a raw native message (SQLite errors, filesystem paths) can reach the client on an unexpected 500 — minor info disclosure.

**Fix:** for non-typed errors (no `statusCode`), return a generic "Internal Server Error" and keep detail in the server log.

#### L5 — Protocol-relative markdown link escapes the router as off-site navigation
**File:** `apps/web/src/features/assistant/AssistantMessageBody.tsx:110-112`

```ts
if (typeof href === "string" && href.startsWith("/")) {
  return (<Link to={href} …>
```

`href` comes from LLM/assistant markdown. `//evil.com` satisfies `startsWith("/")` and is handed to react-router `Link`, which the browser resolves as a protocol-relative **external** URL — an open-redirect on click. (`javascript:` does not reach here and is sanitized by Streamdown upstream.)

**Fix:** guard with `href.startsWith("/") && !href.startsWith("//")` before rendering a `Link`.

#### L6 — Gated Qlik Answers debug dumps response bodies to stderr
**File:** `apps/api/src/testing/qlik-answers-executor.ts:169-176`; `apps/api/src/providers/model-catalog.ts:84-92`

```ts
if (process.env.QLIK_ANSWERS_DEBUG) {
  console.error(`[QA-DEBUG ${label}]`, JSON.stringify(data ?? null).slice(0, 20000));
```

When the env flag is set, up to 20 000 chars of upstream **response bodies** are written to stderr. The request `headers` (holding the bearer) are never passed in, so tokens are not logged — exposure is response payloads only. Acceptable as opt-in, but confirm the flag is never set in the shipped image.

**Fix:** document that the flag must stay unset in production; consider further truncation/scrubbing.

---

### INFO

#### I1 — SKILL.md / LLM markdown safety depends entirely on a vendored sanitizer (no app-side pin or test)
**File:** `apps/web/src/features/skills/SkillOverview.tsx:514`, `apps/web/src/features/testing/.../ChatMarkdown.tsx:80,121`

```tsx
<MessageResponse>{renderedBody}</MessageResponse>
```

`renderedBody` is the SKILL.md body of an uploaded/GitHub-imported skill — fully attacker-controllable and may contain raw HTML (`<script>`, `<img onerror>`, `javascript:` links) and `mermaid` fences. **Currently safe:** Streamdown v2.5.0's default pipeline is `rehype-raw → rehype-sanitize → harden`, and `rehype-sanitize` strips scripts/handlers/`javascript:`; Mermaid runs at `securityLevel:"strict"`. The caveat: the app pins none of this and the harden step is configured wide-open (`allowedProtocols:["*"]`, `allowDataImages:true`). The only barrier is a stage inside a **vendored** `@brand/ai` + a transitive `streamdown` pin. A future bump that reorders/drops that stage silently turns this into a stored-XSS sink triggered by opening a hostile skill.

**Fix:** add a regression test rendering a `<script>`/`<img onerror>`/`javascript:` SKILL.md through `MessageResponse` and asserting inertness; consider passing explicit `allowedImagePrefixes`/`allowedLinkPrefixes` and `allowDataImages:false` so the posture doesn't depend on library internals.

#### I2 — No CORS / CSRF protection with no auth
**File:** `apps/api/src/index.ts` (no `@fastify/cors`, `@fastify/rate-limit`, or auth middleware — verified by grep)
**Local: Info · Team-server: Medium**

The app relies on the loopback default bind + browser same-origin policy. Absent CORS means cross-origin JS cannot **read** responses, but state-changing `POST`s can still be triggered cross-site (CSRF) — a malicious page could POST a skill import or create a server against `127.0.0.1:8080`. Acceptable for a localhost single-owner tool; the risk compounds with M4 (0.0.0.0 exposure) and becomes material for team-server.

**Fix (team-server):** an Origin/CSRF-token check on state-changing routes, alongside the planned auth.

---

## Verified-good (checked and sound)

**Secret store — `secrets/secret-store.ts`**
- AES-256-GCM (authenticated), `:24`. Fresh random 12-byte IV **per encryption** (`:23`) — never reused. Key length enforced to 32 bytes (`:13-15`, `:126-128`). Auth tag captured (`:28`) and enforced on decrypt via `setAuthTag` (`:51`); AAD bound both sides (`:25`, `:50`).
- Decrypt failure throws a generic message; underlying error only in `cause` (`:55-59`) — no plaintext/key leak.
- Key file written `mode:0o600`, `flag:"wx"` (exclusive create) with an EEXIST re-read race fallback (`:111-118`). `MCP_SECRET_KEY` env used in-memory, never written to disk (`:95-97`).

**OAuth — `oauth/*`**
- Tokens, client info, discovery state all `encryptJson` before persistence (`repository.ts:60,81,102,134`); code verifier `encryptText` (`:118`).
- `GET /api/oauth/status/:serverId` returns only `{serverId, authenticated}` (`service.ts:113-118`) — no token reaches the browser.
- `state` validated on callback with a 10-min TTL, unknown/expired rejected, swept at startup (`repository.ts:16,153-169`) — replay/CSRF mitigated. Callback HTML escapes interpolated values; `postMessage` carries only `{serverId, ok}` (`routes.ts:37-83`). No token logging.

**Providers — `providers/*`**
- API keys encrypted at rest (`repository.ts:41-43,86-87`); `apiKey` write-only on update (omitting preserves). List/detail go through `redact()` → `hasKey` boolean, never the value (`:199-224`). `getDecrypted` is internal-only, never wired to a route; decrypted keys flow only into the AI SDK. `linked-auth.ts` broken-link error embeds no token/header.

**Servers redaction — `servers/repository.ts`**
- Single redaction point `toPublicServer()` → `hasEnvSecrets`/`hasHeaderSecrets` booleans only (`:238-264`); both route serializers (`list`, `getPublic`) use it. `env_json`/`headers_json`/OAuth client id+secret encrypted on write. `toInternalServer()` (decrypted) feeds only the MCP transport/executors behind the runtime boundary; `testServer` returns `{tools,durationMs,events}` only. Probe returns counts/booleans.

**Assistant boundary — `assistant/spawn-env.ts`, `tools/*`**
- Child env fully replaced with a minimal safelist: `HOME`, `CLAUDE_CONFIG_DIR`, `PATH`, plus exactly one auth var (`CLAUDE_CODE_OAUTH_TOKEN` xor `ANTHROPIC_API_KEY`); app secrets dropped; HOME scoped under the assistant data dir. Read-tool allowlist exposes only redacted/non-secret shapes.

**Logging sweep** — no logger/`console` call logs secret material or full tool-call argument payloads. Tool-playground `requestPayload` used only for token/byte counting, never logged (`scans/service.ts:295-349`). MCP `callTool` forwards args with no logging. Fastify default request serializer records method/url/remoteAddr — **not** the body. Runs engine logs run ids + short messages only.

**Zip ingestion — `skills/ingest-service.ts`, `caps.ts`**
- Extraction purely in-memory (`fflate` streaming `Unzip`), no per-entry disk write. Zip-slip guarded **before** inflate (`assertSafeZipEntryPath`, rejects absolute + any `..`). Zip-bomb enforced **during** decompression, per chunk, counting actual inflated bytes (declared size never trusted); ignored entries (`.git`/`__MACOSX`) still metered. Symlink entries become inert blobs; nested zips stored opaque. Export zip rebuilt in-memory. GitHub path enforces caps **before** reading contents.

**SSRF baseline — `git/git-credential.ts`, `schemas.ts`, `qlik-*`**
- Skill/collection git: `https://`-only schema + literal-host block (`isBlockedIp` covers loopback/RFC1918/link-local incl. `169.254.169.254`/IPv6 ULA/mapped) + pre-network DNS-resolution guard `assertHostAllowed` on every clone/fetch/ls-remote/push. `file://`/`ssh://`/`git://` rejected. TOCTOU/rebind residual explicitly acknowledged in-code.
- Qlik Answers probe forwards the bearer only to a host gated by `isLikelyQlikTenantUrl` (`*.qlikcloud.com` + `/api/ai/mcp`) — no arbitrary-host credential leak.
- MCP probe/config URLs use bare `.url()` with no internal-host block — **by design** (MCP servers may be internal) and use the owner's own supplied auth.

**Command execution**
- `mcp/client.ts` stdio: no `shell:true`; env `{...getDefaultEnvironment(), ...config.env}` — app secrets **not** inherited by MCP children. `git-credential.ts` uses `execFile` (no shell), disables credential helpers, blocks interactive prompts, hard timeout. Collections git has no force-push; refspecs always prefixed; `--` separators for pathspecs. `compatibility/build-cli.ts` has no child_process.

**SQL** — all 19 `repository.ts`/`db` files swept; every `${…}` in SQL text is a hardcoded table/column literal or a schema-/PRAGMA-derived name, never user input. ORDER BY clauses static; LIMIT integer-validated + bound; IN-lists use `?` placeholders. No user-controllable interpolation.

**Path traversal (serving)** — skill file-by-path lookups are parameterized DB queries keyed on exact `path` (`repository.ts:593-597,626-629`), no filesystem join — traversal structurally impossible on `/file`, `/raw`, `/export`. `assistant/workspace.ts` re-validates every DB path (`assertSafeRelativePath`) before the disk join and refuses symlinks escaping the skill dir via `realpathSync` containment. `@fastify/static` (`index.ts:590-594`) normalizes/blocks `..`. Report `Content-Disposition` filenames interpolate only internal nanoids; skill download disposition sanitized (strips `"`/CR/LF).

**Web XSS** — no `dangerouslySetInnerHTML`/`innerHTML`/`insertAdjacentHTML`/`document.write`/`DOMParser`/`srcDoc` in app source (only comments affirming absence + download-anchor helpers). Untrusted tool-call/LLM results render as **text** via read-only Monaco or auto-escaped React children. Skill binary files (incl. `.svg`) are download-only, never inlined. Mermaid at `securityLevel:"strict"`.

**Client storage** — no secrets in `localStorage`/`sessionStorage`; keys are UI state only (theme, dock width, token profile, export prefs, panel sizes, OAuth "last verified OK" **timestamps** — not tokens). Provider API keys are write-only to the web (`lib/api.ts:379`, `SettingsView.tsx:989` — never returned).

**Container** — Dockerfile non-root `USER node` (`:114`), `/data` chowned, `init:true` reaps zombies, HEALTHCHECK present (Dockerfile + compose). Dependencies current: fastify ^5.1, @fastify/static ^9, @fastify/multipart ^10, better-sqlite3 ^12.11, zod ^3.24, @modelcontextprotocol/sdk ^1.12, react ^19, vite ^6, node-pty pinned 1.1.0 (patched). No ancient/risky pins. Error handler sends no stack trace; ZodError→400. Default 1 MB body limit; skill upload capped separately.

---

*End of review.*
