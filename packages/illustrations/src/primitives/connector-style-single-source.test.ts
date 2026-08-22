import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { CONNECTOR_STYLE } from "./Connector.js";

// ==================================================================================================
// One connector style table, and the gate says so (D-IL8, WP 2.3)
// ==================================================================================================
// WP 2.3 gave the scene renderer a second reason to know what a `write` looks like: it paints from
// the router's filleted `d`, not through the `Connector` component, so it reads `CONNECTOR_STYLE`
// directly. The failure mode that invites is a COPY — six rows retyped into `Scene.tsx`, drifting
// quietly the first time somebody re-tunes a dash. This repo has already paid for that lesson twice
// (two `buildRunFilterWhere` copies; the frozen single `skill-flow-grammar` table that replaced
// them), so the rule gets teeth rather than a comment.
//
// `Connector.test.tsx` keeps ONE deliberate hand-transcribed copy of 01-system-design.md §2.3 as a
// design guard. That copy is expected and is excluded by name. A third occurrence is not.

const SRC_DIR = fileURLToPath(new URL("..", import.meta.url));

/** The one file allowed to restate the table: the design guard described above. */
const SANCTIONED_TRANSCRIPTION = "primitives/Connector.test.tsx";

/** This file, which must name the identifier in order to police it. */
const THIS_FILE = "primitives/connector-style-single-source.test.ts";

/**
 * Assembled at runtime, exactly as `tokens.test.ts` assembles its colour-function pattern: written
 * out whole, the scan would match its own source and report a second declaration that does not
 * exist. A guard that fails on the documentation of the rule is a guard people delete.
 */
const DECLARATION = new RegExp(`\\bconst\\s+CONNECTOR${"_"}STYLE\\b`);

function readSources(dir: string, prefix = ""): (readonly [string, string])[] {
  const found: (readonly [string, string])[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    const label = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) found.push(...readSources(path, label));
    else found.push([label, readFileSync(path, "utf8")] as const);
  }
  return found;
}

const SOURCES = readSources(SRC_DIR);

describe("the connector style table is declared exactly once (D-IL8)", () => {
  it("scans the whole package, at every depth", () => {
    assert.ok(SOURCES.length > 20, `expected the package's sources, found ${SOURCES.length}`);
    assert.ok(SOURCES.some(([name]) => name === "primitives/Connector.tsx"));
    assert.ok(SOURCES.some(([name]) => name.startsWith("scene/")));
  });

  it("finds exactly one declaration of the style table, in Connector.tsx", () => {
    const declarers = SOURCES.filter(([, source]) => DECLARATION.test(source)).map(
      ([name]) => name,
    );
    assert.deepEqual(
      declarers,
      ["primitives/Connector.tsx"],
      "CONNECTOR_STYLE must be declared in exactly one file — import it, never restate it",
    );
  });

  it("finds no second table of the six kinds keyed by name", () => {
    // A copy would not have to reuse the identifier. What it CANNOT avoid is listing the six kinds
    // as object keys next to a `--illus-*` stroke, so that is what is scanned for.
    const shape = /\bflow\s*:\s*\{[\s\S]{0,400}?\bsignal\s*:\s*\{/;
    for (const [name, source] of SOURCES) {
      if (name === "primitives/Connector.tsx") continue;
      if (name === SANCTIONED_TRANSCRIPTION || name === THIS_FILE) continue;
      assert.doesNotMatch(source, shape, `${name} looks like a second connector style table`);
    }
  });

  it("covers all six kinds and paints each from an --illus-* token only", () => {
    assert.deepEqual(Object.keys(CONNECTOR_STYLE).sort(), [
      "flow",
      "loop",
      "publish",
      "read",
      "signal",
      "write",
    ]);
    for (const [kind, style] of Object.entries(CONNECTOR_STYLE)) {
      assert.match(style.stroke, /^var\(--illus-[a-z0-9-]+\)$/, `${kind} strokes a literal`);
    }
  });
});
