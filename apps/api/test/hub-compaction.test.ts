// Assistant Hub (planning/Roadmap/RM-03-assistant-hub/, WP3.3, R-SES8 · R-SK2) — the compaction module, driven by a
// char-as-token stub counter so thresholds are exact + a spy summarizer so ordering ("clear tool outputs
// FIRST, summarize ONLY after") + the "never a loop" guarantee are directly observable.
//
// Proves (per-Acceptance): clear-then-summarize ordering; the visible `compaction` event + persisted
// rolling summary; user-aimable summaries; the honest thrash-stop (no re-summarize loop); invoked skill
// bodies re-attach within the R-SK2 budget; and the CONSTRAINT-RECALL probe — a user constraint stated
// early survives compaction VERBATIM into what the model sees next, even when the summarizer drops it.

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import type { HubEvent, HubSession } from "@mcp-token-footprint/shared";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { HubRepository, type HubEventInput } from "../src/hub/repository.js";
import type { TokenCounter } from "../src/token-counting/types.js";
import {
  assembleSummaryContent,
  coldUserMessages,
  collectReattachableSkills,
  createHubCompactor,
  deterministicHubSummarizer,
  hotBoundarySeq,
  latestCompactionSummary,
  reconstructCompactedHistory,
  summaryToSystemSuffix,
  THRASH_HOT_MESSAGE,
  THRASH_SUMMARY_MESSAGE,
  type HubSummarizer,
} from "../src/hub/compaction.js";

// ── Harness ────────────────────────────────────────────────────────────────────────────────────────

const databases: AppDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function openRepo(): HubRepository {
  const db = new Database(":memory:") as unknown as AppDatabase;
  databases.push(db);
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  return new HubRepository(db);
}

/** A 1-char = 1-token stub counter — makes threshold math exact (contextWindow is measured in chars). */
const charCounter: TokenCounter = {
  id: "char",
  label: "char",
  countText: async (text) => text.length,
  countJson: async (value) => JSON.stringify(value ?? null).length,
  countToolDefinition: async () => {
    throw new Error("unused");
  },
  countResourceDefinition: async () => {
    throw new Error("unused");
  },
  countPromptDefinition: async () => {
    throw new Error("unused");
  },
};

const rep = (ch: string, n: number): string => ch.repeat(n);

type SeededSession = {
  session: HubSession;
  repo: HubRepository;
  events: () => HubEvent[];
  user: (id: string, text: string) => void;
  assistant: (id: string, text: string) => void;
  toolCall: (callId: string, name: string) => void;
  toolResult: (callId: string, modelContent: unknown) => void;
};

function seed(repo: HubRepository, model = "gpt-4o"): SeededSession {
  const session = repo.createSession({ mode: "chat", model });
  const sid = session.id;
  return {
    session,
    repo,
    events: () => repo.listEvents(sid),
    user: (id, text) => void repo.appendEvent(sid, { type: "user_message", messageId: id, text }),
    assistant: (id, text) =>
      void repo.appendEvent(sid, {
        type: "assistant_message",
        messageId: id,
        model,
        parts: [{ type: "text", text }],
        citations: [],
        artifactsTouched: [],
      }),
    toolCall: (callId, name) =>
      void repo.appendEvent(sid, {
        type: "tool_call",
        messageId: "a",
        part: { type: "tool_call", toolCallId: callId, toolName: name, source: "mcp", state: "input-available", args: {} },
      }),
    toolResult: (callId, modelContent) =>
      void repo.appendEvent(sid, {
        type: "tool_result",
        toolCallId: callId,
        state: "output-available",
        modelContent,
      }),
  };
}

/** A `persist` that appends to the repo + collects the settled events (the engine's choke point). */
function collectingPersist(repo: HubRepository, sessionId: string) {
  const collected: HubEvent[] = [];
  const persist = (event: HubEventInput): HubEvent => {
    const settled = repo.appendEvent(sessionId, event);
    collected.push(settled);
    return settled;
  };
  return { persist, collected };
}

function spySummarizer(returns = "NARRATIVE-SUMMARY"): { fn: HubSummarizer; calls: () => number; last: () => Parameters<HubSummarizer>[0] | undefined } {
  let count = 0;
  let lastInput: Parameters<HubSummarizer>[0] | undefined;
  const fn: HubSummarizer = async (input) => {
    count += 1;
    lastInput = input;
    return returns;
  };
  return { fn, calls: () => count, last: () => lastInput };
}

function compactionEvents(events: readonly HubEvent[]) {
  return events.filter((e): e is Extract<HubEvent, { type: "compaction" }> => e.type === "compaction");
}

// ── Pure helpers ─────────────────────────────────────────────────────────────────────────────────

test("hotBoundarySeq keeps the last N user turns hot; null when there is no cold region", () => {
  const repo = openRepo();
  const s = seed(repo);
  s.user("u1", "one");
  s.assistant("a1", "r1");
  s.user("u2", "two");
  s.assistant("a2", "r2");
  s.user("u3", "three");
  s.assistant("a3", "r3");
  const events = s.events();
  const userSeqs = events.filter((e) => e.type === "user_message").map((e) => e.seq);

  // keep last 1 → hot starts at the LAST user message; the first two turns are cold.
  assert.equal(hotBoundarySeq(events, 1, 0), userSeqs[2]);
  // keep last 2 → hot starts at u2.
  assert.equal(hotBoundarySeq(events, 2, 0), userSeqs[1]);
  // keep last 3 (all) → no cold region.
  assert.equal(hotBoundarySeq(events, 3, 0), null);
  // keep last 5 (> turns) → no cold region.
  assert.equal(hotBoundarySeq(events, 5, 0), null);
});

test("coldUserMessages returns every user message up to the boundary, verbatim + in order", () => {
  const repo = openRepo();
  const s = seed(repo);
  s.user("u1", "first constraint");
  s.assistant("a1", "ok");
  s.user("u2", "second");
  const events = s.events();
  const u2Seq = events.find((e) => e.type === "user_message" && (e as { messageId: string }).messageId === "u2")!.seq!;
  assert.deepEqual(coldUserMessages(events, u2Seq), ["first constraint", "second"]);
  const u1Seq = events.find((e) => e.type === "user_message" && (e as { messageId: string }).messageId === "u1")!.seq!;
  assert.deepEqual(coldUserMessages(events, u1Seq), ["first constraint"]);
});

test("assembleSummaryContent always carries a verbatim preserved-user-messages block + optional aim/skills", () => {
  const content = assembleSummaryContent({
    narrative: "did some work",
    preservedUserMessages: ["always answer in French", "use metric units"],
    reattach: ["### skill-a — SKILL.md\nbody"],
    userAim: "keep the deployment rules",
  });
  assert.match(content, /preserved verbatim/i);
  assert.match(content, /always answer in French/);
  assert.match(content, /use metric units/);
  assert.match(content, /Compaction aim: keep the deployment rules/);
  assert.match(content, /Re-attached skill references/);
  assert.match(content, /### skill-a/);
});

test("deterministicHubSummarizer compresses + keeps aim-relevant lines whole", async () => {
  const big = Array.from({ length: 50 }, (_, i) => `Assistant: paragraph ${i} ${rep("x", 40)}.`).join("\n");
  const out = await deterministicHubSummarizer({
    sessionId: "s",
    coldTranscript: `${big}\nAssistant: the DEPLOYMENT plan is finalized and approved.`,
    userMessages: [],
    userAim: "deployment plan",
    targetTokens: 200,
  });
  assert.ok(out.length <= 200 * 4 + 1, "compressed under the target-token budget");
  assert.match(out, /deployment/i, "an aim-relevant line is kept whole");
});

test("reconstructCompactedHistory with no summary is byte-identical to a verbatim reconstruction", () => {
  const repo = openRepo();
  const s = seed(repo);
  s.user("u1", "hi");
  s.assistant("a1", "hello");
  const events = s.events();
  const out = reconstructCompactedHistory(events, undefined);
  assert.equal(out.systemSuffix, undefined);
  assert.deepEqual(out.messages, [
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello" },
  ]);
});

test("collectReattachableSkills re-attaches loaded bodies within the R-SK2 per-skill + total budget", () => {
  const repo = openRepo();
  const s = seed(repo);
  s.toolCall("c1", "skills.load");
  s.toolResult("c1", { skillId: "sk-a", skillName: "Alpha", path: "", tokens: 40, content: "ALPHA-BODY" });
  s.toolCall("c2", "skills.load");
  s.toolResult("c2", { skillId: "sk-b", skillName: "Beta", path: "ref.md", tokens: 40, content: "BETA-BODY" });
  const events = s.events();
  const upto = events[events.length - 1]!.seq!;

  // The total budget (40) is fully spent by the first skill (40 tokens) — the second is dropped.
  const tight = collectReattachableSkills(events, upto, { perSkillTokens: 100, totalTokens: 40 });
  assert.deepEqual(tight.skillIds, ["sk-a"]);
  assert.equal(tight.blocks.length, 1);
  assert.match(tight.blocks[0]!, /Alpha/);
  assert.match(tight.blocks[0]!, /ALPHA-BODY/);

  // A generous budget fits both.
  const loose = collectReattachableSkills(events, upto, { perSkillTokens: 100, totalTokens: 1000 });
  assert.deepEqual(loose.skillIds.sort(), ["sk-a", "sk-b"]);
});

// ── prepareTurn — the compaction pipeline ────────────────────────────────────────────────────────

test("under the threshold: no compaction (ready, verbatim history, no compaction event)", async () => {
  const repo = openRepo();
  const s = seed(repo);
  s.user("u1", "short question");
  s.assistant("a1", "short answer");
  s.user("u2", "another");
  const { persist, collected } = collectingPersist(repo, s.session.id);
  const summ = spySummarizer();

  const compactor = createHubCompactor({
    repository: repo,
    tokenCounter: charCounter,
    summarizer: summ.fn,
    config: { sessionId: s.session.id, contextWindow: 10_000 },
  });
  const out = await compactor.prepareTurn({ events: s.events(), systemText: "SYS", persist });

  assert.equal(out.kind, "ready");
  assert.equal(summ.calls(), 0, "the summarizer is never called under threshold");
  assert.equal(compactionEvents(collected).length, 0, "no compaction event");
  assert.equal(repo.listSessionSummaries(s.session.id).length, 0, "no summary persisted");
});

test("over threshold: CLEARS cold tool outputs FIRST, then summarizes (ordering is observable)", async () => {
  const repo = openRepo();
  const s = seed(repo);
  // Two cold turns whose tool results carry a large, distinctive body that must be cleared BEFORE the
  // summarizer sees the transcript.
  s.user("u1", rep("q", 400));
  s.assistant("a1", rep("A", 400));
  s.toolCall("c1", "mcp__srv__search");
  s.toolResult("c1", { secret: `TOOLBODY-${rep("Z", 2000)}` });
  s.user("u2", rep("q", 400));
  s.assistant("a2", rep("B", 400));
  // Two hot turns (keepRecentTurns=2).
  s.user("u3", "recent one");
  s.assistant("a3", "recent reply one");
  s.user("u4", "recent two");

  const { persist, collected } = collectingPersist(repo, s.session.id);
  const summ = spySummarizer("COMPRESSED-NARRATIVE");
  const compactor = createHubCompactor({
    repository: repo,
    tokenCounter: charCounter,
    summarizer: summ.fn,
    config: { sessionId: s.session.id, contextWindow: 2000, thresholdFraction: 0.5, keepRecentTurns: 2 },
  });

  const out = await compactor.prepareTurn({ events: s.events(), systemText: "SYS", persist });
  assert.equal(out.kind, "ready");

  // Clear-FIRST: the summarizer received the cleared cold transcript — with the tool placeholder, NOT the
  // raw 2000-char tool body.
  assert.equal(summ.calls(), 1, "summarize runs exactly once (no loop)");
  const seen = summ.last()!;
  assert.match(seen.coldTranscript, /output cleared during compaction/);
  assert.ok(!seen.coldTranscript.includes("TOOLBODY-"), "the raw tool body was cleared before summarizing");

  // A visible compaction event + a persisted rolling summary.
  const [evt] = compactionEvents(collected);
  assert.ok(evt, "a compaction event was emitted");
  assert.ok(evt!.clearedToolOutputs >= 1, "at least one cold tool output was cleared");
  assert.ok((evt!.clearedToolOutputTokens ?? 0) > 100, "the cleared tool output tokens are reported");
  assert.ok(evt!.windowAfter < evt!.windowBefore, "the compacted window is smaller");
  assert.match(evt!.summary, /COMPRESSED-NARRATIVE/);
  const summaries = repo.listSessionSummaries(s.session.id);
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0]!.content, evt!.summary);

  // The hot region (u3/a3/u4) stays verbatim in the returned messages.
  if (out.kind === "ready") {
    const joined = out.messages.map((m) => String(m.content)).join(" | ");
    assert.match(joined, /recent one/);
    assert.match(joined, /recent two/);
    assert.ok(!joined.includes("A".repeat(400)), "cold assistant text is no longer verbatim in messages");
    assert.ok(out.systemSuffix && out.systemSuffix.includes("COMPRESSED-NARRATIVE"), "summary rides in the system suffix");
  }
});

test("CONSTRAINT-RECALL probe: an early user constraint survives compaction verbatim — even when the summarizer drops it", async () => {
  const repo = openRepo();
  const s = seed(repo);
  const CONSTRAINT = "IMPORTANT: always respond in French and never use tables.";
  s.user("u1", `${CONSTRAINT} ${rep("q", 600)}`);
  s.assistant("a1", rep("A", 600));
  s.user("u2", rep("q", 600));
  s.assistant("a2", rep("B", 600));
  s.user("u3", "recent");
  s.assistant("a3", "recent reply");
  s.user("u4", "latest");

  const { persist } = collectingPersist(repo, s.session.id);
  // A hostile summarizer that DROPS everything — the preserved block, not the summarizer, must save it.
  const hostile: HubSummarizer = async () => "SUMMARY WITHHELD";
  const compactor = createHubCompactor({
    repository: repo,
    tokenCounter: charCounter,
    summarizer: hostile,
    config: { sessionId: s.session.id, contextWindow: 2400, thresholdFraction: 0.5, keepRecentTurns: 2 },
  });

  const out = await compactor.prepareTurn({ events: s.events(), systemText: "SYS", persist });
  assert.equal(out.kind, "ready");

  // The persisted summary carries the constraint VERBATIM despite the summarizer discarding it.
  const summary = repo.getLatestSessionSummary(s.session.id);
  assert.ok(summary, "a summary was persisted");
  assert.match(summary!.content, /always respond in French and never use tables/);

  // And on the NEXT turn, the constraint is in the system suffix the model will actually see.
  const nextEvents = repo.listEvents(s.session.id);
  const rebuilt = reconstructCompactedHistory(nextEvents, latestCompactionSummary(nextEvents));
  assert.ok(rebuilt.systemSuffix, "the summary is re-injected as prior context");
  assert.match(rebuilt.systemSuffix!, /always respond in French and never use tables/);
});

test("user-aimable: the aim is forwarded to the summarizer + recorded on the compaction event", async () => {
  const repo = openRepo();
  const s = seed(repo);
  s.user("u1", rep("q", 500));
  s.assistant("a1", rep("A", 500));
  s.user("u2", rep("q", 500));
  s.assistant("a2", rep("B", 500));
  s.user("u3", "recent");
  s.assistant("a3", "reply");
  s.user("u4", "latest");

  const { persist, collected } = collectingPersist(repo, s.session.id);
  const summ = spySummarizer();
  const compactor = createHubCompactor({
    repository: repo,
    tokenCounter: charCounter,
    summarizer: summ.fn,
    config: {
      sessionId: s.session.id,
      contextWindow: 2000,
      thresholdFraction: 0.5,
      keepRecentTurns: 2,
      userAim: "keep the pricing decisions",
    },
  });

  await compactor.prepareTurn({ events: s.events(), systemText: "SYS", persist });
  assert.equal(summ.last()?.userAim, "keep the pricing decisions");
  assert.equal(compactionEvents(collected)[0]?.userAim, "keep the pricing decisions");
});

test("skill bodies re-attach (R-SK2) into the compaction summary + reattachedSkillIds", async () => {
  const repo = openRepo();
  const s = seed(repo);
  s.user("u1", rep("q", 500));
  s.assistant("a1", "loading a skill");
  s.toolCall("c1", "skills.load");
  s.toolResult("c1", { skillId: "sk-a", skillName: "DeployGuide", path: "", tokens: 40, content: "DEPLOY-STEPS-BODY" });
  s.user("u2", rep("q", 500));
  s.assistant("a2", rep("B", 400));
  s.user("u3", "recent");
  s.assistant("a3", "reply");
  s.user("u4", "latest");

  const { persist, collected } = collectingPersist(repo, s.session.id);
  const compactor = createHubCompactor({
    repository: repo,
    tokenCounter: charCounter,
    // The summarizer drops everything — the re-attach path (not the summarizer) carries the skill body.
    summarizer: async () => "S",
    config: { sessionId: s.session.id, contextWindow: 1600, thresholdFraction: 0.5, keepRecentTurns: 2 },
  });

  await compactor.prepareTurn({ events: s.events(), systemText: "SYS", persist });
  const [evt] = compactionEvents(collected);
  assert.ok(evt);
  assert.deepEqual(evt!.reattachedSkillIds, ["sk-a"]);
  assert.match(evt!.summary, /DeployGuide/);
  assert.match(evt!.summary, /DEPLOY-STEPS-BODY/);
});

// ── Thrash (R-SES8 — honest stop, never a loop) ────────────────────────────────────────────────────

test("THRASH (no cold region): the recent turns alone exceed the window → honest thrash, summarizer NOT called, nothing persisted", async () => {
  const repo = openRepo();
  const s = seed(repo);
  // A single user turn far larger than the context window — no older turns to compact.
  s.user("u1", rep("x", 5000));

  const { persist, collected } = collectingPersist(repo, s.session.id);
  const summ = spySummarizer();
  const compactor = createHubCompactor({
    repository: repo,
    tokenCounter: charCounter,
    summarizer: summ.fn,
    config: { sessionId: s.session.id, contextWindow: 1000, keepRecentTurns: 4 },
  });

  const out = await compactor.prepareTurn({ events: s.events(), systemText: "SYS", persist });
  assert.equal(out.kind, "thrash");
  if (out.kind === "thrash") assert.equal(out.message, THRASH_HOT_MESSAGE);
  assert.equal(summ.calls(), 0, "no summarization attempted");
  assert.equal(compactionEvents(collected).length, 0, "no compaction persisted");
  assert.equal(repo.listSessionSummaries(s.session.id).length, 0);
});

test("THRASH (after summarizing): a huge HOT turn can't fit even post-summary → thrash, summarizer runs EXACTLY once (no loop)", async () => {
  const repo = openRepo();
  const s = seed(repo);
  // Several cold turns (compactable) …
  s.user("u1", rep("q", 300));
  s.assistant("a1", rep("A", 300));
  s.user("u2", rep("q", 300));
  s.assistant("a2", rep("B", 300));
  // … then a single HOT user turn larger than the whole context window (keepRecentTurns=1).
  s.user("u3", rep("H", 3000));

  const { persist, collected } = collectingPersist(repo, s.session.id);
  const summ = spySummarizer("tiny");
  const compactor = createHubCompactor({
    repository: repo,
    tokenCounter: charCounter,
    summarizer: summ.fn,
    config: { sessionId: s.session.id, contextWindow: 1000, thresholdFraction: 0.5, keepRecentTurns: 1 },
  });

  const out = await compactor.prepareTurn({ events: s.events(), systemText: "SYS", persist });
  assert.equal(out.kind, "thrash");
  if (out.kind === "thrash") assert.equal(out.message, THRASH_SUMMARY_MESSAGE);
  assert.equal(summ.calls(), 1, "summarize ran exactly once — no re-summarize loop");
  assert.equal(compactionEvents(collected).length, 0, "a thrash persists NO summary/event");
  assert.equal(repo.listSessionSummaries(s.session.id).length, 0);
});

// ── Rolling compaction across turns advances the boundary (no cross-turn loop) ─────────────────────

test("summaryToSystemSuffix frames the summary as binding prior context", () => {
  const suffix = summaryToSystemSuffix("SUMMARY");
  assert.match(suffix, /Earlier conversation \(compacted\)/);
  assert.match(suffix, /binding constraints/);
  assert.match(suffix, /SUMMARY/);
});

test("a second compaction folds the prior summary + advances uptoSeq (rolling, not re-summarizing the same region)", async () => {
  const repo = openRepo();
  const s = seed(repo);
  s.user("u1", `keep-this-early-rule ${rep("q", 500)}`);
  s.assistant("a1", rep("A", 500));
  s.user("u2", rep("q", 500));
  s.assistant("a2", rep("B", 500));
  s.user("u3", "recent");
  s.assistant("a3", "reply");
  s.user("u4", "latest");

  const { persist } = collectingPersist(repo, s.session.id);
  // A generous window so BOTH compactions succeed (the point of this test is the boundary ADVANCING, not
  // a thrash): threshold 2000 triggers on the accumulated text, hard limit 4000 leaves room post-summary.
  const compactor = createHubCompactor({
    repository: repo,
    tokenCounter: charCounter,
    summarizer: async (i) => `SUM(${i.coldTranscript.length})`,
    config: { sessionId: s.session.id, contextWindow: 4000, thresholdFraction: 0.5, keepRecentTurns: 2 },
  });
  await compactor.prepareTurn({ events: s.events(), systemText: "SYS", persist });
  const firstUpto = latestCompactionSummary(repo.listEvents(s.session.id))!.uptoSeq;

  // Add more turns that push it over again.
  s.assistant("a4", rep("C", 500));
  s.user("u5", rep("q", 500));
  s.assistant("a5", rep("D", 500));
  s.user("u6", "newest");

  const compactor2 = createHubCompactor({
    repository: repo,
    tokenCounter: charCounter,
    summarizer: async (i) => `SUM(${i.coldTranscript.length})`,
    config: { sessionId: s.session.id, contextWindow: 4000, thresholdFraction: 0.5, keepRecentTurns: 2 },
  });
  await compactor2.prepareTurn({ events: s.events(), systemText: "SYS", persist });
  const secondUpto = latestCompactionSummary(repo.listEvents(s.session.id))!.uptoSeq;

  assert.ok(secondUpto > firstUpto, "the compaction boundary advances (rolling, not stuck)");
  // The early rule still survives after two compactions (preserved verbatim across the fold).
  const finalSummary = repo.getLatestSessionSummary(s.session.id)!;
  assert.match(finalSummary.content, /keep-this-early-rule/);
});
