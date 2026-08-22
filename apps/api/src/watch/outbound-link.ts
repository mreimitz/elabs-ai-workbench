// Observability — the ONE answer to "what URL do we tell the outside world" (RM-17 Phase 6, AM-OB13).
//
// Before this module every watch payload and every notification built its own link inline, as a
// BARE RELATIVE PATH — `link: \`/testing/runs/${ctx.runId}\``. Inside the app that is correct; in a
// webhook body it is a string the receiver cannot click, which for a hand-driven "send this to the
// ticket" defeats the entire point of sending it.
//
// TWO FUNCTIONS, DELIBERATELY, BECAUSE THERE ARE TWO AUDIENCES
//   {@link appPath} is the app's path vocabulary — the single place that knows a run console is at
//   `/testing/runs/:id`. Everything that builds a link calls it, so there is exactly one definition
//   of each path and a second one cannot quietly appear (pinned by `watch-outbound-link.test.ts`,
//   which walks this directory's source and fails on a link-shaped literal outside this file).
//
//   {@link outboundUrl} makes such a path ABSOLUTE, and is applied ONLY where the link LEAVES the
//   app — i.e. a webhook body. It is deliberately NOT applied to a notification's `linkPath`:
//   measured 2026-08-22, `Notification.linkPath` is consumed by `apps/web/src/features/notifications/
//   NotificationBell.tsx` as `navigate(notification.linkPath)`, a react-router IN-APP navigation
//   that treats an absolute URL as a path and produces a broken location rather than an origin jump.
//   Nine call sites across the app write that field. So the notification channel shares the PATH
//   VOCABULARY with the webhook channel — which is what "one link-building path" actually buys —
//   while keeping the in-app link in-app.
//
// The origin comes from configuration (`APP_BASE_URL`) and has NO fallback. When it is unset,
// `outboundUrl` returns the relative path unchanged: an honest bare path beats a fabricated
// `http://127.0.0.1:8080/...` that looks clickable and opens nothing on the reader's machine.

import { config } from "../config/env.js";

/**
 * The app paths anything linkable points at. The ONLY place these strings are written.
 *
 * `runReport`/`suiteRunReport` are API paths, not SPA routes, on purpose: "attach this to a ticket"
 * usually means the report, and the Markdown report endpoint is the artifact a human actually reads.
 */
export const appPath = {
  /** The run console (`RunConsoleRoute`). */
  run: (runId: string): string => `/testing/runs/${runId}`,
  /** The suite-run console (`SuiteRunConsoleRoute`). */
  suiteRun: (suiteRunId: string): string => `/testing/suite-runs/${suiteRunId}`,
  /** The watch-rules page — where a windowed rule's alert sends you (there is no single run). */
  watchRules: (): string => "/testing/observability/rules",
  /** The machine-readable run report (`apps/api/src/reports/routes.ts`). */
  runReport: (runId: string): string => `/api/reports/run/${runId}/markdown`,
  /** The machine-readable suite-run report (`apps/api/src/reports/routes.ts`). */
  suiteRunReport: (suiteRunId: string): string => `/api/reports/suite-run/${suiteRunId}/markdown`,
} as const;

/**
 * Turn an app path into an absolute URL for a payload LEAVING the app, or return it unchanged when
 * this deployment has not been told its own base URL.
 *
 * `baseUrl` is injectable so both states are directly testable without mutating `process.env`; it
 * defaults to the configured one. A base that is not an absolute `http(s)` URL never reaches here —
 * `config/env.ts`'s `readBaseUrl` has already resolved it to `undefined` — but the join is written
 * to be safe against one anyway: concatenation, not `new URL(path, base)`, because the latter
 * DISCARDS a base's own path prefix (`new URL("/x", "http://h/sub/")` is `http://h/x`), which would
 * silently break a deployment served under a sub-path.
 */
export function outboundUrl(path: string, baseUrl: string | undefined = config.appBaseUrl): string {
  if (!baseUrl) return path;
  return `${baseUrl.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}
