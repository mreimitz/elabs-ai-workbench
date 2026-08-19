#!/usr/bin/env node
import { runCli } from "./cli.js";

// The `mcpfp` bin. Everything real lives in `cli.ts` as a function over injected argv/env/cwd/
// streams; this file exists only to hand it the actual process — which is what keeps the tests
// in-process and free of any spawned child, and keeps this file free of anything worth testing.
//
// `process.exitCode` rather than `process.exit()`: the latter can truncate a large `--format json`
// payload that stdout has not finished flushing, which is precisely the output a CI job redirects
// into a file and then parses.
process.exitCode = await runCli({
  argv: process.argv.slice(2),
  env: process.env,
  cwd: process.cwd(),
  streams: {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  },
});
