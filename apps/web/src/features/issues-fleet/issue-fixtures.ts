import type { RatingIssue, RatingIssueFleet, ServerConfig, Skill } from "@mcp-token-footprint/shared";
import type { FleetIssue } from "./issue-lib";

/**
 * Shared WP5.1-shaped fixtures for the issues-fleet feature's component + unit tests. Every field
 * on {@link RatingIssue}/{@link RatingIssueFleet} is populated at least once across these three so a
 * "renders every field somewhere" assertion has real data to find (acceptance #1).
 */

function fleet(overrides: Partial<RatingIssueFleet>): RatingIssueFleet {
  return {
    clusterKey: "cluster-default",
    clusterKeyVersion: 1,
    lifecycle: "open",
    occurrenceCount: 3,
    firstSeenAt: "2026-07-01T09:00:00.000Z",
    lastSeenAt: "2026-07-10T09:00:00.000Z",
    affected: { servers: ["srv-1"], skills: [], tests: ["test-1"], models: ["claude-opus-4"] },
    trend: [
      { day: "2026-07-01", count: 1 },
      { day: "2026-07-05", count: 1 },
      { day: "2026-07-10", count: 1 },
    ],
    ...overrides,
  };
}

export const OPEN_FLEET_ISSUE: FleetIssue = {
  id: "issue-open-1",
  targetKind: "mcp_server",
  targetId: "srv-1",
  targetName: "Qlik-SaaS",
  title: "Tool `run_query` rejects a valid date filter",
  summary: "The tool consistently rejects ISO date filters with a schema-validation error.",
  bucket: "mcp_server",
  fixTarget: "mcp_server",
  draftFix: "Loosen the `date` parameter's schema to accept ISO-8601 date-only strings.",
  severity: "high",
  status: "open",
  timesSeen: 3,
  firstSeenAt: "2026-07-01T09:00:00.000Z",
  lastSeenAt: "2026-07-10T09:00:00.000Z",
  ratingVersion: 3,
  judgeProviderId: "anthropic",
  judgeModel: "claude-opus-4",
  occurrences: [
    {
      runId: "run-1",
      suiteRunId: "suite-run-1",
      category: "failed_tool_call",
      message: "run_query rejected the date filter",
      toolName: "run_query",
      sentArguments: '{"date":"2026-07-01"}',
      errorMessage: "Invalid parameter: date must match pattern ^\\d{8}$",
      createdAt: "2026-07-01T09:05:00.000Z",
    },
    {
      runId: "run-2",
      category: "failed_tool_call",
      message: "run_query rejected the date filter again",
      toolName: "run_query",
      createdAt: "2026-07-10T09:05:00.000Z",
    },
  ],
  fleet: fleet({
    lifecycle: "open",
    occurrenceCount: 2,
    trend: [
      { day: "2026-07-01", count: 1 },
      { day: "2026-07-10", count: 1 },
    ],
  }),
};

export const REGRESSED_FLEET_ISSUE: FleetIssue = {
  ...OPEN_FLEET_ISSUE,
  id: "issue-regressed-1",
  title: "Skill `sales-summary` calls a retired tool",
  targetKind: "skill",
  targetId: "skill-1",
  targetName: "Sales summary",
  bucket: "skill",
  fixTarget: "skill",
  severity: "medium",
  occurrences: [
    {
      runId: "run-3",
      category: "failed_tool_call",
      message: "Called a tool that no longer exists",
      createdAt: "2026-07-12T09:00:00.000Z",
    },
  ],
  fleet: fleet({
    clusterKey: "cluster-regressed",
    lifecycle: "regressed",
    occurrenceCount: 5,
    firstSeenAt: "2026-06-01T09:00:00.000Z",
    lastSeenAt: "2026-07-15T09:00:00.000Z",
    affected: {
      servers: [],
      skills: ["skill-1"],
      tests: ["test-2"],
      models: ["claude-sonnet-4"],
    },
    resolutionNote: "Fixed in skill v3",
    resolvedAt: "2026-07-08T09:00:00.000Z",
    trend: [{ day: "2026-07-15", count: 1 }],
  }),
};

/** A single, thinly-sourced occurrence — exercises the "sparse data" sparkline honesty rule (one
 *  point, never padded to a fabricated series). */
export const SPARSE_RESOLVED_FLEET_ISSUE: FleetIssue = {
  ...OPEN_FLEET_ISSUE,
  id: "issue-resolved-1",
  title: "Prompt `weekly-digest` times out",
  status: "resolved",
  resolvedAt: "2026-07-09T09:00:00.000Z",
  occurrences: [
    {
      runId: "run-4",
      category: "guardrail_stop",
      message: "Hit the duration guardrail",
      createdAt: "2026-07-02T09:00:00.000Z",
    },
  ],
  fleet: fleet({
    clusterKey: "cluster-resolved",
    lifecycle: "resolved",
    occurrenceCount: 1,
    firstSeenAt: "2026-07-02T09:00:00.000Z",
    lastSeenAt: "2026-07-02T09:00:00.000Z",
    affected: { servers: ["srv-2"], skills: [], tests: [], models: [] },
    resolutionNote: "Increased the timeout budget",
    resolvedAt: "2026-07-09T09:00:00.000Z",
    trend: [{ day: "2026-07-02", count: 1 }],
  }),
};

/** A plain (non-fleet) per-run auto-rating issue — belongs to `features/issues/IssuesPanel`, NOT this
 *  tab; used to prove `isFleetIssue`/list filtering correctly excludes it. */
export const NON_FLEET_ISSUE: RatingIssue = {
  ...OPEN_FLEET_ISSUE,
  id: "issue-per-run-1",
  fleet: undefined,
};

export const ALL_FLEET_FIXTURES: FleetIssue[] = [
  OPEN_FLEET_ISSUE,
  REGRESSED_FLEET_ISSUE,
  SPARSE_RESOLVED_FLEET_ISSUE,
];

/** Minimal, type-valid server/skill catalog fixtures — the "Affected" chip name-resolution tests'
 *  `listServers`/`listSkills` mocks (`IssuesFleetTab.test.tsx`). Ids match the fleet fixtures above. */
export const FIXTURE_SERVERS: ServerConfig[] = [
  {
    id: "srv-1",
    name: "Qlik-SaaS",
    transport: "streamable_http",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    hasEnvSecrets: false,
    hasHeaderSecrets: false,
    authType: "none",
  },
  {
    id: "srv-2",
    name: "Qlik-Stage",
    transport: "streamable_http",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    hasEnvSecrets: false,
    hasHeaderSecrets: false,
    authType: "none",
  },
];

export const FIXTURE_SKILLS: Skill[] = [
  {
    id: "skill-1",
    name: "sales-summary",
    displayName: "Sales summary",
    slug: "sales-summary",
    sourceType: "upload",
    versionCount: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];
