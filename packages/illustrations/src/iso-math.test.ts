import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ISO_AXIS_ANGLE_DEG,
  ISO_COS30,
  ISO_ELLIPSE_RATIO,
  ISO_ELLIPSE_ROTATION,
  ISO_FACE_SCALE_Y,
  ISO_FACES,
  ISO_FOOTPRINT_UNITS,
  ISO_KX,
  ISO_KY,
  ISO_LEADER_ANGLES_DEG,
  ISO_SIN30,
  ISO_TAN30,
  ISO_UNIT,
  applyMatrix,
  clampHeightUnits,
  faceExtent,
  faceMatrix,
  faceOrigin,
  faceTransform,
  facingFace,
  fmt,
  footprintUnits,
  isoBoxCorners,
  isoEllipse,
  isoLeaderPoints,
  polygonPoints,
  portAnchor,
  project,
  projectPoint,
} from "./iso-math.js";
import type { IsoFace, ScreenPoint } from "./iso-math.js";

// Every number this file asserts was computed BY HAND from the definition of the projection, not
// read out of a passing run. The distinction is the whole value of the file: a test written from the
// implementation's own output cannot fail when the implementation is wrong, only when it changes.
//
// The hand arithmetic, once, so the constants below can be checked by eye:
//
//   cos 30 = sqrt(3)/2 = 0.8660254037844386...      sin 30 = 1/2 exactly
//   KX = 16 * cos 30 = 8 * sqrt(3) = 13.856406460551018...
//   KY = 16 * sin 30 = 8
//   tan 30 = 1/sqrt(3) = 0.5773502691896257...
//
//   project(x, y, z) = ( (x - y) * KX , (x + y) * KY - 16 z )

const EPSILON = 1e-9;

function assertClose(actual: number, expected: number, message: string, epsilon = EPSILON): void {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `${message}: expected ${expected}, got ${actual} (difference ${Math.abs(actual - expected)})`,
  );
}

function assertPointClose(actual: ScreenPoint, expected: ScreenPoint, message: string): void {
  assertClose(actual.x, expected.x, `${message} (x)`);
  assertClose(actual.y, expected.y, `${message} (y)`);
}

const SQRT3 = Math.sqrt(3);

describe("iso-math — the constants of a true 30-degree projection", () => {
  it("is a 30-degree axonometric on a 16 px unit grid", () => {
    assert.equal(ISO_UNIT, 16);
    assert.equal(ISO_AXIS_ANGLE_DEG, 30);
  });

  it("carries cos 30 = sqrt(3)/2 and sin 30 = 1/2, not a 2:1 approximation", () => {
    assertClose(ISO_COS30, SQRT3 / 2, "cos 30");
    assertClose(ISO_COS30, 0.8660254037844386, "cos 30, to the digit");
    assert.equal(ISO_SIN30, 0.5);
    // The 2:1 pixel-art approximation would put the horizontal:vertical ratio at exactly 2. True iso
    // puts it at sqrt(3) = 1.732..., and that difference is the whole of D-IL2's "not 2:1" clause.
    assertClose(ISO_KX / ISO_KY, SQRT3, "the axis ratio is sqrt(3), not 2");
    assert.notEqual(Number(fmt(ISO_KX / ISO_KY)), 2);
  });

  it("writes sin 30 exactly, and the float sine agrees with it to within an ulp", () => {
    assertClose(Math.sin(Math.PI / 6), ISO_SIN30, "Math.sin(pi/6) vs the exact 1/2", 1e-15);
  });

  it("scales one unit to 8*sqrt(3) px across and 8 px down", () => {
    assertClose(ISO_KX, 8 * SQRT3, "KX");
    assertClose(ISO_KX, 13.856406460551018, "KX, to the digit");
    assert.equal(ISO_KY, 8);
  });

  it("keeps tan 30 as the one fall-per-pixel ratio", () => {
    assertClose(ISO_TAN30, 1 / SQRT3, "tan 30");
    assertClose(ISO_TAN30, 0.5773502691896257, "tan 30, to the digit");
    assertClose(ISO_ELLIPSE_RATIO, ISO_TAN30, "the ellipse rule is the same tangent");
  });

  it("pins the 86.6% face-scale factor D-IL15 names", () => {
    assertClose(ISO_FACE_SCALE_Y, 0.8660254037844386, "the face scale factor");
  });
});

describe("iso-math — project", () => {
  it("puts the world origin at the screen origin", () => {
    assertPointClose(project(0, 0, 0), { x: 0, y: 0 }, "origin");
  });

  it("splays the two ground axes at 30 degrees, in opposite directions", () => {
    // One unit along +x is 8*sqrt(3) right and 8 down; one unit along +y is the mirror image.
    assertPointClose(project(1, 0, 0), { x: 8 * SQRT3, y: 8 }, "+x");
    assertPointClose(project(0, 1, 0), { x: -8 * SQRT3, y: 8 }, "+y");
  });

  it("sends +z straight up by one whole unit", () => {
    assertPointClose(project(0, 0, 1), { x: 0, y: -16 }, "+z");
    assertPointClose(project(0, 0, 4), { x: 0, y: -64 }, "+z, four units");
  });

  it("adds the three axes linearly — no perspective anywhere", () => {
    // (2,1,3): x = (2-1)*KX = 13.856...  y = (2+1)*8 - 3*16 = 24 - 48 = -24
    assertPointClose(project(2, 1, 3), { x: 8 * SQRT3, y: -24 }, "(2,1,3)");
    // Doubling the input doubles the output, which a vanishing-point projection would not do.
    const single = project(1.5, -0.5, 2);
    const doubled = project(3, -1, 4);
    assertPointClose(doubled, { x: single.x * 2, y: single.y * 2 }, "linearity");
  });

  it("has one degree of freedom it cannot see: x and y move the screen y together", () => {
    // Anything on the line x + y = const, z = const lands on the same screen row. That is a property
    // of the projection, and knowing it is why components never rely on depth ordering by accident.
    assertClose(project(3, 1, 0).y, project(1, 3, 0).y, "equal x+y means equal screen y");
    assert.notEqual(fmt(project(3, 1, 0).x), fmt(project(1, 3, 0).x));
  });

  it("projects a tuple exactly as it projects three arguments", () => {
    assertPointClose(projectPoint([2, 1, 3]), project(2, 1, 3), "projectPoint");
  });
});

describe("iso-math — the three fixed face transforms (D-IL15)", () => {
  // The matrices, hand-derived from the recipes and independently checkable against the projection
  // in the test below. c = cos 30.
  //
  //   left  (+y face): matrix(c,  0.5, 0, 1)   local x runs along world +x, local y runs down
  //   right (+x face): matrix(c, -0.5, 0, 1)   local x runs along world -y, local y runs down
  //   top   (+z face): matrix(c,  0.5, -c, 0.5) local x along world +x, local y along world +y
  const EXPECTED: Record<IsoFace, readonly [number, number, number, number]> = {
    left: [ISO_COS30, 0.5, 0, 1],
    right: [ISO_COS30, -0.5, 0, 1],
    top: [ISO_COS30, 0.5, -ISO_COS30, 0.5],
  };

  for (const face of ISO_FACES) {
    it(`builds the ${face} face matrix the recipe predicts`, () => {
      const m = faceMatrix(face, { x: 0, y: 0 });
      const want = EXPECTED[face];
      assertClose(m[0], want[0], `${face} a`);
      assertClose(m[1], want[1], `${face} b`);
      assertClose(m[2], want[2], `${face} c`);
      assertClose(m[3], want[3], `${face} d`);
      assert.equal(m[4], 0);
      assert.equal(m[5], 0);
    });
  }

  it("compresses every face's area to 86.6% of the flat art's — the sqrt(3)/2 determinant", () => {
    // The determinant of a face matrix IS the 0.866 factor: a square centimetre of flat art covers
    // 0.866 square centimetres once it lies on an iso face. Break the scale step and this moves.
    for (const face of ISO_FACES) {
      const m = faceMatrix(face);
      const determinant = m[0] * m[3] - m[1] * m[2];
      assertClose(determinant, SQRT3 / 2, `${face} determinant`);
      assertClose(determinant, ISO_FACE_SCALE_Y, `${face} determinant is the face scale factor`);
    }
  });

  it("translates art to the origin it is given, and nothing else", () => {
    const m = faceMatrix("left", { x: -40, y: 17.5 });
    assert.equal(m[4], -40);
    assert.equal(m[5], 17.5);
    assertPointClose(applyMatrix(m, 0, 0), { x: -40, y: 17.5 }, "the art origin");
  });

  // ── The strongest statement available: a face transform IS the projection ──────────────────────
  //
  // Flat art mounted on a face must land exactly where the projection would put the same geometry
  // drawn in the world. If those two ever disagree, a glyph slides off its face — and no amount of
  // matching an expected matrix would catch it, because both sides could be wrong together.
  //
  // The world equivalent of a local art point (u, v), in units (u and v are px, so /16):
  //   left  face at y = Y:   (x0 + u/16, Y,          zt - v/16)
  //   right face at x = X:   (X,         y1 - u/16,  zt - v/16)
  //   top   face at z = Zt:  (x0 + u/16, y0 + v/16,  Zt)
  const BOX = { cx: 0, cy: 0, w: 6, d: 6, z0: 0, h: 3 };
  const SAMPLES: readonly (readonly [number, number])[] = [
    [0, 0],
    [16, 0],
    [0, 16],
    [37.5, 11.25],
    [-9, 24],
  ];

  it("puts left-face art exactly where the projection puts the same world geometry", () => {
    const m = faceMatrix("left", faceOrigin(BOX, "left"));
    for (const [u, v] of SAMPLES) {
      const viaMatrix = applyMatrix(m, u, v);
      const viaProjection = project(-3 + u / ISO_UNIT, 3, 3 - v / ISO_UNIT);
      assertPointClose(viaMatrix, viaProjection, `left art (${u}, ${v})`);
    }
  });

  it("puts right-face art exactly where the projection puts the same world geometry", () => {
    const m = faceMatrix("right", faceOrigin(BOX, "right"));
    for (const [u, v] of SAMPLES) {
      const viaMatrix = applyMatrix(m, u, v);
      const viaProjection = project(3, 3 - u / ISO_UNIT, 3 - v / ISO_UNIT);
      assertPointClose(viaMatrix, viaProjection, `right art (${u}, ${v})`);
    }
  });

  it("puts top-face art exactly where the projection puts the same world geometry", () => {
    const m = faceMatrix("top", faceOrigin(BOX, "top"));
    for (const [u, v] of SAMPLES) {
      const viaMatrix = applyMatrix(m, u, v);
      const viaProjection = project(-3 + u / ISO_UNIT, -3 + v / ISO_UNIT, 3);
      assertPointClose(viaMatrix, viaProjection, `top art (${u}, ${v})`);
    }
  });

  it("emits a rounded matrix() string, identical on every run", () => {
    const transform = faceTransform("left", { x: 12, y: -4 });
    assert.equal(transform, "matrix(0.866 0.5 0 1 12 -4)");
    assert.equal(transform, faceTransform("left", { x: 12, y: -4 }));
    assert.equal(faceTransform("right"), "matrix(0.866 -0.5 0 1 0 0)");
    assert.equal(faceTransform("top"), "matrix(0.866 0.5 -0.866 0.5 0 0)");
  });
});

describe("iso-math — the iso-ellipse rule", () => {
  it("flattens a top-facing circle to 57.7% of its width", () => {
    const ellipse = isoEllipse("top", 40);
    assert.equal(ellipse.rx, 20);
    assertClose(ellipse.ry, 20 * 0.5773502691896257, "ry");
    assert.equal(ellipse.rotate, 0);
    assertClose(ellipse.ry / ellipse.rx, ISO_ELLIPSE_RATIO, "the rule is the ratio");
  });

  it("keeps the same flattening on the side faces, turned to meet the face", () => {
    for (const face of ["left", "right"] as const) {
      const ellipse = isoEllipse(face, 40);
      assertClose(ellipse.ry / ellipse.rx, ISO_ELLIPSE_RATIO, `${face} ratio`);
    }
    assert.equal(ISO_ELLIPSE_ROTATION.left, 60);
    assert.equal(ISO_ELLIPSE_ROTATION.right, -60);
  });

  // The angles above are asserted as literals, which is only worth anything if the literals are
  // right. They are checked here against the face matrices instead of against each other: push a
  // circle through the face transform, find the direction that stretched the most, and that is where
  // the ellipse's major axis has to point.
  function majorAxisOfCircleImage(face: IsoFace): { angleDeg: number; ratio: number } {
    const m = faceMatrix(face);
    let longest = { angleDeg: 0, radius: -1 };
    let shortest = { angleDeg: 0, radius: Number.POSITIVE_INFINITY };
    for (let step = 0; step < 3600; step += 1) {
      const t = (step / 3600) * 2 * Math.PI;
      const point = applyMatrix(m, Math.cos(t), Math.sin(t));
      const radius = Math.hypot(point.x, point.y);
      const angleDeg = (Math.atan2(point.y, point.x) * 180) / Math.PI;
      if (radius > longest.radius) longest = { angleDeg, radius };
      if (radius < shortest.radius) shortest = { angleDeg, radius };
    }
    return { angleDeg: longest.angleDeg, ratio: shortest.radius / longest.radius };
  }

  for (const face of ISO_FACES) {
    it(`agrees with what the ${face} face transform does to an actual circle`, () => {
      const measured = majorAxisOfCircleImage(face);
      assertClose(measured.ratio, ISO_ELLIPSE_RATIO, `${face} measured ratio`, 1e-5);
      // atan2 answers in (-180, 180]; an axis is only defined mod 180.
      const normalize = (deg: number): number => ((deg % 180) + 180) % 180;
      assertClose(
        normalize(measured.angleDeg),
        normalize(ISO_ELLIPSE_ROTATION[face]),
        `${face} measured major axis`,
        0.1,
      );
    });
  }

  it("puts the minor axis on the face normal — the +/-30 the spec names", () => {
    // The divergence recorded in iso-math.ts, made checkable: minor = major - 90.
    assert.equal(ISO_ELLIPSE_ROTATION.left - 90, -30);
    assert.equal(ISO_ELLIPSE_ROTATION.right + 90, 30);
  });
});

describe("iso-math — solids", () => {
  const BOX = { cx: 0, cy: 0, w: 2, d: 2, z0: 0, h: 1 };

  it("returns the three visible faces back-to-front", () => {
    const corners = isoBoxCorners(BOX);
    assert.deepEqual(Object.keys(corners), ["left", "right", "top"]);
    for (const face of ISO_FACES) assert.equal(corners[face].length, 4);
  });

  it("places a unit cube's top face on the four points the projection gives", () => {
    const cube = isoBoxCorners({ cx: 0, cy: 0, w: 1, d: 1, z0: 0, h: 1 });
    const [a, b, c, d] = cube.top;
    // Top face at z = 1, corners (-0.5,-0.5) (0.5,-0.5) (0.5,0.5) (-0.5,0.5):
    //   x = (x - y) * KX  ->  0, KX, 0, -KX     y = (x + y) * 8 - 16  ->  -24, -16, -8, -16
    assertPointClose(a as ScreenPoint, { x: 0, y: -24 }, "back corner");
    assertPointClose(b as ScreenPoint, { x: 8 * SQRT3, y: -16 }, "right corner");
    assertPointClose(c as ScreenPoint, { x: 0, y: -8 }, "front corner");
    assertPointClose(d as ScreenPoint, { x: -8 * SQRT3, y: -16 }, "left corner");
  });

  it("shares an edge between every adjacent pair of faces", () => {
    // The right face's top-left edge is the top face's front-right edge; if the two ever stop
    // agreeing, a solid opens a seam that reads as a rendering bug rather than a drawing.
    const corners = isoBoxCorners(BOX);
    const key = (p: ScreenPoint) => `${fmt(p.x)}/${fmt(p.y)}`;
    const top = new Set(corners.top.map(key));
    for (const face of ["left", "right"] as const) {
      const shared = corners[face].filter((point) => top.has(key(point)));
      assert.equal(shared.length, 2, `${face} shares an edge with the top face`);
    }
  });

  it("hands each face the corner its art hangs from", () => {
    const box = { cx: 0, cy: 0, w: 6, d: 6, z0: 0, h: 3 };
    assertPointClose(faceOrigin(box, "left"), project(-3, 3, 3), "left origin");
    assertPointClose(faceOrigin(box, "right"), project(3, 3, 3), "right origin");
    assertPointClose(faceOrigin(box, "top"), project(-3, -3, 3), "top origin");
  });

  it("measures each face in the flat pixels art may use", () => {
    const box = { cx: 0, cy: 0, w: 6, d: 4, z0: 0, h: 2 };
    assert.deepEqual(faceExtent(box, "top"), { width: 96, height: 64 });
    assert.deepEqual(faceExtent(box, "left"), { width: 96, height: 32 });
    assert.deepEqual(faceExtent(box, "right"), { width: 64, height: 32 });
  });
});

describe("iso-math — the quantized grid", () => {
  it("quantizes footprints at 4 / 6 / 8 units (D-IL2)", () => {
    assert.deepEqual(ISO_FOOTPRINT_UNITS, { s: 4, m: 6, l: 8 });
    assert.equal(footprintUnits("s"), 4);
    assert.equal(footprintUnits("m"), 6);
    assert.equal(footprintUnits("l"), 8);
    // In pixels that is 64 / 96 / 128 — every footprint a whole number of 16 px units.
    for (const size of ["s", "m", "l"] as const) {
      assert.equal((footprintUnits(size) * ISO_UNIT) % ISO_UNIT, 0);
    }
  });

  it("holds heights inside 1-4 units", () => {
    assert.equal(clampHeightUnits(0.2), 1);
    assert.equal(clampHeightUnits(2.5), 2.5);
    assert.equal(clampHeightUnits(9), 4);
  });
});

describe("iso-math — ports resolve a SIDE, never a coordinate (D-IL7)", () => {
  it("puts each side's port on that side of the footprint", () => {
    const footprint = 6;
    const height = 3;
    assert.deepEqual(portAnchor({ title: "t", side: "top" }, footprint, height), [0, 0, 3]);
    assert.deepEqual(portAnchor({ title: "b", side: "bottom" }, footprint, height), [0, 0, 0]);
    assert.deepEqual(portAnchor({ title: "l", side: "left" }, footprint, height), [0, 3, 1.5]);
    assert.deepEqual(portAnchor({ title: "r", side: "right" }, footprint, height), [3, 0, 1.5]);
  });

  it("slides a port along its own side when the registry declares an offset", () => {
    assert.deepEqual(portAnchor({ title: "bus", side: "left", offset: 2 }, 6, 3), [2, 3, 1.5]);
    // `right` runs along -y, which is rightward as viewed — the same direction its face art runs.
    assert.deepEqual(portAnchor({ title: "bus", side: "right", offset: 2 }, 6, 3), [3, -2, 1.5]);
  });

  it("scales with the footprint rather than with a hardcoded box", () => {
    const small = portAnchor({ title: "l", side: "left" }, footprintUnits("s"), 2);
    const large = portAnchor({ title: "l", side: "left" }, footprintUnits("l"), 2);
    assert.equal(small[1], 2);
    assert.equal(large[1], 4);
  });
});

describe("iso-math — gaze (D-IL17)", () => {
  it("defaults a face to the LEFT (+y) side, meeting the incoming flow", () => {
    assert.equal(facingFace("upstream"), "left");
    assert.equal(facingFace("downstream"), "right");
  });
});

describe("iso-math — leader lines elbow only on the iso axes (D-IL16)", () => {
  const ALLOWED = new Set(ISO_LEADER_ANGLES_DEG.map((deg) => fmt(deg, 1)));

  function segmentAngles(points: readonly ScreenPoint[]): string[] {
    const angles: string[] = [];
    for (let i = 1; i < points.length; i += 1) {
      const from = points[i - 1] as ScreenPoint;
      const to = points[i] as ScreenPoint;
      const deg = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
      angles.push(fmt(((deg % 180) + 180) % 180, 1));
    }
    return angles;
  }

  it("only ever travels at 30, 90 or 150 degrees", () => {
    assert.deepEqual([...ISO_LEADER_ANGLES_DEG], [30, 90, 150]);
    const cases: readonly (readonly [ScreenPoint, ScreenPoint])[] = [
      [
        { x: 0, y: 0 },
        { x: 120, y: 90 },
      ],
      [
        { x: 0, y: 0 },
        { x: -120, y: 90 },
      ],
      [
        { x: 40, y: 60 },
        { x: -10, y: -30 },
      ],
      [
        { x: -80, y: 12 },
        { x: 200, y: 12 },
      ],
    ];
    for (const [from, to] of cases) {
      for (const angle of segmentAngles(isoLeaderPoints(from, to))) {
        assert.ok(ALLOWED.has(angle), `a leader ran at ${angle} degrees, which is not an iso axis`);
      }
    }
  });

  it("lands exactly on the target, with at most one elbow", () => {
    const points = isoLeaderPoints({ x: 0, y: 0 }, { x: 120, y: 90 });
    assert.ok(points.length <= 3);
    const last = points[points.length - 1] as ScreenPoint;
    assertPointClose(last, { x: 120, y: 90 }, "the leader ends on its target");
    // The bend sits where the 30-degree run has fallen 120 * tan 30 = 69.282... px.
    const bend = points[1] as ScreenPoint;
    assertPointClose(bend, { x: 120, y: 120 * ISO_TAN30 }, "the bend");
  });

  it("collapses to a single segment when one is already enough", () => {
    // A target that the 30-degree run reaches on its own needs no vertical leg at all.
    assert.equal(isoLeaderPoints({ x: 0, y: 0 }, { x: 100, y: 100 * ISO_TAN30 }).length, 2);
    assert.equal(isoLeaderPoints({ x: 5, y: 0 }, { x: 5, y: 90 }).length, 2);
  });
});

describe("iso-math — deterministic output", () => {
  it("rounds to three decimals and normalizes negative zero", () => {
    assert.equal(fmt(13.856406460551018), "13.856");
    assert.equal(fmt(-0), "0");
    assert.equal(fmt(-0.0001), "0");
    assert.equal(fmt(2), "2");
    assert.equal(fmt(0.86602540378, 4), "0.866");
  });

  it("emits the same string for the same points, every time", () => {
    const points = [project(0, 0, 0), project(1, 0, 0), project(1, 1, 0)];
    assert.equal(polygonPoints(points), "0,0 13.856,8 0,16");
    assert.equal(polygonPoints(points), polygonPoints(points));
  });
});
