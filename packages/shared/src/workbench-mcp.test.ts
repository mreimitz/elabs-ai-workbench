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
  WORKBENCH_MCP_TOOL_NAMES,
  WORKBENCH_MCP_TOOL_SCHEMAS,
  WORKBENCH_MCP_TOOL_SCOPES,
  WORKBENCH_MCP_WRITE_TOOL_NAMES,
} from "./workbench-mcp.js";
import { API_TOKEN_EXECUTE_SCOPES, API_TOKEN_SCOPES } from "./api-tokens.js";

// The families exist so the served usage doc (`GET /api/mcp/llms.txt`) can group the surface without
// a hand-copied second list of tool names. That only holds if they PARTITION the declared tools — a
// new tool with no family would silently vanish from the document an external agent onboards from,
// and a family naming a tool that no longer exists would advertise a call that fails.
describe("workbench MCP tool families", () => {
  it("partitions every declared tool — reads AND writes — exactly once", () => {
    const classified = WORKBENCH_MCP_TOOL_FAMILIES.flatMap((family) => family.tools);
    const duplicates = classified.filter((name, index) => classified.indexOf(name) !== index);
    assert.deepEqual(duplicates, [], "a tool may appear in exactly one family");

    assert.deepEqual(
      [...classified].sort(),
      [...WORKBENCH_MCP_TOOL_NAMES].sort(),
      "every tool needs a family (and no family may name a tool that is not registered)",
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
  it("declares a scope for every tool, and no scope for a tool that does not exist", () => {
    assert.deepEqual(
      Object.keys(WORKBENCH_MCP_TOOL_SCOPES).sort(),
      [...WORKBENCH_MCP_TOOL_NAMES].sort(),
    );
  });

  it("maps every WP M.1 read tool to `read` — reading costs no more than admission (D-MCP8)", () => {
    for (const tool of WORKBENCH_MCP_READ_TOOL_NAMES) {
      assert.equal(
        WORKBENCH_MCP_TOOL_SCOPES[tool],
        "read",
        `${tool} is a read tool and must need only \`read\``,
      );
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

// WP M.3 (A8) — D-MCP3 made MECHANICAL. "Deletes are excluded entirely, at every phase" is a promise
// nobody re-reads once it is prose, so it is a test: no registered tool may be NAMED like a
// destructive operation, and the write set is pinned at exactly three tools mapping to three distinct
// execute scopes. The name check is deliberately crude — it cannot prove a handler does not delete
// (only review can), but it makes the FIRST step of adding one — naming it — fail the gate, and it
// documents the intent at the exact place a future author would break it.
describe("workbench MCP write surface (WP M.3)", () => {
  const DESTRUCTIVE = /delete|remove|revoke|prune|drop/i;

  it("registers no tool whose name reads as destructive (D-MCP3)", () => {
    for (const name of WORKBENCH_MCP_TOOL_NAMES) {
      assert.ok(
        !DESTRUCTIVE.test(name),
        `${name} names a destructive operation; deletes are excluded at every phase (D-MCP3)`,
      );
    }
  });

  it("is exactly three write tools, one per execute scope, all distinct (D-MCP10)", () => {
    assert.equal(WORKBENCH_MCP_WRITE_TOOL_NAMES.length, 3);

    const scopes = WORKBENCH_MCP_WRITE_TOOL_NAMES.map((name) => WORKBENCH_MCP_TOOL_SCOPES[name]);
    assert.equal(new Set(scopes).size, 3, "two write tools sharing a scope makes one of them free");
    for (const [index, scope] of scopes.entries()) {
      assert.ok(
        scope !== undefined && (API_TOKEN_EXECUTE_SCOPES as readonly string[]).includes(scope),
        `${WORKBENCH_MCP_WRITE_TOOL_NAMES[index]} must need an EXECUTE scope, not ${scope}`,
      );
    }
    // …and the mapping itself, spelled out, so a silent re-pointing is a diff a reviewer sees.
    assert.deepEqual(
      Object.fromEntries(
        WORKBENCH_MCP_WRITE_TOOL_NAMES.map((name) => [name, WORKBENCH_MCP_TOOL_SCOPES[name]]),
      ),
      { scan_run: "scan:run", suite_run_start: "suites:run", run_plan_start: "runs:launch" },
    );
  });

  it("covers every execute scope the frozen D-C4 vocabulary has, so none is decorative", () => {
    const used = new Set(WORKBENCH_MCP_WRITE_TOOL_NAMES.map((n) => WORKBENCH_MCP_TOOL_SCOPES[n]));
    for (const scope of API_TOKEN_EXECUTE_SCOPES) {
      assert.ok(used.has(scope), `no tool needs \`${scope}\`, so the scope grants nothing`);
    }
  });

  it("never offers `suite` as a run_plan_start source — that is suite_run_start's job (D-MCP10)", () => {
    const source = WORKBENCH_MCP_TOOL_SCHEMAS.run_plan_start.source;
    const values = (source as unknown as { options: readonly string[] }).options;
    assert.deepEqual([...values].sort(), ["adhoc", "collection"]);
  });

  it("declares an argument shape for every tool, reads and writes alike", () => {
    assert.deepEqual(
      Object.keys(WORKBENCH_MCP_TOOL_SCHEMAS).sort(),
      [...WORKBENCH_MCP_TOOL_NAMES].sort(),
    );
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
