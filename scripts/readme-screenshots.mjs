// One-off README screenshot capture against the running app.
// Usage: node scripts/readme-screenshots.mjs [theme]
//        BASE_URL=http://localhost:5173 node scripts/readme-screenshots.mjs
// Captures viewport-sized PNGs (1600x1000 @2x → 3200x2000) into docs/screenshots/.
// Not part of the build.
import { chromium } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(rootDir, "docs", "screenshots");
// 8080 = the API serving the built web app; 5173 = `pnpm dev`'s Vite server. Either works.
const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const THEME_KEY = "brand-ui-theme";
const THEME_PREF_KEY = "mcp-token-footprint.theme-preference";

// Real entity ids from the live instance (probed via /api). Verified Aug 2026.
const SCAN_VENDOR = "A1A2TeOHNdTqsYL1tQyLm"; // qlik-mreimitz, 60 tools, 48,614 tok
const SERVER_VENDOR = "p_m2aMW4hyPJb3q8Evd6s"; // qlik-mreimitz
const SERVER_BARC = "O3Ar9zrXY8f-9mX1oXEzw"; // barc-benchmark
const SCAN_BARC = "_djByOZ6uBkuGEWnine7D"; // barc-benchmark, 77 tools, 64,522 tok
const SKILL = "Tx5FcyLBjpq8Y1R5LEvLe"; // qlik-freeform-analyst, v1
const RUN = "weBwxqBvct2p5sYxgydid"; // barc-flights, completed + rated, 13 tool calls / 14 turns
const SUITE_RUN = "ROBawV-mkagclimwXH32X";

/**
 * Literal strings to scrub from the DOM before capture — infrastructure detail that is an artifact
 * of this machine rather than anything about the product. Applied to text nodes only.
 */
const REDACTIONS = [[/192\.168\.65\.254/g, "localhost"]];

// Only shots the README actually embeds are captured by default. `servers` is the barc-benchmark
// SERVER PAGE (not the /servers list) — that is what the README's "Server health" section shows.
const shots = [
  { name: "dashboard", url: "/dashboard" },
  { name: "scan-footprint", url: `/scans/${SCAN_VENDOR}` },
  { name: "servers", url: `/servers/${SERVER_BARC}` },
  {
    name: "compare-scans",
    url: `/compare/scans?serverA=${SERVER_VENDOR}&scanA=${SCAN_VENDOR}&serverB=${SERVER_BARC}&scanB=${SCAN_BARC}`,
  },
  { name: "skill-inspector", url: `/skills/${SKILL}` },
  { name: "run-console", url: `/testing/runs/${RUN}` },
  // The run console mirrors its active tab into `?lens=`, which is far more reliable than clicking.
  { name: "run-report", url: `/testing/runs/${RUN}?lens=report` },
  { name: "compatibility", url: "/testing/compatibility" },
  { name: "runs-feed", url: "/testing/runs" },
  { name: "hub-agents", url: "/assistant/agents" },
];

// Extra shots the README does not currently embed — kept for reference, opt in with --all.
const extraShots = [
  { name: "skills", url: "/skills" },
  { name: "run-analytics", url: `/testing/runs/${RUN}?lens=analytics` },
  { name: "suite-run", url: `/testing/suite-runs/${SUITE_RUN}` },
  { name: "assistant-hub", url: "/assistant" },
];

// The README's "Two themes" section embeds exactly one dark shot.
const DARK_SHOTS = ["dashboard"];

const themes = process.argv[2] ? [process.argv[2]] : ["light", "dark"];
const includeExtras = process.argv.includes("--all");
const allShots = includeExtras ? [...shots, ...extraShots] : shots;

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
      [THEME_KEY, THEME_PREF_KEY, theme],
    );
    const page = await ctx.newPage();
    const suffix = theme === "light" ? "" : "-dark";
    for (const shot of allShots) {
      if (theme === "dark" && !DARK_SHOTS.includes(shot.name)) continue;
      try {
        await page.goto(`${BASE}${shot.url}`, { waitUntil: "networkidle", timeout: 30000 });
      } catch {
        await wait(2000); // networkidle can hang on SSE; fall through
      }
      await wait(2500);
      await page.evaluate((rules) => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode;
          if (!node.nodeValue) continue;
          for (const [pattern, flags, replacement] of rules) {
            node.nodeValue = node.nodeValue.replace(new RegExp(pattern, flags), replacement);
          }
        }
      }, REDACTIONS.map(([re, replacement]) => [re.source, re.flags, replacement]));
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
