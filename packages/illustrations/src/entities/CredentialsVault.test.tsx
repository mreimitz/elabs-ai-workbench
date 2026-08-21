import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ISO_UNIT } from "../iso-math.js";
import { attributeValues } from "../test-support.js";
import {
  CredentialsVault,
  credentialsVaultHeightUnits,
  credentialsVaultMeta,
} from "./CredentialsVault.js";
import { McpServer, mcpServerHeightUnits } from "./McpServer.js";
import { describeEntityContract, renderEntity } from "./contract-support.js";

describeEntityContract(CredentialsVault, credentialsVaultMeta);

const accents = (markup: string) => (markup.match(/var\(--illus-accent\)/g) ?? []).length;
const marks = (markup: string, mark: string) =>
  attributeValues(markup, "data-illus-mark").filter((name) => name === mark).length;

/** The screen width of each solid, in document order: the first polygon of each housing group. */
function housingWidths(markup: string): number[] {
  return markup
    .split('data-illus-primitive="iso-housing"')
    .slice(1)
    .map((chunk) => {
      const points = /points="([^"]+)"/.exec(chunk)?.[1] ?? "";
      const xs = points.split(" ").map((pair) => Number(pair.split(",")[0]));
      return Math.max(...xs) - Math.min(...xs);
    });
}

describe("credentials-vault — a stele, not a third box on a plinth", () => {
  it("draws a column far taller than it is wide", () => {
    // `mcp-server` and `provider` already occupy "roughly as wide as it is tall, on a two-tier
    // plinth". A stout safe would have been the third, and in the whole-cast row those three would
    // have been one silhouette repeated.
    for (const size of credentialsVaultMeta.sizes) {
      const widths = housingWidths(renderEntity(CredentialsVault, { size }));
      // two plinth tiers, the column, the cap.
      assert.equal(widths.length, 4);
      const column = widths[2] as number;
      const drawnHeight = credentialsVaultHeightUnits(size) * ISO_UNIT;
      assert.ok(
        drawnHeight / column > 2,
        `at ${size} the column is ${column} wide against ${drawnHeight} tall`,
      );
    }
  });

  it("overhangs its cap past the column", () => {
    const widths = housingWidths(renderEntity(CredentialsVault, {}));
    assert.ok((widths[3] as number) > (widths[2] as number));
  });

  it("stands taller than the boxy stations it must not be confused with", () => {
    for (const size of credentialsVaultMeta.sizes) {
      assert.ok(credentialsVaultHeightUnits(size) > mcpServerHeightUnits(size));
      // And it is genuinely a different drawing, not the same one scaled.
      assert.notEqual(
        renderEntity(CredentialsVault, { size }),
        renderEntity(McpServer, { size }),
      );
    }
  });
});

describe("credentials-vault — closed, with nothing that could be opened (WP 1.3)", () => {
  it("draws a dial with an index rather than a keyhole", () => {
    // WP 1.3 forbids a drawn key or a keyhole detailed enough to look like real material. What is
    // drawn is the vocabulary of something CLOSED: a dial (a mechanism with a setting), bolt heads,
    // and a seal — never an object that implies the key which opens it.
    const markup = renderEntity(CredentialsVault, {});
    assert.equal(marks(markup, "dial"), 1);
    assert.equal(marks(markup, "dial-index"), 1);
    assert.equal(marks(markup, "bolt"), 2);
    assert.equal(marks(markup, "keyhole"), 0);
  });

  it("mounts the plate on the `left` face outright, because a vault has no gaze (D-IL17)", () => {
    const faces = (facing: "upstream" | "downstream") =>
      new Set(attributeValues(renderEntity(CredentialsVault, { facing }), "data-illus-glyph-face"));
    assert.deepEqual(faces("upstream"), new Set(["left"]));
    assert.deepEqual(faces("downstream"), new Set(["left"]));
  });

  it("omits `entity` rather than stretching one", () => {
    // The secrets live across `mcp_oauth_credentials`, `provider_credentials`,
    // `assistant_credentials`, `api_tokens` and a key file. None of those is "the vault".
    assert.equal(credentialsVaultMeta.entity, null);
  });
});

describe("credentials-vault — issue and revoke, and nothing that reads (D-IL7)", () => {
  it("declares no read port, because the API never hands a secret to the browser", () => {
    assert.deepEqual(Object.keys(credentialsVaultMeta.ports).sort(), [
      "bottom",
      "issue",
      "left",
      "revoke",
      "right",
      "top",
    ]);
  });
});

describe("credentials-vault — one accent moment, and it is the seal (D-IL6)", () => {
  it("lights the seal bar and leaves the dial and the bolts as hardware", () => {
    assert.equal(accents(renderEntity(CredentialsVault, {})), 1);
  });

  it("recolours the seal on error rather than adding a mark", () => {
    const markup = renderEntity(CredentialsVault, { state: "error" });
    assert.equal(accents(markup), 0);
    assert.equal(marks(markup, "seal"), 1);
    assert.ok(markup.includes("var(--illus-error)"));
  });
});
