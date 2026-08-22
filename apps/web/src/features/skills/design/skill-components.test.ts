import { describe, expect, test } from "vitest";
import type { SkillGraph, SkillGraphNode } from "@mcp-token-footprint/shared";
import { explainerFor } from "./code-intel/explainers";
import {
  annotationIdFor,
  appendSentence,
  COMMAND_PLACEHOLDER,
  componentTargetError,
  isSkillComponentId,
  KEYWORD_PLACEHOLDER,
  LOOP_GUARD_SENTENCE,
  nextAvailableName,
  resolveComponentPlacement,
  sectionBodyText,
  skillComponentSpec,
  SKILL_COMPONENTS,
  SUBROUTINE_STARTER_BODY,
  validationGateSentence,
  type ComponentPlacementInput,
  type SkillComponentId,
} from "./skill-components";

// ── RM-30 WP 7.7 (D-UX19 #3) — the components vocabulary, tested where it is PURE ─────────────────
// `resolveComponentPlacement` is the single decision point behind BOTH creation gestures: the canvas
// drop and the palette's keyboard Add. So the interesting assertions are here rather than in the
// render test — if a keyboard author and a mouse author could ever stage different ops, it would be
// because this function was called with different inputs, not because it made different decisions.
//
// What this file pins:
//   • all nine components exist, in the authoring order the palette renders;
//   • each one composes ops that ALREADY exist in the frozen `SkillEditOp` union — no invented op;
//   • a component that references something which must RESOLVE refuses rather than inventing a name;
//   • a section-bound component refuses a non-section target with a reason that names the target;
//   • placeholder names de-duplicate, so two drops never collide.

// `anchor.startLine` is the projector's 1-based HEADING line, which is also the 0-based index of the
// first body line — that identity is what makes `sectionBodyText`'s slice the heading-excluded body.
const section = (id: string, label: string, startLine = 2, endLine = 4): SkillGraphNode => ({
  id,
  kind: "subroutine",
  label,
  anchor: { headingPath: ["Skill", label], startLine, endLine },
  source: "inferred",
});

const assetNode = (id: string, label: string): SkillGraphNode => ({
  id,
  kind: "asset",
  label,
  path: "reference/notes.md",
  fileKind: "reference",
  anchor: { headingPath: ["Skill", label], startLine: 9, endLine: 10 },
  source: "inferred",
});

const TEXT = ["# Skill", "## Collect input", "Ask for the file.", "Then read it.", "## Next"].join(
  "\n",
);

const graphWith = (...nodes: SkillGraphNode[]): SkillGraph => ({ nodes, edges: [], warnings: [] });

function place(overrides: Partial<ComponentPlacementInput> & { component: SkillComponentId }) {
  return resolveComponentPlacement({
    targetNodeId: null,
    graph: graphWith(section("sec-1", "Collect input")),
    text: TEXT,
    existingTitles: [],
    existingCommands: [],
    existingKeywords: [],
    canStageSettings: true,
    ...overrides,
  });
}

describe("the nine components", () => {
  test("the catalog is exactly the nine kinds D-UX19 #3 names, in authoring order", () => {
    expect(SKILL_COMPONENTS.map((spec) => spec.id)).toEqual([
      "keyword",
      "command",
      "section",
      "subroutine",
      "gatekeeper",
      "validation_gate",
      "loop_guard",
      "tool_reference",
      "asset",
    ]);
  });

  test("every component's explainer id RESOLVES — the deleted Legend's vocabulary moved, not vanished", () => {
    // SI17 deletes the Legend button on the promise that the palette rows carry the same teaching
    // copy. A typo'd id would render an empty row description and quietly break that promise, so
    // assert the registry lookup actually lands rather than that the string is non-empty.
    for (const spec of SKILL_COMPONENTS) {
      expect(spec.label.length).toBeGreaterThan(0);
      const explainer = explainerFor(spec.explainerId);
      expect(explainer, `no explainer registered for “${spec.explainerId}”`).toBeDefined();
      expect(explainer?.short.length ?? 0).toBeGreaterThan(0);
    }
  });

  test("exactly the three referencing components ask for a value", () => {
    const asking = SKILL_COMPONENTS.filter((spec) => spec.needsValue).map((spec) => spec.id);
    expect(asking).toEqual(["validation_gate", "tool_reference", "asset"]);
  });

  test("a drag payload is untrusted text — only the nine ids are accepted", () => {
    expect(isSkillComponentId("gatekeeper")).toBe(true);
    expect(isSkillComponentId("Gatekeeper")).toBe(false);
    expect(isSkillComponentId("__proto__")).toBe(false);
    expect(isSkillComponentId(null)).toBe(false);
    expect(isSkillComponentId({ component: "section" })).toBe(false);
    expect(skillComponentSpec("nope")).toBeUndefined();
  });
});

describe("document-level components", () => {
  test("a keyword stages frontmatter, not an edit op — and SAYS the flow updates on save", () => {
    // The one component that changes nothing on the canvas immediately: frontmatter has exactly one
    // writer (the Studio settings draft), so a keyword becomes an entry-point node only when the
    // projector re-reads the saved document. The copy has to admit that, or the author presses Add,
    // sees no node, and concludes it did not work.
    const result = place({ component: "keyword" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ops).toEqual([]);
    expect(result.keyword).toBe(KEYWORD_PLACEHOLDER);
    expect(result.description).toMatch(/once you save|after you save/i);
  });

  test("a keyword de-duplicates against the keywords already declared", () => {
    const result = place({ component: "keyword", existingKeywords: [KEYWORD_PLACEHOLDER] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.keyword).toBe(`${KEYWORD_PLACEHOLDER} 2`);
  });

  test("a keyword refuses when there is no draft to stage frontmatter on", () => {
    const result = place({ component: "keyword", canStageSettings: false });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/Studio/);
  });

  test("a /command stages add_command and de-duplicates with a suffix, not a space", () => {
    const first = place({ component: "command" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.ops).toEqual([{ op: "add_command", command: COMMAND_PLACEHOLDER }]);

    const second = place({ component: "command", existingCommands: [COMMAND_PLACEHOLDER] });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.ops).toEqual([{ op: "add_command", command: `${COMMAND_PLACEHOLDER}-2` }]);
  });
});

describe("structural components", () => {
  test("a section dropped on empty canvas appends at the end of the document", () => {
    const result = place({ component: "section" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ops).toEqual([
      { op: "add_subroutine", afterNodeId: null, title: "New section" },
    ]);
  });

  test("a section dropped ON a section is inserted after it", () => {
    const result = place({ component: "section", targetNodeId: "sec-1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ops).toEqual([
      { op: "add_subroutine", afterNodeId: "sec-1", title: "New section" },
    ]);
    expect(result.description).toContain("Collect input");
  });

  test("two sections in a row do not collide — the second is 'New section 2'", () => {
    const result = place({ component: "section", existingTitles: ["New section"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ops[0]).toMatchObject({ title: "New section 2" });
  });

  test("a sub-routine carries the procedure starter body; a plain section does not", () => {
    const sub = place({ component: "subroutine" });
    const plain = place({ component: "section" });
    expect(sub.ok && sub.ops[0]).toMatchObject({ body: SUBROUTINE_STARTER_BODY });
    expect(plain.ok && plain.ops[0]).not.toHaveProperty("body");
  });

  test("the starter bodies avoid the projector's own trigger words", () => {
    // A scaffold that silently re-kinds the node it just created is worse than no scaffold: an
    // if/otherwise pair would project the section as a gatekeeper, `repeat` as a loop guard.
    expect(SUBROUTINE_STARTER_BODY.toLowerCase()).not.toMatch(/\botherwise\b|\brepeat\b|\bretry\b/);
  });
});

describe("section-bound components refuse a target that cannot carry them", () => {
  const graph = graphWith(section("sec-1", "Collect input"), assetNode("asset-1", "notes.md"));

  test.each(["gatekeeper", "validation_gate", "loop_guard", "tool_reference", "asset"] as const)(
    "%s refuses a drop on empty canvas",
    (component) => {
      const result = place({ component, graph, targetNodeId: null });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.title).toMatch(/onto a section/);
    },
  );

  test("the refusal names the node that was actually under the pointer", () => {
    const result = place({ component: "gatekeeper", graph, targetNodeId: "asset-1" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("notes.md");
    expect(result.reason).toContain("asset");
  });

  test("componentTargetError is the same rule the resolver applies — one copy, not two", () => {
    for (const component of ["gatekeeper", "validation_gate", "asset"] as const) {
      const early = componentTargetError(component, "asset-1", graph);
      const resolved = place({ component, graph, targetNodeId: "asset-1" });
      expect(early).not.toBeNull();
      expect(resolved.ok).toBe(false);
      if (resolved.ok || early === null) continue;
      expect(resolved.title).toBe(early.title);
      expect(resolved.reason).toBe(early.reason);
    }
    // A legal target produces no early error, so the picker opens rather than refusing.
    expect(componentTargetError("asset", "sec-1", graph)).toBeNull();
  });

  test("a preview-only section (added but not saved) is refused honestly, not staged blind", () => {
    // The canvas paints the PREVIEW projection; every op addresses the authoritative graph. A node
    // that exists only in the preview resolves to nothing here.
    const result = place({ component: "gatekeeper", targetNodeId: "preview:not-saved-yet" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/not saved yet|saved section/i);
  });
});

describe("control components", () => {
  test("a gatekeeper stages a set_annotation whose id is a slug of the section label", () => {
    const result = place({ component: "gatekeeper", targetNodeId: "sec-1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ops).toEqual([
      { op: "set_annotation", nodeId: "sec-1", kind: "gatekeeper", id: "collect-input" },
    ]);
  });

  test("an annotation id never collides with a node id already in the graph", () => {
    const graph = graphWith(section("sec-1", "Collect input"), section("collect-input", "Other"));
    const result = place({ component: "gatekeeper", targetNodeId: "sec-1", graph });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ops[0]).toMatchObject({ id: "collect-input-2" });
  });

  test("a loop guard appends the bounding sentence to the section's CURRENT body", () => {
    const result = place({ component: "loop_guard", targetNodeId: "sec-1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ops).toEqual([
      {
        op: "update_section_body",
        nodeId: "sec-1",
        body: `Ask for the file.\nThen read it.\n\n${LOOP_GUARD_SENTENCE}`,
      },
    ]);
  });

  test("a loop guard composes with a PENDING body edit instead of clobbering it", () => {
    const result = place({
      component: "loop_guard",
      targetNodeId: "sec-1",
      pendingBodies: new Map([["sec-1", "Rewritten by hand."]]),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ops[0]).toMatchObject({
      body: `Rewritten by hand.\n\n${LOOP_GUARD_SENTENCE}`,
    });
  });

  test("a second loop guard on the same section is refused, not duplicated", () => {
    const result = place({
      component: "loop_guard",
      targetNodeId: "sec-1",
      pendingBodies: new Map([["sec-1", `Do the thing.\n\n${LOOP_GUARD_SENTENCE}`]]),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.title).toBe("Already bounded");
  });
});

describe("referencing components never invent an identifier", () => {
  test("a validation gate with no picked script refuses", () => {
    const result = place({ component: "validation_gate", targetNodeId: "sec-1" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.title).toMatch(/Pick the script/);
  });

  test("a validation gate with a script stages the asset ref AND the gate annotation", () => {
    const result = place({
      component: "validation_gate",
      targetNodeId: "sec-1",
      value: { kind: "file", path: "scripts/check.sh" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ops).toEqual([
      {
        op: "add_asset_ref",
        nodeId: "sec-1",
        path: "scripts/check.sh",
        sentence: validationGateSentence("scripts/check.sh"),
      },
      { op: "set_annotation", nodeId: "sec-1", kind: "gate", id: "collect-input" },
    ]);
    // `verify` + an exit code is the language the projector reads as a gate; an if/otherwise pair
    // would instead make the section a gatekeeper.
    expect(validationGateSentence("scripts/check.sh")).toMatch(/verify/i);
    expect(validationGateSentence("scripts/check.sh").toLowerCase()).not.toContain("otherwise");
  });

  test("a tool reference with no picked tool refuses; with one it stages add_tool_ref", () => {
    const refused = place({ component: "tool_reference", targetNodeId: "sec-1" });
    expect(refused.ok).toBe(false);

    const staged = place({
      component: "tool_reference",
      targetNodeId: "sec-1",
      value: { kind: "tool", server: "files", tool: "read_file" },
    });
    expect(staged.ok).toBe(true);
    if (!staged.ok) return;
    expect(staged.ops).toEqual([
      { op: "add_tool_ref", nodeId: "sec-1", server: "files", tool: "read_file" },
    ]);
  });

  test("an asset reference with no picked file refuses; with one it stages add_asset_ref", () => {
    const refused = place({ component: "asset", targetNodeId: "sec-1" });
    expect(refused.ok).toBe(false);

    const staged = place({
      component: "asset",
      targetNodeId: "sec-1",
      value: { kind: "file", path: "reference/api.md" },
    });
    expect(staged.ok).toBe(true);
    if (!staged.ok) return;
    expect(staged.ops).toEqual([
      { op: "add_asset_ref", nodeId: "sec-1", path: "reference/api.md" },
    ]);
  });

  test("a tool value handed to the asset component is not silently reinterpreted", () => {
    const result = place({
      component: "asset",
      targetNodeId: "sec-1",
      value: { kind: "tool", server: "files", tool: "read_file" },
    });
    expect(result.ok).toBe(false);
  });
});

describe("total and non-throwing", () => {
  test("every component resolves to a decision — never an exception — with no graph loaded", () => {
    for (const spec of SKILL_COMPONENTS) {
      const result = place({ component: spec.id, graph: null });
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });

  test("every component resolves to a decision on a legal section target", () => {
    for (const spec of SKILL_COMPONENTS) {
      const result = place({
        component: spec.id,
        targetNodeId: "sec-1",
        ...(spec.needsValue === "tool"
          ? { value: { kind: "tool" as const, server: "files", tool: "read_file" } }
          : spec.needsValue
            ? { value: { kind: "file" as const, path: "scripts/check.sh" } }
            : {}),
      });
      expect(result.ok).toBe(true);
    }
  });
});

describe("the naming and body helpers", () => {
  test("nextAvailableName is case-insensitive — two headings differing only in case read the same", () => {
    expect(nextAvailableName("New section", [])).toBe("New section");
    expect(nextAvailableName("New section", ["NEW SECTION"])).toBe("New section 2");
    expect(nextAvailableName("New section", ["New section", "New section 2"])).toBe(
      "New section 3",
    );
  });

  test("annotationIdFor slugifies and never returns an empty id", () => {
    expect(annotationIdFor("Collect the Input!", [])).toBe("collect-the-input");
    expect(annotationIdFor("???", [])).toBe("section");
  });

  test("sectionBodyText reads the span between the heading and the next one", () => {
    expect(sectionBodyText(TEXT, section("sec-1", "Collect input"))).toBe(
      "Ask for the file.\nThen read it.",
    );
  });

  test("appendSentence keeps one blank line and no trailing blank", () => {
    expect(appendSentence("", "Bounded.")).toBe("Bounded.");
    expect(appendSentence("Body.\n\n\n", "Bounded.")).toBe("Body.\n\nBounded.");
  });
});
