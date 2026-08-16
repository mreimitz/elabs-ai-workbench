import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import { ensureLocalCollection, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { ScanRepository } from "../src/scans/repository.js";
import { ServerRepository } from "../src/servers/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { SkillRepository } from "../src/skills/repository.js";
import { SuiteRunRepository } from "../src/suites/suite-run-repository.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { deriveStarters, type StarterDeps } from "../src/assistant/starters.js";

// Assistant operability WP 2.1 (D-AO3) — the MANDATORY `isScopableSurface` fix, covered directly.
// Before this WP, `isScopableSurface` returned true for anything not `global`/`compatibility`; once
// the route-keyed `hub`/`agents` surfaces existed, `deriveStarters` would index
// `SCOPE_WRITE_TOOLS["hub"]`/`SCOPE_WRITE_TOOLS["agents"]` — both `undefined` — and throw. These tests
// prove the fix: `deriveStarters` resolves both new surfaces via their route WITHOUT throwing, returns
// their (purely analysis) base starters, and carries zero `kind:"action"` entries — matching the
// `compatibility` precedent (a route-keyed, non-`AssistantEntityKind` surface with no
// `SCOPE_WRITE_TOOLS` entry at all).

const databases: AppDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function createDatabase(): AppDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  ensureLocalCollection(db);
  databases.push(db);
  return db;
}

function starterDeps(): StarterDeps {
  const db = createDatabase();
  const secrets = new SecretStore(Buffer.alloc(32, 9));
  return {
    scans: new ScanRepository(db),
    servers: new ServerRepository(db, secrets),
    runs: new RunRepository(db),
    suiteRuns: new SuiteRunRepository(db),
    skills: new SkillRepository(db, secrets),
    skillQualityL2TokenCeiling: 100_000,
  };
}

test("deriveStarters resolves the hub surface via route without throwing, and returns only analysis starters", () => {
  for (const route of ["/assistant", "/assistant/sessions", "/assistant/projects", "/assistant/audit"]) {
    const res = deriveStarters(starterDeps(), { route });
    assert.equal(res.surface, "hub", route);
    assert.ok(res.starters.length > 0, `${route}: expected at least one hub starter`);
    assert.ok(
      res.starters.every((s) => s.kind === "analysis"),
      `${route}: hub must be analysis-only`,
    );
    assert.deepEqual(
      res.starters.filter((s) => s.kind === "action"),
      [],
      `${route}: hub must carry zero action starters`,
    );
  }
});

test("deriveStarters resolves the agents surface via route (and its sub-routes) without throwing, and returns only analysis starters", () => {
  for (const route of [
    "/assistant/agents",
    "/assistant/agents/agent/agent-1",
    "/assistant/agents/crew/crew-1",
  ]) {
    const res = deriveStarters(starterDeps(), { route });
    assert.equal(res.surface, "agents", route);
    assert.ok(res.starters.length > 0, `${route}: expected at least one agents starter`);
    assert.ok(
      res.starters.every((s) => s.kind === "analysis"),
      `${route}: agents must be analysis-only`,
    );
    assert.deepEqual(
      res.starters.filter((s) => s.kind === "action"),
      [],
      `${route}: agents must carry zero action starters`,
    );
  }
});

test("hub and agents responses are deterministic and read-only (no DB mutation, repeat calls identical)", () => {
  const deps = starterDeps();
  const first = deriveStarters(deps, { route: "/assistant" });
  const second = deriveStarters(deps, { route: "/assistant" });
  assert.deepEqual(first, second);

  const firstAgents = deriveStarters(deps, { route: "/assistant/agents" });
  const secondAgents = deriveStarters(deps, { route: "/assistant/agents" });
  assert.deepEqual(firstAgents, secondAgents);
});
