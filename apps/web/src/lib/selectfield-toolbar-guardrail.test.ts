import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Toolbar-reach WP 4.1 · guardrail 2 (D-TB9 — label-above controls banned in toolbars).
// ------------------------------------------------------------------------------------------------
// `components/SelectField` is a LABEL-ABOVE stack — for dialogs and form bodies only. Dropped into a
// toolbar/filter row it floats a label ABOVE the control and breaks the row's shared baseline (the
// exact C-1 defect the audit diagnosed twice: DirectoryTab.tsx already replaced it, UsageToolbar did
// not). Toolbar single-selects use a bare `Select` + `SelectTrigger aria-label`. This test fails if
// ANY module whose filename matches `*Toolbar*` or `*Filter*` imports `components/SelectField`.
//
// Source-level (grep-proof) scan of the real tree, same technique as `App.test.ts`.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_SRC = path.resolve(HERE, "..");

/** All `.ts`/`.tsx` files under `apps/web/src` whose BASENAME contains "toolbar" or "filter"
 *  (case-insensitive), excluding tests. These are the toolbar/filter modules D-TB9 governs. */
function toolbarOrFilterFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...toolbarOrFilterFiles(full));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    if (/\.(test|spec)\.(ts|tsx)$/.test(entry.name)) continue;
    if (!/(toolbar|filter)/i.test(entry.name)) continue;
    out.push(full);
  }
  return out;
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** Whether `src` has a real `import … from "<…/SelectField>"` (the component), not a mention of the
 *  word "SelectField" in prose. Matches any module path whose final segment is `SelectField`. */
function importsSelectField(src: string): boolean {
  return /from\s*["'][^"']*\/SelectField["']/.test(stripComments(src));
}

describe("guardrail: no components/SelectField import in a *Toolbar*/*Filter* module (D-TB9 / WP 4.1)", () => {
  it("finds the toolbar/filter modules to govern (guards against the scan silently matching nothing)", () => {
    const files = toolbarOrFilterFiles(WEB_SRC).map((f) => path.relative(WEB_SRC, f));
    expect(files.length).toBeGreaterThan(0);
    // Anchor a couple of known modules so a future rename can't make this scan vacuously pass.
    expect(files.some((f) => f.endsWith("ViewToolbar.tsx"))).toBe(true);
    expect(files.some((f) => /UsageToolbar\.tsx$/.test(f))).toBe(true);
  });

  it("no toolbar/filter module imports the label-above SelectField", () => {
    const offenders = toolbarOrFilterFiles(WEB_SRC)
      .filter((file) => importsSelectField(readFileSync(file, "utf8")))
      .map((file) => path.relative(WEB_SRC, file));
    expect(
      offenders,
      `A *Toolbar*/*Filter* module imports components/SelectField (label-above, banned in toolbars — D-TB9). Use a bare Select + SelectTrigger aria-label. Offenders:\n${offenders
        .map((o) => `  ${o}`)
        .join("\n")}`,
    ).toEqual([]);
  });

  it("the detector flags a real import and ignores a prose mention (built-in proof)", () => {
    expect(importsSelectField(`import { SelectField } from "../../components/SelectField";`)).toBe(
      true,
    );
    expect(importsSelectField(`import { SelectField } from "./SelectField";`)).toBe(true);
    // A comment that merely names SelectField (as FilterControls.tsx does) must NOT trip it.
    expect(importsSelectField(`// C-1 fix: this used to be a SelectField label-above stack`)).toBe(
      false,
    );
    expect(importsSelectField(`import { Select } from "@elabs-ai/components-ui";`)).toBe(false);
  });
});
