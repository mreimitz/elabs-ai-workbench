import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  WORKBENCH_MCP_DEFAULT_LIST_LIMIT,
  WORKBENCH_MCP_LLMS_TXT_PATH,
  WORKBENCH_MCP_MAX_LIST_LIMIT,
  WORKBENCH_MCP_MOUNT_PATH,
  WORKBENCH_MCP_READ_TOOL_NAMES,
  WORKBENCH_MCP_RESOURCE_TEMPLATES,
  WORKBENCH_MCP_TOOL_FAMILIES,
  WORKBENCH_MCP_TOOL_SCOPES,
} from "./workbench-mcp.js";
import { API_TOKEN_SCOPES } from "./api-tokens.js";

// The families exist so the served usage doc (`GET /api/mcp/llms.txt`) can group the surface without
// a hand-copied second list of tool names. That only holds if they PARTITION the declared tools — a
// new tool with no family would silently vanish from the document an external agent onboards from,
// and a family naming a tool that no longer exists would advertise a call that fails.
describe("workbench MCP tool families", () => {
  it("partitions every declared read tool exactly once", () => {
    const classified = WORKBENCH_MCP_TOOL_FAMILIES.flatMap((family) => family.tools);
    const duplicates = classified.filter((name, index) => classified.indexOf(name) !== index);
    assert.deepEqual(duplicates, [], "a tool may appear in exactly one family");

    assert.deepEqual(
      [...classified].sort(),
      [...WORKBENCH_MCP_READ_TOOL_NAMES].sort(),
      "every read tool needs a family (and no family may name a tool that is not registered)",
    );
  });

  it("gives every family a label and a when-to-reach-for-it sentence", () => {
    for (const family of WORKBENCH_MCP_TOOL_FAMILIES) {
      assert.ok(family.label.length > 0, "a family needs a heading");
      assert.ok(
        family.when.length > 20,
        `${family.label} needs a real "reach for these when" line`,
      );
      assert.ok(family.tools.length > 0, `${family.label} must carry at least one tool`);
    }
  });
});

// WP M.2 (A7) — the per-tool scope map is a GATE, not documentation. Its key set must equal the
// registered tool names exactly: a tool with no scope would be refused at dispatch (fail closed, but
// silently broken rather than loudly), and a scope for a tool that does not exist is a stale grant
// nobody will notice. The api-side twin of this test asserts the same equality against what
// `tools/list` ACTUALLY returns, so declaration and registration are both pinned.
describe("workbench MCP per-tool scopes", () => {
  it("declares a scope for every read tool, and no scope for a tool that does not exist", () => {
    assert.deepEqual(
      Object.keys(WORKBENCH_MCP_TOOL_SCOPES).sort(),
      [...WORKBENCH_MCP_READ_TOOL_NAMES].sort(),
    );
  });

  it("maps every WP M.1 tool to `read` — the whole surface is a read (D-MCP3)", () => {
    for (const [tool, scope] of Object.entries(WORKBENCH_MCP_TOOL_SCOPES)) {
      assert.equal(scope, "read", `${tool} is a read tool and must need only \`read\``);
    }
  });

  it("only ever names a scope from the frozen D-C4 vocabulary", () => {
    for (const [tool, scope] of Object.entries(WORKBENCH_MCP_TOOL_SCOPES)) {
      assert.ok(
        (API_TOKEN_SCOPES as readonly string[]).includes(scope),
        `${tool} names ${scope}, which is not a real scope`,
      );
    }
  });
});

describe("workbench MCP onboarding constants", () => {
  it("serves the usage doc under the mount, so the feature guard's prefix covers it", () => {
    assert.equal(WORKBENCH_MCP_LLMS_TXT_PATH, `${WORKBENCH_MCP_MOUNT_PATH}/llms.txt`);
  });

  it("keeps the default list limit inside the hard ceiling", () => {
    assert.ok(WORKBENCH_MCP_DEFAULT_LIST_LIMIT <= WORKBENCH_MCP_MAX_LIST_LIMIT);
  });

  it("declares four report resource templates, all under the workbench scheme", () => {
    const templates = Object.values(WORKBENCH_MCP_RESOURCE_TEMPLATES);
    assert.equal(templates.length, 4);
    for (const template of templates) {
      assert.match(template, /^workbench:\/\/reports\/(run|scan)\/\{(runId|scanId)\}\.(md|json)$/);
    }
  });
});
