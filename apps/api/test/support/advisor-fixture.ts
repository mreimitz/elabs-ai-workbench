// A fixed, in-memory `AdvisorContext` for tests that need the advisor to actually PRODUCE findings
// (RM-38 WP 2.2). It is deliberately separate from `advisor-rules.test.ts`'s own builders: that file
// hand-computes every savings number as an expression a reviewer can check by eye, and importing
// its fixtures would couple two suites whose reasons for existing are different.
//
// The shape is tuned so all three deterministic footprint rules fire at the SHIPPED pack values:
//   * description-bloat  — four of the five biggest tools on "Alpha" are description-dominated.
//   * tool-overlap       — "Alpha" and "Bravo" share two tools by exact name and one by similarity.
//   * unused-tool-trim   — only `search_documents` is ever called, so the waste share is > 50%.
//
// Everything is frozen: fixed ids, fixed timestamps, a fixed clock. A rule that started depending on
// the wall clock would make its report non-reproducible, which the engine's determinism contract
// forbids.

import type {
  AllowedServer,
  RunDetail,
  RunGrade,
  RunSummary,
  ScanDetail,
  ScanSummary,
  Scenario,
  ServerConfig,
  Skill,
  SuiteRun,
  ToolScan,
} from "@mcp-token-footprint/shared";
import type { AdvisorContext } from "../../src/advisor/types.js";

function server(id: string, name: string): ServerConfig {
  return {
    id,
    name,
    transport: "stdio",
    command: "node",
    args: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    hasEnvSecrets: false,
    hasHeaderSecrets: false,
    authType: "none",
  } as unknown as ServerConfig;
}

type ToolSpec = { name: string; totalTokens: number; descriptionTokens: number; description: string };

function tool(scanId: string, spec: ToolSpec): ToolScan {
  return {
    id: `${scanId}:${spec.name}`,
    scanId,
    toolName: spec.name,
    description: spec.description,
    rawTool: {},
    totalTokens: spec.totalTokens,
    nameTokens: 2,
    descriptionTokens: spec.descriptionTokens,
    schemaTokens: Math.max(spec.totalTokens - spec.descriptionTokens - 2, 0),
    annotationsTokens: 0,
    rawBytes: spec.totalTokens * 4,
    contributionPercent: 0,
  } as unknown as ToolScan;
}

function scan(id: string, serverId: string, serverName: string, specs: ToolSpec[]): ScanDetail {
  const tools = specs.map((spec) => tool(id, spec));
  const totalTokens = tools.reduce((sum, t) => sum + t.totalTokens, 0);
  return {
    id,
    serverId,
    serverName,
    tokenProfile: "generic_o200k",
    scannedAt: "2026-08-01T00:00:00.000Z",
    status: "success",
    totalTools: tools.length,
    totalTokens,
    totalRawBytes: totalTokens * 4,
    averageTokensPerTool: totalTokens / tools.length,
    largestToolTokens: tools.reduce((max, t) => Math.max(max, t.totalTokens), 0),
    totalResources: 0,
    totalResourceTemplates: 0,
    totalPrompts: 0,
    totalResourceTokens: 0,
    totalPromptTokens: 0,
    largestResourceTokens: 0,
    largestPromptTokens: 0,
    countingVersion: 2,
    tools,
    resources: [],
    prompts: [],
    events: [],
  } as unknown as ScanDetail;
}

const SERVERS = [server("srv-a", "Alpha"), server("srv-b", "Bravo")];

const SCAN_A = scan("scan-a", "srv-a", "Alpha", [
  {
    name: "search_documents",
    totalTokens: 600,
    descriptionTokens: 400,
    description: "Search all documents by a natural language query across every indexed corpus",
  },
  {
    name: "create_document",
    totalTokens: 500,
    descriptionTokens: 300,
    description: "Create a new document inside a chosen collection with metadata",
  },
  {
    name: "delete_document",
    totalTokens: 400,
    descriptionTokens: 260,
    description: "Delete a document permanently from a chosen collection",
  },
  {
    name: "list_collections",
    totalTokens: 300,
    descriptionTokens: 120,
    description: "List every collection the caller can read",
  },
  {
    name: "ping",
    totalTokens: 220,
    descriptionTokens: 150,
    description: "Check that the server is alive and answering requests promptly",
  },
  { name: "tiny_helper", totalTokens: 30, descriptionTokens: 20, description: "A tiny helper" },
]);

const SCAN_B = scan("scan-b", "srv-b", "Bravo", [
  {
    name: "search_documents",
    totalTokens: 500,
    descriptionTokens: 200,
    description: "Search all documents by a natural language query across every indexed corpus",
  },
  {
    name: "create_document",
    totalTokens: 450,
    descriptionTokens: 200,
    description: "Create a new document inside a chosen collection with metadata",
  },
  {
    name: "documents_delete",
    totalTokens: 380,
    descriptionTokens: 200,
    description: "Delete a document permanently from a chosen collection",
  },
  {
    name: "unrelated_widget",
    totalTokens: 120,
    descriptionTokens: 40,
    description: "Draw a widget on the canvas",
  },
]);

const ALLOWED = [
  { serverId: "srv-a", allowedTools: null },
  { serverId: "srv-b", allowedTools: null },
] as unknown as AllowedServer[];

const SCENARIO = {
  id: "env-1",
  name: "Docs environment",
  providerId: "prov-1",
  model: "gpt-4o",
  params: {},
  systemPrompt: "you are a test agent",
  allowedServers: ALLOWED,
  allowedSkills: [],
  defaultProfiles: [],
  guardrails: {},
  toolLoadingMode: "eager",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
} as unknown as Scenario;

function runSummary(id: string): RunSummary {
  return {
    id,
    testId: "test-1",
    scenarioId: "env-1",
    mode: "automated",
    status: "completed",
    startedAt: "2026-08-02T00:00:00.000Z",
    turns: 1,
    toolCalls: 0,
    peakContextTokens: 0,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
  } as unknown as RunSummary;
}

const RUNS = [runSummary("run-1"), runSummary("run-2")];

const CALLS: Record<string, string[]> = {
  "run-1": ["search_documents", "search_documents"],
  "run-2": ["search_documents"],
};

/** The fixed context. A fresh object each call so a test cannot leak state into another. */
export function advisorFixtureContext(): AdvisorContext {
  return {
    servers: {
      list: () => SERVERS.slice(),
      getPublic: (id) => {
        const found = SERVERS.find((s) => s.id === id);
        if (!found) throw new Error(`no server ${id}`);
        return found;
      },
    },
    scans: {
      listSummariesByServer: (serverId) =>
        [SCAN_A, SCAN_B]
          .filter((s) => s.serverId === serverId)
          .map((s) => ({ ...s, tools: undefined }) as unknown as ScanSummary),
      getLatestForServer: (serverId) =>
        serverId === "srv-a" ? SCAN_A : serverId === "srv-b" ? SCAN_B : null,
      getDetail: (scanId) => (scanId === "scan-a" ? SCAN_A : SCAN_B),
    },
    scenarios: {
      list: () => [SCENARIO],
      get: () => SCENARIO,
      listServers: () => ALLOWED,
    },
    runs: {
      listRuns: () => RUNS.slice(),
      getRun: (runId) => ({ id: runId }) as unknown as RunDetail,
      getToolCallSequence: (runId) => CALLS[runId] ?? [],
      getSummary: (runId) => RUNS.find((r) => r.id === runId) ?? runSummary(runId),
      getRunSkills: () => [],
    },
    grades: { listByRun: () => [] as RunGrade[] },
    suiteRuns: { listRuns: () => [] as SuiteRun[], listChildRunIds: () => [] },
    skills: { list: () => [] as Skill[] },
    models: { get: () => null },
    now: () => new Date("2026-08-18T09:30:00.000Z"),
  };
}
