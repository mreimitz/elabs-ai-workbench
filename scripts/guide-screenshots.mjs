// User-guide screenshot capture against the running app (http://localhost:8080).
// Writes fresh PNGs into user-guide/images/ using the guide's existing filenames (so all
// ![](./images/xx.png) references immediately show current UI) plus a few new ones for the
// sections added in the 2026-07 update pass. Not part of the build.
//
// Usage: node scripts/guide-screenshots.mjs
import { chromium } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(rootDir, "user-guide", "images");
const BASE = process.env.BASE_URL ?? "http://localhost:8080";

// Live entity ids (probed via /api on this instance).
const SCAN_QLIK = "A1A2TeOHNdTqsYL1tQyLm";
const SERVER_QLIK = "p_m2aMW4hyPJb3q8Evd6s";
const SERVER_BARC = "O3Ar9zrXY8f-9mX1oXEzw";
const SCAN_BARC = "_djByOZ6uBkuGEWnine7D";
const SKILL = "Tx5FcyLBjpq8Y1R5LEvLe"; // qlik-freeform-analyst
const SKILL_ISSUES = "DPKnXS7AHxz62oxcNqxxx"; // qlik-data-analyst (has issues)
const RUN = "weBwxqBvct2p5sYxgydid"; // completed, rated, 61 steps
const RUN_B = "q5f0M9ZrcrgfdnY_ixUd9"; // completed, 51 steps
const SUITE_RUN = "ROBawV-mkagclimwXH32X";

const shots = [
  // Core-flow full-window shots (regenerated over stale same-named files)
  { name: "01-dashboard", url: "/dashboard" },
  { name: "02-servers", url: `/servers/${SERVER_BARC}` },
  { name: "03-scan-footprint", url: `/scans/${SCAN_QLIK}` },
  {
    name: "05-compare-scans",
    url: `/compare/scans?serverA=${SERVER_QLIK}&scanA=${SCAN_QLIK}&serverB=${SERVER_BARC}&scanB=${SCAN_BARC}`,
  },
  { name: "08-run-console-chat", url: `/testing/runs/${RUN}` },
  { name: "09-run-trace", url: `/testing/runs/${RUN}`, clickTab: "Trace" },
  { name: "11-run-analytics", url: `/testing/runs/${RUN}`, clickTab: "Analytics" },
  { name: "10-run-report", url: `/testing/runs/${RUN}`, clickTab: "Report" },
  { name: "12-run-compare", url: `/testing/runs/compare?ids=${RUN},${RUN_B}&baseline=${RUN}` },
  {
    name: "13-run-compare-flow",
    url: `/testing/runs/compare?ids=${RUN},${RUN_B}&baseline=${RUN}`,
    clickTab: "Flow",
  },
  { name: "14-skills", url: `/skills/${SKILL}` },
  { name: "16-environments", url: "/testing/environments" },
  { name: "19-skill-issue-feedback", url: `/skills/${SKILL_ISSUES}`, clickTab: "Issues" },

  // New shots for the sections added in this update pass
  { name: "15-compatibility", url: "/testing/compatibility" },
  { name: "21-review", url: "/testing/review" },
  { name: "22-watch-rules", url: "/testing/observability/rules" },
  { name: "23-suite-run", url: `/testing/suite-runs/${SUITE_RUN}` },
  { name: "24-dashboard-issues", url: "/dashboard", clickTab: "Issues" },
  { name: "25-hub-workspace", url: "/assistant" },
  { name: "26-hub-agents", url: "/assistant/agents" },
  { name: "27-hub-org", url: "/assistant/agents", clickTab: "Org chart" },
];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const run = async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 2,
  });
  await ctx.addInitScript(
    ([key, prefKey, value]) => {
      try {
        window.localStorage.setItem(key, value);
        window.localStorage.setItem(prefKey, value);
      } catch {}
    },
    ["brand-ui-theme", "mcp-token-footprint.theme-preference", "qlik-bright"],
  );
  const page = await ctx.newPage();
  for (const shot of shots) {
    try {
      await page.goto(`${BASE}${shot.url}`, { waitUntil: "networkidle", timeout: 30000 });
    } catch {
      await wait(2000);
    }
    await wait(2200);
    if (shot.clickTab) {
      try {
        await page
          .getByRole("tab", { name: shot.clickTab, exact: false })
          .first()
          .click({ timeout: 5000 });
        await wait(1800);
      } catch (e) {
        console.warn(`  ! tab "${shot.clickTab}" not clickable on ${shot.name}: ${e.message}`);
      }
    }
    await page.screenshot({ path: path.join(outDir, `${shot.name}.png`) });
    console.log(`✓ ${shot.name}.png`);
  }
  await ctx.close();
  await browser.close();
};

run().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
