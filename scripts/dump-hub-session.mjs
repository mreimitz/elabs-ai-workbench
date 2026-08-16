#!/usr/bin/env node
// Read-only debugging helper — print an Assistant Hub session's FULL transcript (every input and
// output, in sequence) from a running instance, so a session can be inspected/debugged without opening
// the UI. It calls the same export endpoint the Context rail's "Export session" dropdown uses
// (`GET /api/hub/sessions/:id/report/{markdown,json}`), so it needs no database access and no extra deps
// (global `fetch`, Node 18+).
//
// Usage:
//   node scripts/dump-hub-session.mjs <sessionId> [--json] [--base http://127.0.0.1:8080] [--out FILE]
//
// Examples:
//   node scripts/dump-hub-session.mjs gFmKhLygMwMXNA5ciiXmn
//   node scripts/dump-hub-session.mjs gFmKhLygMwMXNA5ciiXmn --json --out /tmp/session.json
//
// For DEEP debugging straight against the SQLite log (the append-only source of truth), copy the DB out
// of the running Docker container and query `hub_events` directly:
//   docker cp mcp-token-footprint-mcp-token-footprint-1:/data/app.sqlite /tmp/x.sqlite
//   sqlite3 /tmp/x.sqlite "SELECT seq,type,payload_json FROM hub_events WHERE session_id='<id>' ORDER BY seq;"
//   (copy app.sqlite-wal / -shm too — the live DB runs in WAL mode.)

import { writeFile } from "node:fs/promises";

const args = process.argv.slice(2);
const sessionId = args.find((a) => !a.startsWith("--"));
const json = args.includes("--json");
const readFlag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
};
const base = (readFlag("--base") ?? "http://127.0.0.1:8080").replace(/\/$/, "");
const out = readFlag("--out");

if (!sessionId) {
  console.error(
    "Usage: node scripts/dump-hub-session.mjs <sessionId> [--json] [--base http://127.0.0.1:8080] [--out FILE]",
  );
  process.exit(1);
}

const format = json ? "json" : "markdown";
const url = `${base}/api/hub/sessions/${sessionId}/report/${format}`;

try {
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`Request failed: ${res.status} ${res.statusText} (${url})`);
    const body = await res.text().catch(() => "");
    if (body) console.error(body.slice(0, 500));
    process.exit(1);
  }
  const text = await res.text();
  if (out) {
    await writeFile(out, text, "utf8");
    console.error(`Wrote ${text.length} bytes to ${out}`);
  } else {
    process.stdout.write(text);
  }
} catch (error) {
  console.error(`Could not reach ${url}: ${error instanceof Error ? error.message : String(error)}`);
  console.error("Is the app running? (docker compose up, or pnpm dev)");
  process.exit(1);
}
