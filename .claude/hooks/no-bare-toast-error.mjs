// PostToolUse(Edit|Write|MultiEdit): reject a bare `toast.error(` in the web app (D-IC7).
// -----------------------------------------------------------------------------------------------
// Every error toast MUST go through `notifyError` (apps/web/src/lib/notify.ts), which is the single
// authority for error-toast timing — it forces `duration: Infinity` so an error stays on screen
// until the operator dismisses it (a 4s error is unreadable for many users and unreachable by
// keyboard). A direct `toast.error(...)` call bypasses that guarantee and can (re)introduce a finite
// duration. See `roadmap/interface-craft` finding 5 / locked decision D-IC7. This is the static
// companion to `apps/web/src/guardrails/notify-duration.guardrail.test.ts` (which locks the wrapper's
// behaviour) — the hook stops a NEW call site from skipping the wrapper in the first place.
//
// WHAT IT FLAGS  — a `toast.error(` call in `apps/web/src/**` .ts(x).
// WHAT IT LEAVES ALONE (must never false-positive):
//   • `apps/web/src/lib/notify.ts` itself — the ONE sanctioned `toast.error` call site.
//   • Other toast levels — `toast.success(`, `toast.info(`, `toast.warning(`, `toast(` — not matched
//     (only `.error` carries the D-IC7 timing contract).
//   • `notifyError(` calls — the correct API; `toast` as a bare identifier; `.error` on anything not
//     named `toast` (e.g. `result.error(`) — not matched (the regex requires `toast.error(`).
//   • Non-`apps/web/src` files, non-`.ts(x)` files, test/spec fixtures, and commented-out lines.
// Escape hatch: `brand-ui-allow` in a comment on the same line (same convention as enforce-brand-ui).
// exit 2 surfaces the message (non-destructive nudge). See `.claude/rules/loading-states.md`.
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
if (!/\.(tsx|ts)$/.test(fp)) process.exit(0);
if (/\.(test|spec)\.(tsx?)$/.test(fp)) process.exit(0); // test/spec fixtures may reference toast.error
if (/\/lib\/notify\.ts$/.test(fp)) process.exit(0); // notify.ts is THE sanctioned toast.error site

let text = "";
if (typeof ti.content === "string") text += ti.content;
if (typeof ti.new_string === "string") text += "\n" + ti.new_string;
if (Array.isArray(ti.edits)) {
  for (const e of ti.edits) {
    if (e && typeof e.new_string === "string") text += "\n" + e.new_string;
  }
}
if (!text) process.exit(0);

// `toast.error(` with optional whitespace between the members and before the paren.
const BARE = /\btoast\s*\.\s*error\s*\(/;

const offenders = [];
for (const line of text.split("\n")) {
  const t = line.trim();
  if (t === "" || t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) continue;
  if (/brand-ui-allow/.test(line)) continue; // owner-gated escape hatch
  if (BARE.test(line)) offenders.push(t.slice(0, 100));
}

if (offenders.length > 0) {
  process.stderr.write(
    "notification timing (D-IC7): a bare `toast.error(` bypasses `notifyError` (apps/web/src/lib/notify.ts).\n",
  );
  process.stderr.write(
    "    Use `notifyError(message, options?)` — it forces `duration: Infinity`. See .claude/rules/loading-states.md\n",
  );
  for (const o of [...new Set(offenders)].slice(0, 8)) process.stderr.write("    " + o + "\n");
  process.exit(2);
}
process.exit(0);
