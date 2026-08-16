// PostToolUse(Edit|Write|MultiEdit): nudge when a NEW prose container lands with no measure cap (D-IC9).
// -----------------------------------------------------------------------------------------------
// Genuine flowing prose must be capped to a readable measure (~65–75ch, `max-w-[68ch]`/`max-w-prose`).
// The review measured a 190-character line (the Compatibility callout at 1600px) because no rule said
// "prose gets a measure cap". WP 1.4 capped the four prose containers; this hook stops a NEW one from
// shipping uncapped. See `roadmap/interface-craft` finding 9 / locked decision D-IC9. Static companion
// to `apps/web/src/guardrails/prose-measure.guardrail.test.ts` (which pins the four capped containers).
//
// WHAT IT FLAGS  — an edit that introduces a PROSE-RENDER element (`<ChatMarkdown` or `<MessageResponse`,
//   the app's two flowing-markdown renderers) while the edited chunk carries NO `max-w-*` cap anywhere.
// WHY THIS SCOPING DOESN'T FALSE-POSITIVE ON TABLES / DENSE ROWS (the D-IC9 requirement): a table is a
//   `<DataTable>` / `<Table*>` / `<table>` — NONE of which is a prose-render marker, so a full-width
//   table edit is never flagged. The cap is for reading columns of prose, never for tabular data.
// WHAT IT LEAVES ALONE (must never false-positive):
//   • Any edit with a `max-w-` token in the chunk (the wrapper cap is present) — the correct shape.
//   • Edits that add tables, grids, KPI strips, or anything that isn't ChatMarkdown/MessageResponse.
//   • Non-`apps/web/src` files, non-`.tsx` files, and test/spec fixtures.
// Escape hatch: `prose-measure-allow` anywhere in the edited text — for a DELIBERATELY full-bleed
//   surface (e.g. a full-width chat transcript where a 68ch column would be wrong). exit 2 is a
//   non-destructive nudge. See `.claude/rules/interaction-guidelines.md` (micro-typography / measure).
import fs from "node:fs";

let raw = "";
try {
  raw = fs.readFileSync(0, "utf8");
} catch {
  process.exit(0);
}

let data;
try {
  data = JSON.parse(raw);
} catch {
  process.exit(0);
}

const ti = (data && data.tool_input) || {};
const fp = ti.file_path || "";

if (!/\/apps\/web\/src\//.test(fp)) process.exit(0); // web app source only
if (!/\.tsx$/.test(fp)) process.exit(0); // JSX prose containers live in .tsx
if (/\.(test|spec)\.tsx$/.test(fp)) process.exit(0); // test/spec fixtures (JSX-in-strings)

let text = "";
if (typeof ti.content === "string") text += ti.content;
if (typeof ti.new_string === "string") text += "\n" + ti.new_string;
if (Array.isArray(ti.edits)) {
  for (const e of ti.edits) {
    if (e && typeof e.new_string === "string") text += "\n" + e.new_string;
  }
}
if (!text) process.exit(0);

if (/prose-measure-allow/.test(text)) process.exit(0); // deliberate full-bleed opt-out

// The two flowing-markdown prose renderers this app uses. A table/grid/KPI-strip is none of these.
const PROSE_MARKER = /<(ChatMarkdown|MessageResponse)\b/;
const HAS_MEASURE = /\bmax-w-/;

if (PROSE_MARKER.test(text) && !HAS_MEASURE.test(text)) {
  const sample = (text.match(/.*<(?:ChatMarkdown|MessageResponse)\b.*/)?.[0] ?? "").trim().slice(0, 100);
  process.stderr.write(
    "prose measure (D-IC9): a prose container (<ChatMarkdown>/<MessageResponse>) landed with no `max-w-*` cap.\n",
  );
  process.stderr.write(
    "    Wrap it in a `max-w-[68ch]` (or `max-w-prose`) reading column. Tables/dense rows stay full-width.\n",
  );
  process.stderr.write(
    "    If this surface is intentionally full-bleed (e.g. a chat transcript), add `prose-measure-allow` in a comment.\n",
  );
  if (sample) process.stderr.write("    " + sample + "\n");
  process.exit(2);
}
process.exit(0);
