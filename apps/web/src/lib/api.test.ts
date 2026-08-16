import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  apiGet,
  apiPost,
  createHubSession,
  getAssistantStarters,
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
