import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { attributeValues, paintValues, render } from "../test-support.js";
import { EntityRoot, entityPortAnchors } from "./EntityRoot.js";
import type { EntityMeta } from "./EntityRoot.js";
import { GlyphFrame } from "./GlyphFrame.js";
import { IsoHousing } from "./IsoHousing.js";
import { IsoPlatform } from "./IsoPlatform.js";
import { StationHeader } from "./StationHeader.js";

const META: EntityMeta = {
  id: "test-subject",
  title: "Test subject",
  description: "A stand-in used to exercise the entity wrapper.",
  ports: {
    top: { title: "Top", side: "top" },
    bottom: { title: "Bottom", side: "bottom" },
    "context-in": { title: "Context in", side: "left" },
    "result-out": { title: "Result out", side: "right" },
  },
};

const BODY = { cx: 0, cy: 0, w: 3, d: 3, z0: 1.2, h: 1.8 } as const;

function subject(props: Record<string, unknown> = {}): string {
  return render(
    <svg aria-hidden="true">
      <EntityRoot meta={META} idPrefix="illus-fixture" {...props}>
        <IsoPlatform tiers={2} />
        <IsoHousing width={BODY.w} depth={BODY.d} height={BODY.h} z0={BODY.z0} />
        <GlyphFrame face="gaze" box={BODY}>
          <circle cx={12} cy={12} r={3} style={{ fill: "var(--illus-ink)" }} />
        </GlyphFrame>
      </EntityRoot>
    </svg>,
  );
}

describe("EntityRoot — accessibility (D-IL12)", () => {
  it("is an image with a title and a description, wired by id", () => {
    const markup = subject();
    assert.ok(markup.includes('role="img"'));
    assert.ok(markup.includes('aria-labelledby="illus-fixture-title illus-fixture-desc"'));
    assert.ok(markup.includes('<title id="illus-fixture-title">Test subject</title>'));
    assert.ok(
      markup.includes(
        '<desc id="illus-fixture-desc">A stand-in used to exercise the entity wrapper.</desc>',
      ),
    );
  });

  it("prefers the caller's label over the registry title, when there is one", () => {
    const markup = subject({ label: "Primary LLM" });
    assert.ok(markup.includes(">Primary LLM</title>"));
    // ...and the description is still the registry's, because a label is not a description.
    assert.ok(markup.includes("A stand-in used to exercise the entity wrapper."));
  });

  it("generates its own ids when none is given, without colliding", () => {
    const markup = render(
      <svg aria-hidden="true">
        <EntityRoot meta={META}>
          <IsoPlatform tiers={1} />
        </EntityRoot>
        <EntityRoot meta={META}>
          <IsoPlatform tiers={1} />
        </EntityRoot>
      </svg>,
    );
    const ids = attributeValues(markup, "id");
    assert.equal(ids.length, 4, "two entities, each with a title and a desc");
    assert.equal(new Set(ids).size, 4, "and no two share an id");
    for (const id of ids) assert.match(id, /^[A-Za-z0-9-]+$/, "ids stay attribute-safe");
  });
});

describe("EntityRoot — the five states (D-IL8)", () => {
  const MARK: Record<string, string | null> = {
    idle: null,
    active: "active-glow",
    highlight: "highlight-spot",
    error: "error-ring",
    dimmed: null,
  };

  for (const [state, mark] of Object.entries(MARK)) {
    it(`applies ${state}`, () => {
      const markup = subject({ state });
      assert.ok(markup.includes(`data-illus-state="${state}"`));
      if (mark) assert.ok(markup.includes(`data-illus-mark="${mark}"`), `${state} mark`);
    });
  }

  it("dims the whole entity, and only when dimmed", () => {
    assert.ok(subject({ state: "dimmed" }).includes('opacity="0.32"'));
    for (const state of ["idle", "active", "highlight", "error"]) {
      assert.equal(subject({ state }).includes('opacity="0.32"'), false, state);
    }
  });

  it("renders five visibly different drawings — no two states are the same picture", () => {
    const drawings = ["idle", "active", "highlight", "dimmed", "error"].map((state) =>
      subject({ state }),
    );
    assert.equal(new Set(drawings).size, 5);
  });

  it("keeps the ground shadow in every state, so nothing floats", () => {
    for (const state of ["idle", "active", "highlight", "dimmed", "error"]) {
      assert.ok(subject({ state }).includes('data-illus-mark="ground-shadow"'), state);
    }
  });
});

describe("EntityRoot — layers (D-IL16)", () => {
  it("paints shadows, then structure, then detail, whatever order the entity was written in", () => {
    const markup = render(
      <svg aria-hidden="true">
        <EntityRoot meta={META} idPrefix="illus-order" state="highlight">
          <StationHeader at={{ x: 0, y: 0 }} title="written first, painted last" />
          <GlyphFrame face="top" box={BODY}>
            <circle r={2} />
          </GlyphFrame>
          <IsoPlatform tiers={1} />
        </EntityRoot>
      </svg>,
    );
    assert.deepEqual(attributeValues(markup, "data-illus-layer"), [
      "shadows",
      "structure",
      "detail",
      "labels",
    ]);
  });

  it("puts the port overlay in annotations and the label in labels", () => {
    const markup = subject({ showPorts: true, label: "Subject" });
    assert.deepEqual(attributeValues(markup, "data-illus-layer"), [
      "shadows",
      "structure",
      "detail",
      "annotations",
      "labels",
    ]);
  });
});

describe("EntityRoot — ports resolve from the registry, never from the DOM (D-IL7)", () => {
  it("draws a dot and a name for every declared port, only when asked", () => {
    assert.equal(subject().includes("data-illus-port"), false);
    const markup = subject({ showPorts: true });
    assert.deepEqual(attributeValues(markup, "data-illus-port"), [
      "top",
      "bottom",
      "context-in",
      "result-out",
    ]);
  });

  it("resolves anchors from the footprint, so a bigger entity has wider ports", () => {
    const small = entityPortAnchors(META.ports, "s", 3);
    const large = entityPortAnchors(META.ports, "l", 3);
    assert.equal(small["context-in"]?.[1], 2);
    assert.equal(large["context-in"]?.[1], 4);
    assert.deepEqual(small.top, [0, 0, 3]);
  });
});

describe("EntityRoot — gaze (D-IL17)", () => {
  it("defaults to upstream, mounting the face panel on the LEFT face", () => {
    const markup = subject();
    assert.ok(markup.includes('data-illus-facing="upstream"'));
    assert.ok(markup.includes('data-illus-glyph-face="left"'));
  });

  it("mirrors to the right face when the entity faces downstream", () => {
    const markup = subject({ facing: "downstream" });
    assert.ok(markup.includes('data-illus-facing="downstream"'));
    assert.ok(markup.includes('data-illus-glyph-face="right"'));
    assert.equal(markup.includes('data-illus-glyph-face="left"'), false);
  });

  it("hands the frame down through context, not through props", () => {
    // The GlyphFrame in the fixture is never given `facing`; it reads it from the wrapper.
    assert.ok(subject({ facing: "downstream", size: "l" }).includes('data-illus-size="l"'));
  });
});

describe("EntityRoot — determinism and tokens", () => {
  it("renders the same bytes for the same props", () => {
    assert.equal(
      subject({ state: "active", label: "x" }),
      subject({ state: "active", label: "x" }),
    );
  });

  it("paints nothing that is not an --illus-* token", () => {
    for (const state of ["idle", "active", "highlight", "dimmed", "error"]) {
      for (const value of paintValues(subject({ state, showPorts: true, label: "L" }))) {
        assert.ok(
          value === "none" || value.startsWith("var(--illus-"),
          `${state} painted ${value}`,
        );
      }
    }
  });
});
