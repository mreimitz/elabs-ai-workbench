import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { serializeRunMetricsRatio } from "@mcp-token-footprint/shared";
import { CSRF_HEADER_NAME, csrfCookieName } from "@mcp-token-footprint/shared";
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  apiPut,
  apiUpload,
  createHubSession,
  getAssistantStarters,
  getRunMetrics,
  sendHubMessage,
  updateHubSession,
} from "./api";

// WP R3.2 — pure query-building coverage for `getAssistantStarters`: each envelope field is appended
// only when present (never sent as an empty string), mirroring `assistantStartersQuerySchema`'s
// all-optional fields in `packages/shared`. `fetch` is stubbed so this stays fully offline (no network).

function mockFetchOk(body: unknown): ReturnType<typeof vi.fn> {
  const mocked = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(body),
  } as Response);
  vi.stubGlobal("fetch", mocked);
  return mocked;
}

const EMPTY_RESPONSE = { version: 1, surface: "global", starters: [] };

describe("getAssistantStarters", () => {
  beforeEach(() => {
    mockFetchOk(EMPTY_RESPONSE);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends no query string at all when every field is absent", async () => {
    await getAssistantStarters({});
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/assistant/starters");
  });

  it("includes only the fields that are present, omitting the rest", async () => {
    await getAssistantStarters({ entityKind: "scan", entityId: "scan-1" });
    const [url] = vi.mocked(fetch).mock.calls[0] as [string];
    const params = new URL(url, "http://localhost").searchParams;
    expect(params.get("entityKind")).toBe("scan");
    expect(params.get("entityId")).toBe("scan-1");
    expect(params.has("tab")).toBe(false);
    expect(params.has("route")).toBe(false);
  });

  it("includes all four fields when all are present", async () => {
    await getAssistantStarters({
      entityKind: "skill",
      entityId: "skill-1",
      tab: "quality",
      route: "/skills/skill-1",
    });
    const [url] = vi.mocked(fetch).mock.calls[0] as [string];
    const params = new URL(url, "http://localhost").searchParams;
    expect(params.get("entityKind")).toBe("skill");
    expect(params.get("entityId")).toBe("skill-1");
    expect(params.get("tab")).toBe("quality");
    expect(params.get("route")).toBe("/skills/skill-1");
  });

  it("omits an empty-string field the same as an absent one", async () => {
    await getAssistantStarters({ entityKind: "", route: "/dashboard" });
    const [url] = vi.mocked(fetch).mock.calls[0] as [string];
    const params = new URL(url, "http://localhost").searchParams;
    expect(params.has("entityKind")).toBe(false);
    expect(params.get("route")).toBe("/dashboard");
  });
});

// M7 / 04-M1 — the fetch helpers (`apiGet`/`apiPost`/`apiPut`/`apiDelete`/`apiUpload`) accepted no
// `AbortSignal`, so no caller could cancel an in-flight request (the M4/M5 stale-response guards had
// to fall back to a manual request-token instead). Locks the additive `signal?: AbortSignal` param:
// it reaches the underlying `fetch` call, and an aborted signal rejects the request the same way a
// real `fetch` would.

/** Mimics real `fetch`'s abort contract: rejects with a DOMException named "AbortError" when the
 *  passed `signal` is already aborted, otherwise resolves normally. */
function mockFetchRespectingAbort(body: unknown): ReturnType<typeof vi.fn> {
  const mocked = vi.fn((_url: string, init?: RequestInit) => {
    if (init?.signal?.aborted) {
      return Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
  });
  vi.stubGlobal("fetch", mocked);
  return mocked;
}

describe("AbortSignal support (M7 / 04-M1)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("apiGet threads the signal to fetch; an already-aborted signal rejects the call", async () => {
    const mocked = mockFetchRespectingAbort({});
    const controller = new AbortController();
    controller.abort();

    await expect(apiGet("/api/health", controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    const [, init] = mocked.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
  });

  it("apiGet still works normally when no signal is passed (backward-compatible)", async () => {
    mockFetchRespectingAbort({ ok: true });
    await expect(apiGet("/api/health")).resolves.toEqual({ ok: true });
  });

  it("apiPost threads the signal to fetch; an already-aborted signal rejects the call", async () => {
    const mocked = mockFetchRespectingAbort({});
    const controller = new AbortController();
    controller.abort();

    await expect(apiPost("/api/health", { ping: true }, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    const [, init] = mocked.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
  });
});

// ── model-identity WP 3.1 (D-MI1/D-MI8) — the credential actually reaches the WIRE ──────────────────
//
// The defect this workstream exists to close was a browser-side DISCARD: the picker knew the
// credential, the wire could not carry it, and the API re-guessed the provider from the model NAME —
// routing a signed-in "Anthropic CLI" session onto the metered Anthropic API key. These lock the
// serialized request bodies of the three shapes a picker writes, over a stubbed `fetch` (fully
// offline). `model` must stay byte-identical: the composite `${credentialId}::${modelId}` roster key
// is a LOCAL dedupe/React key and must never leak into a wire value (D-MI1 rejected a composite id).

describe("hub model identity rides the wire (model-identity WP 3.1)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function sentBody(mocked: ReturnType<typeof vi.fn>): Record<string, unknown> {
    const [, init] = mocked.mock.calls[0] as [string, RequestInit];
    return JSON.parse(String(init.body)) as Record<string, unknown>;
  }

  it("session create sends providerCredentialId alongside an unchanged bare model id", async () => {
    const mocked = mockFetchOk({ id: "s1" });
    await createHubSession({
      mode: "chat",
      model: "claude-sonnet-5",
      providerCredentialId: "cred-subscription",
    });

    const body = sentBody(mocked);
    expect(body).toMatchObject({
      mode: "chat",
      model: "claude-sonnet-5",
      providerCredentialId: "cred-subscription",
    });
    // The composite roster key never becomes the wire model id.
    expect(body.model).toBe("claude-sonnet-5");
    expect(String(body.model)).not.toContain("::");
  });

  it("a per-message override sends providerCredentialId alongside an unchanged bare model id", async () => {
    const mocked = mockFetchOk({ sessionId: "s1", streamUrl: "/api/hub/sessions/s1/stream" });
    await sendHubMessage("s1", {
      text: "hello",
      model: "claude-sonnet-5",
      providerCredentialId: "cred-subscription",
    });

    const body = sentBody(mocked);
    expect(body).toMatchObject({
      text: "hello",
      model: "claude-sonnet-5",
      providerCredentialId: "cred-subscription",
    });
    expect(String(body.model)).not.toContain("::");
  });

  it("the session model PATCH carries the re-pinned credential (and can explicitly unpin with null)", async () => {
    const mocked = mockFetchOk({ id: "s1" });
    await updateHubSession("s1", {
      model: "claude-sonnet-5",
      providerCredentialId: "cred-anthropic",
    });

    const [url, init] = mocked.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/hub/sessions/s1");
    expect(init.method).toBe("PATCH");
    expect(sentBody(mocked)).toEqual({
      model: "claude-sonnet-5",
      providerCredentialId: "cred-anthropic",
    });

    vi.unstubAllGlobals();
    const unpin = mockFetchOk({ id: "s1" });
    await updateHubSession("s1", { providerCredentialId: null });
    expect(sentBody(unpin)).toEqual({ providerCredentialId: null });
  });

  it("an unpinned (legacy) write omits the field entirely rather than sending an empty string", async () => {
    const mocked = mockFetchOk({ id: "s1" });
    await createHubSession({ mode: "chat", model: "claude-sonnet-5" });
    expect(sentBody(mocked)).toEqual({ mode: "chat", model: "claude-sonnet-5" });
  });
});

// ══ AM-OB4 — `getRunMetrics` puts the ratio on the query string ═══════════════════════════════════
//
// Every other web suite MOCKS `lib/api`, so nothing exercised the URL this function actually builds:
// deleting the `ratio` param left the whole web suite green (found by mutation). It matters because a
// silently-dropped ratio is not an error — the API answers `unavailableMeasures: ["ratio"]` and the
// chart renders an honest-looking blank.

describe("getRunMetrics — the ratio param (AM-OB4)", () => {
  beforeEach(() => {
    mockFetchOk({ bucket: "day", timezone: "UTC", from: null, to: null, groupBy: null, measures: [], unavailableMeasures: [], series: [] });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("serializes the ratio through the SHARED codec, so the API parses byte-identically", async () => {
    const ratio = { numerator: { hasError: true }, denominator: { status: ["completed"] as const } };
    await getRunMetrics({
      filter: {},
      bucket: "day",
      measures: ["ratio"],
      ratio: { numerator: ratio.numerator, denominator: { status: [...ratio.denominator.status] } },
    });
    const [url] = vi.mocked(fetch).mock.calls[0] as [string];
    const params = new URL(url, "http://localhost").searchParams;
    expect(params.get("measures")).toBe("ratio");
    expect(params.get("ratio")).toBe(
      serializeRunMetricsRatio({
        numerator: { hasError: true },
        denominator: { status: ["completed"] },
      }),
    );
  });

  it("omits the param entirely when no ratio is requested", async () => {
    await getRunMetrics({ filter: {}, bucket: "day", measures: ["errorRate"] });
    const [url] = vi.mocked(fetch).mock.calls[0] as [string];
    expect(new URL(url, "http://localhost").searchParams.has("ratio")).toBe(false);
  });
});

// -- The browser CSRF token (RM-37 WP 0.4) --------------------------------------------------------
//
// The API sets a `SameSite=Strict` cookie and requires it echoed back as `X-Workbench-Csrf` on every
// state-changing request from a tokenless caller. If ONE helper in this module forgets, that call
// 403s in production and nowhere else — the API tests cannot see the browser half, and the API's own
// suite is perfectly green while the app is broken. So the contract under test is "every
// state-changing helper carries it, and no GET does", asserted over the helpers themselves.

describe("CSRF header (RM-37 WP 0.4)", () => {
  const TOKEN = "Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWpr";

  function headersOf(call: unknown[]): Record<string, string> {
    const init = call[1] as RequestInit | undefined;
    return (init?.headers ?? {}) as Record<string, string>;
  }

  function stubCookie(value: string): void {
    Object.defineProperty(document, "cookie", { configurable: true, get: () => value });
  }

  beforeEach(() => {
    stubCookie(`theme=light; ${csrfCookieName("aB3dEf")}=${TOKEN}; other=1`);
    mockFetchOk({ ok: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rides on every state-changing helper", async () => {
    await apiPost("/api/x", {});
    await apiPut("/api/x", {});
    await apiPatch("/api/x", {});
    await apiDelete("/api/x");
    await apiUpload("/api/x", new File(["a"], "a.txt"));

    const calls = vi.mocked(fetch).mock.calls;
    expect(calls).toHaveLength(5);
    for (const call of calls) {
      expect(headersOf(call)[CSRF_HEADER_NAME]).toBe(TOKEN);
    }
    // The multipart upload must NOT gain a content-type — the browser sets it, boundary included.
    expect(headersOf(calls[4] as unknown[])["content-type"]).toBeUndefined();
  });

  it("never rides on a GET — a read has nothing to forge", async () => {
    await apiGet("/api/x");
    const init = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init).toBeUndefined();
  });

  it("is simply omitted when the cookie is absent, rather than sent blank", async () => {
    stubCookie("theme=light");
    await apiPost("/api/x", {});
    const headers = headersOf(vi.mocked(fetch).mock.calls[0] as unknown[]);
    expect(CSRF_HEADER_NAME in headers).toBe(false);
    expect(headers["content-type"]).toBe("application/json");
  });

  it("sends EVERY install's cookie, so two local instances do not fight over one slot", async () => {
    const other = "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVoxMjM0NTY";
    stubCookie(`${csrfCookieName("aB3dEf")}=${TOKEN}; ${csrfCookieName("zZ9yXw")}=${other}`);
    await apiPost("/api/x", {});
    const sent = headersOf(vi.mocked(fetch).mock.calls[0] as unknown[])[CSRF_HEADER_NAME] ?? "";
    expect(sent.split(",").sort()).toEqual([TOKEN, other].sort());
  });

  it("still threads the caller's AbortSignal alongside the header", async () => {
    const controller = new AbortController();
    await apiPost("/api/x", {}, controller.signal);
    const init = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit;
    expect(init.signal).toBe(controller.signal);
    expect((init.headers as Record<string, string>)[CSRF_HEADER_NAME]).toBe(TOKEN);
  });
});
