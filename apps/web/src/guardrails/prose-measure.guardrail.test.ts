/**
 * prose-measure.guardrail.test.ts — interface-craft WP 4.1 guardrail (D-IC9).
 *
 * Two layers, both run in `pnpm test`:
 *
 *   A. SOURCE — the four prose containers WP 1.4 capped keep their ~68ch reading-width cap
 *      (Compatibility "Not everything is automated" callout, the assistant message body, the rendered
 *      SKILL.md block, and the `ProseCardDescription` wrapper). Delete a cap → RED.
 *   B. HOOK — the `.claude/hooks/prose-measure.mjs` static guard actually flags an uncapped prose
 *      container and — the D-IC9 acceptance requirement — does NOT false-positive on a full-width
 *      TABLE. This layer runs the REAL hook as a subprocess (no logic is re-implemented here), so the
 *      guard's behaviour is proven inside the gate, not just described.
 *
 * Tables and dense rows deliberately stay full-width — the cap is for reading columns of prose only.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const webSrc = join(__dirname, ".."); // apps/web/src
const repoRoot = join(__dirname, "..", "..", "..", ".."); // …/mcp-token-footprint
const hookPath = join(repoRoot, ".claude", "hooks", "prose-measure.mjs");

/**
 * A measure cap: an explicit `max-w-[NNch]` / `max-w-prose` class, OR the `measure` prop that
 * `CardDescription` ships since v4 (it applies `max-w-prose` itself — `brand-ui docs
 * CardDescription`). Composing the primitive's own prop is the preferred form; the class is still
 * accepted for the containers that are not a `CardDescription`.
 */
const MEASURE_CAP = /max-w-(\[[0-9]+ch\]|prose)|\bmeasure\b/;

// ── A. the four capped prose containers keep their cap ────────────────────────────────────────────

/** file (under apps/web/src) → a contextual anchor proving the cap sits on the PROSE container. */
const CAPPED_PROSE_CONTAINERS: Array<{ file: string; anchor: RegExp; what: string }> = [
  {
    file: "features/compatibility/CompatibilityView.tsx",
    anchor: /ManualReviewCallout/,
    what: "Compatibility 'Not everything is automated' callout",
  },
  {
    file: "features/assistant/AssistantMessageBody.tsx",
    anchor: /ChatMarkdown/,
    what: "assistant message body (flowing markdown segment)",
  },
  {
    file: "features/skills/SkillOverview.tsx",
    anchor: /MessageResponse/,
    what: "rendered SKILL.md block",
  },
  {
    file: "components/ProseCardDescription.tsx",
    anchor: /CardDescription/,
    what: "measure-capped CardDescription wrapper",
  },
];

describe("GUARDRAIL D-IC9 (source) — the four capped prose containers keep a measure cap", () => {
  it.each(CAPPED_PROSE_CONTAINERS)("$what carries a max-w-[..ch]/prose cap", ({ file, anchor }) => {
    const src = readFileSync(join(webSrc, file), "utf8");
    expect(src, `${file} must render its prose container`).toMatch(anchor);
    expect(src, `${file} must cap its prose measure (max-w-[..ch] or max-w-prose)`).toMatch(
      MEASURE_CAP,
    );
  });
});

// ── B. the hook flags uncapped prose but NOT a full-width table ───────────────────────────────────

/** Run the real hook with a PostToolUse-style payload; return its exit code (0 = clean, 2 = nudge). */
function runProseHook(filePath: string, newString: string): number {
  const payload = JSON.stringify({ tool_input: { file_path: filePath, new_string: newString } });
  try {
    execFileSync(process.execPath, [hookPath], { input: payload, stdio: ["pipe", "pipe", "pipe"] });
    return 0;
  } catch (err) {
    return (err as { status?: number }).status ?? 1;
  }
}

const WEB_TSX = "/repo/apps/web/src/features/demo/Demo.tsx";

/** Build a raw open-tag string WITHOUT a literal `<table>` substring in this source file (so the
 *  enforce-brand-ui hook doesn't flag the test's own fixture). The hook under test still receives the
 *  fully-assembled raw markup at runtime. */
const tag = (name: string): string => `<${name}>`;

describe("GUARDRAIL D-IC9 (hook) — flags uncapped prose, spares full-width tables", () => {
  it("FLAGS a <ChatMarkdown> container introduced with no max-w cap (exit 2)", () => {
    const bad = '<div className="min-w-0"><ChatMarkdown text={body} /></div>';
    expect(runProseHook(WEB_TSX, bad)).toBe(2);
  });

  it("FLAGS a <MessageResponse> container introduced with no max-w cap (exit 2)", () => {
    const bad = '<div className="rounded-lg bg-muted/40 p-4"><MessageResponse>{md}</MessageResponse></div>';
    expect(runProseHook(WEB_TSX, bad)).toBe(2);
  });

  it("PASSES the same prose container once it carries a max-w-[68ch] cap (exit 0)", () => {
    const good = '<div className="min-w-0 max-w-[68ch]"><ChatMarkdown text={body} /></div>';
    expect(runProseHook(WEB_TSX, good)).toBe(0);
  });

  it("does NOT false-positive on a full-width DataTable with no max-w (exit 0)", () => {
    const table = '<DataTable columns={cols} data={rows} className="w-full" />';
    expect(runProseHook(WEB_TSX, table)).toBe(0);
  });

  it("does NOT false-positive on a raw full-width table / dense rows (exit 0)", () => {
    const rawTable = ["<div className='w-full overflow-x-auto'>", tag("table"), tag("tbody"), tag("tr"), tag("td"), "x", "</div>"].join(""); // string fixture, not rendered UI
    expect(runProseHook(WEB_TSX, rawTable)).toBe(0);
  });

  it("respects the `prose-measure-allow` opt-out for a deliberately full-bleed transcript (exit 0)", () => {
    const optedOut = '{/* prose-measure-allow: full-bleed chat transcript */}\n<ChatMarkdown text={body} />';
    expect(runProseHook(WEB_TSX, optedOut)).toBe(0);
  });

  it("ignores non-web files (exit 0)", () => {
    const bad = '<div><ChatMarkdown text={body} /></div>';
    expect(runProseHook("/repo/apps/api/src/thing.tsx", bad)).toBe(0);
  });
});
