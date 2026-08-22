// Observability — the hand-driven "send this run to a webhook" contract (RM-17 Phase 6, AM-OB13).
//
// The PURE wire layer shared by the API's manual-send routes (`apps/api/src/watch/manual-send.ts`)
// and the console dialog (`apps/web/src/features/watch/SendToWebhookDialog.tsx`). Nothing here
// touches the network, the clock, a database or a credential — it is the payload vocabulary, the
// request schema, and the ONE audit-marker string.
//
// WHY THE PAYLOAD TYPES ARE SHARED AND THE DESTINATION IS NOT
//   The dialog PREVIEWS exactly what will be posted, so the payload shape is genuinely on the wire
//   and belongs here. The destination — a webhook URL — is NOT on the wire in either direction and
//   never can be: it lives encrypted in `watch_secrets`, is addressed only by an opaque `secretRef`,
//   and the caller names it INDIRECTLY, by the id of the watch rule that owns it. That is the whole
//   of {@link ManualSendRequest}: an id, never a URL.

import { z } from "zod";

/**
 * The `watch_rule_events.action` marker one hand-driven send writes, alongside `test_fire` and the
 * rule-fire action rows. Deliberately NOT a member of `WATCH_ACTION_TYPES` (which is the closed set
 * of things a RULE can be configured to do) — a manual send is an operator action that borrows a
 * rule's destination, so it must never be counted as that rule having fired.
 */
export const WATCH_MARKER_MANUAL_SEND = "manual_send";

/**
 * The compact run view an outbound watch payload carries — the SAME shape the rule-fire path builds
 * (`apps/api/src/watch/actions.ts` re-exports this type, so there is exactly one definition and a
 * manual send cannot drift from a rule fire). No secrets: a summary of the run, nothing more.
 */
export interface WatchRunSummaryView {
  id: string;
  status: string;
  outcome?: string;
  scenarioId: string;
  testId: string;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  startedAt: string;
}

/**
 * The compact suite-run view a manual send carries. A suite run is a MATRIX, not a conversation, so
 * it has no `scenarioId`/`testId` and its cost/token figures come off the rolled-up aggregates —
 * which are OPTIONAL by construction (a suite run that never settled has none, and RM-33's
 * all-or-nothing cache rule already means a partially-known aggregate is reported as absent). Absent
 * therefore means UNKNOWN here too, never zero.
 */
export interface WatchSuiteRunSummaryView {
  id: string;
  status: string;
  /** Only a `source:"suite"` run has an owning saved suite; a collection/adhoc plan has none. */
  suiteId?: string;
  /** How the plan was launched (`suite` | `collection` | `adhoc`), when the row records it. */
  source?: string;
  startedAt: string;
  endedAt?: string;
  /** Matrix size + progress, from the rolled-up aggregates; absent when the run has none yet. */
  cellsTotal?: number;
  cellsCompleted?: number;
  /** Execution + judge spend summed, from the aggregates; absent when the run has none yet. */
  costUsd?: number;
  totalTokens?: number;
  /** The mean selected-grader score across graded cells; null when nothing is graded. */
  meanGrade?: number | null;
}

/**
 * What a manual send POSTs. Exactly one of `run`/`suiteRun` is present — the receiver switches on
 * whichever it gets, the same way the rule path's `{run,link}` and `{window,link}` bodies differ.
 *
 * `manual: true` is the counterpart of the rule test-fire's `sample: true`: a receiver must be able
 * to tell "a human pushed this here" apart from "a rule fired" WITHOUT parsing the body's shape,
 * because the two mean completely different things to whoever is on the other end.
 *
 * `link` opens the console; `reportLink` is the machine-readable report a ticket actually wants.
 * Both are ABSOLUTE when the deployment has told the app its own base URL, and fall back to the
 * app-relative path when it has not — never a fabricated origin. See `apps/api/src/watch/outbound-link.ts`.
 */
export type ManualSendPayload = {
  run?: WatchRunSummaryView;
  suiteRun?: WatchSuiteRunSummaryView;
  link: string;
  reportLink: string;
  manual: true;
};

/**
 * `POST /api/runs/:id/send-to-webhook` and `POST /api/suite-runs/:id/send-to-webhook` body. The
 * destination is named by the WATCH RULE that owns it (AM-OB13's recommended path): reusing a rule's
 * encrypted destination needs no destination registry, no second secret lifecycle and no migration.
 */
export type ManualSendRequest = {
  /** The watch rule whose `webhook` action supplies the destination. */
  ruleId: string;
};

export const manualSendRequestSchema: z.ZodType<ManualSendRequest> = z
  .object({ ruleId: z.string().min(1) })
  .strict();
