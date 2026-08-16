# 17. Hierarchical crews (crew nesting)

A **nested crew** lets you compose one saved crew inside another. Instead of a flat team, you can now model hierarchical organizations: a Chief Operating Agent might oversee a Strategy Crew (with its own parallel topology) and an Intelligence Crew that contains a Business Intelligence sub-crew inside it.

When a nested crew runs, it executes as its **own sub-mission** under its **own topology** — preserving how each team is meant to work, rather than flattening everything to a single level. Results flow up to the parent, budgets cascade down (each child gets `min(requested, parentRemaining)`), and the mission trace shows the tree structure with per-level cost and timing.

## How to author a nested crew

In the **Agents & Crews** workspace, open a crew's profile and go to the **Members** section. The "Add member" interface now branches into two paths:

- **Add an agent** — the original path, selecting an agent from your library.
- **Add a crew** — new path, selecting another saved crew to embed.

Both kinds of members render in the Members list with a clear visual distinction: agents show their model and a single-role badge, crews show the member count ("3 agents, 2 crews"), a link to drill into the sub-crew's profile, and their configured topology (parallel, pipeline, etc.).

**Author-time checks** protect you from mistakes:

- **Circular references** — if you try to add a crew that would create a cycle (Crew A → B → A), the editor shows a clear error: *"This crew is reachable from Crew A; adding it here would create a cycle."* The save is rejected.
- **Depth limit** — if you nest deeper than `HUB_MISSION_MAX_DEPTH` (default 2, meaning one level of nesting), you'll see: *"Nesting exceeds the maximum depth (2). Remove or flatten one level."* The default allows root + one nested level; if you need more, an admin can raise the cap.

When you drill into a sub-crew's profile from the Members list, you're viewing (and can edit) that crew's own definition — changes there ripple into any parent crew using it.

## Budget cascade + cost prediction

When a mission with nested crews starts, budgets flow downward in a specific way:

- The **root mission** gets the full requested budget (clamped to `HUB_MISSION_MAX_BUDGET_USD`).
- Each **child crew** gets `min(requested, parentRemaining)` — never more than what the parent has left.
- As children spend, the remaining budget shrinks for the next siblings.
- If a **parent budget is exhausted** mid-execution, in-flight children are immediately halted and marked as **partial** (not a silent truncation; the report shows honestly what ran and what got cut).

Before you launch a nested mission, **cost prediction** shows the aggregate spend. Open the mission preview → the cost card now shows the tree of allocations and the estimated total. The `GET /api/estimate/run-plan` preview endpoint recursively sums child costs, so you know exactly what you're about to spend before you approve.

The key guarantee: **the total spend across the entire tree can never exceed the root's allocated budget**, even if the nesting is 10 levels deep.

## Execution & traces

When a nested mission runs, each crew executes as a discrete sub-mission:

1. The **root mission** spawns its immediate agents and nested crews.
2. Each **nested crew runs its sub-mission** — which might itself contain more nested crews.
3. Results **flow up** — when a sub-crew finishes, it returns one synthesized report (a `HubAgentReport` with a nested `subMissionId`), which the parent's planner integrates into its own synthesis.

On the **Mission board**, nested crews appear as **drill-able entries** in the topology diagram. Click a nested crew's card to open a transient **details dialog** (not a new route) showing:

- Per-level cost and wall-clock time.
- The sub-mission's own mission trace (its agents/crews and their work).
- Live status (running, paused, completed, failed).
- A drill link into the sub-crew's own sub-mission board if nesting is even deeper.

The **tree structure** is preserved in the run report (JSON and Markdown). JSON includes `subMissionId` and `childReports[]` on each crew's `HubAgentReport`; Markdown renders the hierarchy with indentation and per-level attribution (e.g. "*Strategy Crew (3 agents, 2m, $1.23) synthesized …*").

**Event-sourced replay** — every nested spawn, report, and budget-trip is an event in `hub_events`, so a nested-tree mission replays from its events alone. Opening an old run shows the same tree structure as it ran, with live drill-down into any branch.

## Constraints & defaults

Three settings control nesting depth and capacity:

| Setting | Default | Meaning |
| --- | --- | --- |
| `HUB_MISSION_MAX_DEPTH` | 2 | Maximum nesting depth: 1 = root only (no nesting), 2 = root + one nested level, etc. |
| `HUB_MISSION_MAX_TOTAL_AGENTS` | 24 | Total number of leaf agents across the entire tree (not per-level). |
| `HUB_MISSION_MAX_BUDGET_USD` | (config) | The root mission's budget ceiling, same as today. |

**To disable nesting entirely** (reverting to the pre-nesting behaviour), set `HUB_MISSION_MAX_DEPTH=1`. Attempts to add a crew member will then be rejected at author time as "over-depth"; the system behaves exactly as it did before crew nesting shipped.

**Agent count is transitive** — if Crew A has 2 agents and Crew B (with 3 agents) and a sub-crew C (with 2 agents), the total is 2 + 3 + 2 = 7. Nesting deeper still counts up; you can hit the ceiling fast if you're not watching.

## Troubleshooting

**"This crew is reachable from Crew X"** (author time)
- A circular reference was detected. Review your crew memberships. Crew A cannot reference Crew B if Crew B (directly or indirectly) references Crew A.

**"Nesting exceeds the maximum depth"** (author time)
- Your nesting is too deep. Either flatten one level, or ask an admin to raise `HUB_MISSION_MAX_DEPTH`. Count how many levels deep: root Crew A → sub Crew B → sub Crew C is depth 3; the default limit is 2.

**"Total agents would exceed the limit"** (author time or run time)
- Adding this crew member would push the total transitive agent count over `HUB_MISSION_MAX_TOTAL_AGENTS`. Remove agents from another crew, or raise the limit.

**Partial mission / "Child stopped: budget exhausted"** (run time)
- A sibling crew's spend left no room for this one to run fully. Check the parent's cost summary to see which child consumed the budget. Lower the cost cap on expensive children, or request a larger root budget.

**Sub-mission shows in traces but no results** (run time)
- The sub-mission ran but was stopped before finishing (either manually or by budget). Open its drill dialog to see where it halted. Check per-level timings to spot slowness.

For deep debugging, export the run as JSON and search for `subMissionId` entries in the event log to see the complete tree structure and every child's lifecycle.
