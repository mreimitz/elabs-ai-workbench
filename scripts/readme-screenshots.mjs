// One-off README screenshot capture against the running app (http://localhost:8080).
// Usage: node scripts/readme-screenshots.mjs [theme]
// Captures viewport-sized PNGs into docs/screenshots/. Not part of the build.
import { chromium } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(rootDir, "docs", "screenshots");
const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const THEME_KEY = "brand-ui-theme";

// Real entity ids from the live instance (probed via /api).
const SCAN_VENDOR = "A1A2TeOHNdTqsYL1tQyLm"; // acme-demo, 60 tools, 48.6k tok
const SERVER_VENDOR = "p_m2aMW4hyPJb3q8Evd6s";
const SERVER_BARC = "O3Ar9zrXY8f-9mX1oXEzw";
const SCAN_BARC = "_djByOZ6uBkuGEWnine7D"; // barc-benchmark, 77 tools, 64.5k tok
const SKILL = "Tx5FcyLBjpq8Y1R5LEvLe"; // vendor-freeform-analyst
const RUN = "weBwxqBvct2p5sYxgydid"; // completed, rated, 61 steps
const SUITE_RUN = "ROBawV-mkagclimwXH32X";

const shots = [
  { name: "dashboard", url: "/dashboard" },
  { name: "servers", url: "/servers" },
  { name: "scan-footprint", url: `/scans/${SCAN_VENDOR}` },
  {
    name: "compare-scans",
    url: `/compare/scans?serverA=${SERVER_VENDOR}&scanA=${SCAN_VENDOR}&serverB=${SERVER_BARC}&scanB=${SCAN_BARC}`,
  },
  { name: "skills", url: "/skills" },
  { name: "skill-inspector", url: `/skills/${SKILL}` },
  { name: "runs-feed", url: "/testing/runs" },
  { name: "run-console", url: `/testing/runs/${RUN}` },
  { name: "run-report", url: `/testing/runs/${RUN}`, clickTab: "Report" },
  { name: "run-analytics", url: `/testing/runs/${RUN}`, clickTab: "Analytics" },
  { name: "compatibility", url: "/testing/compatibility" },
  { name: "suite-run", url: `/testing/suite-runs/${SUITE_RUN}` },
  { name: "assistant-hub", url: "/assistant" },
  { name: "hub-agents", url: "/assistant/agents" },
];

const themes = process.argv[2] ? [process.argv[2]] : ["qlik-bright", "qlik-dark"];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const run = async () => {
  const browser = await chromium.launch();
  for (const theme of themes) {
    const ctx = await browser.newContext({
      viewport: { width: 1600, height: 1000 },
      deviceScaleFactor: 2,
    });
    await ctx.addInitScript(
      ([key, prefKey, value]) => {
        try {
          window.localStorage.setItem(key, value);
          // The app resolves the active theme from a *preference* key that overrides
          // the raw theme key on mount, so set both to the concrete theme.
          window.localStorage.setItem(prefKey, value);
        } catch {}
      },
      [THEME_KEY, "mcp-token-footprint.theme-preference", theme],
    );
    const page = await ctx.newPage();
    const suffix = theme === "qlik-bright" ? "" : "-dark";
    for (const shot of shots) {
      // dark theme: only re-capture a curated subset for variety
      if (theme === "qlik-dark" && !["dashboard", "run-console", "scan-footprint"].includes(shot.name)) {
        continue;
      }
      try {
        await page.goto(`${BASE}${shot.url}`, { waitUntil: "networkidle", timeout: 30000 });
      } catch {
        await wait(2000); // networkidle can hang on SSE; fall through
      }
      await wait(2200);
      if (shot.clickTab) {
        try {
          await page.getByRole("tab", { name: shot.clickTab, exact: false }).first().click({ timeout: 5000 });
          await wait(2000);
        } catch (e) {
          console.warn(`  ! could not click tab ${shot.clickTab} on ${shot.name}: ${e.message}`);
        }
      }
      const file = path.join(outDir, `${shot.name}${suffix}.png`);
      await page.screenshot({ path: file });
      console.log(`✓ ${theme}  ${shot.name}${suffix}.png`);
    }
    await ctx.close();
  }
  await browser.close();
};

run().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
