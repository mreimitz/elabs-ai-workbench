import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Toolbar-reach WP 4.1 · guardrail 1 (audit §F, finding C-8) — "so this doesn't drift a THIRD time".
// ------------------------------------------------------------------------------------------------
// `@brand/data`'s DataTable renders "Page 1 of 1" with two DISABLED Previous/Next buttons the moment
// `enablePagination` is set — even for a single page (S10). `lib/table.tsx` ships `shouldPaginate()`
// exactly to gate that: `enablePagination={shouldPaginate(rows.length, PAGE_SIZE)}`. This has drifted
// twice; this test fails on ANY bare `enablePagination` / `enablePagination={true}` / any non-
// `shouldPaginate(...)` value in `apps/web/src`, so it can't drift a third time. (The mechanical fix
// at the six call sites is C-8; this is the lint that keeps them honest.)
//
// There is no full-`<App>` render harness in this repo, so — like `App.test.ts` — this is a source-
// level (grep-proof) scan of the real tree, not a rendered check.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_SRC = path.resolve(HERE, "..");

/** All non-test `.ts`/`.tsx` source files under `apps/web/src`. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    if (/\.(test|spec)\.(ts|tsx)$/.test(entry.name)) continue; // tests reference the string in prose
    if (entry.name.endsWith(".d.ts")) continue;
    out.push(full);
  }
  return out;
}

/** Strip block + line comments so a `enablePagination` mentioned in a docblock (e.g. table.tsx's
 *  own JSDoc for `shouldPaginate`) is never counted as a call site. `://` (URLs) is preserved. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** Every `enablePagination` occurrence that is NOT `={shouldPaginate(...)}`-guarded. */
function unguardedPagination(src: string): string[] {
  const bad: string[] = [];
  const re = /enablePagination\s*(=\s*\{([^{}]*)\})?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const value = m[2]?.trim();
    // Valid ONLY when the JSX value is a `shouldPaginate(...)` call. A bare `enablePagination`
    // (boolean shorthand → m[2] is undefined) or `={true}` / any other expression is a violation.
    if (value && /^shouldPaginate\s*\(/.test(value)) continue;
    bad.push(m[0].replace(/\s+/g, " "));
  }
  return bad;
}

describe("guardrail: every DataTable enablePagination is shouldPaginate()-guarded (audit C-8 / WP 4.1)", () => {
  it("has zero bare or `={true}` enablePagination in apps/web/src", () => {
    const offenders: { file: string; hits: string[] }[] = [];
    for (const file of sourceFiles(WEB_SRC)) {
      const src = stripComments(readFileSync(file, "utf8"));
      if (!src.includes("enablePagination")) continue;
      const hits = unguardedPagination(src);
      if (hits.length > 0) offenders.push({ file: path.relative(WEB_SRC, file), hits });
    }
    expect(
      offenders,
      `Unguarded enablePagination — use enablePagination={shouldPaginate(rows.length, PAGE_SIZE)} (see lib/table.tsx). Offenders:\n${offenders
        .map((o) => `  ${o.file}: ${o.hits.join(", ")}`)
        .join("\n")}`,
    ).toEqual([]);
  });

  it("the detector itself flags the drift patterns (built-in proof it fails on the pre-fix code)", () => {
    // A guardrail that can't catch the thing it guards is theatre — lock the detector directly.
    expect(unguardedPagination("<DataTable enablePagination />")).toHaveLength(1); // bare boolean shorthand
    expect(unguardedPagination("<DataTable enablePagination={true} />")).toHaveLength(1);
    expect(unguardedPagination("<DataTable enablePagination={rows.length > 10} />")).toHaveLength(1);
    expect(
      unguardedPagination("<DataTable enablePagination={shouldPaginate(rows.length, 25)} />"),
    ).toHaveLength(0);
  });

  it("guards the real six call sites (present, so the tree really exercises the guarded form)", () => {
    let guarded = 0;
    for (const file of sourceFiles(WEB_SRC)) {
      const src = stripComments(readFileSync(file, "utf8"));
      guarded += (src.match(/enablePagination\s*=\s*\{\s*shouldPaginate\s*\(/g) ?? []).length;
    }
    expect(guarded).toBeGreaterThanOrEqual(6);
  });
});
