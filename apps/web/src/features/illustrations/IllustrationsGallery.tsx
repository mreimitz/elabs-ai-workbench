import { useMemo, useState } from "react";
import {
  ILLUSTRATION_SIZES,
  type IllustrationRegistryEntry,
  type IllustrationSize,
} from "@mcp-token-footprint/shared";
import {
  ILLUSTRATION_LAYERS,
  ILLUSTRATION_REGISTRY,
  ISO_UNIT,
  PRIMITIVE_SHEET_SIZE,
  PrimitivesSheet,
  REGISTRY_VERSION,
  searchIllustrations,
  useFaceSeparation,
} from "@mcp-token-footprint/illustrations";
import { useTheme } from "@elabs-ai/components-tokens";
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Heading,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Text,
} from "@elabs-ai/components-ui";
import { SearchInput } from "@elabs-ai/components-data";
import { Shapes } from "lucide-react";
import { PageShell } from "../../components/PageShell";
import { ResultCount } from "../../components/ResultCount";
import { TabPanel, TabPanelContent } from "../../components/TabPanel";
import { ViewToolbar } from "../../components/ViewToolbar";
import { IllustrationCanvas } from "./IllustrationCanvas";
import { IllustrationDetail } from "./IllustrationDetail";

/** The width a catalog card draws its illustration at. */
const CARD_WIDTH = 232;

type GalleryTab = "components" | "primitives";

/**
 * `/illustrations` — the asset repository (RM-14 WP 0.3, system design 5.1).
 *
 * A filterable grid of every registry entry, rendered LIVE: these are the real components in the
 * theme the app is currently wearing, not exported images. That is deliberate and it is the
 * acceptance test for the whole `--illus-*` indirection layer (D-IL5) — switching the theme in
 * Settings must reskin every drawing on this page, because not one of them names a colour.
 *
 * It renders the full catalog with ZERO query params (`.claude/rules/routes-vs-dialogs.md`): a cold
 * load is the whole repository, and drilling into one component opens a dialog rather than a second
 * route. The reasoning for that split is written down on `IllustrationDetail`.
 *
 * The chrome is `@elabs-ai/components-*` throughout; only the drawings themselves are inline SVG,
 * which D-IL14 classifies as CONTENT GRAPHICS rather than UI.
 */
export function IllustrationsGallery() {
  const { theme } = useTheme();
  const [tab, setTab] = useState<GalleryTab>("components");
  const [search, setSearch] = useState("");
  const [size, setSize] = useState<IllustrationSize>("m");
  const [showPorts, setShowPorts] = useState(false);
  const [selected, setSelected] = useState<IllustrationRegistryEntry | null>(null);

  // Dev-mode only, a no-op in a production build: measures what the browser actually painted the
  // three iso faces and warns if two adjacent ones fall under D-IL15's 20% separation floor.
  const separation = useFaceSeparation(theme);

  const matches = useMemo(() => searchIllustrations(search), [search]);

  return (
    <PageShell
      width="full"
      headerVariant="toolbar"
      scroll="fill"
      header={
        <ViewToolbar
          info={
            <p className="max-w-sm text-pretty">
              Every catalogued illustration, drawn live in the current theme. No component here
              names a colour: each fill and stroke is an --illus-* token bound to the theme by one
              mapping file, so switching the theme repaints the whole page.
            </p>
          }
          left={
            tab === "components" ? (
              <>
                <div className="w-56 min-w-[10rem]">
                  <SearchInput
                    value={search}
                    onValueChange={setSearch}
                    placeholder="Search illustrations…"
                    label="Search illustrations"
                  />
                </div>
                <Select value={size} onValueChange={(value) => setSize(value as IllustrationSize)}>
                  <SelectTrigger aria-label="Footprint drawn in the grid" className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ILLUSTRATION_SIZES.map((option) => (
                      <SelectItem key={option} value={option}>
                        {`${option.toUpperCase()} footprint`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <label className="flex cursor-pointer items-center gap-2">
                  <Switch
                    checked={showPorts}
                    onCheckedChange={setShowPorts}
                    aria-label="Show port overlay"
                  />
                  <Text variant="meta" tone="muted" as="span">
                    Port overlay
                  </Text>
                </label>
              </>
            ) : undefined
          }
          results={
            tab === "components" ? (
              <ResultCount
                filteredCount={matches.length}
                totalCount={ILLUSTRATION_REGISTRY.length}
                noun="illustrations"
              />
            ) : undefined
          }
        />
      }
    >
      <Heading level={1} className="sr-only">
        Illustrations
      </Heading>

      <TabPanel
        value={tab}
        onValueChange={(value) => setTab(value as GalleryTab)}
        tabs={[
          { value: "components", label: "Components", count: ILLUSTRATION_REGISTRY.length },
          { value: "primitives", label: "Primitives" },
        ]}
      >
        <TabPanelContent
          value="components"
          description={`Registry v${REGISTRY_VERSION} · every entry is validated against the shared schema at load, and no component ships without one.`}
        >
          {matches.length === 0 ? (
            <EmptyState
              icon={<Shapes aria-hidden />}
              title="No illustrations match"
              description="Nothing in the catalog matches that search. Clear it to see the whole repository."
              actions={
                <Button variant="outline" onClick={() => setSearch("")}>
                  Show the whole catalog
                </Button>
              }
            />
          ) : (
            <ul className="grid list-none grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-4 p-0">
              {matches.map((entry) => (
                <li key={entry.id}>
                  <IllustrationCard
                    entry={entry}
                    size={size}
                    showPorts={showPorts}
                    onOpen={() => setSelected(entry)}
                  />
                </li>
              ))}
            </ul>
          )}
        </TabPanelContent>

        <TabPanelContent
          value="primitives"
          description="The drawing vocabulary every entity above is composed from — one tile per primitive, on the same drafting paper."
        >
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
        </TabPanelContent>
      </TabPanel>

      <IllustrationDetail
        entry={selected}
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        showPorts={showPorts}
        onShowPortsChange={setShowPorts}
      />
    </PageShell>
  );
}

/**
 * One catalog card. The whole card is a button, because the drawing IS the affordance here — the
 * gallery's job is "look at these, open one" and a separate "Details" link beside a picture nobody
 * can click reads as a mistake.
 */
function IllustrationCard(props: {
  entry: IllustrationRegistryEntry;
  size: IllustrationSize;
  showPorts: boolean;
  onOpen: () => void;
}) {
  const { entry } = props;
  return (
    <Card className="h-full">
      <CardContent className="flex h-full flex-col gap-3 p-0">
        <Button
          variant="ghost"
          onClick={props.onOpen}
          className="h-auto flex-col items-stretch gap-3 whitespace-normal p-4 text-left"
          aria-label={`Open ${entry.title} — states, sizes and registry entry`}
        >
          <span className="flex justify-center">
            <IllustrationCanvas
              entry={entry}
              size={props.size}
              showPorts={props.showPorts}
              width={CARD_WIDTH}
              alt={`${entry.title}, drawn at the ${props.size.toUpperCase()} footprint`}
            />
          </span>
          <span className="flex min-w-0 flex-col gap-1">
            <Text variant="body" className="font-medium">
              {entry.title}
            </Text>
            <Text variant="meta" tone="muted" className="line-clamp-2 text-pretty">
              {entry.description}
            </Text>
          </span>
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="font-mono">
              {entry.id}
            </Badge>
            <Badge variant="secondary">{`tier ${entry.tier}`}</Badge>
            {entry.variants.map((variant) => (
              <Badge key={variant} variant="secondary">
                {variant}
              </Badge>
            ))}
          </span>
        </Button>
      </CardContent>
    </Card>
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

export default IllustrationsGallery;
