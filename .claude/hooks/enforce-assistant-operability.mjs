// PostToolUse(Edit|Write|MultiEdit): NON-BLOCKING edit-time reminder for the assistant-operability
// route manifest (WP 4.1, D-AO1/D-AO4). Every react-router `<Route path="…">` in App.tsx needs a
// matching entry in `ASSISTANT_ROUTE_MANIFEST` (a real surface, or a reasoned `exempt`/`redirect`) —
// but the ACTUAL enforcement is the hard gate at `apps/api/test/assistant-route-operability.test.ts`
// (run inside `pnpm test`), because "every route resolves to a real surface or a documented
// exemption" is a whole-repo join across App.tsx, the manifest, and the live resolvers that a
// PostToolUse hook — which only sees the one edited file — cannot evaluate (D-AO1). This hook is
// strictly a courtesy nudge so a developer notices the gap at edit time instead of at `pnpm test`;
// it must NEVER block or fail the edit, so unlike its enforce-brand-ui/check-tokens siblings it
// always exits 0, even when it finds something to flag (prints to stderr as a heads-up only).
import fs from "node:fs";
import path from "node:path";

function main() {
  let raw = "";
  try {
    raw = fs.readFileSync(0, "utf8");
  } catch {
    return;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return;
  }

  const ti = (data && data.tool_input) || {};
  const fp = ti.file_path || "";

  // Fire only for the one file the route manifest is derived from.
  if (!/\/apps\/web\/src\/App\.tsx$/.test(fp)) return;

  // Prefer the full new content the tool call carried (Write); Edit/MultiEdit only carry the
  // changed slice, so fall back to reading the (already-edited, PostToolUse) file off disk to see
  // the whole route table.
  let appSource = null;
  if (typeof ti.content === "string") {
    appSource = ti.content;
  } else {
    try {
      appSource = fs.readFileSync(fp, "utf8");
    } catch {
      return;
    }
  }
  if (typeof appSource !== "string" || appSource.length === 0) return;

  const appPatterns = extractAppTsxRoutePatterns(appSource);
  if (appPatterns.size === 0) return;

  let manifestSource;
  try {
    // Resolve relative to this hook file (.claude/hooks/) so it works regardless of CWD.
    const manifestPath = path.resolve(
      import.meta.dirname,
      "../../packages/shared/src/assistant-route-manifest.ts",
    );
    manifestSource = fs.readFileSync(manifestPath, "utf8");
  } catch {
    return;
  }

  const manifestPatterns = extractManifestPatterns(manifestSource);
  if (manifestPatterns.size === 0) return;

  // `/settings/:section` is a documented manifest-only known-extra (a modal, not an App.tsx
  // <Route> — see assistant-route-manifest.ts); it can never be "missing" from App.tsx coverage.
  const KNOWN_MANIFEST_ONLY = new Set(["/settings/:section"]);

  const missing = [...appPatterns]
    .filter((p) => !manifestPatterns.has(p) && !KNOWN_MANIFEST_ONLY.has(p))
    .sort();

  if (missing.length === 0) return;

  process.stderr.write(
    "assistant-operability: new App.tsx route(s) with no ASSISTANT_ROUTE_MANIFEST entry (reminder only, not a block):\n",
  );
  for (const p of missing) process.stderr.write(`    ${p}\n`);
  process.stderr.write(
    "  Add an entry in packages/shared/src/assistant-route-manifest.ts — a real page-appropriate\n" +
      "  surface (so the dock is context-aware), or a reasoned exempt/redirect (D-AO4) — so\n" +
      "  apps/api/test/assistant-route-operability.test.ts stays green. See .claude/rules/assistant-operability.md.\n",
  );
}

/** Every `path="…"` literal in App.tsx, defensively ignoring commented-out lines (mirrors the gate
 *  test's own extraction so this nudge never disagrees with the authority it points at). */
function extractAppTsxRoutePatterns(appSource) {
  const stripped = appSource
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  const patterns = new Set();
  for (const match of stripped.matchAll(/path="([^"]+)"/g)) {
    patterns.add(match[1]);
  }
  return patterns;
}

/** Every declared `pattern:` literal in the route manifest source. */
function extractManifestPatterns(manifestSource) {
  const patterns = new Set();
  for (const match of manifestSource.matchAll(/pattern:\s*"([^"]+)"/g)) {
    patterns.add(match[1]);
  }
  return patterns;
}

try {
  main();
} catch {
  // A nudge hook must never break the developer's edit.
}
process.exit(0);
