import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import {
  _clearQlikAnswersAppContextCache,
  findAppId,
  QlikAnswersAppResolutionError,
  resolveQlikAnswersAppContext,
} from "../src/providers/model-catalog.js";

// Qlik Answers app-context resolution (Phase 4 rework). The env "model" is the assistant UUID; the run
// needs its bound Qlik Sense **app** id as the data context. This locks the resolution chain (assistant
// detail → cloud-assistants detail → knowledge-base data sources) + the field-guided `findAppId` scan +
// caching. NO real tenant — a stub fetch dispatches by URL.

const AUTH = { apiKey: "bearer-xyz", baseUrl: "https://acme.us.qlikcloud.com" };
const ASSISTANT_ID = "asst-uuid-1";

type Routes = Record<string, unknown>; // path-suffix → JSON body (missing = 404)

function stubFetch(routes: Routes, calls: string[] = []): typeof fetch {
  const impl = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    calls.push(url);
    const hit = Object.entries(routes).find(([suffix]) => url.endsWith(suffix));
    if (!hit) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(hit[1]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return impl as typeof fetch;
}

beforeEach(() => _clearQlikAnswersAppContextCache());

test("resolves the app id from the assistant detail's appIds[] (the live shape)", async () => {
  const calls: string[] = [];
  const fetchImpl = stubFetch(
    {
      // The real `GET /api/v1/assistants/{id}` shape for an app-backed assistant (verified 2026-07-11).
      [`api/v1/assistants/${ASSISTANT_ID}`]: {
        id: ASSISTANT_ID,
        name: "nytaxi-assistant",
        appIds: ["app-guid-123"],
        knowledgeBases: [],
        legacy: false,
      },
    },
    calls,
  );
  const appId = await resolveQlikAnswersAppContext(AUTH, ASSISTANT_ID, fetchImpl);
  assert.equal(appId, "app-guid-123");
  // Resolved on the FIRST endpoint — no cloud-assistants / KB fallback fetches were needed.
  assert.equal(calls.length, 1);
});

test("falls back to the cloud-assistants detail when the public detail lacks the app", async () => {
  const fetchImpl = stubFetch({
    [`api/v1/assistants/${ASSISTANT_ID}`]: { id: ASSISTANT_ID, knowledgeBases: ["kb-1"] },
    [`api/v1/cloud-assistants/${ASSISTANT_ID}`]: { appId: "app-from-cloud" },
  });
  assert.equal(await resolveQlikAnswersAppContext(AUTH, ASSISTANT_ID, fetchImpl), "app-from-cloud");
});

test("walks the knowledge base's data sources for a Qlik app id", async () => {
  const fetchImpl = stubFetch({
    [`api/v1/assistants/${ASSISTANT_ID}`]: { id: ASSISTANT_ID, knowledgeBases: ["kb-9"] },
    // cloud-assistants detail 404s; KB data-sources carries the app.
    "api/v1/knowledge-bases/kb-9/data-sources": {
      data: [{ id: "ds-1", sourceAppId: "app-in-kb" }],
    },
  });
  assert.equal(await resolveQlikAnswersAppContext(AUTH, ASSISTANT_ID, fetchImpl), "app-in-kb");
});

test("throws QlikAnswersAppResolutionError (the STOP case) when nothing yields an app id", async () => {
  const fetchImpl = stubFetch({
    [`api/v1/assistants/${ASSISTANT_ID}`]: { id: ASSISTANT_ID, knowledgeBases: [] },
  });
  await assert.rejects(
    () => resolveQlikAnswersAppContext(AUTH, ASSISTANT_ID, fetchImpl),
    (err: unknown) => err instanceof QlikAnswersAppResolutionError,
  );
});

test("caches the resolved app id per (baseUrl, assistantId) — a second call makes no fetches", async () => {
  const calls: string[] = [];
  const fetchImpl = stubFetch(
    { [`api/v1/assistants/${ASSISTANT_ID}`]: { appIds: ["cached-app"] } },
    calls,
  );
  assert.equal(await resolveQlikAnswersAppContext(AUTH, ASSISTANT_ID, fetchImpl), "cached-app");
  const afterFirst = calls.length;
  assert.equal(await resolveQlikAnswersAppContext(AUTH, ASSISTANT_ID, fetchImpl), "cached-app");
  assert.equal(calls.length, afterFirst, "the second resolve was served from cache");
});

test("findAppId: field-guided — appIds[] array, singular app-id keys, {type:'app'} objects, qri ids", () => {
  assert.equal(findAppId({ appIds: ["a0"], knowledgeBases: ["kb-x"] }), "a0"); // the live shape
  assert.equal(findAppId({ appId: "a1" }), "a1");
  assert.equal(findAppId({ nested: { sourceAppId: "a2" } }), "a2");
  assert.equal(findAppId({ type: "app", id: "a3" }), "a3");
  assert.equal(
    findAppId({ qri: "qri:app:sense://11112222-3333-4444-5555-666677778888" }),
    "11112222-3333-4444-5555-666677778888",
  );
  // A KB-id array is NOT grabbed (only explicit app-id keys); an assistant UUID under an unrelated key
  // is NOT grabbed either (field-guided, not any-GUID).
  assert.equal(findAppId({ knowledgeBases: ["kb-1", "kb-2"] }), undefined);
  assert.equal(findAppId({ assistantId: "aaaa-bbbb-cccc-dddd", name: "x" }), undefined);
});
