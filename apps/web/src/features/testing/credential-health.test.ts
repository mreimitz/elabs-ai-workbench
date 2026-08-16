import { afterEach, describe, expect, test, vi } from "vitest";
import type { ProviderCredential } from "@mcp-token-footprint/shared";

// `testCredential` uses the real provider-credential check (`GET /api/providers/:id/models`) — mock
// that one function so these unit tests never hit the network.
vi.mock("../../lib/api", () => ({ listProviderModels: vi.fn() }));
import { listProviderModels } from "../../lib/api";
import {
  credentialHealthLabel,
  credentialHealthView,
  getCredentialHealth,
  isCredentialUnverified,
  recordCredentialHealth,
  testCredential,
} from "./credential-health";

const listProviderModelsMock = vi.mocked(listProviderModels);

function provider(overrides: Partial<ProviderCredential> = {}): ProviderCredential {
  return {
    id: "prov-1",
    kind: "anthropic",
    label: "My Anthropic key",
    hasKey: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

afterEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe("credential-health store (T7)", () => {
  test("resting state is 'unknown' (Never tested) — never a fabricated 'verified'", () => {
    expect(getCredentialHealth(provider()).state).toBe("unknown");
    expect(getCredentialHealth(undefined).state).toBe("unknown");
    expect(isCredentialUnverified(provider())).toBe(true);
    expect(credentialHealthLabel("unknown")).toBe("Never tested");
  });

  test("recording a success reads back as verified with a checkedAt", () => {
    const p = provider();
    expect(recordCredentialHealth(p, { ok: true }).state).toBe("verified");
    expect(getCredentialHealth(p).state).toBe("verified");
    expect(getCredentialHealth(p).checkedAt).toBeTruthy();
    expect(isCredentialUnverified(p)).toBe(false);
  });

  test("recording a failure keeps the error message", () => {
    const p = provider();
    recordCredentialHealth(p, { ok: false, error: "401 Unauthorized" });
    const health = getCredentialHealth(p);
    expect(health.state).toBe("failed");
    expect(health.error).toBe("401 Unauthorized");
  });

  test("a recorded check is INVALIDATED when the credential changes (updatedAt moves)", () => {
    const p = provider({ updatedAt: "2026-01-01T00:00:00Z" });
    recordCredentialHealth(p, { ok: true });
    expect(getCredentialHealth(p).state).toBe("verified");
    // The key was edited since the check — a stale "verified" must drop to "unknown", never mislead.
    const edited = provider({ updatedAt: "2026-02-01T00:00:00Z" });
    expect(getCredentialHealth(edited).state).toBe("unknown");
  });

  test("credentialHealthView maps each state to a canonical chip (never tested = dashed neutral)", () => {
    expect(credentialHealthView("verified")).toMatchObject({ label: "Verified", tone: "success" });
    expect(credentialHealthView("failed")).toMatchObject({ label: "Failed", tone: "danger" });
    expect(credentialHealthView("unknown")).toMatchObject({
      label: "Never tested",
      tone: "neutral",
      dashed: true,
    });
  });

  test("testCredential records verified on a reachable provider, failed otherwise", async () => {
    const p = provider();
    listProviderModelsMock.mockResolvedValueOnce({ models: [], source: "provider" });
    expect((await testCredential(p)).state).toBe("verified");

    listProviderModelsMock.mockRejectedValueOnce(new Error("401 Unauthorized"));
    const failed = await testCredential(p);
    expect(failed.state).toBe("failed");
    expect(failed.error).toContain("401");
  });
});
