import type { ProviderCredential } from "@mcp-token-footprint/shared";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    listProviders: vi.fn(),
    listProviderModels: vi.fn(),
  };
});

import * as api from "../../lib/api";
import {
  findHubModelOption,
  HUB_ELIGIBLE_PROVIDER_KINDS,
  hubModelOptionKey,
  hubModelWireFields,
  modelSelectorLogoProvider,
  useHubModelRoster,
  type HubModelOption,
} from "./use-hub-models";

beforeEach(() => {
  vi.clearAllMocks();
});

function credential(overrides: Partial<ProviderCredential> = {}): ProviderCredential {
  return {
    id: "cred-1",
    kind: "anthropic",
    label: "Anthropic",
    hasKey: true,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("HUB_ELIGIBLE_PROVIDER_KINDS", () => {
  test("excludes qlik_answers (a hub non-goal, D-AH4)", () => {
    expect(HUB_ELIGIBLE_PROVIDER_KINDS).not.toContain("qlik_answers");
    expect(HUB_ELIGIBLE_PROVIDER_KINDS).toContain("claude_subscription");
  });
});

describe("modelSelectorLogoProvider", () => {
  test("claude_subscription reuses the anthropic mark; every other kind passes through", () => {
    expect(modelSelectorLogoProvider("claude_subscription")).toBe("anthropic");
    expect(modelSelectorLogoProvider("anthropic")).toBe("anthropic");
    expect(modelSelectorLogoProvider("openai_compatible")).toBe("openai_compatible");
  });
});

describe("useHubModelRoster", () => {
  test("filters to hub-eligible credentials, fetches + merges + dedupes their live model rosters", async () => {
    vi.mocked(api.listProviders).mockResolvedValue([
      credential({ id: "c1", kind: "anthropic" }),
      credential({ id: "c2", kind: "qlik_answers" }), // never a hub model — must be filtered out
      credential({ id: "c3", kind: "openai" }),
    ]);
    vi.mocked(api.listProviderModels).mockImplementation(async (id: string) => {
      if (id === "c1") {
        return {
          source: "provider",
          models: [
            { id: "claude-sonnet-5" },
            { id: "claude-opus-4-6", displayName: "Claude Opus 4.6" },
          ],
        };
      }
      if (id === "c3") {
        return { source: "provider", models: [{ id: "gpt-5" }] };
      }
      throw new Error("qlik_answers should never be queried for hub models");
    });

    const { result } = renderHook(() => useHubModelRoster());
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasCredential).toBe(true);
    expect(result.current.models.map((m) => m.modelId).sort()).toEqual(
      ["claude-opus-4-6", "claude-sonnet-5", "gpt-5"].sort(),
    );
    expect(api.listProviderModels).toHaveBeenCalledTimes(2); // never called for the qlik_answers credential
  });

  // WP4.3 — capability-gating verification (D-US4 discipline): `google`/`openai_compatible`/`ollama`
  // are hub-eligible kinds exactly like `anthropic`/`openai` (`HUB_ELIGIBLE_PROVIDER_KINDS`) — their
  // models are fetched + merged through the SAME generic path, never a kind-specific branch that could
  // silently drop one. A stubbed catalog per kind proves all three actually populate the roster.
  test("google/openai_compatible/ollama credentials are ALSO fetched + merged (never a providerKind branch)", async () => {
    vi.mocked(api.listProviders).mockResolvedValue([
      credential({ id: "c1", kind: "google" }),
      credential({ id: "c2", kind: "openai_compatible" }),
      credential({ id: "c3", kind: "ollama" }),
    ]);
    vi.mocked(api.listProviderModels).mockImplementation(async (id: string) => {
      if (id === "c1") return { source: "provider", models: [{ id: "gemini-2.5-pro" }] };
      if (id === "c2") return { source: "provider", models: [{ id: "mixtral-8x7b" }] };
      if (id === "c3") return { source: "provider", models: [{ id: "llama3.1" }] };
      throw new Error(`unexpected credential id: ${id}`);
    });

    const { result } = renderHook(() => useHubModelRoster());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.hasCredential).toBe(true);
    expect(
      result.current.models.map((m) => ({ modelId: m.modelId, kind: m.kind })).sort((a, b) =>
        a.modelId.localeCompare(b.modelId),
      ),
    ).toEqual(
      [
        { modelId: "gemini-2.5-pro", kind: "google" },
        { modelId: "llama3.1", kind: "ollama" },
        { modelId: "mixtral-8x7b", kind: "openai_compatible" },
      ].sort((a, b) => a.modelId.localeCompare(b.modelId)),
    );
    expect(api.listProviderModels).toHaveBeenCalledTimes(3);
  });

  test("one credential's roster fetch failing doesn't blank the others", async () => {
    vi.mocked(api.listProviders).mockResolvedValue([
      credential({ id: "c1", kind: "anthropic" }),
      credential({ id: "c2", kind: "openai" }),
    ]);
    vi.mocked(api.listProviderModels).mockImplementation(async (id: string) => {
      if (id === "c1") throw new Error("bad key");
      return { source: "provider", models: [{ id: "gpt-5" }] };
    });

    const { result } = renderHook(() => useHubModelRoster());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.models.map((m) => m.modelId)).toEqual(["gpt-5"]);
  });

  // ── D-MI8 — the collision that made the defect unfixable from the UI ────────────────────────────
  //
  // The subscription roster deliberately emits Anthropic's canonical ids (`subscription-models.ts`) so
  // `resolvePrice`/`MODEL_CONTEXT_LIMITS` stay exact-key lookups — so `claude-sonnet-5` is
  // byte-identical across the `anthropic` and `claude_subscription` credentials. The old dedupe keyed
  // on the bare model id GLOBALLY, over a list ordered `updated_at DESC`, so one twin was swallowed
  // and WHICH one survived flipped whenever an unrelated credential was edited.
  test("two credentials exposing the SAME model id both survive, each keeping its own credential", async () => {
    vi.mocked(api.listProviders).mockResolvedValue([
      credential({ id: "c-api", kind: "anthropic", label: "Anthropic" }),
      credential({ id: "c-sub", kind: "claude_subscription", label: "Anthropic CLI" }),
    ]);
    vi.mocked(api.listProviderModels).mockImplementation(async (id: string) => {
      if (id === "c-api") {
        return {
          source: "provider",
          models: [
            { id: "claude-sonnet-5", displayName: "Claude Sonnet 5" },
            { id: "claude-opus-4-8", displayName: "Claude Opus 4.8" },
          ],
        };
      }
      return {
        source: "provider",
        models: [
          { id: "claude-sonnet-5", displayName: "Sonnet" },
          { id: "claude-opus-4-8", displayName: "Opus" },
        ],
      };
    });

    const { result } = renderHook(() => useHubModelRoster());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Four rows, not two — neither twin is swallowed.
    expect(result.current.models).toHaveLength(4);
    const sonnets = result.current.models.filter((m) => m.modelId === "claude-sonnet-5");
    expect(sonnets.map((m) => m.credentialId).sort()).toEqual(["c-api", "c-sub"]);
    expect(sonnets.map((m) => m.kind).sort()).toEqual(["anthropic", "claude_subscription"]);
    // Every row has a distinct identity, and the wire model id stays the canonical bare one.
    expect(new Set(result.current.models.map(hubModelOptionKey)).size).toBe(4);
    for (const model of result.current.models) {
      expect(model.modelId).not.toContain("::");
    }
    // Selecting EITHER twin yields its own credential on the wire.
    for (const sonnet of sonnets) {
      expect(hubModelWireFields(sonnet)).toEqual({
        model: "claude-sonnet-5",
        providerCredentialId: sonnet.credentialId,
      });
    }
  });

  test("a credential that repeats a model id within its OWN roster is still deduped", async () => {
    vi.mocked(api.listProviders).mockResolvedValue([credential({ id: "c1", kind: "openai" })]);
    vi.mocked(api.listProviderModels).mockResolvedValue({
      source: "provider",
      models: [{ id: "gpt-5" }, { id: "gpt-5" }],
    });

    const { result } = renderHook(() => useHubModelRoster());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.models).toHaveLength(1);
  });

  test("no hub-eligible credential at all -> hasCredential false, empty roster, no crash", async () => {
    vi.mocked(api.listProviders).mockResolvedValue([
      credential({ id: "c1", kind: "qlik_answers" }),
    ]);

    const { result } = renderHook(() => useHubModelRoster());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasCredential).toBe(false);
    expect(result.current.models).toEqual([]);
    expect(api.listProviderModels).not.toHaveBeenCalled();
  });
});

// ── D-MI1/D-MI8 helpers ───────────────────────────────────────────────────────────────────────────

const TWINS: HubModelOption[] = [
  { modelId: "claude-sonnet-5", kind: "anthropic", credentialId: "c-api" },
  { modelId: "claude-sonnet-5", kind: "claude_subscription", credentialId: "c-sub" },
  { modelId: "gpt-5", kind: "openai", credentialId: "c-openai" },
];

describe("hubModelOptionKey", () => {
  test("is credential-scoped, so twins are distinct rows", () => {
    expect(hubModelOptionKey(TWINS[0] as HubModelOption)).toBe("c-api::claude-sonnet-5");
    expect(hubModelOptionKey(TWINS[1] as HubModelOption)).toBe("c-sub::claude-sonnet-5");
    expect(hubModelOptionKey(TWINS[0] as HubModelOption)).not.toBe(
      hubModelOptionKey(TWINS[1] as HubModelOption),
    );
  });
});

describe("findHubModelOption", () => {
  test("an exact credential match wins over the colliding twin", () => {
    expect(findHubModelOption(TWINS, "claude-sonnet-5", "c-sub")?.kind).toBe("claude_subscription");
    expect(findHubModelOption(TWINS, "claude-sonnet-5", "c-api")?.kind).toBe("anthropic");
  });

  test("no credential (a legacy/unpinned session) degrades to first-match-by-id", () => {
    expect(findHubModelOption(TWINS, "claude-sonnet-5")?.credentialId).toBe("c-api");
    expect(findHubModelOption(TWINS, "claude-sonnet-5", null)?.credentialId).toBe("c-api");
  });

  test("a credential that no longer holds the model falls back by id rather than resolving nothing", () => {
    expect(findHubModelOption(TWINS, "gpt-5", "c-deleted")?.credentialId).toBe("c-openai");
  });

  test("an unknown model id, or none at all, resolves to undefined", () => {
    expect(findHubModelOption(TWINS, "nope")).toBeUndefined();
    expect(findHubModelOption(TWINS, undefined)).toBeUndefined();
    expect(findHubModelOption(TWINS, "")).toBeUndefined();
  });
});

describe("hubModelWireFields", () => {
  test("sends the BARE model id plus the credential — never the composite key", () => {
    expect(hubModelWireFields(TWINS[1] as HubModelOption)).toEqual({
      model: "claude-sonnet-5",
      providerCredentialId: "c-sub",
    });
  });

  test("omits the credential entirely (never an empty string) when there is none", () => {
    expect(hubModelWireFields({ modelId: "gpt-5", credentialId: "" })).toEqual({ model: "gpt-5" });
  });
});
