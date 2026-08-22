import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ManualSendPayload, WatchRule } from "@mcp-token-footprint/shared";
import { TooltipProvider, toast } from "@elabs-ai/components-ui";

// RM-17 Phase 6 (AM-OB13). The API side — the real payload, the audit row, the secret discipline,
// the "that destination no longer exists" refusals — is covered against a LOCAL receiver in
// apps/api/test/watch-manual-send.test.ts. This file proves the WEB side against a mocked lib/api:
// only webhook-carrying rules are offered as destinations, the preview shows what will actually be
// sent, an `ok:false` outcome keeps the dialog open with the reason, and no URL is ever rendered.
vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    listWatchRules: vi.fn(),
    getRunWebhookPayload: vi.fn(),
    getSuiteRunWebhookPayload: vi.fn(),
    sendRunToWebhook: vi.fn(),
    sendSuiteRunToWebhook: vi.fn(),
  };
});

import {
  getRunWebhookPayload,
  getSuiteRunWebhookPayload,
  listWatchRules,
  sendRunToWebhook,
  sendSuiteRunToWebhook,
} from "../../lib/api";
import { SendToWebhookDialog } from "./SendToWebhookDialog";

const mockListWatchRules = vi.mocked(listWatchRules);
const mockGetRunPayload = vi.mocked(getRunWebhookPayload);
const mockGetSuitePayload = vi.mocked(getSuiteRunWebhookPayload);
const mockSendRun = vi.mocked(sendRunToWebhook);
const mockSendSuiteRun = vi.mocked(sendSuiteRunToWebhook);

if (typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function rule(id: string, name: string, withWebhook: boolean): WatchRule {
  return {
    id,
    name,
    enabled: true,
    trigger: "on_terminal",
    filter: {},
    actions: withWebhook ? [{ type: "webhook", secretRef: `ref-${id}` }] : [{ type: "pin" }],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

const OPS = rule("rule-ops", "Ops channel", true);
const PIN_ONLY = rule("rule-pin", "Pin failures", false);

const ABSOLUTE_PAYLOAD: ManualSendPayload = {
  run: {
    id: "run-42",
    status: "error",
    outcome: "error",
    scenarioId: "scn-7",
    testId: "tst-7",
    costUsd: 1.25,
    tokensIn: 4242,
    tokensOut: 777,
    startedAt: "2026-08-22T00:00:00.000Z",
  },
  link: "https://bench.example.test/testing/runs/run-42",
  reportLink: "https://bench.example.test/api/reports/run/run-42/markdown",
  manual: true,
};

const RELATIVE_PAYLOAD: ManualSendPayload = {
  ...ABSOLUTE_PAYLOAD,
  link: "/testing/runs/run-42",
  reportLink: "/api/reports/run/run-42/markdown",
};

function renderDialog(open = true) {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <SendToWebhookDialog
          open={open}
          onOpenChange={() => {}}
          subject={{ kind: "run", id: "run-42" }}
        />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockListWatchRules.mockReset();
  mockGetRunPayload.mockReset();
  mockGetSuitePayload.mockReset();
  mockSendRun.mockReset();
  mockSendSuiteRun.mockReset();
  mockListWatchRules.mockResolvedValue([OPS, PIN_ONLY]);
  mockGetRunPayload.mockResolvedValue(ABSOLUTE_PAYLOAD);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function waitForLoaded() {
  await waitFor(() => expect(screen.queryByText("Loading destinations…")).not.toBeInTheDocument());
  return screen.getByRole("combobox");
}

describe("SendToWebhookDialog", () => {
  test("does not fetch anything while closed", () => {
    renderDialog(false);
    expect(mockListWatchRules).not.toHaveBeenCalled();
    expect(mockGetRunPayload).not.toHaveBeenCalled();
  });

  test("offers ONLY rules that carry a webhook action, and preselects the first", async () => {
    renderDialog();
    const trigger = await waitForLoaded();
    // "Pin failures" has no webhook action — it owns no destination, so it is not a place to send.
    expect(trigger).toHaveTextContent("Ops channel");
    expect(screen.queryByText("Pin failures")).not.toBeInTheDocument();
  });

  test("previews the exact payload that will be sent, and never renders a destination URL", async () => {
    renderDialog();
    await waitForLoaded();
    await waitFor(() => expect(screen.getByText("What will be sent")).toBeInTheDocument());

    // The preview is the real run, not the test-fire sample.
    const preview = screen.getByLabelText(/The exact payload that will be posted/i);
    expect(preview.textContent).toContain("run-42");
    expect(preview.textContent).not.toContain("sample-run");
    expect(preview.textContent).toContain('"manual"');

    // Nothing anywhere in the dialog identifies the DESTINATION beyond its rule name. A webhook
    // URL cannot reach the browser at all (the wire carries only an opaque `secretRef`), and even
    // that ref — the one destination-identifying token that does cross — is never rendered.
    expect(OPS.actions[0]).toMatchObject({ type: "webhook", secretRef: "ref-rule-ops" });
    expect(document.body.textContent).not.toContain("ref-rule-ops");
    // The only absolute URLs on screen are the payload's OWN links, which point back at this app.
    for (const url of document.body.textContent?.match(/https?:\/\/[^\s"]+/g) ?? []) {
      expect(url).toContain("bench.example.test");
    }
    expect(screen.getByText(/stays encrypted on the server/i)).toBeInTheDocument();
  });

  test("warns when the links will go out as bare paths, and stays silent when they are absolute", async () => {
    const { unmount } = renderDialog();
    await waitForLoaded();
    await waitFor(() => expect(screen.getByText("What will be sent")).toBeInTheDocument());
    expect(screen.queryByText("The links will not be clickable")).not.toBeInTheDocument();
    unmount();

    mockGetRunPayload.mockResolvedValue(RELATIVE_PAYLOAD);
    renderDialog();
    await waitForLoaded();
    await waitFor(() =>
      expect(screen.getByText("The links will not be clickable")).toBeInTheDocument(),
    );
    expect(screen.getByText(/APP_BASE_URL/)).toBeInTheDocument();
  });

  test("submit posts to the chosen destination and reports success by its rule NAME", async () => {
    mockSendRun.mockResolvedValueOnce({ ok: true, detail: "sent run run-42 by hand — 204" });
    const successSpy = vi.spyOn(toast, "success").mockImplementation(() => "" as never);

    renderDialog();
    await waitForLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(mockSendRun).toHaveBeenCalledWith("run-42", "rule-ops"));
    await waitFor(() =>
      expect(successSpy).toHaveBeenCalledWith(
        "Sent to Ops channel",
        expect.objectContaining({ description: expect.stringContaining("run-42") }),
      ),
    );
    successSpy.mockRestore();
  });

  test("an ok:false outcome keeps the dialog open and shows the server's reason verbatim", async () => {
    // The API answers 200 with a structured failure for anything destination-side; the dialog must
    // render the reason rather than treat it as a thrown error or, worse, as a success.
    mockSendRun.mockResolvedValueOnce({
      ok: false,
      error: "that destination no longer exists — the rule's webhook was changed or removed",
    });
    const successSpy = vi.spyOn(toast, "success").mockImplementation(() => "" as never);

    renderDialog();
    await waitForLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(screen.getByText(/that destination no longer exists/i)).toBeInTheDocument(),
    );
    expect(successSpy).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
    successSpy.mockRestore();
  });

  test("with no webhook-carrying rule it says what to do, and Send is disabled", async () => {
    mockListWatchRules.mockResolvedValue([PIN_ONLY]);
    renderDialog();
    await waitFor(() =>
      expect(screen.getByText("No webhook destination is configured")).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  test("a FAILED destination lookup is not reported as 'you have none'", async () => {
    // These are different facts. With the lookup failed we know NOTHING about how many
    // destinations exist, so the empty state's advice ("go add one under Rules") would be a guess
    // about the operator's own setup — and it would send them to fix something that is not broken.
    mockListWatchRules.mockRejectedValue(new Error("network down"));
    renderDialog();
    await waitFor(() =>
      expect(screen.getByText("Couldn’t load your webhook destinations")).toBeInTheDocument(),
    );
    expect(screen.queryByText("No webhook destination is configured")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  test("a failed preview says so, and does NOT block sending", async () => {
    mockGetRunPayload.mockRejectedValue(new Error("boom"));
    mockSendRun.mockResolvedValueOnce({ ok: true, detail: "ok" });
    renderDialog();
    await waitForLoaded();
    await waitFor(() =>
      expect(screen.getByText("Couldn’t show what would be sent")).toBeInTheDocument(),
    );
    // The preview is supplementary. The server builds the real payload either way.
    expect(screen.getByRole("button", { name: "Send" })).not.toBeDisabled();
  });

  test("the suite-run subject uses the suite-run endpoints and its own wording", async () => {
    mockGetSuitePayload.mockResolvedValue({
      suiteRun: { id: "sr-9", status: "completed", startedAt: "2026-08-22T00:00:00.000Z" },
      link: "/testing/suite-runs/sr-9",
      reportLink: "/api/reports/suite-run/sr-9/markdown",
      manual: true,
    });
    mockSendSuiteRun.mockResolvedValueOnce({ ok: true, detail: "sent suite run sr-9 by hand — 204" });
    const successSpy = vi.spyOn(toast, "success").mockImplementation(() => "" as never);

    render(
      <MemoryRouter>
        <TooltipProvider>
          <SendToWebhookDialog
            open
            onOpenChange={() => {}}
            subject={{ kind: "suite-run", id: "sr-9" }}
          />
        </TooltipProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(mockGetSuitePayload).toHaveBeenCalledWith("sr-9"));
    expect(mockGetRunPayload).not.toHaveBeenCalled();
    expect(screen.getByText("Send this suite run to a webhook")).toBeInTheDocument();

    await waitForLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(mockSendSuiteRun).toHaveBeenCalledWith("sr-9", "rule-ops"));
    successSpy.mockRestore();
  });
});
