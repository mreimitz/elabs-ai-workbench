import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Toolbar-reach WP 4.1 · guardrail 4 (D-TB6 / D-TB8) — the retired page-frame idioms stay retired.
// ------------------------------------------------------------------------------------------------
// The plan collapsed to ONE page-frame grammar: `PageShell` + `ViewToolbar`. `components/PageHeader`
// (D-TB8) and `components/TableToolbar` (D-TB6) were deleted and their consumers migrated. This test
// fails if either file reappears OR if anything imports it again — the "half-applied" B-1 state (two
// idioms coexisting) is exactly what the audit flagged, so re-introducing either is drift.
//
// Source-level (grep-proof) scan of the real tree, same technique as `App.test.ts`.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_SRC = path.resolve(HERE, "..");
const COMPONENTS = path.join(WEB_SRC, "components");

const RETIRED = ["PageHeader", "TableToolbar"] as const;

/** All non-test `.ts`/`.tsx` files under `apps/web/src`. Tests are excluded because a re-
 *  introduction lives in real source (a test that imports a deleted file fails to compile anyway),
 *  and test files legitimately carry import-shaped fixture strings in prose — see this file. */
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

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** A real `import … from "<…/PageHeader|…/TableToolbar>"` statement (ignores the many prose mentions
 *  of the names in migration docblocks). */
function importsRetired(src: string): string[] {
  const clean = stripComments(src);
  const found: string[] = [];
  for (const name of RETIRED) {
    if (new RegExp(`from\\s*["'][^"']*\\/${name}["']`).test(clean)) found.push(name);
  }
  return found;
}

describe("guardrail: retired PageHeader/TableToolbar stay gone (D-TB6/D-TB8 / WP 4.1)", () => {
  it.each(RETIRED)("components/%s.tsx does not exist", (name) => {
    expect(existsSync(path.join(COMPONENTS, `${name}.tsx`))).toBe(false);
  });

  it("nothing in apps/web/src imports the retired components", () => {
    const offenders: string[] = [];
    for (const file of allSourceFiles(WEB_SRC)) {
      const hits = importsRetired(readFileSync(file, "utf8"));
      if (hits.length > 0) offenders.push(`${path.relative(WEB_SRC, file)} -> ${hits.join(", ")}`);
    }
    expect(
      offenders,
      `A retired page-frame component is imported again (D-TB6/D-TB8 — one grammar only: PageShell + ViewToolbar). Offenders:\n${offenders
        .map((o) => `  ${o}`)
        .join("\n")}`,
    ).toEqual([]);
  });

  it("the import detector fires on a real import and ignores a prose mention (built-in proof)", () => {
    expect(importsRetired(`import { PageHeader } from "../../components/PageHeader";`)).toEqual([
      "PageHeader",
    ]);
    expect(importsRetired(`import { TableToolbar } from "./TableToolbar";`)).toEqual([
      "TableToolbar",
    ]);
    // The codebase is full of comments naming these (migration notes) — those must NOT trip it.
    expect(importsRetired(`// the old TableToolbar recipe is deleted; PageHeader is retired`)).toEqual(
      [],
    );
  });
});
