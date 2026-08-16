/* GENERATED from packages/ui/src/templates-object-detail-hub.stories.tsx by pnpm gen:templates — do not edit. */
/* Full-screen object-detail-hub template (single source of truth: the Storybook story). */

/**
 * Object Detail Hub — the master-detail screen the library was missing.
 *
 * The single most common enterprise screen: a list of objects on the left drives
 * a rich DETAIL HUB on the right. It demonstrates the structural choices the
 * enterprise rulebook insists on, so an end-user copies the right anatomy instead
 * of dumping everything on one page or stacking detail *below* the list:
 *
 *   • SplitPanel master-detail (list drives detail — never detail below list).
 *   • A detail hub = sticky SectionHeader (identity + status) + a ButtonGroup
 *     toolbar + Tabs for the object's sections (Overview / Activity / Settings).
 *   • Descriptions for the object's attributes; a related list for its children.
 *   • A high-value task (Run) promoted to its own focused Dialog surface.
 *   • A real empty state (StatePanel kind="empty") when nothing is selected.
 *
 * Compose-only from @brand/* primitives; semantic tokens only; reads in
 * qlik-bright AND qlik-dark. Verify with globals=theme:<slug>.
 */
import { useState } from "react";
import { Pencil, Play, Search } from "lucide-react";
import {
  Badge,
  Button,
  ButtonGroup,
  Descriptions,
  DescriptionsItem,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  MetricCard,
  SectionHeader,
  Separator,
  SplitPanel,
  StatePanel,
  StatusBadge,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Toaster,
  toast,
  type Status,
} from "@brand/ui";

/* -------------------------------------------------------------------------- */
/*  Object model — a "Pipeline" with attributes, runs (children) and settings  */
/* -------------------------------------------------------------------------- */

type Health = "active" | "paused" | "error";

interface Run {
  id: string;
  status: Status;
  trigger: string;
  rows: number;
  when: string;
}

interface Pipeline {
  id: string;
  name: string;
  source: string;
  destination: string;
  health: Health;
  schedule: string;
  owner: string;
  lastRun: string;
  rows24h: string;
  successRate: string;
  avgDuration: string;
  runs: Run[];
}

const HEALTH_VARIANT: Record<Health, "success" | "secondary" | "destructive"> = {
  active: "success",
  paused: "secondary",
  error: "destructive",
};

const PIPELINES: Pipeline[] = [
  {
    id: "rev",
    name: "Revenue rollup",
    source: "Postgres — prod",
    destination: "Snowflake · analytics.revenue",
    health: "active",
    schedule: "Every 15 min",
    owner: "Avery Rao",
    lastRun: "2 min ago",
    rows24h: "1.2M",
    successRate: "99.8%",
    avgDuration: "42s",
    runs: [
      { id: "r1", status: "complete", trigger: "Schedule", rows: 84_120, when: "2 min ago" },
      { id: "r2", status: "complete", trigger: "Schedule", rows: 83_902, when: "17 min ago" },
      { id: "r3", status: "complete", trigger: "Manual", rows: 84_001, when: "32 min ago" },
    ],
  },
  {
    id: "cust",
    name: "Customer 360",
    source: "Salesforce",
    destination: "Snowflake · analytics.customer",
    health: "active",
    schedule: "Hourly",
    owner: "Jordan Lee",
    lastRun: "24 min ago",
    rows24h: "410K",
    successRate: "99.1%",
    avgDuration: "1m 12s",
    runs: [
      { id: "r1", status: "running", trigger: "Schedule", rows: 0, when: "now" },
      { id: "r2", status: "complete", trigger: "Schedule", rows: 17_420, when: "1 h ago" },
    ],
  },
  {
    id: "feed",
    name: "Partner feed import",
    source: "SFTP · partner-drop",
    destination: "Snowflake · staging.partner",
    health: "error",
    schedule: "Daily 02:00",
    owner: "Sam Cole",
    lastRun: "1 d ago",
    rows24h: "0",
    successRate: "71%",
    avgDuration: "3m 04s",
    runs: [
      { id: "r1", status: "failed", trigger: "Schedule", rows: 0, when: "1 d ago" },
      { id: "r2", status: "complete", trigger: "Schedule", rows: 9_210, when: "2 d ago" },
    ],
  },
  {
    id: "ga",
    name: "Marketing analytics",
    source: "Google Analytics",
    destination: "Snowflake · analytics.web",
    health: "paused",
    schedule: "Paused",
    owner: "Avery Rao",
    lastRun: "3 d ago",
    rows24h: "0",
    successRate: "98.4%",
    avgDuration: "55s",
    runs: [{ id: "r1", status: "skipped", trigger: "Schedule", rows: 0, when: "3 d ago" }],
  },
];

/* -------------------------------------------------------------------------- */
/*  Master — searchable list of objects (the "which object" rail)              */
/* -------------------------------------------------------------------------- */

function PipelineList({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const results = PIPELINES.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="flex h-full flex-col">
      <div className="border-b p-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search pipelines…"
            aria-label="Search pipelines"
            className="ps-8"
          />
        </div>
        <p className="mt-2 text-meta text-muted-foreground">
          {results.length} of {PIPELINES.length} pipelines
        </p>
      </div>

      {results.length === 0 ? (
        <StatePanel
          kind="empty"
          className="m-3 border-0 bg-transparent py-10"
          title="No matches"
          description="No pipelines match that search."
        />
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto p-2">
          {results.map((p) => {
            const selected = p.id === selectedId;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  aria-current={selected ? "true" : undefined}
                  onClick={() => onSelect(p.id)}
                  className={[
                    "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-start transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selected ? "bg-primary/10 text-foreground" : "hover:bg-surface-muted",
                  ].join(" ")}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body font-medium">{p.name}</span>
                    <span className="block truncate text-meta text-muted-foreground">
                      {p.source}
                    </span>
                  </span>
                  <Badge variant={HEALTH_VARIANT[p.health]}>{p.health}</Badge>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  The "Run" task — a high-value action promoted to its own Dialog surface     */
/* -------------------------------------------------------------------------- */

function RunPipelineDialog({ pipeline }: { pipeline: Pipeline }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm">
          <Play className="size-4" aria-hidden="true" />
          Run
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Run “{pipeline.name}”</DialogTitle>
          <DialogDescription>
            Starts a manual run now. The schedule ({pipeline.schedule}) is unaffected.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="run-window">Backfill window (optional)</Label>
            <Input id="run-window" placeholder="e.g. last 24 hours" autoComplete="off" />
          </div>
          <p className="text-meta text-muted-foreground">
            Writes to <span className="font-mono">{pipeline.destination}</span>.
          </p>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" size="sm">
              Cancel
            </Button>
          </DialogClose>
          <DialogClose asChild>
            <Button size="sm" onClick={() => toast.success(`Run started for ${pipeline.name}`)}>
              Start run
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/*  Detail hub — header + toolbar + tabbed sections for ONE object             */
/* -------------------------------------------------------------------------- */

function PipelineHub({ pipeline }: { pipeline: Pipeline }) {
  return (
    <div className="flex h-full flex-col">
      {/* Sticky identity + toolbar */}
      <div className="sticky top-0 z-10 border-b bg-card px-6 pb-3 pt-5">
        <SectionHeader
          eyebrow="Pipeline"
          title={
            <span className="flex items-center gap-2">
              {pipeline.name}
              <Badge variant={HEALTH_VARIANT[pipeline.health]}>{pipeline.health}</Badge>
            </span>
          }
          description={`${pipeline.source} → ${pipeline.destination}`}
          actions={
            <div className="flex items-center gap-2">
              <RunPipelineDialog pipeline={pipeline} />
              <ButtonGroup>
                <Button variant="outline" size="sm">
                  <Pencil className="size-4" aria-hidden="true" />
                  Edit
                </Button>
                <Button variant="outline" size="sm">
                  Duplicate
                </Button>
              </ButtonGroup>
            </div>
          }
        />
      </div>

      {/* Tabbed sections — the object's sub-views, switched in place */}
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <Tabs defaultValue="overview" className="gap-6">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>

          {/* Overview — summary first: KPIs, then attributes, then children */}
          <TabsContent value="overview" className="space-y-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <MetricCard
                label="Rows (24h)"
                value={pipeline.rows24h}
                description="written to destination"
              />
              <MetricCard
                label="Success rate"
                value={pipeline.successRate}
                description="last 7 days"
              />
              <MetricCard label="Avg duration" value={pipeline.avgDuration} description="per run" />
            </div>

            <section aria-label="Attributes">
              <h3 className="mb-2 text-body font-semibold text-foreground">Configuration</h3>
              <Descriptions columns={2} layout="vertical">
                <DescriptionsItem label="Source">{pipeline.source}</DescriptionsItem>
                <DescriptionsItem label="Destination">{pipeline.destination}</DescriptionsItem>
                <DescriptionsItem label="Schedule">{pipeline.schedule}</DescriptionsItem>
                <DescriptionsItem label="Owner">{pipeline.owner}</DescriptionsItem>
                <DescriptionsItem label="Last run">{pipeline.lastRun}</DescriptionsItem>
                <DescriptionsItem label="Pipeline ID">{pipeline.id}</DescriptionsItem>
              </Descriptions>
            </section>

            <section aria-label="Recent runs">
              <h3 className="mb-2 text-body font-semibold text-foreground">Recent runs</h3>
              <RunList runs={pipeline.runs} />
            </section>
          </TabsContent>

          {/* Activity — the related child list in full */}
          <TabsContent value="activity" className="space-y-4">
            <RunList runs={pipeline.runs} />
          </TabsContent>

          {/* Settings — a couple of editable fields */}
          <TabsContent value="settings" className="max-w-lg space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="hub-name">Pipeline name</Label>
              <Input id="hub-name" defaultValue={pipeline.name} autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hub-schedule">Schedule</Label>
              <Input id="hub-schedule" defaultValue={pipeline.schedule} autoComplete="off" />
            </div>
            <Separator />
            <div className="flex justify-end">
              <Button size="sm" onClick={() => toast.success("Pipeline settings saved")}>
                Save changes
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function RunList({ runs }: { runs: Run[] }) {
  return (
    <ul className="overflow-hidden rounded-lg border bg-card">
      {runs.map((r, i) => (
        <li
          key={r.id}
          className={["flex items-center gap-3 px-4 py-2.5", i > 0 ? "border-t" : ""].join(" ")}
        >
          <StatusBadge status={r.status} />
          <span className="min-w-0 flex-1 truncate text-body text-foreground">{r.trigger} run</span>
          <span className="hidden tabular-nums text-meta text-muted-foreground sm:inline">
            {r.rows.toLocaleString()} rows
          </span>
          <span className="shrink-0 text-meta text-muted-foreground">{r.when}</span>
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/*  The screen                                                                  */
/* -------------------------------------------------------------------------- */

function ObjectDetailHub({ startSelected = "rev" }: { startSelected?: string | null }) {
  const [selectedId, setSelectedId] = useState<string | null>(startSelected);
  const selected = PIPELINES.find((p) => p.id === selectedId) ?? null;

  return (
    <div className="h-dvh w-full bg-background text-foreground">
      <SplitPanel
        startSize="300px"
        className="h-full"
        start={<PipelineList selectedId={selectedId} onSelect={setSelectedId} />}
        end={
          selected ? (
            <PipelineHub pipeline={selected} />
          ) : (
            <div className="grid h-full place-items-center p-6">
              <StatePanel
                kind="empty"
                title="Select a pipeline"
                description="Choose a pipeline from the list to see its configuration, runs and settings."
              />
            </div>
          )
        }
      />
      <Toaster />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Stories                                                                      */
/* -------------------------------------------------------------------------- */

/** Master-detail with the first object selected (the common entry state). */

/** The unselected state — the detail pane shows a real empty state. */
