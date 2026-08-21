// Observability RM-17 Phase 6 · AM-OB11 — the typed GitHub Actions `workflow_dispatch` watch action.
//
// Proves (acceptance):
//   1. A rule carries a `workflow_dispatch` action naming owner/repo/workflow/ref + optional inputs
//      and round-trips through `watch_rules` UNCHANGED (the stored blob is re-validated on read).
//   2. It fires from BOTH an on-terminal rule and a WINDOWED one — specifically, it is NOT caught by
//      `actions.ts`'s "requires a run; not applicable to a windowed rule" default.
//   3. The dispatcher is injected through `WatchActionServices` and NO test makes a real GitHub call:
//      proved at RUNTIME by replacing `globalThis.fetch` with a throwing stub for the duration of a
//      dispatch, and by a source walk over the module.
//   4. NO CREDENTIAL, URL or input value appears in a result, an error, or a persisted audit row —
//      proved by seeding a recognisable token + a recognisable input value, having GitHub's stub
//      echo BOTH back in a 403 body, and grepping every returned and persisted surface for them.
//      The same test asserts the token DID reach the Authorization header, so the absence is a real
//      redaction rather than a token that was never used.
//   5. A missing GitHub account, and an unauthorised one, produce a readable non-leaking failure AND
//      a recorded audit event — never a silent no-op.
//   6. An invalid target (a hand-edited `actions_json` row the wire schema never saw) is refused
//      BEFORE any request — the injected fetch is never called — and the wire schema rejects the
//      same shapes with a ZodError.
//   7. The request GitHub receives is exactly one POST to the one blessed URL, carrying `ref` and
//      the configured inputs and NOTHING else (no run/window context — GitHub 422s an undeclared
//      input, so there is deliberately none to append).
//
// Nothing here touches the network, a real credential store, or `apps/api/src/db/**`.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import {
  GITHUB_API_ORIGIN,
  validateWorkflowDispatchTarget,
  watchActionInputSchema,
  watchRuleInputSchema,
  workflowDispatchUrl,
  type WatchAction,
  type WatchWorkflowDispatchTarget,
} from "@mcp-token-footprint/shared";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import {
  executeWatchAction,
  executeWatchWindowAction,
  type WatchActionServices,
  type WatchRunSummaryView,
  type WatchWindowSummaryView,
} from "../src/watch/actions.js";
import { dispatchGithubWorkflow } from "../src/watch/github-dispatch.js";
import { WatchEngine } from "../src/watch/engine.js";
import { WatchRuleRepository } from "../src/watch/repository.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";

const NOW = "2026-08-21T00:00:00.000Z";

/** A token shaped like a real GitHub PAT and unmistakable in a grep. */
const SEEDED_TOKEN = "ghp_AM_OB11_SEEDED_CREDENTIAL_0123456789abcdef";
/** An input VALUE the operator configured. Distinct from the token so a leak of either is named. */
const SEEDED_INPUT_VALUE = "AM-OB11-SEEDED-INPUT-VALUE-do-not-echo";

const TARGET: WatchWorkflowDispatchTarget = {
  owner: "acme-labs",
  repo: "workbench",
  workflow: "nightly.yml",
  ref: "main",
  inputs: { suite_id: SEEDED_INPUT_VALUE },
};

const databases: AppDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function openFresh(): AppDatabase {
  const db: AppDatabase = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  databases.push(db);
  return db;
}

function baseGraph(db: AppDatabase): void {
  db.prepare(
    "INSERT INTO provider_credentials (id, kind, label, created_at, updated_at) VALUES ('prov','anthropic','Claude',@now,@now)",
  ).run({ now: NOW });
  db.prepare(
    "INSERT INTO scenarios (id, name, provider_id, model, created_at, updated_at) VALUES ('scn','S','prov','claude-sonnet-4',@now,@now)",
  ).run({ now: NOW });
  db.prepare(
    "INSERT INTO tests (id, name, user_prompt, created_at, updated_at) VALUES ('t','T','go',@now,@now)",
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO runs (id, test_id, scenario_id, mode, status, outcome, started_at,
       tokens_in, tokens_out, cost_usd, turns, active_duration_ms, total_duration_ms, capabilities_json)
     VALUES ('run1','t','scn','automated','completed','completed',@now, 0, 0, 0, 0, 1000, 1000, NULL)`,
  ).run({ now: NOW });
}

function repository(db: AppDatabase): WatchRuleRepository {
  return new WatchRuleRepository(db, new SecretStore(crypto.randomBytes(32)));
}

/** One recorded outbound request (never sent anywhere). */
type Capture = { url: string; init: RequestInit };

/** A fetch stub that records every call and answers with the given status/body. */
function recordingFetch(
  captures: Capture[],
  respond: (call: number) => { status: number; body?: string },
): typeof fetch {
  return (async (url: string | URL, init?: RequestInit) => {
    captures.push({ url: String(url), init: init ?? {} });
    const { status, body } = respond(captures.length);
    return new Response(body ?? null, { status });
  }) as unknown as typeof fetch;
}

/** The action-services stub. Every non-dispatch member throws — this suite is about ONE action. */
function services(overrides: Partial<WatchActionServices> = {}): WatchActionServices {
  return {
    pinRun: () => {
      throw new Error("pinRun must not be called");
    },
    addRunToCollection: () => {
      throw new Error("addRunToCollection must not be called");
    },
    promoteRunToTest: () => {
      throw new Error("promoteRunToTest must not be called");
    },
    runGrader: async () => {
      throw new Error("runGrader must not be called");
    },
    resolveWebhookUrl: () => undefined,
    dispatchWorkflow: async () => {
      throw new Error("dispatchWorkflow stub not configured for this test");
    },
    ...overrides,
  };
}

const RUN_VIEW: WatchRunSummaryView = {
  id: "run1",
  status: "completed",
  outcome: "completed",
  scenarioId: "scn",
  testId: "t",
  costUsd: 0,
  tokensIn: 0,
  tokensOut: 0,
  startedAt: NOW,
};

const WINDOW_VIEW: WatchWindowSummaryView = {
  ruleId: "rule1",
  ruleName: "Nightly regression",
  measure: "errorRate",
  op: ">=",
  threshold: 0.3,
  window: "6h",
  windowStart: "2026-08-21T00:00:00.000Z",
  windowEnd: "2026-08-21T06:00:00.000Z",
  value: 0.5,
  late: false,
};

// ═══ (1) Round-trip ═══════════════════════════════════════════════════════════════════════════════

test("AM-OB11 — a workflow_dispatch action round-trips through watch_rules unchanged", () => {
  const db = openFresh();
  const repo = repository(db);

  const created = repo.create({
    name: "Regression → CI",
    trigger: "on_terminal",
    filter: {},
    actions: [{ type: "workflow_dispatch", ...TARGET }],
  });

  const reread = repo.get(created.id);
  assert.deepEqual(
    reread.actions,
    [{ type: "workflow_dispatch", ...TARGET }],
    "the stored action re-reads byte-identical, inputs included",
  );

  // And it carries NO secret handle at all — unlike `webhook`, there is nothing to swap for a ref.
  const stored = db
    .prepare("SELECT actions_json FROM watch_rules WHERE id = ?")
    .get(created.id) as {
    actions_json: string;
  };
  assert.equal(JSON.parse(stored.actions_json)[0].secretRef, undefined);
  const secretRows = db
    .prepare("SELECT COUNT(*) AS n FROM watch_secrets WHERE rule_id = ?")
    .get(created.id) as { n: number };
  assert.equal(secretRows.n, 0, "a workflow_dispatch action mints no watch_secrets row");
});

test("AM-OB11 — the wire accepts exactly what storage returns (one factory, both unions)", () => {
  const action = { type: "workflow_dispatch" as const, ...TARGET };
  assert.deepEqual(watchActionInputSchema.parse(action), action);
  const rule = watchRuleInputSchema.parse({
    name: "R",
    trigger: "on_terminal",
    filter: {},
    actions: [action],
  });
  assert.deepEqual(rule.actions, [action]);
});

// ═══ (2) BOTH switches ════════════════════════════════════════════════════════════════════════════

test("AM-OB11 — the action fires from an ON-TERMINAL rule", async () => {
  const seen: WatchWorkflowDispatchTarget[] = [];
  const result = await executeWatchAction(
    { type: "workflow_dispatch", ...TARGET },
    { runId: "run1", run: RUN_VIEW },
    services({
      dispatchWorkflow: async (target) => {
        seen.push(target);
        return { ok: true, detail: "dispatched" };
      },
    }),
  );
  assert.equal(result.ok, true);
  assert.deepEqual(seen, [TARGET]);
});

test("AM-OB11 — the action fires from a WINDOWED rule and is NOT caught by the 'requires a run' default", async () => {
  const seen: WatchWorkflowDispatchTarget[] = [];
  const result = await executeWatchWindowAction(
    { type: "workflow_dispatch", ...TARGET },
    { window: WINDOW_VIEW },
    services({
      dispatchWorkflow: async (target) => {
        seen.push(target);
        return { ok: true, detail: "dispatched" };
      },
    }),
  );

  assert.deepEqual(seen, [TARGET], "the windowed switch reached the dispatcher");
  assert.equal(result.ok, true);
  assert.doesNotMatch(
    result.error ?? "",
    /requires a run/,
    "a regression detected over a window is exactly when CI should re-run — this action must never fall into the not-applicable default",
  );

  // The contrast: a genuinely run-scoped action still DOES fall into that default.
  const pinned = await executeWatchWindowAction(
    { type: "pin" },
    { window: WINDOW_VIEW },
    services(),
  );
  assert.equal(pinned.ok, false);
  assert.match(pinned.error ?? "", /requires a run/);
});

// ═══ (3) Injected — no real GitHub call ═══════════════════════════════════════════════════════════

test("AM-OB11 — the dispatcher NEVER touches global fetch when one is injected", async () => {
  const captures: Capture[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error("a test reached the REAL network");
  }) as unknown as typeof fetch;
  try {
    const result = await dispatchGithubWorkflow(TARGET, {
      token: () => SEEDED_TOKEN,
      fetchImpl: recordingFetch(captures, () => ({ status: 204 })),
    });
    assert.equal(result.ok, true);
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(captures.length, 1);
});

test("AM-OB11 — source walk: the sender hard-codes no host and the suite names none", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const sender = fs.readFileSync(
    path.join(here, "..", "src", "watch", "github-dispatch.ts"),
    "utf8",
  );
  assert.equal(
    /https?:\/\//.test(sender),
    false,
    "the sender builds its URL only through the shared `workflowDispatchUrl` — no host literal lives here",
  );
  const suite = fs.readFileSync(fileURLToPath(import.meta.url), "utf8");
  // The one mention of the host in this file is the constant it imports, never a literal URL.
  assert.equal(
    /https?:\/\/api\.github\.com/.test(suite),
    false,
    "no test points anything at the real GitHub host",
  );
});

// ═══ (7) The request shape ════════════════════════════════════════════════════════════════════════

test("AM-OB11 — one POST, to the one blessed URL, carrying ref + inputs and nothing else", async () => {
  const captures: Capture[] = [];
  await dispatchGithubWorkflow(TARGET, {
    token: () => SEEDED_TOKEN,
    fetchImpl: recordingFetch(captures, () => ({ status: 204 })),
  });

  assert.equal(captures.length, 1, "one attempt — no retry, matching the webhook's failure model");
  const call = captures[0]!;
  assert.equal(
    call.url,
    `${GITHUB_API_ORIGIN}/repos/acme-labs/workbench/actions/workflows/nightly.yml/dispatches`,
  );
  assert.equal(call.init.method, "POST");
  assert.deepEqual(
    JSON.parse(String(call.init.body)),
    { ref: "main", inputs: { suite_id: SEEDED_INPUT_VALUE } },
    "GitHub 422s an undeclared input, so NO run/window context is appended — exactly what the operator configured is sent",
  );
});

test("AM-OB11 — the URL builder is the only path, and it refuses rather than emitting", () => {
  assert.equal(
    workflowDispatchUrl({ owner: "o", repo: "r", workflow: "w.yml", ref: "main" }),
    `${GITHUB_API_ORIGIN}/repos/o/r/actions/workflows/w.yml/dispatches`,
  );
  assert.throws(() =>
    workflowDispatchUrl({ owner: "o", repo: "../../evil", workflow: "w.yml", ref: "main" }),
  );
});

// ═══ (4) THE SECURITY PROBE ═══════════════════════════════════════════════════════════════════════

test("AM-OB11 — no credential and no input value reaches a result, an error, or an audit row", async () => {
  const db = openFresh();
  const repo = repository(db);
  const rule = repo.create({
    name: "Regression → CI",
    trigger: "on_terminal",
    filter: {},
    actions: [{ type: "workflow_dispatch", ...TARGET }],
  });

  const captures: Capture[] = [];
  // GitHub's own 403 body echoes BOTH the credential and the operator's input value back at us —
  // the worst realistic case for an error path that forwards a response body.
  const hostileBody = JSON.stringify({
    message: `Bad credentials ${SEEDED_TOKEN} while dispatching with suite_id=${SEEDED_INPUT_VALUE}`,
  });
  const fetchImpl = recordingFetch(captures, (call) =>
    call === 1 ? { status: 204 } : { status: 403, body: hostileBody },
  );
  const deps = { token: () => SEEDED_TOKEN, fetchImpl };

  const okResult = await dispatchGithubWorkflow(TARGET, deps);
  const failResult = await dispatchGithubWorkflow(TARGET, deps);

  // The probe is only meaningful if the token actually WAS used — otherwise absence is trivial.
  const authHeader = (captures[0]!.init.headers as Record<string, string>).authorization;
  assert.equal(authHeader, `Bearer ${SEEDED_TOKEN}`, "the token really did reach the request");

  // Persist both outcomes exactly as the engine would.
  repo.recordEvent(rule.id, "run1", "workflow_dispatch", okResult, NOW);
  repo.recordEvent(rule.id, "run1", "workflow_dispatch", failResult, NOW);

  const surfaces: Array<[string, string]> = [
    ["the ok result", JSON.stringify(okResult)],
    ["the failure result", JSON.stringify(failResult)],
    ["the persisted audit rows", JSON.stringify(repo.listEvents(rule.id))],
    [
      "the raw watch_rule_events table",
      JSON.stringify(db.prepare("SELECT * FROM watch_rule_events").all()),
    ],
    ["the whole watch_rules row", JSON.stringify(db.prepare("SELECT * FROM watch_rules").all())],
  ];
  for (const [name, text] of surfaces) {
    assert.equal(text.includes(SEEDED_TOKEN), false, `the credential leaked into ${name}`);
    assert.equal(
      text.includes(SEEDED_INPUT_VALUE) && name !== "the whole watch_rules row",
      false,
      `an input value leaked into ${name}`,
    );
  }
  // The one place the input value legitimately lives is the rule's own configuration, which the API
  // already returns to the operator who typed it. It must NOT be in the audit/result surfaces above.
  assert.ok(
    JSON.stringify(repo.get(rule.id).actions).includes(SEEDED_INPUT_VALUE),
    "the configured input is still stored on the rule (this is what makes the audit assertions meaningful)",
  );

  // And the failure is still READABLE — redaction did not turn it into a shrug.
  assert.match(failResult.error ?? "", /403/);
  assert.match(failResult.error ?? "", /workbench · nightly\.yml @ main/);
  assert.equal(failResult.error?.includes("1 input"), false);
  assert.match(okResult.detail ?? "", /^dispatched workbench · nightly\.yml @ main · 1 input$/);
});

// ═══ (5) Missing / unauthorised account ═══════════════════════════════════════════════════════════

test("AM-OB11 — no connected GitHub account is a readable, audited refusal, not a silent no-op", async () => {
  const captures: Capture[] = [];
  const result = await dispatchGithubWorkflow(TARGET, {
    token: () => undefined,
    fetchImpl: recordingFetch(captures, () => ({ status: 204 })),
  });
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /no GitHub account is connected/);
  assert.match(result.error ?? "", /Settings/);
  assert.equal(captures.length, 0, "nothing was sent");
});

test("AM-OB11 — the engine records an audit row for a failed dispatch", async () => {
  const db = openFresh();
  baseGraph(db);
  const repo = repository(db);
  const rule = repo.create({
    name: "Regression → CI",
    trigger: "on_terminal",
    filter: {},
    actions: [{ type: "workflow_dispatch", ...TARGET }],
  });

  const engine = new WatchEngine(
    repo,
    new RunRepository(db),
    services({
      dispatchWorkflow: async (target) =>
        dispatchGithubWorkflow(target, {
          token: () => undefined,
          fetchImpl: recordingFetch([], () => ({ status: 204 })),
        }),
    }),
  );
  await engine.onRunSettled("run1", Date.parse(NOW));

  const rows = repo.listEvents(rule.id);
  const dispatched = rows.find((e) => e.action === "workflow_dispatch");
  assert.ok(dispatched, "the attempt is on the audit log even though it failed");
  assert.equal(dispatched?.result.ok, false);
  assert.match(dispatched?.result.error ?? "", /no GitHub account is connected/);
});

test("AM-OB11 — every non-204 status becomes a readable, body-free reason", async () => {
  const cases: Array<[number, RegExp]> = [
    [401, /401.*reconnect it in Settings/s],
    [403, /403.*not allowed to run Actions/s],
    [404, /404.*workflow_dispatch trigger/s],
    [422, /422.*inputs match the ones the workflow declares/s],
    [500, /responded 500/],
  ];
  for (const [status, pattern] of cases) {
    const result = await dispatchGithubWorkflow(TARGET, {
      token: () => SEEDED_TOKEN,
      fetchImpl: recordingFetch([], () => ({ status, body: `secret-body ${SEEDED_TOKEN}` })),
    });
    assert.equal(result.ok, false, `status ${status} must not be ok`);
    assert.match(result.error ?? "", pattern);
    assert.equal(result.error?.includes("secret-body"), false, "no response body is echoed");
  }
});

test("AM-OB11 — a network failure is a controlled message, never the raw error", async () => {
  const result = await dispatchGithubWorkflow(TARGET, {
    token: () => SEEDED_TOKEN,
    fetchImpl: (async () => {
      throw new Error(`connect ECONNREFUSED ${GITHUB_API_ORIGIN} token=${SEEDED_TOKEN}`);
    }) as unknown as typeof fetch,
  });
  assert.deepEqual(result, { ok: false, error: "workflow dispatch request failed" });
});

// ═══ (6) The target is not an arbitrary-URL primitive ═════════════════════════════════════════════

/** Each of these would turn "dispatch a workflow" into "make an authenticated request to a URL of
 *  the rule author's choosing" if it were interpolated into the path unchecked. */
const HOSTILE: Array<[string, WatchWorkflowDispatchTarget]> = [
  ["owner traverses", { owner: "..", repo: "r", workflow: "w.yml", ref: "main" }],
  [
    "owner smuggles a host",
    { owner: "evil.example.com/x", repo: "r", workflow: "w.yml", ref: "main" },
  ],
  [
    "owner carries userinfo",
    { owner: "user:pass@evil", repo: "r", workflow: "w.yml", ref: "main" },
  ],
  [
    "repo adds a path segment",
    { owner: "o", repo: "r/../../user", workflow: "w.yml", ref: "main" },
  ],
  ["repo percent-encodes a slash", { owner: "o", repo: "r%2Fx", workflow: "w.yml", ref: "main" }],
  [
    "workflow is a path",
    { owner: "o", repo: "r", workflow: ".github/workflows/w.yml", ref: "main" },
  ],
  ["ref traverses", { owner: "o", repo: "r", workflow: "w.yml", ref: "../main" }],
  ["ref looks like argv", { owner: "o", repo: "r", workflow: "w.yml", ref: "--upload-pack=x" }],
  ["ref carries a space", { owner: "o", repo: "r", workflow: "w.yml", ref: "ma in" }],
  ["owner is empty", { owner: "", repo: "r", workflow: "w.yml", ref: "main" }],
  [
    "an input name is hostile",
    { owner: "o", repo: "r", workflow: "w.yml", ref: "main", inputs: { "a b": "v" } },
  ],
  [
    "too many inputs",
    {
      owner: "o",
      repo: "r",
      workflow: "w.yml",
      ref: "main",
      inputs: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`k${i}`, "v"])),
    },
  ],
];

test("AM-OB11 — a hostile target is refused by the validator, the wire schema AND the dispatcher", async () => {
  for (const [name, target] of HOSTILE) {
    assert.equal(validateWorkflowDispatchTarget(target).ok, false, `validator accepted: ${name}`);
    assert.equal(
      watchActionInputSchema.safeParse({ type: "workflow_dispatch", ...target }).success,
      false,
      `the wire accepted: ${name}`,
    );

    // And the dispatcher re-asserts, so a hand-edited `actions_json` row (which never met zod) can
    // still never reach `fetch`.
    const captures: Capture[] = [];
    const result = await dispatchGithubWorkflow(target, {
      token: () => SEEDED_TOKEN,
      fetchImpl: recordingFetch(captures, () => ({ status: 204 })),
    });
    assert.equal(result.ok, false, `the dispatcher accepted: ${name}`);
    assert.match(result.error ?? "", /workflow dispatch refused — invalid /);
    assert.equal(captures.length, 0, `a request was made for: ${name}`);
    assert.equal(
      result.error?.includes(target.owner) && target.owner.length > 2,
      false,
      `the refusal echoed the offending value for: ${name}`,
    );
  }
});

test("AM-OB11 — a stored hostile action is refused at execution time too", async () => {
  // Simulates a hand-edited row: the action object bypasses zod entirely.
  const forged = {
    type: "workflow_dispatch",
    owner: "o",
    repo: "r",
    workflow: "../../../user",
    ref: "main",
  } as unknown as WatchAction;
  const captures: Capture[] = [];
  const result = await executeWatchAction(
    forged,
    { runId: "run1", run: RUN_VIEW },
    services({
      dispatchWorkflow: async (target) =>
        dispatchGithubWorkflow(target, {
          token: () => SEEDED_TOKEN,
          fetchImpl: recordingFetch(captures, () => ({ status: 204 })),
        }),
    }),
  );
  assert.equal(result.ok, false);
  assert.equal(captures.length, 0, "the forged row never reached the network");
});
