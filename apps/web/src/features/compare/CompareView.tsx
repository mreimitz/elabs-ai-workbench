import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import type {
  ComparedResource,
  ResourceKind,
  ResourceMatch,
  ScanComparison,
  ScanSummary,
  ServerConfig,
  ServerType,
  ServerTypeStatus,
  ToolDefinitionDelta,
  ToolMatchBasis,
} from "@mcp-token-footprint/shared";
import { DEFAULT_COMPARE_THRESHOLD } from "@mcp-token-footprint/shared";
import { DataTable, FacetFilter, SearchInput } from "@brand/data";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  cn,
  Heading,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatePanel,
  Switch,
  Text,
} from "@brand/ui";
import { ArrowLeftRight } from "lucide-react";
import { PageShell } from "../../components/PageShell";
import { TabPanel, TabPanelContent } from "../../components/TabPanel";
import { ViewToolbar } from "../../components/ViewToolbar";
import { IconButton } from "../../components/IconButton";
import { getErrorMessage } from "../../lib/errors";
import { DELTA_BADGE_VARIANT, deltaOutcome } from "../../lib/delta";
import { listServerTypes } from "../../lib/api";
import { SERVER_TYPE_STATUS_LABELS } from "../servers/serverTypeStatus";
import { col, stickyScrollTableProps } from "../../lib/table";
import { formatDateTime, formatNumber, formatPercent } from "../../lib/format";

type ChangeKind = "increased" | "decreased" | "added" | "removed" | "unchanged";

// Type-filter sentinels for the Compare server pickers (mirrors ServerRail) — kept distinct from
// any real nanoid type id.
const FILTER_ALL = "all";
const FILTER_UNTYPED = "untyped";

/** A server option for the A/B pickers, enriched (read-only, WP 4.1) with its resolved type +
 *  lifecycle status so the option copy shows "name · Type · Status" and de-emphasizes a deprecated
 *  fleet. `typeName`/`status` are null for an untyped (or dangling-typeId) server. */
type ServerOption = {
  value: string;
  label: string;
  typeName: string | null;
  status: ServerTypeStatus | null;
};

type DiffRow = {
  /** Display label for the entity column (both names when they differ across servers). */
  label: string;
  /** Resource kind ("Resource"/"Template") badge; null for tools and prompts. */
  kind: ResourceKind | null;
  beforeTokens: number;
  afterTokens: number;
  deltaTokens: number;
  change: ChangeKind;
  basis: ToolMatchBasis | null;
  similarity: number | null;
  /** What changed in the matched tool's definition (null for added/removed rows and for
   *  resources/prompts, which have no schema). */
  definitionDelta: ToolDefinitionDelta | null;
};

// Diff semantics (D-UX9 / audit C4): green = ADDED, red = REMOVED. Growth/shrink of a *matched*
// entity is a magnitude, not an add/remove, so Increased/Decreased render neutral here — the
// magnitude colour (red = more tokens) lives ONLY on the summary Δ metric card below.
const CHANGE_META: Record<
  ChangeKind,
  { label: string; variant: "success" | "destructive" | "secondary" | "outline" }
> = {
  increased: { label: "Increased", variant: "secondary" },
  decreased: { label: "Decreased", variant: "secondary" },
  added: { label: "Added", variant: "success" },
  removed: { label: "Removed", variant: "destructive" },
  unchanged: { label: "Unchanged", variant: "outline" },
};

const CHANGE_OPTIONS = (Object.keys(CHANGE_META) as ChangeKind[]).map((value) => ({
  value,
  label: CHANGE_META[value].label,
}));

const BASIS_LABEL: Record<ToolMatchBasis, string> = {
  exact: "Exact",
  normalized: "Normalized",
  fuzzy: "Fuzzy",
};

const KIND_LABEL: Record<ResourceKind, string> = {
  resource: "Resource",
  template: "Template",
};

// Word-first threshold labels — the raw 0.x similarity value is kept off the control face (audit
// F7) and surfaced only in the trigger's tooltip.
const THRESHOLD_OPTIONS = [
  { value: "0.2", label: "Very loose" },
  { value: "0.4", label: "Loose" },
  { value: "0.6", label: "Balanced" },
  { value: "0.8", label: "Strict" },
];

/** The definition facets we surface as Badges, in display order. */
const DEFINITION_FACETS: Array<{ key: keyof ToolDefinitionDelta; label: string }> = [
  { key: "descriptionChanged", label: "Desc" },
  { key: "schemaChanged", label: "Schema" },
  { key: "annotationsChanged", label: "Annot" },
];

/** The changed-facet labels for a definition delta (e.g. ["Desc", "Schema"]); [] if no change. */
function changedFacetLabels(delta: ToolDefinitionDelta | null): string[] {
  if (!delta) return [];
  return DEFINITION_FACETS.filter((facet) => delta[facet.key]).map((facet) => facet.label);
}

/** added/removed/matched counts a diff tab shows above its table. */
type DiffCounts = { matched: number; onlyInA: number; onlyInB: number };

/** Order rows: largest absolute change first (DataTable lets the user re-sort any column). */
function sortByImpact(rows: DiffRow[]): DiffRow[] {
  return [...rows].sort((left, right) => Math.abs(right.deltaTokens) - Math.abs(left.deltaTokens));
}

/** change classification for a matched pair from its token delta. */
function changeForDelta(deltaTokens: number): ChangeKind {
  return deltaTokens > 0 ? "increased" : deltaTokens < 0 ? "decreased" : "unchanged";
}

export function CompareView(props: {
  servers: ServerConfig[];
  scans: ScanSummary[];
  onCompare: (a: string, b: string, threshold: number) => Promise<ScanComparison>;
}) {
  const { onCompare } = props;

  const successScans = useMemo(
    () => props.scans.filter((scan) => scan.status === "success"),
    [props.scans],
  );

  const serverIdsWithScans = useMemo(() => {
    const ids = new Set(successScans.map((scan) => scan.serverId));
    return props.servers.filter((server) => ids.has(server.id)).map((server) => server.id);
  }, [props.servers, successScans]);

  const [serverA, setServerA] = useState("");
  const [serverB, setServerB] = useState("");
  const [scanAId, setScanAId] = useState("");
  const [scanBId, setScanBId] = useState("");
  const [threshold, setThreshold] = useState(DEFAULT_COMPARE_THRESHOLD);
  const [tab, setTab] = useState("tools");

  const [comparison, setComparison] = useState<ScanComparison | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Server types (roadmap/server-types) — self-fetched (WP 4.1): CompareView owns this small
  // directory itself (like other views fetch their own) rather than threading a prop through the
  // high-churn App.tsx. Read-only + best-effort: a missing/failed types API degrades to [] (no type
  // labels, no filter), never breaks the compare flow.
  const [serverTypes, setServerTypes] = useState<ServerType[]>([]);
  // Type filter for the A/B pickers: "all" (default), "untyped", or a concrete type id. Local UI
  // state only — it narrows which servers the pickers offer, nothing on the wire.
  const [typeFilter, setTypeFilter] = useState<string>(FILTER_ALL);

  useEffect(() => {
    let active = true;
    listServerTypes()
      .then((types) => {
        if (active) setServerTypes(types);
      })
      .catch(() => {
        // Best-effort: additive read-only surfacing — degrade to no type labels/filter.
      });
    return () => {
      active = false;
    };
  }, []);

  const typesById = useMemo(
    () => new Map(serverTypes.map((type) => [type.id, type] as const)),
    [serverTypes],
  );
  // A dangling `typeId` (its type was deleted) resolves to null → "Untyped", never crashes.
  const resolveType = useCallback(
    (server: ServerConfig): ServerType | null =>
      server.typeId ? (typesById.get(server.typeId) ?? null) : null,
    [typesById],
  );

  // Deep-link pre-fill (WP 3.1 "Diff vs previous"): a scan row can open Compare already pointed at
  // a specific pair via `?serverA=&serverB=&scanA=&scanB=`. Read once on mount; the values below act
  // as a PREFERENCE that outranks the arbitrary "first server / latest scan" defaults but is applied
  // only while a side is still empty/invalid — so the moment the target scans have loaded they win,
  // and the user's later manual edits win after that (each becomes the valid `current`). `serverB`
  // defaults to `serverA` (a same-server diff-vs-previous) when omitted.
  const [searchParams] = useSearchParams();
  const prefillRef = useRef({
    serverA: searchParams.get("serverA") ?? "",
    serverB: searchParams.get("serverB") ?? searchParams.get("serverA") ?? "",
    scanA: searchParams.get("scanA") ?? "",
    scanB: searchParams.get("scanB") ?? "",
  });

  // Seed BOTH sides to the SAME first server (C2): the app lands on a safe same-server diff
  // (its two latest scans), never an arbitrary cross-server pair that manufactures a scary
  // red delta before the user has chosen anything. The user opts into cross-server explicitly.
  // A valid deep-link server (prefillRef) is preferred over the arbitrary first server.
  useEffect(() => {
    const pick = (current: string, wanted: string) => {
      if (current && serverIdsWithScans.includes(current)) return current;
      if (wanted && serverIdsWithScans.includes(wanted)) return wanted;
      return serverIdsWithScans[0] ?? "";
    };
    setServerA((current) => pick(current, prefillRef.current.serverA));
    setServerB((current) => pick(current, prefillRef.current.serverB));
  }, [serverIdsWithScans]);

  const scansForA = useMemo(
    () => sortByNewest(successScans.filter((scan) => scan.serverId === serverA)),
    [successScans, serverA],
  );
  const scansForB = useMemo(
    () => sortByNewest(successScans.filter((scan) => scan.serverId === serverB)),
    [successScans, serverB],
  );

  // A defaults to the older scan, B to the newer scan (matches the historical Before/After diff).
  // A valid deep-link scan (prefillRef) is preferred over that default until the user picks.
  useEffect(() => {
    setScanAId((current) => {
      if (current && scansForA.some((scan) => scan.id === current)) return current;
      const wanted = prefillRef.current.scanA;
      if (wanted && scansForA.some((scan) => scan.id === wanted)) return wanted;
      return scansForA[1]?.id ?? scansForA[0]?.id ?? "";
    });
  }, [scansForA]);

  useEffect(() => {
    setScanBId((current) => {
      if (current && scansForB.some((scan) => scan.id === current)) return current;
      const wanted = prefillRef.current.scanB;
      if (wanted && scansForB.some((scan) => scan.id === wanted)) return wanted;
      return scansForB[0]?.id ?? "";
    });
  }, [scansForB]);

  useEffect(() => {
    if (!scanAId || !scanBId) {
      setComparison(null);
      setError(null);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);
    onCompare(scanAId, scanBId, threshold)
      .then((result) => {
        if (!active) return;
        setComparison(result);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setComparison(null);
        setError(getErrorMessage(cause, "Couldn’t compare the scans."));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [scanAId, scanBId, threshold, onCompare]);

  const showMatchColumn = comparison ? !comparison.sameServer : false;

  // Tools: Before = a.totalTokens, After = b.totalTokens, Δ = deltaTokens (matched);
  // added rows Before 0 / After totalTokens; removed rows Before totalTokens / After 0.
  const toolRows = useMemo<DiffRow[]>(() => {
    if (!comparison) return [];
    return sortByImpact([
      ...comparison.matched.map((match): DiffRow => {
        const sameName = match.a.toolName === match.b.toolName;
        return {
          label: sameName ? match.a.toolName : `${match.a.toolName} → ${match.b.toolName}`,
          kind: null,
          beforeTokens: match.a.totalTokens,
          afterTokens: match.b.totalTokens,
          deltaTokens: match.deltaTokens,
          change: changeForDelta(match.deltaTokens),
          basis: match.basis,
          similarity: match.similarity,
          definitionDelta: match.definitionDelta,
        };
      }),
      ...comparison.onlyInB.map(
        (tool): DiffRow => ({
          label: tool.toolName,
          kind: null,
          beforeTokens: 0,
          afterTokens: tool.totalTokens,
          deltaTokens: tool.totalTokens,
          change: "added",
          basis: null,
          similarity: null,
          definitionDelta: null,
        }),
      ),
      ...comparison.onlyInA.map(
        (tool): DiffRow => ({
          label: tool.toolName,
          kind: null,
          beforeTokens: tool.totalTokens,
          afterTokens: 0,
          deltaTokens: -tool.totalTokens,
          change: "removed",
          basis: null,
          similarity: null,
          definitionDelta: null,
        }),
      ),
    ]);
  }, [comparison]);

  const resourceRows = useMemo<DiffRow[]>(() => {
    if (!comparison) return [];
    return sortByImpact([
      ...comparison.resourceMatched.map(
        (match): DiffRow => ({
          label: resourceMatchLabel(match),
          kind: match.b.kind,
          beforeTokens: match.a.totalTokens,
          afterTokens: match.b.totalTokens,
          deltaTokens: match.deltaTokens,
          change: changeForDelta(match.deltaTokens),
          basis: match.basis,
          similarity: match.similarity,
          definitionDelta: null,
        }),
      ),
      ...comparison.resourceOnlyInB.map(
        (resource): DiffRow => ({
          label: resourceLabel(resource),
          kind: resource.kind,
          beforeTokens: 0,
          afterTokens: resource.totalTokens,
          deltaTokens: resource.totalTokens,
          change: "added",
          basis: null,
          similarity: null,
          definitionDelta: null,
        }),
      ),
      ...comparison.resourceOnlyInA.map(
        (resource): DiffRow => ({
          label: resourceLabel(resource),
          kind: resource.kind,
          beforeTokens: resource.totalTokens,
          afterTokens: 0,
          deltaTokens: -resource.totalTokens,
          change: "removed",
          basis: null,
          similarity: null,
          definitionDelta: null,
        }),
      ),
    ]);
  }, [comparison]);

  const promptRows = useMemo<DiffRow[]>(() => {
    if (!comparison) return [];
    return sortByImpact([
      ...comparison.promptMatched.map(
        (match): DiffRow => ({
          label:
            match.a.promptName === match.b.promptName
              ? match.a.promptName
              : `${match.a.promptName} → ${match.b.promptName}`,
          kind: null,
          beforeTokens: match.a.totalTokens,
          afterTokens: match.b.totalTokens,
          deltaTokens: match.deltaTokens,
          change: changeForDelta(match.deltaTokens),
          basis: match.basis,
          similarity: match.similarity,
          definitionDelta: null,
        }),
      ),
      ...comparison.promptOnlyInB.map(
        (prompt): DiffRow => ({
          label: prompt.promptName,
          kind: null,
          beforeTokens: 0,
          afterTokens: prompt.totalTokens,
          deltaTokens: prompt.totalTokens,
          change: "added",
          basis: null,
          similarity: null,
          definitionDelta: null,
        }),
      ),
      ...comparison.promptOnlyInA.map(
        (prompt): DiffRow => ({
          label: prompt.promptName,
          kind: null,
          beforeTokens: prompt.totalTokens,
          afterTokens: 0,
          deltaTokens: -prompt.totalTokens,
          change: "removed",
          basis: null,
          similarity: null,
          definitionDelta: null,
        }),
      ),
    ]);
  }, [comparison]);

  // Whether the two SELECTED sides are the same server (known before the compare returns) — drives
  // the Baseline/Comparison vs. before/after framing (C2). `comparison.sameServer` is the
  // authoritative post-fetch signal; this is the pre-fetch label hint.
  const sameServerSelected = serverA !== "" && serverA === serverB;

  // The inline fuzzy-match control (cross-server only) affects all three diffs — it re-runs
  // onCompare with the new threshold — so it lives once in each tab's toolbar via this shared slot.
  // Word-first ("Fuzzy: Balanced"); the raw threshold value stays in the trigger tooltip (F7).
  const fuzzyControl =
    comparison && !comparison.sameServer ? (
      <Select value={String(threshold)} onValueChange={(value) => setThreshold(Number(value))}>
        <SelectTrigger
          size="sm"
          className="w-auto gap-1"
          aria-label="Fuzzy match threshold"
          title="Similarity threshold for pairing tools across two different servers (0.2 loose – 0.8 strict)."
        >
          <span className="text-muted-foreground">Fuzzy:</span>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {THRESHOLD_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    ) : null;

  // The servers eligible for compare (those with at least one successful scan), in the incoming
  // server order — the base set the type filter and the pickers both draw from.
  const eligibleServers = useMemo(
    () => props.servers.filter((server) => serverIdsWithScans.includes(server.id)),
    [props.servers, serverIdsWithScans],
  );

  // Filter options derive from the eligible fleet (not the current pick) so the control never drops
  // a choice mid-use. Only types actually in use appear, plus an "Untyped" option when some eligible
  // server has no (known) type — and the whole control is hidden when there's nothing to group by.
  const usedTypeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const server of eligibleServers) {
      const type = resolveType(server);
      if (type) ids.add(type.id);
    }
    return ids;
  }, [eligibleServers, resolveType]);
  const typesInUse = useMemo(
    () => serverTypes.filter((type) => usedTypeIds.has(type.id)),
    [serverTypes, usedTypeIds],
  );
  const hasUntyped = useMemo(
    () => eligibleServers.some((server) => resolveType(server) === null),
    [eligibleServers, resolveType],
  );
  const showTypeFilter = typesInUse.length > 0;
  // Keep the selected filter valid if its type stops being in use.
  const effectiveTypeFilter =
    typeFilter === FILTER_ALL ||
    (typeFilter === FILTER_UNTYPED && hasUntyped) ||
    usedTypeIds.has(typeFilter)
      ? typeFilter
      : FILTER_ALL;

  const serverOptions = useMemo<ServerOption[]>(() => {
    const matches = (server: ServerConfig): boolean => {
      if (effectiveTypeFilter === FILTER_ALL) return true;
      if (effectiveTypeFilter === FILTER_UNTYPED) return resolveType(server) === null;
      return resolveType(server)?.id === effectiveTypeFilter;
    };
    // Narrow to the filter, but ALWAYS keep the current A/B selections selectable so each picker's
    // trigger keeps reflecting its value even when the filter would otherwise hide it (mirrors the
    // model-picker "append the current value" rule).
    return eligibleServers
      .filter((server) => matches(server) || server.id === serverA || server.id === serverB)
      .map((server) => {
        const type = resolveType(server);
        return {
          value: server.id,
          label: server.name,
          typeName: type?.name ?? null,
          status: type?.status ?? null,
        };
      });
  }, [eligibleServers, resolveType, effectiveTypeFilter, serverA, serverB]);

  // The type-filter Select, mounted into the compact compare bar; null when nothing to group by so
  // Compare degrades to today's behavior for an untyped fleet.
  const typeFilterControl = showTypeFilter ? (
    <Select value={effectiveTypeFilter} onValueChange={setTypeFilter}>
      <SelectTrigger size="sm" className="w-36" aria-label="Filter servers by type">
        <SelectValue placeholder="All types" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={FILTER_ALL}>All types</SelectItem>
        {typesInUse.map((type) => (
          <SelectItem key={type.id} value={type.id}>
            {type.name}
          </SelectItem>
        ))}
        {hasUntyped ? <SelectItem value={FILTER_UNTYPED}>Untyped</SelectItem> : null}
      </SelectContent>
    </Select>
  ) : null;

  const scanOptionsA = scansForA.map((scan) => ({ value: scan.id, label: scanLabel(scan) }));
  const scanOptionsB = scansForB.map((scan) => ({ value: scan.id, label: scanLabel(scan) }));

  const bothChosen = Boolean(scanAId && scanBId);

  // F7: swap the two sides (standard diff affordance) — server + scan move together.
  const swapSides = () => {
    setServerA(serverB);
    setServerB(serverA);
    setScanAId(scanBId);
    setScanBId(scanAId);
  };

  return (
    // WP 6.4 — `scroll="fill"`: the compact selection bar + (cross-profile) alert + the tab strip and
    // each tab's diff toolbar are the FIXED chrome; only the diff table scrolls internally (audit §S22;
    // owner finding #3). The two big Scan-A / Scan-B selector boxes are gone — everything the user picks
    // now lives on the slim `ScanCompareBar` so the diff gets the full content area.
    <PageShell
      width="full"
      scroll="fill"
      contentClassName="gap-3"
      // TB.5 — the A/B ScanCompareBar (WP 6.4) IS the ONE toolbar row now (toolbar standard
      // 2026-07-11): it moves into the `headerVariant="toolbar"` slot — the same idiom the runs
      // Compare Workspace mounts its `CompareBar` in — which supplies the bg-card lift, bottom
      // border and gutter, so the bar sheds its own frame below. D-TB1: the "Compare scans" title +
      // description block is dropped (the breadcrumb names the page); a body sr-only <h1> keeps it a
      // named heading for AT. The net Δ-tokens readout stays pinned to the bar's right.
      headerVariant="toolbar"
      header={
        <ScanCompareBar
          serverA={serverA}
          serverB={serverB}
          scanAId={scanAId}
          scanBId={scanBId}
          typeFilterControl={typeFilterControl}
          serverOptions={serverOptions}
          scanOptionsA={scanOptionsA}
          scanOptionsB={scanOptionsB}
          onServerAChange={setServerA}
          onServerBChange={setServerB}
          onScanAChange={setScanAId}
          onScanBChange={setScanBId}
          onPickLatestA={() => setScanAId(scansForA[0]?.id ?? "")}
          onPickLatestB={() => setScanBId(scansForB[0]?.id ?? "")}
          eligibleA={scansForA.length}
          eligibleB={scansForB.length}
          sameServerSelected={sameServerSelected}
          onSwap={swapSides}
          canSwap={Boolean(serverA || serverB)}
          comparison={comparison}
        />
      }
    >
      {/* D-TB1 — the breadcrumb names the page; keep an H1 for AT only. */}
      <Heading level={1} className="sr-only">
        Compare scans
      </Heading>

      {/* Cross-profile note: deltas also reflect tokenizer differences (non-blocking). Pinned chrome. */}
      {comparison && !comparison.sameProfile ? (
        <Alert variant="warning" className="shrink-0">
          <AlertTitle>Comparing across token profiles</AlertTitle>
          <AlertDescription>
            Scan A used {comparison.a.tokenProfile} and Scan B used {comparison.b.tokenProfile}.
            Deltas also reflect tokenizer differences, not only the tool surface.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col">
        {loading ? (
          <CenteredState>
            <StatePanel kind="loading" title="Comparing scans…" loadingLabel="Comparing scans…" />
          </CenteredState>
        ) : error ? (
          <CenteredState>
            <StatePanel
              kind="error"
              title="Couldn’t compare the scans."
              description={`${error} Try again.`}
            />
          </CenteredState>
        ) : comparison ? (
          // C3: one diff table per surface — Tools / Resources / Prompts — on the shared full-width
          // centered tab strip (D-UX16). The strip + each tab's toolbar are fixed; the table scrolls.
          <TabPanel
            value={tab}
            onValueChange={setTab}
            tabs={[
              { value: "tools", label: "Tools", count: totalCount(comparison.counts) },
              {
                value: "resources",
                label: "Resources",
                count: totalCount(comparison.resourceCounts),
              },
              { value: "prompts", label: "Prompts", count: totalCount(comparison.promptCounts) },
            ]}
          >
            <TabPanelContent value="tools" scroll={false}>
              <DiffTable
                rows={toolRows}
                counts={comparison.counts}
                showMatchColumn={showMatchColumn}
                showDefinitionColumn
                entityLabel="tool"
                emptyMessage="No tools to compare."
                fuzzyControl={fuzzyControl}
              />
            </TabPanelContent>

            <TabPanelContent value="resources" scroll={false}>
              <DiffTable
                rows={resourceRows}
                counts={comparison.resourceCounts}
                showMatchColumn={showMatchColumn}
                entityLabel="resource"
                emptyMessage="No resources to compare."
                fuzzyControl={fuzzyControl}
              />
            </TabPanelContent>

            <TabPanelContent value="prompts" scroll={false}>
              <DiffTable
                rows={promptRows}
                counts={comparison.promptCounts}
                showMatchColumn={showMatchColumn}
                entityLabel="prompt"
                emptyMessage="No prompts to compare."
                fuzzyControl={fuzzyControl}
              />
            </TabPanelContent>
          </TabPanel>
        ) : (
          <CenteredState>
            <StatePanel
              kind="empty"
              title={
                successScans.length === 0
                  ? "No scans to compare yet"
                  : bothChosen
                    ? "Pick two scans"
                    : "Pick a scan on each side"
              }
              description={
                successScans.length === 0
                  ? "Run a discovery scan on at least one server, then return here to diff two scans."
                  : "Select a successful scan for A and B (the same server over time, or two different servers) to compare their token footprint — tools, resources, and prompts."
              }
            />
          </CenteredState>
        )}
      </div>
    </PageShell>
  );
}

/** Vertically-centres a StatePanel inside the fill content region (loading / error / empty). */
function CenteredState({ children }: { children: ReactNode }) {
  return <div className="flex min-h-0 flex-1 items-center justify-center">{children}</div>;
}

/**
 * The compact scan-compare bar (owner finding #3) — the same slim top-bar idiom the RUNS compare
 * workspace uses ({@link ../../testing/compare/CompareBar}), adapted to scans: a slim row with the
 * A / B sides (each a server + scan picker, a "Latest" quick-pick and its eligible-scan count),
 * a swap between them, and the net Δ-tokens summary pinned right. It replaces the two big Scan-A /
 * Scan-B selector boxes so the diff table gets the full content area. Pure control surface — every
 * action is a callback the view turns into state (nothing here scrolls or fetches directly).
 */
function ScanCompareBar(props: {
  serverA: string;
  serverB: string;
  scanAId: string;
  scanBId: string;
  /** The type-filter Select (WP 4.1); null when no type is in use → the control is hidden. */
  typeFilterControl: ReactNode;
  serverOptions: ServerOption[];
  scanOptionsA: { value: string; label: string }[];
  scanOptionsB: { value: string; label: string }[];
  onServerAChange: (value: string) => void;
  onServerBChange: (value: string) => void;
  onScanAChange: (value: string) => void;
  onScanBChange: (value: string) => void;
  onPickLatestA: () => void;
  onPickLatestB: () => void;
  eligibleA: number;
  eligibleB: number;
  sameServerSelected: boolean;
  onSwap: () => void;
  canSwap: boolean;
  comparison: ScanComparison | null;
}) {
  return (
    // TB.5 — frame-light wrapper: mounted in the PageShell `headerVariant="toolbar"` slot, which
    // supplies the bg-card lift, bottom border and gutter (matching the runs `CompareBar` idiom);
    // the bar owns only its own row rhythm, never its own card frame.
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {props.typeFilterControl ? (
        <div className="shrink-0">{props.typeFilterControl}</div>
      ) : null}
      <ScanSide
        letter="A"
        heading={props.sameServerSelected ? "Earlier" : "Baseline"}
        serverValue={props.serverA}
        serverOptions={props.serverOptions}
        onServerChange={props.onServerAChange}
        scanValue={props.scanAId}
        scanOptions={props.scanOptionsA}
        onScanChange={props.onScanAChange}
        onPickLatest={props.onPickLatestA}
        eligibleCount={props.eligibleA}
      />

      <IconButton
        variant="outline"
        size="icon"
        className="shrink-0"
        onClick={props.onSwap}
        disabled={!props.canSwap}
        disabledReason="Pick a server on at least one side to swap."
        label="Swap A and B"
      >
        <ArrowLeftRight aria-hidden />
      </IconButton>

      <ScanSide
        letter="B"
        heading={props.sameServerSelected ? "Later" : "Comparison"}
        serverValue={props.serverB}
        serverOptions={props.serverOptions}
        onServerChange={props.onServerBChange}
        scanValue={props.scanBId}
        scanOptions={props.scanOptionsB}
        onScanChange={props.onScanBChange}
        onPickLatest={props.onPickLatestB}
        eligibleCount={props.eligibleB}
      />

      {props.comparison ? (
        <div className="ml-auto">
          <DeltaSummary comparison={props.comparison} />
        </div>
      ) : null}
    </div>
  );
}

/** One side (A or B) of the compact bar: a letter chip + earlier/later (or baseline/comparison)
 *  label, a slim server + scan `Select` pair, a "Latest" quick-pick (F7) and the eligible-scan
 *  count inline (C3). */
function ScanSide(props: {
  letter: "A" | "B";
  heading: string;
  serverValue: string;
  serverOptions: ServerOption[];
  onServerChange: (value: string) => void;
  scanValue: string;
  scanOptions: { value: string; label: string }[];
  onScanChange: (value: string) => void;
  onPickLatest: () => void;
  eligibleCount: number;
}) {
  const noScans = props.eligibleCount === 0;
  // C-4: the closed select used to inherit the whole option row (name + type/status suffix) as its
  // displayed value, so the 38-char "acme-demo · acme-saas · Production" string got clipped to
  // "· acme-saas · Pro…" — the server name, the only thing that distinguishes A from B, was the part
  // that disappeared. Fix: look up the selected option ourselves, show ONLY the name inside the
  // (now-wider) select via an explicit `SelectValue` child (overriding Radix's default projection of
  // the option's full node), and move type/environment out to a secondary Badge beside the select.
  const selectedOption = props.serverOptions.find((option) => option.value === props.serverValue);
  const typeEnvLabel = selectedOption
    ? [
        selectedOption.typeName,
        selectedOption.status ? SERVER_TYPE_STATUS_LABELS[selectedOption.status] : null,
      ]
        .filter((part): part is string => Boolean(part))
        .join(" · ")
    : "";
  const fullTitle = selectedOption
    ? [selectedOption.label, typeEnvLabel].filter(Boolean).join(" · ")
    : undefined;
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Badge variant="outline" className="shrink-0 font-mono" title={props.heading}>
        {props.letter}
      </Badge>
      <Text variant="meta" tone="muted" className="hidden shrink-0 whitespace-nowrap sm:inline">
        {props.heading}
      </Text>
      <Select value={props.serverValue} onValueChange={props.onServerChange}>
        <SelectTrigger
          size="sm"
          className="w-56"
          aria-label={`Server ${props.letter}`}
          title={fullTitle}
        >
          <SelectValue placeholder="Server…">
            {selectedOption ? <span className="truncate">{selectedOption.label}</span> : undefined}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {props.serverOptions.map((option) => (
            // Read-only type/status surfacing (WP 4.1): "name · Type · Status" as a compact muted
            // suffix (a Badge doesn't sit cleanly inside a Select option). A deprecated fleet reads
            // fully de-emphasized. `textValue` keeps typeahead matching on the server name.
            <SelectItem key={option.value} value={option.value} textValue={option.label}>
              <span
                className={cn(
                  "flex min-w-0 items-center gap-1.5",
                  option.status === "deprecated" && "text-muted-foreground",
                )}
              >
                <span className="truncate">{option.label}</span>
                {option.typeName || option.status ? (
                  <span className="shrink-0 text-muted-foreground">
                    {option.typeName ? ` · ${option.typeName}` : ""}
                    {option.status ? ` · ${SERVER_TYPE_STATUS_LABELS[option.status]}` : ""}
                  </span>
                ) : null}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {typeEnvLabel ? (
        // C-4 fix: the discriminating server name now lives (unclipped) inside the select; the
        // type/environment info that used to be crammed in beside it moves here, outside the
        // control, as its own secondary chip.
        <Badge variant="secondary" className="hidden shrink-0 md:inline-flex" title={typeEnvLabel}>
          {typeEnvLabel}
        </Badge>
      ) : null}
      <Select value={props.scanValue} onValueChange={props.onScanChange} disabled={noScans}>
        <SelectTrigger
          size="sm"
          className="w-52"
          aria-label={`Scan ${props.letter}`}
          title={
            noScans
              ? "No successful scans on this server."
              : `${props.eligibleCount} eligible scan${props.eligibleCount === 1 ? "" : "s"}`
          }
        >
          <SelectValue placeholder={noScans ? "No scans" : "Scan…"} />
        </SelectTrigger>
        <SelectContent>
          {props.scanOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        variant="ghost"
        size="sm"
        className="shrink-0"
        onClick={props.onPickLatest}
        disabled={noScans}
      >
        Latest
      </Button>
      <Text
        variant="meta"
        tone="muted"
        className="hidden shrink-0 whitespace-nowrap tabular-nums lg:inline"
      >
        {noScans ? "no scans" : `${props.eligibleCount} eligible`}
      </Text>
    </div>
  );
}

/** The net token-delta summary pinned to the right of the bar. Its tone comes from the ONE delta
 *  authority (`lib/delta.ts`, D-IC3/D-UX9): MORE tokens is worse → amber (`warning`), fewer is better
 *  → green (`success`), a tie stays `secondary` — the same magnitude convention as every other Δ. */
function DeltaSummary({ comparison }: { comparison: ScanComparison }) {
  const delta = comparison.totalsDeltaTokens;
  // Tokens: lower is better, so a positive Δ (growth) is the WORSE outcome → amber.
  const variant = DELTA_BADGE_VARIANT[deltaOutcome(delta, false)];
  return (
    <div className="flex items-center gap-2">
      <Text variant="meta" tone="muted" className="whitespace-nowrap">
        Δ tokens
      </Text>
      <Badge variant={variant} className="gap-1 tabular-nums">
        <span>{formatSigned(delta)}</span>
        <span className="opacity-80">· {formatPercent(comparison.totalsDeltaPercent)}</span>
      </Badge>
    </div>
  );
}

/** The shared diff-table renderer: a ViewToolbar + DataTable used by the Tools, Resources, and
 *  Prompts tabs. Each instance owns its own search + Change-filter + "changes only" state. */
function DiffTable(props: {
  rows: DiffRow[];
  counts: DiffCounts;
  /** Cross-server: show the Match column (basis + similarity %). */
  showMatchColumn: boolean;
  /** Tools only: show the Definition column (desc/schema/annotations facets). */
  showDefinitionColumn?: boolean;
  /** Header label for the entity column ("tool"/"resource"/"prompt"); also the search hint noun. */
  entityLabel: "tool" | "resource" | "prompt";
  /** Real empty state when this tab has zero rows to compare at all. */
  emptyMessage: string;
  /** Cross-server inline fuzzy-match control (shared threshold); null on same-server. */
  fuzzyControl: ReactNode;
}) {
  const {
    rows,
    counts,
    showMatchColumn,
    showDefinitionColumn,
    entityLabel,
    emptyMessage,
    fuzzyControl,
  } = props;

  const [search, setSearch] = useState("");
  const [changeFilter, setChangeFilter] = useState<string[]>([]);
  // C5: default to "changes only" — a zero-diff comparison shouldn't open on pages of Unchanged rows.
  const [hideUnchanged, setHideUnchanged] = useState(true);

  const entityHeader = entityLabel.charAt(0).toUpperCase() + entityLabel.slice(1);

  // Is there ANY real difference on this surface? (added/removed/increased/decreased)
  const hasAnyDifference = useMemo(() => rows.some((row) => row.change !== "unchanged"), [rows]);

  const visibleRows = useMemo(
    () =>
      rows.filter((row) => {
        if (hideUnchanged && row.change === "unchanged") return false;
        if (changeFilter.length > 0 && !changeFilter.includes(row.change)) return false;
        return true;
      }),
    [rows, changeFilter, hideUnchanged],
  );

  const columns = useMemo(() => {
    const entityColumn = col<DiffRow>({
      id: "entity",
      header: entityHeader,
      value: (row) => row.label,
      cell: (row) => (
        <span className="flex min-w-0 items-center gap-1.5">
          {row.kind ? <Badge variant="outline">{KIND_LABEL[row.kind]}</Badge> : null}
          <span className="truncate font-mono text-code">{row.label}</span>
        </span>
      ),
    });

    // Cross-server: how each row's two entities were paired (basis + similarity). Only-in-A/B
    // rows have no pairing, so they render a neutral em dash.
    const matchColumn = col<DiffRow>({
      id: "match",
      header: "Match",
      value: (row) =>
        row.basis ? `${BASIS_LABEL[row.basis]} ${Math.round((row.similarity ?? 0) * 100)}` : "",
      cell: (row) =>
        row.basis ? (
          <span className="flex items-center gap-1.5">
            <Badge variant="outline">{BASIS_LABEL[row.basis]}</Badge>
            <span className="text-muted-foreground tabular-nums">
              {formatPercent((row.similarity ?? 0) * 100)}
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    });

    const valueColumns = [
      col<DiffRow>({
        id: "before",
        header: "Before",
        numeric: true,
        value: (row) => row.beforeTokens,
      }),
      col<DiffRow>({
        id: "after",
        header: "After",
        numeric: true,
        value: (row) => row.afterTokens,
      }),
      // Per-row Δ is a plain signed magnitude (no colour): the add/remove semantics live in the
      // Change chip, and the magnitude-red convention is reserved for the summary metric (C4/D-UX9).
      col<DiffRow>({
        id: "delta",
        header: "Δ",
        numeric: true,
        value: (row) => row.deltaTokens,
        cell: (row) => formatSigned(row.deltaTokens),
      }),
      col<DiffRow>({
        id: "change",
        header: "Change",
        value: (row) => row.change,
        cell: (row) => (
          <Badge variant={CHANGE_META[row.change].variant}>{CHANGE_META[row.change].label}</Badge>
        ),
      }),
    ];

    // Definition column (tools only). Surfaces which facets of a matched tool's *definition*
    // changed (description / schema / annotations); a muted em-dash when nothing changed or the
    // row has no pairing (added/removed).
    const definitionColumn = col<DiffRow>({
      id: "definition",
      header: "Definition",
      value: (row) => changedFacetLabels(row.definitionDelta).join(" "),
      cell: (row) => {
        const labels = changedFacetLabels(row.definitionDelta);
        if (labels.length === 0) return <span className="text-muted-foreground">—</span>;
        return (
          <span className="flex flex-wrap items-center gap-1.5">
            {labels.map((label) => (
              <Badge key={label} variant="outline">
                {label}
              </Badge>
            ))}
          </span>
        );
      },
    });

    return [
      entityColumn,
      ...(showMatchColumn ? [matchColumn] : []),
      ...valueColumns,
      ...(showDefinitionColumn ? [definitionColumn] : []),
    ];
  }, [showMatchColumn, showDefinitionColumn, entityHeader]);

  // Nothing on either side for this surface — a real empty state (e.g. tools-only servers have
  // no resources/prompts to compare). Centred in the fill region.
  if (rows.length === 0) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center">
        <StatePanel
          kind="empty"
          title={`No ${entityLabel}s to compare`}
          description={emptyMessage}
        />
      </div>
    );
  }

  // C5: rows exist but every one is Unchanged (a zero-diff comparison — e.g. a scan vs. itself).
  // Show an explicit "no differences" state instead of pages of Unchanged rows.
  if (!hasAnyDifference) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center">
        <StatePanel
          kind="empty"
          title="No differences between these scans"
          description={`Scan A and Scan B have an identical ${entityLabel} footprint — nothing was added, removed, or changed.`}
        />
      </div>
    );
  }

  return (
    // Fill the tab body: the toolbar is fixed chrome (`shrink-0`); the table owns the only scroll
    // (`flex-1 min-h-0`) with a sticky header via `stickyScrollTableProps` (WP 6.4 · audit §S22).
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-3">
      {/* The ONE aligned toolbar row (D-TB6/D-TB7 · ViewToolbar / C3): search · Change · Changes-only
          · Fuzzy …spacer… counts. */}
      <ViewToolbar
        className="shrink-0"
        left={
          <>
            <SearchInput
              value={search}
              onValueChange={setSearch}
              placeholder={`Filter ${entityLabel}s…`}
              label={`Filter ${entityLabel}s`}
            />
            <FacetFilter
              title="Change"
              options={CHANGE_OPTIONS}
              selected={changeFilter}
              onSelectedChange={setChangeFilter}
            />
            <label className="flex items-center gap-2 text-meta text-muted-foreground">
              <Switch
                checked={hideUnchanged}
                onCheckedChange={setHideUnchanged}
                aria-label="Show changed rows only"
              />
              <span>Changes only</span>
            </label>
            {/* Same-server matching is exact/normalized, so the fuzzy threshold is a no-op there —
                only present when comparing two different servers. */}
            {fuzzyControl}
          </>
        }
        actions={
          <>
            <Badge variant={counts.onlyInB > 0 ? "success" : "secondary"}>
              {counts.onlyInB} added
            </Badge>
            <Badge variant={counts.onlyInA > 0 ? "destructive" : "secondary"}>
              {counts.onlyInA} removed
            </Badge>
            <Badge variant="outline">{counts.matched} matched</Badge>
          </>
        }
      />
      {/* The diff table fills the remaining height and scrolls internally (sticky header via
          `stickyScrollTableProps` — row virtualization is what gives @brand/data its sticky thead;
          it supersedes pagination, which is the intent under `scroll="fill"`). */}
      <div className="min-h-0 flex-1">
        <DataTable
          data={visibleRows}
          columns={columns}
          className="h-full"
          {...stickyScrollTableProps()}
          globalFilter={search}
          onGlobalFilterChange={setSearch}
          initialView={{ sorting: [{ id: "delta", desc: true }] }}
          emptyMessage={
            <StatePanel
              kind="empty"
              title={`No ${entityLabel}s match`}
              description={`Adjust the search or filters to see ${entityLabel}-level differences.`}
            />
          }
        />
      </div>
    </div>
  );
}

/** matched+added+removed total a tab trigger shows in its count. */
function totalCount(counts: DiffCounts): number {
  return counts.matched + counts.onlyInA + counts.onlyInB;
}

/** Resource label: name when present, else uri. */
function resourceLabel(resource: ComparedResource): string {
  return resource.name ?? resource.uri;
}

/** matched resource label: prefer names; for cross-server pairs whose uris differ, show a → b. */
function resourceMatchLabel(match: ResourceMatch): string {
  const left = resourceLabel(match.a);
  const right = resourceLabel(match.b);
  if (match.a.uri !== match.b.uri) {
    // The uris differ — show both so the pairing is legible (mirrors the differing-name tool label).
    return `${left} → ${right}`;
  }
  return left;
}

function scanLabel(scan: ScanSummary): string {
  return `${formatDateTime(scan.scannedAt)} · ${formatNumber(scan.totalTokens)} tok`;
}

function sortByNewest(scans: ScanSummary[]): ScanSummary[] {
  return [...scans].sort((left, right) => Date.parse(right.scannedAt) - Date.parse(left.scannedAt));
}

function formatSigned(value: number): string {
  return `${value > 0 ? "+" : ""}${formatNumber(value)}`;
}
