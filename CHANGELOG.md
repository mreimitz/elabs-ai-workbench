# Changelog

All notable changes to MCP Token Footprint. This project is single-owner and versioned loosely; the
authoritative in-flight state lives in [`CLAUDE.md`](./CLAUDE.md) and the
`planning/Roadmap/RM-*/STATUS.md` ledgers (before 2026-08-20 these were `planning/Roadmap/*/STATUS.md`;
entries below that date name the paths as they were at the time). Per-phase git tags are an **owner action** (not created by this remediation).

## Unreleased — a server’s page stopped burying what it is, and its token chart stopped hiding the biggest thing on it

**The two cards that say what a server IS were five screens below the fold.** Measured on
`barc-benchmark` at 1600×1000: the Overview tab scrolled 2,839px against a 534px viewport, because
the findings list alone was 2,428px tall and stretched the card beside it to match. Connection
details — transport, auth, URL, when it was last updated — did not begin until y=2722. They now
live in the page toolbar, stated **once**: an intermediate pass put them on a second line under the
headline figures and the result said transport, auth, type and URL twice on the same screen, which
the owner caught immediately. The toolbar also stopped rendering them as six outline chips — a chip
reads as "this is a state worth noticing", and a transport name is not one. Only the two real states
keep a badge: the last scan's outcome, and the server type's lifecycle.

The row under the figures now carries what the toolbar cannot: **when the server was last updated,
and how much it has actually been used** — run counts and scan counts as small bar charts beside
their totals. Those started as one bar per day and were changed after looking at them: 23 scans
spread over seven weeks rendered as thirty 2px hairlines, which reads as an empty box beside the
number 23. They are twelve equal slices of the server's own history instead, so the shape — bursty,
steady, long-idle — survives however long the server has existed. The tab scrolls roughly two
screens instead of five.

**The token-distribution chart was omitting up to three fifths of the tokens it claimed to
account for, and what it was omitting turned out to matter.** The four parts the chart broke a tool
into — name, description, input schema, annotations — are each counted in isolation, so they never
added up to the tool’s real total, and the bar was scaled to their sum: a full-width 100% bar under
the heading “Where startup tokens go” with the difference unmentioned. Across the registered servers
that difference runs from 4.5% to **59.7%**.

The first attempt named the gap “Wire structure” and told the reader it was JSON punctuation they
could not edit. **That was wrong, and checking it is what found the real problem.** The remainder is
almost entirely the tool’s declared **`outputSchema`** — a full, editable content field this app
does not meter at all. On every server whose tools declare one, 100% of the gap sits on exactly
those tools; on the one server that declares none, the gap is 35 tokens across three tools, which is
the actual envelope overhead. `qlik_get_full_glossary_export` carries an 8,356-character output
schema against a 168-character input schema: the app reported 2,028 tokens and itemised 120 of them.
The slice is now called **Output schema + envelope**, and a line under the bar says plainly what is
in it, that the dominant part is editable, and that the two are not yet counted separately.

**The same breakdown now appears in the tool detail panel**, which had the identical omission — its
“Token budget” bar showed four segments summing to 2,511 against a stated 2,601. Both surfaces draw
from one component now, with a test that fails if their rows ever differ.

**The chart also answers a question it never used to.** A second bar splits the startup cost by
surface — Tools, Resources, Prompts — which was already measured and never shown; on `qlik-stage`
it reads 149,338 tools against 3,595 resources. Every slice on both bars now states its own token
count and share beside it, rather than a detached legend at the bottom of the card. The eight
heaviest tools underneath dropped their four-colour mini-bars for a single-hue ranking: repeating
the same four hues down eight rows encoded nothing the row order did not already say, and squeezed
each part into a sliver too small to compare.

**Those ranking bars then had to be fixed twice.** The first version scaled each bar to the largest
listed tool, so the top row drew a full-width bar next to the number 6.9% — the bar and the
percentage were measuring different things on the same line, and it read as broken. A bar's length
is now the percentage printed beside it, both against the server's tool tokens. That makes the bars
short, and it buys back something max-scaling actively hid: a line underneath now states that the
eight heaviest tools are **27.7%** of the surface between them. Whether the cost is concentrated in
a few tools or spread across all of them calls for opposite fixes, and a chart whose top bar is
always full can never tell you which you have.

The split moved to hover — and, because
`brand-ui docs Tooltip` is explicit that essential information must not be tooltip-only, it also
rides in each row’s accessible name. That was not a precaution: tabbing to a row was measured
opening no tooltip at all, so a keyboard user got nothing.

**Findings became separable, and stopped setting the page’s height.** Each finding is a bordered,
collapsed row carrying its severity, its title and how many tools it hits; expanding one shows the
fix and puts the tool names behind their own disclosure that states the count. Before, every
finding spilled twelve monospace chips plus a “+57 more” straight into the list, four findings deep,
with nothing to mark where one ended and the next began. The disclosure now reveals **all** the
names — the old row silently truncated at twelve — and the list scrolls inside its own card, so its
height is a function of the finding count rather than of how many tools the worst finding happens
to carry.

**A server’s page now charts its open issues over time**, from the issue list the page already
fetched — no endpoint, no second request. It is honestly labelled as a reconstruction rather than a
history, because it cannot be one: `resolved_at` is cleared when an issue is reopened and there is
no status-history table, so an issue closed in May and regressed in July reads as open since May.
Making that faithful needs a new table, deliberately not added here.

Verified against the running app in both themes, on a server that actually serves resources, and on
the tool detail panel. Thirty-four new tests cover the derivations — the findings list had none at all
before — and each guard was broken and watched go red before it was trusted. One of them caught a
real defect during review: a zero-valued slice shifted the colours of the slices after it, so a
server with no resources but some prompts would have painted Prompts in the Resources colour while
its own legend said otherwise.

## Unreleased — a bucket nobody measured is no longer drawn at the top of the chart

**Every line chart in the app was plotting unmeasured points at its own maximum, and then losing
them off the top edge.** The chart library has no way to draw a gap: when a row carries no value for
a series it falls back to pixel row zero, which in a plot's own coordinates is the CEILING, not the
floor. So a bucket where a server was simply not scanned, a day with no runs, or a turn a shorter
run never reached, was drawn as the highest value on the chart. Measured on the running app: a
server holding a constant 243 startup tokens — the smallest surface in the fleet — was plotted as a
full-height zigzag reaching the 152,933-token fleet maximum, because it had no scan in 12 of 41
buckets. The default curve then overshoots each of those invented spikes by another 13–18 pixels,
and the reveal clip begins at exactly the ceiling, so the apex was cut away. That clipping is what
made it look like a rendering glitch; it was the shape of a fabricated measurement.

**The fix is that the charts are never handed a hole, and each series says what its own hole
means.** A measure that ACCUMULATES over a bucket — a count, tokens, a cost — fills with zero,
because nothing happening really is zero. A measure that describes a STATE — a rate, a score, a
duration percentile, a scanned surface's size — is held flat at its nearest real reading instead,
because the repository's own rule already says it: *"'0% of runs errored' and 'nothing ran' are
different facts and one of them is a crisis."* The fleet-footprint chart now draws what its own
description always claimed — each server held at its last successful scan — and a run that ended
early holds its final context instead of appearing to explode.

**Verified against the running app, not reasoned about.** Before the change the overview chart's
lines reached 18 pixels above the clip and were cut; after it, every path on every measured route
sits inside its frame, in both themes. The check was controlled: reverting the fix makes the same
measurement report the overview chart, the Testing tab's server-footprint chart and the compare
workspace's context curves as clipped again. Seven new tests feed each producer series with
disjoint buckets and fail if any hole survives — each was watched go red before it was trusted.

**Two upstream gaps are recorded, not worked around.** The design system's `Line`/`Area` still have
no way to express a genuine gap, and their reveal clip still leaves no headroom above the plot for
the overshoot their own default curve produces. Everything above is a fix at this app's data layer;
neither library file was touched.

## Unreleased — publishing the pack, and proving the app works with none of it

**The release notes told recipients the wrong thing about who could download a release.** The
publish script, this README and the deployment guide all stated that this repository is private and
that release assets therefore need repository access. It is public, and has been. Corrected in all
three places — and the script no longer *states* it at all: it asks GitHub at publish time and
renders the matching note, or, if that query fails, says plainly that the access rule is unconfirmed
rather than guessing. A hardcoded "public" would have been the same mistake with a fresher value.
`--publish` still has never been run, so the note has never appeared on a real release.

**A provenance record in the reference data pack is now checkable rather than merely plausible.**
The pack records where each of its files was moved from. Nothing verified those old paths existed,
so a typo or an invented path read as a real record of a real move while proving nothing — confirmed
by planting a path that never existed and watching the old check pass it. The new check resolves
every recorded origin against the commit the move was made from, and fails loudly if it cannot see
that commit at all rather than reporting a pass over nothing checked. All 15 recorded paths verify.

**Publishing reference data is now a commit.** The pack is sealed from its own sources — a checksum
per file — and served from the repository; a running install picks it up on its next start. **The
version bump is the go-live switch**: editing a pack without raising its version is answered
"already current" and never downloaded, so a half-finished edit cannot escape by accident. A script
builds and checks it, and refuses if what is committed does not reproduce from its sources.

**A defect in the previous release is fixed, and it would never have worked.** The address the app
checked for updates pointed at a GitHub release attachment. Release attachments are a flat list —
they cannot carry the nested paths the pack is made of — so the app would have found the index and
then failed to fetch all 28 files behind it, permanently, in a way that looks exactly like "nothing
has been published yet". Measured against a real repository rather than assumed. The address now
points at the files themselves, which resolve.

**The app was run in a real container with no network at all, for the first time in this work.** It
starts, serves the reference data built into the image, and reports the failed check honestly —
`source: bundled`, the attempt written out, health green in three seconds. Setting the address to
empty is the air-gapped switch: no outbound request is made at all.

**The container build stopped shipping 17 MB of documents it never reads.** Two directories in the
exclusion list had not existed for months while the tree that replaced them was being copied in
whole. The one part the build genuinely needs — the user guide, which becomes the in-app manual — is
kept, and the exclusion is written so a new folder is left out by default rather than silently
inflating the image again.

**The guide gained a chapter on all of it**, including one thing stated plainly rather than left
implied: a published pack carries the security rule wording you read on screen, so **whoever
publishes reference data is trusted with what it says** — today that is you, from your own
repository, which is the same trust boundary as the image itself.

## Unreleased — every verdict names its data, and Settings shows which pack is in force

**A report that judges something now says what it judged it against.** The reference pack's version
is recorded in the security report and its diff, the advisor report, the fleet report, the
compatibility heatmap and test report, the server and run reports, and the CI gate document — in the
JSON and in the Markdown. A verdict you cannot reproduce is a verdict you cannot argue with, and
until now nothing in those documents said which thresholds, rules or model facts produced them. The
version is written by one piece of code that every document calls, so two reports cannot disagree
about it.

**Settings has a reference-data row.** It shows the version in force, where it came from, when it was
last checked, and a **Check now** button. When a published pack is refused it says so in a sentence —
*"a published pack could not be verified — this app is still using the version it had"* — naming the
version that was refused and the reason, and saying plainly that nothing was applied. A failed check
never renders as a successful one.

**The browser no longer lags the server.** Model context windows, the compare default, the failure
threshold and the security rule titles were previously whatever shipped in the image, so a fetched
pack changed the server's answers while the screen kept showing the old ones. All of them now read
the pack in force. **None of it delays the app starting** — the page paints immediately on the values
it shipped with and adopts the pack when it arrives, so a slow or unreachable server costs you
nothing but the update itself. Measured before and after: with the server deliberately stalled, the
old shape delayed first paint by 2.1 seconds and the shipped one by none.

One consequence worth knowing: an unknown model context window now reads as **unknown** rather than
as zero. It previously rendered "0% of context used", which is a number nobody could justify.

The diagnostics bundle gains a reference-data section, and it carries the version, the source and the
refusal reason — never the URL it checked.

## Unreleased — the app can fetch its own reference data, and refuses it five ways

**The reference data pack can now arrive over the network at startup instead of only from the image
or the data volume.** The app checks a published URL, and if what it finds verifies *and* is newer,
it swaps to it for every subsequent request. Correcting a model's context window, a price, a
compatibility rule or a security signature no longer needs a release and a redeploy.

**Startup never waits on that check and never fails because of it.** The request is fired after the
server is already accepting connections, and it is not awaited — so an unreachable URL, a slow one,
or one that hangs forever cannot delay or break boot. Measured: with a server that accepts the
connection and never answers, the app was serving health checks in about a second while the fetch
was still running, and gave up on it at the five-second bound. Two bounds exist, because they catch
different failures: one per request, and one total budget for the whole check — a server answering
every request just inside the per-request limit would otherwise be unbounded in aggregate.

**Five things get a pack refused whole, each one named in the log:** a layout this build does not
understand; any file whose contents disagree with the manifest's checksum; any file that fails its
schema; a version that is not newer than what is running; and — the one that protects other people's
CI — a security rule list that has dropped, renamed or re-pointed an id it previously shipped. A
refused pack changes nothing: the app keeps serving what it had, and leaves nothing on disk for a
later boot to pick up.

**A download in progress can never become the pack in force.** Files land in a staging directory,
are verified there, and only a verified tree is moved into place in one step. Killing the process
mid-download leaves the previous pack serving and the partial tree discarded on the next run.

A verified pack is kept in the data volume, so a later restart uses it with no network at all.
Setting the check off, or the URL to empty, makes the app open no socket — asserted by a test that
records every outbound call.

**Not yet, and visible:** there is no screen for any of this and no way to trigger a check by hand
(both next), and the publish path does not exist, so the default URL currently answers 404. That is
logged once at startup as information, not as a warning — an install with no network sees exactly
the same line, and warning about the expected case is how people learn to ignore logs.

## Unreleased — the security rules move into the data pack, with two things standing in their way

**The eighteen security checks, and every phrase, verb and pattern they match on, are now reference
data rather than code.** Recognising a newly-seen prompt-injection payload used to need a release, an
image rebuild and a redeploy of every install; it is now a pack update.

**What a replacement pack may not do is quietly change a verdict.** A CI gate identifies a security
finding by its rule id and passes or fails on a severity floor, so a fetched file that renamed an id
or lowered a severity would change somebody's pipeline result with no code change anywhere. Three
refusals stand in the way, and they are checks the app performs on startup, not advice in a
document: the list of rule ids ever shipped is **append-only** — a pack that drops, renames or
re-orders one is refused whole; **any severity change requires a higher analyzer version**, which is
the app's existing way of saying "these two reports are not comparable", so the change becomes
visible instead of silent; and a pack whose set of rules does not match the checks this build
actually implements is refused too. A refused pack is logged with its reason while the shipped one
keeps serving.

Patterns travel as text and are **compiled once, when the pack loads**, under a length cap. A broken
or oversized pattern is a refusal at startup rather than a failure halfway through a report someone
asked for.

Nothing a user sees changed. A security report and a security diff — for a server and for a skill —
were pinned to their exact bytes before the move and are unchanged after it, and no rule id,
severity, title or wording moved. The bench's scan of its own MCP mount scores the same 100/clean it
scored before.

## Unreleased — the reference data the app reasons from has one address, and can be replaced

**The model roster, the cross-cutting limits and the compatibility rule catalog are now read from a
resolved data pack, not from files baked beside the code.** There were three copies of those
documents in the tree; there is one. The app loads it at boot, verifies every file against the
manifest's SHA-256 and against its JSON Schema, and applies it whole or not at all.

**A newer pack can be dropped into the data volume without rebuilding the image.** A pack in
`DATA_DIR/data-pack/` takes over when it verifies *and* carries a strictly higher version. Anything
wrong with it — truncated, tampered, a layout this build does not understand, or not actually newer —
is refused with a reason in the log while the shipped pack keeps serving. A bad pack never stops the
app; a **missing shipped pack** does, loudly, naming the directory it looked in, because an empty
model list would be a worse answer than none.

Nothing a user sees changed: the heatmap, the compatibility test report, the model context limits
and the priced-model set are byte-for-byte what they were, checked before and after.

**The judgement numbers moved in too — the ones that decide what the app tells you.** Every
threshold the advisor rules use (what counts as a bloated description, when two tools are "the same
tool", when wasted definition tokens are worth calling *high*), the skill-quality ceilings and score
weights, the compare and loop thresholds, and the token budget the app holds its own MCP server to,
are all maintained in the data pack now rather than written into the code. So are the hand-kept
model layers: the context windows and list prices for models the research dataset does not cover.

Two things about that are worth stating plainly.

**A recommendation can no longer misdescribe itself.** The advisor explains its own reasoning in
prose — *"'bloat' means a description is at least 50% of its own tool's definition tokens and at
least 100 tokens, measured over the 5 largest tools"* — and those sentences used to quote numbers
written separately from the ones the rule actually applied. They now read the same resolved values,
so changing a threshold changes the finding **and** the sentence explaining it, together.

**A bad pack still cannot make a model look free or limitless.** Context windows and prices keep a
copy compiled into the build, and a pack layers on top of it rather than replacing it. An unknown
context window silently switches off a safety check; an unpriced model makes the app *refuse* a
cost-capped run and treat planned spend as $0. Neither is something a downloaded file should be able
to cause. That compiled copy is generated from the same pack files, so there is still exactly one
place anyone edits.

One duplicate is gone: the waste-share bands that decide a trim's severity were written out twice,
identically, in two different rule files — the same shape as a bug this project has been bitten by
before. They are one entry, and a test fails if a second copy reappears.

Again, nothing a user sees changed: an advisor report over fixed inputs, a skill quality report and
a compatibility heatmap all hash identically before and after.

## Unreleased — the guide you shipped is readable inside the app you shipped

**The user guide now lives in the product.** Open **`/docs`** and you get the same 22 subjects that
live in the repository, plus the changelog — and it works in the container with no repository
anywhere near it, which is the point: hand someone the image and they can read how the thing works.

A **Help** control in the top bar opens the page for whatever view you are on, and falls back to the
index where a view has no page yet. One control, one route-to-subject table; no page had to be edited
to gain help.

Three faults turned up only because someone opened a browser, and all three had passed every
automated check: every link in the guide was **dead** (the markdown renderer emits links as buttons
with no address), then every link **opened in a new tab**, and link text failed **WCAG contrast in the
light theme** — measured at 1.36:1 against a required 4.5:1, and a perfectly fine 12.41:1 in dark,
which is exactly why testing one theme hides it. All three fixed and pinned by tests. The contrast
fault is not confined to the guide: the same colour is used for links in rendered skill documents and
in the assistant's replies, both already shipped, and both are now assigned for repair.

## Unreleased — the skill Studio stopped asking which view you wanted

**There is no Flow / Code / Split switch any more.** It is gone, not moved and not made smaller. The
Studio's first tab is the **Designer** — the visual composer — and every file in the skill, including
`SKILL.md` itself, opens as an ordinary source tab beside it. Editing the manifest as text and editing
a resource file are now the same gesture, and the canvas, the manifest and any file still add up to
**one** set of unsaved changes and **one** new version.

The left rail's tab finally reads **Components**, matching the panel it opens — it fits because the
three tabs now stack down the rail instead of splitting its width three ways. Old links keep working:
a shared `?rail=tools` address still opens it, and a bookmark carrying the deleted `?mode=split` lands
on the Designer rather than breaking. The version pickers in the Diff view stopped saying `v5 · v5`.

## Unreleased — a scene description finally became a drawing

**The illustration system can compose.** Twenty-four drawable components existed and nothing put them
together; now a declarative scene description becomes an actual picture — bands, lanes, hubs and cycle
rings laid out deterministically, connectors routed as orthogonal paths with placed labels, painted in
a fixed layer order, carrying a title and description for screen readers taken from the scene itself.
The same description renders byte-identically every time, so a scene can be stored and trusted.

Two honesty rules ship with it: a connector the router cannot honestly express is **drawn and
reported**, never silently dropped, and a scene that cannot be drawn shows a readable failure with the
reasons rather than a blank canvas.

Drawing them for the first time exposed a flaw in the connector styles themselves: of the six kinds of
line, two pairs are distinguishable **only by colour**. That is an accessibility problem the app has
already ruled on elsewhere — dashboard lines are differentiated by stroke pattern, not colour alone —
and it is recorded for the work package that will first put a real scene on screen.

## Unreleased — you can hand a run to someone else without copying the address bar

**A run worth showing someone can now leave the app in one action.** Open the run — or the suite
run — pick "Send to webhook…" from its overflow menu, and it goes to whatever is on the other end:
a Slack channel, a ticket, a script of your own.

Until now the only automatic way out was a watch rule, which decides for itself when something is
interesting. There was one manual button, but it deliberately sends made-up data — its job is to
prove the plumbing works, not to share a result. So the actual answer to "send this run to Ana" was
to select the URL out of the address bar and paste it into a message.

You pick the destination **by name**, not by URL. A destination is a webhook you already set up on a
watch rule, which is the one place its address was ever typed; that address stays encrypted on the
server and is never shown back to you or to anyone reading over your shoulder. And before anything
is sent, you see exactly what will be sent — the run's status, its cost, its tokens, and two links —
so it is never a blind action. Afterwards the send appears in that rule's own history, marked as
something a person did rather than something the rule decided, so "did that actually go out, and did
it work" stays answerable a week later.

**The links in those messages used to be broken, and not only in this feature.** Every alert this
app has ever sent out carried something like `/testing/runs/abc123` — correct inside the app,
useless in a Slack message, because it names no machine. Nothing was ever added in front of it. For
a rule's alert that was merely poor; for "here, look at this run" it defeats the whole point.

There is now one place that decides what URL the outside world gets told, and everything that sends
one goes through it. To make those links complete, tell the app the address you actually reach it at
by setting `APP_BASE_URL` — for example `http://localhost:8081`, or your real hostname. If you do
not, the links go out as plain paths exactly as they always have, and the send dialog says so up
front. **The app will not guess.** It knows which port it is listening on, but that is not the same
as an address someone else can open, and a confident `http://127.0.0.1:8080/...` in a colleague's
ticket is worse than an obviously incomplete path — it looks clickable and opens nothing.

One small thing that came with it: the existing "test this webhook" button still sends its made-up
sample, on purpose, but its link is now shaped like a real one. A test that proved the plumbing with
a differently-shaped link was quietly proving the wrong thing.

Not verified: nobody has clicked this in a browser, in either theme, and no send has ever been made
to a real endpoint outside the tests.
## Unreleased — the reference data the app judges against now lives in one place

The app checks your MCP servers against a pile of outside facts: how big each
model's context window is, what it costs, how many tools a given client will
accept, and the catalog of compatibility checks itself. All of that was filed
inside a research folder, in among the notes that produced it, and the only way
to correct a price or add a model was to edit source, run the full checks and
rebuild the application image.

Those files now live in one folder of their own, `data-pack/`, at the top of the
repository. Nothing about what the app does has changed — this release moves
files and adds a description of them; it deliberately changes no number and no
verdict. Every file moved with its history intact, and the proof that nothing
changed is recorded: rebuilding after the move produced output identical to what
was already committed, apart from the lines that say where a file came from.

What is new is the description. The folder carries a `manifest.json` listing
every file with its size and a fingerprint, and a JSON Schema for each kind of
file, so a corrupted or edited file can be spotted rather than trusted. Two of
those schemas did not exist before. Rebuild with `pnpm build:data-pack`; the old
`pnpm build:model-data` still works and says it has been renamed.

This is the groundwork for the real goal: letting an installed copy refresh
those facts on its own, without a new release.

## Unreleased — the test suite stopped failing at random

For a while the checks failed on a different file almost every run, and passed
whenever that file was run on its own. The convenient explanation was that the
machine was simply too busy, and that explanation was written down twice. It was
wrong.

Five parts of the project each rebuilt a shared piece of code as the first step
of their own checks — and because those checks run at the same time, several
rebuilds were writing to the same folder while other checks were reading out of
it. Watching one run directly: three rebuilds running at once, and the shared
file being replaced twice while tests were already using it. Reading a file
mid-replacement gives you a truncated or briefly missing file, which is exactly
"a different test fails each time, and none of them fail alone".

The rebuild now happens once. Whoever gets there first does it; everyone else
waits for them to finish. A rebuild is only treated as done if it actually
succeeded, so a broken one can't be mistaken for a good one and handed to the
tests.

A second, unrelated weakness was fixed alongside it: three speed checks were
timing themselves with a stopwatch, which on a busy machine measures how long
they waited for a turn rather than how long the work took. They now measure
processor time instead. **The limits were not relaxed** — only the clock
changed.

Before: roughly four failures in seven runs. After: five clean runs in a row.

## Unreleased — the skill diagram stopped being a picture and became a measurement

**You can finally see what a skill actually makes the model read.** Pick a `/command` or a keyword
on the skill canvas and the panel beside it tells you in plain words: *"always reads 4 sections,
1,240 tokens. May additionally read 1 file and call 1 tool, up to 3,900 tokens."* Every box is
marked as certainly-read or only-maybe-read. That sentence is the whole point of the work — the
diagram was never the deliverable.

This works because the arrows now mean something. Nine genuinely different relationships — a
keyword starting a skill, one step following another, a step containing a sub-step, a decision
branching, a step opening a file — were all drawn as the same anonymous line, so nothing could
count anything. Each arrow now carries its type, and which types are legal is written down **once**
and read everywhere, with a check that fails the build if a second copy of the rules ever appears.

**A file mentioned by four steps is now one box with four arrows**, not four separate boxes, which
is what makes "how many files does this command read" answerable at all.

**Connecting things stopped being a guessing game.** An arrow that could never be legal simply
doesn't attach — no error message, because nothing went wrong; you were shown the rule instead of
told off afterwards. An obvious near-miss offers the move you meant with a one-click button. A
genuine mistake explains the rule and links the guide. The old catch-all — *"Couldn't create that
connection"* — is gone, and a test over every possible pair of box types stops any message that
only says something failed.

**A decision point that wasn't one is gone.** The only "unresolvable branch" anywhere in the
registered skills turned out to be two ordinary narrative sentences being misread as conditions. The
fork that didn't fork no longer appears.

**Your layout is remembered.** Drag boxes where you want them; they stay put across reloads and
version switches, and an **Auto-arrange** button puts them back. Deliberately, these positions are
*not* written into the skill file — the skill's text is exactly what the model reads and what this
app charges you for, so storing cosmetics there would inflate the very number the app exists to
measure. A test proves the skill file is byte-for-byte untouched when you move a box.

*Not verified: nobody has used this. No browser was opened at all — there is no screenshot anywhere
in this work. Both themes, keyboard navigation, and whether the five line styles are actually
tellable apart on screen are all unknown, and no skill has been saved against a running server.*

## Unreleased — say what the run should have said, and a button that never worked

**You can now write the right answer.** When a run gets something wrong, the run console and the
review pane let you type what it *should* have said. That correction is stored alongside the run,
appears in the exported report under its own heading, and — the part that makes it worth doing —
pre-fills the expectation when you turn that run into a saved test. Correcting a run is now the
short path to a regression test for it.

**Fixing this uncovered a button that had never worked.** "Promote this run to a test" existed in
the interface and had a passing test, but the endpoint behind it was never written: in a real
browser it failed every time, and the test passed only because it was talking to a fake. The
endpoint now exists and is exercised against a real database.

**Your correction never changes your scores.** This is the rule the whole grading system rests on:
human feedback is recorded next to a run, never folded into how it was graded. A correction leaves
the grades, the rating document, the suite totals and the analytics exactly as they were, down to
the byte. That is checked by a test which also proves it isn't cheating by writing nothing — and the
check was deliberately broken during review to confirm it actually catches a violation before being
trusted.

*Not verified: no browser was opened. The new controls are covered by tests, not by a look in both
themes or a keyboard pass — and nobody has yet clicked the promote button end to end, which is
exactly how the broken one went unnoticed.*

## Unreleased — lines between the illustrations, and a contract that already knew where they attach

**The illustration system can now draw the arrows.** Twenty-four illustration components existed and
nothing joined them up. The connector router is the piece that does: give it a laid-out scene and it
returns every line as a right-angled path with rounded corners, plus a label placed clear of the
boxes. Lines that would otherwise be drawn on top of each other are pushed apart; a corner on a very
short run is tightened so the two curves meet instead of doubling back through each other.

It draws nothing itself — it produces geometry, and a later work package paints it. That separation
is deliberate: a function that only returns numbers can be checked exactly, so the same scene is
guaranteed to produce the same lines every time. That is enforced three ways, including running the
whole thing against a component catalogue rebuilt in reverse order.

**The most useful thing this work produced was a correction to its own instructions.** The spec said
illustration components do not record which side of themselves a connection point sits on, so the
router should work it out from the shape's bounding box. They do record it — and the setting's own
documentation says it exists precisely because the router needs it. Measured across all 93 connection
points in the test scenes: guessing from the box got 72 right and could never get a bottom-mounted
point right at all, because these shapes are symmetric about the spot they stand on. Reading the
declared side gets all 93. The builder measured it and reported it rather than quietly changing
scope; the instruction was corrected and the router now reads the declared side, keeping the guess as
a fallback for anything the catalogue has never seen.

Four line shapes are supported and there is deliberately no fifth. Where two points genuinely cannot
be joined by any of the four, the connector is **flagged** rather than drawn wrongly — three cases
remain in the test scenes, and they are for the next work package to resolve.

*Not verified: nothing here renders. No image was produced, no browser opened, no theme looked at.*

## Unreleased — a bug report you can send without reading it first

**A diagnostics bundle, and the one thing it will not promise.** Settings gained a single action
that produces the document you paste into a bug report: versions, which environment variables are
set, the database's shape and migration level, recent errors, and which features are switched on.
Served as `GET /api/diagnostics` and `GET /api/diagnostics/markdown`, computed when you ask and
stored nowhere — no migration, no table, no column, no dependency, no feature flag.

The point is not the document, it is that you can send it **without auditing it line by line**. So
the safety is built into the shape rather than bolted on as a filter: the environment section walks
a fixed list of the 78 variables the app recognises and records only `set` / `unset` / `default`.
There is no route from a variable's value into the output, which means no regular expression has to
be trusted. Free text you typed — server names, skill titles, scenario labels, MCP commands — is
never read at all; the bundle counts things instead of naming them. A test plants recognisable
secrets through the real storage paths (server env and header secrets, OAuth tokens, provider
credentials, and an encryption key whose own bytes are a sentinel) and fails the build if a single
one surfaces in either rendering.

**And it says where that promise stops.** A live failing scan showed that an error like
`spawn /opt/homebrew/bin/acme-mcp-server ENOENT` puts the command path you configured into the
errors section. Nothing else leaked — not the server's name, its arguments, a secret, or a variable's
value. It was left in rather than stripped, because an ENOENT without its path is not worth filing
and removing it would take a second redaction pass, which is exactly the kind of duplicate nobody
would keep honest. Instead the bundle is shown to you before it goes anywhere, its preamble tells
you to read the errors section, and a test pins the boundary in **both** directions so neither the
behaviour nor the wording can drift away quietly.

Where an error source does not exist, the bundle says **not captured** — a state the type system
will not let render as "zero errors", so silence can never pass for a clean bill of health.

*Not verified: no browser was opened for this. The Settings row, its dialog and the copy action are
covered by tests, not by a two-theme look or a keyboard pass.*

## Unreleased — one way to make a thing, one link to a chart, and a migration that had quietly broken feedback

**Building a skill now has exactly one path.** The Skill Studio's left panel was a list of the tools
a server offered. It is now a **Components palette**: nine draggable building blocks — Keyword,
/command, Section, Sub-routine, Gatekeeper, Validation gate, Loop guard, Tool reference, Asset
reference — above a collapsible **MCP Servers** section that adds a server from its own header,
removes one from its row, and lists that server's tools underneath. The separate strip of binding
chips is gone, and so are the "Add command", "Add section" and Legend buttons from the toolbar,
because creating something was possible two ways and now is possible one way. Anything that points at
a real thing — a script, a file, a server's tool — asks which one before it creates anything, instead
of dropping a placeholder that points nowhere. Every row can be dragged *or* pressed, so the keyboard
path survived the toolbar's deletion. Nothing is written until you save.

One rough edge ships with it, deliberately: the rail tab still says "Tools" while the panel inside
says "Components". The rename was tried and looked at in a browser — the word needs about 78 pixels
and has about 49 — and both ways of forcing it in were worse. It is written down at both ends and
belongs to the work package that reworks that rail.

**A chart's settings now fit in a link.** The dashboard's time resolution used to be decided purely
by how wide the date range was — hourly under two days, daily under sixty — with no way to say "this
range, but hourly". There is now a **Bucket** control that says so, and the choice travels in the
URL; leaving it on Auto writes nothing, so an untouched dashboard link is character-for-character
what it was. Asking for more bars than a chart can draw does not silently do something else: the
panels are drawn coarser and **a note says what you asked for, what is drawn, and why**, keeping your
choice so it comes back when the range narrows. Separately, every panel now has a copy-link button,
and opening such a link lands the reader on that panel with a ring around it. A link naming a panel
that no longer exists is ignored rather than breaking the page.

**A migration had been quietly breaking human feedback on older databases.** Building a test harness
from *captured* databases — rather than new ones with pieces stripped off, which is what the existing
tests did — turned up a real defect on its first run. A step from early in the schema history rebuilt
one table by renaming it out of the way first, recorded as safe because nothing referenced that table.
That stopped being true when the feedback table was added and pointed at it. SQLite quietly rewrites
such a reference to follow a renamed table, and the rebuild then deleted what it now pointed at — so
on any database old enough to run that step, **every** write of human feedback failed afterwards, and
the routine integrity check could not see it because the table was empty. It is fixed by the same
approach a later migration already used for the same reason. The fix repairs the path forward; a
database already damaged this way needs a separate repair step that has **not** been written.

**Also:** the illustration system gained the layer that lets its 24 drawings be arranged into a
picture — a scene is now a JSON document with a validator that refuses one naming anything that does
not exist, and the same document always lays out identically. Nothing is drawn from it yet. And
`pnpm test` no longer depends on a build that happened earlier: one package was reading a stale copy
of the shared contract, which could report a failure that was not real — or, worse, hide one that was.

## Unreleased — the advice fits on the screen, and the grid stops lying

The Advisor's top recommendation used to bury its own conclusion. It would tell you that trimming
139 never-called tools from a server saves about 136,502 tokens a turn — and then print all 139 tool
names as a comma-separated paragraph, twenty lines of `qlik_*` identifiers, between that sentence and
the panel explaining how the number was reached. One recommendation filled the screen, so you saw one
of sixteen without scrolling.

The names are still there, now behind a disclosure that states the count — "Show 139 never-called
tools" — so the fact survives the fold and only the identifiers are put away. Two recommendations now
fit where one did.

The same page held the only real target-size failures in the app: every evidence link under a
recommendation was a 16-pixel-tall click target with four pixels between rows, which is below the
accessibility floor and genuinely fiddly to hit. All 221 of them are now 26 pixels tall with room
between the rows; a re-run of the audit's own probe reports zero failures where it previously found
55.

Two rendering bugs went with it:

- **The illustration catalog drew the wrong grid.** Every blueprint stage derived its grid pattern's
  id from the grid's geometry alone, so the 68 stages in a detail dialog shared two ids between them.
  A browser resolves that to whichever came first, so every stage painted the *first* stage's grid
  phase — and since the phase is computed from each stage's own centre, any stage of a different size
  drew its grid out of registration with its own crosshair. It was invisible on the gallery, where
  every card is the same size, and plain in the detail dialog, which exists precisely to show
  different sizes side by side. Each stage now owns its ids: 68 stages, 68 grids.
- **The run console logged a React error on every load.** The cost tile put a paragraph inside a
  paragraph — invalid HTML the browser silently re-parents, and a permanent error in the console of
  the busiest screen in the app, which is exactly how a real error goes unnoticed. The wording is
  unchanged; the console is clean.

One related fault is **not** fixed, and is recorded rather than quietly absorbed: the toolbars on
tables inside a rendered `SKILL.md` — *Copy table*, *Download table*, *View fullscreen* — have no
focus ring, name themselves with a tooltip attribute that assistive technology does not read, and are
smaller than the minimum target size. They are not this app's markup; they come from a third-party
markdown renderer bundled inside the design system, and patching them locally would mean overriding
another library's class names, which breaks silently on the next upgrade. The gap has been written up
for the design-system owner instead.

Two more things on the same pass:

- **A half-screen window no longer eats the button you came for.** At exactly 768px wide the runs
  feed and the run console were losing their primary actions — `+ New run` sat 190 pixels past the
  right edge of the page, `Re-run with changes` 207 past it, and because nothing in the page scrolls
  sideways they were not off-screen, they were **gone**. The runs feed now folds its secondary
  actions into an overflow menu below 1024px and keeps `+ New run` visible; the console's bar wraps
  onto a second line instead of clipping. Wider windows are untouched — the console bar measures the
  same 39 pixels at 1024 and 1280 as it always did, and only reflows when the row genuinely would not
  fit.
- **The runs table stopped saying the same thing two ways.** In one table, in adjacent rows, a suite
  row's status carried an icon and a run row's did not; a suite's grade was plain text while a run's
  was a badge; one row offered "Open console" and the next "Open". Two encodings in one column read
  as two meanings. Each column now has one, and the row indent already tells you which is which.

Server cards no longer repeat the chips their own group heading states — which also gives the card
its title back, so `mcp-assets` stops rendering as `mcp-ass…`. The run launcher sizes itself to the
step it is showing rather than holding a fixed height with 380 pixels of nothing under it, and its
step rail says "Tests & environments" in full. On a skill's Overview, the shorter card stops
stretching to match its taller neighbour.

One finding was left alone on purpose: three "decorative" left-edge stripes flagged by the automated
pass turned out to be two blockquote rules around quoted text and one that encodes diff state in the
compare view. Changing them would have been the regression.


## Unreleased — two corrections you asked for

**Every file tab in the Skill Studio now has its own ×.** It previously had one close control at the
end of the strip that acted on whichever tab was active. Doing it properly meant the tab strip no
longer uses the component library's tab primitive — a close button cannot legally live inside a tab
button — so it now handles its own keyboard behaviour: arrow keys and Home/End move between tabs,
Delete closes the focused one, and however many files are open the strip costs you two tab stops
rather than one per file. The main instructions tab still has no × and cannot be closed.

**A warning-level watch alert now arrives at the severity you set.** It was being quietly demoted one
step — a rule you marked critical would notify as a warning when it crossed its warning line. If you
set a rule to critical, it sends critical; which line was crossed is still recorded and still visible.

The skill inspector's design tab also stopped offering "Edit in Studio" twice; the one inside the
preview stays.

## Unreleased — a skill's files are editable where the skill is edited

The Studio could edit a skill's instructions and its settings, but its files were a read-only list —
to change a reference file or add one you went back to the inspector, which had its own separate
save button and made its own separate version. Two places to edit one skill, two ways to save it.

Files now open as tabs in the middle of the Studio, editable, and they join the same set of unsaved
changes as everything else: add a reference file, type into it, mention it from the instructions, and
that is **one** save producing **one** new version. The main instructions tab can't be closed, and
the flow view is offered only where it means something.

The inspector's file tab is now for reading — its save and discard controls are gone, along with the
dialog behind them and a third hidden save path that lived on the same tab. There is one place to
change a skill and one way to save it.

## Unreleased — charts and alerts can ask "what share?"

Every measure on a chart or a watch rule was a single number over one set of runs — a count, a mean,
a total. There was no way to ask what *share* of something something else was, which is the shape of
almost every question worth alerting on: the error rate, the pass rate, how much of the token spend
came from cache, what fraction of runs a skill was attached to, what share of answers the automatic
rating called unanswered.

You can now build a measure as a question: "count the runs that match **this** — out of the runs that
match **that**". Both halves use the same filter controls as the runs feed, so anything you can
filter for, you can take a share of. Two rules keep the answers honest: the numerator is always
counted within the base, so a share can never exceed 100%; and a window where the base is **empty**
is left out of the chart entirely rather than drawn as 0% — a bench where nothing qualified and a
bench where nothing went wrong must not look the same.

The "share of runs with human feedback" measure, which had been listed but never actually worked,
works now.

Under the hood, the two separately-maintained copies of the run-filter translation became one. They
were supposed to be kept in step by a cross-check; only one of them was ever covered by it, so the
charts could have drifted from the feed without anyone noticing.

## Unreleased — a skill's settings, edited as settings

Changing what a skill binds to, what triggers it, or which `/commands` it answers meant editing YAML
frontmatter by hand — and binding a server saved a whole new version of the skill the moment you
clicked, whether or not you were finished.

The Studio now has a settings panel: name, description, bound servers, keywords and command entry
points, all as ordinary form controls. Everything you change there joins **one** set of unsaved
edits together with your canvas and text edits — one unsaved-changes count, and one button that says
which version it is about to create, e.g. "Save as v5". Binding a server stages like everything else
instead of saving behind your back, and a registered server that has never been scanned offers to
scan right there, so its tools appear without leaving the page.

The skill's Overview page is now purely a report: its keyword editor and its own save button are
gone, and its server list links into the Studio to make changes.

One bug went with it: a description written as a folded YAML block would have been corrupted when
anything else on the page rewrote the frontmatter. That shape is now refused rather than mangled.

## Unreleased — a rule can start a CI run, and the feed can ask about ratings

Two additions around the parts of the bench that watch it for you.

**A watch rule can now trigger a GitHub Actions workflow directly.** Until now a rule could call a
generic webhook and you built the rest yourself; "a regression appeared, so re-run the suite in CI"
now closes with nothing new to host. It uses the GitHub account you already connected in Settings —
there is no second place to put a token — and it never puts the token, the target URL or your
workflow inputs into a stored result, an error message or the notification centre. When GitHub
refuses, you get a sentence saying which of the four likely causes it was, rather than its raw reply.

**The runs feed can filter on what the automatic rating concluded** — whether the answer actually
addressed the prompt, whether the extra insight was valuable or noise, and which failure bucket and
fix target the error forensics landed on. Two rules make these honest: a re-rated run is judged by
its *latest* rating only, and a run that was never rated matches *no* verdict rather than quietly
counting as a negative one.

## Unreleased — skills get a workbench instead of a panel

Editing a skill used to happen inside the inspector — the same page you read a skill on, with the
canvas squeezed into whatever room a detail panel left it, and save controls scattered across tabs
that had nothing to do with each other. There was no single place that meant "I am working on this
skill".

There is now: a full-screen **Studio** at `/skills/<id>/studio`. The middle is the work — flow,
source, or both side by side — and it keeps at least 60% of the window even with both side rails
open, more when you fold them. The rails hold files, tools and settings; the strip along the bottom
holds problems; the toolbar across the top holds the view switch, the unsaved marker and one save
action, and it never scrolls away. Leaving with unsaved edits still asks first.

The inspector goes back to being somewhere you read a skill: its Design tab is now a preview with a
link into the Studio, and the save cluster that used to sit in its header is gone.

## Unreleased — a silent bench no longer reads as good news

A watch rule that fires on a window — "error rate above 10% in the last hour" — decided, on every
tick, whether the window was over the line. It had exactly two answers: over, or not over. An hour in
which **nothing ran at all** had no way to say so, so it was counted as "not over", and the rule
announced that the problem had **recovered**. A bench that fell over hard enough to stop producing
runs reported itself healthy.

An empty window is now its own answer, and you choose what it means: hold the current state (the
default — neither recover nor re-announce), alert on it, or ignore it. A held window is written into
the rule's history, so when you come back you can see the silence rather than infer it.

Three other things watch rules were missing:

- **A warning level below alert.** One rule can now carry both, and a warning that later crosses the
  alert line still gets through even if the rule is inside its quiet period — a warning that
  swallowed the alert behind it would be worse than no warning at all.
- **Pause, which is not the same as off.** Off means you don't want the rule. Pause means you already
  know, stop telling you until a set time. A paused rule keeps watching and keeps recording; it just
  doesn't notify — so it never comes back armed and blind. It expires by itself.
- **A minimum interval between alerts for per-run rules.** A broken environment producing fifty
  failing runs used to produce fifty notifications; these rules had no rate control of any kind.

Existing rules are unchanged: no thresholds move, no severities change, and a rule with none of the
new settings behaves exactly as it did.

## Unreleased — the runs feed is a link again

The runs feed could already be filtered, searched, grouped, sorted, re-columned and saved as a named
view. None of that survived a reload, and none of it travelled: the filter was in the URL, but the
applied view, the grouping, the sort, the type facet and the visible columns were held in the page
and thrown away. Two people looking at "the failing runs, grouped by environment, sorted by cost"
had no way to arrive at the same screen except by describing it to each other.

All of it now rides in the address bar, so the arrangement you are looking at is the link you paste.
A saved view is additionally a short named URL, and applying one writes out what it resolves to, so a
shared link needs no lookup to reproduce. A value that is already at its default is left out, so the
plain `/testing/runs` address is unchanged and stays clean; a stale or hand-mangled URL opens a
working feed instead of an error. One small bug went with it — the view picker used to keep showing
a view's name after you edited the filter underneath it, which would have made a shared link lie
about where it came from.

## Unreleased — a tool result reads the same wherever you open it

Most MCP servers answer a tool call by handing back a single block of text, and that text is almost
always a JSON document with every space squeezed out of it. The conversation pane already knew this
and unpacked it; the **Trace** tab and the **packet inspector** did not. The same result therefore
read three different ways depending on which tab you were standing in — indented and highlighted in
chat, one unbroken line in Trace, and in the inspector a `\"`-escaped string buried inside a tidy
wrapper that was tidy around the wrong thing.

All three now unpack a result through one shared step, so they cannot disagree about what a tool
returned. A JSON payload is indented and highlighted; prose stays prose, untouched.

Both technical blocks on a tool call in chat — **Parameters** and **Result** — also gained the
**Expand** button they were missing. Each opens the same full-payload window the Trace tab opens,
with the step's own detail panel beside it. Previously a clamped block was a dead end: you could
scroll inside a small box, or leave for another tab.

## Unreleased — a run finally shows its shape

The run console could tell you everything about a session except the one thing you ask first: what
did the agent actually *do*? Chat, Steps, Turns and Trace are all sequences — to see that the agent
called `search_docs`, answered, called it again, answered, and called it a third time, you had to
read the whole list and hold the pattern in your head.

A **Graph** lens now draws the run as a node-link diagram. *Aggregated* — the default — merges calls
that share a name into one node carrying a **×N** counter, so a repeated loop renders as an actual
cycle with a traversal count on the edge, and the run's shape is legible at a glance. *Expanded*
unrolls every call into its own node, left to right in execution order. Node chips carry call count,
tokens, cost and duration; a failing node states "1 error" in words behind a glyph rather than
relying on a red border, and parentage (a judge call under its rating span) is a dashed line rather
than a hue.

Selecting a node reveals the **Steps** lens filtered to exactly the steps behind that node, with a
banner naming it and a way back. The lens, its mode and the selected node all ride in the URL
(`?lens=graph&graph=expanded&focus=…`), so the exact view is shareable, and the zero-parameter run
URL still opens the console as it always did.

Nothing is stored. The graph is a pure projection of steps the console already holds, so it grows
live as a run streams and is byte-identical on replay. A run recorded before step hierarchy existed
renders flat and says so, rather than implying a structure it never had. Cost is reported as
**unknown** — never as `$0.00` — on a run that carries no per-step snapshots.

Built on the design system's existing flow canvas: no new dependency, no schema change, no wire
change, no migration.

## Unreleased — you can tell the grader it was wrong

Every run is graded automatically, and until now there was no way to say the grade was wrong. Each
grade card — run console and suite matrix cell alike — now carries a thumbs-up / thumbs-down and an
optional note.

**A verdict never touches the grade.** `run_grades` stays append-only (AR6): the score, status,
method, judge reasoning and grading version are byte-identical before and after you disagree, and
suite aggregates and analytics computed from them are byte-identical too. Three tests assert this,
each paired with a check that the verdict really landed so none can pass vacuously — and they were
deliberately broken and watched to fail before being trusted. A human opinion cannot be averaged
into a machine score by accident.

The runs you have judged become a **calibration set**, derived rather than flagged: a run joins the
moment one of its grades carries a verdict, so there is no `is_calibration` column to drift out of
sync. Export it as JSON or Markdown. The export deliberately omits credentials, judge reasoning,
transcripts and tool arguments, which makes "no secrets" a property of its shape; the cost is that
the export alone is not a full audit, and drill-down stays in the app.

Settings shows verdict counts and **not** an agreement percentage — a ratio over a few verdicts
spanning mixed grading versions would read as a score of your judge long before it earned one.
Measuring agreement, and guarding a judge change against the calibration set, is the next work
package.

Migration **v60** adds one table and one index. No new dependency, no new route.

**Not verified:** the new control has not been looked at in a browser, in either theme, or driven by
keyboard — and nobody has judged whether a per-cell thumb row is tolerable at real suite-matrix
width.

## Unreleased — the app can be handed to someone who has no repository

`docker compose up --build` needs the source tree, so anyone outside this repository could not run
the workbench at all. `scripts/release.sh` now builds a **self-contained offline bundle** —
`dist/release/v<version>/` holding the image as a gzipped `docker save` tarball, a `run.sh` and a
`run.ps1`, a recipient-facing README, and `SHA256SUMS.txt`. The recipient drops the launcher beside
the tarball and runs it: checksums verified, image loaded, any previous container replaced **while
its data volume is kept**, a free port found by probing upward from 8080, `/api/health` polled, the
browser opened. Re-running it with a newer bundle upgrades in place instead of resetting.

No secrets travel — `.dockerignore` excludes `.env*`, `data/` and `.git`, so each install generates
its own encryption key on first boot. The image is cross-built to `linux/amd64` (the build host is
Apple Silicon; most recipients are not) from committed `HEAD`, with the quality gate run on the host
first so a failure arrives before the slow image build rather than after it. `--publish` also cuts a
git tag and GitHub Release, though a private repository means those assets reach only people who
already have access.

**This code shipped earlier and is only now written down.** The roadmap item was a stub with no
ledger; it was retired on 2026-08-21 and its delivery recorded. **It has never been verified end to
end:** no bundle has been built and cold-started on a clean machine, `run.ps1` has never been
syntax-checked or run on Windows, and `--publish` has never been exercised.

## Unreleased — the launch estimate counts your own runs instead of guessing

The pre-launch token and cost band assumed every run takes between **1 and 8 turns** and emits **350
output tokens a turn**. Those four numbers were written when the preview shipped and were never
checked against a run. Measured over 122 completed runs on the owner's own database, the median run
takes **6** turns and the 90th percentile takes **16** — so `8` was never a ceiling, it was roughly
the two-thirds mark.

**The turn count now comes from your completed runs**, keyed narrowest-first: past runs of this test
on this environment, else of this environment, else of everything, and only the static constants when
there is genuinely no history. Stopped and errored runs are excluded — their turn count records how
long the interruption was, not how long the task takes. Output tokens per turn are measured from the
same sample, because measuring one and assuming the other would be incoherent. A scenario's
`maxTurns` guardrail still caps the result, applied last.

**The estimate says where its number came from.** Under the band, in the run launcher, the suite
run-confirm and the fork dialog: *"Turn count from 51 past runs of this test on this environment."* —
or, on a fresh install, *"Turn count is an assumption — no past runs to measure."* A band built from
51 real runs and a band built from three frozen constants used to paint identically, which is how an
8-turn ceiling survived unnoticed against a 19-turn run.

**Measured live, and the honest result is mixed.** The turn band brackets **93–96%** of real runs
where the old constants managed 49–61%, and the run that exposed the problem — 19 turns, 966,904
tokens, $0.80 billed — now falls inside the token band, where the old ceiling put it 1.86× out of
reach. But sharpening the turn count exposed a second error it had been hiding: the arithmetic
charges an environment's entire scanned tool footprint on **every** turn from the first and never
looks at the environment's tool-loading mode; fitted against real runs it over-states them by a
roughly constant 93k–175k tokens. That is negligible on a long run and a 2–3× error on
a short one — so the token band's overall *coverage* of real runs went **down**, and the cost band's
floor, which is evaluated at the busiest plausible run length, now sits above the typical run's real
cost. Neither was fixed here; both are recorded as follow-up work with the numbers behind them.

Treat the band as a bound, not a forecast. No migration, no new dependency, no feature flag.

Plan and evidence: [`planning/Roadmap/RM-34-estimator-turn-model-calibrate/`](./planning/Roadmap/RM-34-estimator-turn-model-calibrate/)
(ledger: [`STATUS.md`](./planning/Roadmap/RM-34-estimator-turn-model-calibrate/STATUS.md), decisions
D-ET1–D-ET8).

## Unreleased — you can see what prompt caching is doing

A run console could report **Tokens ↑ 958,457** while, two tabs away, a chart showed a single turn as
45,938 cached against 1 uncached — and nothing between those two screens connected them. The counting
was never wrong: cost has always priced a cache read at ~0.1× and a cache write at 1.25×, which is why
a run billed $0.80 where the raw token count suggested $3.00. What was missing was any way to see it.
Exactly three screens in the whole app mentioned cache, and the run console was not one of them.

**Cache reads and cache writes are now never merged into one number.** They point in opposite
directions — a read is a ~90% discount, a write costs 25% *more* than an uncached token — so a single
"cached" figure makes a premium look like a saving. They are separated, and each is labelled with what
it costs, in the run console's tiles and tooltips, the Trace and Steps views, the Analytics tab (three
stacked series, not two), the runs feed, the suite rollups, the reports, the compare workspace, and
the workbench MCP surface.

**The Testing dashboard gained a Prompt cache panel** — read volume against write volume, plus a
hit-rate line — and three new measures (`cacheReadTokens`, `cacheWriteTokens`, `cacheHitRate`) that
the custom chart composer and the watch-rule editor pick up automatically, so you can chart cache
behaviour over time or alert on it degrading.

**The launch cost preview stopped ignoring caching.** It charged every input token at full list rate
and re-charged the re-sent context on every turn; against a real run billed $0.798 it predicted $3.00.
It now returns a band whose low end assumes caching works and whose high end is the old arithmetic
unchanged — $0.744–$2.917 for that run.

**Where the split cannot be known, the app says so.** A run that predates the measurement, or whose
provider reported one merged total, reads **"not measured"** — never a zero. A 0% cache-hit line is
indistinguishable from caching that has stopped working. Migration **v59** recovered the split for
**141 of 163** existing runs from per-step data already on disk; the rest are marked unknown rather
than written off or silently zeroed.

Plan and evidence: [`planning/Roadmap/completed/RM-33-cache-aware-token-accounting/`](./planning/Roadmap/completed/RM-33-cache-aware-token-accounting/)
(ledger: [`STATUS.md`](./planning/Roadmap/completed/RM-33-cache-aware-token-accounting/STATUS.md), decisions
D-CT1–D-CT6).

## Unreleased — the app can draw itself

**Update (2026-08-21, later): twenty-four, and adding the next one is a recipe.** A scaffold
(`node packages/illustrations/scripts/new-component.mjs <Name> --cast <cast>`) now writes a new
drawing's file, its test, its catalogue entry and its changelog line in one go, so nobody has to
copy whichever neighbour they happened to open — and the twenty-fourth, an **owner/user**, was made
that way as the proof. The catalogue also gained a guard with teeth: a checked-in record of what
each drawing *promises* (its name, its connection points, its variants, states and sizes) now fails
the build if an existing promise is **broken** without the catalogue's version moving — and stays
quiet when something is merely **added**, which is the case such checks usually get wrong.

**Update (2026-08-21): the cast is now twenty-three, not three.** The catalogue covers most of what
the app actually deals with — a **model**, a **provider** (a blank nameplate, never a vendor logo),
a **validator**, a **run**, a **prompt**; a **tool**, a **resource**, a **prompt template**, a
**file**, a **feedback report**, a **scan** (an arch a server stands under), a **token meter**; and
a **suite**, a **collection**, an **orchestrator**, a **comparison**, an **environment**, a
**database**, a **credentials vault** and an **assistant**. Everything below still holds — they are
live components, they carry no colours of their own, and none of them is allowed a hand-drawn path.
Still missing from this phase: the scaffold and checklist that let a new drawing be added by
following a recipe rather than by copying a neighbour.

There is a new page at **`/illustrations`**, and it is the first thing you can look at from the
illustration workstream. It lists the app's own isometric drawings — an **MCP server**, a **skill**
and an **LLM agent** — and they are live components rather than exported images, so switching the
theme repaints every one of them. That is the whole point of how they are built: not one drawing
names a colour, so a theme nobody has drawn them in still lights them correctly.

Open one and you get it at all five **states**, at all three **footprints** framed against a single
box so the size difference you see is the real one, at each of its **variants** (a server as stdio or
as streamable-HTTP; a skill as one sheet or as a version stack), facing upstream and downstream, and
its catalog entry — ports, keywords, tier, registry version. A **port overlay** switch marks the
named attachment points a future diagram would connect lines to.

A second tab carries the drawing vocabulary the three are composed from — the paper stage, the
platform and housing solids, the glyph frame, the construction ghost, the six connector kinds, the
calibration cube. Every entity is built only from those parts; a test refuses any entity whose
rendered output contains a hand-drawn path at all.

**What this is not, yet.** There is no scene composition: you cannot lay several of these out into a
diagram, there is no step-by-step explainer, and you cannot describe a workflow to the assistant and
get a picture back. Those are the next phases. The page is also route-only — there is no sidebar
entry for it yet, so reach it by address.

## Unreleased — the two assistants get their own switches

Settings › Features carried one switch called **Assistant**. Turning it off did what it said and
rather more: the full-page Assistant workspace disappeared from the sidebar *and* so did the
App-assistant dock on the right-hand side of every page — two unrelated surfaces sharing one
off-switch, with no way to keep one and drop the other.

**They are now two switches.** *Assistant workspace* covers the `/assistant` pages and their sidebar
group. *App assistant* covers the right-hand dock, its ⌘J shortcut and the “Ask the assistant”
buttons that open it. Each turn-off confirmation names only its own surfaces, and turning either one
off leaves the other exactly as it was.

The Claude sign-in in Settings › Assistant belongs to neither and survives both: the workspace runs
on that same credential, so switching the dock off can no longer lock you out of signing in.

An instance that already had the Assistant switched off keeps the **workspace** off. The dock is a
newly separate capability and arrives on, like every other feature does.

## Unreleased — the list rail becomes a place

Servers, Skills and Collections used to be a fixed 288-pixel list column beside a detail pane. One
server row squeezed a name, a health dot, a health chip, a token total, a posture band, a transport,
an auth kind and an endpoint into that column, which truncated the names to `barc…`, `qlik-…`, `m…`
— and it charged every detail page 288 pixels for a list you look at once.

**Each of those three is now an overview page.** Opening MCP Servers shows the whole fleet as a grid
of cards grouped by server type, switchable to a grouped table and remembered per section (the mode
also rides in the URL, so a view can be shared). Skills group by source, Collections by whether they
are bound to a git repo. Selecting one opens its **full-width** detail page.

**Switching entities moved into the breadcrumb.** The crumb now reads
`Home › MCP Servers › [barc-benchmark ▾]`, and clicking the last part opens a searchable, grouped
list of every server — the same grouping the overview uses. Clicking `MCP Servers` goes back to the
overview.

Three smaller corrections fell out of it: landing on `/servers` or `/skills` no longer teleports you
to whichever entity happened to sort first (the address you typed is the page you get); deleting the
entity you are looking at returns you to its overview instead of swapping the page's subject for an
unrelated one; and an address naming a server or skill that does not exist now says so, rather than
showing a "nothing selected" prompt for a state that can no longer happen.

The screenshots in the README still show the previous layout.

## Unreleased — the bench takes its own medicine

We pointed the new security analyzer at the workbench's **own** MCP mount and it returned **49/100,
band `high`**. Reading the findings changed three things — two in the analyzer, one in the mount.

**The analyzer was wrong twice, and is now tighter.** `annotation.open-world-unmarked` matched its
whole term list in a tool's *description* as well as its name, and a description names what a tool
**returns** as often as what it does — so it flagged `servers_list` for the word "url" in *"transport,
command/url, auth kind"* and `skills_list` for "upload" in *"source (upload/GitHub)"*. Neither tool
reaches anything; both read the local database. The term list is now split: a tool's **name** keeps
every term, while its **description** accepts only unambiguous action inflections (`fetches`,
`downloads`, …). Both real false positives are regression fixtures now, verbatim.

**The score was measuring surface size, not risk.** The deduction was an unbounded sum, so 49 hygiene
nudges — zero errors, zero warnings — dragged the mount into the same band as a server carrying three
genuine tool-poisoning errors. Each severity now deducts at most a documented cap: `info` stops
counting after 10 findings, `warning` after 5, and `error` is **uncapped** on purpose. Hygiene is a
bounded concern; there is no honest ceiling on the number of separate ways a server can be trying to
steer a model. An `info`-only report now floors at 90/`low`.

**And the mount really did deserve 49 findings.** It declared 49 parameters with **no description at
all** — an agent could not tell whether `runs_list`'s `since` wanted a timestamp or a run id. All 49
are described now, tersely. That costs 434 tokens, which took the definition footprint past its own
3,000-token budget, so the budget was raised to **3,500** — deliberately, with the reasoning written
into the constant: there was no fat left to trim, and leaving parameters undescribed to keep a number
under a line we drew ourselves is exactly what we would criticise a vendor for.

The mount now measures **24 tools · 3,183 tokens** and scores **100/100, `clean`** against its own
analyzer. `SECURITY_ANALYZER_VERSION` moved 1 → 3, so reports from different builds are refused for
comparison rather than silently diffed.

## Unreleased — security posture, on the page

The deterministic security analyzer built over the previous four work packages is now **visible**.
Every scan and every skill version has a **Security tab**: findings worst-first, each naming the rule
that fired, what it fired on, and the matched evidence. Invisible characters are rendered visibly as
`\uXXXX` — surfacing them is the entire point of the rule that finds them — and anything
credential-shaped is masked to `«redacted»` before it reaches the screen. A 0–100 score and a risk
band sit above the list; the servers list carries a posture badge per server, fed by **one**
`GET /api/security/summary` request rather than one per row.

Pick a baseline and the tab becomes a diff — added, resolved, carried over — with the selection in
the URL, so the state is shareable and survives a reload. **A comparison that cannot be trusted is
refused rather than answered**: two different servers, a server against a skill, two different
analyzer versions, or a report whose list was truncated each produce an explanation with the current
report still on screen. A subject with nothing wrong says so and names what was checked, because a
blank panel is indistinguishable from a broken one.

The analyzer itself reads only what the app has **already stored** — no MCP connection, no skill
execution, no network — and persists nothing: every posture answer is computed on read. Eighteen
frozen rules: eleven over a server's tool surface (injection phrasing, hidden instruction blocks,
invisible unicode, annotations that contradict their own tool, credential-shaped parameters,
unconstrained schemas, OAuth scope breadth) and seven over a skill (the same steering heuristics over
`SKILL.md`, a credential in the body, a wildcard `allowed-tools` grant, shipped scripts, network
references).

The CI gate's `no-new-security-findings` rule was re-pointed at the same comparison the tab uses, so
the page and the pull request cannot disagree about which findings are new. Its own test file was
left byte-identical through that change, which is the proof no gate behaviour moved.

Exported **scan and server reports** now carry the posture too, in JSON and Markdown alike: score,
band, analyzer version, per-severity counts, the findings and their redacted evidence, in a fixed
greppable shape built in exactly one file. A subject that cannot be scored — a scan that failed, a
skill whose `SKILL.md` is not readable text — exports successfully with one honest line saying so;
it never fails the download, and it never renders as clean. (There is no skill *report* endpoint
today, only a zip download of a version's files, so the skill half of that integration is not built
rather than invented.)

No migration, no new dependency, no feature flag.

## Unreleased — one governed home for research, planning and the guide

Every research, roadmap and user-guide document now lives in a single **Open Knowledge Format
bundle** at [`planning/`](./planning/), and the rules that keep it honest are mechanical rather than
cultural.

Each investigation is a tagged `RS-NN` topic, each initiative a tagged `RM-NN` item with its own
`STATUS.md` work-package ledger, and each part of the system a tagged `DC-NN` documentation subject
that holds both the record of what shipped and that part of the manual. Tags are two digits,
allocated atomically and never reused, so a cross-reference stays valid for the life of the project.
The loose `planning/Research/`, `planning/Roadmap/` and `planning/user-guide/` trees are gone; 569 documents moved into tagged
folders and every internal link was re-pointed.

**A plan can no longer be quietly "finished".** Work is planned as an `RM` item, built against its
ledger, recorded in a `DC` subject as *what shipped versus what was planned*, and then retired by a
transactional command that refuses while any ledger box is still open. Five finished initiatives —
the Assistant Hub UX rebuild, Interface Craft, server types, Toolbar Reach and Unified Sessions —
went through that path and now sit in `planning/Roadmap/completed/` with their deliveries, their
deviations and their unverified gaps recorded against the subjects they shipped into.

**Enforcement runs at the moment of the edit.** A pre-write hook rejects a `README.md` inside the
bundle, a by-hand `status: "done"` flip, a document that lands outside its domain folder, or a
meaningful edit that leaves its timestamp untouched; a post-write hook revalidates the whole bundle;
and both conformance layers plus the bundle's own 34 tests run in CI. `pnpm okf:validate`,
`pnpm okf:sync` and `pnpm okf:test` are the local equivalents. The lifecycle is written down as §11
of [`CLAUDE.md`](./CLAUDE.md), and `/next-wp` now closes a plan out rather than stopping at the last
tick.

No application behaviour changed. The one code-visible consequence: the model-comparison dataset the
compatibility engine builds from now reads from
`planning/Research/RS-01-token-context-comparison/outputs/data/**`.

## Unreleased — headless automation: the bench is operable by machines

The **CI & headless automation** workstream is complete (all 11 WPs, Phases 1–3 + Phase MCP,
decisions **D-C1–D-C22** and **D-MCP1–D-MCP13**), and **security-posture Phase 1** landed with it
(WPs 1.1–1.2, decisions **D-SP1–D-SP11**). Everything the bench measures is now reachable three ways
— over MCP, from a terminal, and from a build pipeline — through the same API, so all three give the
same numbers. Authoritative per-WP state: [`planning/Roadmap/RM-08-ci/STATUS.md`](./planning/Roadmap/RM-08-ci/STATUS.md) and
[`planning/Roadmap/RM-20-security-posture/STATUS.md`](./planning/Roadmap/RM-20-security-posture/STATUS.md).

**The workbench MCP server can now act, not only read.** The `/api/mcp` mount grew three write tools
— `scan_run` (`scan:run`), `suite_run_start` (`suites:run`), `run_plan_start` (`runs:launch`) — one
per execute scope in the frozen D-C4 vocabulary, each re-projecting a service the HTTP API already
exposes. A write tool answers with a **ticket, not an outcome**, and names the read tool that polls
it; both launch tools carry the launcher's own advisory cost estimate (`buildRunPlanEstimate`,
re-projected by import). `run_plan_start` refuses `source: "suite"` twice — the enum has no such
member and the handler names `suite_run_start` — so `runs:launch` is never a back door onto a saved
suite. **Nothing on the surface deletes, prunes, revokes or edits configuration, at any scope, at any
phase** (D-MCP3, made mechanical by a test over the registered tool names). WP M.2's scope gate
absorbed the first tools that actually need it with **zero change to itself**. The mount now measures
**24 tools · 2,749 definition tokens** against the **unchanged** 3,000 budget.
`createWorkbenchMcpServer`'s `caller` parameter lost its allow-everything default (D-MCP13) — a
default-open parameter in an authorization path is a latent privilege escalation.

**`mcpfp suite run`** starts a saved suite's matrix and waits for it by **polling**, not by consuming
the SSE stream (an event-stream parser is exactly the dependency D-C5 refuses). `completed` exits
**0**; `error`, `capped`, `stopped` and an exhausted wait budget all exit **2**; nothing here can emit
`1`, which stays reserved to `mcpfp assert`. The wait covers the post-run **rating** as well as the
terminal status, so a summary is never published while member grades are still landing.

**Suite/grade assertions + the PR-comment artifact.** Two new rules — `min-suite-score` and
`max-suite-cost` — over a suite run named by `{suite}` or `{suiteRun}`. A gate document stays
**single-family**: one target, one family of rules, with the validation error naming *every* offending
rule index, so "the footprint moved" and "the scores dropped" stay two answers in a build log. A
**named** baseline is now always resolved and echoed even when no rule needs one (D-C14), so the
artifact always has a delta to state. `renderAssertionMarkdown` is one pure function in
`packages/shared` — not a second endpoint, not a CLI copy — and `mcpfp assert --format markdown`
renders it; **the format never changes the exit code**. A suite gate **refuses a run that is not
`completed` and settled**, an absent `ratingState` failing closed: a half-graded matrix read as a mean
score would report a quality regression that is really grading latency.

**Security posture, and a gate on it.** `packages/shared/src/security-posture.ts` declares a frozen
**eleven-rule** server registry (4 `error` · 4 `warning` · 3 `info`), the finding/report/score shapes,
and five pure functions — one score, one total order, one evidence redactor, one cap, and a finding
factory that reads severity from the registry so a rule can never choose its own (D-SP5). The
analyzer (`apps/api/src/security/`) serves `GET /api/scans/:scanId/security`: eleven deterministic
rules over an already-persisted scan, **computed on read and persisted nowhere** (no migration, no
table, no column), byte-stable for the same input, refusing a non-`success` scan with a 400 rather
than scoring a partial tool list. Evidence is redacted **by construction** — invisible characters
escaped so they are visible (a poisoning rule's whole job is to surface what you cannot see),
credential-shaped runs masked *after* escaping so an injected zero-width space cannot split a token
past the matcher, then truncated. The one credential read is `OAuthRepository.listGrantedScopes` —
scope **names** only, never token material (**D-SP9, owner-reviewable**). Three of the plan's own
near-miss fixtures forced the *matchers* to be tightened rather than the tests weakened: "will ignore
previous drafts" is silent, `list_deleted_items` with `readOnlyHint: true` is silent, and
`token_count` / `access_key_id` are silent while `secret_access_key` still fires.

`no-new-security-findings` closes the loop: **"new" is set membership by `(ruleId, anchor)`, never a
count** (D-C20). A count comparison would pass a release that resolved one finding and introduced a
worse one, so the guardrail fixture has total, per-severity **and** per-rule counts identical on both
sides. Evidence text is deliberately outside the identity — a reworded description that still trips
the same rule on the same tool is the *same* finding, and a gate that fired on rewording gets switched
off within a week. The default floor is `warning` (D-C21): hygiene does not break builds. A truncated
report on either side is a **400**, never a fallback to counts.

**CI packaging.** [`examples/github-actions/`](./examples/github-actions/) ships two copyable
workflows — an ephemeral workbench on the runner and a persistent shared one — plus the two gate files
they reference and [`planning/user-guide/DC-19-ci-github-actions/23-ci-github-actions.md`](./planning/user-guide/DC-19-ci-github-actions/23-ci-github-actions.md). They
ship as **examples, not live workflows**: this repo has no workbench to run them against, and a
permanently skipped gate in the repo that publishes gates is worse than no gate (D-C17). A text test
holds them honest instead — pinned action majors from an allow-list, the CLI called only as
`node apps/cli/dist/index.js` (D-C19 — `pnpm --silent` collapses exit 2 onto 1), measure and assert as
separate steps, nothing credential-shaped, and **every shipped gate file still parsing against
`assertionDocumentSchema`**. The ephemeral topology is documented with what it *cannot* gate: a fresh
database has no history, so every baseline rule skips on every run.

**Docs.** README gained a **"Drive it without a browser"** section (the three surfaces, the permission
model, the exit-code contract); its section 10 and `CLAUDE.md`'s capability rows were corrected — both
still described a read-only mount at 21 tools · 2,224 tokens. Two stale claims that a root
`.github/workflows/ci.yml` runs the quality gate were removed from README (there is no `ci.yml`; the
repo's only workflow is `mcp-self-scan.yml`), and `mcpfp assert`'s scope documentation was corrected
in three places — since WP M.2 it needs only `read`.

**No migration, no new runtime dependency, no new environment variable, and no change to the scope
vocabulary** anywhere in this wave. `pnpm-lock.yaml` is byte-identical.

Gate green on merged `main`: typecheck · build · **shared 152 · cli 87 · api 3,467 · web 3,574**
tests · `pnpm mcp:self-scan` within budget. `pnpm test` and `pnpm lint` exit non-zero on **only** the
pre-existing failures that predate this wave — 7 stale-model-roster tests
(`compatibility-runner` / `compatibility-tool-findings` / `compatibility-session`) and 2 research JSON
files over Biome's 1 MiB size cap.

**Owner-acceptance pending**, tracked in both ledgers. The three that matter: the example workflows
have **never been executed by GitHub Actions**; the security heuristics were reviewed against fixtures
and **never against a corpus of real third-party MCP servers**, so their false-positive rate is
unmeasured; and **D-SP9** — the one decryption-path touch in the workstream — wants explicit sign-off.

## Unreleased — design system migrated to `@elabs-ai/components-*` v4.0.0

The UI design system moved off the private, vendored `@brand/*` tarballs (v1.9.0) onto the **public
npm `@elabs-ai/components-*` packages at `^4.0.0`**. Install is now anonymous — no `.npmrc` scope
line, no `_authToken`, no CI token, no `vendor/brand/` tarballs, no `file:` dependencies.

**Renames.** 1,233 import specifiers / `@source` paths across 458 source files; every theme slug
(the vendor bright/dark pair → `light`/`dark`) in code, tests, e2e and screenshot scripts; and the
same sweep across 191 markdown files. `THEME_META` → `BUILT_IN_THEME_META` (the only import in the
app with no 1:1 new name — all 358 other named imports resolved unchanged). Theme labels are now
"Light"/"Dark", so the command-palette entry reads "Switch to Light theme".

**Theme CSS is opt-in.** `@elabs-ai/components-tokens/styles.css` is the engine only and carries no
`[data-theme]` blocks; `app.css` now imports `themes/light.css` and `themes/dark.css` explicitly.
Both token-contrast gates were repointed at the per-theme stylesheets and taught to follow `var()`
aliases.

**Accessibility — deliberate app-side override.** v4 sets `--ring: var(--primary)` (the brand lime),
which on the light theme measures 1.30–1.42:1 and fails WCAG 2.4.7 / 1.4.11 — keyboard focus is
effectively invisible. The app overrides `--ring` (`oklch(0.52 0.16 250)`, worst case 3.81:1) and
`--sidebar-ring` (`oklch(0.72 0.16 250)`, worst case 4.02:1) in a `[data-theme="light"]` block, with
a new 3:1 non-text regression gate over every surface a ring can be drawn on. `dark` keeps the
upstream ring (12.46:1). Conversely, v4 fixed the four AA failures and two role collapses the app
used to patch locally, so those overrides were deleted.

**Peers the app now owns:** `monaco-editor` `^0.55.1` and `ai` `^6.0.0` became peers in v4 and are
direct deps of `apps/web`; `@xyflow/react` and `tailwindcss` already were.

**Other v4 behaviour changes**, each decided and recorded at its call site: BentoGrid's cursor glow
is opt-in (not re-enabled — the skill overview is a dense operator surface); the decoration dial
narrowed to backgrounds and chart fills (a no-op for the app's one consumer); `CardDescription`
ships a `measure` prop, so the local `ProseCardDescription` wrapper now composes it instead of
hand-rolling a `max-w-[68ch]` class; `TabsList` gained `overflow-x-auto`, so a RunsView assertion was
scoped to the app's own chrome. The `blueprint` package and theme are gone (never a dependency here).

**Docs.** `vendor/brand-ui-agent-kit/` (pinned to v1.9.0, and therefore actively misleading) was
deleted in favour of the CLI + MCP server as ground truth, plus a generated snapshot at
`docs/brand-ui-context.md`. `docs/BRAND-UI-PORTABLE-SETUP-PROMPT.md` was rewritten for the public-npm
model; `docs/BRAND-UI-UPSTREAM-ISSUES.md` carries a superseded banner listing which gaps v4 closed.

Gate green: typecheck · 3,105 API + 3,094 web tests · build · Biome lint.

## Unreleased (0.3.0) — RC & feature convergence wave

Significant feature completion across multiple workstreams: the UX overhaul consolidated into main
(all 34 WPs, Phases 0–5; Compare Workspace rebuild per audit), Skill IDE all 20 WPs Phases 1–9
live-validated + 851 API tests, Testing-IA consolidation migration v16 + 697 API tests, the vendor-assistant backend
Phases 0–5 (migrations v23/v24) + Phase 5 answer rendering rework, Assistant Phases 0–3 + hardening
(gate 1143 API + 566 web tests), Auto-Rating Phases 1–4 complete (13 WPs, migrations v22/v26, 1624 API
tests + live bug-fix + rating-issues registry post-work), Assistant Hub all 5 waves (missions, roles/
crews, declarative GenUI, artifacts, memory/projects, usage/audit; migrations v47/v48; on
`feat/assistant-hub`, not yet merged). RC-hardening pass: path-traversal/git-sync/
shutdown/leak fixes, SSRF hardening, bundle splitting, dead-code removal, docs truth-up (Skill IDE +
Auto-Rating rows flipped Built; web tests statement corrected; router/persistence/CodeBlock references
updated; 6 missing API endpoint families added). Per-WP in-flight state authoritative in STATUS ledgers
— see [`CLAUDE.md` capability table](./CLAUDE.md).

### Assistant Hub — full-page, multi-model, multi-agent Assistant (Waves 0–4)

A new full-page **Assistant** (nav item below Dashboard, route `/assistant`) — a general-purpose,
multi-model, multi-agent workspace distinct from the existing right-side dock (relabeled **"App
assistant"**, copy-only). Built on the existing multi-provider inference, MCP-bridge, skills, and
token-metering infrastructure, adopting the Unified-Sessions contract verbatim (`phase`,
`stopReasonCode`, capability manifests, `SessionClock`, cursor-resumable SSE). Plan + locked
decisions D-AH1–D-AH20 at [`planning/Roadmap/RM-03-assistant-hub/`](./planning/Roadmap/RM-03-assistant-hub/).

- **Three session modes** — `chat` (multi-model conversation over registered MCP tools + skills),
  `research` (citations-first, search-grounded), and `mission` (the harness below); model
  switchable per session and per message across all five AI-SDK kinds plus `claude_subscription`.
- **Missions — propose → approve → run → synthesize** — a planner produces a structured team plan
  (roles, models, tool grants, budgets, rationale, cost estimate) rendered as an editable plan
  card; approval spawns isolated child sessions (never the parent transcript) that run under one of
  four topologies (`parallel`/`pipeline`/`debate`/`best_of_n`, the last resolved by a **blind**
  judge), with a live per-agent board (status, stream, cost ticker, stop/steer) and a synthesized
  final answer that cites every agent's contribution; a tripped budget stops cleanly and
  synthesizes honestly marked PARTIAL. An autonomy dial (`always_ask`/`threshold`/`auto`) gates
  approval; hard agent-count/cost caps are enforced server-side regardless of the dial.
- **First-class citations** — any MCP tool result carrying sources becomes numbered inline
  citations with a per-message + per-session Sources panel; citations survive synthesis with every
  `[n]` resolving to a real source.
- **Role library + saved crews** (`/assistant/agents`) — reusable agent definitions (system prompt,
  model, per-server/per-tool MCP grants, skills, target, budgets) the planner draws from; crews
  instantiate a saved team deterministically, skipping the planning call.
- **Declarative generative UI** — the model composes forms/tables/charts/stat-tiles from a curated,
  zod-defined `@brand`-part catalog (never raw HTML/JS) via a silent `present` tool, with a bounded
  machine-hinted repair loop on validation failure and two-tier interactivity (client-side state
  ops never re-enter the model; deliberate actions carry dual-audience payloads).
- **Artifacts** — versioned markdown/code/html/table/json deliverables in a side canvas, a
  hunk-by-hunk critic review workflow (`AI/ChangeReview`), version diff + revert, and export as
  md/html/json plus a self-contained `share.html` (styles inlined, no app/network dependency).
- **Memory + projects** — an explicit, editable profile/preferences/instructions store (the
  assistant proposes, never writes silently); projects group sessions and pin shared instructions
  + files.
- **Governance** — a Usage view (spend by model/provider/mode/day, mission breakdowns) with a
  per-session context inspector (a real token-counted breakdown by prompt layer, eager-vs-deferred
  tool defs, skill L1/L2/L3, memory, project, history — the app measuring its own assistant), and a
  filterable Audit timeline deep-linking into session replay.
- **MCP/skill handling depth** — deferred tool loading + a tool-search built-in (measured token
  savings shown), annotation-informed approval defaults, MCP elicitation through the existing
  schema→form generator, progress/cancellation on tool calls, output caps with workspace spill, a
  bundled **research-server recipe** (curated Tavily/Brave/Exa presets in the "Add MCP server"
  wizard — no bundled key, no built-in search engine), and skill L1/L2/L3 budget-aware loading.
- New `hub_*` tables (migrations v47–v48) + `apps/api/src/hub/**` (turn engine, missions, tools,
  prompting, genui) + `apps/web/src/features/hub/**`; documented in
  [`planning/user-guide/DC-13-assistant-hub/16-assistant-hub.md`](./planning/user-guide/DC-13-assistant-hub/16-assistant-hub.md). Built on
  `feat/assistant-hub` (all 5 waves); an e2e smoke test drives the full propose→approve→run→
  synthesize flow against a deterministic stubbed model (`e2e/fixtures/hub-stub-llm-server.ts`) —
  no real provider key needed. **Not yet merged to `main`** (owner merges); live-provider/
  subscription/real-research-server walks are owner-acceptance (see the ledger's Owner-acceptance
  section and [`planning/Roadmap/RM-03-assistant-hub/owner-acceptance-walk.md`](./planning/Roadmap/RM-03-assistant-hub/owner-acceptance-walk.md)).

#### Assistant Hub UX rebuild (Waves 0–4, 24 WPs)

A complete visual and interaction redesign onto the app's shell grammar (PageShell, ViewToolbar,
one status vocabulary). The workspace layout was restructured: the session rail is retired and
replaced with a collapsible 360-px right meta rail (Progress/Outputs/Context sections), a session
switcher in the toolbar, and the first-prompt choreography (composer animates from centered to
docked). The **Sessions** page (`/assistant/sessions`) is now a sortable/filterable DataTable
showing status, mode, project, model, tokens, cost, and errors. The **Agents & Crews** area
(formerly "Roles, crews") was redesigned as a workforce section with three tabs: **Directory** (a
card grid of agents and crews with quick-create), **Org chart** (a graph on `@brand/flow` showing
execution topologies), and **Usage** (spend drill-down by agent/crew/model/mode/project). Agent
and crew **profile modals** are now `WideDialog` tier-3 modals with full sections including an
**Access** section showing per-server + per-tool grants with scan-measured token costs. Memory was
refactored into four scopes (profile/project/agent/crew) with clear effective-stack ordering shown
in the workspace Context section. Navigation was consolidated 6→4 (Assistant + Sessions child,
Agents & Crews, Projects, Audit) with transparent legacy redirects (`/assistant/memory` →
`?memory=profile`, `/assistant/usage` → `?tab=usage`). Plan + 24 WPs across Waves 0–4 at
[`planning/Roadmap/completed/RM-04-assistant-hub-ux/`](./planning/Roadmap/completed/RM-04-assistant-hub-ux/) (ledger:
[`STATUS.md`](./planning/Roadmap/completed/RM-04-assistant-hub-ux/STATUS.md), [`execution-plan.md`](./planning/Roadmap/completed/RM-04-assistant-hub-ux/execution-plan.md));
all decisions D-HUX1–16 + pre-flight P1–P4 locked; Wave 0 was contracts + unblockers (WP0.1 wire,
WP0.2 shell registry, WP0.3 silent-create-role fix, WP0.4 hub-ux constants); Waves 1–3 delivered
workspace + meta rail + sessions + workforce + memory + usage + nav consolidation + retirement
sweep (MemoryView/UsageView/SessionRail/WorkspaceFilesPanel deleted, zero live imports); WP4.1
e2e, WP4.2 visual/a11y + owner-acceptance walk, WP4.3 docs + stale-comment cleanup, WP4.4
integration train. Owner-acceptance pending: live provider keys, real mission, real search server,
both-theme + keyboard walk (see ledger's Owner-acceptance section and
[`owner-acceptance-walk.md`](./planning/Roadmap/completed/RM-04-assistant-hub-ux/owner-acceptance-walk.md)).

### Unified Sessions — one run/session lifecycle across every backend (Phases 0–5)

Consolidated the run backends (the AI-SDK engine, Claude subscription, and the since-removed vendor assistant) onto **one
session lifecycle**, so a run reads, streams, and renders the same way regardless of provider. Plan +
locked decisions D-US1–D-US26 at [`planning/Roadmap/completed/RM-29-unified-sessions/`](./planning/Roadmap/completed/RM-29-unified-sessions/).

- **One terminal vocabulary** — a shared `terminalFor()` table maps each end cause to the canonical
  `(status, outcome, stopReasonCode)` triple, plus a `phase` axis (`queued`/`waiting_input`/…) and an
  explicit `ended` state; `deriveRunStatusView` renders the SAME locked chip label + tone for a given
  state across all three kinds (D-US5 — the backend kind never changes the label). A reusable seed
  harness + a conformance test prove the full 3 kinds × 14 states = 42-row table end-to-end
  (persistence → `GET /api/runs/:id` → derivation) with no provider key (`pnpm --filter …/api
  seed:sessions`).
- **Stall-based `SessionClock`** — pause-while-waiting, an active/total duration split, a stall
  detector, and warn → extend → stop; **no wall-clock cap by default** (per-environment override
  only), so a long but healthy run is never killed on the clock.
- **Static-per-kind capability manifest + a capability-driven console** — a run persists a
  `capabilities_json` manifest at start and the console's KPI tiles + affordances are gated
  declaratively off it (e.g. context-window surfaces hidden for question-metered `vendor_assistant`).
- **Cursor-resumable SSE** — the run stream carries a cursor + periodic ping; a client watchdog
  reconnects and resumes from the last cursor after a drop, and an expected post-terminal socket close
  is never surfaced as an error.
- **End session** — an explicit affordance to end a live run/session, alongside live phase chips, a
  "needs attention" section, seen-markers, and durations in the Runs feed.
- **OpenAI-compatible facade (`/openai/v1`)** — an external interop endpoint (`GET /openai/v1/models`
  + `POST /openai/v1/chat/completions`) that makes a configured `vendor_assistant` assistant selectable
  from any OpenAI-compatible client (Open WebUI, LiteLLM, another harness). Hold-back streaming by
  default (reasoning live, the answer held until settled) with an opt-in `OPENAI_FACADE_LIVE_STREAM`
  flag, a locally-minted `0600` bearer key (`DATA_DIR/openai-facade.key`; `OPENAI_FACADE_KEY`
  overrides), a per-facade concurrency cap → `429` + `Retry-After` (`OPENAI_FACADE_MAX_CONCURRENCY`),
  and vendor `vendor_assistant`/`citations` fields; the internal the vendor executor is untouched, so the answer
  is byte-identical. Mounted in `apps/api/src/index.ts` with real provider-layer deps; documented in
  `user-guide/15-openai-endpoint.md` (since removed with the rest of that vendor's documentation). Every tenant call is
  stubbed in tests — no real the vendor tenant is ever contacted.

## 0.2.0 — 2026-07-02 — Docs & process remediation wave

Documentation-and-process pass reconciling the docs to what the code actually is now (issues #21,
#22). No product behavior changed in this wave; it corrects stale claims and tidies the agent setup.

### Docs reconciled to shipped state (#21)

- **CLAUDE.md capability table (§1):** flipped stale rows — Testing Web UI (Phase 3, built),
  Skills → attach-to-scenario (Phase 2, built), Resource/prompt footprint (built:
  `mcp_resource_scans` / `mcp_prompt_scans`, `resources/list` + `prompts/list`). Added rows for URL
  routing (react-router), real tokenizer + serialized-payload counting (`counting_version`),
  versioned migrations + scan/run delete + retention, CI + Biome lint, the System theme option, and
  MCP × model compatibility. Corrected the profile count (3 → 4) and the "no lint" claims.
- **CLAUDE.md tech stack (§3), commands (§4), architecture (§5):** `react-router-dom` replaces the
  "no router / local `activeView` state" claim; Biome (`pnpm lint` / `pnpm format`) + root CI replace
  the "no ESLint / no lint script" claim.
- **CLAUDE.md API surface (§6) & data model (§7):** reduced to a source-of-truth pointer
  (`**/routes.ts`, `db/schema.ts`) plus the current endpoint families and full table list; the
  token-counting section now describes real `js-tiktoken` BPE, the `generic_estimate` heuristic,
  serialized-payload counting, and `counting_version`; noted `PRAGMA user_version` migrations and
  `SCAN_RETENTION_PER_SERVER`.
- **README.md:** rewritten to the current product (cross-server compare, playground, Testing console,
  Skills, compatibility) as a short overview that defers to CLAUDE.md and the STATUS ledgers;
  refreshed Acceptance Criteria.
- **roadmap:** `00-product-brief.md` non-goals trimmed to auth/cloud (removed conversation replay,
  LLM proxy mode, provider token adapters — now delivered/in-scope); `ROADMAP.md`,
  `planning/user-guide/DC-21-architecture/01-architecture.md`, `planning/Roadmap/completed/RM-31-mvp-footprint-analyzer/02-implementation-plan.md` marked historical with a
  "current state" pointer to CLAUDE.md + the STATUS ledgers.
- **Single source of truth:** stated in CLAUDE.md that `planning/Roadmap/*/STATUS.md` ledgers are
  authoritative for in-flight status; other docs link rather than restate.

### Process hygiene (#22)

- **Themes:** replaced the stale "six themes" with "two themes (the vendor bright/dark pair)" across
  the Testing WP specs (`planning/Roadmap/RM-26-testing/phase-*/WP-*.md`) and both `/next-wp` definitions. Did not
  re-add blueprint/light/dark/high-contrast.
- **`/next-wp` dedup:** the `next-wp` skill (`.claude/skills/next-wp/SKILL.md`) is now the single
  canonical definition; the command (`.claude/commands/next-wp.md`) is reduced to a thin pointer so
  the two can't drift.
- **Tombstones deleted:** `.claude/rules/issue-workflow.md`, `.claude/rules/component-api.md`,
  `.claude/commands/file-issue.md`, `.claude/rules/quality-gates.md.probe`, and
  `.claude/commands/brand-ui-update.md` (each self-described as safe to delete). Updated the
  CLAUDE.md §10 `.claude/` map to be accurate (adds `next-wp`, drops deleted files).
- **Owner-acceptance tracking:** added an "Owner acceptance" section to `planning/Roadmap/RM-26-testing/STATUS.md`
  and `planning/Roadmap/RM-24-skills/STATUS.md` (one tickable line per deferred owner visual/a11y/e2e item) plus
  the rule that a new phase shouldn't open with prior owner-acceptance items unresolved.
- **Versioning:** bumped root `package.json` to `0.2.0` and added this changelog. Per-phase git tags
  remain an owner action.
- **Lint statements:** corrected "no lint script" to reflect Biome + CI in the quality-gates rule,
  both plan `conventions.md` files, and the `next-wp` skill.

## 0.1.0

Initial startup-footprint MVP and the expanded target build-out (scans, token counting, cross-server
compare, tool playground, Testing console, Skills registry, MCP × model compatibility). See the
`planning/Roadmap/` history and the `planning/Roadmap/*/STATUS.md` ledgers.
