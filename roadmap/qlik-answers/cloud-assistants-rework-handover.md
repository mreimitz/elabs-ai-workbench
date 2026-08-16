# Qlik Answers — cloud-assistants rework · handover (new Opus 4.8 session)

Paste the block below as the first message of a fresh Claude Code session in `mcp-token-footprint/`
(model **Opus 4.8**). It reworks the qlik-answers executor onto the **real** Qlik Answers API after
live testing proved the shipped implementation calls the wrong endpoint. Living state:
[`STATUS.md`](./STATUS.md). Prior plan/decisions: [`README.md`](./README.md),
[`../research/qlik-answers-as-model.md`](../research/qlik-answers-as-model.md).

---

You are the implementer for a **qlik-answers API rework**. All 14 original qlik-answers WPs shipped to
`main` and are gate-green, BUT live testing on a real tenant proved they call the **wrong Qlik API** — a
run returns HTTP 200 with *"I don't have any information"* and zero sources. Your job: rework execution
onto the API Qlik Answers actually uses, verify it live, and revise the plan/research to match reality.

## THE FINDING (definitive, proven — do not re-litigate)
Our `/api/v1/assistants/` implementation is **100% spec-correct** (verified against the official OpenAPI
spec `qlik.dev/specs/rest/assistants.json`: thread `{name}`; invoke/stream `{input:{prompt,
promptType?("thread"), includeText?}}`; response `{output, sources, question}`). It is **NOT a request
bug.** The assistants invoke/stream API only does RAG over the assistant's **`knowledgeBases`** — and the
tenant's assistants have **`knowledgeBases: []` (EMPTY)** and are backed by **`appIds`** (Qlik Sense apps):
`nytaxi-assistant` → `appIds:["8ac375d0-3149-4d71-8549-6086591aa44e"]`, `ontime-assistant` →
`appIds:["174e3c60-c5fb-48de-bf01-a4468d9f3197"]`. The assistants API does NOT query `appIds`, so it
correctly returns "no information" + zero sources (raw captured: `{"output":"I'm sorry, I don't have any
information…"}{"sources":[]}`). API key vs OAuth, scopes, one-shot-vs-thread all made zero difference —
none was ever the cause. App-backed assistants are answered via the **`cloud-assistants`** API + an app
context, exactly as the working script does.

The **working path** (customer script — READ IT FIRST:
`/Users/czq/Downloads/Answers Sample Extract Script 2/answers_extract_script/src/python/call_answers.py`):
- **Thread:** `POST {base}/api/v1/cloud-assistants/threads` body
  `{ "name": <name>, "context": { "type":"app", "id": APP_ID, "data": {"mode":"live"} } }`
- **Prompt (SSE):** `POST {base}/api/v1/cloud-assistants/{thread_id}/actions/stream` body
  `{ "context": {"type":"app","id":APP_ID,"data":{"mode":"live"}}, "content": [ {"text": question} ] }`
  → Server-Sent-Events / NDJSON (`data: {…}` or bare `{…}` lines). Collect the **last `messageId`** seen
  (top-level or nested under `data`/`params`/`payload`).
- **Answer:** `GET {base}/api/v1/cloud-assistants/threads/{thread_id}/messages` → find message
  `id == messageId` → extract from `content[0].card.body[]` (TextBlocks; the answer is the first non-empty
  text AFTER a `"Conclusion"` TextBlock, strip `<citation…>…</citation>` tags) + the `qHyperCubeDef` /
  `qMeasures[].qDef.qDef` values (the data expressions = "reasoning"). The script also has a
  `_find_last_ai_message` + `_last_text` + `_collect_hypercubes_with_sources` fallback path — mirror both.
- **Auth:** `Authorization: Bearer <key>` + `Content-Type: application/json`. It uses `requests` retries
  on 429/5xx.

Key: the request must bind a **Qlik Sense APP** via `context:{type:"app", id:APP_ID}`. The `/api/v1/
assistants/` roster (listing `nytaxi-assistant`/`ontime-assistant` UUIDs) is fine — only EXECUTION is wrong.

## OWNER-LOCKED REQUIREMENTS (2026-07-11)
1. **Reimplement execution against `/api/v1/cloud-assistants/`** + the app-context body above.
2. **Resolve the APP_ID from the assistant** — it's **`assistant.appIds[0]`**, already on the object
   `GET /api/v1/assistants` returns (the roster fetches it in `model-catalog.listQlikAnswers` then
   discards it — capture it). Env "model" stays the assistant UUID; resolve `appIds[0]` at run time. NO
   research needed. (If an assistant has BOTH populated `knowledgeBases` and `appIds`, decide precedence
   — but the live tenant's assistants are app-only with empty `knowledgeBases`.)
3. **Capture answer + the full official response + reasoning + expressions.** The `llm_response` step's
   `assistantText` = the answer text (graders read it). Persist the raw message + the hypercube
   expressions/reasoning in the step payload (additive shared contract — the current `sources` model is
   wrong for app assistants; keep `sources` optional, add e.g. `expressions`, `rawResponse`, `reasoning`).

## UNKNOWNS TO RESEARCH FIRST (against the real tenant + the script)
- How to resolve APP_ID from the assistant UUID (see #2). If unresolvable, STOP and ask the owner.
- The exact `messages` structure + the most robust answer/expression extraction (use the script as truth;
  save a raw message JSON via debug logging and read it).
- Whether thread-create + stream both need the `context`; whether `promptType` exists here at all (likely
  not — this API uses `content:[{text}]`, no promptType). Revise D-QA3 accordingly.
- Whether the roster should stay `/api/v1/assistants` (probably yes) and only execution changes.

## CURRENT STATE
- **Git:** `origin/main` = `beb368a` (all 14 qlik WPs + the toolbar workstream, gate green). `main` is the
  trunk — see [[main-is-trunk-post-consolidation]]. A concurrent "toolbar" session may hold the shared
  checkout on branch `toolbar/integration` and can switch it out from under you — **do ALL main
  integration in a DEDICATED worktree** (`git worktree add .worktrees/<name> main`), never assume the
  shared checkout is on `main`; re-verify `origin/main` before every push; pathspec commits only. See
  [[concurrent-autocommit-in-repo]].
- **Running app = Docker** (container `mcp-token-footprint-mcp-token-footprint-1`, project
  `mcp-token-footprint`, volume `mcp-token-footprint_mcp-token-footprint-data` = the DB + auto secret key).
  It currently runs a **DEBUG build** from worktree `.worktrees/qa-fix` (uncommitted: raw `[QA-DEBUG]`
  request/response logging in `qlik-answers-executor.ts` + a NON-FIX `promptType:"thread"` change). **First
  cleanup task: revert both** (the promptType change + the debug logging) — they are NOT on `main`, only in
  that worktree/container. Start your rework from clean `main`.
- **Tenant/data (for live verification):** tenant `https://barcbenchmark.de.qlikcloud.com`; provider
  `EzcRgeGvLl4fDpM251nlg` (`Qlik Answers — barc-benchmark`, `authSource: linked_server` OAuth — owner may
  switch to an API key); env (scenario) `MTPc6Dn0h7TSY6MNRUP0k` = `nytaxi-assistant`
  (`b9244fb4-cc4e-4f02-b637-84fc67daa25d`); test `JL75hBtqCnyHMxuR0XOqR` (the NYC-taxi benchmark question).
  Other assistant: `ontime-assistant` (`32b6c653-3ccd-4435-a34f-112d2dca786a`). **No live-tenant call from
  code/tests** — stub everything behind the injectable fetch; the ONLY live calls are your manual
  verification runs (each consumes 1 question of the owner's quota — be sparing).

## VERIFY LIVE (how the prior session did it)
1. Make changes in a worktree; `docker compose -p mcp-token-footprint up --build -d` from that worktree's
   `mcp-token-footprint/` → rebuilds the image, REUSES the same volume (DB + creds persist). ~2-3 min.
2. Launch: `POST http://localhost:8080/api/run-plans` body
   `{"source":"adhoc","testIds":["JL75hBtqCnyHMxuR0XOqR"],"scenarioIds":["MTPc6Dn0h7TSY6MNRUP0k"]}` → a
   suiteRun id. Member: `GET /api/suite-runs/{id}/members` → runId. Answer: `GET /api/runs/{runId}` →
   the `llm_response` step's `assistantText` + payload. Raw tenant I/O: temporary `console.error("[QA-DEBUG
   …]")` in the executor → `docker logs mcp-token-footprint-mcp-token-footprint-1 | grep QA-DEBUG`.
3. Success = a REAL answer about NYC taxi data + expressions, not "no information".

## FILES (expect to touch)
`apps/api/src/testing/qlik-answers-executor.ts` (the rework — new endpoints, app-context body, SSE
messageId → GET messages → extract), `apps/api/src/providers/model-catalog.ts` (app-id resolution; roster
likely unchanged), `packages/shared/{types,schemas}.ts` (additive `AnswersStepPayload` fields: expressions
/reasoning/rawResponse; keep `sources` optional), the executor tests + run-service tests (new wire), and
**revise `roadmap/research/qlik-answers-as-model.md` §2 + README D-QA3** to the cloud-assistants reality.
Plan it as new WPs in the `roadmap/qlik-answers/STATUS.md` ledger (e.g. a "Phase 4 — cloud-assistants
rework"). Do NOT touch `apps/api/src/assistant/*` (Claude dock). Contract-first (shared→api→web, additive),
brand-ui only, both themes. Gate = `pnpm typecheck && pnpm test && pnpm build && pnpm lint` (use `corepack
pnpm@9.15.4`, `-r --sort --workspace-concurrency=1` build, `NODE_OPTIONS=--max-old-space-size=3400`).

## DELIVERABLES
Working executor verified against the live tenant (real answer + expressions); additive payload contract;
revised research doc + D-QA3; gate green; merged to `main` via a dedicated worktree; ledger + owner-
acceptance updated. Honest reporting: "green" = you ran the gate; the live run is owner-witnessed.
