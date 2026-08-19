import http from "node:http";
import type { AddressInfo } from "node:net";
import { runCli } from "../src/cli.js";

/**
 * The test harness. Two pieces, and both exist to make the same guarantee: **these tests never touch
 * a real workbench, a real MCP server, a database or the network beyond loopback.**
 *
 *   • {@link startStub} — a `node:http` server on an ephemeral loopback port that answers canned
 *     responses and RECORDS every request it received (method, path, `Authorization`, body). Recording
 *     is what lets a test assert the negative cases the WP actually cares about: that a malformed
 *     token is refused *before* any request goes out, and that a token never appears in output even
 *     when the API echoes it back.
 *   • {@link runCliCapture} — `runCli` with argv/env/cwd/streams injected, returning the exact bytes
 *     stdout and stderr would have carried plus the exit code. In-process, so there is no child to
 *     spawn and no shell to mangle the exit code (`pnpm exec`, notably, collapses every non-zero exit
 *     to 1 — see `user-guide/22-mcpfp-cli.md`).
 */

export type StubRequest = {
  method: string;
  /** The request target, query string included. */
  url: string;
  authorization: string | undefined;
  body: string;
};

export type StubResponse = {
  status?: number;
  /** A string is sent verbatim; anything else is JSON-serialized. */
  body?: unknown;
  contentType?: string;
};

/** `"GET /api/servers"` → the canned answer, or a function of the recorded request. */
export type StubRoutes = Record<string, StubResponse | ((request: StubRequest) => StubResponse)>;

export type Stub = {
  url: string;
  requests: StubRequest[];
  close: () => Promise<void>;
};

export async function startStub(routes: StubRoutes): Promise<Stub> {
  const requests: StubRequest[] = [];

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const recorded: StubRequest = {
        method: req.method ?? "GET",
        url: req.url ?? "/",
        authorization: req.headers.authorization,
        body: Buffer.concat(chunks).toString("utf8"),
      };
      requests.push(recorded);

      const key = `${recorded.method} ${recorded.url.split("?")[0]}`;
      const route = routes[key];
      if (route === undefined) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: `stub has no route for ${key}` }));
        return;
      }

      const answer = typeof route === "function" ? route(recorded) : route;
      const body =
        typeof answer.body === "string" ? answer.body : JSON.stringify(answer.body ?? null);
      res.writeHead(answer.status ?? 200, {
        "content-type": answer.contentType ?? "application/json",
      });
      res.end(body);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

export type CliResult = { exitCode: number; stdout: string; stderr: string };

export async function runCliCapture(
  argv: string[],
  options: { env?: Record<string, string | undefined>; cwd?: string } = {},
): Promise<CliResult> {
  let stdout = "";
  let stderr = "";
  const exitCode = await runCli({
    argv,
    // Deliberately NOT `process.env` — a developer with MCPFP_TOKEN exported must not change what
    // these tests assert.
    env: options.env ?? {},
    cwd: options.cwd ?? process.cwd(),
    streams: {
      stdout: (text) => {
        stdout += text;
      },
      stderr: (text) => {
        stderr += text;
      },
    },
  });
  return { exitCode, stdout, stderr };
}

/** A syntactically valid service token: `mcpfp_` + 43 base64url characters, exactly as the API mints. */
export const VALID_TOKEN = "mcpfp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0Uvw";
