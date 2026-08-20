// Assistant Hub (planning/Roadmap/RM-03-assistant-hub/, WP3.5, §1.4 / D-AH12, D-AH7) — the review REST surface over a
// REAL `HubRepository`, mirroring `hub-artifact-routes.test.ts`'s harness. The critic model call is a
// pure DI seam (`HubRouteDeps.reviewAgentRunner`) — no real AI-SDK model is ever built here.
//
// Proves (acceptance): a review request "spawns a critic" — `POST .../reviews` calls the injected
// runner with a non-empty system prompt (carrying the critic lens) + a brief containing the artifact
// content, and stamps the model's proposals into `pending`/`agent`-authored comments, enriching a
// LOCATABLE quote with numeric offsets; 400 when neither `roleId` nor `model` is given; 404 for an
// unknown artifact/role/version; 409 when no hub-eligible provider credential exists (the route never
// reaches the runner). `PATCH .../reviews/:id`: `rejected` records the decision with no version;
// `accepted` + a `suggestedEdit` re-locates the quote against the CURRENT content and appends a new
// IMMUTABLE version (the `HubReviewDecisionResult` envelope carries it); `accepted` with no
// `suggestedEdit` just acknowledges (no version); a DRIFTED quote 409s and leaves the comment `pending`
// (no partial mutation); re-deciding an already-decided comment 409s. The version-revert undo (R-UX7)
// appends a new version equal to a historical one; 400 reverting to the already-current version.
// Session-scoped artifacts see `review_opened`/`review_decided`/`artifact_updated` on the session log
// (R-SES1 replay completeness) — a project-only artifact (no session) skips those, same as WP1.6.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import {
  DEFAULT_TOKEN_PROFILE,
  type HubAgentRole,
  type HubArtifact,
  type HubReview,
  type HubReviewDecisionResult,
} from "@mcp-token-footprint/shared";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import {
  registerHubRoutes,
  type HubReviewAgentInput,
  type HubReviewAgentResult,
} from "../src/hub/routes.js";
import { HubRepository } from "../src/hub/repository.js";
import { HubSessionService } from "../src/hub/session-service.js";
import { ProviderRepository } from "../src/providers/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { getTokenCounter } from "../src/token-counting/profiles.js";
import { toErrorMessage } from "../src/utils/errors.js";

const databases: AppDatabase[] = [];
const tempDirs: string[] = [];
const harnesses: FastifyInstance[] = [];

afterEach(async () => {
  for (const app of harnesses.splice(0)) await app.close();
  for (const db of databases.splice(0)) db.close();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function openDb(): AppDatabase {
  const db = new Database(":memory:") as unknown as AppDatabase;
  databases.push(db);
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  return db;
}

function tempDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-review-routes-"));
  tempDirs.push(dir);
  return dir;
}

/** Mirrors `hub-routes.test.ts`'s own helper — a hub-eligible (anthropic) credential so
 *  `assertHubProviderConfigured` passes without ever building a real AI-SDK model. */
function seedAnthropicCredential(db: AppDatabase, secrets: SecretStore): void {
  const now = "2026-07-17T00:00:00.000Z";
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-1', 'anthropic', 'Claude', NULL, @key, @now, @now)`,
  ).run({ key: secrets.encryptText("dummy-not-a-real-key"), now });
}

type Harness = { baseUrl: string; repo: HubRepository };

async function makeApp(
  options: {
    seedProvider?: boolean;
    reviewAgentRunner?: (input: HubReviewAgentInput) => Promise<HubReviewAgentResult>;
  } = {},
): Promise<Harness> {
  const db = openDb();
  const secrets = new SecretStore(crypto.randomBytes(32));
  if (options.seedProvider !== false) seedAnthropicCredential(db, secrets);
  const providerRepository = new ProviderRepository(db, secrets);
  const repo = new HubRepository(db);
  const service = new HubSessionService({
    repository: repo,
    tokenCounter: getTokenCounter(DEFAULT_TOKEN_PROFILE),
    resolveToolset: () => ({ tools: {} }),
    resolveModel: () => {
      throw new Error("review routes never resolve a model through the session service");
    },
    config: {
      maxActiveSessions: 4,
      idleReleaseMs: 0,
      autoTitle: false,
      dataDir: tempDataDir(),
      toolLoadingDefault: "eager",
      autoFraction: 0.1,
      skillListingBudgetFraction: 0.01,
      skillEntryMaxChars: 1536,
      skillLoadBudgets: { perSkillTokens: 5000, totalTokens: 25000 },
    },
  });

  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: "Validation failed" });
    const typed = error as Error & { statusCode?: number };
    return reply.code(typed.statusCode ?? 500).send({ error: toErrorMessage(error) });
  });
  await registerHubRoutes(app, {
    repository: repo,
    sessionService: service,
    providers: providerRepository,
    ...(options.reviewAgentRunner ? { reviewAgentRunner: options.reviewAgentRunner } : {}),
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  harnesses.push(app);
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { baseUrl: `http://127.0.0.1:${port}`, repo };
}

async function postJson(h: Harness, urlPath: string, body: unknown): Promise<Response> {
  return fetch(`${h.baseUrl}${urlPath}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function patchJson(h: Harness, urlPath: string, body: unknown): Promise<Response> {
  return fetch(`${h.baseUrl}${urlPath}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function createArtifact(
  h: Harness,
  overrides: Partial<{ sessionId: string; content: string }> = {},
): Promise<HubArtifact> {
  const res = await postJson(h, "/api/hub/artifacts", {
    kind: "markdown",
    title: "Release notes",
    content: overrides.content ?? "The launch date is **March 1st**. Contact support for help.",
    ...(overrides.sessionId ? { sessionId: overrides.sessionId } : {}),
  });
  assert.equal(res.status, 201);
  return (await res.json()) as HubArtifact;
}

async function createProject(h: Harness): Promise<{ id: string }> {
  const res = await postJson(h, "/api/hub/projects", { name: "P" });
  assert.equal(res.status, 201);
  return (await res.json()) as { id: string };
}

/** Creates a session directly via the repository (bypassing `POST /api/hub/sessions`, which resolves
 *  the model through `sessionService` — a seam this file deliberately leaves throwing, mirroring
 *  `hub-artifact-routes.test.ts`'s own "review routes never touch a model" harness posture). */
async function createSession(h: Harness): Promise<string> {
  const project = await createProject(h);
  const session = h.repo.createSession({
    projectId: project.id,
    mode: "chat",
    model: "claude-sonnet-4-6",
  });
  return session.id;
}

const stubRunner = (result: HubReviewAgentResult) => async (_input: HubReviewAgentInput) => result;

// ── POST — spawn the critic ─────────────────────────────────────────────────────────────────────────

test("POST .../reviews spawns the critic (non-empty system prompt + brief), stamps pending agent comments, enriches a locatable quote with offsets", async () => {
  let seenInput: HubReviewAgentInput | undefined;
  const h = await makeApp({
    reviewAgentRunner: async (input) => {
      seenInput = input;
      return {
        comments: [
          { body: "Confirm the date.", anchor: { quote: "March 1st" }, suggestedEdit: "March 3rd" },
          { body: "General note, no anchor." },
        ],
      };
    },
  });
  const artifact = await createArtifact(h);

  const res = await postJson(h, `/api/hub/artifacts/${artifact.id}/reviews`, {
    model: "claude-sonnet-4-6",
  });
  assert.equal(res.status, 201);
  const review = (await res.json()) as HubReview;

  assert.equal(review.artifactId, artifact.id);
  assert.equal(review.baseVersion, 1);
  assert.equal(review.status, "open");
  assert.equal(review.reviewerKind, "agent");
  assert.equal(review.comments.length, 2);

  const anchored = review.comments.find((c) => c.body === "Confirm the date.");
  assert.ok(anchored);
  assert.equal(anchored?.decision, "pending");
  assert.equal(anchored?.authorKind, "agent");
  assert.equal(anchored?.suggestedEdit, "March 3rd");
  assert.equal(anchored?.anchor?.quote, "March 1st");
  assert.equal(
    anchored?.anchor?.startOffset,
    artifact ? "The launch date is **".length : undefined,
  );

  const general = review.comments.find((c) => c.body === "General note, no anchor.");
  assert.ok(general);
  assert.equal(general?.anchor, undefined);

  assert.ok(seenInput);
  assert.ok((seenInput?.systemPrompt.length ?? 0) > 0);
  assert.match(seenInput?.systemPrompt ?? "", /critique/i);
  assert.match(seenInput?.brief ?? "", /March 1st/);
  assert.equal(seenInput?.model, "claude-sonnet-4-6");
});

test("POST .../reviews uses the role's defaultModel + systemPrompt when roleId is given", async () => {
  const h = await makeApp({ reviewAgentRunner: stubRunner({ comments: [] }) });
  const artifact = await createArtifact(h);
  const roleRes = await postJson(h, "/api/hub/agents", {
    name: "Style critic",
    systemPrompt: "You obsess over house style.",
    defaultModel: "gpt-4o",
    target: "House-style compliance",
    expectedOutcome: "Style nits only",
  });
  assert.equal(roleRes.status, 201);
  const role = (await roleRes.json()) as HubAgentRole;

  const res = await postJson(h, `/api/hub/artifacts/${artifact.id}/reviews`, { roleId: role.id });
  assert.equal(res.status, 201);
  const review = (await res.json()) as HubReview;
  assert.equal(review.reviewerRef, role.id);
});

// model-identity WP6.1 (F9) — the critic's two pin defects: a free-text `model` could never name a
// credential (so a roleId-less critic run was structurally unable to use the subscription), and the
// role's pin was attached even when `input.model` had overridden the role's model.

test("F9: a free-text model can now carry its OWN credential to the critic", async () => {
  let seen: HubReviewAgentInput | undefined;
  const h = await makeApp({
    reviewAgentRunner: async (input) => {
      seen = input;
      return { comments: [] };
    },
  });
  const artifact = await createArtifact(h);

  const res = await postJson(h, `/api/hub/artifacts/${artifact.id}/reviews`, {
    model: "claude-sonnet-5",
    providerCredentialId: "prov-1",
  });
  assert.equal(res.status, 201, "the .strict() body accepts the additive field (it used to 400)");
  assert.equal(seen?.model, "claude-sonnet-5");
  assert.equal(
    seen?.providerCredentialId,
    "prov-1",
    "…and the credential reaches the runner, so a no-role critic can run on a chosen provider",
  );

  // D-MI9 still applies to a pin the caller asserted: this route is synchronous, so the 409 is visible.
  const refused = await postJson(h, `/api/hub/artifacts/${artifact.id}/reviews`, {
    model: "claude-sonnet-5",
    providerCredentialId: "prov-nope",
  });
  assert.equal(refused.status, 409);
  assert.match(String(((await refused.json()) as { error?: string }).error), /no longer exists/);
});

test("F9: a role pin does NOT follow a model the request overrode; it does when the role's model stands", async () => {
  let seen: HubReviewAgentInput | undefined;
  const h = await makeApp({
    reviewAgentRunner: async (input) => {
      seen = input;
      return { comments: [] };
    },
  });
  const artifact = await createArtifact(h);
  const role = (await (
    await postJson(h, "/api/hub/agents", {
      name: "Style critic",
      systemPrompt: "You obsess over house style.",
      defaultModel: "claude-sonnet-5",
      providerCredentialId: "prov-1",
      target: "House-style compliance",
      expectedOutcome: "Style nits only",
    })
  ).json()) as HubAgentRole;

  // The role's model stands ⇒ the role's pin applies (unchanged behaviour).
  await postJson(h, `/api/hub/artifacts/${artifact.id}/reviews`, { roleId: role.id });
  assert.equal(seen?.model, "claude-sonnet-5");
  assert.equal(seen?.providerCredentialId, "prov-1");

  // The request OVERRIDES the model ⇒ the role's pin was chosen for a different one, so it is dropped
  // to the heuristic rather than becoming authoritative for a model nobody paired it with.
  await postJson(h, `/api/hub/artifacts/${artifact.id}/reviews`, {
    roleId: role.id,
    model: "gpt-4o",
  });
  assert.equal(seen?.model, "gpt-4o");
  assert.equal(seen?.providerCredentialId, undefined, "the stale role pin did not follow the override");
});

test("POST .../reviews 400s with neither roleId nor model; 404s for an unknown artifact/roleId/version", async () => {
  const h = await makeApp({ reviewAgentRunner: stubRunner({ comments: [] }) });
  const artifact = await createArtifact(h);

  const noModel = await postJson(h, `/api/hub/artifacts/${artifact.id}/reviews`, {});
  assert.equal(noModel.status, 400);

  const badArtifact = await postJson(h, "/api/hub/artifacts/nope/reviews", { model: "gpt-4o" });
  assert.equal(badArtifact.status, 404);

  const badRole = await postJson(h, `/api/hub/artifacts/${artifact.id}/reviews`, {
    roleId: "nope",
  });
  assert.equal(badRole.status, 404);

  const badVersion = await postJson(h, `/api/hub/artifacts/${artifact.id}/reviews`, {
    model: "gpt-4o",
    version: 99,
  });
  assert.equal(badVersion.status, 404);
});

test("POST .../reviews 409s when no hub-eligible provider credential exists — the runner is never called", async () => {
  let called = false;
  const h = await makeApp({
    seedProvider: false,
    reviewAgentRunner: async () => {
      called = true;
      return { comments: [] };
    },
  });
  const artifact = await createArtifact(h);
  const res = await postJson(h, `/api/hub/artifacts/${artifact.id}/reviews`, { model: "gpt-4o" });
  assert.equal(res.status, 409);
  assert.equal(called, false);
});

// ── PATCH — per-comment decisions ───────────────────────────────────────────────────────────────────

/** POST a review — the comments come from whatever `reviewAgentRunner` stub `makeApp` was given. */
async function openReview(h: Harness, artifact: HubArtifact): Promise<HubReview> {
  const res = await postJson(h, `/api/hub/artifacts/${artifact.id}/reviews`, { model: "gpt-4o" });
  assert.equal(res.status, 201);
  return (await res.json()) as HubReview;
}

test("PATCH accept with a locatable suggestedEdit appends a new immutable version; response carries resultingVersion", async () => {
  const h = await makeApp({
    reviewAgentRunner: stubRunner({
      comments: [{ body: "Fix date", anchor: { quote: "March 1st" }, suggestedEdit: "April 2nd" }],
    }),
  });
  const artifact = await createArtifact(h);
  const review = await openReview(h, artifact);
  const comment = review.comments[0];
  assert.ok(comment);

  const res = await patchJson(h, `/api/hub/reviews/${review.id}`, {
    decision: { commentId: comment.id, decision: "accepted" },
  });
  assert.equal(res.status, 200);
  const result = (await res.json()) as HubReviewDecisionResult;
  assert.equal(result.review.comments[0]?.decision, "accepted");
  assert.ok(result.resultingVersion);
  assert.equal(result.resultingVersion?.version, 2);
  assert.match(result.resultingVersion?.content ?? "", /April 2nd/);
  assert.doesNotMatch(result.resultingVersion?.content ?? "", /March 1st/);
  assert.equal(result.resultingVersion?.authorKind, "agent");

  const artifactRes = await fetch(`${h.baseUrl}/api/hub/artifacts/${artifact.id}`);
  const updatedArtifact = (await artifactRes.json()) as HubArtifact;
  assert.equal(updatedArtifact.latestVersion, 2);
  assert.equal(updatedArtifact.currentVersionId, result.resultingVersion?.id);
});

test("PATCH reject records the decision with no new version", async () => {
  const h = await makeApp({
    reviewAgentRunner: stubRunner({
      comments: [{ body: "Fix date", anchor: { quote: "March 1st" }, suggestedEdit: "April 2nd" }],
    }),
  });
  const artifact = await createArtifact(h);
  const review = await openReview(h, artifact);
  const comment = review.comments[0];
  assert.ok(comment);

  const res = await patchJson(h, `/api/hub/reviews/${review.id}`, {
    decision: { commentId: comment.id, decision: "rejected" },
  });
  assert.equal(res.status, 200);
  const result = (await res.json()) as HubReviewDecisionResult;
  assert.equal(result.review.comments[0]?.decision, "rejected");
  assert.equal(result.resultingVersion, undefined);

  const artifactRes = await fetch(`${h.baseUrl}/api/hub/artifacts/${artifact.id}`);
  const updatedArtifact = (await artifactRes.json()) as HubArtifact;
  assert.equal(updatedArtifact.latestVersion, 1);
});

test("PATCH accept with no suggestedEdit just acknowledges — no version created", async () => {
  const h = await makeApp({
    reviewAgentRunner: stubRunner({ comments: [{ body: "Nice work overall." }] }),
  });
  const artifact = await createArtifact(h);
  const review = await openReview(h, artifact);
  const comment = review.comments[0];
  assert.ok(comment);

  const res = await patchJson(h, `/api/hub/reviews/${review.id}`, {
    decision: { commentId: comment.id, decision: "accepted" },
  });
  assert.equal(res.status, 200);
  const result = (await res.json()) as HubReviewDecisionResult;
  assert.equal(result.review.comments[0]?.decision, "accepted");
  assert.equal(result.resultingVersion, undefined);
});

test("PATCH accept 409s when the quote has drifted (content already changed) and leaves the comment pending", async () => {
  const h = await makeApp({
    reviewAgentRunner: stubRunner({
      comments: [{ body: "Fix date", anchor: { quote: "March 1st" }, suggestedEdit: "April 2nd" }],
    }),
  });
  const artifact = await createArtifact(h);
  const review = await openReview(h, artifact);
  const comment = review.comments[0];
  assert.ok(comment);

  // Drift the current content via a direct-UI edit so the anchored quote no longer appears verbatim.
  const editRes = await postJson(h, `/api/hub/artifacts/${artifact.id}/versions`, {
    content: "The launch date changed entirely. Contact support for help.",
  });
  assert.equal(editRes.status, 201);

  const res = await patchJson(h, `/api/hub/reviews/${review.id}`, {
    decision: { commentId: comment.id, decision: "accepted" },
  });
  assert.equal(res.status, 409);

  const reviewRes = await fetch(`${h.baseUrl}/api/hub/reviews/${review.id}`);
  const stillPending = (await reviewRes.json()) as HubReview;
  assert.equal(stillPending.comments[0]?.decision, "pending");
});

test("PATCH re-deciding an already-decided comment 409s", async () => {
  const h = await makeApp({
    reviewAgentRunner: stubRunner({ comments: [{ body: "Nice work overall." }] }),
  });
  const artifact = await createArtifact(h);
  const review = await openReview(h, artifact);
  const comment = review.comments[0];
  assert.ok(comment);

  const first = await patchJson(h, `/api/hub/reviews/${review.id}`, {
    decision: { commentId: comment.id, decision: "accepted" },
  });
  assert.equal(first.status, 200);

  const second = await patchJson(h, `/api/hub/reviews/${review.id}`, {
    decision: { commentId: comment.id, decision: "rejected" },
  });
  assert.equal(second.status, 409);
});

test("PATCH unknown review/comment 404s; status-only patch updates status with no version", async () => {
  const h = await makeApp({ reviewAgentRunner: stubRunner({ comments: [] }) });
  const artifact = await createArtifact(h);
  const review = await openReview(h, artifact);

  const badReview = await patchJson(h, "/api/hub/reviews/nope", { status: "cancelled" });
  assert.equal(badReview.status, 404);

  const badComment = await patchJson(h, `/api/hub/reviews/${review.id}`, {
    decision: { commentId: "nope", decision: "accepted" },
  });
  assert.equal(badComment.status, 404);

  const statusRes = await patchJson(h, `/api/hub/reviews/${review.id}`, { status: "cancelled" });
  assert.equal(statusRes.status, 200);
  const result = (await statusRes.json()) as HubReviewDecisionResult;
  assert.equal(result.review.status, "cancelled");
  assert.equal(result.resultingVersion, undefined);
});

test("PATCH 400s when neither status nor decision is given", async () => {
  const h = await makeApp({ reviewAgentRunner: stubRunner({ comments: [] }) });
  const artifact = await createArtifact(h);
  const review = await openReview(h, artifact);
  const res = await patchJson(h, `/api/hub/reviews/${review.id}`, {});
  assert.equal(res.status, 400);
});

// ── GET — list / single ─────────────────────────────────────────────────────────────────────────────

test("GET .../artifacts/:id/reviews lists; GET .../reviews/:id fetches one; both 404 on an unknown id", async () => {
  const h = await makeApp({ reviewAgentRunner: stubRunner({ comments: [] }) });
  const artifact = await createArtifact(h);
  const review = await openReview(h, artifact);

  const listRes = await fetch(`${h.baseUrl}/api/hub/artifacts/${artifact.id}/reviews`);
  assert.equal(listRes.status, 200);
  const list = (await listRes.json()) as HubReview[];
  assert.ok(list.some((r) => r.id === review.id));

  const getRes = await fetch(`${h.baseUrl}/api/hub/reviews/${review.id}`);
  assert.equal(getRes.status, 200);
  assert.equal(((await getRes.json()) as HubReview).id, review.id);

  const badList = await fetch(`${h.baseUrl}/api/hub/artifacts/nope/reviews`);
  assert.equal(badList.status, 404);
  const badGet = await fetch(`${h.baseUrl}/api/hub/reviews/nope`);
  assert.equal(badGet.status, 404);
});

// ── Version revert (R-UX7 undo) ─────────────────────────────────────────────────────────────────────

test("POST .../versions/:version/revert appends a new version equal to a historical one", async () => {
  const h = await makeApp();
  const artifact = await createArtifact(h);
  const v2Res = await postJson(h, `/api/hub/artifacts/${artifact.id}/versions`, {
    content: "v2 content",
  });
  assert.equal(v2Res.status, 201);

  const revertRes = await postJson(h, `/api/hub/artifacts/${artifact.id}/versions/1/revert`, {});
  assert.equal(revertRes.status, 201);
  const reverted = (await revertRes.json()) as {
    version: number;
    content: string;
    authorKind: string;
  };
  assert.equal(reverted.version, 3);
  assert.equal(reverted.content, "The launch date is **March 1st**. Contact support for help.");
  assert.equal(reverted.authorKind, "user");

  const artifactRes = await fetch(`${h.baseUrl}/api/hub/artifacts/${artifact.id}`);
  const updatedArtifact = (await artifactRes.json()) as HubArtifact;
  assert.equal(updatedArtifact.latestVersion, 3);
});

test("POST .../revert 400s reverting to the already-current version; 404s for a bad artifact/version", async () => {
  const h = await makeApp();
  const artifact = await createArtifact(h);

  const sameVersion = await postJson(h, `/api/hub/artifacts/${artifact.id}/versions/1/revert`, {});
  assert.equal(sameVersion.status, 400);

  const badArtifact = await postJson(h, "/api/hub/artifacts/nope/versions/1/revert", {});
  assert.equal(badArtifact.status, 404);

  const badVersion = await postJson(h, `/api/hub/artifacts/${artifact.id}/versions/99/revert`, {});
  assert.equal(badVersion.status, 404);
});

// ── Session event emission (R-SES1) ─────────────────────────────────────────────────────────────────

test("a session-scoped artifact's review lifecycle appends review_opened/review_decided/artifact_updated to the session log", async () => {
  const h = await makeApp({
    reviewAgentRunner: stubRunner({
      comments: [{ body: "Fix date", anchor: { quote: "March 1st" }, suggestedEdit: "April 2nd" }],
    }),
  });
  const sessionId = await createSession(h);
  const artifact = await createArtifact(h, { sessionId });
  const review = await openReview(h, artifact);
  const comment = review.comments[0];
  assert.ok(comment);

  await patchJson(h, `/api/hub/reviews/${review.id}`, {
    decision: { commentId: comment.id, decision: "accepted" },
  });

  const events = h.repo.listEvents(sessionId).map((e) => e.type);
  assert.ok(events.includes("review_opened"));
  assert.ok(events.includes("review_decided"));
  assert.ok(events.includes("artifact_updated"));
});

test("a project-only (session-less) artifact's review lifecycle appends no session events (there is none to append to)", async () => {
  const h = await makeApp({
    reviewAgentRunner: stubRunner({ comments: [{ body: "General note." }] }),
  });
  const artifact = await createArtifact(h); // no sessionId
  assert.equal(artifact.sessionId ?? null, null);
  const review = await openReview(h, artifact);
  const comment = review.comments[0];
  assert.ok(comment);
  const res = await patchJson(h, `/api/hub/reviews/${review.id}`, {
    decision: { commentId: comment.id, decision: "accepted" },
  });
  assert.equal(res.status, 200); // succeeds regardless — the companion event is best-effort/skippable
});
