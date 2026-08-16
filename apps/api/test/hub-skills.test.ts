// Assistant Hub (roadmap/assistant-hub/, WP2.4, R-SK1…R-SK6/R-SK8) — skill attachment: resolution +
// frontmatter superset, the R-SK1 L1 listing budget/demotion, the `skills.load` built-in (enum-
// constrained, dedupe, compaction-protection budgets), role-level preload (R-SK3), session-level
// repository CRUD (`hub_session_skills`), and the `GET`/`PUT .../sessions/:id/skills` routes.
//
// Proves (acceptance):
//   1. Attachment resolves latest/pinned correctly and skips gracefully when unresolvable.
//   2. R-SK4 frontmatter superset (when_to_use/context/agent/model/effort/paths/metadata.*/extra) is
//      surfaced from the raw YAML the registry's own manifest parser does not model.
//   3. R-SK1: zero (or all-`user_only`) skills → no catalog at all; over-budget catalogs demote the
//      LEAST-recently-invoked `model_invocable` entry first; a manual `name_only`/`user_only` entry is
//      never further "demoted" or ever listed, respectively.
//   4. R-SK2: `skills.load` is enum-constrained (only catalog names are valid); dedupe on
//      re-invocation; the 5K/skill · 25K/session compaction-protection budgets are enforced.
//   5. R-SK3: role-level skills preload FULL L2 bodies (no catalog, no budget) into the agent brief;
//      an unresolvable skill id is skipped, never blocks the brief.
//   6. R-SK5: session-true usage (L1 always + L2/L3 realized) itemizes per skill from the event log.
//   7. R-SK8: version pinning (latest vs. pinned) round-trips through the repository + routes.
//   8. Domain: skills are read + metered, NEVER executed — no code path here spawns/evals content.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type {
  HubEvent,
  HubResolvedSkillAttachment,
  HubSkillInvocationMode,
  Skill,
  SkillFileContent,
  SkillFileNode,
  SkillVersion,
} from "@mcp-token-footprint/shared";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { getTokenCounter } from "../src/token-counting/profiles.js";
import { HubRepository } from "../src/hub/repository.js";
import { registerHubRoutes } from "../src/hub/routes.js";
import { HubSessionService, type HubModelResolver } from "../src/hub/session-service.js";
import {
  computeSessionSkillUsage,
  computeSkillListing,
  formatRoleSkillsContent,
  invocationOrderFromLoads,
  reconstructLoadedSkills,
  resolveHubSkillAttachment,
  resolveHubSkillAttachments,
  type HubSkillReader,
  type SkillLoadModelContent,
} from "../src/hub/skill-attachments.js";
import { createSkillsLoadBuiltin, type SkillLoadBudgets } from "../src/hub/tools/skills-load.js";
import { safeExecuteBuiltin, type HubToolExecutionContext } from "../src/hub/tools/types.js";
import { ProviderRepository } from "../src/providers/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { ensureHubWorkspaceRoot } from "../src/hub/workspace.js";
import { toErrorMessage } from "../src/utils/errors.js";

const counter = getTokenCounter("generic_o200k");
const NOW = "2026-07-18T00:00:00.000Z";

// ── Fixtures ─────────────────────────────────────────────────────────────────────────────────────

/** A minimal in-memory `HubSkillReader` — no DB, no real `SkillRepository`. */
class FakeSkillReader implements HubSkillReader {
  private readonly skills = new Map<string, Skill>();
  private readonly versions = new Map<string, SkillVersion>();
  private readonly files = new Map<string, SkillFileNode[]>();
  private readonly contents = new Map<string, Map<string, SkillFileContent>>();

  addSkill(skill: Skill): void {
    this.skills.set(skill.id, skill);
  }

  addVersion(
    version: SkillVersion,
    entries: Array<{ node: SkillFileNode; content: SkillFileContent }>,
  ): void {
    this.versions.set(version.id, version);
    this.files.set(version.id, entries.map((e) => e.node));
    const byPath = new Map<string, SkillFileContent>();
    for (const e of entries) byPath.set(e.node.path, e.content);
    this.contents.set(version.id, byPath);
  }

  getPublic(id: string): Skill {
    const skill = this.skills.get(id);
    if (!skill) throw new Error(`no such skill: ${id}`);
    return skill;
  }
  getVersion(versionId: string): SkillVersion {
    const version = this.versions.get(versionId);
    if (!version) throw new Error(`no such version: ${versionId}`);
    return version;
  }
  listFiles(versionId: string): SkillFileNode[] {
    return this.files.get(versionId) ?? [];
  }
  getFileContent(versionId: string, filePath: string): SkillFileContent {
    const content = this.contents.get(versionId)?.get(filePath);
    if (!content) throw new Error(`no such file: ${versionId}/${filePath}`);
    return content;
  }
}

const ALPHA_SKILL_MD = `---
name: alpha-skill
description: Handles alpha tasks end to end.
when_to_use: When the user asks about alpha workflows.
context: fork
agent: alpha-specialist
model: sonnet
effort: high
paths:
  - references/alpha.md
metadata:
  version: "2.1.0"
  author: Ada
custom_field: custom-value
---

# Alpha Skill

This is the alpha skill body used for L2 loading.
`;

const ALPHA_REFERENCE = "# Alpha reference\n\nExtra detail for alpha.\n";

function skillFixture(id: string, name: string): Skill {
  return {
    id,
    name,
    displayName: name,
    slug: name,
    sourceType: "upload",
    description: `${name} description`,
    currentVersionId: `${id}-v2`,
    versionCount: 2,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function versionFixture(
  id: string,
  skillId: string,
  seq: number,
  versionLabel: string,
  manifestOverrides: Partial<SkillVersion["manifest"]> = {},
): SkillVersion {
  return {
    tokenProfile: "generic_o200k",
    l1MetadataTokens: 5,
    l2BodyTokens: 20,
    l3ResourceTokens: 10,
    totalTokens: 35,
    id,
    skillId,
    seq,
    versionLabel,
    treeSha: `sha-${seq}`,
    sourceKind: "upload",
    manifest: { name: skillId, description: `${skillId} v${seq} description`, ...manifestOverrides },
    manifestValid: true,
    manifestErrors: [],
    fileCount: 2,
    totalBytes: 500,
    importedFrom: "upload",
    createdAt: NOW,
  };
}

function skillMdNode(): SkillFileNode {
  return { path: "SKILL.md", size: ALPHA_SKILL_MD.length, isBinary: false, isSkillMd: true, kind: "skill_md", tokenTotal: 20 };
}
function refNode(p: string, size: number): SkillFileNode {
  return { path: p, size, isBinary: false, isSkillMd: false, kind: "reference", tokenTotal: 10 };
}

function buildAlphaReader(): FakeSkillReader {
  const reader = new FakeSkillReader();
  reader.addSkill(skillFixture("alpha", "Alpha Skill"));
  reader.addVersion(versionFixture("alpha-v1", "alpha", 1, "v1"), [
    { node: skillMdNode(), content: { path: "SKILL.md", isBinary: false, text: ALPHA_SKILL_MD, tokenTotal: 20 } },
  ]);
  reader.addVersion(
    versionFixture("alpha-v2", "alpha", 2, "v2", { description: "Alpha v2 — the current version." }),
    [
      { node: skillMdNode(), content: { path: "SKILL.md", isBinary: false, text: ALPHA_SKILL_MD, tokenTotal: 20 } },
      {
        node: refNode("references/alpha.md", ALPHA_REFERENCE.length),
        content: { path: "references/alpha.md", isBinary: false, text: ALPHA_REFERENCE, tokenTotal: 10 },
      },
    ],
  );
  return reader;
}

// A plain HubResolvedSkillAttachment builder — bypasses the reader entirely for the listing-budget
// tests, which only need the resolved SHAPE, not real registry data.
function fakeResolved(
  skillId: string,
  name: string,
  description: string,
  invocationMode: HubSkillInvocationMode = "model_invocable",
): HubResolvedSkillAttachment {
  return {
    skillId,
    versionMode: "latest",
    invocationMode,
    skillName: name,
    skillDescription: description,
    versionId: `${skillId}-v1`,
    versionLabel: "v1",
    isLatest: true,
    footprint: { tokenProfile: "generic_o200k", l1MetadataTokens: 1, l2BodyTokens: 1, l3ResourceTokens: 0, totalTokens: 2 },
    frontmatter: {},
  };
}

// ── (1)/(2) Attachment resolution + R-SK4 frontmatter superset ─────────────────────────────────────

test("resolveHubSkillAttachment — latest resolves currentVersionId; pinned resolves the fixed version", () => {
  const reader = buildAlphaReader();
  const latest = resolveHubSkillAttachment(reader, {
    skillId: "alpha",
    versionMode: "latest",
    invocationMode: "model_invocable",
  });
  assert.ok(latest);
  assert.equal(latest?.versionId, "alpha-v2");
  assert.equal(latest?.isLatest, true);

  const pinned = resolveHubSkillAttachment(reader, {
    skillId: "alpha",
    versionMode: "pinned",
    pinnedVersionId: "alpha-v1",
    invocationMode: "model_invocable",
  });
  assert.ok(pinned);
  assert.equal(pinned?.versionId, "alpha-v1");
  assert.equal(pinned?.isLatest, false);
});

test("resolveHubSkillAttachment — an unresolvable skill/version is skipped, never throws", () => {
  const reader = buildAlphaReader();
  assert.equal(
    resolveHubSkillAttachment(reader, { skillId: "missing", versionMode: "latest", invocationMode: "model_invocable" }),
    null,
  );
  assert.equal(
    resolveHubSkillAttachment(reader, {
      skillId: "alpha",
      versionMode: "pinned",
      pinnedVersionId: "does-not-exist",
      invocationMode: "model_invocable",
    }),
    null,
  );
});

test("resolveHubSkillAttachments — drops unresolvable entries, keeps order of the rest", () => {
  const reader = buildAlphaReader();
  const resolved = resolveHubSkillAttachments(reader, [
    { skillId: "missing", versionMode: "latest", invocationMode: "model_invocable" },
    { skillId: "alpha", versionMode: "latest", invocationMode: "model_invocable" },
  ]);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0]?.skillId, "alpha");
});

test("R-SK4 — frontmatter superset surfaces when_to_use/context/agent/model/effort/paths/metadata/extra", () => {
  const reader = buildAlphaReader();
  const resolved = resolveHubSkillAttachment(reader, {
    skillId: "alpha",
    versionMode: "latest",
    invocationMode: "model_invocable",
  });
  assert.ok(resolved);
  const fm = resolved?.frontmatter;
  assert.equal(fm?.whenToUse, "When the user asks about alpha workflows.");
  assert.equal(fm?.context, "fork");
  assert.equal(fm?.agent, "alpha-specialist");
  assert.equal(fm?.model, "sonnet");
  assert.equal(fm?.effort, "high");
  assert.deepEqual(fm?.paths, ["references/alpha.md"]);
  assert.equal(fm?.metadataVersion, "2.1.0");
  assert.equal(fm?.metadataAuthor, "Ada");
  assert.equal(fm?.extra?.custom_field, "custom-value");
});

// ── (3) R-SK1 — the L1 listing budget + least-recently-invoked demotion ────────────────────────────

test("R-SK1 — zero attachments: no catalog at all", async () => {
  const { listing, listingText } = await computeSkillListing([], {
    tokenCounter: counter,
    contextWindow: 100_000,
    budgetFraction: 0.01,
  });
  assert.equal(listingText, "");
  assert.deepEqual(listing.entries, []);
  assert.equal(listing.usedTokens, 0);
});

test("R-SK1 — every attachment user_only: excluded from the catalog entirely, no text", async () => {
  const resolved = [fakeResolved("s1", "Secret Skill", "Only reachable via slash.", "user_only")];
  const { listing, listingText } = await computeSkillListing(resolved, {
    tokenCounter: counter,
    contextWindow: 100_000,
    budgetFraction: 0.01,
  });
  assert.equal(listingText, "");
  assert.equal(listing.entries.length, 1);
  assert.equal(listing.entries[0]?.state, "excluded");
  assert.equal(listing.entries[0]?.loadable, false);
});

test("R-SK1 — under budget: every model_invocable entry stays full", async () => {
  const resolved = [fakeResolved("s1", "Skill One", "A short description."), fakeResolved("s2", "Skill Two", "Another short one.")];
  const { listing } = await computeSkillListing(resolved, {
    tokenCounter: counter,
    contextWindow: 1_000_000,
    budgetFraction: 1, // effectively unbounded
  });
  assert.ok(listing.entries.every((e) => e.state === "full"));
  assert.ok(listing.entries.every((e) => !e.demoted));
});

test("R-SK1 — a manually name_only attachment renders name-only and is never marked demoted", async () => {
  const resolved = [fakeResolved("s1", "Manual Name Only", "A description that would otherwise show.", "name_only")];
  const { listing, listingText } = await computeSkillListing(resolved, {
    tokenCounter: counter,
    contextWindow: 1_000_000,
    budgetFraction: 1,
  });
  assert.equal(listing.entries[0]?.state, "name_only");
  assert.equal(listing.entries[0]?.demoted, false, "a manual name_only is not an algorithmic demotion");
  assert.ok(!listingText.includes("A description that would otherwise show."));
  assert.ok(listingText.includes("Manual Name Only"));
});

test("R-SK1 — over budget demotes the LEAST-recently-invoked entry first (never-invoked before invoked)", async () => {
  const longDesc =
    "Handles a very long and detailed workflow that spans many teams, tools, and edge cases across the whole organization, repeated for length. ".repeat(
      3,
    );
  const a = fakeResolved("skill-a", "Skill A", longDesc);
  const b = fakeResolved("skill-b", "Skill B", longDesc);

  // Self-derive the budget from the SAME counter, so the assertion is tokenizer-agnostic: measure the
  // "both full" cost, then the "one demoted" cost, and pick a budget that fits exactly the latter.
  const bothFull = await computeSkillListing([a, b], {
    tokenCounter: counter,
    contextWindow: 1_000_000,
    budgetFraction: 1,
  });
  // A is the one the algorithm will ACTUALLY demote first (never-invoked ranks below B's rank 0) —
  // derive the budget from THAT arrangement so BPE order-sensitivity can't shift the token count.
  const oneDemoted = await computeSkillListing([{ ...a, invocationMode: "name_only" }, b], {
    tokenCounter: counter,
    contextWindow: 1_000_000,
    budgetFraction: 1,
  });
  assert.ok(oneDemoted.listing.usedTokens < bothFull.listing.usedTokens, "sanity: demoting one saves tokens");

  // A budget that fits "one demoted" but not "both full" — contextWindow = that exact token count,
  // budgetFraction 1 so budgetTokens === contextWindow.
  const contextWindow = oneDemoted.listing.usedTokens;
  // B was invoked (rank 0); A was NEVER invoked (absent from invocationOrder → ranks before B).
  const result = await computeSkillListing([a, b], {
    tokenCounter: counter,
    contextWindow,
    budgetFraction: 1,
    invocationOrder: ["skill-b"],
  });
  const aEntry = result.listing.entries.find((e) => e.skillId === "skill-a");
  const bEntry = result.listing.entries.find((e) => e.skillId === "skill-b");
  assert.equal(aEntry?.state, "name_only", "never-invoked A demotes first");
  assert.equal(aEntry?.demoted, true);
  assert.equal(bEntry?.state, "full", "recently-invoked B stays full once the budget is met");
  assert.ok(result.listing.usedTokens <= result.listing.budgetTokens);
});

// ── (4) R-SK2 — `skills.load`: enum-constrained, dedupe, compaction-protection budgets ─────────────

const databases: AppDatabase[] = [];
const tempDirs: string[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function openRepo(): HubRepository {
  const db = new Database(":memory:") as unknown as AppDatabase;
  databases.push(db);
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  return new HubRepository(db);
}

/** `hub_session_skills.skill_id`/`hub_agents` skill attachments are FK-referenced to `skills(id)`
 *  (mirrors `scenario_skills` — a live attachment cascades when its skill is deleted). Seed a minimal
 *  real row so a repository/route test can attach it without touching the Skills feature's own
 *  ingest path. */
function seedSkillRow(db: AppDatabase, id: string): void {
  db.prepare(
    `INSERT INTO skills (id, name, display_name, slug, source_type, created_at, updated_at)
     VALUES (@id, @id, @id, @id, 'upload', @now, @now)`,
  ).run({ id, now: NOW });
}

/** A minimal `skill_versions` row (for a `pinned_version_id` FK — the caller must seed the parent
 *  `skills` row first via {@link seedSkillRow}). */
function seedSkillVersionRow(db: AppDatabase, versionId: string, skillId: string): void {
  db.prepare(
    `INSERT INTO skill_versions
       (id, skill_id, seq, version_label, tree_sha, source_kind, manifest_json, token_profile,
        file_count, total_bytes, imported_from, created_at)
     VALUES (@id, @skillId, 1, 'v1', 'sha', 'upload', '{}', 'generic_o200k', 0, 0, 'upload', @now)`,
  ).run({ id: versionId, skillId, now: NOW });
}

function tempWorkspace(sessionId: string): string {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-skills-test-"));
  tempDirs.push(dataDir);
  return ensureHubWorkspaceRoot(dataDir, sessionId);
}

function makeCtx(repository?: HubRepository): { ctx: HubToolExecutionContext; repo: HubRepository; sessionId: string } {
  const repo = repository ?? openRepo();
  const session = repo.createSession({ mode: "chat", model: "test-model" });
  return {
    ctx: {
      sessionId: session.id,
      workspaceRoot: tempWorkspace(session.id),
      repository: repo,
      tokenCounter: counter,
    },
    repo,
    sessionId: session.id,
  };
}

/** Simulate a PRIOR `skills.load` call already persisted (the turn engine's job in production) — the
 *  dedupe/budget tests need this to exercise the built-in's own `reconstructLoadedSkills` read. */
function persistPriorLoad(repo: HubRepository, sessionId: string, toolCallId: string, result: SkillLoadModelContent): void {
  repo.appendEvent(sessionId, {
    type: "tool_call",
    part: { type: "tool_call", toolCallId, toolName: "skills.load", source: "skill", state: "output-available" },
  });
  repo.appendEvent(sessionId, { type: "tool_result", toolCallId, state: "output-available", modelContent: result });
}

test("createSkillsLoadBuiltin — undefined when nothing is loadable", () => {
  const reader = buildAlphaReader();
  assert.equal(createSkillsLoadBuiltin([], reader), undefined);
});

test("skills.load — rejects a skill name outside the enum (never invents one)", async () => {
  const reader = buildAlphaReader();
  const resolved = resolveHubSkillAttachment(reader, { skillId: "alpha", versionMode: "latest", invocationMode: "model_invocable" });
  assert.ok(resolved);
  const tool = createSkillsLoadBuiltin([resolved as HubResolvedSkillAttachment], reader);
  assert.ok(tool);
  const { ctx } = makeCtx();
  const result = await safeExecuteBuiltin(tool!, { skill: "not-a-real-skill" }, ctx);
  assert.equal(result.isError, true);
});

test("skills.load — loads the SKILL.md body (L2, frontmatter stripped) when path is omitted", async () => {
  const reader = buildAlphaReader();
  const resolved = resolveHubSkillAttachment(reader, { skillId: "alpha", versionMode: "latest", invocationMode: "model_invocable" });
  const tool = createSkillsLoadBuiltin([resolved as HubResolvedSkillAttachment], reader);
  const { ctx } = makeCtx();
  const result = await safeExecuteBuiltin(tool!, { skill: "Alpha Skill" }, ctx);
  assert.equal(result.isError, undefined);
  const content = result.modelContent as SkillLoadModelContent;
  assert.equal(content.skillId, "alpha");
  assert.equal(content.path, "");
  assert.ok(content.content?.includes("This is the alpha skill body"));
  assert.ok(!content.content?.includes("when_to_use"), "frontmatter block is stripped from the L2 body");
  assert.ok(content.tokens > 0);
});

test("skills.load — loads a referenced L3 file by path", async () => {
  const reader = buildAlphaReader();
  const resolved = resolveHubSkillAttachment(reader, { skillId: "alpha", versionMode: "latest", invocationMode: "model_invocable" });
  const tool = createSkillsLoadBuiltin([resolved as HubResolvedSkillAttachment], reader);
  const { ctx } = makeCtx();
  const result = await safeExecuteBuiltin(tool!, { skill: "Alpha Skill", path: "references/alpha.md" }, ctx);
  assert.equal(result.isError, undefined);
  const content = result.modelContent as SkillLoadModelContent;
  assert.equal(content.path, "references/alpha.md");
  assert.ok(content.content?.includes("Extra detail for alpha"));
});

test("skills.load — rejects path traversal and unknown paths as data, never a crash", async () => {
  const reader = buildAlphaReader();
  const resolved = resolveHubSkillAttachment(reader, { skillId: "alpha", versionMode: "latest", invocationMode: "model_invocable" });
  const tool = createSkillsLoadBuiltin([resolved as HubResolvedSkillAttachment], reader);
  const { ctx } = makeCtx();

  const traversal = await safeExecuteBuiltin(tool!, { skill: "Alpha Skill", path: "../../etc/passwd" }, ctx);
  assert.equal(traversal.isError, true);

  const unknown = await safeExecuteBuiltin(tool!, { skill: "Alpha Skill", path: "nope.md" }, ctx);
  assert.equal(unknown.isError, true);
});

test("skills.load — re-invocation of the same skill/path dedupes (near-zero cost)", async () => {
  const reader = buildAlphaReader();
  const resolved = resolveHubSkillAttachment(reader, { skillId: "alpha", versionMode: "latest", invocationMode: "model_invocable" });
  const tool = createSkillsLoadBuiltin([resolved as HubResolvedSkillAttachment], reader);
  const { ctx, repo, sessionId } = makeCtx();

  persistPriorLoad(repo, sessionId, "call-1", { skillId: "alpha", skillName: "Alpha Skill", path: "", tokens: 42 });
  const result = await safeExecuteBuiltin(tool!, { skill: "Alpha Skill" }, ctx);
  const content = result.modelContent as SkillLoadModelContent;
  assert.equal(content.dedupe, true);
  assert.equal(content.tokens, 0);
});

test("skills.load — the per-skill/session compaction-protection budgets are enforced", async () => {
  const reader = buildAlphaReader();
  const resolved = resolveHubSkillAttachment(reader, { skillId: "alpha", versionMode: "latest", invocationMode: "model_invocable" });
  const tight: SkillLoadBudgets = { perSkillTokens: 5, totalTokens: 5 };
  const tool = createSkillsLoadBuiltin([resolved as HubResolvedSkillAttachment], reader, tight);
  const { ctx, repo, sessionId } = makeCtx();

  // Already at the per-skill ceiling from a PRIOR (different-path) load.
  persistPriorLoad(repo, sessionId, "call-1", { skillId: "alpha", skillName: "Alpha Skill", path: "references/alpha.md", tokens: 5 });
  const result = await safeExecuteBuiltin(tool!, { skill: "Alpha Skill" }, ctx);
  const content = result.modelContent as SkillLoadModelContent;
  assert.equal(content.tokens, 0);
  assert.ok(content.content?.includes("budget is exhausted"));
});

test("skills.load — an over-budget-but-not-exhausted load truncates and is marked truncated", async () => {
  const reader = buildAlphaReader();
  const resolved = resolveHubSkillAttachment(reader, { skillId: "alpha", versionMode: "latest", invocationMode: "model_invocable" });
  // The FULL (untruncated) load, to know what "over budget" means for this body.
  const untruncated = createSkillsLoadBuiltin([resolved as HubResolvedSkillAttachment], reader, {
    perSkillTokens: 1_000_000,
    totalTokens: 1_000_000,
  });
  const full = (await safeExecuteBuiltin(untruncated!, { skill: "Alpha Skill" }, makeCtx().ctx))
    .modelContent as SkillLoadModelContent;

  // A tiny budget the full body certainly exceeds, but > 0 so SOMETHING loads.
  const tiny: SkillLoadBudgets = { perSkillTokens: 3, totalTokens: 3 };
  const tool = createSkillsLoadBuiltin([resolved as HubResolvedSkillAttachment], reader, tiny);
  const { ctx } = makeCtx();
  const result = await safeExecuteBuiltin(tool!, { skill: "Alpha Skill" }, ctx);
  const content = result.modelContent as SkillLoadModelContent;
  assert.equal(content.truncated, true);
  assert.ok(content.tokens > 0, "something loaded");
  assert.ok(content.tokens < full.tokens, "truncated is strictly shorter than the full body");
});

// ── (5) R-SK3 — role-level preload (full body, no budget, no catalog) ──────────────────────────────

test("formatRoleSkillsContent — inlines the full L2 body per skill id, frontmatter stripped", () => {
  const reader = buildAlphaReader();
  const text = formatRoleSkillsContent(reader, ["alpha"]);
  assert.ok(text.includes("Alpha Skill"));
  assert.ok(text.includes("This is the alpha skill body"));
  assert.ok(!text.includes("when_to_use"));
});

test("formatRoleSkillsContent — an unresolvable id is skipped, never throws", () => {
  const reader = buildAlphaReader();
  const text = formatRoleSkillsContent(reader, ["missing", "alpha"]);
  assert.ok(text.includes("Alpha Skill"));
  assert.equal(text.split("###").length - 1, 1, "only the resolvable skill produced a block");
});

test("formatRoleSkillsContent — empty skillIds yields an empty string (the layer's own default applies)", () => {
  const reader = buildAlphaReader();
  assert.equal(formatRoleSkillsContent(reader, []), "");
});

// ── (6) R-SK5 — session-true usage from the event log ───────────────────────────────────────────────

test("reconstructLoadedSkills — extracts skills.load tool_result pairs, ignores other tools/states", () => {
  const events: HubEvent[] = [
    { type: "tool_call", part: { type: "tool_call", toolCallId: "c1", toolName: "skills.load", source: "skill", state: "output-available" } },
    { type: "tool_result", toolCallId: "c1", state: "output-available", modelContent: { skillId: "alpha", path: "", tokens: 12 } },
    { type: "tool_call", part: { type: "tool_call", toolCallId: "c2", toolName: "files.read", source: "builtin", state: "output-available" } },
    { type: "tool_result", toolCallId: "c2", state: "output-available", modelContent: { path: "x", content: "y" } },
    { type: "tool_call", part: { type: "tool_call", toolCallId: "c3", toolName: "skills.load", source: "skill", state: "output-denied" } },
    { type: "tool_result", toolCallId: "c3", state: "output-denied" },
  ];
  const records = reconstructLoadedSkills(events);
  assert.equal(records.length, 1);
  assert.deepEqual(records[0], { skillId: "alpha", path: "", tokens: 12 });
});

test("invocationOrderFromLoads — oldest-invoked-first, dedupes repeat loads by FIRST occurrence", () => {
  const order = invocationOrderFromLoads([
    { skillId: "b", path: "", tokens: 1 },
    { skillId: "a", path: "", tokens: 1 },
    { skillId: "b", path: "SKILL.md", tokens: 1 }, // re-invocation of b — doesn't move it
  ]);
  assert.deepEqual(order, ["b", "a"]);
});

test("computeSessionSkillUsage — itemizes L1 (listing) + L2 (path '') + L3 (other paths) per skill", () => {
  const resolved = [fakeResolved("alpha", "Alpha", "desc"), fakeResolved("beta", "Beta", "desc")];
  const listing = {
    entries: [
      { skillId: "alpha", name: "Alpha", state: "full" as const, demoted: false, loadable: true, tokens: 8 },
      { skillId: "beta", name: "Beta", state: "name_only" as const, demoted: true, loadable: true, tokens: 2 },
    ],
    budgetTokens: 10,
    usedTokens: 10,
    contextWindow: 1000,
  };
  const loaded = [
    { skillId: "alpha", path: "", tokens: 30 }, // L2
    { skillId: "alpha", path: "references/alpha.md", tokens: 15 }, // L3
  ];
  const usage = computeSessionSkillUsage(resolved, listing, loaded);
  const alpha = usage.find((u) => u.skillId === "alpha");
  const beta = usage.find((u) => u.skillId === "beta");
  assert.equal(alpha?.l1Tokens, 8);
  assert.equal(alpha?.l2Tokens, 30);
  assert.equal(alpha?.l3Tokens, 15);
  assert.equal(alpha?.totalTokens, 53);
  assert.equal(alpha?.invoked, true);
  assert.deepEqual(alpha?.loadedPaths, ["SKILL.md", "references/alpha.md"]);
  assert.equal(beta?.l1Tokens, 2);
  assert.equal(beta?.invoked, false);
  assert.deepEqual(beta?.loadedPaths, []);
});

// ── (7)/(8) Repository CRUD + routes ─────────────────────────────────────────────────────────────

test("HubRepository.replaceSessionSkills — round-trips + delete-then-reinsert semantics + defaults", () => {
  const db = new Database(":memory:") as unknown as AppDatabase;
  databases.push(db);
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  seedSkillRow(db, "alpha");
  seedSkillRow(db, "beta");
  seedSkillVersionRow(db, "beta-v1", "beta");
  const repo = new HubRepository(db);
  const session = repo.createSession({ mode: "chat", model: "test-model" });
  assert.deepEqual(repo.listSessionSkills(session.id), []);

  const written = repo.replaceSessionSkills(session.id, [
    { skillId: "alpha" }, // defaults: versionMode "latest", invocationMode "model_invocable"
    { skillId: "beta", versionMode: "pinned", pinnedVersionId: "beta-v1", invocationMode: "user_only" },
  ]);
  assert.deepEqual(written, [
    { skillId: "alpha", versionMode: "latest", invocationMode: "model_invocable" },
    { skillId: "beta", versionMode: "pinned", pinnedVersionId: "beta-v1", invocationMode: "user_only" },
  ]);
  assert.deepEqual(repo.listSessionSkills(session.id), written);

  // Replacing again with a SUBSET drops what's not listed (whole-list replace, not a merge).
  const replaced = repo.replaceSessionSkills(session.id, [{ skillId: "alpha", invocationMode: "name_only" }]);
  assert.equal(replaced.length, 1);
  assert.equal(replaced[0]?.invocationMode, "name_only");
});

test("hub_agents (role library) — skills round-trip with version pin + defaults (R-SK8)", () => {
  const repo = openRepo();
  const role = repo.createAgentRole({
    name: "Researcher",
    systemPrompt: "You research.",
    defaultModel: "claude-opus-4-8",
    skills: [
      { skillId: "alpha" },
      { skillId: "beta", versionMode: "pinned", pinnedVersionId: "beta-v3" },
    ],
    target: "Find sources",
    expectedOutcome: "A findings list",
  });
  assert.deepEqual(role.skills, [
    { skillId: "alpha", versionMode: "latest", invocationMode: "model_invocable" },
    { skillId: "beta", versionMode: "pinned", pinnedVersionId: "beta-v3", invocationMode: "model_invocable" },
  ]);

  const updated = repo.updateAgentRole(role.id, { skills: [{ skillId: "gamma", invocationMode: "name_only" }] });
  assert.deepEqual(updated.skills, [{ skillId: "gamma", versionMode: "latest", invocationMode: "name_only" }]);
});

// ── Routes harness ───────────────────────────────────────────────────────────────────────────────

const harnesses: FastifyInstance[] = [];
afterEach(async () => {
  for (const app of harnesses.splice(0)) await app.close();
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-skills-routes-"));
  tempDirs.push(dir);
  return dir;
}

const stubResolveModel: HubModelResolver = () => ({
  providerKind: "anthropic",
  modelId: "test-model",
  contextWindow: 100_000,
});

async function makeApp(
  skillReader?: HubSkillReader,
): Promise<{ app: FastifyInstance; baseUrl: string; repo: HubRepository; db: AppDatabase }> {
  const db = openDb();
  const secrets = new SecretStore(crypto.randomBytes(32));
  const providerRepository = new ProviderRepository(db, secrets);
  const repo = new HubRepository(db);
  const service = new HubSessionService({
    repository: repo,
    tokenCounter: counter,
    resolveToolset: () => ({ tools: {} }),
    resolveModel: stubResolveModel,
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
    ...(skillReader ? { skillReader } : {}),
    skillListingBudgetFraction: 0.01,
    skillEntryMaxChars: 1536,
    tokenCounter: counter,
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  harnesses.push(app);
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { app, baseUrl: `http://127.0.0.1:${port}`, repo, db };
}

test("GET /api/hub/sessions/:id/skills — empty before any attachment", async () => {
  const { baseUrl, repo } = await makeApp(buildAlphaReader());
  const session = repo.createSession({ mode: "chat", model: "test-model" });
  const res = await fetch(`${baseUrl}/api/hub/sessions/${session.id}/skills`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { attachments: unknown[]; listing: { entries: unknown[] }; usage: unknown[] };
  assert.deepEqual(body.attachments, []);
  assert.deepEqual(body.listing.entries, []);
  assert.deepEqual(body.usage, []);
});

test("PUT then GET /api/hub/sessions/:id/skills — attaches, resolves, and reflects the listing state", async () => {
  const { baseUrl, repo, db } = await makeApp(buildAlphaReader());
  seedSkillRow(db, "alpha"); // hub_session_skills.skill_id is FK-referenced to skills(id)
  // A real MODEL_CONTEXT_LIMITS entry (1M window) so the L1 budget is generous — "test-model" resolves
  // to a 0-token context window (an honest unknown-model degrade — see registerHubSessionSkillRoutes'
  // own doc), which would demote this single short entry immediately and defeat the assertion below.
  const session = repo.createSession({ mode: "chat", model: "claude-opus-4-8" });

  const putRes = await fetch(`${baseUrl}/api/hub/sessions/${session.id}/skills`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify([{ skillId: "alpha" }]),
  });
  assert.equal(putRes.status, 200);
  const putBody = (await putRes.json()) as { attachments: Array<{ skillId: string; versionId: string }> };
  assert.equal(putBody.attachments.length, 1);
  assert.equal(putBody.attachments[0]?.skillId, "alpha");
  assert.equal(putBody.attachments[0]?.versionId, "alpha-v2", "resolved to the LATEST version");

  const getRes = await fetch(`${baseUrl}/api/hub/sessions/${session.id}/skills`);
  const getBody = (await getRes.json()) as {
    attachments: Array<{ skillId: string }>;
    listing: { entries: Array<{ skillId: string; state: string }> };
  };
  assert.equal(getBody.attachments.length, 1);
  assert.equal(getBody.listing.entries[0]?.skillId, "alpha");
  assert.equal(getBody.listing.entries[0]?.state, "full");
});

test("PUT /api/hub/sessions/:id/skills — rejects a pinned attachment with no pinnedVersionId", async () => {
  const { baseUrl, repo } = await makeApp(buildAlphaReader());
  const session = repo.createSession({ mode: "chat", model: "test-model" });
  const res = await fetch(`${baseUrl}/api/hub/sessions/${session.id}/skills`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify([{ skillId: "alpha", versionMode: "pinned" }]),
  });
  assert.equal(res.status, 400);
});

test("PUT /api/hub/sessions/:id/skills — 404 for an unknown session", async () => {
  const { baseUrl } = await makeApp(buildAlphaReader());
  const res = await fetch(`${baseUrl}/api/hub/sessions/does-not-exist/skills`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify([]),
  });
  assert.equal(res.status, 404);
});
