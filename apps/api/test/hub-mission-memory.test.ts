// Assistant Hub — v1-fixes F1/F2/F7 pure units (roadmap/assistant-hub/mission-session-analysis-2026-07-20.md).
//
// The mission-memory primitives that close the "model context = UI context" gap:
//   • `pickSynthesisModel` (F1) — the synthesis turn never runs on an `assistant|…` facade model.
//   • `buildMissionDigest` / `collectMissionFollowups` (F2/F7) — the compact, hard-capped model-visible
//     record of a mission's outcome, and its deduped open questions.
//   • `reconstructMessages` folding (F2) — the digest becomes an assistant turn; the synthesis message
//     is labeled; a plain session reconstructs byte-identically to pre-fix behavior.
//   • `buildPlannerSessionContext` (F7) — the planner's read-only context block for follow-up missions.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { HubAgentReport, HubEvent } from "@mcp-token-footprint/shared";
import { buildPlannerSessionContext } from "../src/hub/missions/planner.js";
import { pickSynthesisModel } from "../src/hub/missions/roster.js";
import { buildMissionDigest, collectMissionFollowups } from "../src/hub/missions/synthesis.js";
import { reconstructMessages } from "../src/hub/turn-engine.js";

function report(over: Partial<HubAgentReport> = {}): HubAgentReport {
  return {
    findings: [{ summary: "A finding." }],
    citations: [],
    artifacts: [],
    confidence: "medium",
    openQuestions: [],
    ...over,
  };
}

// ── pickSynthesisModel (F1) ────────────────────────────────────────────────────────────────────────
//
// model-identity WP4.2 (D-MI4) — the function now takes/returns credential-carrying `HubModelRef`s
// (`{model, providerCredentialId?}`) instead of bare ids, so the winner's PROVIDER travels with it into
// `runSynthesisTurn`. The four cases below are the SAME F1 behaviours re-expressed against that shape;
// the fifth is new and locks the credential-aware predicate.

const ref = (model: string, providerCredentialId?: string) =>
  providerCredentialId ? { model, providerCredentialId } : { model };

test("pickSynthesisModel: an explicit override always wins", () => {
  const picked = pickSynthesisModel({
    session: ref("assistant|t|a"),
    planModels: [ref("assistant|t|a")],
    override: "claude-sonnet-4-6",
  });
  // An env override is a bare id by construction, so it deliberately carries no credential.
  assert.deepEqual(picked, { model: "claude-sonnet-4-6" });
});

test("pickSynthesisModel: a structured session model wins over the plan's models", () => {
  const picked = pickSynthesisModel({
    session: ref("claude-sonnet-4-6"),
    planModels: [ref("assistant|t|a"), ref("gpt-4o-mini")],
  });
  assert.equal(picked.model, "claude-sonnet-4-6");
});

test("pickSynthesisModel: a facade session model falls back to the first structured plan model", () => {
  const picked = pickSynthesisModel({
    session: ref("assistant|t|a"),
    planModels: [ref("assistant|t|b"), ref("gpt-4o-mini", "cred-openai"), ref("claude-haiku")],
  });
  assert.equal(picked.model, "gpt-4o-mini");
  // The winner's credential travels with it — the whole point of the ref (D-MI1).
  assert.equal(picked.providerCredentialId, "cred-openai");
});

test("pickSynthesisModel: all-facade everywhere degrades to the session model (deterministic fallback path)", () => {
  const picked = pickSynthesisModel({
    session: ref("assistant|t|a"),
    planModels: [ref("assistant|t|b")],
  });
  assert.equal(picked.model, "assistant|t|a");
});

test("pickSynthesisModel (WP4.2): a subscription-pinned session model is skipped for a plan model that can structure output", () => {
  // Both refs carry the SAME canonical Anthropic id — only the credential distinguishes them (§3 freezes
  // the ids). The default bare-id predicate cannot tell them apart; the injected one can.
  const subscriptionPinned = new Set(["cred-cli"]);
  const picked = pickSynthesisModel({
    session: ref("claude-sonnet-5", "cred-cli"),
    planModels: [ref("claude-sonnet-5", "cred-api")],
    isStructured: (r) => !(r.providerCredentialId && subscriptionPinned.has(r.providerCredentialId)),
  });
  assert.deepEqual(picked, { model: "claude-sonnet-5", providerCredentialId: "cred-api" });

  // Without the predicate the pre-WP4.2 answer is unchanged (the session model wins) — proving the
  // widening is additive and an un-injected caller still gets the old behaviour.
  const legacy = pickSynthesisModel({
    session: ref("claude-sonnet-5", "cred-cli"),
    planModels: [ref("claude-sonnet-5", "cred-api")],
  });
  assert.equal(legacy.providerCredentialId, "cred-cli");
});

// ── buildMissionDigest (F2) ────────────────────────────────────────────────────────────────────────

test("buildMissionDigest: carries per-agent findings + ALL open questions, attributed", () => {
  const digest = buildMissionDigest([
    report({
      roleName: "regional-analyst",
      confidence: "high",
      findings: [{ summary: "Europe leads attainment." }, { summary: "Asia leads volume." }],
      openQuestions: ["Why does Continental Europe outperform?"],
    }),
    report({ roleName: "rm-analyst", openQuestions: ["Are the outlier targets miscalibrated?"] }),
  ]);
  assert.match(digest, /^Mission results digest \(2 agent reports\)/);
  assert.match(digest, /### regional-analyst — confidence high/);
  assert.match(digest, /- Europe leads attainment\./);
  assert.match(digest, /Why does Continental Europe outperform\?/);
  assert.match(digest, /Are the outlier targets miscalibrated\?/);
  assert.match(digest, /mission\.report/, "points at the on-demand full-report tool");
});

test("buildMissionDigest: empty reports produce an empty digest (no event emitted upstream)", () => {
  assert.equal(buildMissionDigest([]), "");
});

test("buildMissionDigest: is hard-capped — an oversized mission cannot blow the context budget", () => {
  const many = Array.from({ length: 12 }, (_, i) =>
    report({
      roleName: `agent-${i}`,
      findings: Array.from({ length: 20 }, (_, j) => ({ summary: `Finding ${j} ${"x".repeat(400)}` })),
      openQuestions: Array.from({ length: 10 }, (_, j) => `Question ${j} ${"y".repeat(400)}?`),
    }),
  );
  const digest = buildMissionDigest(many);
  assert.ok(digest.length <= 6_200, `digest stays capped (got ${digest.length})`);
  assert.match(digest, /digest truncated/);
});

test("buildMissionDigest: caps findings per agent with an honest remainder line", () => {
  const digest = buildMissionDigest([
    report({
      roleName: "busy",
      findings: Array.from({ length: 9 }, (_, i) => ({ summary: `F${i}` })),
    }),
  ]);
  assert.match(digest, /\(\+3 more findings — see `mission\.report`\)/);
});

// ── collectMissionFollowups (F7) ───────────────────────────────────────────────────────────────────

test("collectMissionFollowups: dedupes case/whitespace-insensitively and keeps attribution order", () => {
  const followups = collectMissionFollowups([
    report({ agentSessionId: "s1", roleName: "a", openQuestions: ["What drives Q1?", "  what   drives q1? "] }),
    report({ agentSessionId: "s2", roleName: "b", openQuestions: ["What drives Q1?", "Is PY data available?"] }),
  ]);
  assert.deepEqual(
    followups.map((f) => f.question),
    ["What drives Q1?", "Is PY data available?"],
  );
  assert.equal(followups[0]?.agentSessionId, "s1", "first asker wins attribution");
  assert.equal(followups[1]?.roleName, "b");
});

test("collectMissionFollowups: bounded at 24 questions", () => {
  const followups = collectMissionFollowups([
    report({ openQuestions: Array.from({ length: 40 }, (_, i) => `Q${i}?`) }),
  ]);
  assert.equal(followups.length, 24);
});

// ── reconstructMessages folding (F2) ───────────────────────────────────────────────────────────────

const baseAssistant = {
  type: "assistant_message" as const,
  model: "gpt-4o",
  citations: [],
  artifactsTouched: [],
};

test("reconstructMessages: folds mission_digest as an assistant turn and labels the synthesis message", () => {
  const events: HubEvent[] = [
    { type: "user_message", messageId: "u1", text: "run a mission" },
    { ...baseAssistant, messageId: "m1", parts: [{ type: "text", text: "Synthesis answer." }] },
    { type: "mission_synthesis", missionId: "mis1", messageId: "m1", agentReportRefs: ["s1", "s2"] },
    { type: "mission_digest", missionId: "mis1", text: "Mission results digest (2 agent reports) — X." },
    { type: "user_message", messageId: "u2", text: "drill deeper" },
  ];
  const messages = reconstructMessages(events);
  assert.deepEqual(
    messages.map((m) => m.role),
    ["user", "assistant", "assistant", "user"],
  );
  assert.equal(
    messages[1]?.content,
    "[Mission synthesis — composed from 2 agent reports]\nSynthesis answer.",
  );
  assert.equal(messages[2]?.content, "Mission results digest (2 agent reports) — X.");
});

test("reconstructMessages: a session without missions reconstructs exactly as before (no labels, no extra turns)", () => {
  const events: HubEvent[] = [
    { type: "user_message", messageId: "u1", text: "hi" },
    { ...baseAssistant, messageId: "m1", parts: [{ type: "text", text: "hello" }] },
  ];
  const messages = reconstructMessages(events);
  assert.deepEqual(messages, [
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello" },
  ]);
});

// ── buildPlannerSessionContext (F7) ────────────────────────────────────────────────────────────────

test("buildPlannerSessionContext: latest digest + recent turns, current ask excluded", () => {
  const events: HubEvent[] = [
    { type: "user_message", messageId: "u1", text: "first ask" },
    { ...baseAssistant, messageId: "m1", parts: [{ type: "text", text: "first answer" }] },
    { type: "mission_digest", missionId: "mis1", text: "Mission results digest (1 agent report) — old." },
    { type: "mission_digest", missionId: "mis2", text: "Mission results digest (2 agent reports) — new." },
    { type: "user_message", messageId: "u2", text: "investigate the open questions" },
  ];
  const context = buildPlannerSessionContext(events, { currentAsk: "investigate the open questions" });
  assert.match(context, /2 agent reports\) — new\./, "latest digest wins");
  assert.ok(!context.includes("— old."), "only the latest digest is included");
  assert.match(context, /User: first ask/);
  assert.ok(
    !context.includes("investigate the open questions"),
    "the current ask is not duplicated into context",
  );
});

test("buildPlannerSessionContext: empty session yields an empty context (planner gets the bare ask)", () => {
  assert.equal(buildPlannerSessionContext([], { currentAsk: "x" }), "");
});

test("buildPlannerSessionContext: bounded overall", () => {
  const events: HubEvent[] = Array.from({ length: 40 }, (_, i) => ({
    type: "user_message" as const,
    messageId: `u${i}`,
    text: `turn ${i} ${"z".repeat(500)}`,
  }));
  const context = buildPlannerSessionContext(events);
  assert.ok(context.length <= 2_500, `bounded (got ${context.length})`);
});
