import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// dashboard-bento WP 0.1 · finding F5 — a series ramp is derived in ONE place.
// ------------------------------------------------------------------------------------------------
// `lib/chart-colors.ts` cycles all twelve `--chart-N` tokens. The original sweep for this WP grepped
// for the TEMPLATE-LITERAL form of a chart token and therefore could not see the other shape the
// same defect takes: a private ARRAY of chart-token literals, indexed by a series index or a
// modulo. `hub/workforce/usage/UsageCharts.tsx` had exactly that — a five-entry ramp behind
// `CHART_COLORS[index % CHART_COLORS.length]` — and the grep was structurally blind to it.
//
// This guardrail closes that blind spot: no file outside `lib/chart-colors.ts` may hold a bare
// SEQUENCE of chart-token string literals, because a sequence is the thing an index cycles.
//
// Source-level scan of the real tree, same technique as `lib/retired-components-guardrail.test.ts`.
//
// ── What this does and does NOT catch (stated plainly, so nobody over-trusts it) ────────────────
// CATCHES: adjacent chart-token string literals — an array/tuple like
//   `const RAMP = ["var(--chart-1)", "var(--chart-2)", …]`. That is the realistic shape of an
//   index-driven cycle, and the one that actually shipped.
// DOES NOT CATCH: a Record keyed by fixed semantic names (`{ system: "bg-chart-1", output: … }`),
//   because its literals are not adjacent. That is deliberate, not an oversight — such a record is
//   a fixed pinning, not a cycle, and `ContextChart`/`node-kind-meta` are legitimately built that
//   way. A record indexed by a COMPUTED key would slip through; no cheap static check separates
//   that from a fixed map, so this guardrail does not pretend to. It narrows the gap; it does not
//   close it.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_SRC = path.resolve(HERE, "..");

/** The one module allowed to derive a series colour. */
const HELPER = path.join("lib", "chart-colors.ts");

/**
 * Files that legitimately hold a chart-token sequence. Each entry states WHY, in the spirit of the
 * `assistant-route-operability` manifest's `exempt` reasons: an exemption is a decision on the
 * record, not a way to skip the decision.
 */
const ALLOWED: Record<string, string> = {
  [path.join("components", "TokenViz.tsx")]:
    "Fixed composition segments, each pinned to its own token — the three MCP surfaces " +
    "(tools/resources/prompts) and the five parts of a tool definition (name/description/schema/" +
    "annotations/wire structure). Both are fixed-arity by construction, so the index is a POSITION, " +
    "not a cycle: there is no 6th segment to collide with. Series colours anywhere else still go " +
    "through `lib/chart-colors.ts`.",
  [path.join("features", "hub", "agents", "RoleAvatar.tsx")]:
    "KNOWN index-driven cycle (hashIndex(id, 5) over five accent tokens), deliberately NOT converted " +
    "in WP 0.1. It colours agent AVATARS, not chart series, and widening it to twelve would reshuffle " +
    "the accent of every existing agent — a visible identity change for the owner to approve, not a " +
    "mechanical refactor. Left as an explicit open decision rather than silently changed or silently " +
    "skipped.",
};

/** All non-test `.ts`/`.tsx` files under `apps/web/src`. */
function allSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...allSourceFiles(full));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    if (/\.(test|spec)\.(ts|tsx)$/.test(entry.name)) continue;
    out.push(full);
  }
  return out;
}

/** Comments carry prose about the old pattern (this file included) — never scan them. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** One chart-token string literal, in any of the three forms this app writes them. */
const TOKEN_LITERAL = String.raw`"(?:var\(--chart-\d+\)|bg-chart-\d+|text-\[var\(--chart-\d+\)\])"`;
/** Two such literals separated by nothing but a comma and whitespace — i.e. an array/tuple. */
const TOKEN_SEQUENCE = new RegExp(`${TOKEN_LITERAL}\\s*,\\s*${TOKEN_LITERAL}`);

function relative(file: string): string {
  return path.relative(WEB_SRC, file);
}

describe("guardrail: a chart series ramp is derived only in lib/chart-colors.ts (WP 0.1 / F5)", () => {
  const files = allSourceFiles(WEB_SRC);

  it("scans a non-trivial tree (the scan itself cannot silently no-op)", () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it("no module outside the helper holds an indexable sequence of chart-token literals", () => {
    const offenders = files
      .filter((f) => relative(f) !== HELPER)
      .filter((f) => !(relative(f) in ALLOWED))
      .filter((f) => TOKEN_SEQUENCE.test(stripComments(readFileSync(f, "utf8"))))
      .map(relative);

    expect(
      offenders,
      `These files hold their own ramp of chart-token literals. A ramp indexed by a series index is\n` +
        `finding F5: past its length, series N and series 0 get the same colour. Route them through\n` +
        `\`chartSeriesColor\` from lib/chart-colors.ts — or, if the tokens are a FIXED pinning rather\n` +
        `than a cycle, add the file to ALLOWED in this test with a reason saying so.\n` +
        `Offenders: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("every ALLOWED entry still exists and still holds a sequence (no stale exemptions)", () => {
    for (const [rel, reason] of Object.entries(ALLOWED)) {
      const full = path.join(WEB_SRC, rel);
      const src = stripComments(readFileSync(full, "utf8"));
      expect(TOKEN_SEQUENCE.test(src), `${rel} no longer holds a chart-token sequence — drop its ALLOWED entry`).toBe(
        true,
      );
      expect(reason.length, `${rel} needs a real reason, not a placeholder`).toBeGreaterThan(40);
    }
  });

  it("the helper itself is exempt by identity, not by allowlist", () => {
    expect(Object.keys(ALLOWED)).not.toContain(HELPER);
  });
});
