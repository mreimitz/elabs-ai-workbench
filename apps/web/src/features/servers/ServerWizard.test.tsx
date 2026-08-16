import { fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import { TooltipProvider } from "@brand/ui";
import { describe, expect, test, vi } from "vitest";
import type { QlikTenantProbe, ServerConfig, ServerProbeResponse } from "@mcp-token-footprint/shared";
import { ServerWizard } from "./ServerWizard";

// Test harness (toolbar-reach Phase 3): a shared control here now mounts a Radix Tooltip via
// `IconButton`; the app root supplies `TooltipProvider`, so inject it for every render in this file.
const render = (
  ui: Parameters<typeof rtlRender>[0],
  options?: Parameters<typeof rtlRender>[1],
) => rtlRender(<TooltipProvider>{ui}</TooltipProvider>, options);

// jsdom omits matchMedia/ResizeObserver — Radix (Dialog) reads them.
if (typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false
  })) as unknown as typeof window.matchMedia;
}
if (typeof window.ResizeObserver !== "function") {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof window.ResizeObserver;
}

const OK_PROBE: ServerProbeResponse = {
  ok: true,
  url: "https://acme.us.qlikcloud.com/mcp",
  authRequired: false,
  oauthAvailable: false,
  tools: 3,
  durationMs: 12,
  message: "Connected. 3 tools found.",
  authMethods: []
};

function serverFixture(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    id: "server-new",
    name: "Acme tenant",
    transport: "streamable_http",
    url: "https://acme.us.qlikcloud.com/mcp",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    hasEnvSecrets: false,
    hasHeaderSecrets: false,
    authType: "none",
    ...overrides
  };
}

const NOOP_PROPS = {
  onOpenChange: () => {},
  onStartOAuth: vi.fn(),
  onTestServer: vi.fn()
};

/** Drives the wizard from a blank "Add server" open through a successful save: fill URL + name, probe
 *  OK, land on review, then click "Save server". Returns once the save's promise chain has settled. */
async function fillAndSave(onCreateServer: ReturnType<typeof vi.fn>) {
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Acme tenant" } });
  // The "Server URL" label now carries a required marker (" *"), so match by prefix.
  fireEvent.change(screen.getByLabelText(/^Server URL/), {
    target: { value: "https://acme.us.qlikcloud.com/mcp" }
  });
  fireEvent.click(screen.getByRole("button", { name: /test & continue/i }));
  await waitFor(() => expect(screen.getByRole("button", { name: /save server/i })).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: /save server/i }));
  await waitFor(() => expect(onCreateServer).toHaveBeenCalledTimes(1));
}

describe("ServerWizard — Qlik Answers post-save offer (WP 2.2)", () => {
  test("a brand-new streamable-HTTP server whose probe reports answersAvailable shows the offer instead of closing", async () => {
    const onCreateServer = vi.fn().mockResolvedValue(serverFixture());
    const onProbeServer = vi.fn().mockResolvedValue(OK_PROBE);
    const probe: QlikTenantProbe = { origin: "https://acme.us.qlikcloud.com", answersAvailable: true, assistantCount: 4 };
    const onProbeAnswers = vi.fn().mockResolvedValue(probe);
    const onComplete = vi.fn();

    render(
      <ServerWizard
        {...NOOP_PROPS}
        open
        server={null}
        onCreateServer={onCreateServer}
        onUpdateServer={vi.fn()}
        onProbeServer={onProbeServer}
        onComplete={onComplete}
        onProbeAnswers={onProbeAnswers}
        onOfferAnswers={vi.fn()}
      />
    );

    await fillAndSave(onCreateServer);

    await waitFor(() => expect(onProbeAnswers).toHaveBeenCalledWith("server-new"));
    expect(await screen.findByText(/tenant with 4 Qlik Answers assistants/i)).toBeInTheDocument();
    // The wizard stays open — neither completion callback has fired yet.
    expect(onComplete).not.toHaveBeenCalled();
  });

  test("accepting the offer calls onOfferAnswers with the server id/name/probe, then finishes like a normal save", async () => {
    const onCreateServer = vi.fn().mockResolvedValue(serverFixture());
    const onProbeServer = vi.fn().mockResolvedValue(OK_PROBE);
    const probe: QlikTenantProbe = { origin: "https://acme.us.qlikcloud.com", answersAvailable: true, assistantCount: 1 };
    const onProbeAnswers = vi.fn().mockResolvedValue(probe);
    const onOfferAnswers = vi.fn();
    const onComplete = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <ServerWizard
        {...NOOP_PROPS}
        open
        server={null}
        onOpenChange={onOpenChange}
        onCreateServer={onCreateServer}
        onUpdateServer={vi.fn()}
        onProbeServer={onProbeServer}
        onComplete={onComplete}
        onProbeAnswers={onProbeAnswers}
        onOfferAnswers={onOfferAnswers}
      />
    );

    await fillAndSave(onCreateServer);
    await screen.findByText(/tenant with 1 Qlik Answers assistant\./i);

    fireEvent.click(screen.getByRole("button", { name: /set up assistant/i }));

    expect(onOfferAnswers).toHaveBeenCalledWith({
      serverId: "server-new",
      serverName: "Acme tenant",
      probe
    });
    expect(onComplete).toHaveBeenCalledWith("server-new");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test("declining the offer finishes the save WITHOUT calling onOfferAnswers", async () => {
    const onCreateServer = vi.fn().mockResolvedValue(serverFixture());
    const onProbeServer = vi.fn().mockResolvedValue(OK_PROBE);
    const probe: QlikTenantProbe = { origin: "https://acme.us.qlikcloud.com", answersAvailable: true, assistantCount: 2 };
    const onProbeAnswers = vi.fn().mockResolvedValue(probe);
    const onOfferAnswers = vi.fn();
    const onComplete = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <ServerWizard
        {...NOOP_PROPS}
        open
        server={null}
        onOpenChange={onOpenChange}
        onCreateServer={onCreateServer}
        onUpdateServer={vi.fn()}
        onProbeServer={onProbeServer}
        onComplete={onComplete}
        onProbeAnswers={onProbeAnswers}
        onOfferAnswers={onOfferAnswers}
      />
    );

    await fillAndSave(onCreateServer);
    await screen.findByText(/tenant with 2 Qlik Answers assistants/i);

    fireEvent.click(screen.getByRole("button", { name: /not now/i }));

    expect(onOfferAnswers).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledWith("server-new");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test("when the probe reports answersAvailable:false, the wizard closes normally with no offer step", async () => {
    const onCreateServer = vi.fn().mockResolvedValue(serverFixture());
    const onProbeServer = vi.fn().mockResolvedValue(OK_PROBE);
    const onProbeAnswers = vi.fn().mockResolvedValue({
      origin: "https://example.com",
      answersAvailable: false,
      assistantCount: 0
    } satisfies QlikTenantProbe);
    const onOfferAnswers = vi.fn();
    const onComplete = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <ServerWizard
        {...NOOP_PROPS}
        open
        server={null}
        onOpenChange={onOpenChange}
        onCreateServer={onCreateServer}
        onUpdateServer={vi.fn()}
        onProbeServer={onProbeServer}
        onComplete={onComplete}
        onProbeAnswers={onProbeAnswers}
        onOfferAnswers={onOfferAnswers}
      />
    );

    await fillAndSave(onCreateServer);

    await waitFor(() => expect(onComplete).toHaveBeenCalledWith("server-new"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onOfferAnswers).not.toHaveBeenCalled();
    expect(screen.queryByText(/Qlik Answers/i)).not.toBeInTheDocument();
  });

  test("editing an EXISTING server never runs the answers probe on save", async () => {
    const existing = serverFixture({ id: "server-existing" });
    const onUpdateServer = vi.fn().mockResolvedValue(existing);
    const onProbeServer = vi.fn().mockResolvedValue(OK_PROBE);
    const onProbeAnswers = vi.fn();
    const onComplete = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <ServerWizard
        {...NOOP_PROPS}
        open
        server={existing}
        onOpenChange={onOpenChange}
        onCreateServer={vi.fn()}
        onUpdateServer={onUpdateServer}
        onProbeServer={onProbeServer}
        onComplete={onComplete}
        onProbeAnswers={onProbeAnswers}
        onOfferAnswers={vi.fn()}
      />
    );

    // Even editing starts at "connection" (prefilled from the existing server) — click through.
    fireEvent.click(screen.getByRole("button", { name: /test & continue/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /save server/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /save server/i }));

    await waitFor(() => expect(onComplete).toHaveBeenCalledWith("server-existing"));
    expect(onProbeAnswers).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("ServerWizard — reauthentication (T7 / P0)", () => {
  test("reason='reauth' retitles, names the interrupted action, and opens at the AUTH step (not the URL field)", () => {
    const oauthServer = serverFixture({ authType: "oauth" });
    render(
      <ServerWizard
        {...NOOP_PROPS}
        open
        server={oauthServer}
        reason="reauth"
        reauthContext={{ action: "the scan you started" }}
        onCreateServer={vi.fn()}
        onUpdateServer={vi.fn()}
        onProbeServer={vi.fn()}
      />,
    );

    // Retitled + described in the reauth voice — never "Edit MCP server".
    expect(screen.getByText("Sign in again to Acme tenant")).toBeInTheDocument();
    expect(
      screen.getByText(
        /Your Acme tenant session expired\. Sign in to finish the scan you started\./i,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Edit MCP server")).not.toBeInTheDocument();

    // Opened on the AUTH step: the auth chooser is mounted; the connection URL field is NOT.
    expect(
      screen.getByRole("radiogroup", { name: /authentication method/i }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Server URL/)).not.toBeInTheDocument();

    // The stored OAuth auth is preselected → the auth-step forward action is the OAuth one.
    expect(screen.getByRole("button", { name: /save and start oauth/i })).toBeInTheDocument();
  });

  test("reauth uses a generic default action when none is supplied", () => {
    render(
      <ServerWizard
        {...NOOP_PROPS}
        open
        server={serverFixture({ authType: "oauth" })}
        reason="reauth"
        onCreateServer={vi.fn()}
        onUpdateServer={vi.fn()}
        onProbeServer={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/Your Acme tenant session expired\. Sign in to finish what you started\./i),
    ).toBeInTheDocument();
  });
});

describe("ServerWizard — URL validation & auth step (T7)", () => {
  test("a malformed Server URL is rejected BEFORE probing — field marked invalid, inline error, no probe", async () => {
    const onProbeServer = vi.fn();
    render(
      <ServerWizard
        {...NOOP_PROPS}
        open
        server={null}
        onCreateServer={vi.fn()}
        onUpdateServer={vi.fn()}
        onProbeServer={onProbeServer}
      />,
    );

    const url = screen.getByLabelText(/^Server URL/);
    fireEvent.change(url, { target: { value: "not a url" } });
    fireEvent.click(screen.getByRole("button", { name: /test & continue/i }));

    // new URL() rejection: no network probe, the field reads invalid, an inline error appears.
    expect(onProbeServer).not.toHaveBeenCalled();
    expect(url).toHaveAttribute("aria-invalid", "true");
    expect(await screen.findByText(/enter a valid url/i)).toBeInTheDocument();
  });

  test("the auth step offers a 'None' method and a footer forward action to Review", async () => {
    const onProbeServer = vi.fn().mockResolvedValue({
      ...OK_PROBE,
      ok: false,
      authRequired: true,
      message: "This server requires authentication.",
    } satisfies ServerProbeResponse);

    render(
      <ServerWizard
        {...NOOP_PROPS}
        open
        server={null}
        onCreateServer={vi.fn()}
        onUpdateServer={vi.fn()}
        onProbeServer={onProbeServer}
      />,
    );

    fireEvent.change(screen.getByLabelText(/^Server URL/), {
      target: { value: "https://needs-auth.example.com/mcp" },
    });
    fireEvent.click(screen.getByRole("button", { name: /test & continue/i }));

    // authRequired → the auth step. It now carries an explicit "None" choice…
    expect(
      await screen.findByRole("radiogroup", { name: /authentication method/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("None")).toBeInTheDocument();

    // …and a footer forward action (authType is still "none") that advances to Review.
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    expect(await screen.findByRole("button", { name: /save server/i })).toBeInTheDocument();
  });
});

describe("ServerWizard — research-server recipe presets (R-MCP13)", () => {
  test("a preset prefills stdio + command/args + the env var NAME (never a value); new servers only", async () => {
    render(
      <ServerWizard
        {...NOOP_PROPS}
        open
        server={null}
        onCreateServer={vi.fn()}
        onUpdateServer={vi.fn()}
        onProbeServer={vi.fn()}
      />
    );

    // Starts on the default URL transport — the picker offers each curated preset by name.
    fireEvent.click(screen.getByRole("button", { name: /tavily/i }));

    // Prefilled: name, transport flips to "Local command" (stdio), the command, and the env var
    // NAME — with an EMPTY value (no bundled key, ever).
    expect(screen.getByLabelText("Name")).toHaveValue("Tavily Search");
    // "Command" carries a required marker (" *"); anchor so it doesn't match "Command arguments".
    expect(screen.getByLabelText(/^Command \*/)).toHaveValue("npx");
    expect(screen.getByLabelText("Key 1")).toHaveValue("TAVILY_API_KEY");
    expect(screen.getByLabelText("Value 1")).toHaveValue("");
  });

  test("the preset picker is not offered when editing an existing server", () => {
    const existing = serverFixture({ id: "server-existing" });
    render(
      <ServerWizard
        {...NOOP_PROPS}
        open
        server={existing}
        onCreateServer={vi.fn()}
        onUpdateServer={vi.fn()}
        onProbeServer={vi.fn()}
      />
    );

    expect(screen.queryByRole("button", { name: /tavily/i })).not.toBeInTheDocument();
  });
});
