import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@elabs-ai/components-ui";
import { API_TOKEN_DEFAULT_EXPIRY_DAYS, type ApiToken } from "@mcp-token-footprint/shared";

// Settings › API tokens (planning/Roadmap/RM-08-ci/ WP 1.1). The behaviour under test is the ONE-TIME REVEAL: the
// server keeps only a digest, so if this pane ever fails to show the plaintext — or shows it again
// later as if it could — the credential is either lost or misrepresented. The api module is mocked so
// every call resolves deterministically and no real request is made.
vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    listApiTokens: vi.fn(),
    createApiToken: vi.fn(),
    deleteApiToken: vi.fn(),
  };
});

import * as api from "../../lib/api";
import { TokensSection } from "./TokensSection";

const EXISTING: ApiToken = {
  id: "tok-1",
  label: "CI — footprint gate",
  tokenPrefix: "ab12cd34",
  scopes: ["read", "scan:run"],
  createdAt: "2026-08-19T10:00:00.000Z",
  lastUsedAt: "2026-08-19T11:30:00.000Z",
  expiresAt: null,
};

const SECRET = "mcpfp_TESTSECRETVALUE0123456789abcdefghijklmnopq";

function renderSection() {
  return render(
    <TooltipProvider>
      <TokensSection />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listApiTokens).mockResolvedValue({ tokens: [] });
  vi.mocked(api.deleteApiToken).mockResolvedValue(undefined);
});

describe("TokensSection — listing", () => {
  test("renders a real empty state when there are no tokens", async () => {
    renderSection();
    expect(await screen.findByText("No service tokens yet")).toBeInTheDocument();
  });

  test("“Last used” is the FIRST column — this is a security pane, and staleness is the signal", async () => {
    // RM-37 WP 0.4. Not cosmetic ordering: the question an operator scans this table for is "which of
    // these credentials is nobody using any more", and it used to sit third, after the label and the
    // scopes. Asserted on the header ROW so a reordering (or a rename) fails here rather than in a
    // browser nobody opened.
    vi.mocked(api.listApiTokens).mockResolvedValue({ tokens: [EXISTING] });
    renderSection();
    await screen.findByText("CI — footprint gate");

    const headers = screen.getAllByRole("columnheader").map((cell) => cell.textContent?.trim());
    expect(headers[0]).toBe("Last used");
    expect(headers).toContain("Label");
    expect(headers).toContain("Expires");
  });

  test("lists a token by its display prefix and never renders a secret field", async () => {
    vi.mocked(api.listApiTokens).mockResolvedValue({ tokens: [EXISTING] });
    const { container } = renderSection();

    expect(await screen.findByText("CI — footprint gate")).toBeInTheDocument();
    expect(screen.getByText(/mcpfp_ab12cd34…/)).toBeInTheDocument();
    // Scopes read as operator-facing labels, not raw wire ids.
    expect(screen.getByText("Read · Run scans")).toBeInTheDocument();
    // Nothing token-shaped beyond the display prefix is anywhere in the DOM.
    expect(container.textContent).not.toMatch(/mcpfp_[A-Za-z0-9_-]{20,}/);
  });

  test("a never-used, never-expiring token reads as such rather than blank", async () => {
    vi.mocked(api.listApiTokens).mockResolvedValue({
      tokens: [{ ...EXISTING, lastUsedAt: null, expiresAt: null }],
    });
    renderSection();
    await screen.findByText("CI — footprint gate");
    expect(screen.getAllByText("Never")).toHaveLength(2);
  });

  test("a failed load surfaces the error rather than showing an empty list as if it were empty", async () => {
    vi.mocked(api.listApiTokens).mockRejectedValue(new Error("API unreachable"));
    renderSection();
    expect(await screen.findByText("API unreachable")).toBeInTheDocument();
  });
});

describe("TokensSection — create and the one-time reveal", () => {
  async function openCreateDialog() {
    renderSection();
    fireEvent.click((await screen.findAllByRole("button", { name: "Create token" }))[0]!);
    return await screen.findByRole("dialog");
  }

  test("the create form requires a name before it will submit", async () => {
    const dialog = await openCreateDialog();
    const submit = within(dialog).getByRole("button", { name: "Create token" });
    expect(submit).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "CI" } });
    expect(submit).toBeEnabled();
  });

  test("it requires at least one permission — a scope-less token authorizes nothing", async () => {
    const dialog = await openCreateDialog();
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "CI" } });

    // `read` is pre-selected; unchecking it leaves no permission at all.
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /^Read$/ }));
    expect(within(dialog).getByRole("button", { name: "Create token" })).toBeDisabled();
  });

  test("every scope is offered with its own description, and none of them is a delete scope", async () => {
    const dialog = await openCreateDialog();
    for (const label of ["Read", "Run scans", "Launch runs", "Run suites"]) {
      expect(within(dialog).getByRole("checkbox", { name: new RegExp(`^${label}$`) })).toBeVisible();
    }
    expect(within(dialog).getAllByRole("checkbox")).toHaveLength(4);
    expect(
      within(dialog).getByText(/No permission lets a token delete anything/),
    ).toBeInTheDocument();
  });

  test("creating sends the chosen label + scopes and reveals the secret exactly once", async () => {
    vi.mocked(api.createApiToken).mockResolvedValue({
      token: { ...EXISTING, label: "CI", scopes: ["read", "runs:launch"], lastUsedAt: null },
      secret: SECRET,
    });

    const dialog = await openCreateDialog();
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "CI" } });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /^Launch runs$/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Create token" }));

    await waitFor(() => expect(api.createApiToken).toHaveBeenCalledTimes(1));
    const sent = vi.mocked(api.createApiToken).mock.calls[0]?.[0];
    expect(sent?.label).toBe("CI");
    // Order follows the frozen API_TOKEN_SCOPES vocabulary, not click order.
    expect(sent?.scopes).toEqual(["read", "runs:launch"]);
    // RM-37 WP 0.4 — the untouched default is a REAL expiry now, not "never". A token pasted into a
    // CI secret and forgotten used to outlive the job, the branch and the laptop it was minted on.
    expect(sent?.expiresAt).not.toBeNull();
    const days =
      (Date.parse(sent?.expiresAt as string) - Date.now()) / (24 * 60 * 60 * 1000);
    expect(Math.abs(days - API_TOKEN_DEFAULT_EXPIRY_DAYS)).toBeLessThan(1);

    // The reveal: the plaintext, an unmissable "you will not see this again", and a copy affordance.
    expect(await screen.findByText(SECRET)).toBeInTheDocument();
    expect(screen.getByText(/You will not see this token again/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: new RegExp(SECRET) })).toBeInTheDocument();

    // Closing the reveal IS the acknowledgement — and afterwards the secret is gone for good.
    fireEvent.click(screen.getByRole("button", { name: "I've copied it" }));
    await waitFor(() => expect(screen.queryByText(SECRET)).not.toBeInTheDocument());
    expect(document.body.textContent).not.toContain(SECRET);
  });

  test("a custom expiry is sent as a real instant, not the raw date input value", async () => {
    vi.mocked(api.createApiToken).mockResolvedValue({
      token: { ...EXISTING, expiresAt: "2027-01-31T23:59:59.999Z" },
      secret: SECRET,
    });

    const dialog = await openCreateDialog();
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "CI" } });
    // The date picker only exists once "Custom date…" is the selected choice — the point of the
    // three-way control is that an expiry is chosen, never inherited from an empty box.
    fireEvent.click(within(dialog).getByRole("radio", { name: /^Custom date…$/ }));
    fireEvent.change(await within(dialog).findByDisplayValue(""), {
      target: { value: "2027-01-31" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create token" }));

    await waitFor(() => expect(api.createApiToken).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.createApiToken).mock.calls[0]?.[0]?.expiresAt).toBe(
      "2027-01-31T23:59:59.999Z",
    );
  });

  test("“Never” is still available — but only as an explicit choice", async () => {
    vi.mocked(api.createApiToken).mockResolvedValue({
      token: { ...EXISTING, expiresAt: null },
      secret: SECRET,
    });

    const dialog = await openCreateDialog();
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "CI" } });
    fireEvent.click(within(dialog).getByRole("radio", { name: /^Never$/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Create token" }));

    await waitFor(() => expect(api.createApiToken).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.createApiToken).mock.calls[0]?.[0]?.expiresAt).toBeNull();
  });

  test("a failed create reports the reason inline and reveals nothing", async () => {
    vi.mocked(api.createApiToken).mockRejectedValue(new Error("Validation failed"));

    const dialog = await openCreateDialog();
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "CI" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create token" }));

    expect(await screen.findByText("Validation failed")).toBeInTheDocument();
    expect(screen.queryByText(/You will not see this token again/)).not.toBeInTheDocument();
  });
});

describe("TokensSection — revoke", () => {
  test("revoking is destructive and asks first; cancelling changes nothing", async () => {
    vi.mocked(api.listApiTokens).mockResolvedValue({ tokens: [EXISTING] });
    renderSection();
    await screen.findByText("CI — footprint gate");

    // The row action is an icon-only control — D-TB5's IconButton, so its name IS its tooltip text.
    fireEvent.click(screen.getByRole("button", { name: "Revoke CI — footprint gate" }));
    expect(await screen.findByText("Revoke “CI — footprint gate”?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(api.deleteApiToken).not.toHaveBeenCalled());
  });

  test("confirming revokes the token and refreshes the list", async () => {
    vi.mocked(api.listApiTokens)
      .mockResolvedValueOnce({ tokens: [EXISTING] })
      .mockResolvedValue({ tokens: [] });
    renderSection();
    await screen.findByText("CI — footprint gate");

    fireEvent.click(screen.getByRole("button", { name: "Revoke CI — footprint gate" }));
    fireEvent.click(await screen.findByRole("button", { name: "Revoke token" }));

    await waitFor(() => expect(api.deleteApiToken).toHaveBeenCalledWith("tok-1"));
    expect(await screen.findByText("No service tokens yet")).toBeInTheDocument();
  });
});

// ── Rotate (RM-37 WP 0.4) ─────────────────────────────────────────────────────────────────────────
//
// The order is the behaviour: create the replacement FIRST, revoke the original only once it exists.
// A rotation that revoked first and then failed to mint would leave the operator with no credential
// at all, which is a worse outcome than the duplicate it was trying to avoid.

describe("TokensSection — rotate", () => {
  test("mints the replacement BEFORE revoking, and reveals the new secret once", async () => {
    vi.mocked(api.listApiTokens)
      .mockResolvedValueOnce({ tokens: [EXISTING] })
      .mockResolvedValue({ tokens: [{ ...EXISTING, id: "tok-2", tokenPrefix: "ff99ee88" }] });
    const order: string[] = [];
    vi.mocked(api.createApiToken).mockImplementation(async () => {
      order.push("create");
      return { token: { ...EXISTING, id: "tok-2", lastUsedAt: null }, secret: SECRET };
    });
    vi.mocked(api.deleteApiToken).mockImplementation(async () => {
      order.push("revoke");
    });

    renderSection();
    await screen.findByText("CI — footprint gate");
    fireEvent.click(screen.getByRole("button", { name: "Rotate CI — footprint gate" }));
    fireEvent.click(await screen.findByRole("button", { name: "Rotate token" }));

    await waitFor(() => expect(api.deleteApiToken).toHaveBeenCalledWith("tok-1"));
    expect(order).toEqual(["create", "revoke"]);
    // The replacement inherits the identity an operator recognises it by.
    expect(vi.mocked(api.createApiToken).mock.calls[0]?.[0]?.label).toBe("CI — footprint gate");
    expect(vi.mocked(api.createApiToken).mock.calls[0]?.[0]?.scopes).toEqual(["read", "scan:run"]);
    expect(await screen.findByText(SECRET)).toBeInTheDocument();
  });

  test("a failed mint revokes NOTHING — the operator keeps a working credential", async () => {
    vi.mocked(api.listApiTokens).mockResolvedValue({ tokens: [EXISTING] });
    vi.mocked(api.createApiToken).mockRejectedValue(new Error("Validation failed"));

    renderSection();
    await screen.findByText("CI — footprint gate");
    fireEvent.click(screen.getByRole("button", { name: "Rotate CI — footprint gate" }));
    fireEvent.click(await screen.findByRole("button", { name: "Rotate token" }));

    await waitFor(() => expect(api.createApiToken).toHaveBeenCalledTimes(1));
    expect(api.deleteApiToken).not.toHaveBeenCalled();
    expect(screen.queryByText(SECRET)).not.toBeInTheDocument();
  });

  test("a failed revoke still reveals the new secret — it exists and already works", async () => {
    vi.mocked(api.listApiTokens).mockResolvedValue({ tokens: [EXISTING] });
    vi.mocked(api.createApiToken).mockResolvedValue({
      token: { ...EXISTING, id: "tok-2", lastUsedAt: null },
      secret: SECRET,
    });
    vi.mocked(api.deleteApiToken).mockRejectedValue(new Error("No such service token."));

    renderSection();
    await screen.findByText("CI — footprint gate");
    fireEvent.click(screen.getByRole("button", { name: "Rotate CI — footprint gate" }));
    fireEvent.click(await screen.findByRole("button", { name: "Rotate token" }));

    // Discarding a minted credential because the cleanup failed would lose it for good — the server
    // keeps only a digest.
    expect(await screen.findByText(SECRET)).toBeInTheDocument();
  });
});
