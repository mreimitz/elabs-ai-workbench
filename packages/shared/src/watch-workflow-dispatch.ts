// Observability — the typed GitHub Actions `workflow_dispatch` watch action (RM-17 Phase 6, AM-OB11).
//
// The PURE contract layer shared by the wire validation (`schemas.ts`), the API dispatcher
// (`apps/api/src/watch/github-dispatch.ts`) and the web rule editor
// (`apps/web/src/features/watch/*`). Nothing here touches the network, the clock, a database or a
// credential — it is the vocabulary + the ONE URL builder + the ONE validator.
//
// WHY A VALIDATOR AND NOT JUST A STRING
//   `owner`, `repo` and `workflow` are interpolated into a URL PATH. If a rule could put `..`, a
//   `/`, a `:` or an `@` in any of them, a watch rule would stop being "dispatch a workflow" and
//   become "make an authenticated request to an arbitrary URL, carrying the owner's GitHub token".
//   That is the whole reason these three fields are validated against a strict allow-list here, in
//   ONE place, that both the wire schema and the dispatcher call — a rule that never validated
//   could still be hand-written into `actions_json`, so the dispatcher re-asserts rather than
//   trusting the row.
//
//   `ref` and `inputs` ride in the JSON BODY, never the URL, so they are bounded and sanity-checked
//   rather than path-safe-checked — but they are still checked (a control character or a multi-MB
//   value is a mistake, not a feature).

/** The ONE origin a `workflow_dispatch` action may ever reach. Not configurable: a configurable
 *  host would re-open exactly the arbitrary-request hole this module exists to close. */
export const GITHUB_API_ORIGIN = "https://api.github.com";

/** Bound (ms) for the dispatch POST. Deliberately the SAME 10 s the generic webhook uses — one
 *  outbound reliability model for watch actions, not two (see `WATCH_WEBHOOK_TIMEOUT_MS`). */
export const WATCH_WORKFLOW_DISPATCH_TIMEOUT_MS = 10_000;

/** GitHub's own account-name ceiling (39 characters). */
export const WATCH_WORKFLOW_OWNER_MAX_LENGTH = 39;
/** GitHub's own repository-name ceiling (100 characters). */
export const WATCH_WORKFLOW_REPO_MAX_LENGTH = 100;
/** A workflow FILE NAME (`ci.yml`) or its numeric id — never a path. */
export const WATCH_WORKFLOW_FILE_MAX_LENGTH = 120;
/** A git ref (`main`, `refs/heads/x`, a tag). Git's own ref ceiling is far higher; this is a sanity
 *  bound, not a protocol limit. */
export const WATCH_WORKFLOW_REF_MAX_LENGTH = 255;
/** GitHub accepts at most 10 `workflow_dispatch` inputs — mirrored so the editor and the wire
 *  reject an 11th locally instead of learning it from a 422. */
export const WATCH_WORKFLOW_INPUTS_MAX = 10;
export const WATCH_WORKFLOW_INPUT_KEY_MAX_LENGTH = 100;
/** GitHub caps a dispatch input value at 65 535 characters. */
export const WATCH_WORKFLOW_INPUT_VALUE_MAX_LENGTH = 65_535;

// ── The allow-lists ──────────────────────────────────────────────────────────────────────────────
// Anchored, character-class-only, and deliberately NARROWER than what GitHub itself would accept.
// A false rejection is an operator retyping a name; a false acceptance is a credentialed request to
// a URL nobody chose.

/** A GitHub owner (user or org): alphanumerics + single hyphens, never leading/trailing hyphen. */
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;
/** A GitHub repository name: alphanumerics, `.`, `_`, `-`. `.`/`..` are rejected separately. */
const REPO_PATTERN = /^[A-Za-z0-9._-]+$/;
/** A workflow file name or numeric id — the SAME class as a repo name. No `/`, so it cannot add a
 *  path segment; no `%`, so it cannot smuggle an encoded one. */
const WORKFLOW_PATTERN = /^[A-Za-z0-9._-]+$/;
/** A git ref: alphanumerics, `.`, `_`, `-`, `/`. Never leading `-` (an argv-looking ref), never a
 *  leading/trailing `/`, never `..` (see {@link validateWorkflowDispatchTarget}). */
const REF_PATTERN = /^[A-Za-z0-9._\-/]+$/;
/** A `workflow_dispatch` input key, as GitHub's own workflow syntax allows. */
const INPUT_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/** The typed target a `workflow_dispatch` action names. It carries NO credential — the token is the
 *  app-wide connected GitHub account, resolved server-side at dispatch time and never persisted in
 *  a rule (the same discipline as the webhook's `secretRef`, one level stricter: there is no
 *  per-rule handle at all). */
export interface WatchWorkflowDispatchTarget {
  /** Repository owner (user or organisation login). */
  owner: string;
  /** Repository name. */
  repo: string;
  /** The workflow FILE NAME (`nightly.yml`) or its numeric id. Never a path. */
  workflow: string;
  /** The git ref the workflow runs on (`main`, `refs/heads/release`, a tag). */
  ref: string;
  /** Optional `workflow_dispatch` inputs. GitHub REJECTS an input the workflow does not declare, so
   *  this app deliberately appends NO run/window context of its own — what the operator typed is
   *  exactly what is sent. */
  inputs?: Record<string, string>;
}

/** The outcome of {@link validateWorkflowDispatchTarget}. `field` names WHICH field failed so a form
 *  can focus it; `message` never echoes the offending VALUE (it can reach an audit row). */
export type WorkflowDispatchValidation =
  | { ok: true }
  | { ok: false; field: keyof WatchWorkflowDispatchTarget; message: string };

function fail(
  field: keyof WatchWorkflowDispatchTarget,
  message: string,
): WorkflowDispatchValidation {
  return { ok: false, field, message };
}

/** True when `value` is a safe URL-path segment for this contract: matches its allow-list, is within
 *  its bound, and is neither `.` nor `..` nor a dot-run that could traverse. */
function isPathSegment(value: string, pattern: RegExp, maxLength: number): boolean {
  if (value.length === 0 || value.length > maxLength) return false;
  if (!pattern.test(value)) return false;
  if (value === "." || value === "..") return false;
  if (value.includes("..")) return false;
  return true;
}

export function isWatchWorkflowOwner(value: string): boolean {
  return isPathSegment(value, OWNER_PATTERN, WATCH_WORKFLOW_OWNER_MAX_LENGTH);
}

export function isWatchWorkflowRepo(value: string): boolean {
  return isPathSegment(value, REPO_PATTERN, WATCH_WORKFLOW_REPO_MAX_LENGTH);
}

export function isWatchWorkflowFile(value: string): boolean {
  return isPathSegment(value, WORKFLOW_PATTERN, WATCH_WORKFLOW_FILE_MAX_LENGTH);
}

export function isWatchWorkflowRef(value: string): boolean {
  if (value.length === 0 || value.length > WATCH_WORKFLOW_REF_MAX_LENGTH) return false;
  if (!REF_PATTERN.test(value)) return false;
  if (value.startsWith("-") || value.startsWith("/") || value.endsWith("/")) return false;
  if (value.includes("..")) return false;
  return true;
}

export function isWatchWorkflowInputKey(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= WATCH_WORKFLOW_INPUT_KEY_MAX_LENGTH &&
    INPUT_KEY_PATTERN.test(value)
  );
}

/**
 * The ONE validator. Called by the zod wire schema (so a bad rule is a 400) AND by the dispatcher
 * (so a hand-edited `actions_json` row is a failed, audited action rather than a request). Messages
 * name the RULE that was broken, never the value that broke it.
 */
export function validateWorkflowDispatchTarget(
  target: WatchWorkflowDispatchTarget,
): WorkflowDispatchValidation {
  if (!isWatchWorkflowOwner(target.owner)) {
    return fail(
      "owner",
      `Owner must be a GitHub user or organisation name (letters, digits and single hyphens, at most ${WATCH_WORKFLOW_OWNER_MAX_LENGTH} characters).`,
    );
  }
  if (!isWatchWorkflowRepo(target.repo)) {
    return fail(
      "repo",
      `Repository must be a plain repository name (letters, digits, ".", "_", "-", at most ${WATCH_WORKFLOW_REPO_MAX_LENGTH} characters) — not an owner/repo pair or a URL.`,
    );
  }
  if (!isWatchWorkflowFile(target.workflow)) {
    return fail(
      "workflow",
      'Workflow must be the workflow file name (e.g. "nightly.yml") or its numeric id — never a path.',
    );
  }
  if (!isWatchWorkflowRef(target.ref)) {
    return fail(
      "ref",
      'Ref must be a git branch or tag (e.g. "main"), without spaces, "..", or a leading "-" or "/".',
    );
  }
  const inputs = target.inputs;
  if (inputs !== undefined) {
    const keys = Object.keys(inputs);
    if (keys.length > WATCH_WORKFLOW_INPUTS_MAX) {
      return fail(
        "inputs",
        `GitHub accepts at most ${WATCH_WORKFLOW_INPUTS_MAX} workflow inputs.`,
      );
    }
    for (const key of keys) {
      if (!isWatchWorkflowInputKey(key)) {
        return fail(
          "inputs",
          "Each input name must start with a letter or underscore and contain only letters, digits, underscores and hyphens.",
        );
      }
      const value = inputs[key];
      if (typeof value !== "string") {
        return fail("inputs", "Each input value must be a string.");
      }
      if (value.length > WATCH_WORKFLOW_INPUT_VALUE_MAX_LENGTH) {
        return fail(
          "inputs",
          `An input value may be at most ${WATCH_WORKFLOW_INPUT_VALUE_MAX_LENGTH} characters.`,
        );
      }
    }
  }
  return { ok: true };
}

/**
 * The ONE place a dispatch URL is built. Refuses an invalid target rather than emitting a URL — so
 * there is no code path that reaches `fetch` with a path this module has not blessed. Each segment
 * is ALSO `encodeURIComponent`-ed: belt and braces, since the allow-lists already exclude every
 * character encoding would change.
 */
export function workflowDispatchUrl(target: WatchWorkflowDispatchTarget): string {
  const check = validateWorkflowDispatchTarget(target);
  if (!check.ok) throw new Error(`invalid workflow_dispatch target (${check.field})`);
  const owner = encodeURIComponent(target.owner);
  const repo = encodeURIComponent(target.repo);
  const workflow = encodeURIComponent(target.workflow);
  return `${GITHUB_API_ORIGIN}/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`;
}
