// PreToolUse(Bash): block staging/committing likely secret files. Defense-in-depth on top
// of .gitignore (.env*, *.pem, *.key). Allows the .env.example template. exit 2 = block.
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

const cmd = (data && data.tool_input && data.tool_input.command) || "";
if (!cmd) process.exit(0);

const stages = /\bgit\s+(add|commit|stage)\b/.test(cmd);
if (!stages) process.exit(0);

const scrubbed = cmd.replace(/\.env\.example/gi, ""); // the template is safe to commit
const secret = /(^|[\s'"/=])\.env(\.[\w.-]+)?(?![\w.-])|\.(pem|key|p12|pfx|keystore)\b|\bid_rsa\b/i;

if (secret.test(scrubbed)) {
  process.stderr.write(
    "Refusing to stage/commit a likely secret file. Keep secrets in .env.local (git-ignored); " +
      "commit only .env.example. See .claude/rules/mcp-and-security.md\n",
  );
  process.exit(2);
}
process.exit(0);
