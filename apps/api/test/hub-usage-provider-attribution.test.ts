// model-identity WP3.3 (D-MI10) — honest cost attribution for `GET /api/hub/usage`.
//
// THE DEFECT THIS LOCKS. `byProvider`'s key domain used to be `inferHubModelKind`'s return type
// (`HubAiSdkModelKind | undefined`), a union that STRUCTURALLY excludes `claude_subscription`. So
// spend on the owner's signed-in Claude subscription could only ever be reported as "Anthropic" — in
// the one report an operator would open to catch exactly that mis-billing. Swapping the local
// `Record<string, string>` label map for the D-MI6 registry would have LOOKED like a fix while
// leaving the key domain (and therefore the bug) completely intact.
//
// Proves (acceptance):
//   1. A session PINNED to a `claude_subscription` credential buckets as "Anthropic CLI" — never
//      "Anthropic" — even though the model id (`claude-sonnet-5`) still makes the old heuristic say
//      "anthropic" (asserted, so this test cannot pass vacuously).
//   2. Two credentials of the SAME kind produce two distinct per-credential buckets that still roll up
//      into ONE kind bucket.
//   3. A NULL `provider_credential_id` row (every pre-v55 session) aggregates exactly as it does today
//      — the heuristic path is untouched — and is flagged `unpinned` rather than blended in silently.
//   4. `hub_usage_summary` (the assistant dock's read tool) reports the SAME corrected labels as
//      `GET /api/hub/usage`, since both go through the same resolver.
//   5. Deleting a pinned credential degrades that session to the heuristic path (`ON DELETE SET NULL`,
//      D-MI1/D-MI2) instead of inventing a phantom bucket.
//   6. Every filtered session lands in exactly one credential bucket (the rollups reconcile).

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import type { HubUsageAggregates } from "@mcp-token-footprint/shared";
import {
  buildHubReadToolDefinitions,
  type HubReadToolDeps,
} from "../src/assistant/tools/hub-read-tools.js";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { HubRepository } from "../src/hub/repository.js";
import { inferHubModelKind, registerHubRoutes } from "../src/hub/routes.js";
import { HubSessionService, type HubModelResolver } from "../src/hub/session-service.js";
import { buildHubUsageAggregates, createHubUsageProviderResolver } from "../src/hub/usage.js";
import { ProviderRepository } from "../src/providers/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { getTokenCounter } from "../src/token-counting/profiles.js";

const counter = getTokenCounter("generic_o200k");

const databases: AppDatabase[] = [];
const harnesses: FastifyInstance[] = [];
afterEach(async () => {
  for (const app of harnesses.splice(0)) await app.close();
  for (const db of databases.splice(0)) db.close();
});

type Harness = { db: AppDatabase; hub: HubRepository; providers: ProviderRepository };

function open(): Harness {
  const db = new Database(":memory:") as unknown as AppDatabase;
  databases.push(db);
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  return {
    db,
    hub: new HubRepository(db),
    providers: new ProviderRepository(db, new SecretStore(crypto.randomBytes(32))),
  };
}

/** The production attribution wiring, exactly as `hub/routes.ts` and the dock read tool build it. */
function aggregatesFor(h: Harness): HubUsageAggregates {
  return buildHubUsageAggregates(
    h.hub,
    {},
    createHubUsageProviderResolver(h.providers, inferHubModelKind),
  );
}

function spend(
  h: Harness,
  sessionId: string,
  usage: { costUsd: number; tokensIn: number; tokensOut: number },
): void {
  h.hub.setSessionLifecycle(sessionId, usage);
}

// ── (1) the headline: subscription spend is "Anthropic CLI", never "Anthropic" ─────────────────────

test("a session pinned to a claude_subscription credential buckets as 'Anthropic CLI', never 'Anthropic'", () => {
  const h = open();
  // The premise that made the old code wrong: this model id STILL reads as `anthropic` by name. If the
  // fix were only a label swap, the assertions below would fail — the bucket would say "Anthropic".
  assert.equal(
    inferHubModelKind("claude-sonnet-5"),
    "anthropic",
    "premise: the name heuristic cannot express claude_subscription (that IS the defect)",
  );

  const subscription = h.providers.create({
    kind: "claude_subscription",
    label: "Claude Max (mine)",
  });
  const session = h.hub.createSession({
    mode: "chat",
    model: "claude-sonnet-5",
    providerCredentialId: subscription.id,
  });
  spend(h, session.id, { costUsd: 3, tokensIn: 900, tokensOut: 120 });

  const result = aggregatesFor(h);

  // byProvider — the kind roll-up (today's chart) now names the subscription.
  assert.deepEqual(
    result.byProvider.map((b) => ({ key: b.key, label: b.label })),
    [{ key: "claude_subscription", label: "Anthropic CLI" }],
  );
  assert.equal(
    result.byProvider.find((b) => b.key === "anthropic"),
    undefined,
    "subscription spend must never appear under the metered Anthropic API bucket",
  );

  // byProviderCredential — WHICH key was billed.
  assert.equal(result.byProviderCredential.length, 1);
  const bucket = result.byProviderCredential[0];
  assert.equal(bucket?.label, "Claude Max (mine)");
  assert.equal(bucket?.providerKind, "claude_subscription");
  assert.equal(bucket?.credentialId, subscription.id);
  assert.equal(bucket?.billing, "subscription");
  assert.equal(bucket?.unpinned, false, "a persisted credential is a recorded fact, not a guess");
  assert.equal(bucket?.costUsd, 3);
});

// ── (2) two credentials of the same kind ───────────────────────────────────────────────────────────

test("two credentials of the SAME kind are two per-credential buckets that roll up into one kind bucket", () => {
  const h = open();
  const work = h.providers.create({ kind: "anthropic", label: "Work key", apiKey: "sk-work" });
  const personal = h.providers.create({
    kind: "anthropic",
    label: "Personal key",
    apiKey: "sk-personal",
  });

  const a = h.hub.createSession({
    mode: "chat",
    model: "claude-opus-4-8",
    providerCredentialId: work.id,
  });
  spend(h, a.id, { costUsd: 4, tokensIn: 100, tokensOut: 40 });
  const b = h.hub.createSession({
    mode: "chat",
    model: "claude-opus-4-8",
    providerCredentialId: personal.id,
  });
  spend(h, b.id, { costUsd: 1, tokensIn: 20, tokensOut: 10 });

  const result = aggregatesFor(h);

  // One KIND bucket, summing both keys — today's chart is preserved exactly.
  assert.deepEqual(
    result.byProvider.map((bucket) => ({ key: bucket.key, label: bucket.label, cost: bucket.costUsd })),
    [{ key: "anthropic", label: "Anthropic", cost: 5 }],
  );

  // Two CREDENTIAL buckets — the "which key is being billed" answer a kind bucket cannot give.
  assert.deepEqual(
    result.byProviderCredential.map((bucket) => ({
      label: bucket.label,
      credentialId: bucket.credentialId,
      cost: bucket.costUsd,
      unpinned: bucket.unpinned,
    })),
    [
      { label: "Work key", credentialId: work.id, cost: 4, unpinned: false },
      { label: "Personal key", credentialId: personal.id, cost: 1, unpinned: false },
    ],
    "sorted by cost desc, each key distinguishable",
  );
  assert.equal(
    new Set(result.byProviderCredential.map((bucket) => bucket.key)).size,
    2,
    "the bucket keys must be distinct even though the kind is identical",
  );
  assert.equal(
    result.byProviderCredential.reduce((sum, bucket) => sum + bucket.costUsd, 0),
    result.byProvider[0]?.costUsd,
    "the per-credential buckets roll up into the kind bucket exactly",
  );
});

// ── (3) the regression lock: a NULL column still reads through the unchanged heuristic ─────────────

test("a NULL provider_credential_id row aggregates exactly as before (heuristic path untouched)", () => {
  const h = open();
  const legacy = h.hub.createSession({ mode: "chat", model: "claude-opus-4-8" });
  spend(h, legacy.id, { costUsd: 2, tokensIn: 50, tokensOut: 25 });
  const unknown = h.hub.createSession({ mode: "chat", model: "some-self-hosted-model" });
  spend(h, unknown.id, { costUsd: 1, tokensIn: 10, tokensOut: 5 });

  assert.equal(legacy.providerCredentialId, null, "no backfill — a pre-v55 row reads back NULL");

  const result = aggregatesFor(h);

  // byProvider is byte-identical to what it produced before this WP.
  assert.deepEqual(
    result.byProvider.map((bucket) => ({
      key: bucket.key,
      label: bucket.label,
      sessions: bucket.sessions,
      costUsd: bucket.costUsd,
    })),
    [
      { key: "anthropic", label: "Anthropic", sessions: 1, costUsd: 2 },
      { key: "other", label: "Other", sessions: 1, costUsd: 1 },
    ],
  );

  // The credential view says plainly that these attributions are inferred, not recorded.
  const anthropic = result.byProviderCredential.find((b) => b.providerKind === "anthropic");
  assert.equal(anthropic?.label, "Anthropic (not pinned)");
  assert.equal(anthropic?.credentialId, null);
  assert.equal(anthropic?.unpinned, true);
  assert.equal(anthropic?.billing, "metered_api_key");

  const other = result.byProviderCredential.find((b) => b.providerKind === null);
  assert.equal(other?.label, "Other (not pinned)");
  assert.equal(other?.billing, null, "an unresolvable kind has no billing basis to claim");
  assert.equal(other?.unpinned, true);
});

test("a pinned session and a legacy NULL one of the same kind share ONE kind bucket but stay separate credential buckets", () => {
  const h = open();
  const key = h.providers.create({ kind: "anthropic", label: "Work key", apiKey: "sk-work" });
  const pinned = h.hub.createSession({
    mode: "chat",
    model: "claude-opus-4-8",
    providerCredentialId: key.id,
  });
  spend(h, pinned.id, { costUsd: 3, tokensIn: 30, tokensOut: 10 });
  const legacy = h.hub.createSession({ mode: "chat", model: "claude-opus-4-8" });
  spend(h, legacy.id, { costUsd: 2, tokensIn: 20, tokensOut: 5 });

  const result = aggregatesFor(h);
  assert.deepEqual(
    result.byProvider.map((b) => ({ key: b.key, sessions: b.sessions, cost: b.costUsd })),
    [{ key: "anthropic", sessions: 2, cost: 5 }],
  );
  assert.deepEqual(
    result.byProviderCredential.map((b) => ({ label: b.label, unpinned: b.unpinned, cost: b.costUsd })),
    [
      { label: "Work key", unpinned: false, cost: 3 },
      { label: "Anthropic (not pinned)", unpinned: true, cost: 2 },
    ],
    "a measured attribution and an inferred one are never merged into one row",
  );
});

// ── (5) the degraded path: the credential is deleted out from under a session ──────────────────────

test("deleting a pinned credential degrades that session to the heuristic (ON DELETE SET NULL, D-MI1)", () => {
  const h = open();
  const key = h.providers.create({ kind: "anthropic", label: "Retired key", apiKey: "sk-old" });
  const session = h.hub.createSession({
    mode: "chat",
    model: "claude-opus-4-8",
    providerCredentialId: key.id,
  });
  spend(h, session.id, { costUsd: 7, tokensIn: 70, tokensOut: 7 });

  h.providers.delete(key.id);

  const reread = h.hub.getSession(session.id);
  assert.equal(reread.providerCredentialId, null, "ON DELETE SET NULL degrades the pin, not the row");

  const result = aggregatesFor(h);
  assert.deepEqual(
    result.byProviderCredential.map((b) => ({
      label: b.label,
      credentialId: b.credentialId,
      unpinned: b.unpinned,
    })),
    [{ label: "Anthropic (not pinned)", credentialId: null, unpinned: true }],
    "never a phantom bucket for a credential that no longer exists",
  );
});

// ── (6) reconciliation ─────────────────────────────────────────────────────────────────────────────

test("every session lands in exactly one credential bucket (byProviderCredential reconciles with totals)", () => {
  const h = open();
  const sub = h.providers.create({ kind: "claude_subscription", label: "Claude Max" });
  const key = h.providers.create({ kind: "openai", label: "OpenAI key", apiKey: "sk-oai" });

  const pinnedSub = h.hub.createSession({
    mode: "chat",
    model: "claude-sonnet-5",
    providerCredentialId: sub.id,
  });
  spend(h, pinnedSub.id, { costUsd: 1.5, tokensIn: 10, tokensOut: 4 });
  const pinnedKey = h.hub.createSession({
    mode: "research",
    model: "gpt-5.5",
    providerCredentialId: key.id,
  });
  spend(h, pinnedKey.id, { costUsd: 2.25, tokensIn: 20, tokensOut: 8 });
  const legacy = h.hub.createSession({ mode: "chat", model: "gemini-2.5-pro" });
  spend(h, legacy.id, { costUsd: 0.25, tokensIn: 5, tokensOut: 1 });

  const result = aggregatesFor(h);
  const sum = (values: readonly { costUsd: number; sessions: number }[]) =>
    values.reduce((acc, v) => ({ costUsd: acc.costUsd + v.costUsd, sessions: acc.sessions + v.sessions }), {
      costUsd: 0,
      sessions: 0,
    });

  assert.deepEqual(sum(result.byProviderCredential), {
    costUsd: result.totals.costUsd,
    sessions: result.totals.sessions,
  });
  assert.deepEqual(sum(result.byProvider), {
    costUsd: result.totals.costUsd,
    sessions: result.totals.sessions,
  });
  assert.equal(result.byProviderCredential.length, 3);
  assert.deepEqual(
    result.byProvider.map((b) => b.key).sort(),
    ["claude_subscription", "google", "openai"],
    "the legacy gemini row still resolves through the unchanged heuristic",
  );
});

// ── (4) the dock read tool answers with the SAME labels as the route ───────────────────────────────

const stubResolveModel: HubModelResolver = () => ({
  providerKind: "anthropic",
  modelId: "test-model",
  contextWindow: 100_000,
});

async function callHubUsageSummary(deps: HubReadToolDeps): Promise<HubUsageAggregates> {
  const def = buildHubReadToolDefinitions(deps).find((d) => d.name === "hub_usage_summary");
  if (!def) throw new Error("hub_usage_summary is not registered");
  const result = await def.handler({} as never, {});
  assert.equal(result.isError, undefined, "hub_usage_summary unexpectedly errored");
  const block = result.content[0] as { type: "text"; text: string };
  return JSON.parse(block.text) as HubUsageAggregates;
}

test("hub_usage_summary and GET /api/hub/usage report the SAME provider labels ('Anthropic CLI', per credential)", async () => {
  const h = open();
  const sub = h.providers.create({ kind: "claude_subscription", label: "Claude Max" });
  const session = h.hub.createSession({
    mode: "chat",
    model: "claude-sonnet-5",
    providerCredentialId: sub.id,
  });
  spend(h, session.id, { costUsd: 1.25, tokensIn: 100, tokensOut: 20 });

  const service = new HubSessionService({
    repository: h.hub,
    tokenCounter: counter,
    resolveToolset: () => ({ tools: {} }),
    resolveModel: stubResolveModel,
    config: {
      maxActiveSessions: 4,
      idleReleaseMs: 0,
      autoTitle: false,
      dataDir: "/tmp",
      toolLoadingDefault: "eager",
      autoFraction: 0.1,
      skillListingBudgetFraction: 0.01,
      skillEntryMaxChars: 1536,
      skillLoadBudgets: { perSkillTokens: 5000, totalTokens: 25000 },
    },
  });
  const app = Fastify({ logger: false });
  await registerHubRoutes(app, {
    repository: h.hub,
    sessionService: service,
    providers: h.providers,
    tokenCounter: counter,
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  harnesses.push(app);
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  const res = await fetch(`http://127.0.0.1:${port}/api/hub/usage`);
  assert.equal(res.status, 200);
  const route = (await res.json()) as HubUsageAggregates;
  const dock = await callHubUsageSummary({ hub: h.hub, providers: h.providers });

  assert.deepEqual(
    route.byProvider.map((b) => ({ key: b.key, label: b.label })),
    [{ key: "claude_subscription", label: "Anthropic CLI" }],
  );
  assert.deepEqual(dock.byProvider, route.byProvider, "the dock must not have its own vocabulary");
  assert.deepEqual(dock.byProviderCredential, route.byProviderCredential);
  assert.equal(dock.byProviderCredential[0]?.label, "Claude Max");
  assert.equal(dock.byProviderCredential[0]?.providerKind, "claude_subscription");
});
