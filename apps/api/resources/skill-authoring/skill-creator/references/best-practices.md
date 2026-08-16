# Skill-authoring best practices (reference)

Fuller checklist backing `../SKILL.md`'s summary. Read this before proposing edits to any skill.
This is part of the DISTILLED FALLBACK reference (D-AS21) — see the notice at the top of
`../SKILL.md` for why it exists instead of Anthropic's real `skill-creator`.

## 1. Frontmatter checklist

- [ ] `name` is lowercase, hyphen-separated (`^[a-z0-9]+(-[a-z0-9]+)*$`), ≤ 64 chars, matches the
      skill's own directory name, and is not a reserved word (`anthropic`, `claude`).
- [ ] `description` is ≤ 1024 chars, states **when** to use the skill (concrete trigger phrases,
      not a feature summary), and is not just the name restated.
- [ ] If the skill declares `keywords`, they are the phrases a user would actually type — not a
      restatement of the description, not near-duplicates of each other.
- [ ] If this skill exposes multiple `/command` entry points, each has a name that can't collide
      with a sibling skill's commands.

## 2. Body (L2) checklist

- [ ] The body reads as a short briefing: goal, key decision points, and pointers into
      `references/` — not an exhaustive manual duplicated from the reference files.
- [ ] Stay under a few thousand tokens. If the body is ballooning, move detail into a new
      `references/*.md` file and leave a pointer.
- [ ] Every section is reachable — either directly useful on a normal run, or linked from a
      decision point ("if X, see references/x.md"). No orphaned sections nobody will ever reach.
- [ ] At each decision/gatekeeper point, leave a marker of what was decided and why (a
      breadcrumb) — useful for debugging a run after the fact, and for a future edit to understand
      the branch that was NOT taken.
- [ ] Any retry/loop has an explicit bound (a max attempt count or a clear exit condition) — never
      an open-ended "keep trying."

## 3. Referenced files (L3) checklist

- [ ] Every relative path mentioned in the body or another reference file actually resolves to a
      real file in the tree.
- [ ] Every file under the skill's root is reachable from somewhere (the body or a reference file
      that's itself reachable) — no dead files nobody points to.
- [ ] Reference files are focused — one topic per file is easier to load selectively than one
      giant reference dump.

## 4. Scripts

- [ ] Any script the skill ships documents its inputs, outputs, and side effects somewhere the
      model will read before invoking it.
- [ ] Prefer a deterministic script over free-form model reasoning for anything mechanical
      (parsing a known format, running a fixed transformation, validating structure) — it is
      cheaper, more reliable, and easier to audit.
- [ ] A script never assumes network access or credentials that aren't explicitly part of its
      documented contract.

## 5. Tool / MCP-server references

- [ ] If the skill's instructions assume specific tools or an MCP server, name them explicitly and
      keep the assumption narrow — don't silently assume a broad tool surface is available.
- [ ] Prefer the smallest tool surface that gets the job done; a skill that references dozens of
      tools "just in case" is harder to reason about and more expensive to keep in context.

## 6. Token & cost discipline

- [ ] L1 (name + description) stays lean — it is loaded into every conversation regardless of
      whether the skill is used.
- [ ] L2 (the body) stays proportionate to what the skill actually needs to say to get started.
- [ ] Bulk detail, large examples, and rarely-needed edge cases live in L3 (`references/`), loaded
      only when actually needed.

## 7. Security & trust

- [ ] The skill's instructions never ask the agent to exfiltrate secrets, disable safety checks,
      or execute unreviewed remote content.
- [ ] Anything the skill tells the agent to treat as "trusted" content is actually something the
      user controls — never blindly trust content fetched from an external, untrusted source.

## 8. Portability

- [ ] Only `name` and `description` are guaranteed to mean the same thing on every runtime a
      skill might load into. Everything else (body structure, script execution, loading strategy)
      is a convention this app follows, not a cross-runtime guarantee.
- [ ] Don't assume lazy/deferred loading of L2/L3 is universal — write the body so it still makes
      sense if L3 files loaded eagerly, and vice versa.
- [ ] Write for the weakest model likely to run this skill: spell out steps explicitly rather than
      relying on an implicit chain of reasoning a stronger model might infer on its own.

## 9. Before committing an edit

- [ ] Re-read the edited `SKILL.md` end to end — does the frontmatter still match the body content
      (name in the description, capabilities actually present)?
- [ ] Check every reference link you touched still resolves.
- [ ] If this workspace's own `docs/skill-authoring.md` guide is available, prefer citing its
      specific rule ids (e.g. `manifest-incomplete`, `l1-budget`, `broken-ref`) when explaining a
      change — its Skill IDE quality engine checks the same rules mechanically, so matching its
      vocabulary keeps the explanation and the enforcement in sync.
