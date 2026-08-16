# 15. The OpenAI-compatible endpoint

The app can expose a **Qlik Answers assistant as an ordinary OpenAI model**. Point any client that
speaks the standard **Chat Completions** protocol — Open WebUI, LiteLLM, another benchmark
harness, your own script — at this app's URL, and it can chat with your Qlik Answers assistant the
same way it would talk to GPT-4 or Claude. No Qlik-specific integration on the client's side.

This is separate from [Qlik Answers as a model](./11-qlik-answers.md), which runs an assistant
*inside* this app's own Testing console. The endpoint described here does the opposite: it lets
**outside tools** reach an assistant *through* this app.

## Why this matters

A lot of tooling in the AI ecosystem only knows how to talk to "an OpenAI-compatible endpoint." By
speaking that protocol, a Qlik Answers assistant becomes usable from that entire ecosystem —
chat UIs, evaluation harnesses, internal demos — without anyone having to write a Qlik-specific
client. Point the tool at the app, give it the assistant's name as the "model," and it works.

## Setting it up

The endpoint lives at:

```
http://<your-app-host>:8080/openai/v1
```

(`http://localhost:8080/openai/v1` if you're running the app locally.) It implements the two
calls every OpenAI-compatible client makes:

- `POST /openai/v1/chat/completions`
- `GET /openai/v1/models`

### Authenticating

Every request needs an `Authorization: Bearer <key>` header — this is a **locally-minted key**,
separate from and never derived from your Qlik Cloud credentials. The app mints it the first time
the endpoint runs and saves it to a small file in the same data directory as the database
(`DATA_DIR/openai-facade.key`, i.e. `/data/openai-facade.key` in Docker), written with `0600`
permissions (owner read/write only, not world-readable) — the same pattern the app already uses
for `mcp-secret.key`. That file holds the plain key value itself; it is **not encrypted**, so its
protection is the filesystem permission plus keeping `DATA_DIR` out of git (it's git-ignored) and
off anything else that can read the volume. Read that file once and paste the value into your
client's "API key" field; the key doesn't change across restarts.

> Keep this key private. Anyone who has it can run questions against your Qlik Answers assistant
> (and consume your tenant's question quota) through this app.

### The model list

`GET /openai/v1/models` returns every Qlik Answers assistant this app can resolve, listed as
models (`owned_by: "qlik"`, id = the assistant's id). Configure a `qlik_answers`
[provider](./13-settings.md) in the app first — that's what the endpoint resolves a `model` value
against. Point your client's model picker at this list the same way it would pick `gpt-4o` or
`claude-sonnet-4`.

## How a conversation works

A Qlik Answers assistant doesn't work like a stateless model — it holds a **thread** on the Qlik
Cloud side. This app bridges the gap automatically: when your client sends its whole growing
message history (as every normal chat client does — each turn resends everything so far), the app
recognizes the *unchanged* prefix and reuses the same underlying Qlik thread, sending only the
newest message. From the outside it looks exactly like a stateless model that remembers the
conversation.

**The one caveat — edited history causes amnesia.** If your client (or you, scripting against the
endpoint) edits, deletes, or regenerates an earlier message in the conversation before sending the
next one, the app can no longer recognize the conversation as a continuation. It transparently
starts a **brand-new Qlik thread**, and the assistant answers as if the earlier turns never
happened. This is a deliberate, documented trade-off, not a bug: there is no way to "edit" a Qlik
thread's history, only to start fresh. If you need guaranteed continuity, don't edit earlier turns
— only ever append.

## Streaming: hold-back vs. live-stream

By **default**, the endpoint streams the assistant's **reasoning live** as it's produced, but
holds the **answer** back until it has fully settled, then sends it as one piece. This matches how
the app's own run console works: the reasoning is a live process, but the answer text should only
ever be the one, final, correct version — never a half-formed guess your client might display and
then have to silently replace.

If you'd rather see the answer stream in token-by-token, live, set:

```
OPENAI_FACADE_LIVE_STREAM=true
```

With this on, the raw answer text streams as it arrives from Qlik Answers. The trade-off: what
streams live can, in rare cases, differ slightly from the final, settled answer (Qlik's own
guardrails and citation cleanup happen after the stream). Hold-back is the safer default; treat
live-stream as an explicit opt-in for clients that need to *see* tokens arrive and can tolerate
that small risk. (If nothing streamed live at all for a given answer, the endpoint still delivers
the settled answer once, so you're never left with an empty response.)

## Vendor fields and citations

Standard OpenAI clients only understand `choices[].message.content`. This endpoint also attaches
extra, Qlik-specific detail that a client can opt into reading:

- **`citations`** (top-level, on the finish chunk / completion object) — a Perplexity-style
  citations array.
- **`qlik_answers`** (same location) — the full picture: `threadId`, `appId`, `messageId`,
  `assistantVersion`, `questionsConsumed`, the measure `expressions` behind the answer, any
  `snapshots` (the underlying data), and structured `reasoningSections`.

A plain client that only reads `content` never sees these and works fine. A client built on the
Vercel AI SDK's `@ai-sdk/openai-compatible` package can read them losslessly via its
`metadataExtractor` option, surfaced as `providerMetadata` on the result — the same mechanism this
app's own engine already uses for other providers.

**Token counts are estimates.** The Qlik Answers API doesn't report real token usage, so every
`usage` figure (`prompt_tokens`/`completion_tokens`/`total_tokens`) is this app's own estimate,
computed the same way the rest of the app estimates tokens. This is marked explicitly:
`qlik_answers.estimatedTokens` is always `true`. Don't treat these numbers as exact billing
figures — they're a consistent, honest estimate, not a metered fact.

## Keeping the tenant safe: the concurrency cap

Your Qlik Cloud tenant has its own rate limit, shared across every client that talks to this
endpoint. To avoid one runaway client burning through that shared budget, the endpoint admits only
a limited number of `/chat/completions` requests at once (four, by default) and rejects anything
over that limit immediately with a standard `429` + `Retry-After` — exactly the response shape
OpenAI clients already know how to back off and retry on, so well-behaved clients handle this
without any special code. Raise the limit with:

```
OPENAI_FACADE_MAX_CONCURRENCY=8
```

`GET /openai/v1/models` is never gated — listing models doesn't touch your tenant.

## Error semantics

The endpoint always replies with the standard OpenAI error envelope
(`{ "error": { "message", "type", "param", "code" } }`), so clients handle failures the way they
already know how to.

| Situation | Response |
| --- | --- |
| Wrong or missing bearer key | `401` — `invalid_api_key` |
| `model` isn't a resolvable Qlik Answers assistant | `404` — `model_not_found` |
| Your Qlik Cloud tenant fails (5xx, or anything unexpected) **while resolving the model** to an app | `404` — `model_not_found` — indistinguishable, at that phase, from "no such assistant" (see note below) |
| This endpoint is at its own concurrency cap | `429` — `facade_concurrency_limit_exceeded`, with `Retry-After` |
| Your Qlik Cloud tenant is itself rate-limited | `429` — `rate_limit_exceeded`, with `Retry-After` |
| The stored Qlik credential is rejected upstream | `401` — `invalid_api_key` (the tenant's own auth failure, not your bearer key) |
| Your Qlik Cloud tenant fails (5xx, or anything unexpected) **during the run/stream itself** (after the model resolved) | `502` — `upstream_error` |
| The assistant's own guardrail declines the prompt | **Not an HTTP error** — a normal `200` completion with `finish_reason: "content_filter"` and empty content |

Sampling parameters (`temperature`, `top_p`, `max_tokens`, …) are accepted and silently ignored —
there's no Qlik Answers equivalent, and rejecting them would break clients that always send them.

**Why a resolution-phase tenant failure isn't a 502.** Resolving a `model` to a Qlik app id and
actually running the turn share the same tenant call, but resolution happens first and its failure
path currently can't tell "the tenant errored" apart from "there's no app bound to this
assistant" — both collapse to the same `undefined`. That's a real, if low-severity, seam in the
resolver this endpoint shares with the rest of the app (a transient tenant outage during that one
phase is mislabeled as "model doesn't exist" rather than "try again"); every *other* tenant
failure — including the identical 5xx during the run/stream call — is correctly reported as `502`.
Splitting "unreachable/5xx" from "no app id" in that shared resolver is a possible future
improvement, tracked separately from this endpoint.

## What to use it for

- **Plug a Qlik Answers assistant into any tool that already speaks OpenAI** — chat UIs,
  evaluation harnesses, internal demos — with zero Qlik-specific glue code on their side.
- **Benchmark other harnesses against the app's own numbers.** Because the underlying call is the
  same one the app's own [Qlik Answers runs](./11-qlik-answers.md) make, results line up.
- **Give a customer a URL, not a SDK.** For a quick demo, "point your OpenAI client at this URL"
  is a much shorter conversation than teaching someone a new API.

---

Next: [Assistant →](./16-assistant-hub.md)
