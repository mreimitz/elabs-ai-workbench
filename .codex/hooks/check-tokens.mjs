// PostToolUse(Edit|Write|MultiEdit): warn when a raw color literal is added to app source.
// Non-destructive nudge — the edit already happened; exit 2 surfaces the message to the agent
// so it can switch to semantic tokens. See .claude/rules/styling-and-tokens.md.
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

if (!/\/src\//.test(fp)) process.exit(0); // app source only
if (!/\.(tsx|ts)$/.test(fp)) process.exit(0);

let text = "";
if (typeof ti.content === "string") text += ti.content;
if (typeof ti.new_string === "string") text += "\n" + ti.new_string;
if (Array.isArray(ti.edits)) {
  for (const e of ti.edits) {
    if (e && typeof e.new_string === "string") text += "\n" + e.new_string;
  }
}
if (!text) process.exit(0);

const hex = /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?(?:[0-9a-fA-F]{2})?\b/;
const fn = /\b(?:rgb|rgba|hsl|hsla)\(/;
const offenders = [];
for (const line of text.split("\n")) {
  const t = line.trim();
  if (t === "" || t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) continue;
  if (hex.test(line) || fn.test(line)) offenders.push(t.slice(0, 120));
}

if (offenders.length > 0) {
  process.stderr.write(
    "token guard: raw color literal(s) in " +
      fp +
      "\nUse semantic tokens (bg-*, text-*, border-*, ring-*), never hex/rgb/hsl. See .claude/rules/styling-and-tokens.md\n",
  );
  for (const o of offenders.slice(0, 5)) process.stderr.write("    " + o + "\n");
  process.exit(2);
}
process.exit(0);
