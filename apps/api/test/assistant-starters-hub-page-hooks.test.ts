import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildHubAgentAnalyzePrompt,
  buildHubCrewAnalyzePrompt,
  buildHubWorkforceOverviewPrompt,
} from "@mcp-token-footprint/shared";

// Assistant operability WP 3.2 (D-AO5) — pure unit coverage for the "Ask the assistant" page-hook
// prompt builders backing the Hub's Workforce agent-profile / crew-profile modals. No DB, no fixture —
// same pure-cross-check pattern as `assistant-starters-catalog.test.ts` (packages/shared's own
// `src/*.test.ts` runner also exists, but the WP brief co-locates this next to the other
// `assistant-starters*` builder tests here).

test("buildHubAgentAnalyzePrompt quotes a known agent name", () => {
  assert.equal(
    buildHubAgentAnalyzePrompt("Support Triage"),
    `Analyze the agent "Support Triage": its setup (model, tools, skills) and recent usage & cost, and suggest what to tune or whether it's a candidate to archive.`,
  );
});

test("buildHubAgentAnalyzePrompt falls back to \"this agent\" for a blank/whitespace name", () => {
  assert.equal(
    buildHubAgentAnalyzePrompt(""),
    `Analyze the agent this agent: its setup (model, tools, skills) and recent usage & cost, and suggest what to tune or whether it's a candidate to archive.`,
  );
  assert.equal(
    buildHubAgentAnalyzePrompt("   "),
    `Analyze the agent this agent: its setup (model, tools, skills) and recent usage & cost, and suggest what to tune or whether it's a candidate to archive.`,
  );
});

test("buildHubAgentAnalyzePrompt trims surrounding whitespace before quoting", () => {
  assert.equal(
    buildHubAgentAnalyzePrompt("  Research Lead  "),
    `Analyze the agent "Research Lead": its setup (model, tools, skills) and recent usage & cost, and suggest what to tune or whether it's a candidate to archive.`,
  );
});

test("buildHubCrewAnalyzePrompt quotes a known crew name", () => {
  assert.equal(
    buildHubCrewAnalyzePrompt("Incident Response"),
    `Analyze the crew "Incident Response": its topology, members, and recent usage & cost, and suggest what to tune or whether it's a candidate to archive.`,
  );
});

test("buildHubCrewAnalyzePrompt falls back to \"this crew\" for a blank/whitespace name", () => {
  assert.equal(
    buildHubCrewAnalyzePrompt(""),
    `Analyze the crew this crew: its topology, members, and recent usage & cost, and suggest what to tune or whether it's a candidate to archive.`,
  );
  assert.equal(
    buildHubCrewAnalyzePrompt("   "),
    `Analyze the crew this crew: its topology, members, and recent usage & cost, and suggest what to tune or whether it's a candidate to archive.`,
  );
});

test("buildHubWorkforceOverviewPrompt is a fixed, argument-free string", () => {
  assert.equal(
    buildHubWorkforceOverviewPrompt(),
    "Rank my agents by token & cost this month, and flag any that look stale or unused and could be archived.",
  );
});

test("all three builders are pure — same input always yields the same output", () => {
  assert.equal(buildHubAgentAnalyzePrompt("Agent A"), buildHubAgentAnalyzePrompt("Agent A"));
  assert.equal(buildHubCrewAnalyzePrompt("Crew A"), buildHubCrewAnalyzePrompt("Crew A"));
  assert.equal(buildHubWorkforceOverviewPrompt(), buildHubWorkforceOverviewPrompt());
});
