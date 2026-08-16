import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSkillManifest } from "../src/skills/manifest.js";

const VALID_MD = `---
name: pdf-processing
description: Extract PDF text, fill forms, merge files. Use when handling PDFs.
license: Apache-2.0
compatibility: Requires Python 3.14+ and uv
metadata:
  author: example-org
  version: "1.0"
allowed-tools: Bash(git:*) Read
---

# PDF processing

Body content here.
`;

test("valid frontmatter parses to the SkillManifest shape", () => {
  const { manifest, valid, errors } = parseSkillManifest(VALID_MD);
  assert.equal(valid, true);
  assert.deepEqual(errors, []);
  assert.equal(manifest.name, "pdf-processing");
  assert.equal(
    manifest.description,
    "Extract PDF text, fill forms, merge files. Use when handling PDFs.",
  );
  assert.equal(manifest.license, "Apache-2.0");
  assert.equal(manifest.compatibility, "Requires Python 3.14+ and uv");
  assert.deepEqual(manifest.metadata, { author: "example-org", version: "1.0" });
  assert.equal(manifest.allowedTools, "Bash(git:*) Read");
});

test("exposes the body text (for L2 counting) with frontmatter stripped", () => {
  const { body } = parseSkillManifest(VALID_MD);
  assert.ok(body.startsWith("# PDF processing"));
  assert.ok(!body.includes("name: pdf-processing"));
  assert.ok(body.includes("Body content here."));
});

test("accepts camelCase allowedTools as a tolerance alias", () => {
  const md = `---
name: tool-skill
description: A skill.
allowedTools: Read Write
---
body`;
  const { manifest, valid } = parseSkillManifest(md);
  assert.equal(valid, true);
  assert.equal(manifest.allowedTools, "Read Write");
});

test("no frontmatter yields valid=false without throwing, body preserved", () => {
  const md = "# Just a markdown body\n\nNo frontmatter here.";
  const { manifest, valid, errors, body } = parseSkillManifest(md);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes("Missing YAML frontmatter")));
  assert.ok(errors.some((e) => e.includes("Missing required field: name")));
  assert.ok(errors.some((e) => e.includes("Missing required field: description")));
  assert.equal(manifest.name, "");
  assert.equal(manifest.description, "");
  assert.equal(body, md);
});

test("missing required fields are itemized, valid=false", () => {
  const md = `---
license: MIT
---
body`;
  const { valid, errors } = parseSkillManifest(md);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes("Missing required field: name")));
  assert.ok(errors.some((e) => e.includes("Missing required field: description")));
});

test("missing body (frontmatter only) still parses; body is empty", () => {
  const md = `---
name: metadata-only
description: A degenerate one-file skill with no body.
---`;
  const { manifest, valid, body } = parseSkillManifest(md);
  assert.equal(valid, true);
  assert.equal(manifest.name, "metadata-only");
  assert.equal(body, "");
});

test("reserved words in name fail validation", () => {
  for (const reserved of ["anthropic", "claude"]) {
    const md = `---
name: my-${reserved}-skill
description: A skill.
---
body`;
    const { valid, errors } = parseSkillManifest(md);
    assert.equal(valid, false, `expected ${reserved} to be reserved`);
    assert.ok(errors.some((e) => e.includes(reserved)));
  }
});

test("name pattern violations fail: uppercase, leading/trailing/consecutive hyphen", () => {
  const cases = ["MySkill", "-lead", "trail-", "double--hyphen", "under_score", "spa ce"];
  for (const name of cases) {
    const md = `---
name: ${name}
description: A skill.
---
body`;
    const { valid, errors } = parseSkillManifest(md);
    assert.equal(valid, false, `expected "${name}" to be invalid`);
    assert.ok(
      errors.some((e) => e.includes("lowercase") || e.includes("reserved") || e.includes("XML")),
      `expected a name error for "${name}", got ${JSON.stringify(errors)}`,
    );
  }
});

test("over-length name (>64) fails", () => {
  const longName = "a".repeat(65);
  const md = `---
name: ${longName}
description: A skill.
---
body`;
  const { valid, errors } = parseSkillManifest(md);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes("1–64 characters")));
});

test("over-length description (>1024) fails", () => {
  const longDesc = "x".repeat(1025);
  const md = `---
name: long-desc
description: ${longDesc}
---
body`;
  const { valid, errors } = parseSkillManifest(md);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes("at most 1024")));
});

test("empty description fails as non-empty required", () => {
  const md = `---
name: empty-desc
description: ""
---
body`;
  const { valid, errors } = parseSkillManifest(md);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes("non-empty")));
});

test("XML tags in name or description fail", () => {
  const md = `---
name: xss-name
description: A skill with <script>alert(1)</script> in it.
---
body`;
  const { valid, errors } = parseSkillManifest(md);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes("XML/HTML tags")));
});

test("over-length compatibility (>500) fails", () => {
  const md = `---
name: compat-skill
description: A skill.
compatibility: ${"z".repeat(501)}
---
body`;
  const { valid, errors } = parseSkillManifest(md);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes("at most 500")));
});

test("name != expected dir name is a WARNING, not a failure", () => {
  const md = `---
name: real-name
description: A skill.
---
body`;
  const { valid, errors } = parseSkillManifest(md, { expectedDirName: "different-dir" });
  assert.equal(valid, true, "name/dir mismatch must not fail validity");
  assert.ok(errors.some((e) => e.startsWith("Warning:") && e.includes("different-dir")));
});

test("name == expected dir name produces no warning", () => {
  const md = `---
name: matching-name
description: A skill.
---
body`;
  const { valid, errors } = parseSkillManifest(md, { expectedDirName: "matching-name" });
  assert.equal(valid, true);
  assert.deepEqual(errors, []);
});

test("malformed YAML does not throw; yields valid=false", () => {
  const md = `---
name: broken
description: "unterminated
  : : :
---
body`;
  const result = parseSkillManifest(md);
  assert.equal(result.valid, false);
  assert.ok(result.errors.length > 0);
});

test("CRLF line endings are handled", () => {
  const md = "---\r\nname: crlf-skill\r\ndescription: A skill.\r\n---\r\n\r\n# Body\r\n";
  const { manifest, valid, body } = parseSkillManifest(md);
  assert.equal(valid, true);
  assert.equal(manifest.name, "crlf-skill");
  assert.ok(body.startsWith("# Body"));
});
