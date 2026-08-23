import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_TOKEN_PROFILE,
  type ScanDetail,
  type TokenProfileId,
  WORKBENCH_MCP_MOUNT_PATH,
  WORKBENCH_MCP_SERVER_NAME,
  WORKBENCH_MCP_SERVER_VERSION,
  WORKBENCH_MCP_TOOL_NAMES,
} from "@mcp-token-footprint/shared";
import { workbenchMcpDefinitionTokenBudget } from "../data-pack/thresholds.js";
import Database from "better-sqlite3";
import Fastify from "fastify";
import { CollectionRepository } from "../collections/repository.js";
import { type AppDatabase, applyMigrations, ensureLocalCollection } from "../db/database.js";
import { schemaSql } from "../db/schema.js";
import { registerFeatureRoutes } from "../features/routes.js";
import { FeatureFlagsService } from "../features/service.js";
import { AppSettingsRepository } from "../grading/app-settings-repository.js";
import { GradeRepository } from "../grading/grade-repository.js";
import { RunReportService } from "../grading/run-report.js";
import { RunFeedbackRepository } from "../observability/feedback.js";
import { OAuthRepository } from "../oauth/repository.js";
import { OAuthService } from "../oauth/service.js";
import { createMarkdownReport } from "../reports/reports.js";
import { ScanRepository } from "../scans/repository.js";
import { ScanService } from "../scans/service.js";
import { SecretStore } from "../secrets/secret-store.js";
import { ServerRepository } from "../servers/repository.js";
import { SkillRepository } from "../skills/repository.js";
import { SuiteRepository } from "../suites/repository.js";
import { SuiteRunRepository } from "../suites/suite-run-repository.js";
import { RunRepository } from "../testing/run-repository.js";
import { ScenarioRepository } from "../testing/scenario-repository.js";
import { ScenarioService } from "../testing/scenario-service.js";
import { TestRepository } from "../testing/test-repository.js";
import { TestService } from "../testing/test-service.js";
import { registerWorkbenchMcpRoutes } from "./routes.js";
import type { WorkbenchMcpDeps } from "./tools.js";

// ==================================================================================================
// The self-scan gate (D-MCP5) — the workbench measures its OWN MCP mount, with its own scanner
// ==================================================================================================
// "The footprint report is a build artifact and a budget assertion." This module is that gate, and
// the first end-to-end proof of scan-over-own-mount: it serves the real `/api/mcp` mount on an
// ephemeral loopback port, registers it as an ordinary `streamable_http` server in a throwaway
// database, and runs **the app's own discovery scan** against it — the same `ScanService.runScan`
// path a user's scan of any HTTP MCP server takes, with the same MCP client, the same normalizers
// and the same `js-tiktoken` counter. Nothing here re-implements a measurement; if the scanner is
// wrong, this number is wrong in exactly the same way, which is the point of eating our own cooking.
//
// It is deliberately NOT the in-test `tools/list` measurement that already exists
// (`apps/api/test/workbench-mcp-server.test.ts`): that one counts a client's view of the payload,
// this one is a real scan row with a `countingVersion`, per-tool contributions, resources and a
// report — i.e. what a user would see if they pointed this app at the mount themselves.
//
// Hermetic by construction: a temp-directory SQLite file that is deleted afterwards, an in-process
// key that is never written to disk, loopback-only HTTP, no provider key, no network, no MCP child
// process. The one thing it needs is a free port.

/** One tool's line in the footprint artifact. */
export type WorkbenchSelfScanTool = {
  name: string;
  totalTokens: number;
  contributionPercent: number;
};

/** The measured result — the shape both the JSON artifact and the exit code are derived from. */
export type WorkbenchSelfScanResult = {
  generatedAt: string;
  /** The mount that was scanned, on its ephemeral port (never a filesystem path). */
  mountUrl: string;
  serverName: string;
  serverVersion: string;
  tokenProfile: TokenProfileId;
  countingVersion: number;
  /** The tool-definition budget from the shared contract (D-MCP5). */
  budget: number;
  /** Tool-definition tokens — the number the budget is asserted against. */
  measuredTokens: number;
  overBudget: boolean;
  toolCount: number;
  /** How many tools the shared contract declares, so a partial registration is visible here too. */
  declaredToolCount: number;
  resourceCount: number;
  resourceTemplateCount: number;
  promptCount: number;
  resourceTokens: number;
  totalRawBytes: number;
  tools: WorkbenchSelfScanTool[];
  /** The full scan row, so the artifact is a real report and not just a headline number. */
  scan: ScanDetail;
};

export type WorkbenchSelfScanOptions = {
  /** Token profile to count with. Defaults to the app's default profile. */
  tokenProfile?: TokenProfileId;
};

/** Build an isolated database in `dir` exactly the way `openDatabase()` builds the real one. */
function createScratchDatabase(dir: string): AppDatabase {
  const db = new Database(path.join(dir, "self-scan.sqlite")) as unknown as AppDatabase;
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  ensureLocalCollection(db);
  return db;
}

/**
 * The write tools' dependencies, wired so this harness CANNOT launch anything (WP M.3).
 *
 * The self-scan is a MEASUREMENT harness: the discovery scan it runs speaks `initialize`,
 * `tools/list`, `resources/list` and `prompts/list`, and never `tools/call`. So no handler here ever
 * runs — and rather than rely on that, the four write-side dependencies are narrow stubs that THROW.
 * That way "the dogfood gate cannot start a scan, a suite run or a run plan" is a property of the
 * wiring a reader can check in one place, not an inference from what the scanner happens to call
 * today. `tools/list` reads each definition's name, description and input schema; none of those
 * touches these objects.
 *
 * The casts are the honest way to say "this is deliberately not a real service": the fields are typed
 * as the production classes because {@link WorkbenchMcpDeps} is the production contract, and widening
 * that contract to accommodate a test harness would be the wrong trade.
 */
function refusingWriteDeps(): Pick<
  WorkbenchMcpDeps,
  "scanService" | "suiteOrchestrator" | "runPlans" | "estimate"
> {
  const refuse = (): never => {
    throw new Error(
      "the workbench self-scan measures tools/list only — it never invokes a tool, and its write " +
        "dependencies are deliberately inert",
    );
  };
  return {
    scanService: { runScan: refuse } as unknown as WorkbenchMcpDeps["scanService"],
    suiteOrchestrator: {
      startSuiteRun: refuse,
      startPlanRun: refuse,
    } as unknown as WorkbenchMcpDeps["suiteOrchestrator"],
    runPlans: {
      suites: { get: refuse },
      collections: { get: refuse },
      tests: { listIdsByCollection: refuse, list: refuse },
    } as unknown as WorkbenchMcpDeps["runPlans"],
    estimate: {
      scenarios: { list: refuse },
      tests: { list: refuse },
      scans: { getLatestForServer: refuse },
      runs: { measureTurnProfiles: refuse },
    } as unknown as WorkbenchMcpDeps["estimate"],
  };
}

/**
 * Serve the real mount, scan it with the real scanner, and return the measurement.
 *
 * Throws when the mount cannot be served or the scan does not complete — the caller turns that into
 * an execution-error exit code, distinct from a budget breach (which is a normal, reportable result).
 */
export async function runWorkbenchSelfScan(
  options: WorkbenchSelfScanOptions = {},
): Promise<WorkbenchSelfScanResult> {
  const tokenProfile = options.tokenProfile ?? DEFAULT_TOKEN_PROFILE;
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "workbench-mcp-self-scan-"));
  const db = createScratchDatabase(workdir);
  // A per-run key held only in memory: the scratch database stores an encrypted (empty) header map
  // like any other server row, and the key dies with the process.
  const secrets = new SecretStore(randomBytes(32));

  const servers = new ServerRepository(db, secrets);
  const scans = new ScanRepository(db);
  const oauth = new OAuthService(servers, new OAuthRepository(db, secrets));
  const scanService = new ScanService(servers, scans, oauth);

  const runs = new RunRepository(db);
  const grades = new GradeRepository(db);
  const skills = new SkillRepository(db, secrets);
  const scenarioRepository = new ScenarioRepository(db);
  const tests = new TestService(new TestRepository(db), path.join(workdir, "attachments"));
  const settings = new AppSettingsRepository(db);
  const features = new FeatureFlagsService(settings);
  // The mount is flag-gated (D-MCP6). Setting it explicitly rather than relying on the default is the
  // honest version of "the gate scans a switched-ON server": if the default ever flips, this still
  // measures the surface it claims to measure.
  features.setFlags({ mcp_server: true });

  const app = Fastify({ logger: false });
  registerFeatureRoutes(app, features);
  registerWorkbenchMcpRoutes(app, {
    servers,
    scans,
    runs,
    grades,
    skills,
    suites: new SuiteRepository(db),
    suiteRuns: new SuiteRunRepository(db),
    collections: new CollectionRepository(db, secrets),
    runReports: {
      runs,
      tests,
      scenarios: new ScenarioService(scenarioRepository, scans, skills),
      runReports: new RunReportService(grades, runs),
      feedback: new RunFeedbackRepository(db),
    },
    ...refusingWriteDeps(),
  });

  try {
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    if (!port) throw new Error("self-scan could not bind a loopback port for the MCP mount");
    const mountUrl = `http://127.0.0.1:${port}${WORKBENCH_MCP_MOUNT_PATH}`;

    const registered = servers.create({
      name: "Workbench MCP server (self-scan)",
      transport: "streamable_http",
      url: mountUrl,
    });

    const scan = await scanService.runScan(registered.id, tokenProfile);
    if (scan.status !== "success") {
      throw new Error(
        `self-scan did not complete: status=${scan.status}${scan.errorMessage ? ` — ${scan.errorMessage}` : ""}`,
      );
    }

    // RM-38 WP 2.2 — the budget is a PACK value now, so `pnpm mcp:self-scan` re-measures against
    // whatever pack is in force rather than a number compiled into this build.
    const budget = workbenchMcpDefinitionTokenBudget();

    return {
      generatedAt: new Date().toISOString(),
      mountUrl,
      serverName: WORKBENCH_MCP_SERVER_NAME,
      serverVersion: WORKBENCH_MCP_SERVER_VERSION,
      tokenProfile,
      countingVersion: scan.countingVersion,
      budget,
      measuredTokens: scan.totalTokens,
      overBudget: scan.totalTokens > budget,
      toolCount: scan.totalTools,
      declaredToolCount: WORKBENCH_MCP_TOOL_NAMES.length,
      resourceCount: scan.totalResources,
      resourceTemplateCount: scan.totalResourceTemplates,
      promptCount: scan.totalPrompts,
      resourceTokens: scan.totalResourceTokens,
      totalRawBytes: scan.totalRawBytes,
      tools: scan.tools.map((tool) => ({
        name: tool.toolName,
        totalTokens: tool.totalTokens,
        contributionPercent: tool.contributionPercent,
      })),
      scan,
    };
  } finally {
    await app.close().catch(() => undefined);
    db.close();
    fs.rmSync(workdir, { recursive: true, force: true });
  }
}

/** One line, for a CI log or a terminal — the whole verdict at a glance. */
export function formatSelfScanHeadline(result: WorkbenchSelfScanResult): string {
  const verdict = result.overBudget ? "OVER BUDGET" : "within budget";
  return (
    `Workbench MCP self-scan: ${result.toolCount} tools · ${result.measuredTokens} definition tokens ` +
    `(${result.tokenProfile}, countingVersion ${result.countingVersion}) · ` +
    `budget ${result.budget} → ${verdict}`
  );
}

/** The JSON artifact body. The scan report rides along, so the artifact answers "why" as well as "how much". */
export function renderSelfScanJson(result: WorkbenchSelfScanResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

/**
 * The Markdown artifact: a budget verdict, then the app's OWN scan report for the mount — the same
 * document `GET /api/reports/scan/:id/markdown` would export for any other server.
 */
export function renderSelfScanMarkdown(result: WorkbenchSelfScanResult): string {
  const headroom = result.budget - result.measuredTokens;
  const lines = [
    "# Workbench MCP server — self-scan (D-MCP5)",
    "",
    `Generated: ${result.generatedAt}`,
    `Mount: ${result.mountUrl} (${result.serverName} v${result.serverVersion})`,
    "",
    "## Budget",
    "",
    `- Verdict: **${result.overBudget ? "OVER BUDGET" : "within budget"}**`,
    `- Tool-definition tokens: **${result.measuredTokens}** of ${result.budget} (${headroom >= 0 ? `${headroom} spare` : `${-headroom} over`})`,
    `- Token profile: ${result.tokenProfile} (countingVersion ${result.countingVersion})`,
    `- Tools registered: ${result.toolCount} of ${result.declaredToolCount} declared in the shared contract`,
    `- Resources: ${result.resourceCount} · resource templates: ${result.resourceTemplateCount} · prompts: ${result.promptCount}`,
    `- Resource-definition tokens: ${result.resourceTokens} · raw definition bytes: ${result.totalRawBytes}`,
    "",
    "> Measured by pointing this app's own discovery scanner at its own mount — the same code path a",
    "> scan of any other streamable-HTTP MCP server takes.",
    "",
    "---",
    "",
    createMarkdownReport(result.scan),
  ];
  return lines.join("\n");
}
