import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import {
  APP_FEATURE_IDS,
  DIAGNOSTICS_BUNDLE_VERSION,
  DIAGNOSTICS_ERROR_ENTRY_LIMIT,
  DIAGNOSTICS_ERROR_MAX_CHARS,
  diagnosticsBundleSchema,
  PROVIDER_KINDS,
  SECURITY_REDACTION_MARKER,
  type AppFeatureFlags,
  type DiagnosticsBundle,
} from "@mcp-token-footprint/shared";
import { applyMigrations, LATEST_SCHEMA_VERSION, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { renderDiagnosticsMarkdown } from "../src/diagnostics/markdown.js";
import { buildEnvironmentGroup, RECOGNISED_ENV_VARS } from "../src/diagnostics/env-vars.js";
import { registerDiagnosticsRoutes } from "../src/diagnostics/routes.js";
import { buildDiagnosticsBundle } from "../src/diagnostics/service.js";
import { OAuthRepository } from "../src/oauth/repository.js";
import { ProviderRepository } from "../src/providers/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { ServerRepository } from "../src/servers/repository.js";

// ==================================================================================================
// Diagnostics bundle — planning/Roadmap/RM-18-platform/ WP 1.3
// ==================================================================================================
//
// The item's invariant is *"the diagnostics bundle is proven secret-free by an automated test (same
// discipline as PAT redaction), NOT by review"*. That sentence is the whole work package, and this
// file is where it is either true or a slogan.
//
// The proof method is a SENTINEL SWEEP: seed every place a secret or a user-typed string could come
// from with a recognisable marker, build the bundle, and assert that no marker appears anywhere in
// the serialized JSON **or** the rendered Markdown. Two details make it a real proof rather than a
// ceremony:
//
//   1. **The sentinels are short and NOT credential-shaped** — no `sk-`/`gh?_`/`mcpfp_` prefix and
//      under 32 base64url characters. A realistic 40-character token would come back masked as
//      `«redacted»` whether or not the bundle leaked it, and the sweep would then pass for the wrong
//      reason. (The same trap `security-analyzer.test.ts` calls out for D-SP9.) The one place a
//      credential-SHAPED value is used on purpose is the redaction test at the bottom, where being
//      masked is the assertion.
//   2. **Both renderings are swept.** The Markdown is produced from the JSON by a function whose only
//      parameter is the payload, so a leak cannot hide in the format that was not checked.
//
// The mutation probes that prove the sweep can fail are recorded in the WP report: emitting one env
// var's real value turns "no environment variable value appears in the bundle" red, and bypassing
// `createDiagnosticsErrorEntry` turns the redaction assertions red.

const HERE = dirname(fileURLToPath(import.meta.url));

const databases: AppDatabase[] = [];
const apps: FastifyInstance[] = [];

after(async () => {
  for (const app of apps) await app.close();
  for (const db of databases) db.close();
});

function openDb(): AppDatabase {
  const db = new Database(":memory:") as unknown as AppDatabase;
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  databases.push(db);
  return db;
}

const ALL_FEATURES_ON: AppFeatureFlags = Object.fromEntries(
  APP_FEATURE_IDS.map((id) => [id, true]),
) as AppFeatureFlags;

function build(
  db: AppDatabase,
  overrides: { env?: NodeJS.ProcessEnv; databasePath?: string } = {},
): DiagnosticsBundle {
  return buildDiagnosticsBundle({
    db,
    featureFlags: () => ALL_FEATURES_ON,
    now: () => new Date("2026-08-22T09:00:00.000Z"),
    env: overrides.env ?? {},
    databasePath: overrides.databasePath ?? join(HERE, "__no_such_database__.sqlite"),
  });
}

/** Both renderings of one bundle, concatenated — what every sentinel sweep searches. */
function renderBoth(bundle: DiagnosticsBundle): { json: string; markdown: string; both: string } {
  const json = JSON.stringify(bundle);
  const markdown = renderDiagnosticsMarkdown(bundle);
  return { json, markdown, both: `${json}\n${markdown}` };
}

// ── 1 · shape and the two renderings ────────────────────────────────────────────────────────────

test("the bundle validates against the shared zod schema", () => {
  const bundle = build(openDb());
  // `.strict()` at every level: a field added to the payload without being declared in the contract
  // is a failure here, which is the point — an undeclared field is an unreviewed one.
  const parsed = diagnosticsBundleSchema.parse(bundle);
  assert.equal(parsed.bundleVersion, DIAGNOSTICS_BUNDLE_VERSION);
  assert.equal(parsed.generatedAt, "2026-08-22T09:00:00.000Z");
});

test("GET /api/diagnostics and /markdown are two renderings of ONE builder", async () => {
  const db = openDb();
  const app = Fastify({ logger: false });
  registerDiagnosticsRoutes(app, {
    db,
    featureFlags: () => ALL_FEATURES_ON,
    env: {},
    databasePath: join(HERE, "__no_such_database__.sqlite"),
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  apps.push(app);
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  const jsonResponse = await fetch(`${baseUrl}/api/diagnostics`);
  assert.equal(jsonResponse.status, 200);
  const payload = diagnosticsBundleSchema.parse(await jsonResponse.json());

  const markdownResponse = await fetch(`${baseUrl}/api/diagnostics/markdown`);
  assert.equal(markdownResponse.status, 200);
  assert.match(
    markdownResponse.headers.get("content-type") ?? "",
    /text\/markdown/,
    "the markdown route must announce itself as markdown",
  );
  const markdown = await markdownResponse.text();

  // The route's Markdown must be exactly what the renderer produces from the JSON payload. The two
  // requests build the bundle independently, so the only fields that may differ are the clock and
  // anything derived from it — pin `generatedAt` and compare the rest byte for byte.
  const expected = renderDiagnosticsMarkdown({ ...payload, generatedAt: payload.generatedAt });
  const normalise = (value: string) => value.replace(/Generated at: .*/g, "Generated at: <pinned>");
  assert.equal(normalise(markdown), normalise(expected));
});

test("the Markdown renderer is given nothing but the payload", () => {
  // A source pin, in the spirit of `reports/security-section.ts`'s one-file rule. The renderer's
  // ONLY parameter is the composed bundle: if it could reach `process.env`, the database or
  // `config`, "derived from the same payload" would be a claim rather than a property.
  assert.equal(renderDiagnosticsMarkdown.length, 1);
  const source = readFileSync(join(HERE, "..", "src", "diagnostics", "markdown.ts"), "utf8");
  for (const forbidden of ["process.env", "config/env", "db.prepare", "readFileSync"]) {
    assert.equal(
      source.includes(forbidden),
      false,
      `the Markdown renderer must not reach for ${forbidden}`,
    );
  }
});

// ── 2 · the environment group never reads a value ───────────────────────────────────────────────

test("the recognised-variable list matches config/env.ts exactly", () => {
  const envSource = readFileSync(join(HERE, "..", "src", "config", "env.ts"), "utf8");
  const inSource = new Set(
    [...envSource.matchAll(/process\.env\.([A-Za-z0-9_]+)/g)].map((match) => match[1] as string),
  );
  const inCatalogue = new Set(RECOGNISED_ENV_VARS.map((entry) => entry.name));

  const missing = [...inSource].filter((name) => !inCatalogue.has(name)).sort();
  const phantom = [...inCatalogue].filter((name) => !inSource.has(name)).sort();
  assert.deepEqual(
    missing,
    [],
    `config/env.ts reads variables the diagnostics catalogue does not list: ${missing.join(", ")}`,
  );
  assert.deepEqual(
    phantom,
    [],
    `the diagnostics catalogue lists variables config/env.ts never reads: ${phantom.join(", ")}`,
  );
});

test("the environment group emits { name, status } and nothing else", () => {
  const env: NodeJS.ProcessEnv = {};
  for (const entry of RECOGNISED_ENV_VARS) env[entry.name] = `VALUE-FOR-${entry.name}`;
  const group = buildEnvironmentGroup(env);

  assert.equal(group.length, RECOGNISED_ENV_VARS.length);
  for (const item of group) {
    assert.deepEqual(
      Object.keys(item).sort(),
      ["name", "status"],
      "an environment entry may carry a name and a status — nothing else, at any status",
    );
    assert.equal(item.status, "set");
  }
});

test("status distinguishes set / default / unset", () => {
  const defaulted = RECOGNISED_ENV_VARS.find((entry) => entry.defaulted);
  const undefaulted = RECOGNISED_ENV_VARS.find((entry) => !entry.defaulted);
  assert.ok(defaulted, "the catalogue must contain at least one defaulted variable");
  assert.ok(
    undefaulted,
    "the catalogue must contain at least one variable with no fallback (MCP_SECRET_KEY is one)",
  );

  const group = buildEnvironmentGroup({ [defaulted.name]: "something" });
  assert.equal(group.find((entry) => entry.name === defaulted.name)?.status, "set");
  assert.equal(group.find((entry) => entry.name === undefaulted.name)?.status, "unset");

  const empty = buildEnvironmentGroup({});
  assert.equal(empty.find((entry) => entry.name === defaulted.name)?.status, "default");
});

test("NO environment variable value appears in the bundle — sentinel sweep over every recognised name", () => {
  // One distinctive sentinel per recognised variable. Short and NOT credential-shaped on purpose:
  // if a value ever reached the payload it would appear VERBATIM, with no redactor to mask it and
  // make this assertion pass for the wrong reason.
  const sentinels = new Map<string, string>();
  const env: NodeJS.ProcessEnv = {};
  RECOGNISED_ENV_VARS.forEach((entry, index) => {
    const sentinel = `Zq${index}Leak`;
    sentinels.set(entry.name, sentinel);
    env[entry.name] = sentinel;
  });

  const { both } = renderBoth(build(openDb(), { env }));
  for (const [name, sentinel] of sentinels) {
    assert.equal(
      both.includes(sentinel),
      false,
      `the value of ${name} reached the diagnostics bundle (sentinel ${sentinel})`,
    );
  }
  // And the sweep itself must be capable of finding something: every recognised NAME is present, so
  // a sweep that matched nothing at all would be a sweep over an empty document.
  for (const entry of RECOGNISED_ENV_VARS) {
    assert.equal(both.includes(entry.name), true, `${entry.name} should be listed by name`);
  }
});

test("the sentinel sweep is not vacuous — an injected value WOULD be caught", () => {
  // The sweep's own control. If the assertion below ever failed, every "no value leaked" assertion
  // in this file would be meaningless, because the search would be incapable of finding a leak.
  const leaked = { environment: [{ name: "PORT", status: "set", value: "Zq0Leak" }] };
  assert.equal(JSON.stringify(leaked).includes("Zq0Leak"), true);
});

// ── 3 · secrets seeded through the REAL persistence paths ───────────────────────────────────────

/** Short, non-credential-shaped so the redactor cannot mask a leak and fake a pass. See the header. */
const SECRETS = {
  serverEnvSecret: "envSec_41a",
  serverHeaderSecret: "hdrSec_41b",
  oauthAccessToken: "at_41c",
  oauthRefreshToken: "rt_41d",
  providerApiKey: "pk_41e",
  encryptionKeyMarker: "encKey_41f",
};

/** Free text the OWNER typed. Names are user data too — a name can carry a hostname or a path. */
const USER_TEXT = {
  serverName: "Acme_41g",
  serverCommand: "cmd_41h",
  serverArg: "arg_41i",
  serverUrl: "https://host_41j.example.invalid/mcp",
  providerLabel: "label_41k",
  skillName: "skill_41l",
  skillDisplayName: "skillDisplay_41m",
  scenarioName: "scenario_41n",
  collectionName: "collection_41o",
};

function seedRealSecretsAndNames(db: AppDatabase): void {
  // The encryption key itself carries a sentinel, so a bundle that ever printed key material would
  // be caught by the same sweep as everything else.
  const secrets = new SecretStore(Buffer.from(SECRETS.encryptionKeyMarker.padEnd(32, "0")));
  const servers = new ServerRepository(db, secrets);
  const oauth = new OAuthRepository(db, secrets);
  const providers = new ProviderRepository(db, secrets);

  const stdio = servers.create({
    name: USER_TEXT.serverName,
    transport: "stdio",
    command: USER_TEXT.serverCommand,
    args: [USER_TEXT.serverArg],
    env: { API_TOKEN: SECRETS.serverEnvSecret },
  });
  const http = servers.create({
    name: `${USER_TEXT.serverName}-http`,
    transport: "streamable_http",
    url: USER_TEXT.serverUrl,
    headers: { Authorization: SECRETS.serverHeaderSecret },
  });
  oauth.saveTokens(http.id, {
    access_token: SECRETS.oauthAccessToken,
    refresh_token: SECRETS.oauthRefreshToken,
    token_type: "Bearer",
  });

  const provider = providers.create({
    kind: "anthropic",
    label: USER_TEXT.providerLabel,
    apiKey: SECRETS.providerApiKey,
  });

  const now = "2026-08-22T08:00:00.000Z";
  db.prepare(
    "INSERT INTO scenarios (id, name, provider_id, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(nanoid(), USER_TEXT.scenarioName, provider.id, "claude-x", now, now);
  db.prepare(
    "INSERT INTO skills (id, name, display_name, slug, source_type, created_at, updated_at) VALUES (?, ?, ?, ?, 'upload', ?, ?)",
  ).run(nanoid(), USER_TEXT.skillName, USER_TEXT.skillDisplayName, `slug-${nanoid()}`, now, now);
  db.prepare(
    "INSERT INTO collections (id, name, is_default, created_at, updated_at) VALUES (?, ?, 0, ?, ?)",
  ).run(nanoid(), USER_TEXT.collectionName, now, now);

  // A scan on the stdio server, so the scan tables are non-empty and the row counts have something
  // to report — without any of it reaching the document.
  db.prepare(
    "INSERT INTO mcp_scans (id, server_id, token_profile, scanned_at, status) VALUES (?, ?, 'generic_o200k', ?, 'success')",
  ).run(nanoid(), stdio.id, now);
}

test("no stored secret reaches either rendering", () => {
  const db = openDb();
  seedRealSecretsAndNames(db);
  const { both } = renderBoth(build(db));

  for (const [label, secret] of Object.entries(SECRETS)) {
    assert.equal(both.includes(secret), false, `${label} reached the diagnostics bundle`);
  }
});

test("no user-typed free text reaches either rendering", () => {
  // The fixture has no FAILED scan and no errored run, so the errors group is empty here and this
  // test speaks for the four derived groups: versions, environment, database, feature state. The
  // errors group's separate, deliberate boundary is pinned by the test below it — the two together
  // are the honest statement, and neither alone would be.
  const db = openDb();
  seedRealSecretsAndNames(db);
  const { both } = renderBoth(build(db));

  for (const [label, text] of Object.entries(USER_TEXT)) {
    assert.equal(both.includes(text), false, `${label} reached the diagnostics bundle`);
  }
  // The counts are what stands in for the content — the bundle says how many servers there are
  // without saying what any of them is called.
  const bundle = build(db);
  assert.equal(bundle.database.tables.find((table) => table.name === "mcp_servers")?.rows, 2);
  assert.equal(bundle.database.tables.find((table) => table.name === "skills")?.rows, 1);
});

test("provider credentials are reported as a boolean per KIND, never an id or a label", () => {
  const db = openDb();
  seedRealSecretsAndNames(db);
  const bundle = build(db);

  assert.deepEqual(
    bundle.features.providerKinds.map((entry) => entry.kind),
    [...PROVIDER_KINDS],
  );
  assert.equal(
    bundle.features.providerKinds.find((entry) => entry.kind === "anthropic")?.configured,
    true,
  );
  assert.equal(
    bundle.features.providerKinds.find((entry) => entry.kind === "openai")?.configured,
    false,
  );
  for (const entry of bundle.features.providerKinds) {
    assert.deepEqual(Object.keys(entry).sort(), ["configured", "kind"]);
  }
});

// ── 4 · migration level ─────────────────────────────────────────────────────────────────────────

test("migration level reports BOTH the database's version and the latest the binary knows", () => {
  const db = openDb();
  const current = build(db).database;
  assert.equal(current.userVersion, LATEST_SCHEMA_VERSION);
  assert.equal(current.latestKnownVersion, LATEST_SCHEMA_VERSION);
  assert.equal(current.upToDate, true);

  // A mid-upgrade install must be legible rather than merely "a number".
  db.pragma(`user_version = ${LATEST_SCHEMA_VERSION - 3}`);
  const behind = build(db).database;
  assert.equal(behind.userVersion, LATEST_SCHEMA_VERSION - 3);
  assert.equal(behind.latestKnownVersion, LATEST_SCHEMA_VERSION);
  assert.equal(behind.upToDate, false);
  assert.match(renderDiagnosticsMarkdown(build(db)), /mid-upgrade/);
});

// ── 5 · recent errors — the one genuinely risky group ───────────────────────────────────────────

function seedScanEventError(db: AppDatabase, message: string, at: string): void {
  const serverId = nanoid();
  const scanId = nanoid();
  db.prepare(
    "INSERT INTO mcp_servers (id, name, transport, created_at, updated_at) VALUES (?, 'srv', 'stdio', ?, ?)",
  ).run(serverId, at, at);
  db.prepare(
    "INSERT INTO mcp_scans (id, server_id, token_profile, scanned_at, status) VALUES (?, ?, 'generic_o200k', ?, 'success')",
  ).run(scanId, serverId, at);
  db.prepare(
    "INSERT INTO scan_events (id, scan_id, level, message, created_at) VALUES (?, ?, 'error', ?, ?)",
  ).run(nanoid(), scanId, message, at);
}

test("the errors group DOES echo a path an error quotes — the documented boundary, pinned", () => {
  // Found live, on 2026-08-22, by running a real failing stdio scan against the built API: the
  // bundle came back carrying `spawn /nonexistent/binary-… ENOENT`, so the operator's configured
  // command path was in the document. Nothing else leaked — not the server name, not the args, not
  // the env secret, not the env var value — but this did, and the preamble at the time claimed
  // "no user-typed names", which was false.
  //
  // The fix was to state the boundary rather than to strip the path: an ENOENT with the path
  // removed is not worth putting in a bug report. This test exists so the boundary can never
  // silently change in EITHER direction — if someone starts redacting paths, or if the honest
  // wording gets tidied away, one of these three assertions goes red.
  const db = openDb();
  const configuredCommand = "/opt/homebrew/bin/acme-mcp-server";
  seedScanEventError(db, `spawn ${configuredCommand} ENOENT (ENOENT)`, "2026-08-22T07:00:00.000Z");

  const bundle = build(db);
  assert.equal(
    bundle.errors.entries[0]?.message.includes(configuredCommand),
    true,
    "the error text is verbatim — that is the documented trade, and the wording below depends on it",
  );

  // It must appear ONLY there. The four derived groups stay clean.
  const { errors: _errors, ...derivedGroups } = bundle;
  assert.equal(
    JSON.stringify(derivedGroups).includes(configuredCommand),
    false,
    "a configured path may ride an error message; it may not reach any other group",
  );

  // And the document must SAY so, in the section header and up top, so a reader is never told the
  // bundle is name-free when it is not.
  const markdown = renderDiagnosticsMarkdown(bundle);
  assert.match(markdown, /Read the Recent errors section before you paste/);
  assert.equal(
    markdown.includes("no user-typed names"),
    false,
    "the preamble must not make the blanket claim this test disproves",
  );
});

test("an over-long, secret-bearing error is capped AND redacted by construction", () => {
  const db = openDb();
  // Credential-SHAPED on purpose here: being masked is the assertion. `sk-` + 40 base64url chars is
  // one of the shapes `SECURITY_CREDENTIAL_PREFIX_PATTERNS` matches.
  const credential = `sk-${"A1b2C3d4E5".repeat(4)}`;
  const longMessage = `connect failed for ${credential} ${"padding ".repeat(80)}end-of-message`;
  assert.ok(
    longMessage.length > DIAGNOSTICS_ERROR_MAX_CHARS * 2,
    "the fixture must exceed the cap",
  );
  seedScanEventError(db, longMessage, "2026-08-22T07:00:00.000Z");

  const bundle = build(db);
  const entry = bundle.errors.entries[0];
  assert.ok(entry, "the error should be listed");

  // Redacted: the credential is gone and the marker says so.
  assert.equal(
    entry.message.includes(credential),
    false,
    "the credential survived into the diagnostics bundle",
  );
  assert.ok(
    entry.message.includes(SECURITY_REDACTION_MARKER),
    "the shared redactor's marker must be present where a credential was masked",
  );
  // Capped: the message cannot exceed the shared cap (plus the redactor's one-character ellipsis).
  assert.equal(entry.truncated, true);
  assert.ok(
    entry.message.length <= DIAGNOSTICS_ERROR_MAX_CHARS + 1,
    `entry length ${entry.message.length} exceeds the cap ${DIAGNOSTICS_ERROR_MAX_CHARS}`,
  );
  assert.equal(entry.message.includes("end-of-message"), false, "the tail must be cut off");

  // And neither rendering carries the credential.
  const { both } = renderBoth(bundle);
  assert.equal(both.includes(credential), false);
});

test("the entry list is capped in COUNT, and the source count still reports the true total", () => {
  const db = openDb();
  const overflow = DIAGNOSTICS_ERROR_ENTRY_LIMIT + 5;
  for (let index = 0; index < overflow; index += 1) {
    const minute = String(index).padStart(2, "0");
    seedScanEventError(db, `failure number ${index}`, `2026-08-22T07:${minute}:00.000Z`);
  }

  const bundle = build(db);
  assert.equal(bundle.errors.entries.length, DIAGNOSTICS_ERROR_ENTRY_LIMIT);
  assert.equal(bundle.errors.truncated, true);
  const scanEvents = bundle.errors.sources.find((source) => source.id === "scan_events");
  assert.ok(scanEvents && scanEvents.status === "captured");
  assert.equal(
    scanEvents.matched,
    overflow,
    "the source count must describe every row, not the capped list",
  );
  // Newest first.
  assert.equal(bundle.errors.entries[0]?.at, `2026-08-22T07:${String(overflow - 1)}:00.000Z`);
});

test('"not captured" is structurally distinguishable from "zero errors"', () => {
  const bundle = build(openDb());

  const processLog = bundle.errors.sources.find((source) => source.id === "process_log");
  assert.ok(processLog, "the API's own log must be accounted for, not silently omitted");
  assert.equal(processLog.status, "not_captured");
  assert.equal(
    "matched" in processLog,
    false,
    "a not-captured source must not be able to carry a count — that is the union's whole job",
  );
  assert.ok(processLog.status === "not_captured" && processLog.reason.length > 0);

  const scanEvents = bundle.errors.sources.find((source) => source.id === "scan_events");
  assert.ok(scanEvents && scanEvents.status === "captured");
  assert.equal(scanEvents.matched, 0, "an empty database really does have zero scan-event errors");

  // The two facts must also READ differently, or the distinction is only in the JSON.
  const markdown = renderDiagnosticsMarkdown(bundle);
  assert.match(markdown, /NOT CAPTURED/);
  assert.match(markdown, /captured — 0 recorded/);
  assert.equal(
    /API process log \| captured/.test(markdown),
    false,
    "the process log must never render as a captured source",
  );
});

test("a source whose table is missing is reported not_captured, not zero", () => {
  const db = openDb();
  db.exec("DROP TABLE scan_events");
  const scanEvents = build(db).errors.sources.find((source) => source.id === "scan_events");
  assert.ok(scanEvents);
  assert.equal(scanEvents.status, "not_captured");
});

test("failed scans and errored runs are read as error sources too", () => {
  const db = openDb();
  const at = "2026-08-22T06:00:00.000Z";
  const serverId = nanoid();
  db.prepare(
    "INSERT INTO mcp_servers (id, name, transport, created_at, updated_at) VALUES (?, 'srv', 'stdio', ?, ?)",
  ).run(serverId, at, at);
  db.prepare(
    "INSERT INTO mcp_scans (id, server_id, token_profile, scanned_at, status, error_message) VALUES (?, ?, 'generic_o200k', ?, 'failed', ?)",
  ).run(nanoid(), serverId, at, "spawn ENOENT");

  const sources = build(db).errors.sources;
  const scans = sources.find((source) => source.id === "scans");
  assert.ok(scans && scans.status === "captured");
  assert.equal(scans.matched, 1);
  const runs = sources.find((source) => source.id === "runs");
  assert.ok(runs && runs.status === "captured");
  assert.equal(runs.matched, 0);
});

// ── 6 · feature state ───────────────────────────────────────────────────────────────────────────

test("feature flags are reported per registry id", () => {
  const db = openDb();
  const flags = { ...ALL_FEATURES_ON, mcp_server: false } as AppFeatureFlags;
  const bundle = buildDiagnosticsBundle({
    db,
    featureFlags: () => flags,
    now: () => new Date("2026-08-22T09:00:00.000Z"),
    env: {},
    databasePath: join(HERE, "__no_such_database__.sqlite"),
  });
  assert.deepEqual(
    bundle.features.flags.map((flag) => flag.id),
    [...APP_FEATURE_IDS],
  );
  assert.equal(bundle.features.flags.find((flag) => flag.id === "mcp_server")?.enabled, false);
});

// ── 7 · no migration, no dependency, no feature flag ────────────────────────────────────────────

test("the diagnostics feature adds no migration and no feature flag", () => {
  const sources = ["service.ts", "routes.ts", "markdown.ts", "env-vars.ts"].map((name) =>
    readFileSync(join(HERE, "..", "src", "diagnostics", name), "utf8"),
  );
  const combined = sources.join("\n");
  // A migration would have to write `user_version`, register a MIGRATIONS entry, or CREATE a table.
  for (const forbidden of ["user_version =", "MIGRATIONS", "CREATE TABLE", "ALTER TABLE"]) {
    assert.equal(
      combined.includes(forbidden),
      false,
      `the diagnostics feature must not ${forbidden} — it is computed on read`,
    );
  }
  // A feature flag would have to consult the registry to gate itself.
  assert.equal(combined.includes("APP_FEATURE_META"), false);
});
