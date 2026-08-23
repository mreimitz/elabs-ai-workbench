/**
 * pack-values.guardrail.test.ts — RM-38 WP 3.2 (owner ruling 2026-08-23).
 *
 * **THE BROWSER MUST NOT LAG THE API.** `packages/shared` may never read the filesystem, so the
 * model context windows, the two thresholds and the security rule registry are compiled into the
 * image. That was fine while a pack could only ever be the one that shipped; once WP 3.1 made a pack
 * fetchable, any surface still reading the compiled floor renders the image's answer beside the
 * API's — a model the API accepts reading as unknown, a compare view opening on the old default, a
 * "50%" label beside a bucket computed at another number, and a Security tab counting rules the
 * analyzer no longer has.
 *
 * So `apps/web/src/lib/pack-values.ts` is the ONE module allowed to import those symbols, and this
 * file is what keeps it that way.
 *
 * ── Why a BAN and not a presence check ────────────────────────────────────────────────────────
 * A presence assertion (`this file imports the store`) is satisfied by a COMMENT mentioning the
 * store while the real import sits right beside it — a hole this item found in its own merged code.
 * A ban fails the safe way: a comment naming a banned symbol causes a false RED, which is annoying,
 * not dangerous.
 *
 * ── Why a ban ALONE is not enough ─────────────────────────────────────────────────────────────
 * A ban is itself an ABSENCE assertion, and absence assertions pass over an empty corpus, over a
 * directory that moved, and over a glob that matches nothing. "Zero violations over zero files" is
 * the same zero as a clean pass. So this file also asserts, in the same run:
 *   • the walk visited a real number of files (a measured floor);
 *   • the store module is IN the walked set and DOES import every banned symbol (the positive
 *     control — if the stripper were erasing everything, this would go red);
 *   • the stripper erases a comment and does not erase code (both directions, on synthetic input);
 *   • each converted site imports the store (the sanctioned replacement really landed).
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const WEB_SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The banned symbols, assembled at runtime.
 *
 * Spelled as concatenations so THIS FILE does not contain them — otherwise the ban would need an
 * exception for its own source, and a guard with an exception for itself is a guard with an
 * exception.
 */
const BANNED = [
  `MODEL_CONTEXT${"_LIMITS"}`,
  `DEFAULT_COMPARE${"_THRESHOLD"}`,
  `FAILURE_BUCKET_SCORE${"_THRESHOLD"}`,
  `SECURITY${"_RULES"}`,
];

/** The store, and its own unit test, which legitimately compares against the floor. */
const ALLOWED = ["lib/pack-values.ts", "lib/pack-values.test.ts"];

/** Measured on this branch: 975 `.ts`/`.tsx` files under `apps/web/src`. The floor is well under. */
const SOURCE_FLOOR = 600;

/**
 * The six sites measured on `main` at `ff7cf8b`, and what each must now read through.
 *
 * `features/reports/ServerReportDialog.tsx` is the deliberate SEVENTH exclusion: its
 * `DEFAULT_REPORT_MODELS` is a hand-copied list that is already intersected with the live roster on
 * load, so it degrades rather than lies. It is left alone on purpose (WP 3.2 "Explicitly out of
 * scope") and named here so the omission reads as a decision rather than an oversight.
 */
const CONVERTED_SITES = [
  "features/testing/allow-list.ts",
  "features/testing/RunConsole.tsx",
  "features/compare/CompareView.tsx",
  "features/testing/suites/FailureBuckets.tsx",
  "features/security/SecurityPanel.tsx",
];

function walk(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) files.push(full);
  }
  return files;
}

/**
 * Strip block and line comments.
 *
 * Naive, and the direction of its error is the safe one for a BAN: over-stripping produces a false
 * red, never a false green. The two-direction control below proves it does both halves of its job.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("RM-38 WP 3.2 — no pack-derived value in apps/web comes from the compiled floor", () => {
  it("the comment stripper erases a comment and does NOT erase code", () => {
    const symbol = BANNED[0] as string;
    expect(stripComments(`// we used to read ${symbol} here\nconst x = 1;\n`)).not.toContain(
      symbol,
    );
    expect(stripComments(`import { ${symbol} } from "@mcp-token-footprint/shared";\n`)).toContain(
      symbol,
    );
  });

  it("the scan is not vacuous — it walks a real tree and finds the store inside it", () => {
    const files = walk(WEB_SRC);
    expect(files.length).toBeGreaterThanOrEqual(SOURCE_FLOOR);

    const store = join(WEB_SRC, "lib", "pack-values.ts");
    expect(files).toContain(store);

    // The POSITIVE CONTROL. If the walk read nothing, or the stripper erased everything, this goes
    // red — so a green ban below cannot be the result of looking at an empty string.
    const storeCode = stripComments(readFileSync(store, "utf8"));
    for (const symbol of BANNED) {
      expect(storeCode).toContain(symbol);
    }
  });

  it("BANS the compiled floor everywhere except the store module and its own test", () => {
    const offenders: string[] = [];
    for (const file of walk(WEB_SRC)) {
      const rel = relative(WEB_SRC, file).split("\\").join("/");
      if (ALLOWED.includes(rel)) continue;
      if (rel === "guardrails/pack-values.guardrail.test.ts") continue;
      const code = stripComments(readFileSync(file, "utf8"));
      for (const symbol of BANNED) {
        if (code.includes(symbol)) offenders.push(`${rel} → ${symbol}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every converted site reads through the store", () => {
    for (const site of CONVERTED_SITES) {
      // `readFileSync` on an absolute path THROWS if the file moved, naming it — a glob would
      // silently drop it from the set and this assertion would pass over nothing.
      const code = stripComments(readFileSync(join(WEB_SRC, site), "utf8"));
      expect(code, `${site} no longer imports the pack-values store`).toMatch(
        /from "(\.\.\/)+lib\/pack-values"/,
      );
    }
  });
});
