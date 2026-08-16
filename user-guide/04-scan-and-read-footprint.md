# 4. Scan and read the footprint

A **scan** is the core measurement in this app. It connects to a server, pulls in everything
the server offers, and calculates the token cost — the [startup footprint](./01-key-concepts.md).
This page explains how to run one and how to read the results.

![A completed scan: the summary metrics (total footprint, tools, average and largest tool) above every tool ranked by token cost, with its name/schema/description split.](./images/03-scan-footprint.png)

## Run a scan

You can start a scan from a couple of places:

- On the **MCP Servers** screen, open a server and choose **Run scan** (or **Scan now**).
- On the **Dashboard**, a server that needs attention shows a **Scan now** button.

When you run a scan, the app connects to the server and asks it for its full surface: it
initializes the connection, lists all **tools**, and also lists any **resources** and
**prompts**. It then measures the token cost of each item using your selected
[token profile](./01-key-concepts.md) and saves the result to your scan history.

## Read the scan summary

At the top of a scan you'll see the headline numbers:

- **Total footprint** — the combined token cost of the server's tools, resources, and prompts.
  This is the single number to watch.
- **Tools** — how many tools the server exposes.
- **Avg tokens/tool** — the average cost per tool, useful for spotting a server that's bloated
  on average versus one with a few heavy outliers.
- **Largest tool** — the single most expensive tool, which is often the best place to start
  trimming.

If a scan couldn't complete, you'll see a **Scan failed** state with the reason instead of
these numbers.

## Read the ranked tool list

Below the summary is a table of every tool, **ranked by footprint** — the most expensive at the
top. Each row shows the tool and its share of the total (its *contribution*), so you can see at
a glance which few tools account for most of the cost.

Above the table you can:

- **Filter tools** — type to narrow the list by name.
- **Columns** — choose which columns to show.

Two useful shortcuts sit nearby:

- **Reduce footprint** — surfaces guidance on where the savings are.
- **Diff vs previous** — jumps straight to a comparison with this server's previous scan, so
  you can see what changed (more in [Compare](./05-compare.md)).
- **Export** — saves this scan as a report (see [Reports](./07-reports.md)).

## Inspect a single tool

Select any tool to open its **detail panel**, which breaks down where its cost comes from:

- **Description** — the tool's human-readable description (often a big contributor to cost).
- **Annotations** — hints the tool declares about itself, such as whether it's read-only or
  potentially destructive.
- **Breakdown** — how the tool's tokens are distributed across its parts.
- **Parameter / Tokens** — each input parameter and what it costs, with required parameters
  marked.
- **Input schema** and **Tool definition** — the raw definitions, which you can **Expand** to
  read in full.

From this panel you can also choose **Run** to execute the tool and measure a real call — see
[Run a tool](./06-run-a-tool.md).

## Browse past scans

The **Scans** screen lists your scan history across all servers. You can **search** by server
or date and filter by **Server** and **Status**. Selecting a scan opens the same summary and
ranked-tool view described above, so you can revisit any past measurement.

Every scan is stamped with the token-counting method used, so the app can keep results honest
and avoid comparing numbers that were counted differently.

## Reading tips

- **Long descriptions are often the biggest lever.** A verbose tool description costs tokens on
  every connection; tightening it up is usually the easiest win.
- **Watch the "Largest tool."** A handful of heavy tools frequently dominate the total.
- **Pick one profile and stick with it** when you're comparing scans, so the numbers line up.

---

Next: [Compare →](./05-compare.md)
