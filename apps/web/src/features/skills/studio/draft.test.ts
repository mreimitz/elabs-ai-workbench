import { describe, expect, test } from "vitest";
import {
  applySettingsEdit,
  applySettingsEdits,
  collapseSettingsEdits,
  commandEntries,
  describeSettingsEdit,
  readSkillSettings,
  type SkillSettingsEdit,
} from "./draft";
import type { SkillGraph } from "@mcp-token-footprint/shared";

// ── RM-30 WP 7.3 — the draft store's pure half ────────────────────────────────────────────────────
// The settings panel writes YAML on the author's behalf, so the two properties that matter are
// (a) every untouched byte survives, and (b) an edit that ends up changing nothing IS nothing — it
// must not leave the draft reading as dirty, or the author is asked to save a no-op version.

const DOC = [
  "---",
  "name: demo",
  "description: A demo skill.",
  "servers:",
  "  - files",
  "keywords:",
  "  - read a file",
  "license: MIT # trailing comment on an untouched key",
  "---",
  "",
  "# Demo",
  "",
  "Body line.",
  "",
].join("\n");

describe("readSkillSettings", () => {
  test("reads every field the panel edits", () => {
    expect(readSkillSettings(DOC)).toEqual({
      name: "demo",
      description: "A demo skill.",
      servers: ["files"],
      keywords: ["read a file"],
      nameEditable: true,
      descriptionEditable: true,
    });
  });

  test("a document with no frontmatter reads as empty but still editable", () => {
    const settings = readSkillSettings("# Just a body\n");
    expect(settings).toMatchObject({
      name: null,
      description: null,
      servers: [],
      keywords: [],
      nameEditable: true,
      descriptionEditable: true,
    });
  });

  test("a block-scalar description is reported NOT editable rather than silently rewritten", () => {
    const doc = ["---", "name: demo", "description: >", "  folded", "  text", "---", ""].join("\n");
    const settings = readSkillSettings(doc);
    expect(settings.descriptionEditable).toBe(false);
    expect(settings.nameEditable).toBe(true);
  });
});

describe("applySettingsEdit — every untouched byte survives", () => {
  test("setting the description rewrites ONLY its line", () => {
    const next = applySettingsEdit(DOC, { field: "description", value: "Now with commas, and: colons." });
    expect(next).toContain('description: "Now with commas, and: colons."');
    expect(next).toContain("license: MIT # trailing comment on an untouched key");
    expect(next).toContain("  - read a file");
    expect(next).toContain("Body line.");
    expect(readSkillSettings(next).description).toBe("Now with commas, and: colons.");
  });

  test("a keyword is added to the keywords list, not the servers list", () => {
    const next = applySettingsEdit(DOC, { field: "keywords", action: "add", value: "open a doc" });
    expect(readSkillSettings(next).keywords).toEqual(["read a file", "open a doc"]);
    expect(readSkillSettings(next).servers).toEqual(["files"]);
  });

  test("binding a server appends to servers: and leaves keywords: alone", () => {
    const next = applySettingsEdit(DOC, { field: "servers", action: "bind", name: "acme" });
    expect(readSkillSettings(next).servers).toEqual(["files", "acme"]);
    expect(readSkillSettings(next).keywords).toEqual(["read a file"]);
  });

  test("a no-op edit returns the input IDENTICALLY (so the draft can tell)", () => {
    expect(applySettingsEdit(DOC, { field: "servers", action: "bind", name: "files" })).toBe(DOC);
    expect(applySettingsEdit(DOC, { field: "servers", action: "unbind", name: "nope" })).toBe(DOC);
    expect(applySettingsEdit(DOC, { field: "name", value: "demo" })).toBe(DOC);
  });

  test("a refused shape is returned unchanged rather than corrupted", () => {
    const doc = ["---", "description: >", "  folded", "---", ""].join("\n");
    expect(applySettingsEdit(doc, { field: "description", value: "flat" })).toBe(doc);
  });
});

describe("collapseSettingsEdits", () => {
  test("the LAST write to a field wins", () => {
    const collapsed = collapseSettingsEdits([
      { field: "name", value: "one" },
      { field: "name", value: "two" },
    ]);
    expect(collapsed).toEqual([{ field: "name", value: "two" }]);
  });

  test("bind then unbind of the SAME server collapses to the unbind", () => {
    const edits: SkillSettingsEdit[] = [
      { field: "servers", action: "bind", name: "acme" },
      { field: "servers", action: "unbind", name: "acme" },
    ];
    expect(collapseSettingsEdits(edits)).toEqual([
      { field: "servers", action: "unbind", name: "acme" },
    ]);
  });

  test("different servers are independent", () => {
    const edits: SkillSettingsEdit[] = [
      { field: "servers", action: "bind", name: "a" },
      { field: "servers", action: "bind", name: "b" },
    ];
    expect(collapseSettingsEdits(edits)).toHaveLength(2);
  });

  test("a keyword and a server of the same NAME do not collide", () => {
    const edits: SkillSettingsEdit[] = [
      { field: "servers", action: "bind", name: "files" },
      { field: "keywords", action: "add", value: "files" },
    ];
    expect(collapseSettingsEdits(edits)).toHaveLength(2);
  });
});

describe("applySettingsEdits — the whole staged batch", () => {
  test("changing my mind leaves the document BYTE-IDENTICAL", () => {
    const staged: SkillSettingsEdit[] = [
      { field: "servers", action: "bind", name: "acme" },
      { field: "servers", action: "unbind", name: "acme" },
    ];
    expect(applySettingsEdits(DOC, staged)).toBe(DOC);
  });

  test("edits to different keys compose", () => {
    const next = applySettingsEdits(DOC, [
      { field: "name", value: "renamed" },
      { field: "servers", action: "bind", name: "acme" },
      { field: "keywords", action: "add", value: "do the thing" },
    ]);
    const settings = readSkillSettings(next);
    expect(settings.name).toBe("renamed");
    expect(settings.servers).toEqual(["files", "acme"]);
    expect(settings.keywords).toEqual(["read a file", "do the thing"]);
    // The body and the untouched frontmatter key are still exactly there.
    expect(next).toContain("license: MIT # trailing comment on an untouched key");
    expect(next).toContain("Body line.");
  });

  test("the author never types YAML: a value needing quotes is serialized and read back", () => {
    const tricky = 'A "quoted" phrase: with punctuation, and a # hash.';
    const next = applySettingsEdits(DOC, [{ field: "description", value: tricky }]);
    expect(readSkillSettings(next).description).toBe(tricky);
  });
});

describe("describeSettingsEdit", () => {
  test("each edit gets one readable line for the save dialog", () => {
    expect(describeSettingsEdit({ field: "name", value: "demo" })).toContain("demo");
    expect(describeSettingsEdit({ field: "servers", action: "bind", name: "acme" })).toContain(
      "Bind",
    );
    expect(describeSettingsEdit({ field: "servers", action: "unbind", name: "acme" })).toContain(
      "Unbind",
    );
    expect(describeSettingsEdit({ field: "keywords", action: "remove", value: "k" })).toContain(
      "Remove",
    );
  });
});

describe("commandEntries", () => {
  const graph: SkillGraph = {
    nodes: [
      {
        id: "entry-1",
        kind: "entry_point",
        label: "Report",
        trigger: { type: "command", value: "/report" },
        source: "annotated",
        anchor: { headingPath: ["/report"], startLine: 3, endLine: 6 },
      },
      {
        id: "kw-1",
        kind: "entry_point",
        label: "read a file",
        trigger: { type: "keyword", value: "read a file" },
        source: "annotated",
        anchor: { headingPath: [], startLine: 1, endLine: 1 },
      },
      {
        id: "preview:new:cmd:0",
        kind: "entry_point",
        label: "/staged",
        trigger: { type: "command", value: "/staged" },
        source: "inferred",
        anchor: { headingPath: ["/staged"], startLine: 99, endLine: 99 },
      },
    ],
    edges: [],
    warnings: [],
  };

  test("lists /command entry points and ignores keyword ones", () => {
    expect(commandEntries(graph).map((entry) => entry.command)).toEqual(["/report", "/staged"]);
  });

  test("a preview-only command carries NO node id, so it can't be renamed or deleted by id", () => {
    const entries = commandEntries(graph);
    expect(entries[0]?.nodeId).toBe("entry-1");
    expect(entries[1]?.nodeId).toBeNull();
  });

  test("no graph yet is an empty list, never a throw", () => {
    expect(commandEntries(null)).toEqual([]);
  });
});
