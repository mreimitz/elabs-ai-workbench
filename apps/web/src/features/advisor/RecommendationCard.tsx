import { useState } from "react";
import { Link } from "react-router-dom";
import type { AdvisorEvidenceKind, AdvisorRecommendation } from "@mcp-token-footprint/shared";
import {
  Badge,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Text,
} from "@elabs-ai/components-ui";
import {
  Boxes,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  PlayCircle,
  ScanLine,
  Server,
  Sparkles,
  TrendingDown,
  Wrench,
} from "lucide-react";
import { advisorEvidenceHref, advisorEvidenceKindLabel } from "./advisor-evidence";
import { ADVISOR_SEVERITY_META, advisorRuleLabel, formatAdvisorSavings } from "./advisor-format";

/**
 * One advisor recommendation, rendered as an evidenced suggestion — never an action.
 * =============================================================================================
 * The card is deliberately shaped around the README's four invariants, in reading order:
 *   1. severity chip + title — what the advisor is flagging;
 *   2. the ESTIMATE block — labelled as an estimate in the sentence itself (not only by a chip),
 *      with the rule's own `basis` printed underneath so the number is reproducible by hand;
 *   3. assumptions — what the suggestion takes for granted, stated plainly;
 *   4. evidence — the scans/runs/tools/servers it was derived from, as real links.
 * There is no "apply" affordance anywhere on it, by design: the app never auto-applies advice.
 *
 * Bordered `<li>` on the flat surface (the `IssuesPanel` recipe) rather than a `Card`, so a panel
 * embedded inside an existing Card/tab body never nests cards.
 */
export function RecommendationCard({ recommendation }: { recommendation: AdvisorRecommendation }) {
  const severity = ADVISOR_SEVERITY_META[recommendation.severity];
  const savings = recommendation.savings ? formatAdvisorSavings(recommendation.savings) : null;
  // RM-36 WP 1.1 (audit P1-1): the rules inline their enumerated tool names into the detail prose,
  // which on a large server is ~350 words of identifiers between the sentence and its estimate.
  // The names stay in the card — behind a disclosure — and the argument stays readable.
  const { prose, lists } = splitDetailNameLists(recommendation.detail);

  return (
    <li className="flex flex-col gap-2 rounded-md border border-border bg-muted/20 p-3">
      {/* Chip row — severity is this feature's own dimension → semantic-variant Badge + TEXT label
          (never colour alone), alongside the rule that produced the finding. */}
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <Badge variant={severity.variant}>{severity.label}</Badge>
        <Badge variant="outline">{advisorRuleLabel(recommendation.ruleId)}</Badge>
      </div>

      <Text className="break-words font-medium text-pretty">{recommendation.title}</Text>
      {prose ? (
        <Text variant="meta" tone="muted" className="break-words text-pretty">
          {prose}
        </Text>
      ) : null}

      {/* ── The enumerations the detail names, as chips behind a counted disclosure. ── */}
      {lists.length > 0 ? (
        <div className="flex flex-col gap-2">
          {lists.map((list) => (
            <DetailNameList key={list.marker} list={list} />
          ))}
        </div>
      ) : null}

      {/* ── The estimate. Present only when the rule could name a defensible number AND its basis. ── */}
      {savings ? (
        <div className="rounded-md border border-border bg-card p-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <TrendingDown aria-hidden className="size-3.5 text-muted-foreground" />
            <Text variant="meta" tone="muted" className="font-medium uppercase tracking-wide">
              Estimated saving
            </Text>
            {/* The word "estimate" appears in the chip AND in the sentence below, so the figure can
                never be read as a measurement — README invariant 4. */}
            <Badge variant="info">Estimate</Badge>
          </div>
          <Text className="mt-1 font-medium tabular-nums">{savings.sentence}</Text>
          <Text variant="meta" tone="muted" className="mt-1 break-words text-pretty">
            How it was estimated: {savings.basis}
          </Text>
        </div>
      ) : null}

      {/* ── Assumptions — what the suggestion takes for granted. ── */}
      {recommendation.assumptions.length > 0 ? (
        <div className="flex flex-col gap-1">
          <Text variant="meta" tone="muted" className="font-medium uppercase tracking-wide">
            Assumptions
          </Text>
          <ul className="flex list-disc flex-col gap-0.5 pl-5">
            {recommendation.assumptions.map((assumption) => (
              <li key={assumption}>
                <Text variant="meta" tone="muted" className="break-words text-pretty">
                  {assumption}
                </Text>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* ── Evidence — the drill-through path. A recommendation always carries at least one. ── */}
      <div className="flex flex-col gap-1">
        <Text variant="meta" tone="muted" className="font-medium uppercase tracking-wide">
          Evidence
        </Text>
        {/* `gap-y-2` (8px), not `gap-y-1` (4px): with 24px-plus targets the rows never crowd, and the
            list can no longer produce the WCAG 2.2 2.5.8 failures of audit P1-2. */}
        <ul
          aria-label={`Evidence for ${recommendation.title}`}
          className="flex flex-wrap items-center gap-x-1 gap-y-2"
        >
          {recommendation.evidence.map((ref) => (
            <li key={`${ref.kind}:${ref.id}`} className="flex min-w-0 items-center">
              <EvidenceLink evidence={ref} />
            </li>
          ))}
        </ul>
      </div>
    </li>
  );
}

const EVIDENCE_ICONS: Record<AdvisorEvidenceKind, typeof Server> = {
  server: Server,
  scan: ScanLine,
  tool_scan: Wrench,
  run: PlayCircle,
  scenario: Boxes,
  skill: Sparkles,
};

/** One evidence ref. Resolvable → a real router link; otherwise plain labelled text (never a link
 *  that quietly goes nowhere).
 *
 *  The link keeps the `size="sm"` box the Button variant gives it (32px tall). It used to carry
 *  `h-auto … p-0`, which stripped that box and collapsed the target to its 16px line — the exact
 *  cause of the 55 WCAG 2.2 2.5.8 target-size failures in audit P1-2, the only ones in the app. */
function EvidenceLink({
  evidence,
}: {
  evidence: AdvisorRecommendation["evidence"][number];
}) {
  const href = advisorEvidenceHref(evidence);
  const kindLabel = advisorEvidenceKindLabel(evidence.kind);
  const Icon = EVIDENCE_ICONS[evidence.kind] ?? ScanLine;

  if (!href) {
    return (
      <Text variant="meta" tone="muted" className="min-w-0 truncate">
        {kindLabel}: {evidence.label}
      </Text>
    );
  }

  return (
    <Button asChild variant="link" size="sm" className="max-w-full gap-1">
      <Link to={href}>
        <Icon aria-hidden className="size-3 shrink-0" />
        <span className="min-w-0 truncate">
          {kindLabel}: {evidence.label}
        </span>
        <ExternalLink aria-hidden className="size-3 shrink-0" />
      </Link>
    </Button>
  );
}

/** One enumeration lifted out of the detail prose, collapsed by default. The trigger states the
 *  count, so the collapsed card still carries the FACT ("139 never-called tools") and only the
 *  identifiers are folded away. Matches the ASSUMPTIONS list directly below it: a labelled list of
 *  plain items, not a paragraph. */
function DetailNameList({ list }: { list: DetailNameList }) {
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="flex flex-col gap-1.5">
      <CollapsibleTrigger asChild>
        <Button
          variant="outline-subtle"
          size="sm"
          className="w-fit max-w-full justify-start gap-1.5"
        >
          <Chevron aria-hidden className="shrink-0" />
          <span className="min-w-0 truncate">
            {open ? "Hide" : "Show"} {list.label}
          </span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul aria-label={list.label} className="flex flex-wrap gap-1">
          {list.items.map((name, index) => (
            <li key={`${name}#${index}`}>
              <Badge variant="secondary" className="max-w-full font-mono font-normal">
                <span className="min-w-0 truncate">{name}</span>
              </Badge>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** An enumeration the advisor's rules write into their `detail` prose. `marker` is the literal
 *  lead-in the rule emits; `label` counts what follows it for the disclosure trigger. Presentation
 *  only — the rules, the wire and the report are untouched (this is a read of a string the API
 *  already sends). */
const DETAIL_NAME_LISTS: ReadonlyArray<{ marker: string; label: (count: number) => string }> = [
  {
    marker: "Never called: ",
    label: (count) => `${count} never-called ${count === 1 ? "tool" : "tools"}`,
  },
  {
    marker: "Suggested allowedTools: ",
    label: (count) => `${count} suggested allowedTools`,
  },
];

/** Below this many names the enumeration is easier to read where the rule put it than behind a
 *  click. A three-name list is not the defect audit P1-1 measured. */
const DETAIL_NAME_LIST_MIN_ITEMS = 4;

/** One enumeration found in a recommendation's detail. */
export type DetailNameList = { marker: string; label: string; items: string[] };

/**
 * Split a recommendation's `detail` into the prose that carries the argument and the enumerations
 * that merely list identifiers. Exported for its own test.
 *
 * Deliberately conservative: a detail carrying no long enumeration comes back BYTE-IDENTICAL, so a
 * rule whose wording this does not recognise keeps rendering exactly as the API wrote it.
 */
export function splitDetailNameLists(detail: string): { prose: string; lists: DetailNameList[] } {
  const lists: DetailNameList[] = [];
  let prose = "";
  let rest = detail;

  while (rest.length > 0) {
    let hit: { at: number; spec: (typeof DETAIL_NAME_LISTS)[number] } | null = null;
    for (const spec of DETAIL_NAME_LISTS) {
      const at = rest.indexOf(spec.marker);
      if (at >= 0 && (hit === null || at < hit.at)) hit = { at, spec };
    }
    if (hit === null) {
      prose += rest;
      break;
    }

    const valueStart = hit.at + hit.spec.marker.length;
    const tail = rest.slice(valueStart);
    const stop = findEnumerationEnd(tail);
    // Consume the terminating "." too when there is one, so the prose keeps no orphan period.
    const consumed = valueStart + (stop < tail.length ? stop + 1 : stop);
    const items = tail
      .slice(0, stop)
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name.length > 0);

    if (items.length < DETAIL_NAME_LIST_MIN_ITEMS) {
      prose += rest.slice(0, consumed);
    } else {
      prose += rest.slice(0, hit.at);
      lists.push({ marker: hit.spec.marker, label: hit.spec.label(items.length), items });
    }
    rest = rest.slice(consumed);
  }

  return lists.length === 0 ? { prose: detail, lists } : { prose: collapseSpaces(prose), lists };
}

/** Where the enumeration ends: the first "." followed by a space or the end of the string. A "."
 *  INSIDE an identifier (`namespace.tool`) is followed by a letter, so it never truncates a list. */
function findEnumerationEnd(text: string): number {
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "." && (i + 1 === text.length || text[i + 1] === " ")) return i;
  }
  return text.length;
}

function collapseSpaces(text: string): string {
  return text.replace(/\s{2,}/g, " ").trim();
}
