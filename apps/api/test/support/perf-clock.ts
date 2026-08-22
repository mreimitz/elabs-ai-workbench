// ==================================================================================================
// The perf clock — measure work in CPU time, not wall clock.
// ==================================================================================================
//
// WHY. A perf budget asserted against `process.hrtime.bigint()` is a measurement of the MACHINE, not
// of the code: wall clock counts the time this process spent waiting to be scheduled. `pnpm test`
// runs several packages at once, so the api suite is routinely measured while ~25 node processes
// compete for 16 cores, and the observed load average reaches 39.
//
// Measured on 2026-08-22, same query, same corpus, idle vs. load average 76:
//
//   wall p50  84.0 ms → 217.0 ms   (2.6x — this is the machine)
//   CPU  p50  84.6 ms → 103.4 ms   (1.2x — this is the query)
//   CPU ratio    1.68 →      1.41  (the ratio assertions barely move at all)
//
// `process.cpuUsage()` reports THIS process's own user+system time. Every query these budgets cover
// is a synchronous, single-threaded `better-sqlite3` call against an in-memory database, so its CPU
// time IS its work: another process competing for cores inflates the wall clock and leaves the CPU
// time alone.
//
// WHAT THIS DOES NOT BUY, stated plainly so nobody over-trusts it. CPU time is blind to real waiting —
// I/O, lock contention, a stalled filesystem. For these particular cases that is correct, because
// there is nothing to wait ON. Do not reach for this clock to measure anything that legitimately
// blocks; measure that with wall clock and accept that it needs a quiet machine.
//
// The ceilings were NOT widened when this landed. The clock changed; the numbers did not.

/** CPU (user+system) milliseconds this process burned running `fn`, plus wall time for the record. */
export function measure(fn: () => void): { cpu: number; wall: number } {
  const cpu0 = process.cpuUsage();
  const wall0 = process.hrtime.bigint();
  fn();
  const wall = Number(process.hrtime.bigint() - wall0) / 1e6;
  const cpu = process.cpuUsage(cpu0);
  return { cpu: (cpu.user + cpu.system) / 1000, wall };
}

/** Nearest-rank percentile. Does not mutate the caller's array. */
export function percentile(samples: readonly number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.min(Math.max(Math.ceil(p * sorted.length), 1), sorted.length);
  return sorted[rank - 1] as number;
}
