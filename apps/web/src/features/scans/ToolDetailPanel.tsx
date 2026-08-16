import { useMemo, useState } from "react";
import type { ToolScan, TokenProfileId } from "@mcp-token-footprint/shared";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsTrigger,
  Text,
  cn,
} from "@brand/ui";
import { CodeEditor } from "@brand/editor";
import { Check, Maximize2, Play } from "lucide-react";
import { ScrollableTabsList } from "../../components/ScrollableTabsList";
import { SegmentedBar } from "../../components/TokenViz";
import { parseParams, sortParams } from "../../lib/schema-params";
import { recoverableTokens } from "../../lib/optimize";
import { ToolRunDialog } from "./ToolPlayground";
import { ToolTestsTab } from "../compatibility/CompatibilityTests";
import { formatBytes, formatNumber, formatPercent, safeJson } from "../../lib/format";
import { READ_ONLY_OPTIONS } from "../../lib/monaco";

export function ToolDetailPanel({
  tool,
  serverId,
  tokenProfile,
}: { tool: ToolScan; serverId?: string; tokenProfile?: TokenProfileId }) {
  const [runOpen, setRunOpen] = useState(false);
  const params = useMemo(
    () => sortParams(parseParams(tool.inputSchema, tool.schemaTokens)),
    [tool.inputSchema, tool.schemaTokens],
  );
  const recoverable = useMemo(() => recoverableTokens(tool), [tool]);
  const badges = behaviorBadges(tool.annotations);
  const description = tool.description?.trim()
    ? tool.description
    : "No description provided by the MCP server.";

  return (
    <div className="flex min-w-0 flex-col">
      <Tabs defaultValue="breakdown" className="flex min-w-0 flex-col">
        {/* Sticky identity + tab bar — persists while only tab content scrolls. The pane sits inside a
            padded (`p-4`) scroll container (SplitPanePanel body / Sheet). Chrome pins `sticky top-0`
            BELOW the container's top padding, leaving a padding-sized gap where scrolled rows bleed
            above the header — so we pin with a NEGATIVE inset (`-top-4`, = the container's `p-4` top
            padding) so the header sticks flush to the pane's top edge, and its own `pt-4` fills that
            band. Horizontally it bleeds to the pane edges (`-mx-4 px-4`) and at rest it tucks under the
            pane header (`-mt-4`). The OPAQUE `bg-card` (matching the detail-pane / sheet surface — not
            the recessed `bg-background`) + a bottom border fully mask the scrolling body: no bleed. */}
        <div className="sticky -top-4 z-20 -mx-4 -mt-4 flex flex-col gap-3 border-b border-border bg-card px-4 pb-3 pt-4">
          {/* header */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1.5">
              <Text
                variant="code"
                as="span"
                className="truncate font-semibold"
                title={tool.toolName}
              >
                {tool.toolName}
              </Text>
              {/* one quiet metadata row: behavior chips + share% together */}
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="secondary">{formatPercent(tool.contributionPercent)} of scan</Badge>
                {badges.map((label) => (
                  <Badge key={label} variant="secondary">
                    {label}
                  </Badge>
                ))}
              </div>
            </div>
            {serverId ? (
              <Button className="shrink-0" onClick={() => setRunOpen(true)}>
                <Play aria-hidden />
                <span>Run</span>
              </Button>
            ) : null}
          </div>

          <ScrollableTabsList fullWidth>
            <TabsTrigger value="breakdown">Breakdown</TabsTrigger>
            <TabsTrigger value="tests">Tests</TabsTrigger>
            <TabsTrigger value="parameters">
              Parameters{params.length > 0 ? ` (${params.length})` : ""}
            </TabsTrigger>
            <TabsTrigger value="raw">Raw</TabsTrigger>
          </ScrollableTabsList>
        </div>

        {/* TESTS — tool-level compatibility tests × models */}
        <TabsContent value="tests" className="flex flex-col gap-3">
          <ToolTestsTab scanId={tool.scanId} toolName={tool.toolName} />
        </TabsContent>

        {/* BREAKDOWN — token budget → instructions. Findings + fixes live on the Tests tab. */}
        <TabsContent value="breakdown" className="flex flex-col gap-5">
          <section className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <Text variant="meta" tone="muted">
                Token budget
              </Text>
              <span className="flex items-baseline gap-2">
                {recoverable > 0 ? (
                  <Badge variant="success" className="tabular-nums">
                    ≈ {formatNumber(recoverable)} tok recoverable
                  </Badge>
                ) : null}
                <Text variant="meta" className="tabular-nums">
                  {formatNumber(tool.totalTokens)} tokens · {formatBytes(tool.rawBytes)}
                </Text>
              </span>
            </div>
            <SegmentedBar
              ariaLabel={`Token composition for ${tool.toolName}`}
              segments={[
                { label: "Name", value: tool.nameTokens },
                { label: "Description", value: tool.descriptionTokens },
                { label: "Schema", value: tool.schemaTokens },
                { label: "Annotations", value: tool.annotationsTokens },
              ]}
            />
          </section>

          <section className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <Text variant="meta" tone="muted">
                Instructions — what the model reads
              </Text>
              <Badge variant="secondary" className="tabular-nums">
                {formatNumber(tool.descriptionTokens)} tok
              </Badge>
            </div>
            <InstructionsBlock toolName={tool.toolName} description={description} />
          </section>
        </TabsContent>

        {/* PARAMETERS — required first, then optional (sorted above) */}
        <TabsContent value="parameters" className="flex flex-col gap-2">
          {params.length === 0 ? (
            <Text tone="muted">No input schema.</Text>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Parameter</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Req</TableHead>
                    <TableHead className="text-right">Tokens</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {params.map((p) => (
                    <TableRow key={p.name} className={cn(p.flags.length > 0 && "bg-warning/10")}>
                      <TableCell className="align-top">
                        <Text variant="code" as="div" className="font-medium">
                          {p.name}
                        </Text>
                        {p.enumValues ? (
                          <Text variant="meta" tone="muted" as="div" className="truncate">
                            {p.enumValues.slice(0, 8).join(", ")}
                            {p.enumValues.length > 8 ? "…" : ""}
                          </Text>
                        ) : p.description ? (
                          <Text variant="meta" tone="muted" as="div" className="line-clamp-2">
                            {p.description}
                          </Text>
                        ) : null}
                      </TableCell>
                      <TableCell className={cn("align-top", p.flags.length > 0 && "text-warning")}>
                        <Text
                          variant="caption"
                          tone={p.flags.length > 0 ? "default" : "muted"}
                          as="span"
                          className={cn(p.flags.length > 0 && "text-warning")}
                        >
                          {p.typeLabel}
                        </Text>
                      </TableCell>
                      <TableCell className="align-top text-right">
                        {p.required ? (
                          <Check className="ml-auto size-4 text-success" aria-label="required" />
                        ) : (
                          <Text tone="muted" as="span">
                            —
                          </Text>
                        )}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "align-top text-right tabular-nums",
                          p.flags.length > 0 && "text-warning",
                        )}
                      >
                        {formatNumber(p.tokens)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* RAW — input schema + tool JSON on the Monaco editor, with Expand */}
        <TabsContent value="raw" className="flex flex-col gap-3">
          <JsonViewer label="Input schema" value={safeJson(tool.inputSchema)} />
          <JsonViewer label="Tool definition" value={safeJson(tool.rawTool)} />
        </TabsContent>
      </Tabs>

      {serverId ? (
        <ToolRunDialog
          open={runOpen}
          onOpenChange={setRunOpen}
          serverId={serverId}
          toolName={tool.toolName}
          params={params}
          tokenProfile={tokenProfile}
        />
      ) : null}
    </div>
  );
}

/** Clamped instructions with an Expand affordance opening the full text in a read-only editor. */
function InstructionsBlock({ toolName, description }: { toolName: string; description: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-md bg-muted/40 p-3">
        <Text className="line-clamp-6 whitespace-pre-wrap break-words">{description}</Text>
      </div>
      <Button variant="ghost" size="sm" className="self-start" onClick={() => setOpen(true)}>
        <Maximize2 aria-hidden />
        <span>Expand</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="xl" className="max-h-[85vh] gap-0 overflow-hidden p-0">
          <DialogHeader className="gap-1 border-b border-border p-4 pe-12">
            <DialogTitle>Instructions</DialogTitle>
            <DialogDescription>
              Full description the model reads for{" "}
              <Text variant="code" as="span">
                {toolName}
              </Text>
              .
            </DialogDescription>
          </DialogHeader>
          {/* definite height so the editor (height="100%") has space to fill — the
              dialog base is display:grid, so a flex-1 child would collapse to 0. */}
          <div className="relative h-[70vh] w-full overflow-hidden">
            <div className="absolute inset-0">
              <CodeEditor
                value={description}
                language="markdown"
                readOnly
                height="100%"
                ariaLabel={`Instructions for ${toolName}`}
                options={{ ...READ_ONLY_OPTIONS, lineNumbers: "off" }}
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Read-only JSON viewer (Monaco) with an Expand button opening a larger editor in a Dialog. */
function JsonViewer({ label, value }: { label: string; value: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col overflow-hidden rounded-md border border-border">
      <div className="flex flex-none items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <Text variant="meta" tone="muted">
          {label}
        </Text>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setOpen(true)}
          aria-label={`Expand ${label}`}
        >
          <Maximize2 aria-hidden />
          <span>Expand</span>
        </Button>
      </div>
      {/* relative box + absolutely-positioned editor: keeps Monaco from inflating the
          width of its (display:table) ScrollArea ancestor and overflowing the panel. */}
      <div className="relative h-72 w-full overflow-hidden">
        <div className="absolute inset-0">
          <CodeEditor
            value={value}
            language="json"
            readOnly
            height="100%"
            ariaLabel={label}
            options={READ_ONLY_OPTIONS}
          />
        </div>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="xl" className="max-h-[85vh] gap-0 overflow-hidden p-0">
          <DialogHeader className="gap-1 border-b border-border p-4 pe-12">
            <DialogTitle>{label}</DialogTitle>
            <DialogDescription>Read-only JSON with collapsible nodes.</DialogDescription>
          </DialogHeader>
          {/* definite height so the editor (height="100%") has space to fill — the
              dialog base is display:grid, so a flex-1 child would collapse to 0. */}
          <div className="relative h-[70vh] w-full overflow-hidden">
            <div className="absolute inset-0">
              <CodeEditor
                value={value}
                language="json"
                readOnly
                height="100%"
                ariaLabel={`${label} (expanded)`}
                options={READ_ONLY_OPTIONS}
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function behaviorBadges(annotations: unknown): string[] {
  if (!annotations || typeof annotations !== "object") return [];
  const a = annotations as Record<string, unknown>;
  const out: string[] = [];
  if (a.readOnlyHint === true) out.push("read-only");
  if (a.destructiveHint === true) out.push("destructive");
  if (a.idempotentHint === true) out.push("idempotent");
  if (a.openWorldHint === true) out.push("open-world");
  return out;
}
