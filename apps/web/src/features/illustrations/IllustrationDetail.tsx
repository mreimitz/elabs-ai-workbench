import {
  ILLUSTRATION_SIZES,
  ILLUSTRATION_STATES,
  type IllustrationFacing,
  type IllustrationRegistryEntry,
  type IllustrationSize,
} from "@mcp-token-footprint/shared";
import { REGISTRY_VERSION } from "@mcp-token-footprint/illustrations";
import {
  Badge,
  Card,
  CardContent,
  Descriptions,
  DescriptionsItem,
  Heading,
  Switch,
  Text,
} from "@elabs-ai/components-ui";
import { WorkbenchDialog } from "../../components/dialogs";
import { IllustrationCanvas } from "./IllustrationCanvas";

/** The width every matrix cell is drawn at. Large enough that a `s` footprint is still readable. */
const CELL_WIDTH = 168;

/**
 * The detail view for one catalogued illustration (system design 5.1): the states x sizes matrix,
 * the variants, both gaze directions, a port-map overlay toggle, and the registry entry itself.
 *
 * It is a DIALOG rather than a route, deliberately, and the reason is written down rather than
 * assumed. `.claude/rules/routes-vs-dialogs.md` asks whether sharing this URL would mean anything on
 * its own; today it would not, because nothing else in the app links to a single illustration. The
 * thing that WILL make one addressable is RM-14 WP 4.1's `illustration` view in the assistant's
 * navigation registry — and that WP owns the second route manifest entry it would need. Until then
 * `/illustrations` stays exactly one route that renders the whole catalog with zero query params.
 */
export function IllustrationDetail(props: {
  entry: IllustrationRegistryEntry | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  showPorts: boolean;
  onShowPortsChange: (showPorts: boolean) => void;
}) {
  const { entry } = props;
  if (entry === null) return null;

  // Every cell in the matrix is framed against the LARGEST footprint the entity claims, so `s`
  // actually renders smaller than `l` instead of each cell scaling to fill its own frame.
  const frameSize = (entry.sizes.includes("l") ? "l" : entry.sizes[entry.sizes.length - 1]) as
    | IllustrationSize
    | undefined;
  const variants = entry.variants.length > 0 ? entry.variants : [undefined];

  return (
    <WorkbenchDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={entry.title}
      description={entry.description}
      headerActions={
        <label className="flex cursor-pointer items-center gap-2">
          <Switch
            checked={props.showPorts}
            onCheckedChange={props.onShowPortsChange}
            aria-label="Show port overlay"
          />
          <Text variant="meta" tone="muted" as="span">
            Port overlay
          </Text>
        </label>
      }
    >
      <div className="flex flex-col gap-6 p-6">
        <DetailSection
          title="States"
          caption="The closed state set. Every entity applies the five identically — the wrapper owns them, so `active` looks the same on an agent as on a server."
        >
          {ILLUSTRATION_STATES.map((state) => (
            <MatrixCell key={state} caption={state}>
              <IllustrationCanvas
                entry={entry}
                size="m"
                frameSize={frameSize}
                state={state}
                variant={entry.variants[0]}
                showPorts={props.showPorts}
                width={CELL_WIDTH}
                alt={`${entry.title}, ${state} state`}
              />
            </MatrixCell>
          ))}
        </DetailSection>

        <DetailSection
          title="Sizes"
          caption="The quantized footprints — S 4x4, M 6x6, L 8x8 units. All three are framed against the same box here, so the scale difference is the real one."
        >
          {ILLUSTRATION_SIZES.filter((size) => entry.sizes.includes(size)).map((size) => (
            <MatrixCell key={size} caption={`${size.toUpperCase()} · ${footprintOf(size)}`}>
              <IllustrationCanvas
                entry={entry}
                size={size}
                frameSize={frameSize}
                variant={entry.variants[0]}
                showPorts={props.showPorts}
                width={CELL_WIDTH}
                alt={`${entry.title}, ${size.toUpperCase()} footprint`}
              />
            </MatrixCell>
          ))}
        </DetailSection>

        {entry.variants.length > 0 ? (
          <DetailSection title="Variants" caption="Named alternates of the same component.">
            {entry.variants.map((variant) => (
              <MatrixCell key={variant} caption={variant}>
                <IllustrationCanvas
                  entry={entry}
                  size="m"
                  frameSize={frameSize}
                  variant={variant}
                  showPorts={props.showPorts}
                  width={CELL_WIDTH}
                  alt={`${entry.title}, ${variant} variant`}
                />
              </MatrixCell>
            ))}
          </DetailSection>
        ) : null}

        <DetailSection
          title="Facing"
          caption="Gaze meets the flow: an entity with a front panel mounts it on the left face when it faces upstream and on the right when it faces downstream. A faceless entity ignores the prop, and these two tiles look identical."
        >
          {(["upstream", "downstream"] as IllustrationFacing[]).map((facing) => (
            <MatrixCell key={facing} caption={facing}>
              <IllustrationCanvas
                entry={entry}
                size="m"
                frameSize={frameSize}
                facing={facing}
                variant={variants[0]}
                showPorts={props.showPorts}
                width={CELL_WIDTH}
                alt={`${entry.title}, facing ${facing}`}
              />
            </MatrixCell>
          ))}
        </DetailSection>

        <Card>
          <CardContent className="flex flex-col gap-3 py-4">
            <Heading level={3} size="subtitle">
              Registry entry
            </Heading>
            <Descriptions columns={2}>
              <DescriptionsItem label="Id">
                <span className="font-mono">{entry.id}</span>
              </DescriptionsItem>
              <DescriptionsItem label="Entity">
                <span className="font-mono">{entry.entity ?? "— (abstract)"}</span>
              </DescriptionsItem>
              <DescriptionsItem label="Tier" numeric>
                {entry.tier}
              </DescriptionsItem>
              <DescriptionsItem label="Since" numeric>
                {entry.since}
              </DescriptionsItem>
              <DescriptionsItem label="Registry version" numeric>
                {REGISTRY_VERSION}
              </DescriptionsItem>
              <DescriptionsItem label="Sizes">{entry.sizes.join(" · ")}</DescriptionsItem>
              <DescriptionsItem label="Variants">
                {entry.variants.length > 0 ? entry.variants.join(" · ") : "— (none)"}
              </DescriptionsItem>
              <DescriptionsItem label="States">{entry.states.join(" · ")}</DescriptionsItem>
              <DescriptionsItem label="Ports">
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(entry.ports).map(([name, port]) => (
                    <Badge key={name} variant="outline" className="gap-1 font-mono">
                      <span>{name}</span>
                      <span className="text-muted-foreground">{port.side}</span>
                    </Badge>
                  ))}
                </div>
              </DescriptionsItem>
              <DescriptionsItem label="Keywords">
                <div className="flex flex-wrap gap-1.5">
                  {entry.keywords.map((keyword) => (
                    <Badge key={keyword} variant="secondary">
                      {keyword}
                    </Badge>
                  ))}
                </div>
              </DescriptionsItem>
            </Descriptions>
          </CardContent>
        </Card>
      </div>
    </WorkbenchDialog>
  );
}

function DetailSection(props: { title: string; caption: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <Heading level={3} size="subtitle">
        {props.title}
      </Heading>
      <Text variant="meta" tone="muted" className="max-w-3xl text-pretty">
        {props.caption}
      </Text>
      <div className="flex flex-wrap gap-3">{props.children}</div>
    </section>
  );
}

function MatrixCell(props: { caption: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-md border border-border bg-card p-2">
      {props.children}
      <Text variant="caption" tone="muted" as="span">
        {props.caption}
      </Text>
    </div>
  );
}

/** The footprint a size names, spelled out — the gallery is where that mapping is learned. */
function footprintOf(size: IllustrationSize): string {
  return size === "s" ? "4×4" : size === "m" ? "6×6" : "8×8";
}
