import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { attributeValues } from "../test-support.js";
import { Database, databaseHeightUnits, databaseMeta } from "./Database.js";
import { describeEntityContract, renderEntity } from "./contract-support.js";

describeEntityContract(Database, databaseMeta);

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
      return Number((Math.max(...xs) - Math.min(...xs)).toFixed(3));
    });
}

describe("database — a crate, not another box on a platform", () => {
  it("stands on skids rather than a plinth, so there is daylight underneath", () => {
    const markup = renderEntity(Database, {});
    assert.ok(
      !attributeValues(markup, "data-illus-primitive").includes("iso-platform"),
      "the crate grew a plinth, which is the silhouette five of this cast already have",
    );
    // far skid, near skid, body, lid.
    assert.equal(housingWidths(markup).length, 4);
  });

  it("overhangs its lid past the body, which is the other half of the profile", () => {
    for (const size of databaseMeta.sizes) {
      const [, , body, lid] = housingWidths(renderEntity(Database, { size })) as [
        number,
        number,
        number,
        number,
      ];
      assert.ok(lid > body, `at ${size} the lid (${lid}) does not overhang the body (${body})`);
    }
  });

  it("ribs BOTH visible flanks, so it is not a smooth box with a decoration on one side", () => {
    const markup = renderEntity(Database, {});
    const faces = attributeValues(markup, "data-illus-glyph-face");
    assert.ok(faces.includes("left"));
    assert.ok(faces.includes("right"));
    assert.equal(marks(markup, "rib"), 8);
  });
});

describe("database — no domain text, and no borrowed glyph (WP 1.3)", () => {
  it("draws no lettering at all — the crate says storage by being a crate", () => {
    // Labels in this system are screen-aligned or they do not exist (D-IL2), so text on a face would
    // have broken two rules to say what the caption already says. `EntityRoot` still emits the
    // `<title>`/`<desc>` a11y pair and, when asked, a caption; the DRAWING carries none.
    const markup = renderEntity(Database, { size: "l" });
    const drawn = markup.replace(/<title[^>]*>.*?<\/title>|<desc[^>]*>.*?<\/desc>/g, "");
    assert.ok(!drawn.includes("<text"), "the crate drew lettering");
  });

  it("omits `entity` rather than stretching one", () => {
    // The database is not a table; it is what the tables are in.
    assert.equal(databaseMeta.entity, null);
  });
});

describe("database — one accent moment, and it is the seal (D-IL6)", () => {
  it("lights the seal band and leaves eight ribs muted", () => {
    const markup = renderEntity(Database, {});
    assert.equal(accents(markup), 1);
    assert.equal(marks(markup, "seal"), 1);
  });

  it("recolours the seal on error rather than adding a mark", () => {
    const markup = renderEntity(Database, { state: "error" });
    assert.equal(accents(markup), 0);
    assert.equal(marks(markup, "seal"), 1);
    assert.ok(markup.includes("var(--illus-error)"));
  });
});

describe("database — read and write are two ports, not one bus (D-IL7)", () => {
  it("puts them on opposite flanks, because who may WRITE is the interesting question", () => {
    assert.equal(databaseMeta.ports.read?.side, "right");
    assert.equal(databaseMeta.ports.write?.side, "left");
    for (const size of databaseMeta.sizes) {
      assert.ok(databaseHeightUnits(size) > 0);
    }
  });
});
