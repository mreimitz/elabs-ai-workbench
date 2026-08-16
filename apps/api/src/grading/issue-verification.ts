// Observability WP5.4 (D-OB20) — the issue ⇆ verification-run LINK MARK. When the owner runs the
// assistant-driven issue loop (analyze → draft fix → fork re-run to prove it), each fork re-run of a
// linked run is annotated back onto the issue as a "verification run" so the issue detail can show the
// runs that were launched to prove a fix. This is a LINK ANNOTATION only (D-OB15/AR6): the verification
// runs are ordinary, gradeable runs; nothing here ever touches a run's grade.
//
// PERSISTED WITHOUT A SCHEMA CHANGE (WP5.4 hard constraint — the v43 migration slot belongs to a
// parallel WP). The links live as ONE JSON document in the generic `app_settings` KV under
// {@link ISSUE_VERIFICATION_LINKS_KEY}, exactly the NON-migration pattern WP5.2's `IssueAssistStore`
// (the assist overlay) established. The deterministic `rating_issues` rows are NEVER touched here.
//
// Defensive by construction: every read repairs a missing/corrupt document to an empty map; every write
// is a full-document upsert (last write wins — this is a single-owner local tool).

/** The app_settings key the verification-link document lives under (LOCAL — never a shared constant, so
 *  no `packages/shared` change; the value is stable and namespaced like `ISSUE_SWEEP_WATERMARK_KEY`). */
export const ISSUE_VERIFICATION_LINKS_KEY = "issue_verification_links";

/** One issue ⇆ run link: a fork re-run launched to verify a fix for the issue. */
export interface IssueVerificationLink {
  /** The DERIVED (fork) run's id — a normal, gradeable run. */
  runId: string;
  /** The parent (linked) run the fork was derived from, when the loop forked an existing run. */
  sourceRunId?: string;
  /** A short operator/assistant note on what this run is verifying. */
  note?: string;
  /** When the link was recorded (ISO-8601). */
  at: string;
}

/** The persisted document: issueId → its verification-run links (newest last). */
export type IssueVerificationState = Record<string, IssueVerificationLink[]>;

/** The minimal KV surface the store needs — satisfied by {@link import("./app-settings-repository.js").AppSettingsRepository}. */
export interface VerificationSettingsKv {
  get(key: string): unknown;
  put(key: string, value: unknown): void;
}

/**
 * The verification-link store — a thin, defensive read/modify/write wrapper over the generic
 * `app_settings` KV (a deliberate NON-migration, WP5.4). Mirrors {@link IssueAssistStore}'s discipline:
 * every read repairs to a valid map, every write is a full-document upsert.
 */
export class IssueVerificationStore {
  constructor(private readonly settings: VerificationSettingsKv) {}

  /** The full document, repaired to `{}` on any absence/corruption. */
  read(): IssueVerificationState {
    return normalizeState(this.settings.get(ISSUE_VERIFICATION_LINKS_KEY));
  }

  /** One issue's verification-run links (oldest first), or `[]` when none. */
  list(issueId: string): IssueVerificationLink[] {
    return this.read()[issueId] ?? [];
  }

  /**
   * Annotate a fork re-run onto an issue as a verification run (idempotent per `runId`). Returns the
   * stored link. Re-linking the SAME runId to the SAME issue updates its note/source in place rather than
   * appending a duplicate (a re-run tool call retried with the same run is a no-op-shaped update).
   */
  link(issueId: string, link: IssueVerificationLink): IssueVerificationLink {
    const state = this.read();
    const existing = state[issueId] ?? [];
    const withoutDup = existing.filter((l) => l.runId !== link.runId);
    const next = [...withoutDup, link];
    this.settings.put(ISSUE_VERIFICATION_LINKS_KEY, { ...state, [issueId]: next });
    return link;
  }
}

/** Repair an arbitrary persisted value into a valid {@link IssueVerificationState}. */
function normalizeState(raw: unknown): IssueVerificationState {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out: IssueVerificationState = {};
  for (const [issueId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    const links = value.map(normalizeLink).filter((l): l is IssueVerificationLink => l !== null);
    if (links.length > 0) out[issueId] = links;
  }
  return out;
}

function normalizeLink(raw: unknown): IssueVerificationLink | null {
  if (typeof raw !== "object" || raw === null) return null;
  const l = raw as Record<string, unknown>;
  if (typeof l.runId !== "string" || l.runId.length === 0) return null;
  return {
    runId: l.runId,
    ...(typeof l.sourceRunId === "string" && l.sourceRunId.length > 0
      ? { sourceRunId: l.sourceRunId }
      : {}),
    ...(typeof l.note === "string" && l.note.length > 0 ? { note: l.note } : {}),
    at: typeof l.at === "string" && l.at.length > 0 ? l.at : new Date(0).toISOString(),
  };
}
