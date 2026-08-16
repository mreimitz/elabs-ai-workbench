// Skill IDE WP 9.3 (I10.5) — the authoring-snippet catalog: the code-mode equivalent of the flow
// canvas's create dialogs (the parity matrix's "Code idiom (+ assist)" column). PURE DATA + one pure
// helper, with ZERO runtime imports (only `import type`, erased), so the API acceptance test can import
// this exact module and prove — via `project-preview` — that each snippet's inserted text projects to
// the intended node kind. The completion provider (`snippets.ts`) is the browser consumer of the same
// specs, so the text a snippet inserts and the text the test asserts on can never drift.

import type { SkillGraphNodeKind } from "@mcp-token-footprint/shared";

/** Where a snippet is offered — inside the YAML frontmatter block, or in the markdown body. */
export type SnippetContext = "frontmatter" | "body";

/** One authoring snippet: the completion label/trigger + its Monaco snippet-syntax insert text. */
export type SnippetSpec = {
  /** Stable id (used by the test map + the completion item key). */
  id: string;
  /** The word the author types to summon it (the completion `label` + filter text), e.g. `section`. */
  keyword: string;
  /** Completion `detail` — a one-line "what this inserts". */
  detail: string;
  /** The explainer id (in `explainers.ts`) this snippet teaches — surfaced as completion documentation. */
  explainerId: string;
  /** Monaco snippet insert text (`${n:default}` tabstops). Resolved by {@link resolveSnippetText}. */
  insertText: string;
  /** Frontmatter-only vs body-only offering (context-gated so a frontmatter block isn't offered code). */
  context: SnippetContext;
  /**
   * The projector node kind this snippet is DESIGNED to produce once inserted (the tested contract).
   * `null` for metadata-only snippets (`skillflow:servers`, frontmatter `servers:`) that add no node —
   * the test asserts those are tolerated (no new node, no warning) instead of a kind.
   */
  projectsTo: SkillGraphNodeKind | null;
};

export const SNIPPET_SPECS: SnippetSpec[] = [
  {
    id: "section",
    keyword: "section",
    detail: "A new section (one step of the flow)",
    explainerId: "subroutine",
    context: "body",
    projectsTo: "subroutine",
    insertText: [
      "## ${1:Section title}",
      "",
      "${2:What the agent should do in this step.}",
      "$0",
    ].join("\n"),
  },
  {
    id: "command",
    keyword: "cmd",
    detail: "A /command entry point + its flow",
    explainerId: "trigger:command",
    context: "body",
    projectsTo: "entry_point",
    insertText: [
      "## /${1:command}",
      "",
      "${2:What this command does and when to run it.}",
      "$0",
    ].join("\n"),
  },
  {
    id: "gatekeeper",
    keyword: "gate",
    detail: "A decision point with branches + a breadcrumb marker",
    explainerId: "gatekeeper",
    context: "body",
    projectsTo: "gatekeeper",
    insertText: [
      "## ${1:Decide the route}",
      "",
      "If ${2:the input is CSV}, ${3:parse it with the header convention}. Otherwise, ${4:parse it as JSON}.",
      "",
      "Emit `[skillflow:gate=${5:route-input} route=${6:r-csv}]` naming the branch you took.",
      "$0",
    ].join("\n"),
  },
  {
    id: "annotation-gatekeeper",
    keyword: "skillflow-gatekeeper",
    detail: "Annotation: force the next heading to a gatekeeper",
    explainerId: "annotation:gatekeeper",
    context: "body",
    projectsTo: "gatekeeper",
    insertText: "<!-- skillflow:gatekeeper id=${1:route-input} -->\n$0",
  },
  {
    id: "annotation-gate",
    keyword: "skillflow-gate",
    detail: "Annotation: force the next heading to a validation gate",
    explainerId: "annotation:gate",
    context: "body",
    projectsTo: "validation_gate",
    insertText: "<!-- skillflow:gate id=${1:check-output} -->\n$0",
  },
  {
    id: "annotation-command",
    keyword: "skillflow-command",
    detail: "Annotation: pin the next /command heading's entry id",
    explainerId: "annotation:command",
    context: "body",
    projectsTo: "entry_point",
    insertText: "<!-- skillflow:command id=${1:command-id} -->\n$0",
  },
  {
    id: "annotation-servers",
    keyword: "skillflow-servers",
    detail: "Annotation: scope tool validation to named servers",
    explainerId: "annotation:servers",
    context: "body",
    projectsTo: null,
    insertText: "<!-- skillflow:servers ${1:server-a, server-b} -->\n$0",
  },
  {
    id: "frontmatter-keywords",
    keyword: "keywords",
    detail: "Frontmatter: trigger keywords (→ keyword entry points)",
    explainerId: "frontmatter:keywords",
    context: "frontmatter",
    projectsTo: "entry_point",
    insertText: [
      "keywords:",
      "  - ${1:phrase users type}",
      "  - ${2:another trigger phrase}",
      "$0",
    ].join("\n"),
  },
  {
    id: "frontmatter-servers",
    keyword: "servers",
    detail: "Frontmatter: MCP servers this skill is authored for",
    explainerId: "frontmatter:servers",
    context: "frontmatter",
    projectsTo: null,
    insertText: ["servers:", "  - ${1:server-name}", "$0"].join("\n"),
  },
];

/**
 * Resolve a Monaco snippet template to the plain text a user gets by accepting every default: turn
 * `${n:default}` into `default`, and drop bare tabstops (`${n}`, `$n`, `$0`). The snippet defaults here
 * contain no nested placeholders or `$`/`}` literals, so a two-pass regex is exact. This is what the
 * acceptance test feeds to `project-preview` — the honest "insert it and take the defaults" text.
 */
export function resolveSnippetText(insertText: string): string {
  return insertText
    .replace(/\$\{\d+:([^}]*)\}/g, "$1") // ${1:default} → default
    .replace(/\$\{\d+\}/g, "") // ${1} → (empty)
    .replace(/\$\d+/g, ""); // $1 / $0 → (empty)
}
