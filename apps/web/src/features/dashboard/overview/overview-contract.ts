/**
 * The Overview tab's data contract (dashboard-bento Phase 1).
 *
 * Declared UP FRONT and separately from both its producer (`use-overview-data.ts`, WP 1.1) and its
 * consumers (the tiles, WP 1.2/1.3) so those can be built in parallel against one shape. It is a
 * UI-local view model, NOT a wire type — nothing here crosses the network, so it does not belong in
 * `packages/shared`.
 *
 * Three invariants are encoded in the TYPES, because Phase 0 proved each of them is easy to get
 * wrong in a way that silently misleads an operator:
 *
 * 1. **A missing figure is `null`, never `0`.** WP 0.3 shipped a review defect where a tile rendered
 *    a delta computed over a different server population than its own value, so adding a server made
 *    a 100k→590k fleet growth read as a green "favorable" shrink. Every optional figure here is
 *    `T | null`, and `null` means "do not render this", never "zero".
 * 2. **Cost NEVER blends across bases.** `api_exact` and `subscription_reference` are different
 *    kinds of number (D-OB14) — one is money billed, the other a shadow reference price. They are
 *    carried as a LIST, so no tile can accidentally sum them into one figure.
 * 3. **Each section owns its own load state**, so a tile whose source is empty or failed can remove
 *    itself without blanking the whole bento (the "never render a grid of empty boxes" rule).
 */

/** One point of a densified time series (the metrics endpoints omit empty buckets; the client fills). */
export type OverviewPoint = { bucketStart: string; value: number };

/** Per-section load state. Tiles render only on `ready`; `empty` means the tile self-hides. */
export type SectionState = "loading" | "ready" | "empty" | "error";

export type SectionEnvelope<T> = {
  state: SectionState;
  /** Present only when `state === "ready"`. */
  data: T | null;
  /** Present only when `state === "error"` — surfaced to the tile, never swallowed. */
  error: string | null;
};

/**
 * Hero: the fleet's startup footprint.
 *
 * **Two different time scopes live in this one shape, and mixing them up is a bug.** A fleet's
 * startup footprint is a STANDING MEASUREMENT — "what my servers cost me to put in front of a
 * model" does not stop being true because nobody scanned this week. Only the TREND is an event
 * stream. So:
 *
 * - `totalTokens` / `deltaTokens` / `firstTimeServers` / `mix` / `latestMeasuredAt` are
 *   **window-independent**: they come from the latest successful scan per server across ALL of
 *   history, whatever window the tab is showing.
 * - `perServer[].points` is **window-scoped**: it is the window's raw measurement trace — the points
 *   a scan actually produced inside the selected window, and nothing else. `MoversTile` ranks
 *   movement from it (movement IS an event, so it must stay windowed) and `StartupCostTile` draws
 *   its sparkline from it. A window with no scan in it genuinely has no such trace
 *   (`noActivityInWindow`), which the tile must SAY rather than vanish over.
 * - `standingSeries[].points` is **window-independent**: it is what the hero CHART plots — every
 *   server that has ever been measured, carried forward from its last successful scan. Added by
 *   dashboard-bento WP 2.3; see its own doc below for why it is a separate field rather than a
 *   change to `perServer`.
 */
export type FootprintData = {
  perServer: { serverId: string; serverName: string; points: OverviewPoint[] }[];
  /**
   * The hero chart's plotted lines — **standing**, not windowed (dashboard-bento WP 2.3).
   *
   * Owner, 2026-08-20: *"fleet footprint shows only scanned MCP servers which have been scanned
   * during the selected time and the result drops if a scan wasnt successfull. but we should show
   * all MCP servers there and get the number from the last successfull scan."* Both halves of that
   * are encoded here:
   *
   * - **Population.** One entry per server with at least one successful scan **anywhere in
   *   history**, not only the servers scanned inside the window. A footprint is a standing
   *   quantity; a quiet window can remove a server's *activity*, never its *cost*.
   * - **Continuity (last observation carried forward).** Every entry carries a value at every
   *   bucket on the shared axis at or after its own first successful scan, so a failed or missing
   *   scan holds the last known-good figure instead of breaking the line or dropping it toward
   *   zero. The line is flat where nothing was measured and steps only where a real successful scan
   *   changed the number.
   * - **Never invented.** No point exists before a server's first successful scan (no back-fill
   *   with 0 — that would be a fabricated measurement), and a server with NO successful scan is not
   *   here at all; it is named in {@link FootprintData.unmeasuredServers} instead.
   *
   * It is a SEPARATE field from `perServer` on purpose: `MoversTile` derives "what moved" by
   * subtracting a series' last two points, and carrying a value forward would turn every quiet
   * server's Δ into a fabricated 0 and silently empty that tile.
   */
  standingSeries: { serverId: string; serverName: string; points: OverviewPoint[] }[];
  /**
   * Configured servers with **no successful scan on record, ever** — named on the tile, never
   * plotted (dashboard-bento WP 2.3).
   *
   * "Show all MCP servers" is honoured by accounting for every server either as a line or as a
   * named exclusion. A server that has never been measured has no honest value to draw: plotting it
   * at 0 would state a measurement nobody took. Empty when every configured server has been
   * measured, and empty when the producer was given no server catalog to compare against (the
   * catalog is the only thing that knows a server exists at all).
   */
  unmeasuredServers: { serverId: string; serverName: string }[];
  /** Fleet total of the latest successful scan per server. Window-independent. */
  totalTokens: number;
  /** Fleet Δ over the SAME population `totalTokens` covers; `null` when nothing is comparable. */
  deltaTokens: number | null;
  /** Servers contributing their whole figure because this is their first measurement. Disclosed on the tile. */
  firstTimeServers: number;
  /** Composition of the current fleet surface. `null` when no successful scan exists. */
  mix: { toolTokens: number; resourceTokens: number; promptTokens: number } | null;
  /**
   * When the fleet was last measured — the BUCKET START of the newest measurement anywhere, so it
   * is only as precise as the producer's bucket (hour, today). Render it coarsely (a relative
   * "3d ago" / a date), never as an exact scan clock. `null` when the producer could not establish
   * one; a `null` renders as absent, never as "never".
   */
  latestMeasuredAt: string | null;
  /**
   * `true` when the SELECTED WINDOW contains no measurement at all — i.e. `perServer` is empty.
   * The standing figures above still stand, and since WP 2.3 so do the plotted
   * {@link FootprintData.standingSeries} lines: this flag now means "nothing was *scanned* in this
   * window", NOT "there is nothing to plot". The tile states it as a note beside a chart that keeps
   * drawing the fleet's standing footprint.
   */
  noActivityInWindow: boolean;
};

/** One cost figure, kept separate from every other basis. */
export type CostBasisFigure = {
  /** e.g. "api_exact" | "subscription_reference" — rendered with its own label, never summed. */
  basis: string;
  currentUsd: number;
  /** `null` when there is no comparable previous window. */
  previousUsd: number | null;
};

export type RunHealthData = {
  runCount: number;
  /** 0–100; `null` when no run reached a terminal state in the window. */
  passRatePercent: number | null;
  /** Percentage POINTS vs the previous window; `null` when not comparable. */
  passRateDeltaPoints: number | null;
  /** Sparkline of run count per bucket. */
  runsOverTime: OverviewPoint[];
  /** One entry per cost basis present in the window. NEVER summed together. */
  costByBasis: CostBasisFigure[];
};

export type AttentionKind = "scan_failed" | "server_unscanned" | "issue_regressed" | "issue_open";

export type AttentionItem = {
  kind: AttentionKind;
  /** What the operator recognises — a server name, an issue title. */
  label: string;
  /** Short "why it needs you" line; `null` when the kind alone says it. */
  detail: string | null;
  /** Where clicking takes them. */
  href: string;
  /** Present for a server row so the tile can offer an inline "Scan now". */
  serverId: string | null;
};

export type AttentionData = { items: AttentionItem[]; total: number };

export type AdvisorTeaserData = {
  title: string;
  detail: string;
  /** e.g. "31,000 tokens" — already formatted WITH its unit, since the advisor never converts units. */
  savingsLabel: string | null;
  severity: "low" | "medium" | "high";
  href: string;
};

/** Everything the Overview tab renders. Each section is independently loadable. */
export type OverviewData = {
  footprint: SectionEnvelope<FootprintData>;
  runHealth: SectionEnvelope<RunHealthData>;
  attention: SectionEnvelope<AttentionData>;
  advisor: SectionEnvelope<AdvisorTeaserData>;
};

/**
 * The window the whole tab is scoped to.
 *
 * As of dashboard-bento WP 2.2 this is no longer the Overview's own window: it is the PAGE range
 * (`features/dashboard/dashboard-range.ts`), shared with the Testing and Issues tabs, and handed
 * down by `DashboardView`. `preset` therefore also admits `"custom"` — the shared control offers a
 * pinned calendar range alongside the three trailing presets. Only `resolveOverviewBucket` reads
 * `preset` at all (a `24h` preset must bucket hourly even though its span rounds to one day); a
 * `"custom"` range simply falls through to the span-based rule, which is the right answer for it.
 */
export type OverviewRange = { from: string; to: string; preset: "24h" | "7d" | "30d" | "custom" };

/** A section that has settled with nothing to show — the tile must self-hide, not render an empty box. */
export function isEmptySection<T>(section: SectionEnvelope<T>): boolean {
  return section.state === "empty" || (section.state === "ready" && section.data === null);
}
