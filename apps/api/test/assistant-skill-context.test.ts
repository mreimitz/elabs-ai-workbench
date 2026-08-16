import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, test } from "node:test";
import type { AssistantContextEnvelope } from "@mcp-token-footprint/shared";
import { AssistantRepository } from "../src/assistant/repository.js";
import {
  AssistantSessionManager,
  type AssistantSessionConfig,
  type AssistantSessionManagerDeps,
} from "../src/assistant/session-manager.js";
import type {
  AgentSessionDriver,
  DriverEvent,
  DriverSession,
  DriverStartOptions,
  DriverUserMessage,
} from "../src/assistant/session-driver.js";
import { config as appConfig } from "../src/config/env.js";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { ProviderRepository } from "../src/providers/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { SkillRepository } from "../src/skills/repository.js";

// Assistant Refinement R1 (WP R1.2, D-AS20/D-AS21) — skill-structure awareness (the <skill-context>
// block injected into the per-message prompt on skill scope) + the bundled read-only skill-authoring
// reference (added to additionalDirectories on skill scope). Entirely offline: a SCRIPTED FAKE driver
// (mirrors assistant-session.test.ts's harness) — NO SDK, NO child process, NO Anthropic call.

// ── A tiny pushable async iterable (the fake's normalized event stream) — SDK-free ────────────────
class Pushable<T> implements AsyncIterable<T> {
  private readonly buffer: T[] = [];
  private readonly waiters: Array<(r: IteratorResult<T>) => void> = [];
  private ended = false;
  push(item: T): void {
    if (this.ended) return;
    const w = this.waiters.shift();
    if (w) w({ value: item, done: false });
    else this.buffer.push(item);
  }
  end(): void {
    if (this.ended) return;
    this.ended = true;
    let w = this.waiters.shift();
    while (w) {
      w({ value: undefined as unknown as T, done: true });
      w = this.waiters.shift();
    }
  }
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const b = this.buffer.shift();
        if (b !== undefined) return Promise.resolve({ value: b, done: false });
        if (this.ended) return Promise.resolve({ value: undefined as unknown as T, done: true });
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

type TurnScript = (ctx: { text: string; turn: number; emit: (event: DriverEvent) => void }) => void;

class FakeSession implements DriverSession {
  private readonly out = new Pushable<DriverEvent>();
  readonly startOptions: DriverStartOptions;
  readonly sentTexts: string[] = [];
  private turn = 0;
  private sid: string;
  constructor(
    options: DriverStartOptions,
    private readonly script: TurnScript,
    sessionId: string,
  ) {
    this.startOptions = options;
    this.sid = sessionId;
    this.out.push({ type: "session", sessionId });
    options.abortController.signal.addEventListener("abort", () => this.out.end(), { once: true });
  }
  get events(): AsyncIterable<DriverEvent> {
    return this.out;
  }
  send(message: DriverUserMessage): void {
    this.sentTexts.push(message.text);
    const turn = this.turn++;
    this.script({ text: message.text, turn, emit: (event) => this.out.push(event) });
  }
  async interrupt(): Promise<void> {
    this.out.push({ type: "turn_done" });
  }
  sessionId(): string | undefined {
    return this.sid;
  }
}

class FakeDriver implements AgentSessionDriver {
  readonly starts: FakeSession[] = [];
  private counter = 0;
  constructor(private readonly script: TurnScript) {}
  start(options: DriverStartOptions): DriverSession {
    const session = new FakeSession(options, this.script, `sdk-sess-${++this.counter}`);
    this.starts.push(session);
    return session;
  }
}

const echoScript: TurnScript = ({ turn, emit }) => {
  emit({ type: "assistant_message", text: `answer-${turn}` });
  emit({ type: "turn_done", turnIndex: turn });
};

// ── Harness ───────────────────────────────────────────────────────────────────────────────────────
const databases: AppDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function createDatabase(): AppDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  databases.push(db);
  return db;
}

type Harness = {
  db: AppDatabase;
  repo: AssistantRepository;
  skills: SkillRepository;
  manager: AssistantSessionManager;
  driver: FakeDriver;
};

/** The real, shipped skill-authoring resources dir (apps/api/resources/skill-authoring), resolved the
 *  SAME way apps/api/src/config/env.ts resolves it by default — used so these tests exercise the ACTUAL
 *  bundled content, not a synthetic fixture. */
const REAL_SKILL_AUTHORING_DIR = appConfig.assistantSkillAuthoringDir;

function makeHarness(
  script: TurnScript,
  opts: {
    configOverrides?: Partial<AssistantSessionConfig>;
    /** Omit to test the "no SkillRepository wired" graceful-degradation path. */
    wireSkills?: boolean;
  } = {},
): Harness {
  const db = createDatabase();
  const secrets = new SecretStore(Buffer.alloc(32, 7));
  const repo = new AssistantRepository(db, secrets);
  const providers = new ProviderRepository(db, secrets);
  repo.createCredential({ kind: "claude_oauth", token: "sk-ant-oat01-testtoken1234" });
  const skills = new SkillRepository(db, secrets);

  const driver = new FakeDriver(script);
  const deps: AssistantSessionManagerDeps = {
    repository: repo,
    providers,
    driver,
    buildTools: () => ({}),
    config: {
      maxTurns: 50,
      idleTimeoutMs: 60_000,
      maxActiveSessions: 2,
      assistantDataDir: `/tmp/mcp-assistant-skillctx-${Math.random().toString(36).slice(2)}`,
      permissionTimeoutMs: 300_000,
      assistantSkillAuthoringDir: REAL_SKILL_AUTHORING_DIR,
      // R2.2 (D-AS25/D-AS26) required fields — sync release (grace 0, the production default) + titling off.
      releaseGraceMs: 0,
      autoTitle: false,
      titleModel: "claude-haiku-4-5",
      titleTimeoutMs: 15_000,
      ...opts.configOverrides,
    },
    ...(opts.wireSkills === false ? {} : { skills }),
  };
  const manager = new AssistantSessionManager(deps);
  return { db, repo, skills, manager, driver };
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) await delay(5);
  if (!predicate()) throw new Error("waitFor timed out");
}

const skillScope = (skillId: string): AssistantContextEnvelope => ({
  route: `/skills/${skillId}`,
  entityKind: "skill",
  entityId: skillId,
});

const runScope = (runId: string): AssistantContextEnvelope => ({
  route: `/testing/runs/${runId}`,
  entityKind: "run",
  entityId: runId,
});

const SKILL_MD = "---\nname: pdf-tools\ndescription: Work with PDFs\n---\nBody text for pdf-tools.";

function makeSkillWithVersion(
  skills: SkillRepository,
  files: Array<{ path: string; text: string }> = [{ path: "SKILL.md", text: SKILL_MD }],
) {
  const skill = skills.create({
    name: "pdf-tools",
    sourceType: "upload",
    description: "Work with PDFs",
  });
  const result = skills.createVersion(
    skill.id,
    files.map((f) => ({ path: f.path, bytes: Buffer.from(f.text, "utf8") })),
    {
      sourceKind: "upload",
      importedFrom: "upload",
      manifest: { name: "pdf-tools", description: "Work with PDFs" },
    },
  );
  if (result.unchanged) throw new Error("fixture setup expected a fresh version");
  return { skill, versionId: result.version.id };
}

// ── The bundled resource dir itself ──────────────────────────────────────────────────────────────

test("the bundled skill-authoring resource dir + its SKILL.md/references are present on disk and readable", () => {
  const skillMdPath = path.join(REAL_SKILL_AUTHORING_DIR, "skill-creator", "SKILL.md");
  const referencesDir = path.join(REAL_SKILL_AUTHORING_DIR, "skill-creator", "references");
  assert.ok(fs.existsSync(skillMdPath), `expected ${skillMdPath} to exist`);
  const skillMdText = fs.readFileSync(skillMdPath, "utf8");
  assert.ok(skillMdText.length > 0, "SKILL.md is non-empty");
  assert.match(skillMdText, /name: skill-creator/, "carries the expected frontmatter name");

  assert.ok(fs.existsSync(referencesDir), `expected ${referencesDir} to exist`);
  const referenceFiles = fs.readdirSync(referencesDir);
  assert.ok(referenceFiles.length > 0, "references/ has at least one file");
  for (const file of referenceFiles) {
    const text = fs.readFileSync(path.join(referencesDir, file), "utf8");
    assert.ok(text.length > 0, `${file} is non-empty`);
  }
});

// ── additionalDirectories wiring ─────────────────────────────────────────────────────────────────

test("skill scope adds the skill-authoring resources dir to additionalDirectories (alongside the workspace root)", async () => {
  const h = makeHarness(echoScript);
  const { skill } = makeSkillWithVersion(h.skills);
  const thread = h.manager.createThread({});
  await h.manager.sendMessage(thread.id, "hi", skillScope(skill.id));
  await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"));

  const dirs = h.driver.starts[0]?.startOptions.additionalDirectories ?? [];
  assert.equal(dirs.length, 2, "workspace root + the skill-authoring reference dir");
  assert.ok(dirs.includes(REAL_SKILL_AUTHORING_DIR), "the resources dir is present");
});

test("non-skill scope does NOT add the skill-authoring resources dir to additionalDirectories", async () => {
  const h = makeHarness(echoScript);
  const thread = h.manager.createThread({});
  await h.manager.sendMessage(thread.id, "hi", runScope("run-1"));
  await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"));

  const dirs = h.driver.starts[0]?.startOptions.additionalDirectories ?? [];
  assert.equal(dirs.length, 1, "only the workspace root");
  assert.ok(
    !dirs.includes(REAL_SKILL_AUTHORING_DIR),
    "the resources dir is NOT present outside skill scope",
  );
});

test("unscoped (no envelope) does NOT add the skill-authoring resources dir either", async () => {
  const h = makeHarness(echoScript);
  const thread = h.manager.createThread({});
  await h.manager.sendMessage(thread.id, "hi"); // no envelope at all
  await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"));

  const dirs = h.driver.starts[0]?.startOptions.additionalDirectories ?? [];
  assert.equal(dirs.length, 1);
  assert.ok(!dirs.includes(REAL_SKILL_AUTHORING_DIR));
});

test("when assistantSkillAuthoringDir is unset, skill scope still starts fine without the dir (defensive default)", async () => {
  const h = makeHarness(echoScript, { configOverrides: { assistantSkillAuthoringDir: undefined } });
  const { skill } = makeSkillWithVersion(h.skills);
  const thread = h.manager.createThread({});
  await h.manager.sendMessage(thread.id, "hi", skillScope(skill.id));
  await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"));

  const dirs = h.driver.starts[0]?.startOptions.additionalDirectories ?? [];
  assert.equal(
    dirs.length,
    1,
    "no crash — just the workspace root, since no resources dir was configured",
  );
});

// ── <skill-context> injection into the per-message prompt ──────────────────────────────────────────

test("skill scope: the sent prompt carries the file tree + rendered SKILL.md + guide paths + read-all instruction", async () => {
  const h = makeHarness(echoScript);
  const { skill, versionId } = makeSkillWithVersion(h.skills, [
    { path: "SKILL.md", text: SKILL_MD },
    { path: "references/notes.md", text: "extra detail" },
  ]);
  const thread = h.manager.createThread({});
  await h.manager.sendMessage(
    thread.id,
    "enhance this skill from recent runs",
    skillScope(skill.id),
  );
  await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"));

  const sent = h.driver.starts[0]?.sentTexts[0] ?? "";
  assert.match(sent, /<skill-context>/);
  assert.match(sent, /<\/skill-context>/);
  assert.match(sent, /Active skill: "pdf-tools"/);
  assert.match(sent, new RegExp(`id ${skill.id}`));
  assert.match(sent, /SKILL\.md \(rendered\):/);
  assert.match(sent, /Body text for pdf-tools\./, "the SKILL.md body content is inlined");
  assert.match(sent, /- SKILL\.md \(\d+ bytes\)/, "the file tree lists SKILL.md with a size");
  assert.match(
    sent,
    /- references\/notes\.md \(\d+ bytes\)/,
    "the file tree lists the nested reference file",
  );
  assert.match(sent, /references\//, "instructs reading everything under references/");
  assert.match(sent, /skill-creator\/SKILL\.md/, "names the bundled skill-authoring reference");
  assert.match(sent, /docs\/skill-authoring\.md/, "names the app's own authoring guide");
  assert.match(sent, /Read EVERY file/i, "carries the read-before-edit instruction");
  void versionId;
});

test("non-skill scope (e.g. a run envelope) injects NO <skill-context> block", async () => {
  const h = makeHarness(echoScript);
  const { skill } = makeSkillWithVersion(h.skills);
  const thread = h.manager.createThread({});
  // Even though a skill EXISTS, the envelope is run-scoped — no skill-context should appear.
  await h.manager.sendMessage(thread.id, "summarize this run", runScope("run-1"));
  await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"));

  const sent = h.driver.starts[0]?.sentTexts[0] ?? "";
  assert.ok(!sent.includes("<skill-context>"), "no skill-context block on run scope");
  void skill;
});

test("unscoped (no envelope) injects NO <skill-context> block, and the message text is unchanged", async () => {
  const h = makeHarness(echoScript);
  const thread = h.manager.createThread({});
  await h.manager.sendMessage(thread.id, "hello there");
  await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"));

  const sent = h.driver.starts[0]?.sentTexts[0];
  assert.equal(
    sent,
    "hello there",
    "no envelope block, no skill-context block — text passes through verbatim",
  );
});

test("skill scope but no SkillRepository wired: degrades to no skill-context block (never throws)", async () => {
  const h = makeHarness(echoScript, { wireSkills: false });
  const thread = h.manager.createThread({});
  await h.manager.sendMessage(thread.id, "hi", skillScope("some-skill-id"));
  await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"));

  const sent = h.driver.starts[0]?.sentTexts[0] ?? "";
  assert.ok(
    !sent.includes("<skill-context>"),
    "gracefully injects nothing when no repository is wired",
  );
  assert.equal(h.repo.getThread(thread.id).status, "idle", "the turn still completed normally");
});

// ── Graceful handling of missing/partial skill data ─────────────────────────────────────────────

test("a skill with NO versions yet: the block says so instead of crashing or fabricating a tree", async () => {
  const h = makeHarness(echoScript);
  const skill = h.skills.create({
    name: "empty-skill",
    sourceType: "upload",
    description: "nothing yet",
  });
  const thread = h.manager.createThread({});
  await h.manager.sendMessage(thread.id, "hi", skillScope(skill.id));
  await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"));

  const sent = h.driver.starts[0]?.sentTexts[0] ?? "";
  assert.match(sent, /<skill-context>/);
  assert.match(sent, /no versions yet/i);
  assert.equal(h.repo.getThread(thread.id).status, "idle");
});

test("a skill version with no SKILL.md: the tree still renders, and the block says SKILL.md is missing", async () => {
  const h = makeHarness(echoScript);
  const { skill } = makeSkillWithVersion(h.skills, [{ path: "notes.txt", text: "just a note" }]);
  const thread = h.manager.createThread({});
  await h.manager.sendMessage(thread.id, "hi", skillScope(skill.id));
  await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"));

  const sent = h.driver.starts[0]?.sentTexts[0] ?? "";
  assert.match(sent, /- notes\.txt \(\d+ bytes\)/);
  assert.match(sent, /no readable SKILL\.md/i);
});

test("an unknown skill id in scope (deleted concurrently): the turn still completes, no crash, no block", async () => {
  const h = makeHarness(echoScript);
  const thread = h.manager.createThread({});
  await h.manager.sendMessage(thread.id, "hi", skillScope("does-not-exist"));
  await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"));

  const sent = h.driver.starts[0]?.sentTexts[0] ?? "";
  assert.ok(
    !sent.includes("<skill-context>"),
    "an unreadable skill degrades to no block, not an error",
  );
  assert.equal(h.repo.getThread(thread.id).status, "idle", "the turn still completed");
});

// ── Size discipline ──────────────────────────────────────────────────────────────────────────────

test("a huge SKILL.md body is truncated with an explicit marker, never sent unbounded", async () => {
  const h = makeHarness(echoScript);
  const hugeBody = `---\nname: pdf-tools\ndescription: Work with PDFs\n---\n${"x".repeat(30_000)}`;
  const { skill } = makeSkillWithVersion(h.skills, [{ path: "SKILL.md", text: hugeBody }]);
  const thread = h.manager.createThread({});
  await h.manager.sendMessage(thread.id, "hi", skillScope(skill.id));
  await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"));

  const sent = h.driver.starts[0]?.sentTexts[0] ?? "";
  assert.match(sent, /chars truncated/, "an explicit truncation marker, not a silent cut");
  assert.ok(
    sent.length < hugeBody.length + 5_000,
    "the sent prompt did not carry the full 30k-char body",
  );
});

test("a skill with many files: the tree is capped with an explicit truncated marker", async () => {
  const h = makeHarness(echoScript);
  const files = [
    { path: "SKILL.md", text: SKILL_MD },
    ...Array.from({ length: 250 }, (_, i) => ({
      path: `references/file-${i}.md`,
      text: `content ${i}`,
    })),
  ];
  const { skill } = makeSkillWithVersion(h.skills, files);
  const thread = h.manager.createThread({});
  await h.manager.sendMessage(thread.id, "hi", skillScope(skill.id));
  await waitFor(() => h.repo.listEvents(thread.id).some((e) => e.type === "turn_done"));

  const sent = h.driver.starts[0]?.sentTexts[0] ?? "";
  assert.match(
    sent,
    /more file\(s\) not shown/,
    "an explicit truncation marker for the file list, not a silent drop",
  );
});
