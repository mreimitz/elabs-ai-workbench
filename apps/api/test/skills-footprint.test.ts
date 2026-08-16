import assert from "node:assert/strict";
import { test } from "node:test";
import type { SkillManifest } from "@mcp-token-footprint/shared";
import { classifyFile, countLevels, type SkillFootprintFile } from "../src/skills/footprint.js";
import { getTokenCounter } from "../src/token-counting/profiles.js";

test("classifyFile: root SKILL.md → skill_md (case-insensitive)", () => {
  assert.equal(classifyFile("SKILL.md"), "skill_md");
  assert.equal(classifyFile("skill.md"), "skill_md");
  assert.equal(classifyFile("./SKILL.md"), "skill_md");
});

test("classifyFile: references/ → reference, scripts/ → script, assets/ → asset", () => {
  assert.equal(classifyFile("references/API.md"), "reference");
  assert.equal(classifyFile("references/nested/DEEP.md"), "reference");
  assert.equal(classifyFile("scripts/run.py"), "script");
  assert.equal(classifyFile("assets/logo.png"), "asset");
});

test("classifyFile: anything else → other", () => {
  assert.equal(classifyFile("README.md"), "other");
  assert.equal(classifyFile("docs/GUIDE.md"), "other");
  assert.equal(classifyFile("LICENSE"), "other");
});

test("classifyFile: a non-root SKILL.md is NOT skill_md", () => {
  assert.equal(classifyFile("references/SKILL.md"), "reference");
  assert.equal(classifyFile("nested/SKILL.md"), "other");
});

const MANIFEST: SkillManifest = {
  name: "pdf-processing",
  description: "Extract PDF text, fill forms, merge files. Use when handling PDFs.",
};

const BODY = "# PDF processing\n\nDetailed instructions for the SKILL.md body.\n";

test("L1 = name + description tokens", async () => {
  const counter = getTokenCounter("generic_o200k");
  const expectedL1 =
    (await counter.countText(MANIFEST.name)) + (await counter.countText(MANIFEST.description));
  const result = await countLevels([], MANIFEST, BODY);
  assert.equal(result.l1, expectedL1);
});

test("L2 = SKILL.md body tokens", async () => {
  const counter = getTokenCounter("generic_o200k");
  const expectedL2 = await counter.countText(BODY);
  const result = await countLevels([], MANIFEST, BODY);
  assert.equal(result.l2, expectedL2);
});

test("L3 = sum of other text files; SKILL.md file gets L2; binary contributes 0", async () => {
  const counter = getTokenCounter("generic_o200k");
  const refText = "Reference doc contents.";
  const scriptText = "print('hello')";

  const files: SkillFootprintFile[] = [
    { path: "SKILL.md", text: BODY, isBinary: false },
    { path: "references/API.md", text: refText, isBinary: false },
    { path: "scripts/run.py", text: scriptText, isBinary: false },
    { path: "assets/logo.png", isBinary: true },
  ];

  const result = await countLevels(files, MANIFEST, BODY);

  const refTokens = await counter.countText(refText);
  const scriptTokens = await counter.countText(scriptText);
  assert.equal(result.l3, refTokens + scriptTokens);

  // Per-file totals.
  const byPath = new Map(result.files.map((f) => [f.path, f]));
  assert.equal(byPath.get("SKILL.md")?.tokenTotal, result.l2);
  assert.equal(byPath.get("references/API.md")?.tokenTotal, refTokens);
  assert.equal(byPath.get("scripts/run.py")?.tokenTotal, scriptTokens);
  assert.equal(byPath.get("assets/logo.png")?.tokenTotal, 0);
  assert.equal(byPath.get("assets/logo.png")?.isBinary, true);
});

test("total = L1 + L2 + L3, and equals L1 + sum of per-file totals", async () => {
  const files: SkillFootprintFile[] = [
    { path: "SKILL.md", text: BODY, isBinary: false },
    { path: "references/API.md", text: "Reference doc contents.", isBinary: false },
    { path: "assets/logo.png", isBinary: true },
  ];
  const result = await countLevels(files, MANIFEST, BODY);

  assert.equal(result.total, result.l1 + result.l2 + result.l3);

  const perFileSum = result.files.reduce((sum, f) => sum + f.tokenTotal, 0);
  // per-file sum covers L2 (the SKILL.md file) + L3 (other text files); add L1 for the total.
  assert.equal(result.total, result.l1 + perFileSum);
});

test("binary text files contribute 0 even if text is present", async () => {
  const files: SkillFootprintFile[] = [
    { path: "assets/data.bin", text: "should be ignored", isBinary: true },
  ];
  const result = await countLevels(files, MANIFEST, BODY);
  assert.equal(result.l3, 0);
  assert.equal(result.files[0]?.tokenTotal, 0);
});

test("empty manifest fields and empty body yield zero subtotals", async () => {
  const result = await countLevels([], { name: "", description: "" }, "");
  assert.equal(result.l1, 0);
  assert.equal(result.l2, 0);
  assert.equal(result.l3, 0);
  assert.equal(result.total, 0);
});

test("respects a non-default token profile", async () => {
  const result = await countLevels([], MANIFEST, BODY, "raw_json_rough");
  assert.equal(result.tokenProfile, "raw_json_rough");
  const counter = getTokenCounter("raw_json_rough");
  const expectedL1 =
    (await counter.countText(MANIFEST.name)) + (await counter.countText(MANIFEST.description));
  assert.equal(result.l1, expectedL1);
});

test("file kinds are reported per file", async () => {
  const files: SkillFootprintFile[] = [
    { path: "SKILL.md", text: BODY, isBinary: false },
    { path: "references/API.md", text: "x", isBinary: false },
    { path: "scripts/run.sh", text: "y", isBinary: false },
    { path: "assets/logo.png", isBinary: true },
    { path: "README.md", text: "z", isBinary: false },
  ];
  const result = await countLevels(files, MANIFEST, BODY);
  const kinds = Object.fromEntries(result.files.map((f) => [f.path, f.kind]));
  assert.deepEqual(kinds, {
    "SKILL.md": "skill_md",
    "references/API.md": "reference",
    "scripts/run.sh": "script",
    "assets/logo.png": "asset",
    "README.md": "other",
  });
});
