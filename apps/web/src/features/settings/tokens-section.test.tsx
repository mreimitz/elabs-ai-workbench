import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@elabs-ai/components-ui";
import type { ApiToken } from "@mcp-token-footprint/shared";

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
    expect(api.createApiToken).toHaveBeenCalledWith({
      label: "CI",
      // Order follows the frozen API_TOKEN_SCOPES vocabulary, not click order.
      scopes: ["read", "runs:launch"],
      expiresAt: null,
    });

    // The reveal: the plaintext, an unmissable "you will not see this again", and a copy affordance.
    expect(await screen.findByText(SECRET)).toBeInTheDocument();
    expect(screen.getByText(/You will not see this token again/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: new RegExp(SECRET) })).toBeInTheDocument();

    // Closing the reveal IS the acknowledgement — and afterwards the secret is gone for good.
    fireEvent.click(screen.getByRole("button", { name: "I've copied it" }));
    await waitFor(() => expect(screen.queryByText(SECRET)).not.toBeInTheDocument());
    expect(document.body.textContent).not.toContain(SECRET);
  });

  test("an optional expiry is sent as a real instant, not the raw date input value", async () => {
    vi.mocked(api.createApiToken).mockResolvedValue({
      token: { ...EXISTING, expiresAt: "2027-01-31T23:59:59.999Z" },
      secret: SECRET,
    });

    const dialog = await openCreateDialog();
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "CI" } });
    fireEvent.change(within(dialog).getByLabelText("Expires (optional)"), {
      target: { value: "2027-01-31" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create token" }));

    await waitFor(() => expect(api.createApiToken).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.createApiToken).mock.calls[0]?.[0]?.expiresAt).toBe(
      "2027-01-31T23:59:59.999Z",
    );
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
