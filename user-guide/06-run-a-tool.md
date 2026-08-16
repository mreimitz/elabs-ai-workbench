# 6. Run a tool

A [scan](./04-scan-and-read-footprint.md) tells you what a tool's *definition* costs. But when
an assistant actually uses a tool, there's a second cost: the request sent to the tool and the
response that comes back. The **tool run console** lets you make a real call and measure that
**runtime cost**.

## Open the run console

From a tool's detail panel (see [Scan and read the footprint](./04-scan-and-read-footprint.md)),
choose **Run**. A full-screen console opens with two sides:

- **Left — Parameters.** A form generated automatically from the tool's input schema. Text
  fields, dropdowns for fixed choices, toggles for yes/no options, numeric fields, and grouped
  or repeatable fields for nested and list inputs. **Required** parameters are marked.
- **Right — Result.** Where the tool's response appears once you run it.

You can drag the divider to resize the two sides.

## Fill in and run

1. Fill in the parameters on the left. Required fields are labeled; the field help comes from
   the tool's own descriptions.
2. Choose the run action. The app sends a real `tools/call` request to the **live server**.
3. The response appears on the right. You can **copy the result** as JSON, or **Cancel** a call
   that's taking too long.

## Read the cost

The footer of the console shows the measurements for the call you just made:

- **Tokens sent** — the token cost of your request (the tool name plus your arguments).
- **Tokens received** — the token cost of the response.
- **Round-trip** — the raw size of the exchange.
- **Duration** — how long the call took.

Together with the definition footprint from the scan, this gives you the full picture: what the
tool costs just to be *available*, and what it costs each time it's *used*.

## Important: these are real calls

Running a tool here is **not a simulation** — it executes against the actual server, exactly as
an assistant would. Two things to keep in mind:

- **Side effects are real.** If a tool creates, changes, or deletes something, running it here
  will really do that. The app surfaces a tool's own annotations (such as read-only vs.
  potentially destructive) and asks you to confirm before running something that looks
  destructive. Read the tool's description before running it against a system you care about.
- **Your arguments may contain sensitive values.** Treat anything you type into the form the
  way you'd treat any real input to that system.

## When to use it

- To see the **true per-call cost** of an expensive-looking tool, not just its definition size.
- To **sanity-check** that a tool behaves and responds the way you expect.
- To understand a tool's **response size**, which matters as much as its definition when context
  is tight.

---

Next: [Export reports →](./07-reports.md)
