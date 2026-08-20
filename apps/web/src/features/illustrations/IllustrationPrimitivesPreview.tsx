import { Card, CardContent, Heading, Text } from "@elabs-ai/components-ui";
import {
  ILLUSTRATION_LAYERS,
  ISO_UNIT,
  PRIMITIVE_SHEET_SIZE,
  PrimitivesSheet,
  useFaceSeparation,
} from "@mcp-token-footprint/illustrations";
import { useTheme } from "@elabs-ai/components-tokens";
import { PageShell } from "../../components/PageShell";
import { ViewToolbar } from "../../components/ViewToolbar";

/**
 * The WP 0.2 primitives preview — every part of the illustration drawing vocabulary on one sheet, in
 * whichever theme the app is currently wearing.
 *
 * NOT A ROUTE, deliberately. `/illustrations` and its `ASSISTANT_ROUTE_MANIFEST` entry are WP 0.3's
 * deliverable, and a `<Route path="…">` without a manifest entry turns the `assistant-route-operability`
 * gate red (`.claude/rules/assistant-operability.md`). This is the component that route will mount;
 * until then it is reachable by rendering it directly, and by the standalone HTML the package's
 * `pnpm --filter @mcp-token-footprint/illustrations preview:shots` writes to `.artifacts/` — which
 * renders THIS SAME `PrimitivesSheet` against the real theme stylesheets, so a screenshot taken there
 * and the app show the same drawing.
 *
 * WP 0.3 replaces it with the real gallery, driven by the registry rather than by a hand-written
 * list of tiles.
 *
 * The chrome around the sheet is `@elabs-ai/components-*`, per `.claude/rules/brand-ui-only.md`. The
 * sheet itself is CONTENT GRAPHICS (D-IL14) — inline SVG, no UI controls inside it.
 */
export function IllustrationPrimitivesPreview() {
  const { theme } = useTheme();
  // Dev-mode only, and a no-op in a production build: measures what the browser actually painted the
  // three faces and warns if two adjacent ones fall under D-IL15's 20% separation floor.
  const separation = useFaceSeparation(theme);

  return (
    <PageShell
      width="full"
      headerVariant="toolbar"
      header={
        <ViewToolbar
          info="Every primitive WP 0.2 ships, drawn once each. Colours are not chosen here: each fill and stroke is an --illus-* token bound to the live theme by one mapping file, so switching the theme repaints the whole sheet."
          left={
            <Heading level={2} size="title">
              Illustration primitives
            </Heading>
          }
        />
      }
    >
      <div className="flex flex-col gap-4 pb-6">
        <Card>
          <CardContent className="flex flex-wrap gap-x-8 gap-y-2 py-4">
            <PreviewFact label="Projection" value="true isometric, 30°" />
            <PreviewFact label="Unit grid" value={`1 unit = ${ISO_UNIT} px`} />
            <PreviewFact label="Footprints" value="S 4×4 · M 6×6 · L 8×8" />
            <PreviewFact label="Layers" value={ILLUSTRATION_LAYERS.join(" → ")} />
            <PreviewFact
              label="Face separation"
              value={
                separation
                  ? separation.pairs
                      .map((pair) => `${(pair.separation * 100).toFixed(0)}%`)
                      .join(" · ")
                  : "not measurable here"
              }
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="overflow-x-auto py-4">
            <div style={{ minWidth: PRIMITIVE_SHEET_SIZE.width }}>
              <PrimitivesSheet subtitle={`${theme} theme`} />
            </div>
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}

function PreviewFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <Text variant="body" className="tabular-nums">
        {value}
      </Text>
    </div>
  );
}

export default IllustrationPrimitivesPreview;
