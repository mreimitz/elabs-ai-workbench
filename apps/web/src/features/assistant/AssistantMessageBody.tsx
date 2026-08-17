import { useState } from "react";
import { Link } from "react-router-dom";
import { MetricCard, cn } from "@elabs-ai/components-ui";
import { Check, Copy } from "lucide-react";
import { IconButton } from "../../components/IconButton";
import { ChatMarkdown, type MdComponents } from "../testing/ChatMarkdown";
import {
  assistantMessageCopyText,
  type AssistantMetric,
  type ParsedAssistantMessage,
} from "./assistant-message";
import { notifyError } from "../../lib/notify";

/**
 * Assistant gen-UI (dock chat enhancement, 2026-07) — renders one parsed assistant message:
 * flowing markdown (via the shared `ChatMarkdown`) interleaved with `metrics` segments as a compact
 * grid of `@elabs-ai/components-ui` `MetricCard` tiles. Two dock-specific upgrades over the raw run-console render:
 *
 *  1. INTERNAL LINKS NAVIGATE IN-APP: the system prompt teaches the model to reference entities as
 *     markdown links to their app routes (`/testing/runs/<id>`, `/skills/<id>`, …). A Streamdown
 *     `a` override renders those as react-router `Link`s (history push, Back works) instead of raw
 *     anchors that would full-reload the SPA; genuinely external URLs open in a new tab.
 *  2. METRIC TILES: a `metrics` segment renders as a 2-up grid of KPI tiles — the "numbers ARE the
 *     answer" presentation — instead of a bullet list.
 *
 * Follow-up chips deliberately do NOT render here: they belong to the TURN (only the last settled
 * turn shows them) — see `AssistantTurnBlock` in `AssistantDock.tsx`.
 */
export function AssistantMessageBody({
  parsed,
  streaming,
}: {
  parsed: ParsedAssistantMessage;
  streaming: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {parsed.segments.map((segment) =>
        segment.kind === "markdown" ? (
          // Finding 9 / D-IC9 — cap flowing prose at a readable measure (~68ch). The MetricStrip
          // below is a dense KPI grid, not prose, and stays uncapped/full-width beside it.
          <div key={segment.key} className="min-w-0 max-w-[68ch]">
            <ChatMarkdown
              text={segment.text}
              streaming={streaming}
              components={ASSISTANT_MD_COMPONENTS}
            />
          </div>
        ) : (
          <MetricStrip key={segment.key} metrics={segment.metrics} />
        ),
      )}
    </div>
  );
}

/** The `metrics` segment: a tight 2-up KPI grid (single column when only one tile). */
function MetricStrip({ metrics }: { metrics: AssistantMetric[] }) {
  return (
    <div className={cn("grid min-w-0 gap-2", metrics.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
      {metrics.map((metric) => (
        <MetricCard
          key={metric.label}
          label={metric.label}
          value={metric.value}
          delta={metric.delta}
          deltaDirection={metric.deltaDirection}
          description={metric.hint}
          className="min-w-0"
        />
      ))}
    </div>
  );
}

/**
 * The settled-turn action row: copy-the-response. Small, muted, and single-purpose — no
 * thumbs/share slop. Copies the message's plain-text form (markdown verbatim, metric tiles as
 * `label: value` lines, follow-ups excluded).
 */
export function AssistantTurnActions({ parsed }: { parsed: ParsedAssistantMessage }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="-mt-2 flex min-w-0 items-center">
      <IconButton
        variant="ghost"
        size="icon"
        className="size-6 text-muted-foreground hover:text-foreground"
        label="Copy response"
        onClick={() => {
          navigator.clipboard
            .writeText(assistantMessageCopyText(parsed))
            .then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            })
            .catch(() =>
              notifyError("Couldn’t copy the response.", {
                description: "Select and copy the text manually instead.",
              }),
            );
        }}
      >
        {copied ? <Check aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />}
      </IconButton>
    </div>
  );
}

/**
 * Module-scope (stable identity — `ChatMarkdown` memoizes on the reference): internal app routes
 * become router `Link`s, external URLs open safely in a new tab. `node` is react-markdown's hast
 * node, stripped before spreading (mirrors `ChatMarkdown`'s own overrides).
 */
const ASSISTANT_MD_COMPONENTS: MdComponents = {
  a: ({ node: _node, href, children, ...props }) => {
    const linkClass = "font-medium text-primary underline underline-offset-2 hover:no-underline";
    if (typeof href === "string" && href.startsWith("/")) {
      return (
        <Link to={href} className={linkClass} {...props}>
          {children}
        </Link>
      );
    }
    return (
      <a href={href} target="_blank" rel="noreferrer noopener" className={linkClass} {...props}>
        {children}
      </a>
    );
  },
};
