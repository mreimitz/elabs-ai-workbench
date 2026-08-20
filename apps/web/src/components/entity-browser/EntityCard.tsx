import type { MouseEvent, ReactNode } from "react";
import { Link } from "react-router-dom";
import { Card, Text, cn } from "@elabs-ai/components-ui";

/**
 * One entity's card in an overview grid (RM-32 D-OD7).
 *
 * ACTIVATION CONTRACT — one click opens. Unlike the Hub's workforce grid (click = select,
 * double-click = open), an overview card has nothing to select, so a single click navigates, which
 * also makes the grid behave identically to the table's `onRowClick`. The accessibility model is
 * `DataTable`'s row model rather than a big `role="button"` div:
 *
 *   • the TITLE is a real `<Link>` — the card's single tab stop, its accessible name, and a genuine
 *     `href`, so middle-click / ⌘-click / "open in new tab" / "copy link" all work. A `role="button"`
 *     card cannot offer any of those;
 *   • a pointer click anywhere ELSE on the card resolves to the same navigation;
 *   • a click that originates in a nested control — the ⋯ menu trigger, an icon button, or a menu
 *     item rendered into a Radix PORTAL (which still bubbles through the React tree to this handler
 *     even though its DOM lives under `document.body`) — is guarded out;
 *   • the tail of a text-selection drag does not navigate.
 */
export function EntityCard(props: {
  title: string;
  /** Where the title link points; also where a card-body click navigates. */
  href: string;
  /** Navigate. The card never calls `navigate` itself — the caller owns routing. */
  onOpen: () => void;
  /** Chips beside the title (type, source, `Local`, …). */
  badges?: ReactNode;
  /** The status cue (a health dot + StatusBadge, a sync chip). Rendered top-right. */
  status?: ReactNode;
  /** Clamped supporting prose. */
  description?: ReactNode;
  /** A muted, truncating identity line (endpoint, repo + ref). */
  meta?: ReactNode;
  /** Figures row — pass `tabular-nums` content. */
  metrics?: ReactNode;
  /** Per-card controls (an icon button, the ⋯ menu). Never navigation. */
  actions?: ReactNode;
  /**
   * Let the browser skip layout/paint for off-screen cards in a large grid. A dependency-free stand-in
   * for virtualization — `DataTable` owns that for tabular data, and neither it nor `Gallery`
   * (image-only) fits a card grid, so no new virtualizer is mounted (D-OD8).
   */
  virtualizeHint?: boolean;
}) {
  function handleClick(event: MouseEvent<HTMLDivElement>) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    // Radix renders menu content into a portal; `target !== currentTarget` can't catch it, but the
    // role Radix puts on its own content can.
    if (target.closest('[role="menu"], [role="menuitem"], [role="dialog"]')) return;
    // Any real control inside the card owns its own click — including the title link, which must not
    // navigate twice.
    if (target.closest("a, button, input, select, textarea, label, [role='button']")) return;
    // The end of a text-selection drag is not an activation.
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    props.onOpen();
  }

  return (
    <Card
      interactive
      // A stable hook for tests and for a caller that needs to scope a query to one card — the
      // `Card` primitive itself renders no identifying attribute.
      data-entity-card={props.title}
      onClick={handleClick}
      style={
        props.virtualizeHint
          ? { contentVisibility: "auto", containIntrinsicSize: "0 200px" }
          : undefined
      }
      className="flex min-w-0 cursor-pointer flex-col gap-3 p-4"
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <Link
            to={props.href}
            // Layout-only: the link IS the card's heading, so it reads as the title rather than as
            // body-copy link text. Focus-visible comes from the token ring.
            className={cn(
              "min-w-0 truncate font-medium text-foreground",
              "rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring",
            )}
            title={props.title}
          >
            {props.title}
          </Link>
          {props.badges ? (
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">{props.badges}</div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {props.status}
          {props.actions}
        </div>
      </div>

      {props.description ? (
        <Text variant="caption" tone="muted" className="line-clamp-2 min-w-0 break-words">
          {props.description}
        </Text>
      ) : null}

      {props.metrics ? (
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">{props.metrics}</div>
      ) : null}

      {props.meta ? (
        <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">{props.meta}</div>
      ) : null}
    </Card>
  );
}
