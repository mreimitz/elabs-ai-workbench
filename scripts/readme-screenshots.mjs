// README screenshot capture against a RUNNING app.
//
// Usage:
//   node scripts/readme-screenshots.mjs                 # light + dark, the shots README embeds
//   BASE_URL=http://localhost:5173 node scripts/readme-screenshots.mjs
//   node scripts/readme-screenshots.mjs light           # one theme
//   node scripts/readme-screenshots.mjs --only=docs,security
//   node scripts/readme-screenshots.mjs --all           # + the reference-only extras
//   node scripts/readme-screenshots.mjs --mask-names    # ALSO mask registered server NAMES
//
// Captures viewport-sized PNGs (1600x1000 @2x -> 3200x2000) into docs/screenshots/.
// Not part of the build.
//
// ── Redaction (why this exists) ───────────────────────────────────────────────────────────────
// These images are published in a public README. Every screenshot is taken against a live fleet,
// so before the shutter fires the page is walked and every registered MCP server ENDPOINT is
// destroyed in the DOM: the host is REPLACED with bullets of the same length (so nothing shifts),
// and the surviving element is blurred on top. The replacement happens first on purpose — a blur
// alone is a reversible filter over glyphs that are still there; replacing the text means even a
// perfect de-blur recovers bullets. Endpoints are read from the running API rather than listed
// here, so a server registered tomorrow is covered without editing this file.
import { chromium } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(rootDir, "docs", "screenshots");
// 8080 = the API serving the built web app; 5173 = `pnpm dev`'s Vite server. Either works.
const BASE = process.env.BASE_URL ?? "http://localhost:8080";
// The API to probe for entity ids + the endpoints to redact. Defaults to BASE (the Vite dev server
// proxies /api), override when capturing a build that is served from somewhere else.
const API = process.env.API_URL ?? BASE;
const THEME_KEY = "brand-ui-theme";
const THEME_PREF_KEY = "mcp-token-footprint.theme-preference";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const option = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};
const MASK_NAMES = flag("mask-names");
const INCLUDE_EXTRAS = flag("all");
const ONLY = option("only")
  ?.split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const themeArg = argv.find((a) => !a.startsWith("--"));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
};
const asList = (payload, ...keys) => {
  if (Array.isArray(payload)) return payload;
  for (const key of keys) if (Array.isArray(payload?.[key])) return payload[key];
  return [];
};

/**
 * Entity ids. Pinned ids keep the README's captions ("60 tools, 48,614 tokens") pointing at the
 * scan those numbers were read off. Each is verified against the running instance before use; if
 * it has been pruned we fall back to discovery so the script still produces a full set rather than
 * a page of 404s. Override any of them with the matching env var.
 */
const PINNED = {
  SCAN_VENDOR: "A1A2TeOHNdTqsYL1tQyLm", //  60 tools, 48,614 tok
  SERVER_VENDOR: "p_m2aMW4hyPJb3q8Evd6s",
  SERVER_BARC: "O3Ar9zrXY8f-9mX1oXEzw",
  SCAN_BARC: "_djByOZ6uBkuGEWnine7D", //  64,522 tok
  SKILL: "Tx5FcyLBjpq8Y1R5LEvLe",
  RUN: "weBwxqBvct2p5sYxgydid", // completed + rated, 13 tool calls / 14 turns
  RUN_SMALL: "y3dESje2NEQY9YHKUbjMg", // completed, 6 tool calls / 5 turns — a legible agent graph
  SUITE_RUN: "ROBawV-mkagclimwXH32X",
};

const resolveEntities = async () => {
  const servers = asList(await getJson(`${API}/api/servers`), "servers", "items");
  const scans = asList(await getJson(`${API}/api/scans?limit=200`), "scans", "items");
  const skills = asList(await getJson(`${API}/api/skills`), "skills", "items");
  const okScans = scans.filter((s) => s.status === "success");
  const has = (list, id) => list.some((x) => x.id === id);
  const biggestScanNot = (excludeServerId) =>
    okScans
      .filter((s) => s.serverId !== excludeServerId)
      .sort((a, b) => (b.totalTokens ?? 0) - (a.totalTokens ?? 0))[0];

  const pick = (envName, pinned, list, fallback) =>
    process.env[envName] ?? (has(list, pinned) ? pinned : fallback?.id);

  const scanVendor = pick("SCAN_VENDOR", PINNED.SCAN_VENDOR, okScans, okScans[0]);
  const serverOfScan = (scanId) => okScans.find((s) => s.id === scanId)?.serverId;
  const scanBarc = pick(
    "SCAN_BARC",
    PINNED.SCAN_BARC,
    okScans,
    biggestScanNot(serverOfScan(scanVendor)),
  );

  const entities = {
    SCAN_VENDOR: scanVendor,
    SERVER_VENDOR: pick("SERVER_VENDOR", PINNED.SERVER_VENDOR, servers, {
      id: serverOfScan(scanVendor),
    }),
    SCAN_BARC: scanBarc,
    SERVER_BARC: pick("SERVER_BARC", PINNED.SERVER_BARC, servers, { id: serverOfScan(scanBarc) }),
    SKILL: pick("SKILL", PINNED.SKILL, skills, skills[0]),
    RUN: process.env.RUN ?? PINNED.RUN,
    RUN_SMALL: process.env.RUN_SMALL ?? PINNED.RUN_SMALL,
    SUITE_RUN: process.env.SUITE_RUN ?? PINNED.SUITE_RUN,
  };
  // A run/suite-run is not listed cheaply; probe the pinned one and fall back to the newest
  // completed run in the feed.
  const runOk = await fetch(`${API}/api/runs/${entities.RUN}`)
    .then((r) => r.ok)
    .catch(() => false);
  if (!runOk) {
    const runs = asList(await getJson(`${API}/api/runs?limit=50`), "runs", "items");
    entities.RUN = runs.find((r) => r.status === "completed")?.id ?? runs[0]?.id;
  }
  const smallOk = await fetch(`${API}/api/runs/${entities.RUN_SMALL}`)
    .then((r) => r.ok)
    .catch(() => false);
  if (!smallOk) entities.RUN_SMALL = entities.RUN;
  return { entities, servers };
};

/**
 * Build the redaction table from the live server registry: full endpoint URLs first (longest
 * first, so `https://host/api/mcp` is consumed before the bare host), then the bare hostnames for
 * the places the UI prints a host without its scheme.
 */
const buildRedactions = (servers) => {
  const targets = [];
  const push = (value, keepTail) => {
    if (value && !targets.some((t) => t.value === value)) targets.push({ value, keepTail });
  };
  for (const server of servers) {
    const url = server.url ?? server.config?.url;
    if (!url) continue;
    try {
      const parsed = new URL(url);
      push(url, parsed.pathname && parsed.pathname !== "/" ? parsed.pathname : "");
      push(parsed.host, "");
      push(parsed.hostname, "");
    } catch {
      push(url, "");
    }
    if (MASK_NAMES && server.name) push(server.name, "");
  }
  return targets.sort((a, b) => b.value.length - a.value.length);
};

const buildShots = (e) => {
  const shots = [
    { name: "dashboard", url: "/dashboard" },
    { name: "servers-overview", url: "/servers" },
    { name: "scan-footprint", url: `/scans/${e.SCAN_VENDOR}` },
    { name: "servers", url: `/servers/${e.SERVER_BARC}` },
    {
      name: "compare-scans",
      url: `/compare/scans?serverA=${e.SERVER_VENDOR}&scanA=${e.SCAN_VENDOR}&serverB=${e.SERVER_BARC}&scanB=${e.SCAN_BARC}`,
    },
    { name: "skill-inspector", url: `/skills/${e.SKILL}` },
    {
      name: "skill-studio",
      url: `/skills/${e.SKILL}/studio`,
      settle: 4000,
      // Fit, then zoom back in twice: fitting alone shrinks a 20-node skill flow to unreadable
      // specks, and not fitting at all leaves the flow hugging one corner of the frame.
      actions: [
        'button[aria-label="Fit view"]',
        'button[aria-label="Zoom in"]',
        'button[aria-label="Zoom in"]',
      ],
    },
    { name: "run-console", url: `/testing/runs/${e.RUN}` },
    // The run console mirrors its active tab into `?lens=`, which is far more reliable than clicking.
    { name: "run-report", url: `/testing/runs/${e.RUN}?lens=report` },
    {
      // A DIFFERENT run than the console shots on purpose: the 13-call session's aggregated graph
      // is 8 nodes wide, and fitting it to the frame makes every label unreadable. This one is a
      // 6-call session, which is the same picture at a size a reader can actually follow.
      name: "run-graph",
      url: `/testing/runs/${e.RUN_SMALL}?lens=graph`,
      settle: 4000,
      actions: ['button[aria-label="Fit view"]'],
    },
    { name: "compatibility", url: "/testing/compatibility" },
    { name: "runs-feed", url: "/testing/runs" },
    { name: "hub-agents", url: "/assistant/agents", needsFeature: "assistant" },
    { name: "security", url: `/scans/${e.SCAN_VENDOR}?tab=security` },
    { name: "illustrations", url: "/illustrations", settle: 4000 },
    { name: "docs", url: "/docs" },
    { name: "advisor", url: "/advisor", settle: 4000 },
  ];
  // Extras the README does not embed — kept for reference, opt in with --all.
  const extras = [
    { name: "skills", url: "/skills" },
    { name: "collections", url: "/testing/collections" },
    { name: "run-analytics", url: `/testing/runs/${e.RUN}?lens=analytics` },
    { name: "suite-run", url: `/testing/suite-runs/${e.SUITE_RUN}` },
    { name: "assistant-hub", url: "/assistant", needsFeature: "assistant" },
    { name: "settings-features", url: "/settings/features" },
  ];
  return { shots, extras };
};

// The README's "Two themes" section embeds exactly one dark shot.
const DARK_SHOTS = ["dashboard"];

/**
 * Runs INSIDE the page, immediately before the shutter. Text nodes first (wrapping the hit in a
 * blurred span, except inside SVG where a span is illegal — there the owning element is blurred),
 * then form values, which render but are not text nodes.
 */
const redactInPage = (targets) => {
  const BULLET = "•";
  const style = document.createElement("style");
  style.textContent =
    ".__redacted{filter:blur(5px) !important;-webkit-filter:blur(5px) !important;}" +
    ".__redacted-el{filter:blur(5px) !important;-webkit-filter:blur(5px) !important;}";
  document.head.appendChild(style);

  const maskFor = ({ value, keepTail }) => {
    const tail = keepTail && value.endsWith(keepTail) ? keepTail : "";
    const head = value.slice(0, value.length - tail.length);
    const schemeEnd = head.indexOf("://");
    const scheme = schemeEnd >= 0 ? head.slice(0, schemeEnd + 3) : "";
    return scheme + BULLET.repeat(Math.max(3, head.length - scheme.length)) + tail;
  };

  let hits = 0;
  const nodes = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) nodes.push(walker.currentNode);

  for (const node of nodes) {
    let text = node.nodeValue;
    if (!text) continue;
    const target = targets.find((t) => text.includes(t.value));
    if (!target) continue;
    const parent = node.parentElement;
    const inSvg = parent && parent.namespaceURI === "http://www.w3.org/2000/svg";
    for (const t of targets) {
      if (text.includes(t.value)) {
        text = text.split(t.value).join(maskFor(t));
        hits += 1;
      }
    }
    if (inSvg) {
      node.nodeValue = text;
      parent.classList.add("__redacted-el");
      continue;
    }
    const span = document.createElement("span");
    span.className = "__redacted";
    span.textContent = text;
    node.replaceWith(span);
  }

  for (const field of document.querySelectorAll("input, textarea")) {
    const value = field.value;
    if (!value) continue;
    let next = value;
    for (const t of targets)
      if (next.includes(t.value)) {
        next = next.split(t.value).join(maskFor(t));
        hits += 1;
      }
    if (next !== value) {
      field.value = next;
      field.classList.add("__redacted-el");
    }
  }
  return hits;
};

/**
 * Optional per-shot interactions run after load and before redaction. Kept declarative (a list of
 * CSS selectors to click) so a shot's setup is readable next to its URL. A selector that is not
 * present is skipped rather than failing the shot — the app changes faster than this script.
 */
const applyActions = async (page, actions) => {
  for (const selector of actions ?? []) {
    const target = page.locator(selector).first();
    if ((await target.count()) === 0) {
      console.warn(`  ! action selector not found: ${selector}`);
      continue;
    }
    await target
      .click({ timeout: 5000 })
      .catch(() => console.warn(`  ! action click failed: ${selector}`));
    await wait(700);
  }
};

const run = async () => {
  const { entities, servers } = await resolveEntities();
  const targets = buildRedactions(servers);
  console.log(
    `redacting ${targets.length} endpoint strings from ${servers.length} registered servers`,
  );
  for (const [key, value] of Object.entries(entities))
    if (!value) console.warn(`! no entity resolved for ${key}`);

  const features = await getJson(`${API}/api/features`)
    .then((r) => r.flags)
    .catch(() => ({}));
  const { shots, extras } = buildShots(entities);
  let allShots = INCLUDE_EXTRAS ? [...shots, ...extras] : shots;
  if (ONLY) allShots = allShots.filter((s) => ONLY.includes(s.name));
  const skipped = [];

  const themes = themeArg ? [themeArg] : ["light", "dark"];
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
          // The app resolves the active theme from a *preference* key that overrides the raw theme
          // key on mount, so set both to the concrete theme.
          window.localStorage.setItem(prefKey, value);
        } catch {}
      },
      [THEME_KEY, THEME_PREF_KEY, theme],
    );
    const page = await ctx.newPage();
    const suffix = theme === "light" ? "" : "-dark";
    for (const shot of allShots) {
      if (theme === "dark" && !DARK_SHOTS.includes(shot.name)) continue;
      if (shot.needsFeature && features[shot.needsFeature] === false) {
        skipped.push(`${shot.name} (feature "${shot.needsFeature}" is off)`);
        continue;
      }
      try {
        await page.goto(`${BASE}${shot.url}`, { waitUntil: "networkidle", timeout: 30000 });
      } catch {
        await wait(2000); // networkidle can hang on SSE; fall through
      }
      await wait(shot.settle ?? 2500);
      await applyActions(page, shot.actions);
      const hits = await page.evaluate(redactInPage, targets);
      const file = path.join(outDir, `${shot.name}${suffix}.png`);
      await page.screenshot({ path: file });
      console.log(
        `OK ${theme}  ${shot.name}${suffix}.png  (${hits} redaction${hits === 1 ? "" : "s"})`,
      );
    }
    await ctx.close();
  }
  await browser.close();
  for (const line of skipped) console.warn(`- skipped ${line}`);
};

run().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
