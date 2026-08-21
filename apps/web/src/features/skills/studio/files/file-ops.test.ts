import { describe, expect, test } from "vitest";
import type { SkillEditOp, SkillFileNode } from "@mcp-token-footprint/shared";
import type { WorkEntry } from "../../workspace/workspace-model";
import { buildWorkingTree } from "../../workspace/workspace-model";
import { describeStudioFileOps, isTabbableFile, opTargetsSkillMd, studioFileOps } from "./file-ops";

// ── RM-30 WP 7.4 — the one invariant the files layer must never break ─────────────────────────────
// `POST /api/skills/:id/save-draft` builds the new tree as "the base tree with SKILL.md ← content"
// and THEN applies `treeOps`. So a file op naming SKILL.md in the same request silently wins over
// the draft text the author just typed — a lost update that looks exactly like "the editor didn't
// save my changes". `studioFileOps` is the single place that can happen, so it is the single place
// this is asserted.

const file = (path: string, over: Partial<SkillFileNode> = {}): SkillFileNode => ({
  path,
  isSkillMd: path === "SKILL.md",
  isBinary: false,
  size: 10,
  kind: path === "SKILL.md" ? "skill_md" : "reference",
  tokenTotal: 4,
  ...over,
});

const BASE: SkillFileNode[] = [file("SKILL.md"), file("references/api.md")];

/** The working tree as it stands after `hydrate` + `setText` on one entry. */
function edited(path: string, text: string, base = BASE): WorkEntry[] {
  return buildWorkingTree(base).map((entry) =>
    entry.path === path ? { ...entry, baseText: "old", text } : entry,
  );
}

describe("studioFileOps — SKILL.md is written by `content`, and by nothing else", () => {
  test("an unedited tree yields no ops at all", () => {
    expect(studioFileOps(BASE, buildWorkingTree(BASE))).toEqual([]);
  });

  test("editing a resource file yields exactly its update_file", () => {
    expect(studioFileOps(BASE, edited("references/api.md", "new"))).toEqual([
      { op: "update_file", path: "references/api.md", content: "new" },
    ]);
  });

  test("an update_file for SKILL.md is DROPPED — the draft text is the manifest's only writer", () => {
    const entries = edited("SKILL.md", "# hand-edited through the wrong door");
    // The raw derivation would emit it…
    expect(
      entries.some((entry) => entry.path === "SKILL.md" && entry.text !== entry.baseText),
    ).toBe(true);
    // …and the Studio's batch does not.
    expect(studioFileOps(BASE, entries)).toEqual([]);
  });

  test("a rename INTO SKILL.md is dropped too (it would clobber the manifest from the side)", () => {
    const entries = buildWorkingTree(BASE).map((entry) =>
      entry.path === "references/api.md" ? { ...entry, path: "SKILL.md" } : entry,
    );
    expect(studioFileOps(BASE, entries)).toEqual([]);
  });

  test("a delete of SKILL.md is dropped", () => {
    const entries = buildWorkingTree(BASE).filter((entry) => entry.path !== "SKILL.md");
    expect(studioFileOps(BASE, entries)).toEqual([]);
  });

  test("a new file becomes an add_file with its typed content", () => {
    const entries: WorkEntry[] = [
      ...buildWorkingTree(BASE),
      { id: "w1", path: "references/limits.md", originalPath: null, isBinary: false, text: "L3" },
    ];
    expect(studioFileOps(BASE, entries)).toEqual([
      { op: "add_file", path: "references/limits.md", content: "L3" },
    ]);
  });
});

describe("opTargetsSkillMd", () => {
  const cases: [SkillEditOp, boolean][] = [
    [{ op: "update_file", path: "SKILL.md", content: "x" }, true],
    [{ op: "update_file", path: "references/api.md", content: "x" }, false],
    [{ op: "delete_file", path: "SKILL.md" }, true],
    [{ op: "add_file", path: "SKILL.md", content: "x" }, true],
    [{ op: "rename_file", from: "SKILL.md", to: "OTHER.md" }, true],
    [{ op: "rename_file", from: "a.md", to: "SKILL.md" }, true],
    [{ op: "rename_file", from: "a.md", to: "b.md" }, false],
    [{ op: "remove_node", nodeId: "sec-1" }, false],
  ];
  for (const [op, expected] of cases) {
    test(`${JSON.stringify(op)} → ${expected}`, () => {
      expect(opTargetsSkillMd(op)).toBe(expected);
    });
  }
});

describe("describeStudioFileOps", () => {
  test("gives one reviewable line per staged change", () => {
    expect(
      describeStudioFileOps([
        { op: "add_file", path: "references/limits.md", content: "" },
        { op: "rename_file", from: "a.md", to: "b.md" },
      ]),
    ).toEqual(["Add references/limits.md", "Rename a.md → b.md"]);
  });
});

describe("isTabbableFile", () => {
  test("the manifest is not a file tab — it IS the Studio's own surface", () => {
    expect(isTabbableFile({ path: "SKILL.md", originalPath: "SKILL.md" })).toBe(false);
    expect(isTabbableFile({ path: "references/api.md", originalPath: "references/api.md" })).toBe(
      true,
    );
  });
});
