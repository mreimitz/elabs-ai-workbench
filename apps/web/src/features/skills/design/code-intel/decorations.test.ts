import { describe, expect, it } from "vitest";
import { computeTextDecorations } from "./decorations";
import type { DeltaDecoration, MonacoApi, MonacoModel } from "./monaco-types";

// Skill Studio WP 7.5 (SI7) — the decoration pass over the pure matcher: known refs get the known
// underline (bare AND backticked), backticked unknown-toollike spans get the warning underline when
// there IS a scanned bound-tool list, and stay NEUTRAL when there is not (unbound skill). The pass is
// pure over `(model text, knownToolNames)` — no graph — which is exactly what lets the orchestrator
// recompute it on every keystroke and on async bound-tool arrival.

/** A minimal structural stand-in for `monaco.Range` (the pass only constructs and stores them). */
class StubRange {
  constructor(
    readonly startLineNumber: number,
    readonly startColumn: number,
    readonly endLineNumber: number,
    readonly endColumn: number,
  ) {}
}
const monacoApi = { Range: StubRange } as unknown as MonacoApi;

function stubModel(text: string): MonacoModel {
  const lines = text.split(/\r?\n/);
  return {
    getValue: () => text,
    getLineCount: () => lines.length,
    getLineContent: (line: number) => lines[line - 1] ?? "",
  } as unknown as MonacoModel;
}

function inlineClasses(decorations: DeltaDecoration[]): string[] {
  return decorations
    .map((d) => d.options.inlineClassName)
    .filter((name): name is string => typeof name === "string");
}

const KNOWN = ["qlik_search", "qlik_get_data_model"];

describe("computeTextDecorations — tool references", () => {
  it("decorates BOTH backticked and bare known refs with the known class", () => {
    const decorations = computeTextDecorations(
      monacoApi,
      stubModel("Use `qlik_search` then qlik_search again."),
      KNOWN,
    );
    const toolClasses = inlineClasses(decorations).filter((c) => c.includes("skill-ci-tool-ref"));
    expect(toolClasses).toEqual([
      "skill-ci-tool-ref skill-ci-tool-ref--known",
      "skill-ci-tool-ref skill-ci-tool-ref--known",
    ]);
  });

  it("gives a backticked unknown-toollike span the warning class when tools are known", () => {
    const decorations = computeTextDecorations(
      monacoApi,
      stubModel("Call `qlik_serach` first."),
      KNOWN,
    );
    expect(inlineClasses(decorations)).toEqual(["skill-ci-tool-ref skill-ci-tool-ref--unknown"]);
    expect(decorations[0]?.range).toMatchObject({
      startLineNumber: 1,
      startColumn: 7,
      endLineNumber: 1,
      endColumn: 18,
    });
  });

  it("keeps a toollike span NEUTRAL when the known list is empty (unbound — nothing to validate)", () => {
    const decorations = computeTextDecorations(
      monacoApi,
      stubModel("Call `qlik_search` first."),
      [],
    );
    expect(inlineClasses(decorations)).toEqual(["skill-ci-tool-ref"]);
  });

  it("does not decorate bare snake_case words that are not known tools", () => {
    const decorations = computeTextDecorations(
      monacoApi,
      stubModel("The data_model and file_name fields."),
      KNOWN,
    );
    expect(inlineClasses(decorations)).toEqual([]);
  });

  it("decorates a known ref inside a heading (the SI7 flakiness case)", () => {
    const decorations = computeTextDecorations(
      monacoApi,
      stubModel("## Search via qlik_search"),
      KNOWN,
    );
    expect(inlineClasses(decorations)).toEqual(["skill-ci-tool-ref skill-ci-tool-ref--known"]);
  });

  it("reflects a changed tool list over the SAME text (the async-arrival recompute)", () => {
    const model = stubModel("Use `qlik_search`.");
    // Before the bound tools land: neutral.
    expect(inlineClasses(computeTextDecorations(monacoApi, model, []))).toEqual([
      "skill-ci-tool-ref",
    ]);
    // After they land: the same token is now a known reference.
    expect(inlineClasses(computeTextDecorations(monacoApi, model, KNOWN))).toEqual([
      "skill-ci-tool-ref skill-ci-tool-ref--known",
    ]);
  });
});

describe("computeTextDecorations — annotations + breadcrumbs (moved to the text pass)", () => {
  it("still decorates a skillflow annotation line and a breadcrumb marker", () => {
    const text = [
      "<!-- skillflow:gatekeeper id=g1 -->",
      "## Decide",
      "Emit [skillflow:gate=g1 route=yes] when done.",
    ].join("\n");
    const decorations = computeTextDecorations(monacoApi, stubModel(text), []);
    const classes = inlineClasses(decorations);
    expect(classes).toContain("skill-ci-annotation-text");
    expect(classes).toContain("skill-ci-breadcrumb-text");
  });
});
