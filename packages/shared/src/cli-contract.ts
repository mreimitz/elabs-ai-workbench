import { z } from "zod";

// ==================================================================================================
// `mcpfp` CLI contract — the machine-output envelope, the exit codes, and the config file shape
// (roadmap/ci/, WP 1.2)
// ==================================================================================================
// The CLI is a THIN CLIENT of a running workbench API: transport + formatting, nothing else (see
// `roadmap/ci/README.md`'s "The CLI is a client" invariant). What it prints under `--format json`,
// what it exits with, and what it reads out of `mcpfp.config.json` are wire-adjacent contracts, so
// they are declared HERE rather than inside `apps/cli` — for three concrete reasons:
//
//   1. **WP 1.3 reuses the envelope unchanged.** `mcpfp assert --format json` puts the API's
//      `AssertionReport` (`ci-assertions.ts`) in `data` — no new sibling field, no second envelope,
//      `MCPFP_OUTPUT_VERSION` still 1 — and WP 2.2 renders a PR comment from that same report. One
//      declaration means those two never re-derive the shape from prose.
//   2. **`apps/cli`'s only runtime dependency is `@mcp-token-footprint/shared`** (D-C1's "the CLI is
//      a client" invariant, pinned by a test that reads the manifest). It therefore cannot import
//      `zod` directly — so the config-file schema it validates with has to live in a package that
//      already depends on zod. This one does.
//   3. A future server-side consumer (an assertion report, an artifact writer) can type against the
//      same envelope without depending on the CLI.
//
// Locked decisions this module encodes (2026-08-19, `roadmap/ci/wp-1.2-mcpfp-cli.md`):
//
//   • **D-C5 — argument parsing has no dependency.** `node:util`'s `parseArgs` + global `fetch`. A
//     four-command CLI is not a reason to take on `commander`/`yargs`, so `pnpm-lock.yaml` gains no
//     package. Nothing here may grow a dependency either.
//   • **D-C6 — stdout is the payload, stderr is the narration.** Everything a machine consumes (the
//     JSON below, the API's markdown, the human table) goes to stdout; every progress line, warning
//     and error goes to stderr, so `mcpfp report scan <id> --format json > report.json` is a
//     byte-exact parseable file.
//   • **D-C7 — the exit codes are reserved now, not later.** See {@link MCPFP_EXIT}.

/**
 * The version of the `--format json` envelope below. Bumped only for a BREAKING change to the
 * envelope's own fields. Everything since has been additive and left it at 1 — WP 1.3's `mcpfp
 * assert` puts its whole `AssertionReport` in `data` rather than growing a sibling field, which is
 * the point of `data` being "whatever the API returned for this command".
 */
export const MCPFP_OUTPUT_VERSION = 1;

/**
 * Every `--format json` payload, for every command. One shape so a consumer can identify what it is
 * holding (`command`), when it was produced (`generatedAt`) and which instance produced it
 * (`apiUrl`) without parsing prose.
 *
 * **There is deliberately no credential field, at any depth.** `apiUrl` is the base URL and nothing
 * else — never a token, never an `Authorization` header, never a `mcpfp.config.json` path that a
 * reader might then go and cat. A test asserts the envelope's key set stays exactly these five.
 *
 * `data` is **exactly what the API returned** for the command (the scan result, the report document,
 * the server list). The CLI does not re-render, re-shape or re-compute it — that is the client
 * invariant, expressed in the type: the CLI can put an API response in here, and not much else.
 */
export type McpfpOutput<T> = {
  outputVersion: typeof MCPFP_OUTPUT_VERSION;
  /** The command that produced this, in its spelled-out form: `"scan"`, `"report scan"`, `"servers"`. */
  command: string;
  /** ISO 8601 instant the CLI produced the envelope (not when the API produced `data`). */
  generatedAt: string;
  /** The workbench base URL the command ran against. Never carries a credential. */
  apiUrl: string;
  data: T;
};

/**
 * **D-C7 — the process exit codes, reserved now so WP 1.3 inherits a stable contract.**
 *
 *   • `0` — the command did what it was asked to do.
 *   • `1` — **an assertion failed.** Reserved for WP 1.3's `mcpfp assert`; **nothing in WP 1.2 ever
 *     emits it**, so a `1` today can only mean "this build is newer than you think".
 *   • `2` — an execution, config or transport error: bad flags, an unreadable config file, an
 *     unreachable API, a non-2xx response, a scan the server could not complete.
 *
 * The distinction that matters in CI: **a non-2xx API response is a `2`, not a `1`.** "The gate said
 * no" and "the gate could not run" are different outcomes and a pipeline must be able to tell them
 * apart — `roadmap/ci/README.md`'s invariant, pinned by a test.
 */
export const MCPFP_EXIT = { success: 0, assertionFailure: 1, error: 2 } as const;

export type McpfpExitCode = (typeof MCPFP_EXIT)[keyof typeof MCPFP_EXIT];

/** The config file the CLI discovers by walking UP from the cwd (first hit wins). */
export const MCPFP_CONFIG_FILE_NAME = "mcpfp.config.json";

/** Where the CLI looks when nothing names an instance. The API's own default bind address. */
export const MCPFP_DEFAULT_API_URL = "http://127.0.0.1:8080";

/**
 * Default per-request timeout. Generous on purpose: `mcpfp scan` runs a real discovery scan against a
 * real MCP server, which spawns a process or opens an HTTP session and can legitimately take minutes.
 */
export const MCPFP_DEFAULT_TIMEOUT_MS = 120_000;

/**
 * `mcpfp.config.json`. **`.strict()` is the point:** a typo'd key (`"apiUrl"` for `"url"`,
 * `"timeout"` for `"timeoutMs"`) must be an error the operator sees, not a setting that is silently
 * ignored while the CLI quietly talks to the default instance instead.
 *
 * Storing `token` here is supported but discouraged — the CLI warns on stderr and names `MCPFP_TOKEN`
 * as the CI-safe source whenever the token came from a file. `.gitignore` carries the filename.
 */
export const mcpfpConfigFileSchema = z
  .object({
    url: z.string().min(1).optional(),
    token: z.string().min(1).optional(),
    timeoutMs: z.number().int().positive().optional(),
  })
  .strict();

export type McpfpConfigFile = z.infer<typeof mcpfpConfigFileSchema>;

/**
 * Build an envelope. A factory rather than an object literal at each call site so `outputVersion` is
 * stamped in exactly one place and cannot drift between commands.
 */
export function createMcpfpOutput<T>(input: {
  command: string;
  apiUrl: string;
  data: T;
  /** Injectable so a test can pin the instant; defaults to now. */
  generatedAt?: string;
}): McpfpOutput<T> {
  return {
    outputVersion: MCPFP_OUTPUT_VERSION,
    command: input.command,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    apiUrl: input.apiUrl,
    data: input.data,
  };
}
