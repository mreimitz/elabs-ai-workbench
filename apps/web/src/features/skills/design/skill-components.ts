import type { SkillEditOp, SkillGraph, SkillGraphNode } from "@mcp-token-footprint/shared";
import { isSectionNode } from "./use-edit-ops";

// ── RM-30 WP 7.7 (SI12/SI17, D-UX19#3) — the components vocabulary, as data ───────────────────────
// D-UX19 corrected the authoring model: "creation is drag-from-palette". This module is the pure
// half of that — the nine authorable components and the ONE function that turns
// (component + drop target) into the typed `SkillEditOp`s the existing buffer already understands.
// Nothing here renders, fetches or mutates: the palette and the canvas both call
// `resolveComponentPlacement`, so a keyboard "Add" and a mouse drop can never disagree about what a
// component means.
//
// Two hard constraints shaped every mapping below, and both are worth stating plainly:
//
//  1. `SKILL_EDIT_OP_TYPES` is FROZEN (a shared wire contract). No component invents an op — each one
//     composes ops that already exist and whose text semantics `apps/api/src/skillflow/roundtrip.ts`
//     already implements. That is why a "gatekeeper" is a `set_annotation` and a "loop guard" is a
//     body append: those are the mechanisms the projector actually reads.
//  2. A component NEVER invents an identifier that has to RESOLVE. A title is a placeholder an author
//     renames; a tool name or a file path is not — a made-up one is exactly the dangling reference the
//     Problems panel exists to shout about. So the reference components take a PICKED value and are
//     refused (with a reason) when there is nothing to pick.

/** The dataTransfer MIME a palette-tool drag carries — read by `SkillGraphCanvas`'s drop handler to
 *  stage an `add_tool_ref` onto the section node the tool was dropped on. */
export const TOOL_DRAG_MIME = "application/x-mcp-tool";

/** The drag payload serialized into {@link TOOL_DRAG_MIME} on `dragstart`. */
export type ToolDragPayload = { server: string; tool: string };

/** The dataTransfer MIME a palette-COMPONENT drag carries (WP 7.7). Distinct from the tool MIME so a
 *  drop handler never has to guess which of the two kinds of payload it is looking at. */
export const COMPONENT_DRAG_MIME = "application/x-skill-component";

/** The drag payload serialized into {@link COMPONENT_DRAG_MIME} on `dragstart`. */
export type ComponentDragPayload = { component: SkillComponentId };

/** One authorable skill component — the palette's section-1 vocabulary. */
export type SkillComponentId =
  | "keyword"
  | "command"
  | "section"
  | "subroutine"
  | "gatekeeper"
  | "validation_gate"
  | "loop_guard"
  | "tool_reference"
  | "asset";

/** What a component needs to be placed. */
export type SkillComponentTarget =
  /** Skill- or document-level: a drop anywhere lands it (no node needed). */
  | "document"
  /** A section positions it, but dropping on empty canvas appends at the document end. */
  | "section-optional"
  /** Meaningless without a section to attach to — refused, with a reason, otherwise. */
  | "section-required";

/** A value the author must PICK (never invented) before the component can be placed. */
export type SkillComponentValueKind = "tool" | "script" | "file";

export type SkillComponentSpec = {
  id: SkillComponentId;
  /** The palette row's label. */
  label: string;
  /** The explainer-registry id whose teaching copy this row shows — the SAME entries the deleted
   *  canvas Legend popover listed, so killing that button loses no vocabulary. */
  explainerId: string;
  target: SkillComponentTarget;
  /** Present ⇒ the row opens a picker instead of placing straight away. */
  needsValue?: SkillComponentValueKind;
};

/**
 * The nine components, in authoring order (identity → structure → control → references). The order is
 * the palette's render order and the canonical order for tests.
 */
export const SKILL_COMPONENTS: readonly SkillComponentSpec[] = [
  { id: "keyword", label: "Keyword", explainerId: "trigger:keyword", target: "document" },
  { id: "command", label: "/command", explainerId: "trigger:command", target: "document" },
  { id: "section", label: "Section", explainerId: "subroutine", target: "section-optional" },
  { id: "subroutine", label: "Sub-routine", explainerId: "subroutine", target: "section-optional" },
  { id: "gatekeeper", label: "Gatekeeper", explainerId: "gatekeeper", target: "section-required" },
  {
    id: "validation_gate",
    label: "Validation gate",
    explainerId: "validation_gate",
    target: "section-required",
    needsValue: "script",
  },
  { id: "loop_guard", label: "Loop guard", explainerId: "loop_guard", target: "section-required" },
  {
    id: "tool_reference",
    label: "Tool reference",
    explainerId: "tool_ref",
    target: "section-required",
    needsValue: "tool",
  },
  {
    id: "asset",
    label: "Asset reference",
    explainerId: "asset",
    target: "section-required",
    needsValue: "file",
  },
] as const;

const BY_ID = new Map(SKILL_COMPONENTS.map((spec) => [spec.id, spec] as const));

/** The spec for a component id, or `undefined` for a string that is not one. */
export function skillComponentSpec(id: string): SkillComponentSpec | undefined {
  return BY_ID.get(id as SkillComponentId);
}

/** True for a string that names one of the nine components (drag payloads are untrusted strings). */
export function isSkillComponentId(value: unknown): value is SkillComponentId {
  return typeof value === "string" && BY_ID.has(value as SkillComponentId);
}

// ── The starter content each structural component writes ──────────────────────────────────────────
// Deliberately free of the projector's own trigger words: an `if`/`otherwise` pair would make a plain
// section project as a GATEKEEPER, and `repeat`/`retry`/`loop` would hang a LOOP GUARD off it. A
// scaffold that silently changes the node kind it just created is worse than no scaffold.

/** The starter body a "Sub-routine" writes — the procedure shape the authoring guide asks for. */
export const SUBROUTINE_STARTER_BODY = ["Steps:", "", "1. First step.", "2. Second step."].join(
  "\n",
);

/** The sentence a "Loop guard" appends. `repeat` + `at most 3` is exactly what the projector's
 *  `detectLoop` reads to emit a `loop_guard` node with `maxIterations: 3`. */
export const LOOP_GUARD_SENTENCE = "Repeat this step at most 3 times, then stop and report.";

/** The sentence a "Validation gate" appends for the picked script. `verify` is the exit-code
 *  language `hasVerifyLanguage` needs; it deliberately carries no `if`/`otherwise` pair, which would
 *  instead make the section a gatekeeper. */
export function validationGateSentence(path: string): string {
  return `Run \`${path}\` and verify it exits 0 before continuing.`;
}

/** The default keyword a dropped "Keyword" stages, before de-duplication. */
export const KEYWORD_PLACEHOLDER = "new keyword";
/** The default trigger a dropped "/command" stages, before de-duplication. */
export const COMMAND_PLACEHOLDER = "/new-command";
const SECTION_PLACEHOLDER = "New section";
const SUBROUTINE_PLACEHOLDER = "New sub-routine";

/**
 * `base`, or `base 2` / `base 3` … — the first value not already in `taken` (case-insensitive, because
 * two sections differing only in case read as the same heading to a human).
 */
export function nextAvailableName(
  base: string,
  taken: readonly string[],
  join: (base: string, n: number) => string = (b, n) => `${b} ${n}`,
): string {
  const used = new Set(taken.map((value) => value.trim().toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = join(base, n);
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return join(base, Date.now());
}

/** A `set_annotation` id: a whitespace-free slug of the section label, de-duplicated against the ids
 *  already in the graph (the annotation's id BECOMES the projected node id — a collision would fuse
 *  two nodes). */
export function annotationIdFor(label: string, takenIds: readonly string[]): string {
  const slug =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "section";
  return nextAvailableName(slug, takenIds, (base, n) => `${base}-${n}`);
}

/**
 * The section BODY only (heading excluded) — exactly the span `update_section_body`'s `body` param
 * replaces (server: the heading line through the line before the next heading of ANY level). ONE
 * definition, shared by the node detail panel's body editor and the loop-guard component, so the two
 * can never disagree about what "the body" is.
 */
export function sectionBodyText(text: string, node: SkillGraphNode): string {
  const lines = text.split(/\r?\n/);
  const start = Math.max(0, node.anchor.startLine); // 0-based index right AFTER the heading line
  const end = Math.min(lines.length, node.anchor.endLine);
  return lines.slice(start, end).join("\n");
}

/** Append `sentence` to a section body, keeping one blank line of separation and no trailing blank. */
export function appendSentence(body: string, sentence: string): string {
  const trimmed = body.replace(/\s+$/, "");
  return trimmed.length === 0 ? sentence : `${trimmed}\n\n${sentence}`;
}

/** What the caller must supply for a placement decision. Everything is data — no hooks, no fetches. */
export type ComponentPlacementInput = {
  component: SkillComponentId;
  /** The node the component was dropped on / the canvas selection for a keyboard add. */
  targetNodeId: string | null;
  /** The AUTHORITATIVE (saved-version) graph — every op targets an id that exists in it. */
  graph: SkillGraph | null;
  /** The live draft SKILL.md — the source for a section's current body. */
  text: string;
  /** Section titles already in play, INCLUDING ones only staged so far (so two drops don't collide). */
  existingTitles: readonly string[];
  /** `/command` triggers already in play, staged ones included. */
  existingCommands: readonly string[];
  /** Frontmatter keywords already declared on the draft. */
  existingKeywords: readonly string[];
  /** Bodies of sections with a pending `update_section_body`, so an append composes instead of
   *  clobbering (`useEditOps` replaces a same-type op on the same node). */
  pendingBodies?: ReadonlyMap<string, string>;
  /** The picked value for a component that needs one. */
  value?: { kind: "tool"; server: string; tool: string } | { kind: "file"; path: string };
  /** False when there is no Studio draft to stage frontmatter on — the keyword component needs one. */
  canStageSettings: boolean;
};

export type ComponentPlacement =
  | { ok: false; title: string; reason: string }
  | {
      ok: true;
      /** Ops to append to the shared edit buffer, in order. */
      ops: SkillEditOp[];
      /** A frontmatter keyword to stage on the Studio draft (the keyword component only). */
      keyword?: string;
      title: string;
      description: string;
    };

/**
 * Whether this component can attach to that drop target at all — the ONE rule, extracted so a caller
 * can check the target BEFORE opening a value picker (asking "which file?" and only then saying
 * "…actually, drop it on a section" is a worse conversation than refusing up front).
 * `null` ⇒ the target is fine. {@link resolveComponentPlacement} calls exactly this, so the two can
 * never diverge.
 */
export function componentTargetError(
  component: SkillComponentId,
  targetNodeId: string | null,
  graph: SkillGraph,
): { title: string; reason: string } | null {
  const spec = BY_ID.get(component);
  if (!spec || spec.target !== "section-required") return null;
  const target =
    targetNodeId !== null ? (graph.nodes.find((node) => node.id === targetNodeId) ?? null) : null;
  if (target !== null && isSectionNode(target)) return null;
  return {
    title: `Drop “${spec.label}” onto a section`,
    reason:
      target === null
        ? "Drop it on a section node — or select one first, then add it. It needs a saved section; one you have added but not saved yet can’t carry it."
        : `“${target.label}” is a ${target.kind.replace(/_/g, " ")}, and only a section can carry a ${spec.label.toLowerCase()}.`,
  };
}

/**
 * Turn a component + a drop target into staged work. PURE and total: every refusal names what is
 * missing, and no branch throws.
 *
 * The one thing to keep in mind when reading it: `targetNodeId` comes from the canvas, whose nodes
 * are the PREVIEW projection, while every op addresses the AUTHORITATIVE graph. A preview-only node
 * (a section added but not yet saved) therefore resolves to nothing here and is refused with an
 * honest reason rather than composing an op the server would 400 on.
 */
export function resolveComponentPlacement(input: ComponentPlacementInput): ComponentPlacement {
  const spec = BY_ID.get(input.component);
  if (!spec) {
    return { ok: false, title: "Unknown component", reason: "That is not a skill component." };
  }
  const graph = input.graph;
  if (!graph) {
    return {
      ok: false,
      title: "The skill isn’t loaded yet",
      reason: "Wait for the flow to finish loading, then try again.",
    };
  }

  const target =
    input.targetNodeId !== null
      ? (graph.nodes.find((node) => node.id === input.targetNodeId) ?? null)
      : null;
  const section = target !== null && isSectionNode(target) ? target : null;

  const targetError = componentTargetError(spec.id, input.targetNodeId, graph);
  if (targetError) return { ok: false, ...targetError };

  switch (spec.id) {
    case "keyword": {
      if (!input.canStageSettings) {
        return {
          ok: false,
          title: "Keywords are edited in the Studio",
          reason: "Open this skill in the Studio to add a trigger keyword.",
        };
      }
      const keyword = nextAvailableName(KEYWORD_PLACEHOLDER, input.existingKeywords);
      return {
        ok: true,
        ops: [],
        keyword,
        title: "Keyword added",
        description: `“${keyword}” joins the draft’s keywords: — rename it in Settings, then save.`,
      };
    }

    case "command": {
      const command = nextAvailableName(
        COMMAND_PLACEHOLDER,
        input.existingCommands,
        (base, n) => `${base}-${n}`,
      );
      return {
        ok: true,
        ops: [{ op: "add_command", command }],
        title: "Command added",
        description: `“${command}” gets its own flow — rename it in Settings, then save.`,
      };
    }

    case "section":
    case "subroutine": {
      const isSubroutine = spec.id === "subroutine";
      const title = nextAvailableName(
        isSubroutine ? SUBROUTINE_PLACEHOLDER : SECTION_PLACEHOLDER,
        input.existingTitles,
      );
      return {
        ok: true,
        ops: [
          {
            op: "add_subroutine",
            afterNodeId: section?.id ?? null,
            title,
            ...(isSubroutine ? { body: SUBROUTINE_STARTER_BODY } : {}),
          },
        ],
        title: isSubroutine ? "Sub-routine added" : "Section added",
        description: section
          ? `“${title}” goes after “${section.label}” when you save.`
          : `“${title}” goes at the end of the document when you save.`,
      };
    }

    case "gatekeeper": {
      if (!section) return sectionRequired(spec.label);
      return {
        ok: true,
        ops: [
          {
            op: "set_annotation",
            nodeId: section.id,
            kind: "gatekeeper",
            id: annotationIdFor(
              section.label,
              graph.nodes.map((node) => node.id),
            ),
          },
        ],
        title: "Gatekeeper staged",
        description: `“${section.label}” will read as a decision point when you save.`,
      };
    }

    case "validation_gate": {
      if (!section) return sectionRequired(spec.label);
      if (input.value?.kind !== "file") {
        return {
          ok: false,
          title: "Pick the script to gate on",
          reason: "A validation gate runs a script and checks its exit code — choose one first.",
        };
      }
      const path = input.value.path;
      return {
        ok: true,
        ops: [
          { op: "add_asset_ref", nodeId: section.id, path, sentence: validationGateSentence(path) },
          {
            op: "set_annotation",
            nodeId: section.id,
            kind: "gate",
            id: annotationIdFor(
              section.label,
              graph.nodes.map((node) => node.id),
            ),
          },
        ],
        title: "Validation gate staged",
        description: `“${section.label}” will verify \`${path}\` exits 0 when you save.`,
      };
    }

    case "loop_guard": {
      if (!section) return sectionRequired(spec.label);
      const current = input.pendingBodies?.get(section.id) ?? sectionBodyText(input.text, section);
      if (current.includes(LOOP_GUARD_SENTENCE)) {
        return {
          ok: false,
          title: "Already bounded",
          reason: `“${section.label}” already carries a loop guard.`,
        };
      }
      return {
        ok: true,
        ops: [
          {
            op: "update_section_body",
            nodeId: section.id,
            body: appendSentence(current, LOOP_GUARD_SENTENCE),
          },
        ],
        title: "Loop guard staged",
        description: `“${section.label}” is now bounded to 3 attempts — edit the wording in its body before you save.`,
      };
    }

    case "tool_reference": {
      if (!section) return sectionRequired(spec.label);
      if (input.value?.kind !== "tool") {
        return {
          ok: false,
          title: "Pick the tool to reference",
          reason:
            "Choose a bound server’s tool — a reference to a tool no scan knows about is a dangling one.",
        };
      }
      const { server, tool } = input.value;
      return {
        ok: true,
        ops: [{ op: "add_tool_ref", nodeId: section.id, server, tool }],
        title: "Tool reference staged",
        description: `“${tool}” will be referenced from “${section.label}” when you save.`,
      };
    }

    case "asset": {
      if (!section) return sectionRequired(spec.label);
      if (input.value?.kind !== "file") {
        return {
          ok: false,
          title: "Pick the file to reference",
          reason: "Choose a bundled file — a reference that resolves to nothing is dead weight.",
        };
      }
      const path = input.value.path;
      return {
        ok: true,
        ops: [{ op: "add_asset_ref", nodeId: section.id, path }],
        title: "Asset reference staged",
        description: `“${path}” will be referenced from “${section.label}” when you save.`,
      };
    }
  }
}

/** Unreachable in practice (the `section-required` guard above fires first) — but it keeps every
 *  section-bound branch total for the type checker without a non-null assertion. */
function sectionRequired(label: string): ComponentPlacement {
  return {
    ok: false,
    title: `Drop “${label}” onto a section`,
    reason: "Drop it on a section node — or select one first, then add it.",
  };
}
