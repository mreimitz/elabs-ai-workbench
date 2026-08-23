---
type: "Guide Page"
title: "25. The reference data pack — keeping the facts current without a new image"
description: "The versioned folder of external facts and judgement tables the workbench checks your servers and skills against, how a container refreshes it at startup, and how you publish a new one."
tags: ["documentation", "DC-26"]
timestamp: "2026-08-23T16:10:00Z"
status: "current"
---
# 25. The reference data pack — keeping the facts current without a new image

Almost every verdict this app gives you is a comparison against a **fact it did not measure**: how
big a model's context window is, what a million tokens cost, which phrasings have been seen in a
prompt-injection payload, how many tools a particular client will accept. Those facts change on
somebody else's schedule — a provider ships a model on a Tuesday, a new injection payload turns up
in the wild — and until recently every one of them was compiled into the program. Correcting a
price meant a code edit, a full quality gate, a new image and a redeploy of every install.

The **reference data pack** takes them out of the program. It is a folder of versioned,
schema-validated JSON: `data-pack/` in the repository, a snapshot inside every image, and — if you
let it — a copy your container refreshes from the internet each time it starts.

## What is in it

| Folder | What it holds |
| --- | --- |
| `models/` | Every model the app knows about: context window, pricing, tool-call limits, modalities, release and cutoff dates, with a source URL and a confidence for each claim |
| `limits/` | The cross-cutting protocol, client, host and SDK limits a scan is checked against |
| `compatibility/` | The compatibility test catalog — the rules behind the MCP × model heatmap |
| `security/` | The security rule registry (id, severity, title, rationale) and every signature list the two analyzers match on: injection phrasings, destructive verbs, credential-shaped parameter names, broad OAuth scopes |
| `advisor/`, `quality/` | The thresholds the advisor and the quality/compare surfaces judge against |
| `schema/` | A JSON Schema for each of the above — the pack validates itself |
| `generated/` | The flat model index the app actually reads, built from `models/` |
| `manifest.json` | The version, the layout version, and a SHA-256 plus byte length for every file above |

### What deliberately stays in the code

Two things are compiled in and always will be, because their **absence is unsafe rather than
merely inconvenient**:

- **Model context limits.** An unknown context window does not produce a smaller number, it
  disables a guardrail.
- **The priced-model table.** An unpriced model makes the app's own "is this model priced?" check
  answer no, which *refuses* a cost-capped run outright.

Everything else may live only in the pack. The compiled copies are a floor the app falls back to,
never a second source of truth: they are generated from the same authored files by the same build,
so they cannot drift into disagreeing with the pack.

## Where a running container gets its pack

Three rungs, evaluated once at boot, in this order:

1. **Fetched** — a pack downloaded and verified on a previous or the current startup, cached under
   the data volume.
2. **Bundled** — the snapshot baked into the image.
3. **Compiled** — the floor described above.

A pack is applied **whole or not at all**. There is no per-file merge, so you never end up running
one version's model list against another version's security rules.

**Settings → Reference data** tells you which rung you are on, what version is in force, and what
the last check did. So does `GET /api/data-pack`, and so does the diagnostics bundle.

## The startup check, and why it can never hurt you

When the container starts it makes one bounded attempt to read a published manifest. Everything
about that attempt is arranged so it cannot become a reason the app fails to work:

- It runs **after** the server is already accepting connections, and nothing waits on it.
- It is bounded twice — once per request, and once for the check as a whole. One hung socket cannot
  hold it, and neither can a server that answers every one of the 28 files just under the
  per-request limit.
- **Every** failure — no DNS, a 404, a hang, a corrupt file, a pack the app refuses — keeps the
  pack already in force, logs one line, shows up in Settings, and leaves the health check green.

You will see one of five outcomes:

| Outcome | What it means |
| --- | --- |
| `disabled` | No URL, or the check is switched off. **Zero** outbound requests are made. |
| `unreachable` | The network gave no usable answer. On an offline install this is the normal, expected result. |
| `up_to_date` | An answer arrived and the pack you have is already at least as new. |
| `refused` | An answer arrived and was **rejected**. This is the one to look at — something published a pack this build will not trust. |
| `installed` | A newer pack verified and is now in force. |

### The five refusals

A pack is refused, never partially trusted. Each of these rejects the whole pack and keeps the one
you were already running:

| Refusal | What went wrong |
| --- | --- |
| **Unsupported layout version** | The pack declares a folder layout this build does not understand. Checked before a single file is downloaded, so an incompatible pack costs a couple of kilobytes, not two megabytes. |
| **Digest mismatch** | A file's SHA-256 does not match what the manifest says it should be — in either direction, so an unlisted extra file is a refusal too. |
| **Schema violation** | A file does not satisfy its own JSON Schema, is not readable JSON, or carries a regular expression that will not compile or is over its length cap. Also covers a manifest naming a path the app will not write to. |
| **Version regression** | The published pack is older than the one in force. (The *same* version is not a refusal — it is the steady state of every healthy install and reads as `up_to_date`.) |
| **Rule-ledger regression** | The pack drops, renames or re-points a security rule id, measured against the registry **shipped in the image** rather than whatever is currently in force. Security rule ids are frozen: a CI gate elsewhere identifies a finding by its rule id, so a renamed id would silently change somebody's build verdict. Anchoring on the image is deliberate — anchoring on "the pack in force" would let a chain of packs walk the ledger anywhere, one rename at a time. |

A related rule sits beside the ledger: a pack that **changes a rule's severity** must also carry a
greater analyzer version. The posture diff already refuses to compare across analyzer versions, so
the change becomes visible instead of quietly re-scoring your history.

## Which data a verdict was computed against

Every document that carries a judgement is stamped with the pack version in force when it was
built: security reports and posture diffs, advisor and fleet reports, compatibility heatmaps and
test reports, the CI gate document, server and run reports, and the diagnostics bundle. A verdict
that cannot name the data behind it is not reproducible, so all of them name it.

## Publishing a pack

Publishing is a **commit**, not an upload. The pack is served as a directory from the repository
itself, so pushing a bumped pack is what makes it live.

That has one consequence worth knowing, and it is a safety property rather than a quirk: **the
version bump is the switch, not the push.** A pack file edited and pushed without a version bump is
answered `up_to_date` by every install and never downloaded at all. Nothing goes live by accident.

```bash
# 1. Edit the pack: data-pack/models/…, data-pack/security/signatures.json, …
# 2. Seal, verify and stage it — this does NOT publish anything
scripts/publish-data-pack.sh --bump minor

# 3. Review the diff, then publish
git add data-pack packages/shared/src
git commit -m "data-pack: publish 1.2.0"
git push origin main
```

The script refuses to work from a dirty tree, re-seals the pack and refuses if that changes
anything (a pack whose manifest does not reproduce from its own sources cannot be published), bumps
the version, stages the served tree under `dist/data-pack/v<version>/` with a tarball and
checksums, and then hands the staged tree to **the app's own verifier** — the same code every
install runs on a fetched pack, compared against the pack as committed at `HEAD`. If your fleet
would refuse this pack, you find out here rather than from a support ticket.

Pass `--publish` (from a clean tree, on the publish branch) to have the script do the commit and
push itself. `--allow-dirty` stages a rehearsal artifact from uncommitted edits and refuses to
publish, which is how you try a candidate pack against a running container without pushing
anything:

```bash
python3 -m http.server 8141 --directory dist/data-pack/v1.2.0
# then restart the container with
#   DATA_PACK_URL=http://host.docker.internal:8141/manifest.json
```

### Who is trusted, and with what

A published pack carries the **security rule titles and rationales that you read verbatim on
screen** — the sentences in the Security tab that explain why a finding matters. They are validated
for length and shape, not for content, and no check in the repository can see them, because after
the startup fetch they may be text that was never in any file here.

**Whoever publishes reference data is therefore trusted with what it says.** Today that is the
owner, publishing from their own repository, which is the same trust boundary as the image itself —
so this is a property of the design, not a gap in it. The condition that would reopen the question
is a pack accepted from a publisher the operator does not control; at that point the enforcement
point is the verifier, and content constraints would have to be added to the schemas.

## Running with no internet at all

The pack is an optimisation. An install that never reaches the network works exactly as designed:

- The image ships a full pack, so a container with **no network whatsoever** boots normally and
  serves the bundled snapshot. Verified: the check answers `unreachable` in a few milliseconds, the
  health check is green, and Settings says **"bundled"** with the failed check written out — it
  never reports a successful check it did not make.
- To make even the attempt stop, set `DATA_PACK_URL` to the **empty string**. That is different
  from leaving it unset, and it is the air-gapped switch: zero outbound requests.

| Variable | Meaning |
| --- | --- |
| `DATA_PACK_URL` | Where to fetch the manifest. Unset = the published pack. **Empty = never ask.** A tag URL pins you to one version instead of tracking. |
| `DATA_PACK_CHECK_ON_START` | `false` also makes zero outbound requests. |
| `DATA_PACK_TIMEOUT_MS` | Per-request bound, default 5000. The whole check gets 12× this. |

The cache lives on the same persistent volume as the database, so once a container has fetched a
pack it keeps serving it across restarts without touching the network again.

## A worked example of why this exists

The compatibility catalog's scoring bands were found to be set such that not one cell of the best
available model could read "Within limits". Before the pack, correcting that number meant a code
edit, the full quality gate, a new image and a redeploy of every install. After it, it is a pack
edit, a version bump and a push — and every container picks it up the next time it starts.
