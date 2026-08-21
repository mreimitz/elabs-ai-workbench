import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { attributeValues } from "../test-support.js";
import {
  MCP_SERVER_VARIANTS,
  McpServer,
  mcpServerHeightUnits,
  mcpServerMeta,
} from "./McpServer.js";
import { describeEntityContract, renderEntity } from "./contract-support.js";
import { footprintUnits } from "../iso-math.js";

// The shared checklist (D-IL12) — a11y text, ports, five states, three sizes, tokens only, no
// hand-drawn `<path>`, determinism, layer order — all asserted against the registry entry.
describeEntityContract(McpServer, mcpServerMeta);

// …and what is true of THIS drawing and no other.

describe("mcp-server — the variant list and the drawing are one declaration", () => {
  it("draws exactly the variants the registry entry publishes", () => {
    assert.deepEqual([...MCP_SERVER_VARIANTS], [...mcpServerMeta.variants]);
  });

  it("puts an antenna on the streamable-HTTP variant and a local-process block on stdio", () => {
    const http = renderEntity(McpServer, { variant: "streamable-http" });
    const stdio = renderEntity(McpServer, { variant: "stdio" });
    assert.ok(http.includes('data-illus-mark="antenna"'));
    assert.ok(!stdio.includes('data-illus-mark="antenna"'));
    // The stdio block is an extra housing; the HTTP variant has one fewer solid.
    const solids = (markup: string) =>
      attributeValues(markup, "data-illus-primitive").filter((name) => name === "iso-housing")
        .length;
    assert.equal(solids(stdio), solids(http) + 1);
  });
});

describe("mcp-server — one accent moment, and it follows the variant (D-IL6)", () => {
  /** How many marks are painted in the hero accent, at a given variant/state. */
  const accents = (variant: string, state?: "error") =>
    (
      renderEntity(McpServer, { variant, ...(state ? { state } : {}) }).match(
        /var\(--illus-accent\)/g,
      ) ?? []
    ).length;

  it("lights exactly one mark per variant", () => {
    assert.equal(accents("stdio"), 1, "stdio should light only the status lamp");
    assert.equal(accents("streamable-http"), 1, "http should light only the antenna tip");
  });

  it("recolours that one mark on error rather than adding a second", () => {
    for (const variant of MCP_SERVER_VARIANTS) {
      assert.equal(
        accents(variant, "error"),
        0,
        `${variant} kept an accent mark lit while erroring`,
      );
      const markup = renderEntity(McpServer, { variant, state: "error" });
      assert.ok(markup.includes("var(--illus-error)"));
    }
  });
});

describe("mcp-server — a rack has no gaze, so it ignores `facing` (D-IL17)", () => {
  it("mounts its front panel on the same face whichever way the flow runs", () => {
    const upstream = renderEntity(McpServer, { facing: "upstream" });
    const downstream = renderEntity(McpServer, { facing: "downstream" });
    const faces = (markup: string) => attributeValues(markup, "data-illus-glyph-face");
    assert.deepEqual(faces(upstream), ["left"]);
    assert.deepEqual(faces(downstream), ["left"], "the rack front moved with `facing`");
  });
});

describe("mcp-server — the drawn height is what the ports are measured against", () => {
  it("is the plinth plus the rack, and it scales with the footprint", () => {
    for (const size of mcpServerMeta.sizes) {
      // 1.2 is `platformHeight(2)`; 0.45 is the rack's share of the footprint.
      assert.equal(mcpServerHeightUnits(size), 1.2 + footprintUnits(size) * 0.45);
    }
    assert.ok(mcpServerHeightUnits("l") > mcpServerHeightUnits("s"));
  });
});
