import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ServerType } from "@mcp-token-footprint/shared";

// jsdom omits matchMedia/ResizeObserver — Radix (Dialog/AlertDialog/Select) reads them.
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

// Keep the real ApiError + everything else; only the network-touching CRUD calls are stubbed.
vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    createServerType: vi.fn(),
    updateServerType: vi.fn(),
    deleteServerType: vi.fn()
  };
});

import { TooltipProvider } from "@elabs-ai/components-ui";
import { createServerType, deleteServerType } from "../../lib/api";
import { ManageServerTypesDialog } from "./ManageServerTypesDialog";

const TYPES: ServerType[] = [
  {
    id: "t-saas",
    name: "Acme-SaaS",
    status: "production",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    memberCount: 3
  },
  {
    id: "t-stage",
    name: "acme-stage",
    status: "beta",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    memberCount: 0
  }
];

function renderDialog(serverTypes: ServerType[], onChanged = vi.fn()) {
  return render(
    <TooltipProvider>
      <ManageServerTypesDialog
        open
        onOpenChange={() => {}}
        serverTypes={serverTypes}
        onChanged={onChanged}
      />
    </TooltipProvider>
  );
}

describe("ManageServerTypesDialog (WP 2.2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("lists every type with its status badge and member count", () => {
    renderDialog(TYPES);

    expect(screen.getByText("Acme-SaaS")).toBeInTheDocument();
    expect(screen.getByText("acme-stage")).toBeInTheDocument();
    // Lifecycle status badges from the shared ServerTypeStatusBadge.
    expect(screen.getByText("Production")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    // Member counts (pluralised).
    expect(screen.getByText("3 servers")).toBeInTheDocument();
    expect(screen.getByText("0 servers")).toBeInTheDocument();
  });

  test("zero types shows an empty state prompting the first type", () => {
    renderDialog([]);
    expect(screen.getByText("No server types yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create the first type/i })).toBeInTheDocument();
  });

  test("create: opening the form, naming, and submitting calls the API + refreshes", async () => {
    const onChanged = vi.fn();
    vi.mocked(createServerType).mockResolvedValue({
      id: "t-new",
      name: "New fleet",
      status: "production",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      memberCount: 0
    });

    renderDialog([], onChanged);
    fireEvent.click(screen.getByRole("button", { name: /create the first type/i }));

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "New fleet" } });
    // The create/edit form is now a FormDialog — submit via its consequence-labeled primary button.
    fireEvent.click(screen.getByRole("button", { name: "Create type" }));

    await waitFor(() => expect(createServerType).toHaveBeenCalledTimes(1));
    expect(createServerType).toHaveBeenCalledWith({
      name: "New fleet",
      status: "production",
      description: undefined
    });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  test("empty name is rejected inline without calling the API", async () => {
    renderDialog([]);
    fireEvent.click(screen.getByRole("button", { name: /create the first type/i }));

    // Submitting the FormDialog with an empty Name validates inline (S14) — no API call.
    fireEvent.click(screen.getByRole("button", { name: "Create type" }));

    expect(await screen.findByText("Enter a name.")).toBeInTheDocument();
    expect(createServerType).not.toHaveBeenCalled();
  });

  test("delete states the member count and that servers are detached, not deleted (D-ST4)", async () => {
    renderDialog(TYPES);
    fireEvent.click(screen.getByRole("button", { name: "Delete Acme-SaaS" }));

    // The confirm copy names the count and the detach-not-delete consequence.
    expect(
      await screen.findByText(/3 servers currently use this type/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/sets those servers to Untyped/i)).toBeInTheDocument();
    expect(screen.getByText(/never deletes the servers/i)).toBeInTheDocument();
    expect(deleteServerType).not.toHaveBeenCalled();
  });
});
