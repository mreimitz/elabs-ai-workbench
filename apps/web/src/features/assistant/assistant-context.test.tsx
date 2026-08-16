import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { act, renderHook, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { AssistantAuthStatus } from "@mcp-token-footprint/shared";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, getAssistantAuthStatus: vi.fn() };
});

import * as api from "../../lib/api";
import { AssistantProvider, deriveAssistantEnvelope, useAssistant } from "./assistant-context";

const DOCK_OPEN_KEY = "mcp-token-footprint.assistant.dock-open";

const SIGNED_OUT: AssistantAuthStatus = { signedIn: false, fallbackConfigured: false, models: [] };
const SIGNED_IN: AssistantAuthStatus = {
  signedIn: true,
  fallbackConfigured: false,
  models: ["claude-sonnet-4-5"],
};
const FALLBACK_ONLY: AssistantAuthStatus = {
  signedIn: false,
  fallbackConfigured: true,
  models: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  vi.mocked(api.getAssistantAuthStatus).mockResolvedValue(SIGNED_OUT);
});

// ── deriveAssistantEnvelope — pure, no React ──────────────────────────────────────────────────────

describe("deriveAssistantEnvelope", () => {
  test("a route with no known dynamic id carries no entity pin", () => {
    expect(deriveAssistantEnvelope("/dashboard", "")).toEqual({ route: "/dashboard" });
  });

  test.each([
    ["/servers/srv-1", "server", "srv-1"],
    ["/scans/scan-1", "scan", "scan-1"],
    ["/skills/skill-1", "skill", "skill-1"],
    ["/testing/collections/col-1", "collection", "col-1"],
    ["/testing/suite-runs/sr-1", "suite_run", "sr-1"],
    ["/testing/runs/run-1", "run", "run-1"],
    // assistant-operability WP 4.2 — the scan-report page pins to the EXISTING `scan` kind (no new
    // entity kind, D-AO3), same as its `/scans/:scanId` sibling.
    ["/reports/scans/scan-1", "scan", "scan-1"],
  ] as const)("pins %s to entity {kind: %s, id: %s}", (pathname, kind, id) => {
    expect(deriveAssistantEnvelope(pathname, "")).toEqual({
      route: pathname,
      entityKind: kind,
      entityId: id,
    });
  });

  test("the static /testing/runs/new and /testing/runs/compare siblings never resolve to a run entity", () => {
    expect(deriveAssistantEnvelope("/testing/runs/new", "")).toEqual({
      route: "/testing/runs/new",
    });
    expect(deriveAssistantEnvelope("/testing/runs/compare", "")).toEqual({
      route: "/testing/runs/compare",
    });
  });

  // R1.1 (D-AS19) — the scope-reconciliation surface: these routes carry NO single entity id, so they
  // stay UNPINNED (deriveAssistantScope → null = read-only). Compare is read-only BY DESIGN
  // (SCOPE_WRITE_TOOLS.compare === []); scenario/test and the suite-DEFINITION page are deferred (no
  // URL id today) — see resolveEntityPin's doc block. Locking these in guards against a future pin that
  // silently widens the write scope.
  test.each([
    ["/compare/scans"],
    ["/testing/environments"],
    ["/testing/runs/compare"],
    ["/testing/suites/suite-1"],
    // /reports/digest is a report route with no single-entity dock surface (unlike its
    // /reports/scans/:scanId sibling, which WP 4.2 pinned to `scan`) — confirms the prefix match added
    // for /reports/scans/ does not spill over onto /reports/digest/.
    ["/reports/digest/digest-1"],
  ] as const)(
    "%s carries no entity pin (inherently unscoped / deferred → read-only)",
    (pathname) => {
      expect(deriveAssistantEnvelope(pathname, "")).toEqual({ route: pathname });
    },
  );

  test("a `?tab=` query param is carried as the envelope's tab, alongside an entity pin", () => {
    expect(deriveAssistantEnvelope("/skills/skill-1", "?tab=security")).toEqual({
      route: "/skills/skill-1",
      entityKind: "skill",
      entityId: "skill-1",
      tab: "security",
    });
  });

  test("a nested sub-path under an entity route still pins the entity (id is the first segment)", () => {
    expect(deriveAssistantEnvelope("/testing/collections/col-1/tests", "")).toEqual({
      route: "/testing/collections/col-1/tests",
      entityKind: "collection",
      entityId: "col-1",
    });
  });
});

// ── AssistantProvider / useAssistant — the frozen openAssistant() API ────────────────────────────

function wrapper({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter initialEntries={["/dashboard"]}>
      <AssistantProvider>{children}</AssistantProvider>
    </MemoryRouter>
  );
}

describe("AssistantProvider / useAssistant", () => {
  test("starts closed, with authConfigured false until the auth check resolves", async () => {
    const { result } = renderHook(() => useAssistant(), { wrapper });
    expect(result.current.isOpen).toBe(false);
    expect(result.current.authConfigured).toBe(false);

    await waitFor(() => expect(result.current.authStatus).not.toBeNull());
    expect(result.current.authConfigured).toBe(false); // SIGNED_OUT resolved
  });

  test("authConfigured is true for EITHER a subscription sign-in or an API-key fallback", async () => {
    vi.mocked(api.getAssistantAuthStatus).mockResolvedValue(SIGNED_IN);
    const { result } = renderHook(() => useAssistant(), { wrapper });
    await waitFor(() => expect(result.current.authConfigured).toBe(true));

    vi.mocked(api.getAssistantAuthStatus).mockResolvedValue(FALLBACK_ONLY);
    const { result: fallbackResult } = renderHook(() => useAssistant(), { wrapper });
    await waitFor(() => expect(fallbackResult.current.authConfigured).toBe(true));
  });

  test("openAssistant() opens the dock with no pending request", async () => {
    const { result } = renderHook(() => useAssistant(), { wrapper });
    await waitFor(() => expect(result.current.authStatus).not.toBeNull());
    // `openAssistant` re-checks auth status (fire-and-forget) — `act(async ...)` lets that microtask
    // flush inside the act boundary so it doesn't warn on a later, un-wrapped update.
    await act(async () => {
      result.current.openAssistant();
    });
    expect(result.current.isOpen).toBe(true);
    expect(result.current.pendingRequest).toBeNull();
  });

  test("openAssistant({ prompt, entity }) stamps a nonce'd pending request — the FROZEN public shape", async () => {
    const { result } = renderHook(() => useAssistant(), { wrapper });
    await waitFor(() => expect(result.current.authStatus).not.toBeNull());
    await act(async () => {
      result.current.openAssistant({
        prompt: "Why did this fail?",
        entity: { kind: "run", id: "run-1" },
      });
    });
    expect(result.current.isOpen).toBe(true);
    expect(result.current.pendingRequest).toMatchObject({
      prompt: "Why did this fail?",
      entity: { kind: "run", id: "run-1" },
    });
    const firstNonce = result.current.pendingRequest?.nonce;
    expect(typeof firstNonce).toBe("number");

    // A second call gets a NEW nonce even with identical content, so the dock re-resolves it.
    await act(async () => {
      result.current.openAssistant({
        prompt: "Why did this fail?",
        entity: { kind: "run", id: "run-1" },
      });
    });
    expect(result.current.pendingRequest?.nonce).not.toBe(firstNonce);

    act(() => {
      result.current.clearPendingRequest();
    });
    expect(result.current.pendingRequest).toBeNull();
  });

  test("a plain openAssistant() flags a fresh session (consumeFreshSessionOpen), consumed once; a page-hook open does NOT", async () => {
    const { result } = renderHook(() => useAssistant(), { wrapper });
    await waitFor(() => expect(result.current.authStatus).not.toBeNull());

    // A plain expand from closed flags the next dock mount to open blank.
    await act(async () => {
      result.current.openAssistant();
    });
    expect(result.current.consumeFreshSessionOpen()).toBe(true);
    // One-shot: a second read is false (the dock consumes it exactly once at mount).
    expect(result.current.consumeFreshSessionOpen()).toBe(false);

    // A page-hook open (entity/prompt) pins a thread instead — it must NOT flag a fresh session.
    await act(async () => {
      result.current.openAssistant({ entity: { kind: "run", id: "run-1" } });
    });
    expect(result.current.consumeFreshSessionOpen()).toBe(false);
  });

  test("an already-open dock force-closes once auth resolves to not-configured (never a flash-close before the first check)", async () => {
    window.localStorage.setItem(DOCK_OPEN_KEY, "1");
    vi.mocked(api.getAssistantAuthStatus).mockResolvedValue(SIGNED_OUT);

    const { result } = renderHook(() => useAssistant(), { wrapper });
    // Before the auth check resolves, the persisted "open" preference is honored (no flash-close).
    expect(result.current.isOpen).toBe(true);

    await waitFor(() => expect(result.current.authStatus).not.toBeNull());
    expect(result.current.authConfigured).toBe(false);
    await waitFor(() => expect(result.current.isOpen).toBe(false));
  });

  test("currentEnvelope reflects the route the provider was mounted under", async () => {
    function skillWrapper({ children }: { children: ReactNode }) {
      return (
        <MemoryRouter initialEntries={["/skills/skill-42"]}>
          <AssistantProvider>{children}</AssistantProvider>
        </MemoryRouter>
      );
    }
    const { result } = renderHook(() => useAssistant(), { wrapper: skillWrapper });
    await waitFor(() => expect(result.current.authStatus).not.toBeNull());
    expect(result.current.currentEnvelope).toEqual({
      route: "/skills/skill-42",
      entityKind: "skill",
      entityId: "skill-42",
    });
  });
});

// ── executeUiAction — the WP 3.1 (D-AS8/D-AS16) client executor ─────────────────────────────────
// The LIVE half of ui_* navigation: `AssistantDock.tsx`'s executor effect calls this for a freshly-
// arrived, non-replay `ui_action` event. Exercised here through the PUBLIC context API (`renderHook`
// + a sibling `useLocation()` probe mounted alongside it, so the actual react-router navigation is
// observable) rather than reaching into any private implementation detail.

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="loc">{location.pathname + location.search}</div>;
}

function wrapperWithLocationProbe({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter initialEntries={["/dashboard"]}>
      <AssistantProvider>
        {children}
        <LocationProbe />
      </AssistantProvider>
    </MemoryRouter>
  );
}

describe("executeUiAction", () => {
  test("navigates (a normal history push) to the resolved route for a valid action", async () => {
    const { result } = renderHook(() => useAssistant(), { wrapper: wrapperWithLocationProbe });
    await waitFor(() => expect(result.current.authStatus).not.toBeNull());
    expect(screen.getByTestId("loc").textContent).toBe("/dashboard");

    act(() => {
      result.current.executeUiAction("open_run_turn", { runId: "run-9", turnIndex: 2 });
    });

    // Same route the shared registry resolves ui_open_run_turn's { runId, turnIndex } onto.
    expect(screen.getByTestId("loc").textContent).toBe("/testing/runs/run-9?turn=2");
  });

  test("resolves ui_navigate's { view, params } shape too, onto the same registry", async () => {
    const { result } = renderHook(() => useAssistant(), { wrapper: wrapperWithLocationProbe });
    await waitFor(() => expect(result.current.authStatus).not.toBeNull());

    act(() => {
      result.current.executeUiAction("navigate", { view: "scan", params: { scanId: "scan-1" } });
    });
    expect(screen.getByTestId("loc").textContent).toBe("/scans/scan-1");
  });

  test("never navigates for an action/params the shared registry can't resolve", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { result } = renderHook(() => useAssistant(), { wrapper: wrapperWithLocationProbe });
    await waitFor(() => expect(result.current.authStatus).not.toBeNull());

    act(() => {
      result.current.executeUiAction("open_run_turn", { turnIndex: 2 }); // missing runId
    });
    expect(screen.getByTestId("loc").textContent).toBe("/dashboard");
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
