---
type: "Work Package Spec"
title: "WP 1.1 \u2014 Provider credentials (global, encrypted)"
description: "Phase: 1 \u00b7 Size: M \u00b7 Depends on: 0.3, 0.4"
tags: ["roadmap", "RM-26"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 1.1 — Provider credentials (global, encrypted)

**Phase:** 1 · **Size:** M · **Depends on:** 0.3, 0.4

## Objective
Store LLM provider API keys / local base-URLs **encrypted, global at the app level**, never returned
to the browser; expose a model factory that turns a credential into an AI SDK model. Scope decision
#15.

## Why / references
Reuse the exact secret model already in the repo (`SecretStore`, AES-256-GCM, `enc:v1:`) — see
`conventions.md` → security, and `.claude/rules/mcp-and-security.md`. Mirror
`apps/api/src/servers/repository.ts` (encryption + redaction + `migratePlaintextSecrets`).

## Files (new unless noted)
- `apps/api/src/providers/repository.ts`
- `apps/api/src/providers/service.ts`
- `apps/api/src/providers/routes.ts`
- `apps/api/src/providers/registry.ts`  (credential → AI SDK model)
- `apps/api/src/index.ts` *(modify — construct + register)*

## Design — repository (redaction is the whole point)
```ts
export class ProviderRepository {
  constructor(private db: Database, private secrets: SecretStore) {}
  create(input: ProviderCredentialInput): ProviderCredential {
    const apiKeyEncrypted = input.apiKey ? this.secrets.encryptText(input.apiKey) : null;
    // INSERT … ; return redact(row)
  }
  list(): ProviderCredential[] { /* map rows → redact() */ }
  // INTERNAL ONLY — never leaves the API process:
  getDecrypted(id: string): { kind: ProviderKind; baseUrl?: string; apiKey?: string } { /* decryptText */ }
  migratePlaintextSecrets(): number { /* normalizeJson/encryptText like ServerRepository */ }
}
// redact() → ProviderCredential with hasKey = Boolean(api_key_encrypted), no key value.
```

## Design — registry (the one place AI SDK provider packages are imported)
```ts
// providers/registry.ts
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
// … google, openai-compatible, ollama (WP 2.3 fills the rest)
export function modelFor(cred: DecryptedCredential, model: string): LanguageModel {
  switch (cred.kind) {
    case "anthropic": return createAnthropic({ apiKey: cred.apiKey })(model);
    case "openai":    return createOpenAI({ apiKey: cred.apiKey })(model);
    case "openai_compatible": return createOpenAI({ apiKey: cred.apiKey ?? "x", baseURL: cred.baseUrl })(model);
    // …
    default: throw httpError(400, `Unsupported provider kind: ${cred.kind}`);
  }
}
```

## Routes
`GET /api/providers` (redacted list) · `POST /api/providers` (`providerCredentialInputSchema`) ·
`PUT /api/providers/:id` · `DELETE /api/providers/:id`. Thin handlers → service. Register in
`index.ts` next to `registerServerRoutes`.

## Implementation steps
1. Construct `new ProviderRepository(db, secretStore)` in `index.ts`; call `migratePlaintextSecrets()`
   on boot (log count, like the servers migration).
2. Implement repository/service/routes per the layering in `conventions.md`.
3. `registry.ts` imports the provider packages from WP 0.2; only Anthropic needs to work for the
   vertical slice — stub the others to a clear `400` until WP 2.3.

## Acceptance
- Create a credential → `GET` returns it with `hasKey:true` and **no key**. A test asserts the raw key
  never appears in any route response body.
- The stored row is encrypted (`enc:v1:` prefix) — assert via the repo/db.
- `modelFor()` returns a usable Anthropic model (covered indirectly by WP 1.3's loop test).
- Gate: typecheck + test + build green.

## Security notes
- `getDecrypted()` is API-internal; never expose a route that returns it. Don't log the key.
