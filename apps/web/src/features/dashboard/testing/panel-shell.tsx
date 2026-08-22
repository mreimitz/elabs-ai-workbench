import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, cn, EmptyState, Text, toast, useCopyToClipboard } from "@elabs-ai/components-ui";
import { Check, Link2 } from "lucide-react";
import { IconButton } from "../../../components/IconButton";
import { notifyError } from "../../../lib/notify";
import { DASHBOARD_PANEL_PARAM, panelDomId, panelLinkPath } from "./panel-anchor";

/**
 * Shared chart-panel framing for the Testing dashboard (WP 2.2) — mirrors the `ChartGrid`/
 * `ChartPanel` local helpers in `features/testing/AnalyticsPanel.tsx` (title/subtitle/icon Card,
 * fixed-height chart box, honest empty state) without importing that feature's file (a different,
 * DO-NOT-TOUCH cluster) — the same small pattern re-created for this feature's own panels.
 *
 * ── THE PANEL ADDRESS (RM-17 AM-OB3) ─────────────────────────────────────────────────────────────
 * A `ChartPanel` given a `panelId` becomes addressable: it renders a stable DOM id, offers a
 * copy-link affordance in its header, and — when `?panel=` names it — scrolls itself into view on
 * mount and carries a ring so the reader can see WHICH panel they were sent to. The URL vocabulary
 * itself is `panel-anchor.ts`.
 *
 * The addressing is gated on a {@link PanelAnchorProvider} being mounted above, NOT on the `panelId`
 * prop alone, for one concrete reason: a panel rendered outside a router (which is how every panel's
 * own unit test renders it) must not call `useSearchParams`. The provider is the single place that
 * touches the router, so a panel unit test keeps working untouched and the router hook runs once per
 * tab instead of once per panel.
 */

const PANEL_ANCHOR_TOAST_ID = "dashboard-panel-link";

type PanelAnchorValue = {
  /** The `?panel=` value currently on the URL, or `null`. Never validated — see `panel-anchor.ts`. */
  anchoredPanelId: string | null;
  /** An absolute, pasteable URL reproducing the current view, anchored to `panelId`. */
  panelLink: (panelId: string) => string;
};

const PanelAnchorContext = createContext<PanelAnchorValue | null>(null);

/**
 * Mounts the panel-address context for a tab's panels. Reads the URL once; every panel below
 * consumes the result. Without it a `ChartPanel` renders exactly as it did before this WP.
 */
export function PanelAnchorProvider({ children }: { children: ReactNode }) {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const anchoredPanelId = searchParams.get(DASHBOARD_PANEL_PARAM);
  // Memoised on the SERIALIZED query, not the params object: `useSearchParams` hands back a fresh
  // instance every render, so keying on it would rebuild `panelLink` (and re-run every consumer's
  // memo) on each pass.
  const search = searchParams.toString();
  const pathname = location.pathname;

  const value = useMemo<PanelAnchorValue>(
    () => ({
      anchoredPanelId,
      panelLink: (panelId: string) => {
        const path = panelLinkPath(pathname, new URLSearchParams(search), panelId);
        // A path is enough for the app itself, but the point of this affordance is a link someone
        // PASTES somewhere else, so it is absolute wherever there is an origin to be absolute about.
        return typeof window === "undefined" ? path : new URL(path, window.location.origin).toString();
      },
    }),
    [anchoredPanelId, pathname, search],
  );

  return <PanelAnchorContext.Provider value={value}>{children}</PanelAnchorContext.Provider>;
}

/** A responsive 1→2 column grid for the dashboard's chart panels. */
export function PanelGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">{children}</div>;
}

export function ChartPanel({
  title,
  subtitle,
  icon,
  actions,
  panelId,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  /** Right-aligned per-panel controls (e.g. a grader note) on the title row. */
  actions?: ReactNode;
  /**
   * The panel's stable address (AM-OB3) — a {@link DASHBOARD_PANEL_IDS} member for a prebuilt panel,
   * or `customChartPanelId(chart.id)` for an operator's own. Omitted (or rendered with no
   * {@link PanelAnchorProvider} above) the panel is simply not addressable, exactly as before.
   */
  panelId?: string;
  children: ReactNode;
}) {
  const anchor = useContext(PanelAnchorContext);
  const addressable = panelId !== undefined && anchor !== null;
  const anchored = addressable && anchor.anchoredPanelId === panelId;
  const cardRef = useRef<HTMLDivElement>(null);

  // Scrolling is the PANEL's job, not the page host's: the Testing tab's panels only exist once the
  // metrics fetch has settled, and an inactive tab is unmounted entirely, so a host-level "scroll on
  // mount" would fire at a moment when the target does not exist yet. A panel, by definition, knows
  // when it is there. `requestAnimationFrame` defers one frame so the chart box has been laid out
  // and the scroll lands on the panel's real position rather than its pre-layout one.
  useEffect(() => {
    if (!anchored) return;
    const element = cardRef.current;
    if (element === null || typeof element.scrollIntoView !== "function") return;
    if (typeof requestAnimationFrame !== "function") {
      element.scrollIntoView({ block: "start" });
      return;
    }
    const frame = requestAnimationFrame(() => {
      element.scrollIntoView({ block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [anchored]);

  return (
    <Card
      ref={cardRef}
      id={addressable ? panelDomId(panelId) : undefined}
      data-anchored={anchored ? "true" : undefined}
      className={cn("min-w-0", anchored && "ring-2 ring-ring")}
    >
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div className="flex min-w-0 flex-col gap-1">
          <CardTitle>
            <span className="flex items-center gap-2">
              {icon}
              {title}
            </span>
          </CardTitle>
          {subtitle ? (
            <Text variant="meta" tone="muted">
              {subtitle}
            </Text>
          ) : null}
        </div>
        {actions !== undefined || addressable ? (
          <div className="flex shrink-0 items-center gap-1">
            {actions}
            {addressable ? <PanelCopyLink panelId={panelId} title={title} link={anchor.panelLink} /> : null}
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">{children}</CardContent>
    </Card>
  );
}

/** The per-panel "copy link" affordance — one `IconButton` (D-TB5: its tooltip IS its `aria-label`,
 *  derived from one prop) over the library's own clipboard hook. */
function PanelCopyLink({
  panelId,
  title,
  link,
}: {
  panelId: string;
  title: string;
  link: (panelId: string) => string;
}) {
  const { copied, copy } = useCopyToClipboard();

  async function handleCopy(): Promise<void> {
    const url = link(panelId);
    // The hook answers `false` rather than throwing where there is no clipboard (an insecure origin,
    // a browser that refuses) — a papercut, not a crash, but the operator still has to be told,
    // because a copy button that silently does nothing is worse than one that is not there.
    if (await copy(url)) {
      toast.success("Panel link copied", { id: PANEL_ANCHOR_TOAST_ID, description: title });
    } else {
      notifyError("Couldn’t copy the panel link.", {
        id: PANEL_ANCHOR_TOAST_ID,
        description: "This browser blocked clipboard access. The link is in the address bar once you scroll to the panel.",
      });
    }
  }

  return (
    <IconButton
      variant="ghost"
      size="icon-sm"
      label={`Copy link to ${title}`}
      onClick={() => void handleCopy()}
    >
      {copied ? <Check aria-hidden className="size-3.5" /> : <Link2 aria-hidden className="size-3.5" />}
    </IconButton>
  );
}

/** The panel-local "nothing in this window" state — a compact `EmptyState`, never a blank box. */
export function PanelEmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex min-h-40 items-center justify-center py-6">
      <EmptyState title={title} description={description} />
    </div>
  );
}

/** A fixed-height box giving a chart its sizing context (matches `AnalyticsPanel`'s `h-56 w-full`). */
export function ChartBox({ children }: { children: ReactNode }) {
  return <div className="h-56 w-full">{children}</div>;
}
