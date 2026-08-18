import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { ASSISTANT_ROUTE_MANIFEST } from "@mcp-token-footprint/shared";

// ==================================================================================================
// Notification / report deep links must point at routes that EXIST
// ==================================================================================================
// Regression guard for a real defect: the notification center's rows deep-link through the
// `linkPath` the API stamps on each notification, and three hub emitters (`hubNotify` in `index.ts`)
// wrote `/assistant/s/<sessionId>` — a route that has never existed (the hub workspace deep-links a
// session as `/assistant?session=<id>`). Clicking any mission/waiting-for-you notification therefore
// landed on the 404 catch-all, i.e. "click and navigate to target is not working at all". The fleet
// -issue links had the same defect (`/testing/observability/issues/<id>` — the issues surface is the
// Dashboard's Issues tab, `/dashboard?tab=issues&issue=<id>`).
//
// The class of bug is DRIFT between a path the API writes and the route table the web app declares,
// which no type can catch (both sides are strings) and no unit test noticed (the emitters live in the
// composition root). So this is a source-scanning gate in the same spirit as
// `assistant-route-operability.test.ts`: every `linkPath` LITERAL in `apps/api/src` is matched against
// `ASSISTANT_ROUTE_MANIFEST` — which that gate already pins, byte-identical, to App.tsx's `<Route>`
// table. A link to a route that does not exist fails here.

/** Every `.ts` file under `apps/api/src` (dist/ and node_modules are outside this root). */
function apiSourceFiles(): string[] {
  const root = path.resolve(import.meta.dirname, "../src");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) files.push(full);
    }
  };
  walk(root);
  return files;
}

interface FoundLink {
  file: string;
  raw: string;
}

/**
 * Every `linkPath: "…"` / `linkPath: \`…\`` LITERAL whose value starts with `/`. Property accesses
 * (`issue.linkPath`), type declarations (`linkPath?: string`) and pass-throughs
 * (`linkPath: input.linkPath`) carry no literal and are skipped — they are re-checked at whichever
 * site produced the literal.
 */
function literalLinkPaths(): FoundLink[] {
  const found: FoundLink[] = [];
  for (const file of apiSourceFiles()) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/linkPath:\s*(["`])(\/[^"`]*)\1/g)) {
      found.push({ file: path.relative(path.resolve(import.meta.dirname, "../../.."), file), raw: match[2] as string });
    }
  }
  return found;
}

/** `/assistant?session=${id}` → `/assistant`; `/testing/runs/${runId}` → `/testing/runs/:param`. */
function normalize(raw: string): string {
  const withoutQuery = (raw.split("?")[0] as string).split("#")[0] as string;
  return withoutQuery.replace(/\$\{[^}]*\}/g, ":param");
}

/** Segment-wise match where a `:param` segment on EITHER side matches any single segment. */
function matchesPattern(pattern: string, candidate: string): boolean {
  const a = pattern.split("/");
  const b = candidate.split("/");
  if (a.length !== b.length) return false;
  return a.every((segment, i) => {
    const other = b[i] as string;
    if (segment.startsWith(":")) return other.length > 0;
    if (other.startsWith(":")) return segment.length > 0;
    return segment === other;
  });
}

// The 404 catch-all matches everything, so it must not be allowed to satisfy a link.
const REAL_ROUTES = ASSISTANT_ROUTE_MANIFEST.map((entry) => entry.pattern).filter((p) => p !== "*");

test("every literal notification/report linkPath resolves to a declared app route", () => {
  const links = literalLinkPaths();
  // Sanity: the scan must actually find the known emitters, or the regex silently guards nothing.
  assert.ok(links.length >= 6, `expected to find linkPath literals in apps/api/src, found ${links.length}`);

  const broken = links.filter(
    (link) => !REAL_ROUTES.some((pattern) => matchesPattern(pattern, normalize(link.raw))),
  );
  assert.deepEqual(
    broken.map((link) => `${link.file}: ${link.raw}`),
    [],
    "these linkPaths point at routes that do not exist in App.tsx (see ASSISTANT_ROUTE_MANIFEST)",
  );
});

test("a hub session deep link uses the ?session= workspace route, never a /assistant/s/ path", () => {
  const links = literalLinkPaths().filter((link) => link.raw.startsWith("/assistant"));
  assert.ok(links.length > 0, "expected the hub notify sink to emit assistant deep links");
  for (const link of links) {
    assert.match(
      link.raw,
      /^\/assistant\?session=/,
      `${link.file}: the hub workspace opens a session via /assistant?session=<id>`,
    );
  }
});
