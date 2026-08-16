// Unified Sessions (roadmap/unified-sessions/, WP3.R) — the REUSABLE seed-a-DB script.
//
// Seeds one persisted `runs` row per (backend kind × session state) into a real SQLite DB (the app's,
// by default) so the running app renders every new session state WITHOUT a provider key / a live LLM —
// the findings/08 verification pattern. Reuses the SAME `seedSessionGrid` harness the WP3.R conformance
// test proves, so what you SEE in the app is exactly what the locked-table conformance asserts.
//
// WP5.1 (integration) re-runs this as final acceptance; the WP3.R both-theme visual pass uses it to
// populate the DB before opening the Runs feed / a run console in each theme.
//
// Usage (from `apps/api`, or via the package):
//   DATABASE_PATH=/path/to/app.sqlite  tsx scripts/seed-sessions.ts
//   # defaults to the app DB resolved by config/env (DATA_DIR/DATABASE_PATH → <root>/data/app.sqlite)
//
// It is idempotent: parents insert-or-ignore, runs insert-or-replace by fixed id (`us-<kind>-<state>`),
// so re-running refreshes the same rows rather than piling up.

import { openDatabase } from "../src/db/database.js";
import { seedSessionGrid } from "../test/support/session-seed-grid.js";

function main(): void {
  const db = openDatabase();
  try {
    const seeded = seedSessionGrid(db);
    console.log(`Seeded ${seeded.length} session-state runs into the app DB.\n`);
    console.log("kind         state              run id                      → open at /testing/runs/<id>");
    console.log("─".repeat(96));
    for (const run of seeded) {
      console.log(
        `${run.kind.padEnd(12)} ${run.state.padEnd(18)} ${run.runId.padEnd(26)}  (${run.mode})`,
      );
    }
    console.log(
      "\nOpen the Runs feed (Testing → Runs) to see the 'Needs attention' section + the status column,",
    );
    console.log("or open any run at /testing/runs/<run id> to see the console header badge + KPI rail.");
  } finally {
    db.close();
  }
}

main();
