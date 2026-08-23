import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { TooltipProvider } from "@elabs-ai/components-ui";
import type { DiagnosticsBundle } from "@mcp-token-footprint/shared";

// Settings › Storage › Diagnostics bundle (planning/Roadmap/RM-18-platform/ WP 1.3).
//
// The behaviour under test is **see it before you send it**. The whole work package exists so an
// operator does not have to take "it's redacted" on trust, and a build action that produced a blind
// download would hand that audit straight back to them. So the assertions are: the bundle is
// RENDERED, both renderings are reachable, and Copy puts the visible text on the clipboard — never
// that a file was written.
vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    getDiagnosticsBundle: vi.fn(),
    getDiagnosticsMarkdown: vi.fn(),
  };
});

import * as api from "../../lib/api";
import { DiagnosticsRow } from "./DiagnosticsRow";

const BUNDLE: DiagnosticsBundle = {
  bundleVersion: 1,
  generatedAt: "2026-08-22T09:00:00.000Z",
  versions: {
    app: "1.1.0",
    node: "v22.11.0",
    platform: "darwin",
    arch: "arm64",
    dockerMode: false,
  },
  environment: [
    { name: "PORT", status: "default" },
    { name: "MCP_SECRET_KEY", status: "unset" },
  ],
  database: {
    userVersion: 61,
    latestKnownVersion: 61,
    upToDate: true,
    fileBytes: 2048,
    walBytes: null,
    tables: [{ name: "mcp_servers", rows: 3 }],
  },
  errors: {
    sources: [
      { id: "scan_events", status: "captured", matched: 0 },
      { id: "process_log", status: "not_captured", reason: "The API logs to stdout." },
    ],
    entries: [],
    truncated: false,
  },
  features: {
    flags: [{ id: "assistant", enabled: true }],
    providerKinds: [{ kind: "anthropic", configured: true }],
  },
  dataPack: {
    packVersion: "1.1.0",
    schemaVersion: 1,
    asOf: "2026-08-22",
    source: "bundled",
    files: 24,
    analyzerVersion: 4,
    checkConfigured: false,
    lastCheckedAt: null,
    lastCheckStatus: null,
    lastRefusal: null,
  },
};

const MARKDOWN = "# Diagnostics bundle\n\n- Bundle version: 1\n";

function renderRow() {
  return render(
    <TooltipProvider>
      <ul>
        <DiagnosticsRow />
      </ul>
    </TooltipProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getDiagnosticsBundle).mockResolvedValue(BUNDLE);
  vi.mocked(api.getDiagnosticsMarkdown).mockResolvedValue(MARKDOWN);
});

test("the row states the guarantee AND its one boundary before the operator even clicks", () => {
  // It must promise exactly what holds. The bundle carries no environment value and no credential
  // anywhere; it does quote error messages verbatim, and one can name a path the owner configured
  // (found live against the built API — see the boundary test in apps/api/test/diagnostics.test.ts).
  // Promising "no names" here would be the same lie the Markdown preamble briefly told.
  renderRow();
  expect(screen.getByText(/Diagnostics bundle/)).toBeTruthy();
  expect(screen.getByText(/No environment values and no credentials, ever/)).toBeTruthy();
  expect(screen.getByText(/quotes messages verbatim/)).toBeTruthy();
});

test("building the bundle SHOWS it — the operator reads it before copying anything", async () => {
  renderRow();
  fireEvent.click(screen.getByRole("button", { name: "Build bundle" }));

  await waitFor(() => {
    expect(api.getDiagnosticsMarkdown).toHaveBeenCalledTimes(1);
    expect(api.getDiagnosticsBundle).toHaveBeenCalledTimes(1);
  });

  const dialog = await screen.findByRole("dialog");
  // The rendered document itself is on screen, not a download prompt. `Bundle version: 1` is body
  // text from the fetched Markdown, so it can only be here because the document was displayed.
  await waitFor(() => {
    expect(dialog.textContent ?? "").toContain("Bundle version: 1");
  });
  expect(screen.getByRole("tab", { name: "Markdown" })).toBeTruthy();
  expect(screen.getByRole("tab", { name: "JSON" })).toBeTruthy();

  // And nothing offers to write a file — a blind download is exactly what this WP refuses.
  for (const anchor of Array.from(dialog.querySelectorAll("a"))) {
    expect(anchor.hasAttribute("download")).toBe(false);
  }
});

test("Copy puts the visible rendering on the clipboard", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

  renderRow();
  fireEvent.click(screen.getByRole("button", { name: "Build bundle" }));
  await screen.findByRole("dialog");
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Copy" }).hasAttribute("disabled")).toBe(false);
  });

  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  await waitFor(() => {
    expect(writeText).toHaveBeenCalledWith(MARKDOWN);
  });
});

test("a failed build says so instead of showing an empty document", async () => {
  vi.mocked(api.getDiagnosticsMarkdown).mockRejectedValue(new Error("boom"));
  renderRow();
  fireEvent.click(screen.getByRole("button", { name: "Build bundle" }));

  const dialog = await screen.findByRole("dialog");
  await waitFor(() => {
    expect(dialog.textContent ?? "").toContain("boom");
  });
});
