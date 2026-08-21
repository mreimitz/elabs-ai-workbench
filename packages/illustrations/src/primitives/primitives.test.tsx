import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ReactElement } from "react";
import { ISO_TAN30, ISO_UNIT, faceTransform, project } from "../iso-math.js";
import { ILLUS_STROKE_CONSTRUCTION, ILLUS_STROKE_INK } from "../line-system.js";
import {
  attributeValues,
  isAllowedPaint,
  paintValues,
  render,
  tokensUsed,
} from "../test-support.js";
import { CalibrationCube } from "./CalibrationCube.js";
import { CalloutCard, calloutCardHeight } from "./CalloutCard.js";
import { ConstructionGhost } from "./ConstructionGhost.js";
import { GlyphFrame } from "./GlyphFrame.js";
import { FIGURE_PROPORTIONS, IsoFigure, figureBoxes, figureHeightUnits } from "./IsoFigure.js";
import { IsoHousing, isoExtrude } from "./IsoHousing.js";
import { IsoPlatform, PLATFORM_MAX_TIERS, platformHeight } from "./IsoPlatform.js";
import { PaperStage } from "./PaperStage.js";
import { PrincipleCard, principleCardHeight } from "./PrincipleCard.js";
import { StationHeader } from "./StationHeader.js";

// Every primitive WP 0.2 ships, each as a factory rather than an element — an array of live JSX is
// an "iterable without keys" as far as the linter is concerned, and a factory is what these actually
// are anyway: a sample of the component, rendered fresh per assertion.
const EVERY_PRIMITIVE: readonly (readonly [string, () => ReactElement])[] = [
  ["PaperStage", () => <PaperStage width={200} height={160} />],
  ["IsoPlatform", () => <IsoPlatform tiers={3} footprint="l" />],
  ["IsoHousing", () => <IsoHousing width={3} depth={3} height={2} />],
  [
    "GlyphFrame",
    () => (
      <GlyphFrame face="left" box={{ cx: 0, cy: 0, w: 3, d: 3, z0: 0, h: 3 }}>
        <rect x={2} y={2} width={10} height={10} style={{ fill: "var(--illus-surface-sunken)" }} />
      </GlyphFrame>
    ),
  ],
  ["ConstructionGhost", () => <ConstructionGhost width={6} depth={6} />],
  ["IsoFigure", () => <IsoFigure footprint={6} floor={1.2} />],
  ["CalibrationCube", () => <CalibrationCube />],
  [
    "StationHeader",
    () => <StationHeader at={{ x: 0, y: 0 }} seq={2} title="Measure" caption="cost" />,
  ],
  [
    "CalloutCard",
    () => (
      <CalloutCard
        at={{ x: 0, y: 0 }}
        title="Note"
        lines={["one", "two"]}
        anchor={{ x: -80, y: 90 }}
      />
    ),
  ],
  [
    "PrincipleCard",
    () => <PrincipleCard at={{ x: 0, y: 0 }} title="Principles" items={["a", "b"]} />,
  ],
];

describe("primitives — the invariants that hold for ALL of them", () => {
  for (const [name, element] of EVERY_PRIMITIVE) {
    it(`${name} paints only --illus-* tokens (D-IL5)`, () => {
      const markup = render(element());
      const paints = paintValues(markup);
      assert.ok(paints.length > 0, `${name} painted nothing at all`);
      for (const value of paints) {
        assert.ok(
          isAllowedPaint(value),
          `${name} painted ${value}, which is not an --illus-* token`,
        );
      }
      for (const token of tokensUsed(markup)) {
        assert.match(token, /^--illus-[a-z0-9-]+$/, `${name} read ${token}`);
      }
    });
  }

  for (const [name, element] of EVERY_PRIMITIVE) {
    it(`${name} renders the same bytes twice (determinism, D-IL10)`, () => {
      assert.equal(render(element()), render(element()));
    });
  }

  it("names itself, so a rendered scene can be read back", () => {
    for (const [, element] of EVERY_PRIMITIVE) {
      const markup = render(element());
      assert.ok(markup.includes("data-illus-"), markup.slice(0, 120));
    }
  });
});

describe("IsoHousing + isoExtrude — the three-face solid", () => {
  it("paints left, then right, then top — back to front", () => {
    const markup = render(<IsoHousing width={2} depth={2} height={1} />);
    assert.deepEqual(attributeValues(markup, "data-illus-face"), ["left", "right", "top"]);
  });

  it("gives each face its own shade, from the derived face tokens", () => {
    const markup = render(<IsoHousing width={2} depth={2} height={1} />);
    assert.deepEqual(tokensUsed(markup), [
      "--illus-face-left",
      "--illus-ink",
      "--illus-face-right",
      "--illus-ink",
      "--illus-face-top",
      "--illus-ink",
    ]);
  });

  it("takes its ink weight from the line system, by name", () => {
    const ink = render(<IsoHousing width={2} depth={2} height={1} weight="ink" />);
    assert.ok(ink.includes(`stroke-width="${ILLUS_STROKE_INK}"`));
    const detail = render(<IsoHousing width={2} depth={2} height={1} weight="detail" />);
    assert.ok(detail.includes('stroke-width="1.5"'));
  });

  it("filters faces without reordering them", () => {
    const markup = render(<IsoHousing width={2} depth={2} height={1} faces={["top", "left"]} />);
    assert.deepEqual(attributeValues(markup, "data-illus-face"), ["left", "top"]);
  });

  it("extrudes a unit cube to the polygons the projection predicts", () => {
    const faces = isoExtrude({ cx: 0, cy: 0, w: 1, d: 1, z0: 0, h: 1 });
    // Top face at z = 1: back, right, front, left corners.
    assert.equal(faces.top, "0,-24 13.856,-16 0,-8 -13.856,-16");
    // The right (+x) face shares the top face's right and front corners.
    assert.ok(faces.right.includes("13.856,-16"));
    assert.ok(faces.right.includes("0,-8"));
  });
});

describe("IsoPlatform — the quantized plinth", () => {
  it("steps in by a fixed inset, one tier at a time", () => {
    for (const tiers of [1, 2, 3]) {
      const markup = render(<IsoPlatform tiers={tiers} />);
      assert.equal(markup.includes(`data-illus-tiers="${tiers}"`), true);
      // Three faces per tier.
      assert.equal(attributeValues(markup, "data-illus-face").length, tiers * 3);
    }
  });

  it("clamps rather than throwing, so a scene always draws", () => {
    assert.ok(render(<IsoPlatform tiers={0} />).includes('data-illus-tiers="1"'));
    assert.ok(
      render(<IsoPlatform tiers={99} />).includes(`data-illus-tiers="${PLATFORM_MAX_TIERS}"`),
    );
  });

  it("reports the height an entity has to stand on", () => {
    assert.equal(platformHeight(1), 0.7);
    assert.equal(platformHeight(2), 1.2);
    assert.equal(Number(platformHeight(3).toFixed(3)), 1.6);
    assert.equal(platformHeight(99), platformHeight(PLATFORM_MAX_TIERS));
  });

  it("sizes the bottom tier at the registry footprint EXACTLY (the exemplar divergence)", () => {
    // examples/Agent.example.tsx draws its `m` platform 5.6 units wide; D-IL2 quantizes `m` at 6.
    // The spec wins, so the outermost tier's footprint is 6x6 units. On screen its left and right
    // corners sit at +/- 6 * KX = +/- 83.138 px, because the diagonal of a 6-unit square spans six
    // units of x AND six of -y.
    const markup = render(<IsoPlatform tiers={1} footprint="m" />);
    const top = (attributeValues(markup, "points")[2] ?? "")
      .split(" ")
      .map((pair) => Number(pair.split(",")[0]));
    assert.equal(Math.max(...top), 83.138);
    assert.equal(Math.min(...top), -83.138);
  });
});

describe("IsoFigure — the standing figure two entities share (WP 1.1 §3)", () => {
  it("stacks torso, neck and head from the floor with no gap and no overlap", () => {
    const { torso, neck, head, crown } = figureBoxes(6, 1.2);
    assert.equal(torso.z0, 1.2);
    assert.equal(neck.z0, torso.z0 + torso.h);
    assert.equal(head.z0, neck.z0 + neck.h);
    assert.equal(crown, head.z0 + head.h);
  });

  it("reproduces the owner exemplar's `m` numbers, which is why Agent could move onto it", () => {
    // examples/Agent.example.tsx: torso 2.9 wide by 1.8 tall from z 1.2, neck 0.9 by 0.18 from 3.0,
    // head 2.2 by 1.4 from 3.18, crown 4.58. The agent's 5.35 antenna tip is that plus 0.77.
    //
    // Rounded to three places, which is the same rounding `fmt` applies before any of these numbers
    // reaches an attribute: 6 * (1.8 / 6) is 1.7999999999999998 in binary floating point, and
    // asserting the raw double here would be asserting IEEE-754 rather than the exemplar. The CROWN
    // is asserted exactly, because that one is load-bearing — every port anchor is measured against
    // it, and `Agent.test.tsx` pins the antenna tip 0.77 above it at exactly 5.35.
    const round = (value: number) => Number(value.toFixed(3));
    const { torso, neck, head, crown } = figureBoxes(6, 1.2);
    assert.deepEqual([torso.w, torso.h, torso.z0].map(round), [2.9, 1.8, 1.2]);
    assert.deepEqual([neck.w, neck.h, neck.z0].map(round), [0.9, 0.18, 3]);
    assert.deepEqual([head.w, head.h, head.z0].map(round), [2.2, 1.4, 3.18]);
    assert.equal(crown, 4.58);
    assert.equal(figureHeightUnits(6, 1.2), 4.58);
  });

  it("is one drawing at three scales — every proportion is a fraction of the footprint", () => {
    for (const [footprint, expected] of [
      [4, 4 * FIGURE_PROPORTIONS.torsoWidth],
      [8, 8 * FIGURE_PROPORTIONS.torsoWidth],
    ] as const) {
      assert.equal(figureBoxes(footprint, 1.2).torso.w, expected);
    }
  });

  it("draws three solids and a visor, and can drop the visor", () => {
    const housings = (element: ReactElement) =>
      attributeValues(render(element), "data-illus-primitive").filter(
        (name) => name === "iso-housing",
      ).length;
    assert.equal(housings(<IsoFigure footprint={6} floor={1.2} />), 3);
    const withVisor = render(<IsoFigure footprint={6} floor={1.2} />);
    const without = render(<IsoFigure footprint={6} floor={1.2} visor={false} />);
    assert.ok(withVisor.includes('data-illus-glyph-face="left"'));
    assert.ok(!without.includes("data-illus-glyph-face"));
  });

  it("spends no accent just by standing there (D-IL6)", () => {
    // The figure's accent budget belongs to whatever the entity CARRIES — the agent's antenna LED,
    // the validator's verdict mark. Two figures side by side must not cost two accent moments.
    assert.ok(!render(<IsoFigure footprint={6} floor={1.2} />).includes("var(--illus-accent)"));
  });
});

describe("PaperStage — grid before drawing", () => {
  it("carries a minor grid, a major grid, a crosshair and registration marks", () => {
    const markup = render(<PaperStage width={200} height={200} />);
    assert.equal(attributeValues(markup, "id").length, 2, "one minor and one major pattern");
    assert.ok(markup.includes("--illus-grid)"));
    assert.ok(markup.includes("--illus-grid-major)"));
    assert.ok(markup.includes('data-illus-mark="crosshair"'));
    assert.equal(attributeValues(markup, "d").filter((d) => d.includes("H")).length >= 5, true);
  });

  it("puts the grid on the unit, so the drawing and the paper agree", () => {
    const markup = render(<PaperStage width={64} height={64} />);
    assert.ok(markup.includes(`width="${ISO_UNIT}"`), "the minor cell is one iso unit");
  });

  it("turns off, cleanly", () => {
    const markup = render(<PaperStage width={64} height={64} grid={false} registration={false} />);
    assert.equal(attributeValues(markup, "id").length, 0);
    assert.equal(markup.includes("--illus-grid)"), false);
    assert.ok(markup.includes("--illus-paper)"), "the paper is still paper");
  });

  it("derives its pattern ids from the grid, so two stages share or differ HONESTLY", () => {
    const a = attributeValues(render(<PaperStage width={40} height={40} />), "id");
    const b = attributeValues(render(<PaperStage width={90} height={90} />), "id");
    const c = attributeValues(render(<PaperStage width={40} height={40} cell={24} />), "id");
    assert.deepEqual(a, b, "same grid, same definition");
    assert.notDeepEqual(a, c, "different grid, different definition");
    // And nothing in an id can be mistaken for a colour literal by the package's own guard.
    for (const id of [...a, ...c]) assert.match(id, /^illus-[a-z]/);
  });
});

describe("GlyphFrame — the only route onto a face (D-IL15)", () => {
  const BOX = { cx: 0, cy: 0, w: 3, d: 3, z0: 0, h: 3 } as const;

  it("emits exactly the matrix iso-math computes, for each face", () => {
    for (const face of ["top", "left", "right"] as const) {
      const markup = render(
        <GlyphFrame face={face} box={BOX}>
          <rect width={4} height={4} />
        </GlyphFrame>,
      );
      const transform = attributeValues(markup, "transform")[0];
      assert.ok(transform?.startsWith("matrix("), transform);
      assert.equal(transform, faceTransform(face, hangCorner(face)));
    }
  });

  it("measures the face, so art can be laid out inside it without guessing", () => {
    const markup = render(
      <GlyphFrame face="left" box={BOX}>
        <rect width={4} height={4} />
      </GlyphFrame>,
    );
    assert.ok(markup.includes('data-illus-glyph-width="48"'));
    assert.ok(markup.includes('data-illus-glyph-height="48"'));
  });

  it("accepts an explicit world anchor for art that hangs off no box", () => {
    const markup = render(
      <GlyphFrame face="top" at={[1, 1, 2]}>
        <rect width={4} height={4} />
      </GlyphFrame>,
    );
    assert.equal(attributeValues(markup, "transform")[0], faceTransform("top", project(1, 1, 2)));
  });

  function hangCorner(face: "top" | "left" | "right") {
    if (face === "left") return project(-1.5, 1.5, 3);
    if (face === "right") return project(1.5, 1.5, 3);
    return project(-1.5, -1.5, 3);
  }
});

describe("ConstructionGhost — the drafting layer, not a wobble filter", () => {
  it("is a 1 px dashed guide outline, filled with nothing", () => {
    const markup = render(<ConstructionGhost width={6} depth={6} />);
    assert.ok(markup.includes(`stroke-width="${ILLUS_STROKE_CONSTRUCTION}"`));
    assert.ok(markup.includes('stroke-dasharray="4 4"'));
    assert.ok(markup.includes('fill="none"'));
    assert.deepEqual(tokensUsed(markup), ["--illus-guide"]);
  });

  it("offsets from the solid it echoes, or it is not an echo", () => {
    const straight = render(<ConstructionGhost width={6} depth={6} dx={0} dy={0} />);
    const offset = render(<ConstructionGhost width={6} depth={6} />);
    assert.notEqual(straight, offset);
  });
});

describe("CalibrationCube — the standing reference (D-IL15)", () => {
  it("is exactly one unit, and says so", () => {
    const markup = render(<CalibrationCube />);
    assert.ok(markup.includes(`1u = ${ISO_UNIT} px`));
    // One unit tall: the dimension line spans 16 px of screen height.
    const top = project(0.5, -0.5, 1);
    const bottom = project(0.5, -0.5, 0);
    assert.equal(bottom.y - top.y, ISO_UNIT);
  });

  it("can drop the dimension line when it is used as a plain reference", () => {
    const markup = render(<CalibrationCube dimensioned={false} />);
    assert.equal(markup.includes("1u ="), false);
    assert.equal(attributeValues(markup, "data-illus-face").length, 3);
  });
});

describe("StationHeader — screen-aligned, always (D-IL2)", () => {
  it("never skews its text onto a face", () => {
    const markup = render(
      <StationHeader at={{ x: 0, y: 0 }} seq={1} title="Discover" caption="c" />,
    );
    assert.equal(markup.includes("transform"), false);
    assert.equal(markup.includes("matrix("), false);
  });

  it("stays neutral until accent is asked for (D-IL6)", () => {
    const neutral = render(<StationHeader at={{ x: 0, y: 0 }} seq={1} title="Discover" />);
    assert.equal(neutral.includes("--illus-accent"), false);
    const accented = render(<StationHeader at={{ x: 0, y: 0 }} seq={1} title="Discover" accent />);
    assert.ok(accented.includes("--illus-accent)"));
    assert.ok(
      accented.includes("--illus-accent-contrast)"),
      "a glyph on accent takes its contrast",
    );
  });

  it("drops the chip when there is no number to show", () => {
    const markup = render(<StationHeader at={{ x: 0, y: 0 }} title="Unnumbered" />);
    assert.equal(markup.includes("<circle"), false);
  });
});

describe("annotation cards — leaders elbow on the iso axes (D-IL16)", () => {
  it("draws a leader only when the card points at something", () => {
    const alone = render(<CalloutCard at={{ x: 0, y: 0 }} title="Note" />);
    assert.equal(alone.includes('data-illus-mark="leader"'), false);
    const pointing = render(
      <CalloutCard at={{ x: 0, y: 0 }} title="Note" anchor={{ x: -120, y: 140 }} />,
    );
    assert.ok(pointing.includes('data-illus-mark="leader"'));
  });

  it("runs the leader at 30 degrees and then straight up or down", () => {
    const markup = render(
      <CalloutCard at={{ x: 0, y: 0 }} title="Note" lines={["x"]} anchor={{ x: -120, y: 140 }} />,
    );
    const d = attributeValues(markup, "d")[0] ?? "";
    const points = [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => ({
      x: Number(m[1]),
      y: Number(m[2]),
    }));
    assert.equal(points.length, 3, `expected one elbow, got ${d}`);
    const [from, bend, to] = points as [
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
    ];
    // First leg: 30 degrees. Second leg: vertical.
    assert.equal(
      Number(Math.abs((bend.y - from.y) / (bend.x - from.x)).toFixed(3)),
      Number(ISO_TAN30.toFixed(3)),
    );
    assert.equal(bend.x, to.x);
  });

  it("leaves from whichever edge faces the anchor", () => {
    const fromLeft = render(
      <CalloutCard at={{ x: 0, y: 0 }} title="N" anchor={{ x: -200, y: 100 }} />,
    );
    const fromRight = render(
      <CalloutCard at={{ x: 0, y: 0 }} title="N" anchor={{ x: 400, y: 100 }} />,
    );
    assert.notEqual(fromLeft, fromRight);
  });

  it("computes its own height, so a caller can stack cards without rendering them", () => {
    assert.equal(calloutCardHeight([]), 44);
    assert.equal(calloutCardHeight(["one", "two"]), 44 + 32);
    assert.equal(principleCardHeight(["one"]), 24 + 20 + 20);
  });

  it("takes pre-broken lines, because measuring text would break determinism", () => {
    const markup = render(
      <PrincipleCard at={{ x: 0, y: 0 }} title="Principles" items={["first", "second"]} />,
    );
    assert.equal((markup.match(/<text/g) ?? []).length, 3, "a title and one text per item");
    assert.equal((markup.match(/<polygon/g) ?? []).length, 2, "one iso lozenge per item");
  });
});
