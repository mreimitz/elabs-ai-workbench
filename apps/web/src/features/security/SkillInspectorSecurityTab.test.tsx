import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@elabs-ai/components-ui";
import {
  SECURITY_ANALYZER_VERSION,
  SECURITY_FINDING_LIMIT,
  type SecurityFinding,
  type SecurityReport,
  type Skill,
  type SkillVersion,
} from "@mcp-token-footprint/shared";

// The skill inspector's Security tab BADGE (WP 2.1, A1 / D-SP3 / D-SP6).
//
// It lives here rather than beside `SkillInspector.tsx` because that file has no test of its own,
// and `ServerRailPosture.test.tsx` in this folder already sets the precedent of testing another
// feature's file from the security feature that gave it the behaviour under test.
//
// The claim is the same one the scan strip makes in `ScansView.test.tsx`: `counts` describes EVERY
// finding the analyzer produced, `findings` is a LIST the display cap may have shortened, and the
// badge must be the tally. A strip badging `findings.length` would print "200" next to a report
// whose own total says 240 — the table quietly shorter than the number beside it.
//
// Only the FETCH is stubbed. `useSecurityReport`, `loadableData` and the `TabsTrigger` are all real,
// because they are the chain the assertion is about.

const getSkillSecurityReport = vi.fn<() => Promise<SecurityReport>>(
  () => new Promise<never>(() => {}),
);
vi.mock("./security-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./security-api")>();
  return { ...actual, getSkillSecurityReport: () => getSkillSecurityReport() };
});

// The inspector's own read API — the shell it needs to paint a tab strip at all. Spread over the
// REAL module rather than replaced wholesale: sibling panels reach for other exports of it, and a
// factory that returned only the five reads used here would turn every one of those into a
// "no export is defined on the mock" throw from a component this test does not care about.
vi.mock("../skills/skills-inspector-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../skills/skills-inspector-api")>();
  return {
    ...actual,
    getSkill: () => Promise.resolve(SKILL),
    listSkillVersions: () => Promise.resolve([VERSION]),
    getSkillVersion: () => Promise.resolve(VERSION),
    getSkillFiles: () => Promise.resolve([]),
    getSkillUpstreamSafe: () => Promise.resolve(null),
  };
});

// Page-level context + hooks the inspector reads on every render.
vi.mock("../assistant/assistant-context", () => ({
  useAssistant: () => ({
    activeAssistantThreadId: null,
    authConfigured: false,
    openAssistant: vi.fn(),
  }),
}));
vi.mock("../issues/use-rating-issues", () => ({
  useRatingIssues: () => ({
    state: { status: "data", data: [] },
    reload: vi.fn(),
    openCount: 0,
  }),
}));
vi.mock("../skills/use-live-skill-workspace", () => ({
  useLiveSkillWorkspace: () => ({
    isLive: false,
    files: [],
    filesError: null,
    autoOpenNonce: 0,
    autoOpenPath: null,
    committed: null,
    baseVersionId: null,
  }),
}));

// The heavy tab bodies. None of them is on screen in these tests (Radix unmounts inactive tab
// content) — they are stubbed only so Monaco, xyflow and the flow canvas never enter the jsdom
// bundle, mirroring the convention in `ScansView.test.tsx` / `ResourcePromptRun.test.tsx`.
vi.mock("@elabs-ai/components-editor", () => ({
  CodeEditor: () => <div data-testid="code-editor" />,
  DiffEditor: () => <div data-testid="diff-editor" />,
}));
vi.mock("../skills/design/SkillDesignView", () => ({ SkillDesignView: () => <div /> }));
vi.mock("../skills/design/ToolRunnerSheet", () => ({ ToolRunnerSheet: () => <div /> }));
vi.mock("../skills/trace/SkillTraceView", () => ({ SkillTraceView: () => <div /> }));
vi.mock("../skills/quality/QualityView", () => ({ QualityView: () => <div /> }));
vi.mock("../skills/LiveSkillWorkspaceView", () => ({ LiveSkillWorkspaceView: () => <div /> }));
// The three GitHub dialogs render closed here; stubbed because they read binding fields this
// upload-sourced fixture deliberately does not carry.
vi.mock("../skills/GithubSourceDialog", () => ({ GithubSourceDialog: () => <div /> }));
vi.mock("../skills/PublishGithubDialog", () => ({ PublishGithubDialog: () => <div /> }));
vi.mock("../skills/PushGithubDialog", () => ({ PushGithubDialog: () => <div /> }));

// jsdom omits matchMedia / ResizeObserver — Radix (Tabs/Select/Tooltip) reads them.
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
if (typeof window.ResizeObserver !== "function") {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof window.ResizeObserver;
}

import { SkillInspector } from "../skills/SkillInspector";

const SKILL: Skill = {
  id: "skl_1",
  name: "audit-helper",
  displayName: "Audit helper",
  slug: "audit-helper",
  sourceType: "upload",
  currentVersionId: "ver_2",
  versionCount: 1,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-02T00:00:00Z",
};

const VERSION: SkillVersion = {
  id: "ver_2",
  skillId: "skl_1",
  seq: 2,
  versionLabel: "v2",
  treeSha: "0".repeat(40),
  sourceKind: "upload",
  importedFrom: "upload",
  manifest: { name: "audit-helper", description: "Audits a repository." },
  manifestValid: true,
  manifestErrors: [],
  fileCount: 1,
  totalBytes: 512,
  tokenProfile: "generic_o200k",
  l1MetadataTokens: 10,
  l2BodyTokens: 20,
  l3ResourceTokens: 30,
  totalTokens: 60,
  createdAt: "2026-01-02T00:00:00Z",
};

/** A report the display cap really did shorten: 240 produced, the first 200 listed. */
function truncatedReport(): SecurityReport {
  const findings: SecurityFinding[] = Array.from(
    { length: SECURITY_FINDING_LIMIT },
    (_unused, index) => ({
      ruleId: "skill-surface.network-reference",
      severity: "info",
      anchor: { kind: "file", path: `scripts/step_${index}.sh` },
      message: `scripts/step_${index}.sh references an absolute URL.`,
    }),
  );
  return {
    analyzerVersion: SECURITY_ANALYZER_VERSION,
    generatedAt: "2026-01-02T12:00:00.000Z",
    subject: {
      kind: "skill",
      id: "ver_2",
      ownerId: "skl_1",
      name: "Audit helper",
      capturedAt: "2026-01-02T00:00:00Z",
    },
    findings,
    counts: { error: 0, warning: 0, info: 240, total: 240 },
    score: { value: 0, band: "high", analyzerVersion: SECURITY_ANALYZER_VERSION },
    truncated: true,
  };
}

function renderInspector() {
  return render(
    <TooltipProvider>
      <MemoryRouter initialEntries={["/skills/skl_1"]}>
        <SkillInspector skillId="skl_1" />
      </MemoryRouter>
    </TooltipProvider>,
  );
}

afterEach(() => {
  getSkillSecurityReport.mockReset();
  getSkillSecurityReport.mockImplementation(() => new Promise<never>(() => {}));
});

describe("SkillInspector — the Security tab badge counts ALL findings, not the listed ones", () => {
  it("badges the report's own total, never the length of the (capped) findings list", async () => {
    getSkillSecurityReport.mockResolvedValue(truncatedReport());
    renderInspector();

    const tab = await screen.findByRole("tab", { name: /^Security/ });
    // 240 produced, 200 listed. The badge is the tally. Awaited, not read synchronously: the strip
    // exists before the page-level report settles, so a sync read here races the re-render.
    expect(await within(tab).findByText("240")).toBeTruthy();
    expect(within(tab).queryByText(String(SECURITY_FINDING_LIMIT))).toBeNull();
    // And it is right before the tab has ever been opened — the whole reason the fetch sits at page
    // level rather than inside the panel (Radix unmounts inactive tab content).
    expect(tab.getAttribute("data-state")).toBe("inactive");
  });

  it("shows no count at all until the report settles — never a flashed 0", async () => {
    // Pending by default (see the mock above). A `0` while the request is in flight would tell the
    // operator this version is clean, then change its mind.
    renderInspector();

    const tab = await screen.findByRole("tab", { name: /^Security/ });
    expect(tab.textContent).toBe("Security");
  });

  it("suppresses the suffix for a genuinely clean version, matching the Issues tab's own rule", async () => {
    getSkillSecurityReport.mockResolvedValue({
      ...truncatedReport(),
      findings: [],
      counts: { error: 0, warning: 0, info: 0, total: 0 },
      score: { value: 100, band: "clean", analyzerVersion: SECURITY_ANALYZER_VERSION },
      truncated: false,
    });
    renderInspector();

    const tab = await screen.findByRole("tab", { name: /^Security/ });
    expect(tab.textContent).toBe("Security");
  });
});
