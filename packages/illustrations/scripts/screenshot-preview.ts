// ==================================================================================================
// screenshot-preview — put the two preview pages through a REAL browser
// ==================================================================================================
// WP 0.2's acceptance item 7 will not accept "reads correctly in both themes" as an assertion. This
// takes the two files `build-preview.tsx` wrote, loads each in headless Chromium, and saves a PNG —
// so the claim in the report is backed by something a person can open.
//
// Chromium comes from `@playwright/test`, already a root devDependency of this repo (it drives the
// Hub e2e smoke test). Nothing new is installed, and nothing here ships.

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { PRIMITIVE_SHEET_SIZE } from "../src/preview/PrimitivesSheet.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");
const OUT_DIR = join(REPO_ROOT, ".artifacts", "illustrations-preview");

mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch();
try {
  for (const theme of ["light", "dark"] as const) {
    const page = await browser.newPage({
      viewport: { width: PRIMITIVE_SHEET_SIZE.width, height: 900 },
      deviceScaleFactor: 2,
    });
    const html = join(OUT_DIR, `primitives-${theme}.html`);
    await page.goto(pathToFileURL(html).href, { waitUntil: "load" });
    const png = join(OUT_DIR, `primitives-${theme}.png`);
    await page.screenshot({ path: png, fullPage: true });
    console.log(`wrote ${png}`);
    await page.close();
  }
} finally {
  await browser.close();
}
