import type { ReasoningAssetRow, ReasoningSection } from "@mcp-token-footprint/shared";
import {
  Badge,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
} from "@brand/ui";
import { ChevronRight } from "lucide-react";
import { ChatMarkdown } from "./ChatMarkdown";
import { ExpandableTable } from "./ExpandableTable";

/**
 * Qlik Answers (WP 5.4, D-QA11) — the structured renderer for a `qlik_answers` turn's reasoning
 * stream. `ConversationPane`'s `AssistantTurn` mounts this INSIDE the existing `Reasoning` disclosure
 * (in place of the live, verbatim `<ReasoningContent>{reasoning}</ReasoningContent>`) once a turn has
 * SETTLED and its payload carries the derived `reasoningSections` (`AnswersStepPayload.reasoningSections`,
 * WP 5.2's pure `parseReasoningSections`). The raw `reasoning` string is never mutated — this is an
 * additive, rendering-only projection over it.
 *
 * Per section `kind`:
 *   - `understanding` / `rewritten` / `classification` / `prose` → a titled (or, for `prose`, untitled)
 *     markdown block (`ChatMarkdown`) — the recognized pipeline phases read as short labelled notes.
 *   - `assets` → a compact `asset · type · similarity · glossary match` table (the "Search Findings"
 *     master-measure/-dimension/field list), `tabular-nums` on similarity, missing cells as an em dash.
 *   - `draft` → a full "## …" answer draft embedded in the stream. When `duplicatesAnswer` is true (it
 *     substantially restates the final answer) it collapses behind a default-closed disclosure labelled
 *     "Same as answer" — never shown twice, but the text stays reachable. When false (a genuinely
 *     different draft) it renders directly, same as any other markdown section.
 *   - `raw` → the verbatim reasoning markdown, unrecognized/unstructured — rendered as-is, never dropped.
 *
 * Every branch renders SOMETHING for non-empty content — a parse artifact never produces a silent gap.
 */
export type AnswersReasoningProps = {
  /**
   * The turn's derived reasoning sections. Either the SETTLED canonical `AnswersStepPayload.reasoningSections`
   * (WP 5.4) or, while the turn is still streaming (WP 6.2), a LIVE client-side parse of the growing
   * `reasoningText`. The renderer is agnostic — it just draws whatever sections it's handed.
   */
  sections: ReasoningSection[];
  /**
   * WP 6.2 — the turn is still streaming (a LIVE parse). Keeps a `draft` section EXPANDED so a
   * mid-stream draft isn't hidden behind the "Same as answer" fold while the process is still building
   * (`duplicatesAnswer` is computed against the ALSO-streaming answer, so the fold can't be trusted yet
   * — and the owner wants to watch it build). Once settled (`streaming` false/absent) the fold applies
   * exactly as before, byte-identical to WP 5.4.
   */
  streaming?: boolean;
};

export function AnswersReasoning({ sections, streaming }: AnswersReasoningProps) {
  if (sections.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {sections.map((section, index) => (
        <AnswersReasoningSection key={index} section={section} streaming={streaming} />
      ))}
    </div>
  );
}

/** The recognized pipeline phases' default label, used only when the section carries no `title`. */
const KIND_TITLES: Partial<Record<ReasoningSection["kind"], string>> = {
  understanding: "Understanding",
  rewritten: "Rewritten question",
  classification: "Classification",
};

function AnswersReasoningSection({
  section,
  streaming,
}: {
  section: ReasoningSection;
  streaming?: boolean;
}) {
  switch (section.kind) {
    case "understanding":
    case "rewritten":
    case "classification":
    case "prose":
      return (
        <MarkdownSection title={section.title ?? KIND_TITLES[section.kind]} markdown={section.markdown} />
      );
    case "assets":
      return <AssetsSection title={section.title} rows={section.rows} />;
    case "draft":
      return <DraftSection section={section} streaming={streaming} />;
    case "raw":
      return <MarkdownSection markdown={section.markdown} />;
    default:
      return null;
  }
}

/** A titled (optional) flowing-markdown block — the shape shared by every plain-prose section kind. */
function MarkdownSection({ title, markdown }: { title?: string; markdown: string }) {
  const trimmed = markdown.trim();
  if (!trimmed) return null;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {title ? (
        <Text variant="meta" tone="muted" as="span" className="shrink-0 font-medium">
          {title}
        </Text>
      ) : null}
      <ChatMarkdown text={trimmed} />
    </div>
  );
}

/** Locale-formatted similarity score — keeps up to 3 decimals, never rounds to an integer bucket. */
const SIMILARITY_FORMAT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });

function formatSimilarity(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return SIMILARITY_FORMAT.format(value);
}

/** The "Search Findings" asset list (master measures/dimensions/fields) as a compact table. */
function AssetsSection({ title, rows }: { title?: string; rows: ReasoningAssetRow[] }) {
  if (rows.length === 0) return null;
  const heading = title ?? "Search findings";
  // Structured CSV: the raw asset rows (similarity as a number, missing cells empty — cleaner than
  // the em-dash the visible table shows).
  const csvRows: (string | number)[][] = rows.map((row) => [
    row.asset,
    row.type ?? "",
    typeof row.similarity === "number" ? row.similarity : "",
    row.glossary ?? "",
  ]);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Text variant="meta" tone="muted" as="span" className="shrink-0 font-medium">
        {heading}
      </Text>
      <ExpandableTable
        title={heading}
        downloadName={heading}
        csv={{ columns: ["Asset", "Type", "Similarity", "Glossary match"], rows: csvRows }}
        scrollClassName="overflow-auto rounded-md border border-border bg-card"
      >
        <Table className="text-caption">
          <TableHeader>
            <TableRow>
              <TableHead className="h-auto px-2 py-1 align-top">Asset</TableHead>
              <TableHead className="h-auto px-2 py-1 align-top">Type</TableHead>
              <TableHead className="h-auto px-2 py-1 align-top text-right">Similarity</TableHead>
              <TableHead className="h-auto px-2 py-1 align-top">Glossary match</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, index) => (
              <TableRow key={`${row.asset}-${index}`}>
                <TableCell className="min-w-0 break-words px-2 py-1 align-top">{row.asset}</TableCell>
                <TableCell className="min-w-0 px-2 py-1 align-top">{row.type ?? "—"}</TableCell>
                <TableCell className="px-2 py-1 text-right align-top tabular-nums">
                  {formatSimilarity(row.similarity)}
                </TableCell>
                <TableCell className="min-w-0 break-words px-2 py-1 align-top">
                  {row.glossary ?? "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ExpandableTable>
    </div>
  );
}

/**
 * A full "## …" answer draft embedded in the reasoning stream. `duplicatesAnswer` (computed
 * server-side by comparing the draft's vocabulary against the final answer) gates presentation:
 * true → collapsed behind a default-closed disclosure (never shown twice, text still reachable);
 * false → a genuinely different draft, rendered directly like any other markdown section.
 */
function DraftSection({
  section,
  streaming,
}: {
  section: Extract<ReasoningSection, { kind: "draft" }>;
  streaming?: boolean;
}) {
  const trimmed = section.markdown.trim();
  if (!trimmed) return null;
  const title = section.title?.trim() || "Draft answer";

  // WP 6.2 — while streaming, always show the draft inline (the "Same as answer" fold can't be trusted
  // yet — `duplicatesAnswer` is computed against the still-streaming answer — and the process should
  // stay watchable). Once settled, fold a duplicate draft exactly as before (WP 5.4).
  if (streaming || !section.duplicatesAnswer) {
    return <MarkdownSection title={title} markdown={trimmed} />;
  }

  return (
    <Collapsible
      defaultOpen={false}
      className="group/draft min-w-0 rounded-md border border-border bg-card"
    >
      <CollapsibleTrigger className="flex w-full min-w-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronRight
          className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/draft:rotate-90"
          aria-hidden
        />
        <Text variant="meta" as="span" className="min-w-0 shrink-0 font-medium">
          {title}
        </Text>
        <Badge variant="outline" className="shrink-0 font-normal">
          Same as answer
        </Badge>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t border-border px-3 py-2.5">
          <ChatMarkdown text={trimmed} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
