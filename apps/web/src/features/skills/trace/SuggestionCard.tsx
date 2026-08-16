import type {
  SkillGraph,
  SkillStaticSuggestion,
  SkillStaticSuggestionRule,
  SkillSuggestion,
  SkillSuggestionRule,
} from "@mcp-token-footprint/shared";
import { Badge, Button, Text } from "@brand/ui";
import { Lightbulb, Wrench } from "lucide-react";
import { describeEditOp } from "../design/use-edit-ops";

/** Short display label per TRACE rule (kebab id → human phrase) — kept beside the shared vocabulary. */
const RULE_LABEL: Record<SkillSuggestionRule, string> = {
  "missing-breadcrumbs": "Missing breadcrumbs",
  "loop-detected": "Loop detected",
  "asset-never-visited": "Asset never visited",
  "gate-failed-consistently": "Gate failed",
  "marker-route-mismatch": "Route mismatch",
};

/**
 * Short display label per STATIC (trace-less) optimization rule (WP 4.3) — the SECOND total label map,
 * kept distinct from {@link RULE_LABEL} because the static vocabulary (`SkillStaticSuggestionRule`) is
 * a separate closed set from the trace rules. Both maps are `Record<…Rule, string>` so a new rule is a
 * compile error until it has a label.
 */
const STATIC_RULE_LABEL: Record<SkillStaticSuggestionRule, string> = {
  "split-oversized-body": "Split oversized body",
  "dedupe-keywords": "Deduplicate keywords",
  "remove-unused-asset": "Unused asset",
  "tighten-description": "Tighten description",
};

/**
 * Props are discriminated on `variant`:
 *  - the DEFAULT (`variant` omitted or `"trace"`) renders a WP 5.2 trace {@link SkillSuggestion}
 *    exactly as before — existing callers ({@link TraceEvidencePane}) pass no `variant` and compile
 *    unchanged;
 *  - `"static"` renders a WP 4.2 {@link SkillStaticSuggestion} (the Quality tab) with the static label
 *    map + a static-typed `onApply`.
 * Both share the whole layout; only the label lookup and the applied suggestion's type differ.
 */
export type SuggestionCardProps =
  | {
      variant?: "trace";
      suggestion: SkillSuggestion;
      /** The RAW graph the suggestion's ops target — used only to resolve node/edge labels. */
      graph: SkillGraph;
      /** Omitted for an advisory suggestion (`ops.length === 0`) — there is nothing to apply. */
      onApply?: (suggestion: SkillSuggestion) => void;
    }
  | {
      variant: "static";
      suggestion: SkillStaticSuggestion;
      /** The RAW graph the suggestion's ops target — used only to resolve node/edge labels. */
      graph: SkillGraph;
      /** Omitted for an advisory suggestion (`ops.length === 0`) — there is nothing to apply. */
      onApply?: (suggestion: SkillStaticSuggestion) => void;
    };

/**
 * WP 5.2 / WP 4.3 — one deterministic suggestion rendered as a card: the rule badge, the rationale, an
 * op-summary list (reusing `describeEditOp` — the SAME phrasing `SaveVersionDialog` shows), and — ONLY
 * when `ops.length > 0` — a "Review & apply…" button. An advisory suggestion (`ops: []`) renders with
 * no apply affordance: there is genuinely nothing safe for the deterministic engine to draft, and the
 * rationale is the whole point (D5: never a guessed edit). The Quality tab reuses this with
 * `variant="static"` so trace + static suggestions read identically.
 */
export function SuggestionCard(props: SuggestionCardProps) {
  const { suggestion, graph } = props;
  const advisory = suggestion.ops.length === 0;
  const label =
    props.variant === "static"
      ? (STATIC_RULE_LABEL[props.suggestion.rule] ?? props.suggestion.rule)
      : (RULE_LABEL[props.suggestion.rule] ?? props.suggestion.rule);

  // Narrow on `variant` so the correctly-typed `onApply` is called with its matching suggestion type.
  const handleApply = () => {
    if (props.variant === "static") props.onApply?.(props.suggestion);
    else props.onApply?.(props.suggestion);
  };
  const canApply = !advisory && props.onApply !== undefined;

  return (
    <div
      className="flex flex-col gap-2 rounded-md border border-border bg-muted/30 p-2.5"
      data-testid="suggestion-card"
      data-rule={suggestion.rule}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Lightbulb aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <Badge variant="outline">{label}</Badge>
        {advisory ? <Badge variant="secondary">Advisory — no auto-apply</Badge> : null}
      </div>

      <Text variant="meta" tone="muted" className="break-words">
        {suggestion.rationale}
      </Text>

      {!advisory ? (
        <ul className="flex flex-col gap-1 border-t border-border pt-2">
          {suggestion.ops.map((op, index) => (
            <li key={`${op.op}:${index}`} className="flex items-start gap-1.5 text-sm">
              <Wrench aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 break-words">{describeEditOp(op, graph)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {canApply ? (
        <Button
          variant="outline"
          size="sm"
          className="w-fit"
          onClick={handleApply}
          data-testid="suggestion-apply-button"
        >
          Review &amp; apply as new version…
        </Button>
      ) : null}
    </div>
  );
}
