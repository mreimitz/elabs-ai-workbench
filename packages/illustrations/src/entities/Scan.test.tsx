import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { footprintUnits } from "../iso-math.js";
import { attributeValues } from "../test-support.js";
import { mcpServerHeightUnits, mcpServerMeta } from "./McpServer.js";
import { Scan, scanClearance, scanHeightUnits, scanMeta } from "./Scan.js";
import { describeEntityContract, renderEntity } from "./contract-support.js";

describeEntityContract(Scan, scanMeta);

describe("scan — an arch is a HOLE (WP 1.2)", () => {
  it("stands on no platform, because the ground under the opening belongs to the subject", () => {
    // Every other entity in the catalog draws an `iso-platform`. This one must not: a plinth here
    // would either hold the subject up off its own plinth or be drawn straight through by it.
    const markup = renderEntity(Scan, {});
    assert.ok(!markup.includes('data-illus-primitive="iso-platform"'));
  });

  it("draws two legs and one head unit, and nothing standing in the opening", () => {
    const housings = attributeValues(renderEntity(Scan, {}), "data-illus-primitive").filter(
      (name) => name === "iso-housing",
    ).length;
    assert.equal(housings, 3);
  });

  it("publishes a clear span and headroom rather than leaving them to be eyeballed", () => {
    for (const size of scanMeta.sizes) {
      const footprint = footprintUnits(size);
      const { span, headroom } = scanClearance(size);
      // Nine decimals rather than strict equality: both are sums of products.
      assert.equal(span.toFixed(9), (footprint * 0.8).toFixed(9));
      assert.equal(headroom.toFixed(9), (1.2 + footprint * 0.55).toFixed(9));
      assert.ok(scanHeightUnits(size) > headroom, "the head unit must sit above the headroom");
    }
  });
});

// WP 1.2 acceptance 6, as arithmetic: whether a server actually fits under this arch. The numbers
// come from `mcp-server`'s own exports, so neither entity can drift into a lie the other still
// reports as true.
describe("scan — what an `l` arch actually clears (the WP 1.2 footprint finding)", () => {
  /** An `mcp-server`'s rack is half its footprint (`RACK_WIDTH`), and its plinth is all of it. */
  const rackWidth = (size: "s" | "m" | "l") => footprintUnits(size) * 0.5;

  it("clears a same-size server's full HEIGHT, at every size", () => {
    for (const size of scanMeta.sizes) {
      assert.ok(
        scanClearance(size).headroom > mcpServerHeightUnits(size),
        `${size}: headroom ${scanClearance(size).headroom} does not clear a server standing ${mcpServerHeightUnits(size)}`,
      );
    }
  });

  it("clears a same-size server's RACK, at every size", () => {
    for (const size of scanMeta.sizes) {
      assert.ok(scanClearance(size).span > rackWidth(size));
    }
  });

  it("does NOT clear a same-size server's plinth — the finding, pinned rather than fudged", () => {
    // The legs have to live inside the arch's own quantized footprint (D-IL2), so the span is the
    // footprint minus two legs and a same-size subject can never fit. Recorded as an assertion so
    // that a later change which "fixes" it by overhanging the footprint goes red here.
    for (const size of scanMeta.sizes) {
      assert.ok(scanClearance(size).span < footprintUnits(size));
    }
    assert.equal(scanClearance("l").span.toFixed(9), "6.400000000");
    assert.equal(footprintUnits("l"), 8);
  });

  it("clears an `m` server ENTIRELY at `l` — which is the Phase 2 layout rule", () => {
    // Draw a scan one size tier above its subject. That is the actionable half of the finding.
    assert.ok(scanClearance("l").span > footprintUnits("m"));
    assert.ok(scanClearance("l").headroom > mcpServerHeightUnits("m"));
    assert.ok(scanClearance("m").span > footprintUnits("s"));
    assert.ok(scanClearance("m").headroom > mcpServerHeightUnits("s"));
  });
});

describe("scan — the accent IS the geometry (D-IL6)", () => {
  const accents = (markup: string) => (markup.match(/var\(--illus-accent\)/g) ?? []).length;

  it("lights only the measuring line, and spans it exactly as wide as the arch is clear", () => {
    const markup = renderEntity(Scan, { size: "l" });
    assert.equal(accents(markup), 1);
    const line = /<line data-illus-mark="measuring-line" x1="([^"]+)" y1="[^"]+" x2="([^"]+)"/.exec(
      markup,
    );
    assert.ok(line, "the measuring line did not render");
    // The line runs along world y between the legs' inner faces; on screen that is a span of
    // `span * ISO_KX` in x, since a step along -y and a step along +y splay in opposite directions.
    const drawn = Math.abs(Number(line[2]) - Number(line[1]));
    assert.equal(Math.round(drawn * 100) / 100, Math.round(scanClearance("l").span * 13.856 * 100) / 100);
  });

  it("turns the line to the error token rather than adding a second mark", () => {
    const markup = renderEntity(Scan, { state: "error" });
    assert.equal(accents(markup), 0);
    assert.ok(markup.includes("var(--illus-error)"));
  });
});

describe("scan — the ports name the arch's two jobs (D-IL7)", () => {
  it("declares where the subject stands and where the report leaves, clear of the cardinals", () => {
    for (const [semantic, cardinal] of [
      ["subject-under", "bottom"],
      ["result-out", "right"],
    ] as const) {
      const port = scanMeta.ports[semantic];
      assert.ok(port, `the entry declares no \`${semantic}\` port`);
      assert.equal(port.side, cardinal);
      assert.notEqual(port.offset ?? 0, scanMeta.ports[cardinal]?.offset ?? 0);
      // Inside the smallest footprint, whose half-extent is 2 units.
      assert.ok(Math.abs(port.offset ?? 0) < footprintUnits("s") / 2);
    }
  });

  it("binds to the table an operator would recognise as this thing", () => {
    assert.equal(scanMeta.entity, "mcp_scans");
    assert.equal(mcpServerMeta.entity, "mcp_servers");
  });
});

describe("scan — an arch is symmetric, so it ignores `facing` (D-IL17)", () => {
  it("draws exactly the same bytes whichever way the flow runs", () => {
    const strip = (markup: string) => markup.replace(/ data-illus-facing="[^"]*"/g, "");
    assert.equal(
      strip(renderEntity(Scan, { facing: "upstream" })),
      strip(renderEntity(Scan, { facing: "downstream" })),
    );
  });
});
