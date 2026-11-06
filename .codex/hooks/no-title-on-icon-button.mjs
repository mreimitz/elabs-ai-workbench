// PostToolUse(Edit|Write|MultiEdit): reject `title=` on a TEXT-LESS <Button>/<IconButton> (D-TB5).
// -----------------------------------------------------------------------------------------------
// An icon-only button's ONLY hover/focus affordance must be the `IconButton` tooltip (whose text
// equals its `aria-label`), NEVER the native `title` attribute — `title` has a ~1.5s OS delay, is
// unstyled, and is INVISIBLE to assistive tech (it is not `aria-describedby`). See
// `.claude/rules/icon-affordances.md` (locked decision D-TB5, 2026-07-25) and the audit's §F
// guardrail block ("an enforce-brand-ui-style hook rejecting `title=` on a <Button> with no text
// child"). This is the third guardrail so the D-7/D-TB5 drift can't recur a THIRD time.
//
// WHAT IT FLAGS  — a `title=` attribute on the OPENING tag of a `<Button>` or `<IconButton>` whose
//   children carry NO visible text (an icon glyph element / self-closing / whitespace-only).
// WHAT IT LEAVES ALONE (must never false-positive):
//   • Component `title` PROPS on non-button components — `<StatePanel title=…>`, `<EmptyState …>`,
//     `<SplitPanePanel title=…>`, etc. (the regex only matches `<Button`/`<IconButton`).
//   • A `<Button>` (or `<IconButton>`) with a VISIBLE TEXT child — the D-10 truncation-recovery
//     carve-out for text-bearing elements. `<Button title="Delete">Delete</Button>` is fine.
//   • A button whose child is a `{expression}` that may render text (`<Button title=…>{label}</…>`)
//     — treated as potentially-text, left alone (conservative: never a false positive).
//   • `@elabs-ai/components-ai` `PromptInputButton` and any other `*Button`-suffixed component — NOT matched
//     (the element name must be exactly `Button` or `IconButton`).
//   • Non-`apps/web/src` files, non-`.ts(x)` files, and test/spec fixtures (JSX-in-strings).
// Escape hatch: `brand-ui-allow` in a comment on the opening-tag's line (same as enforce-brand-ui).
// exit 2 surfaces the message (non-destructive nudge). See `.claude/rules/brand-ui-only.md`.
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
if (/\.(test|spec)\.(tsx?)$/.test(fp)) process.exit(0); // skip test/spec fixtures (JSX-in-strings)

// Gather the edited text (content + any new_strings) — same shape enforce-brand-ui reads.
let text = "";
if (typeof ti.content === "string") text += ti.content;
if (typeof ti.new_string === "string") text += "\n" + ti.new_string;
if (Array.isArray(ti.edits)) {
  for (const e of ti.edits) {
    if (e && typeof e.new_string === "string") text += "\n" + e.new_string;
  }
}
if (!text) process.exit(0);
if (!/\btitle\s*=/.test(text)) process.exit(0); // no title attribute anywhere → nothing to check

/** Walk the opening tag from just after `<Button`/`<IconButton`, tracking string + `{}` state, and
 *  return the index of the `>` that closes it plus whether it self-closes. Attribute values may
 *  contain `>` inside strings or `{…}` expressions, so a naive `indexOf(">")` is wrong. */
function scanOpeningTag(src, from) {
  let inStr = null;
  let brace = 0;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      inStr = c;
      continue;
    }
    if (c === "{") {
      brace++;
      continue;
    }
    if (c === "}") {
      if (brace > 0) brace--;
      continue;
    }
    if (brace === 0 && c === ">") {
      return { gt: i, selfClosing: src[i - 1] === "/" };
    }
  }
  return null;
}

/** Content between the opening tag's `>` and the first same-named close tag (string-aware, so a `>`
 *  inside a child string literal doesn't end it early). Returns null if no close is found in the
 *  edited slice — in which case we stay conservative and do not flag. */
function extractInner(src, start, tagName) {
  let inStr = null;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      inStr = c;
      continue;
    }
    if (c === "<" && src.startsWith("</" + tagName, i)) {
      return src.slice(start, i);
    }
  }
  return null;
}

/** Does the button's inner content carry a VISIBLE TEXT child? Icon-only children (JSX elements,
 *  whitespace-only expressions) → false; bare text or a non-trivial `{expression}` → true. */
function innerHasVisibleText(inner) {
  let s = inner.replace(/\{\/\*[\s\S]*?\*\/\}/g, " "); // drop JSX comments {/* … */}
  // A `{expression}` child may render a text label — treat as text UNLESS it is a whitespace-only
  // string literal like {" "}. This keeps `<Button title=…>{label}</Button>` from ever being flagged.
  const exprs = s.match(/\{[^{}]*\}/g) || [];
  const hasMeaningfulExpr = exprs.some((e) => {
    const body = e.slice(1, -1).trim();
    if (body === "") return false;
    if (/^(["'`])\s*\1$/.test(body)) return false; // {" "} / {''} spacer
    return true;
  });
  if (hasMeaningfulExpr) return true;
  s = s.replace(/<[^>]*>/g, " "); // strip child JSX tags
  s = s.replace(/\{[^{}]*\}/g, " "); // strip remaining (whitespace-only) expressions
  return /[A-Za-z0-9]/.test(s);
}

function detectTitleOnIconButton(src) {
  const offenders = [];
  const openRe = /<(Button|IconButton)\b/g;
  let m;
  while ((m = openRe.exec(src))) {
    const tagName = m[1];
    const tagStart = m.index;
    const opened = scanOpeningTag(src, openRe.lastIndex);
    if (!opened) continue;
    const openTag = src.slice(tagStart, opened.gt + 1);
    // `title` must be an attribute of THIS opening tag (space-delimited, so `data-title=` is excluded
    // — its `title` is preceded by `-`, not whitespace).
    if (!/[\s]title\s*=/.test(openTag)) continue;
    // Escape hatch: `brand-ui-allow` on the opening-tag's line.
    const lineStart = src.lastIndexOf("\n", tagStart) + 1;
    let lineEnd = src.indexOf("\n", tagStart);
    if (lineEnd === -1) lineEnd = src.length;
    if (/brand-ui-allow/.test(src.slice(lineStart, lineEnd))) continue;

    let hasText;
    if (opened.selfClosing) {
      hasText = false; // <Button title=… /> — no children at all
    } else {
      const inner = extractInner(src, opened.gt + 1, tagName);
      if (inner === null) continue; // close not in the edited slice → conservative, skip
      hasText = innerHasVisibleText(inner);
    }
    if (!hasText) {
      offenders.push(
        `<${tagName} title=…> with NO visible text child -> use <IconButton label=…> (tooltip == aria-label); native \`title\` is banned on a text-less button (D-TB5)   ->   ${openTag
          .replace(/\s+/g, " ")
          .slice(0, 100)}`,
      );
    }
  }
  return offenders;
}

const offenders = detectTitleOnIconButton(text);
if (offenders.length > 0) {
  process.stderr.write(
    "icon-affordances (D-TB5): a text-less <Button>/<IconButton> must not use the native `title` attribute.\n",
  );
  process.stderr.write(
    "    Use <IconButton label=\"…\"> — its tooltip text equals the aria-label. See .claude/rules/icon-affordances.md\n",
  );
  for (const o of [...new Set(offenders)].slice(0, 8)) process.stderr.write("    " + o + "\n");
  process.exit(2);
}
process.exit(0);
