import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { buildGitSpawnEnv, runGit } from "../src/git/git-credential.js";

const execFileAsync = promisify(execFile);

// ==================================================================================================
// RM-37 WP 0.4 — the `git` child's environment
// ==================================================================================================
//
// `runGit` used to spawn with `{ ...process.env, … }`. Every git subprocess in this app — skill
// import, skill pull, skill publish, collection two-way sync — therefore inherited **MCP_SECRET_KEY**,
// the key that decrypts every stored MCP credential and OAuth token in the database.
//
// That is not a hypothetical: `git` runs hooks, `core.askpass` helpers, `GIT_SSH_COMMAND`, clean/smudge
// filters and diff drivers, and a repository being cloned from GitHub has a say in some of those. The
// blast radius of a hostile repository should not include the app's master key.
//
// The fix is an ALLOW-list, and these tests pin it in BOTH directions — what must be absent, and what
// must still be present, because a git child with no `PATH` or no `HOME` is a broken feature rather
// than a secure one.

/** The variables that must never reach a git child, whatever else changes. */
const FORBIDDEN = [
  "MCP_SECRET_KEY",
  "MCP_SECRET_KEY_PATH",
  "DATABASE_PATH",
  "DATA_DIR",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "HUB_SEARCH_TAVILY_KEY",
  "ATTACHMENTS_DIR",
  "API_AUTH_REQUIRED",
];

test("the git child env carries no app secret or app config", () => {
  const source: NodeJS.ProcessEnv = {
    PATH: "/usr/bin:/bin",
    HOME: "/home/op",
    MCP_SECRET_KEY: "c2VjcmV0LWtleS1tYXRlcmlhbA==",
    MCP_SECRET_KEY_PATH: "/data/mcp-secret.key",
    DATABASE_PATH: "/data/app.sqlite",
    DATA_DIR: "/data",
    ANTHROPIC_API_KEY: "sk-ant-not-a-real-key",
    OPENAI_API_KEY: "sk-not-a-real-key",
    CLAUDE_CODE_OAUTH_TOKEN: "oauth-not-a-real-token",
    HUB_SEARCH_TAVILY_KEY: "tvly-not-a-real-key",
    ATTACHMENTS_DIR: "/data/attachments",
    API_AUTH_REQUIRED: "true",
  };

  const env = buildGitSpawnEnv(source);

  for (const name of FORBIDDEN) {
    assert.equal(env[name], undefined, `${name} must not reach the git child`);
  }
  // Value-level sweep too: a variable renamed tomorrow would still be caught by its VALUE showing up
  // anywhere in the child env, which is the property that actually matters.
  const serialized = JSON.stringify(env);
  for (const name of FORBIDDEN) {
    const value = source[name];
    if (value) assert.ok(!serialized.includes(value), `the VALUE of ${name} leaked into the child`);
  }
});

test("the git child env keeps what git genuinely needs — an over-tight env is a broken feature", () => {
  const env = buildGitSpawnEnv({
    PATH: "/usr/bin:/bin",
    HOME: "/home/op",
    LANG: "en_US.UTF-8",
    SSH_AUTH_SOCK: "/tmp/ssh-agent.sock",
    GIT_SSH_COMMAND: "ssh -o StrictHostKeyChecking=yes",
    GIT_CONFIG_GLOBAL: "/home/op/.gitconfig",
    HTTPS_PROXY: "http://corp-proxy:3128",
    https_proxy: "http://corp-proxy:3128",
    NO_PROXY: "localhost",
    MCP_SECRET_KEY: "must-not-appear",
  });

  assert.equal(env.PATH, "/usr/bin:/bin");
  assert.equal(env.HOME, "/home/op");
  assert.equal(env.LANG, "en_US.UTF-8");
  assert.equal(env.SSH_AUTH_SOCK, "/tmp/ssh-agent.sock");
  assert.equal(env.GIT_SSH_COMMAND, "ssh -o StrictHostKeyChecking=yes");
  assert.equal(env.GIT_CONFIG_GLOBAL, "/home/op/.gitconfig");
  assert.equal(env.HTTPS_PROXY, "http://corp-proxy:3128");
  assert.equal(env.https_proxy, "http://corp-proxy:3128", "git/curl read the lowercase spelling");
  assert.equal(env.NO_PROXY, "localhost");
  assert.equal(env.MCP_SECRET_KEY, undefined);
});

test("an unrecognised variable is dropped — this is an ALLOW-list, not a deny-list", () => {
  // The point of the shape: a variable added to `config/env.ts` next month is excluded by default.
  // A deny-list would be correct only until then, and nobody re-reads a deny-list when they add one.
  const env = buildGitSpawnEnv({
    PATH: "/usr/bin",
    SOME_FUTURE_APP_SECRET: "value-nobody-thought-about",
  });
  assert.deepEqual(Object.keys(env).sort(), ["PATH"]);
});

test("runGit really spawns with that env — measured from a live child, not from the source", async () => {
  // The pure function above could be perfect while `runGit` kept passing `process.env`. This asserts
  // the wiring by reading the environment a REAL child of `runGit` sees.
  //
  // The vehicle is `git -c ... var -v <NAME>`, but git has no env-dump; so instead the child is a git
  // invocation whose *behaviour* depends on an env var we control, run inside a throwaway repo.
  // `GIT_AUTHOR_NAME` is passed explicitly through the `env` option (the caller-supplied overrides
  // that skill-publish and collection-sync use) and must arrive, while an unrelated process-level
  // variable set just for this test must NOT.
  const previous = process.env.MCP_SECRET_KEY;
  process.env.MCP_SECRET_KEY = "sentinel-key-must-not-reach-git";
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mcpfp-git-env-"));
  try {
    await execFileAsync("git", ["init", "-q", tmp]);
    fs.writeFileSync(path.join(tmp, "a.txt"), "hello\n");
    await runGit(["add", "a.txt"], tmp, { timeoutMs: 15_000 });
    await runGit(["commit", "-q", "-m", "x"], tmp, {
      timeoutMs: 15_000,
      env: {
        GIT_AUTHOR_NAME: "Env Probe",
        GIT_AUTHOR_EMAIL: "probe@example.invalid",
        GIT_COMMITTER_NAME: "Env Probe",
        GIT_COMMITTER_EMAIL: "probe@example.invalid",
      },
    });

    // The caller-supplied `env` overrides survived the minimisation.
    const { stdout } = await runGit(["log", "-1", "--format=%an <%ae>"], tmp, { timeoutMs: 15_000 });
    assert.equal(stdout.trim(), "Env Probe <probe@example.invalid>");

    // And the process-level secret did not: a git hook is the concrete thing that would have read it,
    // so use one. `core.hooksPath` points at a directory whose `pre-commit` writes its own env.
    const hooks = path.join(tmp, "hooks");
    fs.mkdirSync(hooks);
    const probe = path.join(tmp, "hook-env.txt");
    fs.writeFileSync(
      path.join(hooks, "pre-commit"),
      `#!/bin/sh\nprintenv > ${JSON.stringify(probe)}\nexit 0\n`,
      { mode: 0o755 },
    );
    fs.writeFileSync(path.join(tmp, "b.txt"), "world\n");
    await runGit(["add", "b.txt"], tmp, { timeoutMs: 15_000 });
    await runGit(["-c", `core.hooksPath=${hooks}`, "commit", "-q", "-m", "y"], tmp, {
      timeoutMs: 15_000,
      env: {
        GIT_AUTHOR_NAME: "Env Probe",
        GIT_AUTHOR_EMAIL: "probe@example.invalid",
        GIT_COMMITTER_NAME: "Env Probe",
        GIT_COMMITTER_EMAIL: "probe@example.invalid",
      },
    });

    const hookEnv = fs.readFileSync(probe, "utf8");
    assert.ok(
      !hookEnv.includes("sentinel-key-must-not-reach-git"),
      "a git HOOK could read MCP_SECRET_KEY out of the child environment",
    );
    assert.ok(!/^MCP_SECRET_KEY=/m.test(hookEnv), "MCP_SECRET_KEY is present in the hook's env");
    assert.match(hookEnv, /^PATH=/m, "the hook still gets a PATH — the env is minimal, not empty");
  } finally {
    // `Reflect.deleteProperty`, not `delete` (Biome's noDelete) and NOT `= undefined` — assigning
    // undefined to a `process.env` key stores the literal string "undefined", which would leave a
    // fake MCP_SECRET_KEY behind for every test that runs after this one.
    if (previous === undefined) Reflect.deleteProperty(process.env, "MCP_SECRET_KEY");
    else process.env.MCP_SECRET_KEY = previous;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
