// ==================================================================================================
// build-preview — render the primitives sheet to standalone HTML, one file per theme
// ==================================================================================================
// WP 0.2's acceptance asks for both themes verified BY LOOKING, with a screenshot each. This builds
// the thing to look at, and it does it honestly:
//
//   * the SVG is rendered from the REAL React components (`PrimitivesSheet`), not re-drawn;
//   * the colours come from the REAL installed @elabs-ai/components-tokens theme stylesheets, not
//     from stand-in values — so what the screenshot shows is what the app shows;
//   * `tokens.css` is included unmodified, so `--illus-*` resolves through the same one mapping file
//     the app uses.
//
// One file PER THEME, with `data-theme` on `<html>`, because that is how the app applies a theme and
// because `--illus-*` is declared on `:root`: two panels in one document would both resolve against
// whatever `:root` said, and the dark panel would silently show light values.
//
// Output goes to a gitignored `.artifacts/` directory. It is a measurement of the code, regenerated
// on demand — never a committed file that can go stale.
//
// Written with `createElement` rather than JSX because `scripts/` sits outside the package's
// `tsconfig.json` `include`, so the JSX transform is not configured for it.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PRIMITIVE_SHEET_SIZE, PrimitivesSheet } from "../src/preview/PrimitivesSheet.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(HERE, "..");
const REPO_ROOT = join(PACKAGE_ROOT, "..", "..");
const OUT_DIR = join(REPO_ROOT, ".artifacts", "illustrations-preview");

/** The installed theme stylesheets. They live under `apps/web`, which is the only consumer. */
function themeCss(theme: "light" | "dark"): string {
  const path = join(
    REPO_ROOT,
    "apps/web/node_modules/@elabs-ai/components-tokens/dist/themes",
    `${theme}.css`,
  );
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new Error(
      `Could not read the ${theme} theme stylesheet at ${path}. Run \`pnpm install\` first — the ` +
        "preview deliberately uses the INSTALLED tokens rather than a copy, so that a screenshot " +
        "cannot drift from what the app renders.",
    );
  }
}

const ILLUS_TOKENS = readFileSync(join(PACKAGE_ROOT, "src/tokens.css"), "utf8");

function page(theme: "light" | "dark"): string {
  const svg = renderToStaticMarkup(createElement(PrimitivesSheet, { subtitle: `${theme} theme` }));
  return `<!doctype html>
<html lang="en" data-theme="${theme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Illustration primitives — WP 0.2 — ${theme}</title>
<style>
/* The installed ${theme} theme, verbatim. */
${themeCss(theme)}
/* The package's own indirection layer, verbatim — the only file that binds --illus-* upstream. */
${ILLUS_TOKENS}
/* Page furniture only. No colour of its own: the stage paints itself from --illus-paper. */
html, body { margin: 0; padding: 0; background: var(--illus-paper); color: var(--illus-ink); }
body { font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif; }
svg { display: block; }
</style>
</head>
<body>
${svg}
</body>
</html>
`;
}

mkdirSync(OUT_DIR, { recursive: true });
for (const theme of ["light", "dark"] as const) {
  const file = join(OUT_DIR, `primitives-${theme}.html`);
  writeFileSync(file, page(theme), "utf8");
  console.log(`wrote ${file}`);
}
console.log(`sheet size: ${PRIMITIVE_SHEET_SIZE.width}x${PRIMITIVE_SHEET_SIZE.height}`);
