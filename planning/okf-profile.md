---
type: "Standard Profile"
title: "Workbench Planning OKF Profile"
description: "The strict metadata, lifecycle, evidence and validation rules for the workbench planning bundle."
tags: ["okf", "standard", "validation"]
timestamp: "2026-08-20T13:47:37Z"
status: "active"
---

# Workbench Planning OKF Profile

This bundle targets [Open Knowledge Format v0.1 Draft](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md).
The machine-readable profile is stored in [`.claude/okf-profile.json`](.claude/okf-profile.json).
The inspected specification revision is `ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a`; the upstream
repository head observed on 2026-07-24 was `d44368c15e38e7c92481c5992e4f9b5b421a801d`.

## Conformance layers

The validator reports two layers independently:

1. **Official OKF v0.1** checks concept frontmatter, non-empty `type`, and reserved file structure.
2. **Workbench Planning Profile** adds mandatory metadata, controlled types and statuses, managed
   directory structures, complete indexes, source companions, citations, links and stable tags.

## Required concept fields

Every ordinary concept requires `type`, `title`, `description`, `tags`, `timestamp` and `status`.
Frontmatter uses the profile's JSON-compatible YAML subset so validation stays deterministic and
offline.

Markdown under `tools/` is forbidden. That directory holds non-OKF scaffold implementation;
ignoring Markdown there would violate the bundle's whole-tree conformance boundary.

## Reserved files

- `index.md` provides progressive disclosure and carries no frontmatter, except the bundle-root
  index, which declares `okf_version: "0.1"`.
- `log.md` records changes under newest-first ISO 8601 date headings and carries no frontmatter.

## Domain roots

The documentation domain root is **`user-guide/`**, not the upstream scaffold's `Docu/`. A `DC-NN`
subject holds both the delivery record (`doc.md`) and that part of the system's user-facing guide
pages, so the record of what shipped and the manual that explains it never drift apart.

## The three added concept types

Beyond the upstream scaffold's vocabulary, this profile registers three types so the workbench's
existing planning artifacts validate in place rather than being reshaped to fit:

| Type | What it is | Statuses |
| --- | --- | --- |
| `Guide Page` | A user-facing manual page inside a `DC-NN` subject. | `draft`, `review`, `current`, `superseded`, `archived` |
| `Work Package Spec` | A `wp-N.M-*.md` specification (or a convention / kickoff document) inside an `RM-NN` item. | `draft`, `review`, `final`, `superseded`, `archived` |
| `Status Ledger` | An item's `STATUS.md` work-package ledger. | `active`, `archived` |

## The ledger completion gate

The upstream scaffold gated completion on a `tasks.json` task board. This bundle gates on the
`STATUS.md` ledger instead — the checkbox format the repository-root `/next-wp` skill already
maintains.

`complete-roadmap` discovers `Roadmap/RM-*/STATUS.md`, and refuses the completion while any
`- [ ]` box in the item's own ledger is still open. The `--ledger` flag names an extra ledger
explicitly; `--no-ledger` waives the gate and exists only for an item that never had one. It is
not a way past an open box.

## Delivery lifecycle

Roadmap items and their documentation are validated as a pair. A `Roadmap Item` with status
`done` must live under `Roadmap/completed/`, and every item there must be `done`. Each completed
item must be recorded as a `### RM-NN` increment inside a `Documentation` concept under
`user-guide/DC-NN-slug/`, and that increment must link back to the item it documents.
`Documentation` concepts carry a `## Delivered increments` section, and may only leave `draft`
once it holds at least one increment.

## Evidence

Non-Markdown research artifacts in a topic's `sources/` require a same-stem `Source Reference`
concept that links to them. Research notes, research outputs and decisions always include a
`# Citations` section. Assets that belong to a documentation subject — screenshots, exported
PDFs, landing pages — live inside the subject folder and need no companion; the companion rule
is a provenance rule for captured research material, not a rule about every binary.
