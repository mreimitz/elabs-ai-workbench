// PostToolUse(Edit|Write|MultiEdit): enforce "brand-ui components only" in the web app.
// Flags raw interactive/component HTML and imports from the retired local adapter so the agent
// switches to @elabs-ai/components-* components. exit 2 surfaces the message (non-destructive nudge).
// Escape hatch: put `brand-ui-allow` in a comment on the same line. See .claude/rules/brand-ui-only.md
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

let text = "";
if (typeof ti.content === "string") text += ti.content;
if (typeof ti.new_string === "string") text += "\n" + ti.new_string;
if (Array.isArray(ti.edits)) {
  for (const e of ti.edits) {
    if (e && typeof e.new_string === "string") text += "\n" + e.new_string;
  }
}
if (!text) process.exit(0);

const rules = [
  {
    re: /<button(\s|>|\/)/,
    msg: "raw <button> -> use <Button> from @elabs-ai/components-ui (Button asChild for links)",
  },
  {
    re: /<input(\s|>|\/)/,
    msg: "raw <input> -> use <Input>/<NumberInput>/<Checkbox>/<Switch> from @elabs-ai/components-ui",
  },
  {
    re: /<select(\s|>|\/)/,
    msg: "raw <select> -> use <Select> (Select/SelectTrigger/SelectContent/SelectItem) from @elabs-ai/components-ui",
  },
  { re: /<textarea(\s|>|\/)/, msg: "raw <textarea> -> use <Textarea> from @elabs-ai/components-ui" },
  {
    re: /<table(\s|>|\/)/,
    msg: "raw <table> -> use <DataTable> (@elabs-ai/components-data) or Table* (@elabs-ai/components-ui)",
  },
  {
    re: /<(thead|tbody|tfoot|tr|th|td)(\s|>|\/)/,
    msg: "raw table element -> use DataTable (@elabs-ai/components-data) or Table* (@elabs-ai/components-ui)",
  },
  {
    re: /<dialog(\s|>|\/)/,
    msg: "raw <dialog> -> use <Dialog>/<Sheet>/<AlertDialog> from @elabs-ai/components-ui",
  },
  {
    re: /from\s+["']@mcp-token-footprint\/brand-ui["']/,
    msg: "import from the RETIRED local adapter -> import from @elabs-ai/components-ui, @elabs-ai/components-data, @elabs-ai/components-icons, @elabs-ai/components-tokens",
  },
];

const offenders = [];
for (const line of text.split("\n")) {
  const t = line.trim();
  if (t === "" || t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) continue;
  if (/brand-ui-allow/.test(line)) continue; // owner-gated escape hatch
  for (const r of rules) {
    if (r.re.test(line)) offenders.push(r.msg + "   ->   " + t.slice(0, 100));
  }
}

if (offenders.length > 0) {
  process.stderr.write(
    "brand-ui-only: this app MUST use @elabs-ai/components-* components (see .claude/rules/brand-ui-only.md).\n",
  );
  for (const o of [...new Set(offenders)].slice(0, 8)) process.stderr.write("    " + o + "\n");
  process.exit(2);
}
process.exit(0);
