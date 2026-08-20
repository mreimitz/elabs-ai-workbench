import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fmt } from "../iso-math.js";
import { attributeValues, paintValues, render } from "../test-support.js";
import { Connector, arrowHeadPoints } from "./Connector.js";

// The table below is transcribed BY HAND from 01-system-design.md section 2.3, not read out of
// Connector.tsx. That is the point: if somebody edits the component's table, this one disagrees and
// the gate says so. Two copies of a decision, deliberately, because the decision is the product.
//
//   kind     meaning                  stroke                    marker
//   flow     process order            --illus-ink-muted, 2.5    ink arrow
//   read     consumes / loads from    --illus-ink,       2      ink arrow
//   write    produces / feeds into    --illus-accent,    2 dash accent arrow
//   publish  new version / promotion  --illus-accent,    2.5    accent arrow
//   loop     cycle / repeat           --illus-guide,     2 dash ink arrow
//   signal   events / particles       --illus-accent-2,  1.5 dot none (particles)

const SPEC = [
  { kind: "flow", stroke: "var(--illus-ink-muted)", width: "2.5", dashed: false, arrow: "ink" },
  { kind: "read", stroke: "var(--illus-ink)", width: "2", dashed: false, arrow: "ink" },
  { kind: "write", stroke: "var(--illus-accent)", width: "2", dashed: true, arrow: "accent" },
  { kind: "publish", stroke: "var(--illus-accent)", width: "2.5", dashed: false, arrow: "accent" },
  { kind: "loop", stroke: "var(--illus-guide)", width: "2", dashed: true, arrow: "ink" },
  {
    kind: "signal",
    stroke: "var(--illus-accent-2)",
    width: "1.5",
    dashed: true,
    arrow: "none",
  },
] as const;

const A = { x: 0, y: 0 };
const B = { x: 120, y: 0 };

describe("Connector — the six kinds, and only the six (D-IL8)", () => {
  it("draws exactly the six kinds the grammar names", () => {
    assert.equal(SPEC.length, 6);
    for (const entry of SPEC) {
      const markup = render(<Connector kind={entry.kind} from={A} to={B} />);
      assert.ok(markup.includes(`data-illus-connector="${entry.kind}"`), entry.kind);
    }
  });

  for (const entry of SPEC) {
    it(`strokes ${entry.kind} with ${entry.stroke} at ${entry.width}`, () => {
      const markup = render(<Connector kind={entry.kind} from={A} to={B} />);
      const path = /<path[^>]*>/.exec(markup)?.[0] ?? "";
      assert.ok(
        path.includes(entry.stroke),
        `${entry.kind} should stroke ${entry.stroke}: ${path}`,
      );
      assert.ok(
        path.includes(`stroke-width="${entry.width}"`),
        `${entry.kind} should be ${entry.width} wide: ${path}`,
      );
      assert.equal(
        path.includes("stroke-dasharray"),
        entry.dashed,
        `${entry.kind} dash pattern: ${path}`,
      );
    });
  }

  for (const entry of SPEC) {
    it(`gives ${entry.kind} ${entry.arrow === "none" ? "no arrowhead" : `an ${entry.arrow} arrowhead`}`, () => {
      const markup = render(<Connector kind={entry.kind} from={A} to={B} />);
      const polygon = /<polygon[^>]*>/.exec(markup)?.[0];
      if (entry.arrow === "none") {
        assert.equal(polygon, undefined, "signal reads as particles, not as an arrow");
        return;
      }
      assert.ok(polygon, `${entry.kind} should carry an arrowhead`);
      const expected = entry.arrow === "ink" ? "var(--illus-ink)" : "var(--illus-accent)";
      assert.ok(polygon.includes(expected), `${entry.kind} arrowhead fill: ${polygon}`);
    });
  }

  it("paints nothing that is not an --illus-* token", () => {
    for (const entry of SPEC) {
      const markup = render(<Connector kind={entry.kind} from={A} to={B} label="labelled" />);
      for (const value of paintValues(markup)) {
        assert.ok(
          value === "none" || value.startsWith("var(--illus-"),
          `${entry.kind} painted ${value}`,
        );
      }
    }
  });

  it("needs no id, so two connectors of the same kind cannot collide", () => {
    // The arrowhead is a polygon rather than an SVG <marker>, precisely so nothing here has to be
    // named. An id would be either duplicated or generated, and generated breaks determinism.
    const markup = render(
      <g>
        <Connector kind="read" from={A} to={B} />
        <Connector kind="read" from={A} to={{ x: 60, y: 40 }} />
      </g>,
    );
    assert.equal(attributeValues(markup, "id").length, 0);
    assert.equal(markup.includes("<defs"), false);
    assert.equal(markup.includes("marker-end"), false);
  });

  it("renders the same bytes for the same props", () => {
    const once = render(<Connector kind="publish" from={A} to={B} label="new version" />);
    const twice = render(<Connector kind="publish" from={A} to={B} label="new version" />);
    assert.equal(once, twice);
  });

  it("follows the waypoints it is given, and routes nothing itself", () => {
    // WP 2.2 owns routing. This WP draws a line between points somebody else chose.
    const markup = render(
      <Connector kind="flow" from={A} to={B} waypoints={[{ x: 60, y: -40 }]} />,
    );
    const d = /<path[^>]*\bd="([^"]+)"/.exec(markup)?.[1] ?? "";
    assert.ok(d.startsWith("M 0 0 L 60 -40 L"), `expected the waypoint in the path, got ${d}`);
  });

  it("knocks the label out of the line rather than boxing it", () => {
    const markup = render(<Connector kind="read" from={A} to={B} label="provides tools" />);
    assert.ok(markup.includes('paint-order="stroke"'));
    assert.ok(markup.includes("var(--illus-paper)"), "the knockout is paper-coloured");
    assert.ok(markup.includes(">provides tools</text>"));
  });

  it("puts the label at the midpoint BY ARC LENGTH, not by endpoint average", () => {
    // An elbowed run's endpoint midpoint can sit off the line entirely; the arc-length midpoint
    // cannot. The path here is 100 px right then 100 px down, so the halfway point is the corner.
    const markup = render(
      <Connector
        kind="flow"
        from={{ x: 0, y: 0 }}
        to={{ x: 100, y: 100 }}
        waypoints={[{ x: 100, y: 0 }]}
        label="mid"
      />,
    );
    const x = /<text[^>]*\bx="([^"]+)"/.exec(markup)?.[1];
    assert.equal(x, fmt(100));
  });
});

describe("Connector — the arrowhead", () => {
  it("points along the last segment, ten pixels long", () => {
    // A run straight to the right: the tip is at the target, the base ten pixels back, and the two
    // base corners 4.2 px either side of the line.
    const head = arrowHeadPoints({ x: 100, y: 0 }, { x: 0, y: 0 });
    assert.deepEqual(head[0], { x: 100, y: 0 });
    assert.deepEqual(head[1], { x: 90, y: 4.2 });
    assert.deepEqual(head[2], { x: 90, y: -4.2 });
  });

  it("survives a zero-length segment without producing NaN", () => {
    for (const point of arrowHeadPoints({ x: 5, y: 5 }, { x: 5, y: 5 })) {
      assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
    }
  });
});
