import { MemoryRouter } from "react-router-dom";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SECURITY_ANALYZER_VERSION,
  SECURITY_REDACTION_MARKER,
  type SecurityFinding,
  type SecurityReport,
} from "@mcp-token-footprint/shared";

const getScanSecurityDiff = vi.fn();
const getSkillSecurityDiff = vi.fn();

vi.mock("./security-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./security-api")>();
  return {
    ...actual,
    getScanSecurityDiff: (...args: unknown[]) => getScanSecurityDiff(...args),
    getSkillSecurityDiff: (...args: unknown[]) => getSkillSecurityDiff(...args),
  };
});

import { SecurityPanel, anchorLabel } from "./SecurityPanel";

// The Security tab's body. What is pinned here is the set of promises the panel makes ABOUT the
// report it was handed: the report's order, the report's counts, the report's band, an anchor
// rendered per kind, and evidence shown as visible text. Every one of them is a way the UI could
// quietly disagree with the analyzer, which is the only thing this surface must never do.

afterEach(() => {
  vi.clearAllMocks();
});

const finding = (over: Partial<SecurityFinding> = {}): SecurityFinding => ({
  ruleId: "poisoning.injection-phrasing",
  severity: "error",
  anchor: { kind: "tool", toolName: "summarize" },
  message: "The description of “summarize” tells the model to ignore its own instructions.",
  ...over,
});

const report = (over: Partial<SecurityReport> = {}): SecurityReport => ({
  analyzerVersion: SECURITY_ANALYZER_VERSION,
  generatedAt: "2026-08-20T12:00:00.000Z",
  subject: {
    kind: "server",
    id: "scan_new",
    ownerId: "srv_1",
    name: "GitHub",
    capturedAt: "2026-08-20T10:00:00.000Z",
  },
  findings: [],
  counts: { error: 0, warning: 0, info: 0, total: 0 },
  score: { value: 100, band: "clean", analyzerVersion: SECURITY_ANALYZER_VERSION },
  truncated: false,
  ...over,
});

function renderPanel(
  state: Parameters<typeof SecurityPanel>[0]["state"],
  opts: { baselines?: { id: string; label: string }[]; entry?: string } = {},
) {
  return render(
    <MemoryRouter initialEntries={[opts.entry ?? "/scans/scan_new"]}>
      <SecurityPanel
        target={{ kind: "scan", scanId: "scan_new" }}
        baselines={opts.baselines ?? []}
        state={state}
        onRetry={() => {}}
      />
    </MemoryRouter>,
  );
}

describe("SecurityPanel — the three states stay distinct", () => {
  it("renders a layout-shaped placeholder (not a spinner) before the first byte", () => {
    const { container } = renderPanel({ status: "loading" });
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(screen.queryByText("Nothing found")).toBeNull();
  });

  it("surfaces a settled failure with the API's OWN sentence — never as 'nothing found'", () => {
    // D-SP10's refusal, verbatim. It tells the operator what to do; a generic message would not.
    renderPanel({
      status: "error",
      error: 'Scan scan_new has status "running", so it has no complete tool list to analyse.',
    });
    expect(screen.getByText("Couldn’t analyse the security posture")).toBeTruthy();
    expect(screen.getByText(/has no complete tool list to analyse/)).toBeTruthy();
    expect(screen.queryByText("Nothing found")).toBeNull();
  });
});

describe("SecurityPanel — A1: the report's own order, counts and band", () => {
  it("lists findings in the order they arrived, worst-first, and never re-sorts them", () => {
    const state = {
      status: "data" as const,
      data: report({
        findings: [
          finding({ anchor: { kind: "tool", toolName: "zulu" } }),
          finding({
            ruleId: "schema.secret-shaped-parameter",
            severity: "warning",
            anchor: { kind: "tool", toolName: "alpha" },
            message: "A parameter looks like a secret.",
          }),
        ],
        counts: { error: 1, warning: 1, info: 0, total: 2 },
        score: { value: 80, band: "medium", analyzerVersion: SECURITY_ANALYZER_VERSION },
      }),
    };
    renderPanel(state);

    const rows = screen.getAllByRole("row").slice(1); // drop the header row
    expect(within(rows[0]!).getByText("zulu")).toBeTruthy();
    expect(within(rows[1]!).getByText("alpha")).toBeTruthy();
    // No sort affordance at all — a header that let an operator re-sort by rule name would replace
    // the analyzer's severity order with an alphabetical one.
    expect(screen.queryByRole("button", { name: /^sort by/i })).toBeNull();
  });

  it("reads every count off `counts`, never off `findings.length`", () => {
    // The cap dropped rows from the LIST; `counts` still describes all of them. A gate reading
    // `counts.error` must not be fooled by display truncation, and neither must an operator.
    renderPanel({
      status: "data",
      data: report({
        findings: [finding()],
        counts: { error: 7, warning: 3, info: 2, total: 12 },
        score: { value: 0, band: "high", analyzerVersion: SECURITY_ANALYZER_VERSION },
        truncated: true,
      }),
    });
    expect(screen.getByText("7")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("12 findings")).toBeTruthy();
    // …and it says the list is short, out loud.
    expect(screen.getByText(/produced 12 findings and lists the first 1/)).toBeTruthy();
  });

  it("renders the band the API sent and does not re-derive it from the number", () => {
    renderPanel({
      status: "data",
      // A deliberately inconsistent pair: a UI that re-banded 95 would print "Low risk".
      data: report({
        score: { value: 95, band: "high", analyzerVersion: SECURITY_ANALYZER_VERSION },
      }),
    });
    expect(screen.getByText("High risk")).toBeTruthy();
    expect(screen.queryByText("Low risk")).toBeNull();
  });
});

describe("SecurityPanel — A2/D-SP12: an anchor renders per KIND", () => {
  it("never prints the word “server” on a skill finding", () => {
    expect(anchorLabel({ kind: "server" })).toBe("This server");
    expect(anchorLabel({ kind: "skill" })).toBe("This skill version");
    expect(anchorLabel({ kind: "skill" })).not.toMatch(/server/i);
    expect(anchorLabel({ kind: "tool", toolName: "delete_repo" })).toBe("delete_repo");
    expect(anchorLabel({ kind: "parameter", toolName: "push", parameterPath: "body.token" })).toBe(
      "push · body.token",
    );
    expect(anchorLabel({ kind: "file", path: "scripts/run.sh" })).toBe("scripts/run.sh");
  });

  it("renders a skill version's own anchors in the table", () => {
    render(
      <MemoryRouter initialEntries={["/skills/skl_1"]}>
        <SecurityPanel
          target={{ kind: "skill", skillId: "skl_1", versionId: "ver_2" }}
          baselines={[]}
          state={{
            status: "data",
            data: report({
              subject: {
                kind: "skill",
                id: "ver_2",
                ownerId: "skl_1",
                name: "Report writer",
                capturedAt: "2026-08-20T10:00:00.000Z",
              },
              findings: [
                finding({
                  ruleId: "skill-surface.executable-scripts",
                  severity: "warning",
                  anchor: { kind: "skill" },
                  message: "This version ships executable scripts.",
                }),
                finding({
                  ruleId: "skill-surface.network-reference",
                  severity: "info",
                  anchor: { kind: "file", path: "scripts/fetch.sh" },
                  message: "A script references a network endpoint.",
                }),
              ],
              counts: { error: 0, warning: 1, info: 1, total: 2 },
              score: { value: 94, band: "low", analyzerVersion: SECURITY_ANALYZER_VERSION },
            }),
          }}
          onRetry={() => {}}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("This skill version")).toBeTruthy();
    expect(screen.getByText("scripts/fetch.sh")).toBeTruthy();
    expect(screen.queryByText("This server")).toBeNull();
  });
});

describe("SecurityPanel — A3/D-SP23: a clean subject gets a real answer", () => {
  it("says it is clean and names what was checked, rather than showing an empty table", () => {
    renderPanel({ status: "data", data: report() });
    expect(screen.getByText("Nothing found")).toBeTruthy();
    expect(
      screen.getByText(
        new RegExp(
          `security rules ran under analyzer v${SECURITY_ANALYZER_VERSION} and reported 0 findings`,
        ),
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("SecurityPanel — A9: evidence is visible, redacted TEXT", () => {
  it("shows an escaped invisible character and a redaction marker as literal text", () => {
    const excerpt = `Summarize a document.\\u200b Use ${SECURITY_REDACTION_MARKER} to authenticate.`;
    renderPanel({
      status: "data",
      data: report({
        findings: [
          finding({
            ruleId: "poisoning.invisible-unicode",
            evidence: { excerpt, offset: 21, truncated: false },
          }),
        ],
        counts: { error: 1, warning: 0, info: 0, total: 1 },
        score: { value: 85, band: "medium", analyzerVersion: SECURITY_ANALYZER_VERSION },
      }),
    });

    fireEvent.click(screen.getByRole("button", { name: "View excerpt" }));
    const rendered = screen.getByTestId("security-evidence-excerpt");
    // The escape is LITERAL text on screen — the whole point of the invisible-unicode rule is that
    // you can see what was hiding in the definition.
    expect(rendered.textContent).toBe(excerpt);
    expect(rendered.textContent).toContain("\\u200b");
    expect(rendered.textContent).toContain(SECURITY_REDACTION_MARKER);
    // React escaped it exactly once — no element was injected from the excerpt's own characters.
    expect(rendered.innerHTML).not.toContain("<");
    expect(rendered.innerHTML).not.toContain("&amp;lt;");
  });

  it("says so when an excerpt was cut, and renders an em dash when a rule carried no evidence", () => {
    renderPanel({
      status: "data",
      data: report({
        findings: [
          finding({ evidence: { excerpt: "a very long description…", truncated: true } }),
          finding({
            ruleId: "annotation.destructive-unmarked",
            severity: "warning",
            anchor: { kind: "tool", toolName: "delete_repo" },
            message: "A destructive tool carries no warning hint.",
          }),
        ],
        counts: { error: 1, warning: 1, info: 0, total: 2 },
        score: { value: 80, band: "medium", analyzerVersion: SECURITY_ANALYZER_VERSION },
      }),
    });
    fireEvent.click(screen.getByRole("button", { name: "View excerpt" }));
    expect(screen.getByText(/the excerpt was cut at 200 characters/)).toBeTruthy();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});

describe("SecurityPanel — the rule's rationale is reachable", () => {
  it("opens the rule's own rationale, verbatim, from a keyboard-reachable control", () => {
    renderPanel({
      status: "data",
      data: report({
        findings: [finding()],
        counts: { error: 1, warning: 0, info: 0, total: 1 },
        score: { value: 85, band: "medium", analyzerVersion: SECURITY_ANALYZER_VERSION },
      }),
    });
    const trigger = screen.getByRole("button", { name: /injection phrasing in description/i });
    fireEvent.click(trigger);
    expect(screen.getByText("poisoning.injection-phrasing")).toBeTruthy();
    expect(screen.getByText(/treat it as hostile until the vendor explains it/)).toBeTruthy();
  });
});
