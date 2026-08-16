import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import {
  CLAUDE_CLI_PROVIDER_ID,
  CLUSTER_KEY_VERSION,
  ISSUE_ASSIST_STATE_KEY,
  type IssueAssistState,
  type JudgeSettings,
  type RatingIssue,
} from "@mcp-token-footprint/shared";
import { type AppDatabase, applyMigrations } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { AppSettingsRepository } from "../src/grading/app-settings-repository.js";
import {
  buildAssistPrompt,
  groupId,
  IssueAssistService,
  type IssueAssistServiceDeps,
  IssueAssistStore,
  pickPrimary,
} from "../src/grading/issue-assist.js";
import { type FleetIssueInsert, RatingIssueRepository } from "../src/grading/issue-repository.js";
import type { JudgeGenerate, JudgeGenerateResult } from "../src/grading/judge.js";
import { AsyncSemaphore } from "../src/testing/subscription-concurrency.js";

// LLM assist for issue clustering (Observability WP5.2, D-OB20, OPT-IN). Everything here is offline:
// the judge is an injected FAKE (no provider/CLI is EVER contacted), and the DB is in-memory. The
// deterministic fleet clusters (WP5.1) are the substrate — the assist only ADDS a reversible overlay.

const NOW = "2026-07-16T00:00:00.000Z";
const PRICED_MODEL = "claude-sonnet-4"; // in the pricing table → isModelPriced true

const databases: AppDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function createDatabase(): AppDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  databases.push(db);
  return db;
}

function makeParts(db: AppDatabase): { repo: RatingIssueRepository; store: IssueAssistStore } {
  return { repo: new RatingIssueRepository(db), store: new IssueAssistStore(new AppSettingsRepository(db)) };
}

type Opts = {
  judge?: JudgeSettings | null;
  generate?: JudgeGenerate;
  gate?: IssueAssistServiceDeps["gate"];
  enabledAfterSweep?: boolean;
};

function makeService(repo: RatingIssueRepository, store: IssueAssistStore, opts: Opts = {}): IssueAssistService {
  return new IssueAssistService({
    issues: repo,
    store,
    resolveJudge: () => opts.judge ?? null,
    generate:
      opts.generate ??
      (async () => {
        throw new Error("generate must not be called in this test");
      }),
    ...(opts.gate ? { gate: opts.gate } : {}),
    ...(opts.enabledAfterSweep !== undefined ? { enabledAfterSweep: opts.enabledAfterSweep } : {}),
    now: () => Date.parse(NOW),
  });
}

// ── Fixtures ───────────────────────────────────────────────────────────────────────────────────────

let seq = 0;
/** Insert a real deterministically-clustered FLEET issue (via the WP5.1 repository path). */
function insertFleet(
  repo: RatingIssueRepository,
  over: Partial<FleetIssueInsert> & { targetId: string; runId?: string } = { targetId: "srv-1" },
): RatingIssue {
  seq += 1;
  const clusterKey =
    over.clusterKey ?? `v${CLUSTER_KEY_VERSION} | mcp_server | mcp_server:${over.targetId} | tool_${seq} | sig ${seq}`;
  const insert: FleetIssueInsert = {
    clusterKey,
    clusterKeyVersion: CLUSTER_KEY_VERSION,
    targetKind: over.targetKind ?? "mcp_server",
    targetId: over.targetId,
    targetName: over.targetName ?? `Server ${over.targetId}`,
    title: over.title ?? `Recurring mcp server on ${over.targetId} — tool_${seq}`,
    summary: over.summary ?? `A recurring failed_tool_call clustered across runs on ${over.targetId}.`,
    bucket: over.bucket ?? "mcp_server",
    fixTarget: over.fixTarget ?? "mcp_server",
    draftFix: over.draftFix ?? "deterministic drafted fix",
    severity: over.severity ?? "medium",
    ratingVersion: 1,
    affected: over.affected ?? { servers: [over.targetId], skills: [], tests: [], models: [] },
    occurrence: over.occurrence ?? {
      runId: over.runId ?? `run-${seq}`,
      findingDigest: `dig-${seq}`,
      category: "failed_tool_call",
      message: `tool call failed on ${over.targetId}`,
      toolName: `tool_${seq}`,
      errorMessage: `limit must be an integer (${seq})`,
    },
    observedAt: over.observedAt ?? NOW,
  };
  return repo.insertFleetIssue(insert);
}

const providerJudge: JudgeSettings = { providerCredentialId: "prov-1", model: PRICED_MODEL };
const cliJudge: JudgeSettings = { providerCredentialId: CLAUDE_CLI_PROVIDER_ID, model: "claude-sonnet-4-5" };

/** A judge `generate` FAKE returning fixed JSON (or a raw string), recording calls + last prompt. */
function fakeJudge(
  response: unknown,
  opts: { usage?: { inputTokens: number; outputTokens: number }; provenance?: Partial<JudgeGenerateResult> } = {},
): { generate: JudgeGenerate; calls: () => number; lastPrompt: () => string } {
  let calls = 0;
  let lastPrompt = "";
  const generate: JudgeGenerate = async (_settings, prompt) => {
    calls += 1;
    lastPrompt = prompt;
    return {
      text: typeof response === "string" ? response : JSON.stringify(response),
      usage: opts.usage ?? { inputTokens: 100, outputTokens: 20 },
      ...opts.provenance,
    };
  };
  return { generate, calls: () => calls, lastPrompt: () => lastPrompt };
}

// ── (1) Merge applies + unmerge restores; aiAssisted stamped; priority NEVER auto-applies ────────────

test("merge applies as a reversible link; aiAssisted stamped; suggested priority never auto-applies", async () => {
  const db = createDatabase();
  const { repo, store } = makeParts(db);
  const a = insertFleet(repo, { targetId: "srv-1", severity: "low", title: "det A", summary: "det summary A" });
  const b = insertFleet(repo, { targetId: "srv-1", severity: "medium", title: "det B", summary: "det summary B" });
  const service = makeService(repo, store, {
    judge: providerJudge,
    generate: fakeJudge({
      groups: [
        {
          issueIds: [a.id, b.id],
          title: "search rejects a string limit",
          summary: "Two clusters are the same root cause.",
          suggestedPriority: "high",
          rationale: "identical failing tool + error",
        },
      ],
    }).generate,
  });

  const res = await service.refineList();
  assert.equal(res.ran, true, "the pass ran");
  assert.equal(res.applied.length, 1, "one merge group applied");
  const group = res.applied[0];
  if (!group) throw new Error("expected a group");
  assert.deepEqual(group.issueIds, [a.id, b.id].sort(), "both issues merged (sorted)");
  assert.ok([a.id, b.id].includes(group.primaryIssueId), "primary is one of the members");
  assert.equal(group.aiAssisted, true, "AI-written text is MARKED aiAssisted");
  assert.equal(group.model, PRICED_MODEL, "the judge model is stamped");
  assert.equal(group.title, "search rejects a string limit", "AI title applied");
  assert.equal(group.suggestedPriority, "high", "priority is SUGGESTED on the overlay");
  assert.equal(group.assistedAt, NOW, "assistedAt stamped from the injected clock");

  // The DETERMINISTIC issue rows are UNTOUCHED — the suggested priority did NOT auto-apply, and the
  // deterministic title/summary are retained.
  const aAfter = repo.get(a.id);
  assert.equal(aAfter.severity, "low", "suggested priority NEVER auto-applies to severity");
  assert.equal(aAfter.title, "det A", "deterministic title retained on the row");
  assert.equal(aAfter.summary, "det summary A", "deterministic summary retained on the row");
  assert.ok(aAfter.fleet, "still a fleet issue (cluster key keeps accruing underneath)");
  assert.equal(repo.get(b.id).severity, "medium", "the other member's severity is also untouched");

  // The overlay is persisted + readable for the settings surface.
  assert.equal(service.getState().groups.length, 1, "one applied group persisted");

  // UNMERGE restores the originals (which were never mutated).
  const undo = service.unmerge(group.id);
  assert.equal(undo.removed.id, group.id, "the group is returned");
  assert.deepEqual(undo.restoredIssueIds.sort(), [a.id, b.id].sort(), "both member ids restored");
  assert.equal(service.getState().groups.length, 0, "the overlay group is gone");
  assert.equal(repo.get(a.id).title, "det A", "the deterministic row is intact after unmerge");
  assert.equal(repo.get(a.id).severity, "low", "and its severity is intact after unmerge");
});

test("unmerge on an unknown group id throws a typed 404", () => {
  const db = createDatabase();
  const { repo, store } = makeParts(db);
  const service = makeService(repo, store, { judge: providerJudge });
  assert.throws(() => service.unmerge("nope"), /not found/);
});

// ── (2) Chain fallback + skip behavior per the judge-chain contract ──────────────────────────────────

test("no judge resolvable → skip (no generate, nothing applied)", async () => {
  const db = createDatabase();
  const { repo, store } = makeParts(db);
  insertFleet(repo, { targetId: "srv-1" });
  const res = await makeService(repo, store, { judge: null }).refineList();
  assert.equal(res.ran, false, "did not run");
  assert.match(res.skipReason ?? "", /no judge is available/);
  assert.equal(res.applied.length, 0);
});

test("unpriced PROVIDER judge model → skip (CLI subscription would be exempt)", async () => {
  const db = createDatabase();
  const { repo, store } = makeParts(db);
  insertFleet(repo, { targetId: "srv-1" });
  const service = makeService(repo, store, {
    judge: { providerCredentialId: "prov-1", model: "totally-unpriced-model" },
    generate: fakeJudge({ groups: [] }).generate,
  });
  const res = await service.refineList();
  assert.equal(res.ran, false, "unpriced provider model is refused (no uncapped spend)");
  assert.match(res.skipReason ?? "", /no known pricing/);
});

test("judge call throws (chain exhausted its fallback) → skip, no state change, no cost", async () => {
  const db = createDatabase();
  const { repo, store } = makeParts(db);
  insertFleet(repo, { targetId: "srv-1" });
  const throwing: JudgeGenerate = async () => {
    throw new Error("chain: CLI auth failed and no provider configured");
  };
  const service = makeService(repo, store, { judge: cliJudge, generate: throwing });
  const res = await service.refineList();
  assert.equal(res.ran, false, "a failed call degrades to a skip");
  assert.equal(res.cost, null, "no usage → nothing recorded to the ledger");
  assert.equal(service.getState().ledger.calls, 0, "ledger untouched on a failed call");
});

test("malformed (schema-invalid) judge response degrades SAFELY — no group, but cost recorded", async () => {
  const db = createDatabase();
  const { repo, store } = makeParts(db);
  insertFleet(repo, { targetId: "srv-1" });
  const service = makeService(repo, store, {
    judge: providerJudge,
    // Missing the required `title`/`summary`/`suggestedPriority` → zod-invalid.
    generate: fakeJudge({ groups: [{ issueIds: ["x"] }] }).generate,
  });
  const res = await service.refineList();
  assert.equal(res.ran, true, "a judge DID run");
  assert.equal(res.applied.length, 0, "a malformed response corrupts nothing (no group applied)");
  assert.match(res.skipReason ?? "", /malformed/);
  assert.equal(service.getState().ledger.calls, 1, "the spent call is still recorded honestly");
  assert.equal(service.getState().groups.length, 0, "no group applied");
});

test("an invented member id (not among the shown candidates) is DROPPED", async () => {
  const db = createDatabase();
  const { repo, store } = makeParts(db);
  const a = insertFleet(repo, { targetId: "srv-1" });
  const service = makeService(repo, store, {
    judge: providerJudge,
    generate: fakeJudge({
      groups: [
        {
          issueIds: [a.id, "made-up-id-999"],
          title: "one real one fake",
          summary: "the fake id must be dropped",
          suggestedPriority: "medium",
          rationale: "trust only shown ids",
        },
      ],
    }).generate,
  });
  const res = await service.refineList();
  const group = res.applied[0];
  if (!group) throw new Error("expected a group");
  assert.deepEqual(group.issueIds, [a.id], "the invented id was dropped; only the real member remains");
});

// ── (3) OWN semaphore isolation (busy judge gate ≠ assist blocked, and vice-versa) ───────────────────

test("own semaphore gates assist passes AND is isolated from a foreign (judge) gate", async () => {
  const db = createDatabase();
  const { repo, store } = makeParts(db);
  insertFleet(repo, { targetId: "srv-1" });
  const ownGate = new AsyncSemaphore(1);
  const foreignGate = new AsyncSemaphore(1); // stands in for the CLI-judge / shared budget

  // (a) The foreign gate is FULLY BUSY, yet the assist proceeds — it draws ONLY on its own gate.
  await foreignGate.acquire();
  assert.equal(foreignGate.willQueue, true, "foreign (judge) gate is saturated");
  const service = makeService(repo, store, {
    judge: providerJudge,
    gate: ownGate,
    generate: fakeJudge({ groups: [] }).generate,
  });
  const res = await service.refineList();
  assert.equal(res.ran, true, "a busy judge gate does NOT block the assist (own gate only)");
  assert.equal(foreignGate.willQueue, true, "and the assist never touched the foreign gate");
  foreignGate.release();

  // (b) The assist WAITS on its OWN gate: hold its only permit and a refine parks at acquire (generate
  // is not reached) until the permit is freed — proving the pass respects ITS gate, not the judge's.
  await ownGate.acquire();
  let generateCalled = false;
  const gen: JudgeGenerate = async () => {
    generateCalled = true;
    return { text: JSON.stringify({ groups: [] }), usage: { inputTokens: 1, outputTokens: 1 } };
  };
  const service2 = makeService(repo, store, { judge: providerJudge, gate: ownGate, generate: gen });
  const pending = service2.refineList();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(generateCalled, false, "blocked on the OWN gate → the judge call was not reached");
  assert.equal(foreignGate.willQueue, false, "the busy assist did NOT touch the foreign (judge) gate");
  ownGate.release();
  const res2 = await pending;
  assert.equal(generateCalled, true, "once the own permit frees, the pass proceeds");
  assert.equal(res2.ran, true);
});

// ── (4) Cost lands in the SEPARATE assist judge ledger (B5) ──────────────────────────────────────────

test("provider judge cost is accrued to the separate assist ledger", async () => {
  const db = createDatabase();
  const { repo, store } = makeParts(db);
  insertFleet(repo, { targetId: "srv-1" });
  const service = makeService(repo, store, {
    judge: providerJudge,
    generate: fakeJudge({ groups: [] }, { usage: { inputTokens: 250, outputTokens: 40 } }).generate,
  });
  const res = await service.refineList();
  assert.ok(res.cost, "a cost delta is reported");
  assert.equal(res.cost?.tokensIn, 250);
  assert.equal(res.cost?.tokensOut, 40);
  assert.ok((res.cost?.costUsd ?? 0) > 0, "a priced provider model has a positive estimated cost");
  const ledger = service.getState().ledger;
  assert.equal(ledger.calls, 1);
  assert.equal(ledger.tokensIn, 250);
  assert.equal(ledger.tokensOut, 40);
  assert.ok(ledger.costUsd > 0, "cost accrued to the ledger");
  assert.equal(ledger.lastModel, PRICED_MODEL);
  assert.equal(ledger.lastProviderId, "prov-1");
  assert.equal(ledger.lastAt, NOW);
});

test("CLI (subscription) provenance records real tokens at cost 0 (AR13)", async () => {
  const db = createDatabase();
  const { repo, store } = makeParts(db);
  insertFleet(repo, { targetId: "srv-1" });
  const service = makeService(repo, store, {
    judge: cliJudge,
    // The chain stamps CLI provenance: provider claude_cli + cost 0 (real tokens).
    generate: fakeJudge(
      { groups: [] },
      {
        usage: { inputTokens: 300, outputTokens: 30 },
        provenance: { judgeProviderId: CLAUDE_CLI_PROVIDER_ID, judgeModel: "claude-sonnet-4-5", judgeCostUsd: 0 },
      },
    ).generate,
  });
  const res = await service.refineList();
  assert.equal(res.cost?.costUsd, 0, "CLI subscription → cost 0");
  assert.equal(res.cost?.tokensIn, 300, "but real tokens are recorded");
  const ledger = service.getState().ledger;
  assert.equal(ledger.costUsd, 0);
  assert.equal(ledger.tokensIn, 300);
  assert.equal(ledger.lastProviderId, CLAUDE_CLI_PROVIDER_ID);
});

// ── (5) Default OFF; sweep UNAFFECTED when assist errors (isolation) ─────────────────────────────────

test("maybeRunAfterSweep is a NO-OP by default (OFF) — no judge call", async () => {
  const db = createDatabase();
  const { repo, store } = makeParts(db);
  insertFleet(repo, { targetId: "srv-1" });
  const gen = fakeJudge({ groups: [] });
  const res = await makeService(repo, store, { judge: providerJudge, generate: gen.generate }).maybeRunAfterSweep();
  assert.equal(res.ran, false, "assist-after-sweep is OFF by default");
  assert.match(res.skipReason ?? "", /disabled/);
  assert.equal(gen.calls(), 0, "the judge is never called when assist-after-sweep is off");
});

test("maybeRunAfterSweep runs when ENABLED", async () => {
  const db = createDatabase();
  const { repo, store } = makeParts(db);
  insertFleet(repo, { targetId: "srv-1" });
  const gen = fakeJudge({ groups: [] });
  const service = makeService(repo, store, { judge: providerJudge, generate: gen.generate, enabledAfterSweep: true });
  const res = await service.maybeRunAfterSweep();
  assert.equal(res.ran, true, "the pass runs when enabled after a sweep");
  assert.equal(gen.calls(), 1, "exactly one judge call");
});

test("an assist error is ISOLATED — maybeRunAfterSweep never throws (the sweep is unaffected)", async () => {
  const db = createDatabase();
  const { repo, store } = makeParts(db);
  insertFleet(repo, { targetId: "srv-1" });
  const gen = fakeJudge({ groups: [] });
  const service = makeService(repo, store, { judge: providerJudge, generate: gen.generate, enabledAfterSweep: true });
  // Force an error BEFORE the guarded judge call (openFleetIssues → repo.listAll) — the outer guard in
  // maybeRunAfterSweep must swallow it so the deterministic sweep can never be broken by the assist.
  repo.listAll = () => {
    throw new Error("boom: overlay read failure");
  };
  let threw = false;
  let res: Awaited<ReturnType<IssueAssistService["maybeRunAfterSweep"]>> | undefined;
  try {
    res = await service.maybeRunAfterSweep();
  } catch {
    threw = true;
  }
  assert.equal(threw, false, "maybeRunAfterSweep never throws — the sweep is unaffected by an assist error");
  assert.equal(res?.ran, false, "it degrades to a skip");
  assert.match(res?.skipReason ?? "", /isolated from the sweep/);
});

// ── (6) A per-run (non-fleet) issue is not refinable; no open fleet issues → skip ────────────────────

test("refineList with no open fleet issues → skip (no judge call)", async () => {
  const db = createDatabase();
  const { repo, store } = makeParts(db);
  const gen = fakeJudge({ groups: [] });
  const res = await makeService(repo, store, { judge: providerJudge, generate: gen.generate }).refineList();
  assert.equal(res.ran, false);
  assert.match(res.skipReason ?? "", /no open fleet issues/);
  assert.equal(gen.calls(), 0, "no candidates → the judge is never called");
});

// ── (7) Pure helpers ─────────────────────────────────────────────────────────────────────────────────

test("groupId is deterministic + order-independent (stable unmerge id across re-refine)", () => {
  assert.equal(groupId(["a", "b"]), groupId(["a", "b"]), "same members → same id");
  assert.notEqual(groupId(["a", "b"]), groupId(["a", "c"]), "different members → different id");
});

test("pickPrimary prefers the most-occurring cluster (tie → earliest first-seen)", () => {
  const mk = (id: string, occ: number, firstSeen: string): RatingIssue =>
    ({
      id,
      timesSeen: occ,
      firstSeenAt: firstSeen,
      fleet: { occurrenceCount: occ, firstSeenAt: firstSeen },
    }) as unknown as RatingIssue;
  assert.equal(pickPrimary([mk("a", 2, "2026-01-02"), mk("b", 5, "2026-01-03")]), "b", "most occurrences wins");
  assert.equal(pickPrimary([mk("a", 3, "2026-01-05"), mk("b", 3, "2026-01-01")]), "b", "tie → earliest first-seen");
});

test("buildAssistPrompt names the shown issues + forbids cross-target merges", () => {
  const db = createDatabase();
  const { repo } = makeParts(db);
  const a = insertFleet(repo, { targetId: "srv-1" });
  const prompt = buildAssistPrompt([a]);
  assert.match(prompt, new RegExp(a.id), "the issue id is in the prompt");
  assert.match(prompt, /DIFFERENT targets are NEVER the same problem/, "cross-target merge is forbidden");
  assert.match(prompt, /ONLY a raw JSON object/, "schema-constrained output contract");
});

// ── (8) Overlay store defensive read ─────────────────────────────────────────────────────────────────

test("IssueAssistStore repairs a corrupt/absent overlay to the empty state", () => {
  const db = createDatabase();
  const settings = new AppSettingsRepository(db);
  const store = new IssueAssistStore(settings);
  assert.deepEqual(store.read().groups, [], "absent → empty groups");
  assert.equal(store.read().ledger.calls, 0, "absent → empty ledger");
  // A malformed persisted document is repaired, not thrown.
  settings.put(ISSUE_ASSIST_STATE_KEY, { groups: "not-an-array", ledger: 42 });
  const repaired: IssueAssistState = store.read();
  assert.deepEqual(repaired.groups, []);
  assert.equal(repaired.ledger.calls, 0);
});
