import type { ComponentProps, ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type {
  GithubAccountStatus,
  WatchRule,
  WatchWindowPreview,
} from "@mcp-token-footprint/shared";
import { TooltipProvider } from "@elabs-ai/components-ui";

// jsdom can't resolve @elabs-ai/components-charts' @visx deep imports (the established `GuardrailStopsPanel.test`/
// dashboard-panel precedent) — the Preview section's `WindowPreviewStrip` renders a real `BarChart`,
// so it's stubbed the same way here. Production is untouched; the real build proves the real chart.
vi.mock("@elabs-ai/components-charts", () => ({
  BarChart: ({ children }: { children: ReactNode }) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => null,
  BarXAxis: () => null,
  Grid: () => null,
  ChartTooltip: () => null,
}));

// The editor's option lists (RunFilterBar reuse) + collection pickers are best-effort fetches — stub
// them to empty so every test is deterministic and hits no real network. `createWatchRule`/
// `updateWatchRule`/`previewWatchWindow` are the round-trip surface under test.
vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    listScenarios: vi.fn().mockResolvedValue([]),
    listSuites: vi.fn().mockResolvedValue([]),
    listServers: vi.fn().mockResolvedValue([]),
    listSkills: vi.fn().mockResolvedValue([]),
    listCollections: vi.fn().mockResolvedValue([]),
    // AM-OB11 — the workflow-dispatch slot asks whether a GitHub account is connected. Stubbed so no
    // test hits the network; each test sets the answer it needs.
    getGithubAccount: vi.fn(),
    createWatchRule: vi.fn(),
    updateWatchRule: vi.fn(),
    previewWatchWindow: vi.fn(),
  };
});

import {
  ApiError,
  createWatchRule,
  getGithubAccount,
  previewWatchWindow,
  updateWatchRule,
} from "../../lib/api";
import { RuleEditorDialog } from "./RuleEditorDialog";

const mockCreate = vi.mocked(createWatchRule);
const mockUpdate = vi.mocked(updateWatchRule);
const mockPreview = vi.mocked(previewWatchWindow);
const mockGithub = vi.mocked(getGithubAccount);

const NO_GITHUB: GithubAccountStatus = { connected: false, clientIdConfigured: false };
const CONNECTED_GITHUB: GithubAccountStatus = {
  connected: true,
  clientIdConfigured: true,
  login: "octo-owner",
  scopes: ["repo"],
};

beforeEach(() => {
  mockCreate.mockReset();
  mockUpdate.mockReset();
  mockPreview.mockReset();
  mockGithub.mockReset();
  mockGithub.mockResolvedValue(NO_GITHUB);
});

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

function renderEditor(props: Partial<ComponentProps<typeof RuleEditorDialog>> = {}) {
  const onSaved = vi.fn();
  const utils = render(
    <TooltipProvider>
      <RuleEditorDialog
        open
        onOpenChange={() => {}}
        mode="create"
        rule={null}
        onSaved={onSaved}
        {...props}
      />
    </TooltipProvider>,
  );
  return { ...utils, onSaved };
}

const RULE_WITH_WEBHOOK: WatchRule = {
  id: "rule-1",
  name: "High error rate",
  enabled: true,
  trigger: "on_terminal",
  filter: { outcome: ["error"] },
  actions: [{ type: "webhook", secretRef: "ref-1", template: "hi" }],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

function samplePreview(fired: boolean): WatchWindowPreview {
  return {
    window: {
      measure: "errorRate",
      bucket: "hour",
      window: "1h",
      op: ">=",
      threshold: 0.3,
      cooldownMinutes: 60,
    },
    bucket: "hour",
    windows: [
      {
        windowStart: "2026-07-10T00:00:00Z",
        windowEnd: "2026-07-10T01:00:00Z",
        value: fired ? 0.5 : 0.1,
        n: 10,
        wouldHaveFired: fired,
        state: fired ? "alert" : "ok",
      },
    ],
  };
}

describe("RuleEditorDialog — create round-trip (on_terminal)", () => {
  test("fills name + enables an action, then Create rule builds the expected input", async () => {
    mockCreate.mockResolvedValueOnce({ ...RULE_WITH_WEBHOOK, id: "new-rule", actions: [{ type: "pin" }] });
    const { onSaved } = renderEditor();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "New rule" } });
    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Pin run" }));

    fireEvent.click(screen.getByRole("button", { name: "Create rule" }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    const input = mockCreate.mock.calls[0]?.[0];
    expect(input?.name).toBe("New rule");
    expect(input?.trigger).toBe("on_terminal");
    expect(input?.actions).toEqual([{ type: "pin" }]);
    expect(input?.window).toBeUndefined();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  test("Create rule stays disabled with no name", () => {
    renderEditor();
    expect(screen.getByRole("button", { name: "Create rule" })).toBeDisabled();
  });
});

describe("RuleEditorDialog — windowed save is gated behind the historical preview", () => {
  test("Save is disabled before a preview runs, and after changing the config again", async () => {
    renderEditor();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Windowed rule" } });
    fireEvent.click(screen.getByRole("radio", { name: "Windowed threshold" }));

    // Preview tab now exists; Save is disabled with no preview yet.
    expect(screen.getByRole("button", { name: "Create rule" })).toBeDisabled();

    mockPreview.mockResolvedValueOnce(samplePreview(false));
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    fireEvent.click(screen.getByRole("button", { name: "Run preview" }));

    await waitFor(() => expect(mockPreview).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("button", { name: "Create rule" })).not.toBeDisabled());

    // Changing the threshold after a preview invalidates it again (the signature no longer matches) —
    // back to the Trigger tab, where the window config lives. `NumberInput` only COMMITS on blur
    // (its `onChange` just updates the displayed text — see @elabs-ai/components-ui's `handleBlur`), so the change
    // must be followed by a blur for the new value to actually reach the form state.
    fireEvent.click(screen.getByRole("button", { name: "Trigger" }));
    // AM-OB10 renamed this field to "Alert threshold" — there are now two (the second, optional
    // one is the WARNING threshold, which must be strictly less severe).
    const thresholdInput = screen.getByLabelText("Alert threshold");
    fireEvent.change(thresholdInput, { target: { value: "0.9" } });
    fireEvent.blur(thresholdInput);
    expect(screen.getByRole("button", { name: "Create rule" })).toBeDisabled();
  });

  test("after a fresh preview, Create rule actually saves a windowed rule with a derived bucket", async () => {
    mockPreview.mockResolvedValueOnce(samplePreview(true));
    mockCreate.mockResolvedValueOnce({
      ...RULE_WITH_WEBHOOK,
      id: "new-rule",
      trigger: "windowed",
      actions: [{ type: "pin" }],
    });
    const { onSaved } = renderEditor();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Windowed rule" } });
    fireEvent.click(screen.getByRole("radio", { name: "Windowed threshold" }));
    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Pin run" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    fireEvent.click(screen.getByRole("button", { name: "Run preview" }));
    await waitFor(() => expect(mockPreview).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Create rule" }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    const input = mockCreate.mock.calls[0]?.[0];
    expect(input?.trigger).toBe("windowed");
    expect(input?.window?.bucket).toBe("hour"); // derived from the default 1h window
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });
});

// ── RM-17 Phase 6 · AM-OB10 ──────────────────────────────────────────────────────────────────────

describe("RuleEditorDialog — dual thresholds + the no-data policy (AM-OB10)", () => {
  test("an inverted warning threshold is caught inline and blocks Save", async () => {
    mockPreview.mockResolvedValue(samplePreview(false));
    renderEditor();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Windowed rule" } });
    fireEvent.click(screen.getByRole("radio", { name: "Windowed threshold" }));

    // The default rule is `errorRate >= 0.3`; a warning at 0.5 is MORE severe than the alert and
    // could therefore never fire at the warning level — a footgun, not a preference.
    const warn = screen.getByLabelText(/Warning threshold/);
    fireEvent.change(warn, { target: { value: "0.5" } });
    fireEvent.blur(warn);
    expect(await screen.findByText(/must be below the alert threshold/i)).toBeInTheDocument();

    // Run the preview AFTER the bad value, so the preview gate is satisfied and Save is enabled —
    // otherwise this test would pass for the wrong reason (the disabled button), which is exactly
    // what it did before the mutation probe caught it.
    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Pin run" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    fireEvent.click(screen.getByRole("button", { name: "Run preview" }));
    await waitFor(() => expect(mockPreview).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Create rule" })).not.toBeDisabled(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Create rule" }));
    await waitFor(() =>
      expect(screen.getAllByText(/must be below the alert threshold/i).length).toBeGreaterThan(1),
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test("a valid warning threshold and a no-data policy both reach the wire", async () => {
    mockPreview.mockResolvedValue(samplePreview(false));
    mockCreate.mockResolvedValueOnce({
      ...RULE_WITH_WEBHOOK,
      id: "new-rule",
      trigger: "windowed",
      actions: [{ type: "pin" }],
    });
    renderEditor();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Windowed rule" } });
    fireEvent.click(screen.getByRole("radio", { name: "Windowed threshold" }));

    const warn = screen.getByLabelText(/Warning threshold/);
    fireEvent.change(warn, { target: { value: "0.1" } });
    fireEvent.blur(warn);
    expect(screen.queryByText(/must be below the alert threshold/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Pin run" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    fireEvent.click(screen.getByRole("button", { name: "Run preview" }));
    await waitFor(() => expect(mockPreview).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Create rule" }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate.mock.calls[0]?.[0]?.window?.warnThreshold).toBe(0.1);
  });

  test("the no-data picker defaults to `hold`, so an empty window is never read as recovery", () => {
    renderEditor();
    fireEvent.click(screen.getByRole("radio", { name: "Windowed threshold" }));
    expect(screen.getByLabelText("When no runs happened")).toHaveTextContent(/Hold/);
  });

  test("an on-terminal rule exposes the minimum alert interval", () => {
    renderEditor();
    expect(screen.getByLabelText("Minimum minutes between alerts")).toBeInTheDocument();
  });
});

describe("RuleEditorDialog — edit round-trip preserves an untouched webhook secret", () => {
  test("editing only the name omits `actions` from the PATCH", async () => {
    mockUpdate.mockResolvedValueOnce(RULE_WITH_WEBHOOK);
    renderEditor({ mode: "edit", rule: RULE_WITH_WEBHOOK });

    const nameInput = screen.getByLabelText("Name");
    fireEvent.change(nameInput, { target: { value: "High error rate (renamed)" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    const [id, patch] = mockUpdate.mock.calls[0] ?? [];
    expect(id).toBe("rule-1");
    expect(patch?.name).toBe("High error rate (renamed)");
    expect("actions" in (patch ?? {})).toBe(false);
  });

  test("touching the Actions step includes `actions` in the PATCH", async () => {
    mockUpdate.mockResolvedValueOnce(RULE_WITH_WEBHOOK);
    renderEditor({ mode: "edit", rule: RULE_WITH_WEBHOOK });

    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    // The webhook action is enabled but write-only (url starts blank) — re-enter it to save cleanly.
    fireEvent.change(await screen.findByLabelText("URL"), {
      target: { value: "https://hooks.example.com/x" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    const [, patch] = mockUpdate.mock.calls[0] ?? [];
    expect(patch?.actions).toEqual([{ type: "webhook", url: "https://hooks.example.com/x", template: "hi" }]);
  });
});

describe("RuleEditorDialog — duplicate drops the webhook secret", () => {
  test("name is prefixed and the webhook action starts unchecked", async () => {
    renderEditor({ mode: "duplicate", rule: RULE_WITH_WEBHOOK });

    expect(screen.getByLabelText("Name")).toHaveValue("Copy of High error rate");
    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    expect(await screen.findByRole("checkbox", { name: "Webhook" })).not.toBeChecked();
  });
});

describe("RuleEditorDialog — invalid config surfaces zod detail inline", () => {
  test("a 400 with `issues` renders each field path + message in the dialog body", async () => {
    mockCreate.mockRejectedValueOnce(
      new ApiError(400, "Validation failed", [
        { path: ["filter", "dateFrom"], message: "Invalid datetime" },
      ]),
    );
    renderEditor();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Bad rule" } });
    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Pin run" }));
    fireEvent.click(screen.getByRole("button", { name: "Create rule" }));

    expect(await screen.findByText("filter.dateFrom: Invalid datetime")).toBeInTheDocument();
  });
});

// ═══ AM-OB11 — the GitHub Actions workflow_dispatch action slot ═══════════════════════════════════

describe("RuleEditorDialog — workflow_dispatch (AM-OB11)", () => {
  const SLOT = "Run a GitHub Actions workflow";

  test("with NO connected GitHub account the slot is disabled and says why, reachably", async () => {
    mockGithub.mockResolvedValue(NO_GITHUB);
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Actions" }));

    const checkbox = await screen.findByRole("checkbox", { name: SLOT });
    // Wait for the lookup to SETTLE, so this asserts the "no account" reason and not the transient
    // "checking…" one.
    await waitFor(() =>
      expect(screen.getByText(/No GitHub account is connected/)).toBeInTheDocument(),
    );
    expect(checkbox).toBeDisabled();

    // The reason is VISIBLE (not tooltip-only) and wired to the control via aria-describedby, so a
    // keyboard/screen-reader user gets it without hovering (D-TB5's discipline).
    const describedBy = checkbox.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const reason = document.getElementById(describedBy as string);
    expect(reason?.textContent).toMatch(/No GitHub account is connected/);
    expect(reason?.textContent).toMatch(/Settings/);
  });

  test("the slot warns that it starts a CI run and spends money", async () => {
    mockGithub.mockResolvedValue(CONNECTED_GITHUB);
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: SLOT })).not.toBeDisabled());

    expect(
      screen.getByText(/Starts a CI run on GitHub and spends Actions minutes/),
    ).toBeInTheDocument();
    // ...and that no credential is kept on the rule.
    expect(screen.getByText(/no credential is stored on the rule/)).toBeInTheDocument();
  });

  test("a connected account lets the slot be enabled and builds the wire action", async () => {
    mockGithub.mockResolvedValue(CONNECTED_GITHUB);
    mockCreate.mockResolvedValueOnce({ ...RULE_WITH_WEBHOOK, id: "new-rule" });
    renderEditor();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Regression → CI" } });
    fireEvent.click(screen.getByRole("button", { name: "Actions" }));

    // The slot starts disabled while the account lookup is in flight — wait for it to settle rather
    // than racing it (that transition is the behaviour, not a test artefact). Re-queried each poll
    // because the disabled variant is wrapped in a Tooltip trigger, so the node is replaced.
    await waitFor(() => expect(screen.getByRole("checkbox", { name: SLOT })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("checkbox", { name: SLOT }));

    fireEvent.change(await screen.findByLabelText("Owner"), { target: { value: "acme-labs" } });
    fireEvent.change(screen.getByLabelText("Repository"), { target: { value: "workbench" } });
    fireEvent.change(screen.getByLabelText("Workflow file or id"), {
      target: { value: "nightly.yml" },
    });
    // `ref` already defaults to "main" — a visible starting value, not a hidden default.
    expect(screen.getByLabelText("Ref (branch or tag)")).toHaveValue("main");

    fireEvent.click(screen.getByRole("button", { name: "Create rule" }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate.mock.calls[0]?.[0]?.actions).toEqual([
      {
        type: "workflow_dispatch",
        owner: "acme-labs",
        repo: "workbench",
        workflow: "nightly.yml",
        ref: "main",
      },
    ]);
  });

  test("an invalid target is refused inline, before any request", async () => {
    mockGithub.mockResolvedValue(CONNECTED_GITHUB);
    renderEditor();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Bad target" } });
    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: SLOT })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("checkbox", { name: SLOT }));

    // An owner/repo pair typed into the repo field — the classic mistake, and the one that would be
    // an extra URL path segment if it were not validated.
    fireEvent.change(await screen.findByLabelText("Owner"), { target: { value: "acme-labs" } });
    fireEvent.change(screen.getByLabelText("Repository"), {
      target: { value: "acme-labs/workbench" },
    });
    fireEvent.change(screen.getByLabelText("Workflow file or id"), {
      target: { value: "nightly.yml" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Create rule" }));

    expect(await screen.findByText(/not an owner\/repo pair or a URL/)).toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test("editing a saved rule round-trips owner/repo/workflow/ref and its inputs", async () => {
    mockGithub.mockResolvedValue(CONNECTED_GITHUB);
    const saved: WatchRule = {
      ...RULE_WITH_WEBHOOK,
      actions: [
        {
          type: "workflow_dispatch",
          owner: "acme-labs",
          repo: "workbench",
          workflow: "nightly.yml",
          ref: "release",
          inputs: { suite_id: "s-42" },
        },
      ],
    };
    renderEditor({ mode: "edit", rule: saved });
    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: SLOT })).not.toBeDisabled());

    expect(await screen.findByLabelText("Owner")).toHaveValue("acme-labs");
    expect(screen.getByLabelText("Repository")).toHaveValue("workbench");
    expect(screen.getByLabelText("Workflow file or id")).toHaveValue("nightly.yml");
    expect(screen.getByLabelText("Ref (branch or tag)")).toHaveValue("release");
    // Unlike a webhook URL, nothing here is write-only — there is no secret to withhold.
    expect(screen.getByDisplayValue("suite_id")).toBeInTheDocument();
    expect(screen.getByDisplayValue("s-42")).toBeInTheDocument();
  });
});
