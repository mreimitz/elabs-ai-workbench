# STATUS ledger format

`PLAN/STATUS.md` is the living source of truth for what's done and what's open. The skill reads it to
pick the next batch and updates it as WPs are ticked off.

## Format

- One checkbox line per WP, grouped by phase:
  `- [ ] WP <id> — <goal> — depends: <ids | —> — status: <state>`
- **Legend:** `[ ]` open · `[x]` done. A trailing `status:` note carries `open`, `in progress`,
  or `in review`. Owner-gated WPs note it (e.g. `status: open (owner-gated: tarball)`).
- A done line records the date and integration branch:
  `- [x] WP <id> — <goal> — done <YYYY-MM-DD> · wp/<plan>/<id>`

## Parsing rules

- A WP is **eligible** when its line is `[ ]` AND every id in its `depends:` list is `[x]`.
- `depends: —` means no dependencies (immediately eligible).
- A `depends:` token like `Phase 3` means "every WP in that phase must be `[x]`".
- Treat `owner-gated` WPs as **blocked** until the owner clears the gate; surface them, don't start them.

## Update rules

- On selection: set `status: in progress (agent label)` (leave the box `[ ]`).
- During review: `status: in review`.
- On validated completion only: flip to `[x]` and append `done <date> · <branch>`. **Never tick the
  box** unless the quality gate is green and every Acceptance item is met.
- Keep the grouping and ordering stable so diffs are readable.

## Generating a ledger when one is missing

Scan `PLAN/phase-*/WP-*.md`. For each, read the title (`# WP <id> — <goal>`) and the `**Depends on:**`
value from the header line. Seed every WP as:
`- [ ] WP <id> — <goal> — depends: <ids | —> — status: open`
grouped by phase, with a short legend at the top. Use `assets/STATUS.template.md` as the shape.
