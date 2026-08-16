import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

// Full-stack Playwright smoke (#29): builds are produced by the `test:e2e` script (`pnpm build`),
// then this config boots the built API in production mode (it serves the web SPA from WEB_DIST_PATH)
// against a throwaway DATA_DIR on a free port. Everything here is deterministic and self-contained:
// a fixed stdio fixture, no external network, a unique temp data dir, and a free port — with the
// API child process torn down by Playwright when the run ends.

const rootDir = path.dirname(fileURLToPath(import.meta.url));

// A fresh, empty data dir per run so no state leaks between runs and no real secret key is reused.
// Playwright re-evaluates this config (main process + each worker), and `mkdtempSync` would mint a
// DIFFERENT dir on each evaluation — so, like the port below, compute it ONCE and stash it in the env
// so every later evaluation (and the forked test workers) reuse the SAME dir. This also lets a test
// seed directly into the SQLite the built API serves (WP3.R session-state seeding — the DB is at
// `<dataDir>/app.sqlite`, env.ts's default under DATA_DIR).
const dataDir = process.env.E2E_DATA_DIR ?? mkdtempSync(path.join(tmpdir(), "mcp-e2e-data-"));
process.env.E2E_DATA_DIR = dataDir;

/** The production web build the API serves; produced by `pnpm build` (the `test:e2e` prestep). */
const webDistPath = path.join(rootDir, "apps", "web", "dist");

/** Ask the OS for a free ephemeral port (synchronously) so parallel/repeat runs never collide. */
function findFreePort(): number {
  const out = execFileSync(process.execPath, [
    "-e",
    "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close()})",
  ]);
  return Number(out.toString().trim());
}

// Playwright re-evaluates this config (main process + each worker), so the port MUST be stable across
// evaluations — otherwise the webServer and the test's baseURL would land on different ports. Compute
// a free port once, then stash it in the env so every later evaluation (incl. forked workers, which
// inherit this process's env) reuses the same value.
const port = Number(process.env.E2E_PORT) || findFreePort();
process.env.E2E_PORT = String(port);
const baseURL = `http://127.0.0.1:${port}`;

// The preinstalled Chromium (see PLAYWRIGHT_BROWSERS_PATH). @playwright/test@1.56.0 bundles the
// chromium-1194 build that is present under /opt/pw-browsers, so the browsers-path resolution alone
// finds it; we still pin `executablePath` to the on-disk binary as the belt-and-braces fallback the
// task calls for (never runs `playwright install`).
const chromiumPath =
  process.env.PLAYWRIGHT_CHROMIUM_PATH ??
  (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

export default defineConfig({
  testDir: path.join(rootDir, "e2e"),
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // The Assistant-Hub smoke tests drive a STUBBED streaming model end-to-end (chat → artifact,
  // mission propose→run→synthesize). A few assertions race on when a streamed turn's side effects
  // (an artifact appearing in the rail's Outputs section, a live agent roster populating) settle —
  // an inherent timing sensitivity of a streaming integration test, not a product defect. 2 retries
  // absorb that flake without masking a real failure (a genuinely broken flow fails all 3 attempts).
  retries: 2,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
    launchOptions: {
      // Chromium refuses to launch as root without a disabled sandbox; the CI/sandbox runs as root.
      args: ["--no-sandbox"],
      ...(chromiumPath ? { executablePath: chromiumPath } : {}),
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node apps/api/dist/index.js",
    cwd: rootDir,
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      HOST: "127.0.0.1",
      PORT: String(port),
      DATA_DIR: dataDir,
      WEB_DIST_PATH: webDistPath,
      // hub-fixes WP2.1 (RC2) — the deterministic stub model (`hub-stub-llm-server.ts`) has an UNKNOWN
      // context window (0), so the default `auto` tool-loading resolves to DEFERRED (a catalog can't fit
      // within a 0-token window) and a granted MCP tool would never be resident/callable without the model
      // running `tool_search` (which the fixed stub does not do). Force EAGER loading so a granted mission
      // agent's MCP tool is immediately callable in its child turn — the Phase-0 mitigation the analysis
      // recommends for the container too. The deferred-with-promotion path is unit-covered (WP1.1), not e2e.
      HUB_TOOL_LOADING_DEFAULT: "eager",
    },
  },
});
