# WP 2.3 — Fleet footprint plots every server, carried from its last successful scan

Owner, 2026-08-20:

> *"fleet footprint shows only scanned MCP servers which have been scanned during the selected time
> and the result drops if a scan wasnt successfull. but we should show all MCP servers there and get
> the number from the last successfull scan."*

## What is actually wrong (measured against the live instance)

The **total is already correct**: 8 servers, 7 with scans; the tile's 255,751 is the sum of each
server's last *successful* scan, including `mcp-assets` (5 scan points, only 3 successful) which
correctly contributes 628. That half needs no change.

The **chart** is wrong, in two ways:

1. `overview-derive.ts:350` builds `perServer` from `windowPerServer` — the **range-scoped**
   response. A server not scanned inside the selected window gets no line at all, even though its
   footprint is a known standing quantity.
2. `buildServerFootprint` (~line 259) plots `measured` points only. A bucket whose scan failed has
   `totalTokens: null` and is dropped, so the line **breaks or dives** at a failed scan rather than
   holding at the last known-good figure.

## Required behaviour

- **Every server with at least one successful scan gets a line**, drawn from the standing
  (unscoped) population — not only those scanned inside the window.
- **A failed or missing scan never lowers or breaks a line.** Carry the last successful value
  forward across buckets that have no successful scan (last-observation-carried-forward). A server's
  line is therefore flat where nothing was measured and steps only where a real successful scan
  changed it.
- **Never invent a measurement before a server's first successful scan.** Do not back-fill with 0 —
  the line simply starts at that server's first successful scan.
- **A server with NO successful scan ever is named, not silently dropped.** `mcp-powerbi-fabric` has
  no scan at all. Do **not** plot it as a 0 line (a fabricated measurement). Surface it on the tile
  as an explicit note (e.g. "1 server not scanned yet"), so "all MCP servers" is honoured honestly:
  every server is accounted for, either as a line or as a named exclusion.
- The `noActivityInWindow` notice keeps working, but must no longer imply there is nothing to plot
  when standing lines exist.

## Files

- `apps/web/src/features/dashboard/overview/overview-derive.ts` (+ test)
- `apps/web/src/features/dashboard/overview/overview-contract.ts` — additive ONLY if a field is
  genuinely needed (e.g. an unscanned-server count); say so loudly if you change it
- `apps/web/src/features/dashboard/overview/tiles/HeroFootprintTile.tsx` (+ test)
- `apps/web/src/features/dashboard/overview/use-overview-data.ts` if the standing series must reach
  the chart

Do NOT change the total / mix / delta arithmetic — it is already correct and regression-tested.

## Acceptance
- [ ] Every server with ≥1 successful scan is plotted, regardless of the selected window. Tested
      with a fixture where a server's only scan predates the window.
- [ ] A failed scan holds the previous value; the line neither breaks nor drops. Tested with the
      real `mcp-assets` shape (successful, successful, failed).
- [ ] No value is invented before a server's first successful scan.
- [ ] A server with no successful scan is named on the tile, never plotted as 0. Tested.
- [ ] Total, mix, delta and `firstTimeServers` are unchanged — existing tests still pass untouched.
- [ ] Faithful-stub test proves the chart receives one series per plotted server.
- [ ] Gate: web green; delta vs the pre-existing failures zero.
