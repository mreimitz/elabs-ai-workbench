"use client";
/**
 * Archetype-B object DETAIL HUB — the copyable worked example for the two judgment
 * references that agents fail most:
 *   • reference/screen-layout-patterns.md      — which component for each structural job
 *   • reference/information-priority-and-emphasis.md — what deserves the spotlight
 *
 * This is the MCP-server detail page from those case studies, made real. It demonstrates,
 * in one screen, every rule those files state:
 *   1. PageShell + a STICKY SectionHeader (Breadcrumb drill-path · Title · status Badge ·
 *      ButtonGroup toolbar with the primary action right + Delete = danger). Header never
 *      scrolls away.
 *   2. Sections are Tabs, not a stack of cards — and the TabsList stays in the sticky
 *      region; only TabsContent scrolls (a tab bar that scrolls away is a live-audited bug).
 *   3. Overview leads with FINDINGS (Tier: Act — what + why + a CTA), NOT a repeat of the
 *      header KPIs; Profile (Reference) is calm Descriptions below; composition is ONE
 *      segmented bar; top contributors are a compact ranked list — never four equal cards.
 *   4. Tools is a SplitPanel master-detail — list `start`, detail `end`, each pane its own
 *      ScrollArea — rebalanced so the DETAIL (the point) gets the room, list ~380px.
 *   5. The tool list carries DECISION signal (tokens + issues + status; description
 *      truncated with a tooltip), not a repeat of the full instruction.
 *   6. Run Tool is promoted to its OWN surface — a wide Dialog, PARAMETERS left / RESULTS
 *      right — because a high-value repeated task deserves a first-class surface (§7).
 *   7. Raw schema is tucked LAST in a Collapsible (Tier: Raw), never given equal weight.
 *
 * Adapt the object model (server → tool → scan) to your domain (e.g. Country → Customer →
 * Order). The judgment is the asset; the data is illustrative.
 *
 * PROPS: structural props used here are source-verified against the vendored `@brand/*` v1.0.0
 * types and `../reference/screen-layout-patterns.md` (PageShell `header`/`width`; SplitPanel `start`/`end`/`startSize`;
 * Tabs*; Dialog* — see settings-dialog.tsx; ScrollArea). Confirm the exact slot/prop names of
 * SectionHeader, ButtonGroup/ButtonGroupText, Descriptions/DescriptionsItem,
 * SearchInput, and Collapsible* with `brand-ui docs <Component>` before shipping.
 *
 * INTEGRATION: render inside a height-bounded main (give the shell's <main> `overflow-hidden`,
 * not the default `overflow-y-auto`), so this page owns its own scroll via the sticky
 * header/tabs + per-region ScrollArea. See assets/app-shell.tsx.
 */
import { useState, type ReactNode } from "react";
import {
  Badge,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
  ButtonGroup,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Descriptions,
  DescriptionsItem,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  PageShell,
  ScrollArea,
  SearchInput,
  SectionHeader,
  Separator,
  SplitPanel,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@brand/ui";
import { ChevronDown, Pencil, Play, FlaskConical, MoreHorizontal, Trash2 } from "lucide-react";

/* ---------------------------------------------------------------- types + fixtures */

type ToolStatus = "ok" | "attention" | "error";

type ToolRow = {
  id: string;
  name: string;
  /** One-line summary; truncated in the list, shown in full once (in the detail). */
  summary: string;
  tokens: number;
  issues: number;
  status: ToolStatus;
};

type Finding = {
  id: string;
  what: string; // the signal
  why: string; // why it matters
  cta: string; // the action verb
  onAct: () => void;
};

type Segment = { label: string; value: number; className: string };

const SERVER = {
  name: "qlik-cloud",
  status: { variant: "warning" as const, label: "3 issues" },
  transport: "stdio",
  version: "1.4.0",
  tools: 18,
  tokens: 24_310,
};

const TOOLS: ToolRow[] = [
  {
    id: "t1",
    name: "qlik_create_data_object",
    summary: "Create a data object from a connection and load script.",
    tokens: 8920,
    issues: 2,
    status: "attention",
  },
  {
    id: "t2",
    name: "qlik_list_apps",
    summary: "List apps in a space with pagination and filters.",
    tokens: 1240,
    issues: 0,
    status: "ok",
  },
  {
    id: "t3",
    name: "qlik_reload_app",
    summary: "Trigger a reload task for an app and poll status.",
    tokens: 2110,
    issues: 0,
    status: "ok",
  },
  {
    id: "t4",
    name: "qlik_export_chart",
    summary: "Export a chart object to PNG/PDF with a size hint.",
    tokens: 3180,
    issues: 1,
    status: "error",
  },
];

// Tier: Act — the most valuable content on Overview. Each is what + why + a CTA.
const FINDINGS: Finding[] = [
  {
    id: "f1",
    what: "Schema is 88% of qlik_create_data_object's tokens",
    why: "One tool drives 37% of the server's footprint.",
    cta: "Trim schema",
    onAct: () => {},
  },
  {
    id: "f2",
    what: "qlik_export_chart returns an unbounded description",
    why: "Adds ~1.2k tokens per call with no cap.",
    cta: "Add a limit",
    onAct: () => {},
  },
];

// Composition of the footprint — ONE segmented bar, not four stacked bars (info-priority §5).
const COMPOSITION: Segment[] = [
  { label: "Schemas", value: 13_400, className: "bg-primary" },
  { label: "Descriptions", value: 6_200, className: "bg-chart-2" },
  { label: "Names", value: 3_010, className: "bg-chart-3" },
  { label: "Annotations", value: 1_700, className: "bg-muted-foreground/40" },
];

/* ---------------------------------------------------------------- small presentationals */

const fmt = (n: number) => n.toLocaleString();

/** Tier: Act — an actionable finding. Interactive, never a static line in a card-in-card. */
function FindingCard({ finding }: { finding: Finding }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
      <div className="min-w-0">
        <p className="font-medium">{finding.what}</p>
        <p className="text-sm text-muted-foreground">{finding.why}</p>
      </div>
      <Button size="sm" onClick={finding.onAct} className="shrink-0">
        {finding.cta}
      </Button>
    </div>
  );
}

/** Part-to-whole in one bar (Tufte data-ink): the right encoding, the right size. */
function SegmentedBar({ segments }: { segments: Segment[] }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full">
        {segments.map((s) => (
          <div
            key={s.label}
            className={s.className}
            style={{ width: `${(s.value / total) * 100}%` }}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {segments.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <span className={`size-2 rounded-full ${s.className}`} aria-hidden />
            {s.label} · {fmt(s.value)}
          </span>
        ))}
      </div>
    </div>
  );
}

/** A ranked set = a compact list with inline bars, not a giant full-width chart. */
function RankedContributors({ items }: { items: ToolRow[] }) {
  const max = Math.max(...items.map((t) => t.tokens), 1);
  return (
    <ul className="space-y-1.5">
      {[...items]
        .sort((a, b) => b.tokens - a.tokens)
        .map((t) => (
          <li key={t.id} className="grid grid-cols-[1fr_auto] items-center gap-3 text-sm">
            <span className="truncate font-mono text-xs">{t.name}</span>
            <span className="tabular-nums text-muted-foreground">{fmt(t.tokens)}</span>
            <div className="col-span-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary" style={{ width: `${(t.tokens / max) * 100}%` }} />
            </div>
          </li>
        ))}
    </ul>
  );
}

function SubHeading({ children }: { children: ReactNode }) {
  return <h3 className="text-sm font-semibold text-muted-foreground">{children}</h3>;
}

/* ---------------------------------------------------------------- the page header (sticky) */

function DetailHeader({ onDelete, onRunScan }: { onDelete: () => void; onRunScan: () => void }) {
  return (
    // SectionHeader is the sticky page header. Confirm its slot/prop names with `brand-ui docs`;
    // shown here composing the canonical content: drill path · identity · toolbar.
    <SectionHeader>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="#/servers">Servers</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{SERVER.name}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="truncate text-xl font-semibold">{SERVER.name}</h1>
            {/* Object health = a Badge variant. StatusBadge is for execution/run state
                (a scan running/complete/failed), not object health. */}
            <Badge variant={SERVER.status.variant}>{SERVER.status.label}</Badge>
          </div>
        </div>

        {/* A toolbar is a ButtonGroup, not loose buttons: primary right, Delete = danger,
            secondary actions collapse into an overflow ⋯. */}
        <ButtonGroup>
          <Button variant="outline" size="sm">
            <Pencil aria-hidden /> Edit
          </Button>
          <Button variant="outline" size="sm">
            <FlaskConical aria-hidden /> Test
          </Button>
          <Button size="sm" onClick={onRunScan}>
            <Play aria-hidden /> Run scan
          </Button>
          <Button variant="ghost" size="icon" aria-label="More actions">
            <MoreHorizontal aria-hidden />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Delete server" onClick={onDelete}>
            <Trash2 aria-hidden className="text-destructive" />
          </Button>
        </ButtonGroup>
      </div>
    </SectionHeader>
  );
}

/* ---------------------------------------------------------------- Overview tab (value-ranked) */

function OverviewTab() {
  return (
    <div className="mx-auto max-w-4xl space-y-8 p-6">
      {/* Act: lead with the findings — top of the page, full width, interactive.
          Do NOT repeat the header KPI band here. */}
      <section className="space-y-3" aria-label="Attention & optimization">
        <SubHeading>Attention &amp; optimization</SubHeading>
        <div className="space-y-2">
          {FINDINGS.map((f) => (
            <FindingCard key={f.id} finding={f} />
          ))}
        </div>
      </section>

      {/* Reference: the profile — calm Descriptions, below the findings. */}
      <section className="space-y-3" aria-label="Server profile">
        <SubHeading>Profile</SubHeading>
        <Descriptions>
          <DescriptionsItem label="Transport">{SERVER.transport}</DescriptionsItem>
          <DescriptionsItem label="Version">{SERVER.version}</DescriptionsItem>
          <DescriptionsItem label="Tools">{SERVER.tools}</DescriptionsItem>
          <DescriptionsItem label="Total tokens">{fmt(SERVER.tokens)}</DescriptionsItem>
        </Descriptions>
      </section>

      <div className="grid gap-8 sm:grid-cols-2">
        <section className="space-y-3" aria-label="Footprint composition">
          <SubHeading>Footprint composition</SubHeading>
          <SegmentedBar segments={COMPOSITION} />
        </section>
        <section className="space-y-3" aria-label="Top contributors">
          <SubHeading>Top contributors</SubHeading>
          <RankedContributors items={TOOLS} />
        </section>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Tools tab (master-detail) */

function ToolListRow({
  tool,
  selected,
  onSelect,
}: {
  tool: ToolRow;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected}
      className={`w-full border-b border-border px-3 py-2.5 text-left transition-colors ${
        selected ? "bg-accent" : "hover:bg-muted/60"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-mono text-sm">{tool.name}</span>
        <Badge
          variant={
            tool.status === "ok" ? "success" : tool.status === "error" ? "destructive" : "warning"
          }
        >
          {tool.status}
        </Badge>
      </div>
      {/* Decision signal: tokens + issues — what helps you PICK the right tool. */}
      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="tabular-nums">{fmt(tool.tokens)} tok</span>
        {tool.issues > 0 && <Badge variant="outline">{tool.issues} issues</Badge>}
        {/* Summary truncated; full text lives once, in the detail. Tooltip for the rest. */}
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="min-w-0 flex-1 truncate">{tool.summary}</span>
          </TooltipTrigger>
          <TooltipContent>{tool.summary}</TooltipContent>
        </Tooltip>
      </div>
    </button>
  );
}

function ToolList({
  tools,
  selectedId,
  onSelect,
}: {
  tools: ToolRow[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const shown = tools.filter((t) => t.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border p-2">
        {/* A list needs search — confirm SearchInput's props with `brand-ui docs`. */}
        <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tools…" />
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {shown.map((t) => (
          <ToolListRow
            key={t.id}
            tool={t}
            selected={t.id === selectedId}
            onSelect={() => onSelect(t.id)}
          />
        ))}
      </ScrollArea>
      {/* A list needs a count/footer, not just an Add button. */}
      <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
        {shown.length} of {tools.length} tools
      </div>
    </div>
  );
}

function ToolDetail({ tool, onRun }: { tool: ToolRow; onRun: () => void }) {
  const breakdown: Segment[] = [
    { label: "Schema", value: Math.round(tool.tokens * 0.78), className: "bg-primary" },
    { label: "Description", value: Math.round(tool.tokens * 0.14), className: "bg-chart-2" },
    { label: "Name", value: Math.round(tool.tokens * 0.08), className: "bg-chart-3" },
  ];
  return (
    <div className="space-y-6 p-6">
      {/* Detail header: identity + the promoted primary action (Run → its own surface). */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate font-mono text-lg font-semibold">{tool.name}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{tool.summary}</p>
        </div>
        <Button onClick={onRun} className="shrink-0">
          <Play aria-hidden /> Run tool
        </Button>
      </div>

      {/* Structured by value, not a flat panel. Breakdown → Parameters → (raw tucked last). */}
      <section className="space-y-3" aria-label="Token breakdown">
        <SubHeading>Breakdown</SubHeading>
        <SegmentedBar segments={breakdown} />
      </section>

      <section className="space-y-3" aria-label="Parameters">
        <SubHeading>Parameters</SubHeading>
        <Descriptions>
          <DescriptionsItem label="connectionId">string · required</DescriptionsItem>
          <DescriptionsItem label="loadScript">string · required</DescriptionsItem>
          <DescriptionsItem label="spaceId">string · optional</DescriptionsItem>
        </Descriptions>
      </section>

      {/* Raw (Tier: Raw) — tucked away in a Collapsible, never given equal weight. */}
      <Collapsible>
        <CollapsibleTrigger className="flex items-center gap-1 text-sm font-medium text-muted-foreground">
          <ChevronDown aria-hidden className="size-4" /> Raw schema
        </CollapsibleTrigger>
        <CollapsibleContent>
          <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 text-xs">
            {`{
  "type": "object",
  "required": ["connectionId", "loadScript"],
  "properties": { "connectionId": { "type": "string" } }
}`}
          </pre>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function ToolsTab() {
  const [selectedId, setSelectedId] = useState(TOOLS[0].id);
  const [runOpen, setRunOpen] = useState(false);
  const tool = TOOLS.find((t) => t.id === selectedId) ?? TOOLS[0];
  return (
    <>
      {/* Master-detail. Rebalanced: the detail is the point → list ~380px, detail takes the
          rest. start = list, end = detail; selecting updates the detail IN PLACE. Each pane
          gets its OWN scroll (list ScrollArea above; detail ScrollArea here). */}
      <SplitPanel
        startSize="380px"
        start={<ToolList tools={TOOLS} selectedId={selectedId} onSelect={setSelectedId} />}
        end={
          <ScrollArea className="h-full">
            <ToolDetail tool={tool} onRun={() => setRunOpen(true)} />
          </ScrollArea>
        }
      />
      <RunToolDialog tool={tool} open={runOpen} onOpenChange={setRunOpen} />
    </>
  );
}

/* ---------------------------------------------------------------- Run Tool — its own surface */

function RunToolDialog({
  tool,
  open,
  onOpenChange,
}: {
  tool: ToolRow;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [result, setResult] = useState<null | { tokens: number; bytes: number }>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setResult(null);
      }}
    >
      {/* A high-value repeated task deserves a first-class surface: wide, room to breathe,
          PARAMETERS left / RESULTS right. */}
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-hidden">
        <DialogHeader>
          <DialogTitle className="font-mono">{tool.name}</DialogTitle>
          <DialogDescription>Run this tool and inspect the call's footprint.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Left: parameters (the inputs). */}
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              setResult({ tokens: 8920, bytes: 41_200 });
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="connectionId">connectionId</Label>
              <Input id="connectionId" placeholder="conn_…" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="loadScript">loadScript</Label>
              <Input id="loadScript" placeholder="LOAD * FROM …" />
            </div>
            <Button type="submit">
              <Play aria-hidden /> Run
            </Button>
          </form>

          {/* Right: results — revealed with purposeful, motion-reduce-safe motion. */}
          <div className="min-h-0 rounded-lg border border-border bg-muted/40">
            <ScrollArea className="h-full">
              {result ? (
                <div className="space-y-3 p-4 transition-opacity duration-200 motion-reduce:transition-none">
                  <div className="flex gap-4 text-sm">
                    <span>
                      <span className="text-muted-foreground">Tokens</span> · {fmt(result.tokens)}
                    </span>
                    <span>
                      <span className="text-muted-foreground">Bytes</span> · {fmt(result.bytes)}
                    </span>
                  </div>
                  <Separator />
                  <pre className="overflow-x-auto text-xs">{`{ "status": "ok", "rows": 1240 }`}</pre>
                </div>
              ) : (
                <p className="p-4 text-sm text-muted-foreground">
                  Run the tool to see results here.
                </p>
              )}
            </ScrollArea>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- the hub */

export function McpServerDetailHub() {
  const [tab, setTab] = useState("overview");
  return (
    <PageShell
      width="xl"
      className="h-full"
      header={<DetailHeader onDelete={() => {}} onRunScan={() => setTab("scans")} />}
    >
      {/* The body owns its scroll. The TabsList stays put; only the active TabsContent
          scrolls (sticky-tabs rule). Summary-first tab order: Overview is #1 and the default. */}
      <Tabs value={tab} onValueChange={setTab} className="flex h-full min-h-0 flex-col">
        <TabsList className="shrink-0">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="tools">Tools</TabsTrigger>
          <TabsTrigger value="scans">Scans</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="min-h-0 flex-1">
          <ScrollArea className="h-full">
            <OverviewTab />
          </ScrollArea>
        </TabsContent>

        <TabsContent value="tools" className="min-h-0 flex-1">
          {/* No outer ScrollArea — the SplitPanel's two panes each scroll independently. */}
          <ToolsTab />
        </TabsContent>

        <TabsContent value="scans" className="min-h-0 flex-1">
          <ScrollArea className="h-full">
            {/* A related list (the object's child objects) is a DataTable + search + count.
                Compose it from @brand/data — see object-and-navigation-patterns.md §8. */}
            <div className="p-6 text-sm text-muted-foreground">Scan history → DataTable.</div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="settings" className="min-h-0 flex-1">
          <ScrollArea className="h-full">
            <div className="p-6 text-sm text-muted-foreground">
              Server settings → a focused form.
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
