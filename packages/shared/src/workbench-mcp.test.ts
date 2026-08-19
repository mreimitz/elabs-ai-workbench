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
} from "./workbench-mcp.js";

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
