// ==================================================================================================
// <IllustrationScene> — a validated spec becomes a picture (WP 2.3, D-IL10/D-IL16)
// ==================================================================================================
// Twenty-four components existed and nothing composed them; two pure-geometry layers existed and
// nothing painted them. This file is the join, and it is deliberately the THINNEST thing that can
// be: it validates, lays out, routes, and paints — and it computes NO GEOMETRY OF ITS OWN. Every
// number it draws with came out of `layoutScene` or `routeScene`, which is the seam WPs 2.1 and 2.2
// were built to create; widening it here would put a third, quietly different answer in the package.
//
// The two exceptions are named where they occur and are both PAINTING, not layout: the arrowhead's
// tail trim (`connectorLineEnd`, the primitive's own cut, applied to the router's own points) and a
// small set of text offsets — a baseline shift, a heading inset — of exactly the kind `EntityRoot`
// already applies to its own caption. Neither decides where anything is PLACED.
//
// ── THE PAINT ORDER IS THE LAYER'S, NEVER AN OBJECT'S (D-IL16) ────────────────────────────────────
// Everything goes through `<Layer>` + `renderLayers`, so the emitted groups are
// `stage → shadows → structure → detail → connectors → annotations → labels` regardless of the
// order this file happens to write its JSX in. A scene author cannot lift one node above another,
// and that is the point.
//
// ── HONESTY: THREE THINGS THAT ARE NEVER SWALLOWED ────────────────────────────────────────────────
//   • a connector the router could not honour with its four shapes (`doublesBack`) is DRAWN — the
//     best-effort path, never a different one invented to look right — and reported;
//   • a connector whose endpoints the layout could not resolve has no geometry, so it cannot be
//     drawn; it is reported instead of vanishing;
//   • a caption that no candidate placement could clear (`collides`) is rendered where it landed and
//     counted.
// All three ride the rendered markup as `data-illus-*` attributes AND the one dev warning channel,
// so neither a reader of the picture nor a reader of the console has to be told twice.
//
// ── NO BRAND-UI, NO COLOUR LITERAL, NO NEW DEPENDENCY ─────────────────────────────────────────────
// Illustrations are content graphics, not UI controls (D-IL14): this package's only imports are
// `react` (peer) and `@mcp-token-footprint/shared`, and every paint value is an `--illus-*` token
// (D-IL5), enforced by the package-wide recursive scan in `tokens.test.ts`.

import type {
  IllustrationConnectorKind,
  IllustrationRegistryEntry,
  IllustrationSceneAnnotation,
  IllustrationSceneNode,
  IllustrationSceneSpec,
  IllustrationState,
} from "@mcp-token-footprint/shared";
import type { ReactElement } from "react";
import { ISO_UNIT, fmt, polygonPoints } from "../iso-math.js";
import { Layer, renderLayers } from "../layers.js";
import { ILLUS_DASH, ILLUS_STROKE_DETAIL, ILLUS_TEXT } from "../line-system.js";
import {
  CONNECTOR_ARROW_FILL,
  CONNECTOR_ARROW_TRIM,
  CONNECTOR_LABEL_KNOCKOUT,
  CONNECTOR_STYLE,
  arrowHeadPoints,
  connectorLineEnd,
} from "../primitives/Connector.js";
import { PaperStage } from "../primitives/PaperStage.js";
import { StationHeader } from "../primitives/StationHeader.js";
import { findIllustrationComponent } from "../registry.js";
import { SceneAnnotationCard } from "./annotations.js";
import {
  ILLUSTRATION_SCENE_CATALOG,
  ILLUSTRATION_SCENE_REGISTRY,
  type SceneCatalog,
} from "./catalog.js";
import { type SceneLayout, type ScenePoint, layoutScene, roundScene } from "./layout.js";
import {
  CONNECTOR_CORNER_UNITS,
  type RoutedConnector,
  type RoutedLabel,
  type SceneRouting,
  connectorPathData,
  routeScene,
} from "./route.js";
import { type SceneIssue, splitEndpoint, validateScene } from "./spec-validate.js";

// -- Painting dials --------------------------------------------------------------------------------
// Text offsets only. Nothing here decides where an entity, a card or a line GOES; those numbers all
// arrive from the layout and the router.

/**
 * How far below a routed label's anchor its baseline sits, so the anchor is the caption's optical
 * CENTRE rather than its baseline. Roughly a third of the cap height, the usual centring shift.
 */
export const LABEL_BASELINE_SHIFT = ILLUS_TEXT.caption * 0.35;

/** Where a station's heading sits inside its node's own laid-out frame, in px from the top-left. */
export const STATION_HEADER_INSET = 14;
export const STATION_HEADER_DROP = 16;

/**
 * How far ABOVE its band's laid-out frame a band title's baseline sits, in px. Above rather than
 * inside, because a band's frame starts where its tallest station's box starts — a title placed
 * inside it would land on that station's own heading. `BAND_GAP_UNITS` (4 units = 64 px) and the
 * canvas margin both leave more room than this takes.
 */
export const BAND_TITLE_RISE = 10;

// -- The accent budget (D-IL6) ---------------------------------------------------------------------

/**
 * The share of a scene D-IL6 allows the hero accent: "~2-6% of any scene, roughly one accent moment
 * per station."
 *
 * ⚠️ **MEASURED, AND IT DOES NOT FIT THE PROXY THIS WP SPECIFIES.** WP 2.3 §"The dev-only
 * accent-ratio warning" defines the measure as a PART COUNT — "accent-carrying nodes, connectors and
 * annotations against the total" — and that is what {@link sceneAccentBudget} computes, literally.
 * But a ratio of counts cannot land inside [0.02, 0.06] at all unless the scene has at least 17
 * parts: with n parts the reachable values are 0, 1/n, 2/n …, and 1/16 = 6.25% already overshoots
 * while 0 undershoots. Measured on the three fixtures this package ships — `self-learning-loop`
 * 4/14 = 28.6%, `run-turn-cycle` 4/19 = 21.1%, `crowded-labels` 3/10 = 30.0% — all three warn on
 * every render, and the first and third could not have passed at any content. The band is an
 * INK-AREA budget; the proxy is a count. They are not the same quantity, and the WP's own numbers
 * cannot be met by its own measure.
 *
 * It is implemented as written rather than quietly re-scaled, because changing a locked decision's
 * numbers is not a builder's call. The finding is reported instead. See the work package's report.
 */
export const ILLUS_ACCENT_BAND = { min: 0.02, max: 0.06 } as const;

/**
 * The node states that add an accent mark. `EntityRoot` paints the `active` glow and the `highlight`
 * spot in `--illus-accent` for EVERY entity, in one place (`EntityRoot.tsx`, `stateAffordance`), so
 * this is a fact about the state set rather than about any one component.
 *
 * What it deliberately cannot see: an entity's OWN accent moment — most of the twenty-four light one
 * small mark even at `idle` — because that is inside the component, and a spec-level count has no
 * way to ask. D-IL6's "roughly one accent moment per station" is exactly that mark, spent as
 * designed; counting it here would make every scene 100% accented.
 */
export const ACCENT_NODE_STATES: readonly IllustrationState[] = ["active", "highlight"];

/** Whether a connector kind strokes an accent token, read from the ONE style table (D-IL8). */
export function isAccentConnectorKind(kind: IllustrationConnectorKind): boolean {
  return CONNECTOR_STYLE[kind].stroke.startsWith("var(--illus-accent");
}

export type SceneAccentBudget = {
  readonly accentParts: number;
  readonly totalParts: number;
  /** `accentParts / totalParts`, or 0 for a scene with no parts at all. */
  readonly ratio: number;
  readonly withinBand: boolean;
};

/**
 * The accented share of a scene's declared parts. Pure, exported and unit-tested so the measurement
 * above is reproducible rather than asserted.
 *
 * Annotations contribute 0 accent parts BY CONSTRUCTION: `PrincipleCard`'s accent is opt-in, and the
 * scene schema has no field that could opt in — there is no way for an authored scene to ask for it.
 */
export function sceneAccentBudget(spec: IllustrationSceneSpec): SceneAccentBudget {
  const nodes = spec.nodes ?? [];
  const connectors = spec.connectors ?? [];
  const annotations = spec.annotations ?? [];
  const accentParts =
    nodes.filter((node) => node.state !== undefined && ACCENT_NODE_STATES.includes(node.state))
      .length + connectors.filter((connector) => isAccentConnectorKind(connector.kind)).length;
  const totalParts = nodes.length + connectors.length + annotations.length;
  const ratio = totalParts === 0 ? 0 : accentParts / totalParts;
  return {
    accentParts,
    totalParts,
    ratio,
    withinBand: ratio >= ILLUS_ACCENT_BAND.min && ratio <= ILLUS_ACCENT_BAND.max,
  };
}

// -- The one report channel ------------------------------------------------------------------------

export type SceneRenderReport = {
  readonly sceneId: string;
  /** Connector identities the router could not honour with its four shapes. Drawn anyway. */
  readonly doublesBack: readonly string[];
  /** Connectors with no geometry at all — reported, because they cannot be drawn. */
  readonly unresolved: readonly string[];
  /**
   * The endpoint KEYS the layout could not resolve, deduplicated in first-seen order.
   *
   * Deliberately not the connectors' `from` fields: when it is the TARGET that is missing, naming
   * the source would point a reader at an endpoint that resolved perfectly well. What could not be
   * resolved is the only honest thing to name.
   */
  readonly unresolvedEndpoints: readonly string[];
  /** Captions sitting on a node box because no candidate placement cleared one. */
  readonly collidingLabels: readonly string[];
  /** Nodes whose component this build cannot draw. */
  readonly missingComponents: readonly string[];
  readonly accent: SceneAccentBudget;
};

export function sceneRenderReport(
  spec: IllustrationSceneSpec,
  layout: SceneLayout,
  routing: SceneRouting,
): SceneRenderReport {
  return {
    sceneId: spec.id,
    doublesBack: routing.routes.filter((route) => route.doublesBack).map((route) => route.identity),
    unresolved: routing.unresolved.map(
      (entry) => `${entry.from} → ${entry.to} (missing: ${entry.missing.join(", ")})`,
    ),
    unresolvedEndpoints: [...new Set(routing.unresolved.flatMap((entry) => entry.missing))],
    collidingLabels: routing.routes
      .filter((route) => route.label?.collides === true)
      .map((route) => route.identity),
    missingComponents: layout.nodes
      .filter((node) => findIllustrationComponent(node.component) === undefined)
      .map((node) => `${node.id} (${node.component})`),
    accent: sceneAccentBudget(spec),
  };
}

/**
 * ONE warning path, so an author has one place to look — the routing honesty flags and the accent
 * budget arrive together rather than as two unrelated console habits.
 *
 * Dev only, never in a production bundle: `process.env.NODE_ENV` is what Vite substitutes at build
 * time, so the whole body is dead code there. It never throws (the body is wrapped), never blocks a
 * render, and contributes nothing to the markup.
 */
export function warnAboutScene(report: SceneRenderReport): void {
  try {
    if (process.env.NODE_ENV === "production") return;
    const lines: string[] = [];
    if (report.unresolved.length > 0) {
      lines.push(
        `${report.unresolved.length} connector(s) have no geometry and were NOT drawn: ` +
          report.unresolved.join("; "),
      );
    }
    if (report.doublesBack.length > 0) {
      lines.push(
        `${report.doublesBack.length} connector(s) double back — the four route shapes cannot ` +
          `honour those ports, so a best-effort path is drawn: ${report.doublesBack.join(", ")}`,
      );
    }
    if (report.collidingLabels.length > 0) {
      lines.push(
        `${report.collidingLabels.length} caption(s) sit on a node box — no candidate placement ` +
          `cleared every frame: ${report.collidingLabels.join(", ")}`,
      );
    }
    if (report.missingComponents.length > 0) {
      lines.push(`this build cannot draw: ${report.missingComponents.join(", ")}`);
    }
    if (!report.accent.withinBand) {
      const { accentParts, totalParts, ratio } = report.accent;
      lines.push(
        `accent budget: ${accentParts}/${totalParts} declared parts carry the hero accent ` +
          `(${(ratio * 100).toFixed(1)}%), outside D-IL6's ` +
          `${ILLUS_ACCENT_BAND.min * 100}-${ILLUS_ACCENT_BAND.max * 100}% band. NOTE: the band is ` +
          "an ink-area budget and this is a part count; under 17 parts no scene can land inside it.",
      );
    }
    if (lines.length === 0) return;
    if (typeof console === "undefined" || typeof console.warn !== "function") return;
    console.warn(`[illustrations] scene "${report.sceneId}":\n  ${lines.join("\n  ")}`);
  } catch {
    // A diagnostic must never be able to break a drawing.
  }
}

// -- Ids -------------------------------------------------------------------------------------------

/**
 * Every id the renderer emits, derived from the scene id and the thing it names — never from a
 * counter, an index alone, or React's `useId`.
 *
 * That is what `entity-props.ts` says `idPrefix` is for, and it is what makes the same entity emit
 * the same bytes in two different trees: the export path in WP 2.4 depends on it, and an index would
 * break it the moment a spec is reordered.
 */
export function sceneElementId(sceneId: string, suffix: string): string {
  return `illus-${sceneId}-${suffix}`.replace(/[^a-zA-Z0-9_-]/g, "-");
}

// -- The renderer ----------------------------------------------------------------------------------

export type IllustrationSceneProps = {
  /**
   * The scene. Typed as a valid spec because that is the contract, and RE-VALIDATED anyway because
   * a scene usually arrives as JSON, where the type is a claim rather than a fact. An invalid one
   * renders the failure notice below rather than throwing or drawing a plausible-looking fragment.
   */
  readonly spec: IllustrationSceneSpec;
  /**
   * The component metrics the layout and the router read. Defaults to this build's catalog; a caller
   * passes another to render against a catalog that is not this build's — which is also the only way
   * to reach the "endpoint could not be resolved" path, since a spec that validates against the live
   * registry always resolves against the matching catalog.
   */
  readonly catalog?: SceneCatalog;
  /** The entries `validateScene` checks against. Defaults to this build's registry. */
  readonly registry?: readonly IllustrationRegistryEntry[];
};

export function IllustrationScene({
  spec,
  catalog = ILLUSTRATION_SCENE_CATALOG,
  registry = ILLUSTRATION_SCENE_REGISTRY,
}: IllustrationSceneProps): ReactElement {
  const issues = validateScene(spec, registry);
  if (issues.length > 0) return <SceneFailureNotice spec={spec} issues={issues} />;

  const layout = layoutScene(spec, { catalog });
  const routing = routeScene(layout, spec.connectors ?? [], { catalog });
  const report = sceneRenderReport(spec, layout, routing);
  warnAboutScene(report);

  const base = sceneElementId(spec.id, "scene");
  const titleId = `${base}-title`;
  const descId = `${base}-desc`;
  const nodesById = new Map<string, IllustrationSceneNode>();
  for (const node of spec.nodes) if (!nodesById.has(node.id)) nodesById.set(node.id, node);

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      viewBox={layout.canvas.viewBox}
      aria-labelledby={titleId}
      aria-describedby={descId}
      data-illus-scene={spec.id}
      data-illus-stage={layout.canvas.stage}
      data-illus-format={layout.canvas.format}
      // The three honesty flags survive into the artifact, not just into a console nobody kept.
      data-illus-doubles-back={joinOrUndefined(report.doublesBack)}
      data-illus-unresolved={joinOrUndefined(report.unresolvedEndpoints)}
      data-illus-label-collisions={joinOrUndefined(report.collidingLabels)}
    >
      <title id={titleId}>{spec.title}</title>
      <desc id={descId}>{spec.summary}</desc>
      {renderLayers([
        <Layer key="scene-stage" name="stage">
          <PaperStage
            x={layout.canvas.x}
            y={layout.canvas.y}
            width={layout.canvas.width}
            height={layout.canvas.height}
            grid={layout.canvas.stage === "paper"}
            idPrefix={base}
          />
        </Layer>,
        <Layer key="scene-structure" name="structure">
          {layout.nodes.map((node) => {
            const Component = findIllustrationComponent(node.component);
            if (Component === undefined) return null;
            return (
              <g
                key={node.id}
                data-illus-node={node.id}
                transform={`translate(${fmt(node.origin.x)} ${fmt(node.origin.y)})`}
              >
                <Component
                  size={node.size}
                  state={node.state}
                  facing={node.facing}
                  detail={node.detail}
                  variant={node.variant ?? undefined}
                  label={nodesById.get(node.id)?.caption}
                  idPrefix={sceneElementId(spec.id, `node-${node.id}`)}
                />
              </g>
            );
          })}
        </Layer>,
        <Layer key="scene-connectors" name="connectors">
          {routing.routes.map((route) => (
            <SceneConnector key={`${route.index}-${route.identity}`} route={route} />
          ))}
        </Layer>,
        <Layer key="scene-annotations" name="annotations">
          {layout.annotations.map((placement) => {
            const annotation = (spec.annotations ?? [])[placement.index];
            if (annotation === undefined) return null;
            return (
              <SceneAnnotationCard
                key={placement.index}
                annotation={annotation}
                layout={placement}
                anchor={resolveAnnotationTarget(annotation, layout)}
              />
            );
          })}
        </Layer>,
        <Layer key="scene-labels" name="labels">
          {layout.bands.map((band) =>
            band.title === null ? null : (
              <StationHeader
                key={`band-${band.id}`}
                at={{ x: band.frame.x, y: band.frame.y - BAND_TITLE_RISE }}
                title={band.title}
              />
            ),
          )}
          {layout.nodes.map((node) => {
            const declared = nodesById.get(node.id);
            if (declared?.title === undefined) return null;
            return (
              <StationHeader
                key={`node-${node.id}`}
                at={{
                  x: node.frame.x + STATION_HEADER_INSET,
                  y: node.frame.y + STATION_HEADER_DROP,
                }}
                seq={declared.seq}
                title={declared.title}
              />
            );
          })}
          {routing.routes.map((route) =>
            route.label === null ? null : (
              <SceneConnectorLabel
                key={`label-${route.index}-${route.identity}`}
                label={route.label}
              />
            ),
          )}
        </Layer>,
      ])}
    </svg>
  );
}

function joinOrUndefined(values: readonly string[]): string | undefined {
  return values.length === 0 ? undefined : values.join(" ");
}

/**
 * Where a `callout`'s leader points, resolved from the LAYOUT'S own numbers: a `nodeId.port` is an
 * entry in `layout.endpoints`, a bare `nodeId` is that node's `origin` — the ground point it stands
 * on. Neither is derived; both are points the layout emitted.
 */
function resolveAnnotationTarget(
  annotation: IllustrationSceneAnnotation,
  layout: SceneLayout,
): ScenePoint | null {
  const target = annotation.target;
  if (target === undefined) return null;
  if (splitEndpoint(target) !== undefined) return layout.endpoints[target] ?? null;
  return layout.nodes.find((node) => node.id === target)?.origin ?? null;
}

// -- Connectors ------------------------------------------------------------------------------------

function SceneConnector({ route }: { readonly route: RoutedConnector }): ReactElement {
  const style = CONNECTOR_STYLE[route.kind];
  const arrow = style.arrow;
  const tip = route.points[route.points.length - 1];
  const previous = route.points[route.points.length - 2];

  // The head is placed on the router's own last two points; the line is then cut back to the
  // primitive's own trim so its stroke cannot poke past the head's narrowing sides. That cut is the
  // one piece of arithmetic this file does, it is PAINTING, and it reuses both the primitive's
  // constant and the router's own path builder rather than inventing either.
  const head =
    arrow === "none" || tip === undefined || previous === undefined
      ? null
      : arrowHeadPoints(tip, previous);
  const d =
    head === null || tip === undefined || previous === undefined
      ? route.d
      : connectorPathData(
          [
            ...route.points.slice(0, -1),
            roundPoint(connectorLineEnd(tip, previous, CONNECTOR_ARROW_TRIM)),
          ],
          CONNECTOR_CORNER_UNITS * ISO_UNIT,
        );

  return (
    <g
      data-illus-connector={route.kind}
      data-illus-connector-shape={route.shape}
      data-illus-doubles-back={route.doublesBack ? "true" : undefined}
    >
      <path
        d={d}
        fill="none"
        strokeWidth={style.width}
        strokeLinejoin="round"
        strokeLinecap={style.round ? "round" : "butt"}
        strokeDasharray={style.dash}
        style={{ stroke: style.stroke }}
      />
      {head !== null && arrow !== "none" ? (
        <polygon points={polygonPoints(head)} style={{ fill: CONNECTOR_ARROW_FILL[arrow] }} />
      ) : null}
    </g>
  );
}

function roundPoint(point: ScenePoint): ScenePoint {
  return { x: roundScene(point.x), y: roundScene(point.y) };
}

/**
 * A caption at the ROUTER'S anchor, screen-aligned and knocked out of the line behind it (D-IL2 —
 * text is never skewed onto an iso face). It lives in the `labels` layer, above the connectors, so a
 * line drawn later cannot cross a caption drawn earlier.
 */
function SceneConnectorLabel({ label }: { readonly label: RoutedLabel }): ReactElement {
  return (
    <text
      data-illus-label="connector"
      data-illus-label-collides={label.collides ? "true" : undefined}
      x={fmt(label.anchor.x)}
      y={fmt(label.anchor.y + LABEL_BASELINE_SHIFT)}
      fontSize={ILLUS_TEXT.caption}
      textAnchor="middle"
      paintOrder="stroke"
      strokeWidth={CONNECTOR_LABEL_KNOCKOUT}
      strokeLinejoin="round"
      style={{ fill: "var(--illus-ink)", stroke: "var(--illus-paper)" }}
    >
      {label.text}
    </text>
  );
}

// -- The failure notice ----------------------------------------------------------------------------
// A scene that cannot be drawn must SAY SO, visibly and accessibly. Not a blank canvas — which reads
// as "nothing to show" — not a throw, and above all not a partial drawing that looks complete.

const NOTICE_WIDTH = 720;
const NOTICE_PADDING = 24;
/** Baselines, measured down from the top edge, so the rhythm is one place rather than four sums. */
const NOTICE_HEADING_BASELINE = NOTICE_PADDING + 15;
const NOTICE_SUMMARY_BASELINE = NOTICE_HEADING_BASELINE + 22;
const NOTICE_FIRST_ISSUE_BASELINE = NOTICE_SUMMARY_BASELINE + 26;
const NOTICE_LINE_HEIGHT = 18;
/** How many issues are printed before the rest are summarized. A long list is still a picture. */
const NOTICE_MAX_ISSUES = 12;

export function SceneFailureNotice({
  spec,
  issues,
}: {
  readonly spec: IllustrationSceneSpec;
  readonly issues: readonly SceneIssue[];
}): ReactElement {
  // The spec is invalid, so nothing on it may be assumed — including its id.
  const rawId = (spec as { id?: unknown } | null | undefined)?.id;
  const base = sceneElementId(
    typeof rawId === "string" && rawId !== "" ? rawId : "unnamed",
    "invalid",
  );
  const titleId = `${base}-title`;
  const descId = `${base}-desc`;

  const shown = issues.slice(0, NOTICE_MAX_ISSUES);
  const remaining = issues.length - shown.length;
  const lines = shown.length + (remaining > 0 ? 1 : 0);
  const height = NOTICE_FIRST_ISSUE_BASELINE + (lines - 1) * NOTICE_LINE_HEIGHT + NOTICE_PADDING;
  const heading = "This illustration could not be drawn";
  const summary = `${issues.length} problem${issues.length === 1 ? "" : "s"} in the scene spec`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      viewBox={`0 0 ${NOTICE_WIDTH} ${roundScene(height)}`}
      aria-labelledby={titleId}
      aria-describedby={descId}
      data-illus-scene-invalid="true"
      data-illus-issue-count={issues.length}
    >
      <title id={titleId}>{heading}</title>
      <desc id={descId}>
        {`${summary}: ${shown.map((issue) => `${issue.path} ${issue.code}`).join("; ")}`}
      </desc>
      <rect
        x={0}
        y={0}
        width={NOTICE_WIDTH}
        height={height}
        style={{ fill: "var(--illus-paper)" }}
      />
      <rect
        x={1}
        y={1}
        width={NOTICE_WIDTH - 2}
        height={height - 2}
        rx={8}
        fill="none"
        strokeWidth={ILLUS_STROKE_DETAIL}
        strokeDasharray={ILLUS_DASH.dashed}
        style={{ stroke: "var(--illus-error)" }}
      />
      <text
        x={NOTICE_PADDING}
        y={NOTICE_HEADING_BASELINE}
        fontSize={ILLUS_TEXT.station}
        fontWeight={700}
        style={{ fill: "var(--illus-error)" }}
      >
        {heading}
      </text>
      <text
        x={NOTICE_PADDING}
        y={NOTICE_SUMMARY_BASELINE}
        fontSize={ILLUS_TEXT.caption}
        style={{ fill: "var(--illus-ink-muted)" }}
      >
        {summary}
      </text>
      {shown.map((issue, index) => (
        <text
          key={`${issue.path}-${issue.code}-${index}`}
          data-illus-issue={issue.code}
          x={NOTICE_PADDING}
          y={NOTICE_FIRST_ISSUE_BASELINE + index * NOTICE_LINE_HEIGHT}
          fontSize={ILLUS_TEXT.caption}
          style={{ fill: "var(--illus-ink)" }}
        >
          {noticeLine(issue)}
        </text>
      ))}
      {remaining > 0 ? (
        <text
          x={NOTICE_PADDING}
          y={NOTICE_FIRST_ISSUE_BASELINE + shown.length * NOTICE_LINE_HEIGHT}
          fontSize={ILLUS_TEXT.caption}
          style={{ fill: "var(--illus-ink-muted)" }}
        >
          {`+ ${remaining} more`}
        </text>
      ) : null}
    </svg>
  );
}

/**
 * One issue as one line, truncated by CHARACTER COUNT — the same discipline the router's label boxes
 * keep, and for the same reason: there is no DOM here to measure with, and a notice that wrapped
 * differently in two environments would not be deterministic.
 */
const NOTICE_MAX_CHARS = 96;

function noticeLine(issue: SceneIssue): string {
  const text = `${issue.path === "" ? "(scene)" : issue.path} — ${issue.message}`;
  return text.length <= NOTICE_MAX_CHARS ? text : `${text.slice(0, NOTICE_MAX_CHARS - 1)}…`;
}
