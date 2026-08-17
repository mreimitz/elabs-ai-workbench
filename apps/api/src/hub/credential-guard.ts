// model-identity WP6.1 (F5) — the ONE validator for an explicit `providerCredentialId`, extracted so
// every surface that WRITES one shares it.
//
// WP2.2's surface sweep concluded "exactly 4 write bindings, all guarded". That was true for the four
// bindings it enumerated (session create/patch, agent create/patch) and missed two more:
//
//   • **crew-member pins** — a FIFTH write of a credential id. `POST/PATCH /api/hub/crews` called
//     `repository.createCrew`/`updateCrew` bare, so a `acme_answers` or `authBroken` pin was accepted
//     silently and an unknown id was not caught at all (crew members ride the `hub_crews.members_json`
//     blob, which no foreign key protects — D-MI2).
//   • **the dock's Hub write tools** (`assistant/tools/hub-write-tools.ts`) — `hub_agent_create` /
//     `hub_agent_update` / `hub_crew_create` / `hub_crew_update` call the repository DIRECTLY, so they
//     bypassed the route guards entirely; the only failure that surfaced was an unknown agent pin
//     dying on the `hub_agents.provider_credential_id` foreign key as a raw `SQLITE_CONSTRAINT` → a
//     **500**, precisely the failure mode WP2.2 rewrote the session path to avoid.
//
// This module holds the validator and the two write-surface assertions built on it, so the routes and
// the dock tools enforce the SAME D-MI9 posture with the SAME error vocabulary: an explicit pin that is
// unknown / not hub-eligible / auth-broken is a **409**, never a silently accepted value and never a
// raw constraint 500. An ABSENT pin stays the documented legacy path (the heuristic) — never an error.
//
// It is deliberately NOT a scope change: `ASSISTANT_ENTITY_KINDS` / `SCOPE_WRITE_TOOLS` /
// `deriveAssistantScope` are frozen (D-AO3). This is validation inside tools that already exist.
//
// Secrets: every message names a credential by its REDACTED `label` + `kind` only. A key — encrypted or
// decrypted — is never read here (`.claude/rules/mcp-and-security.md`).

import {
  providerKindLabel,
  type HubCrewMember,
  type ProviderCredential,
} from "@mcp-token-footprint/shared";
import type { ProviderRepository } from "../providers/repository.js";
import { httpError } from "../utils/errors.js";
import { HUB_MODEL_KINDS, isHubModelKind } from "./capabilities.js";
import type { HubRepository } from "./repository.js";

/**
 * D-MI6 (WP 2.3) — the hub-eligible provider kinds named in prose, GENERATED from
 * {@link HUB_MODEL_KINDS} × the one label registry in `packages/shared` (`providerKindLabel`), so a
 * newly-added kind cannot drift out of the operator-facing roster.
 */
export function orList(items: readonly string[]): string {
  const last = items.at(-1);
  if (last === undefined) return "";
  if (items.length === 1) return last;
  return `${items.slice(0, -1).join(", ")}, or ${last}`;
}

/** How an operator-facing message names a credential: its own label, qualified by its provider kind's
 *  registry label (D-MI6) when the two differ. `label` and `kind` are both REDACTED fields on
 *  {@link ProviderCredential} — a credential's key is never read here, let alone rendered. */
export function describeHubCredential(credential: ProviderCredential): string {
  const kindLabel = providerKindLabel(credential.kind);
  return credential.label === kindLabel
    ? `"${credential.label}"`
    : `"${credential.label}" (${kindLabel})`;
}

/**
 * model-identity WP2.1 (D-MI1) — resolve an EXPLICIT `providerCredentialId` to the credential that must
 * run the turn, refusing loudly (D-MI9) rather than degrading.
 *
 * Degrading here would mean an unknown / non-hub-eligible (`acme_answers`, D-AH4) / auth-broken pin
 * falls through to the name heuristic, which is precisely the class of behaviour that produced the
 * original defect: the operator asked for one credential and silently got another, with no signal
 * anywhere. Refusing in the module's existing `NO_PROVIDER_MESSAGE` 409 posture is the only outcome that
 * cannot mis-bill a turn behind the operator's back.
 *
 * **This governs the REQUEST/WRITE path only.** An id supplied on this request that cannot be honoured
 * is a 409. The READ/replay path is deliberately the opposite and stays that way: a credential deleted
 * mid-session degrades the persisted column to NULL via `ON DELETE SET NULL` (D-MI1/D-MI2), so the
 * session replays through the unchanged heuristic rather than bricking. Do not conflate the two.
 *
 * The message names the credential by LABEL or ID and says which of the three checks failed — never a
 * key, never a decrypted value.
 */
export function resolveExplicitHubCredential(
  providers: ProviderRepository,
  providerCredentialId: string,
  modelId: string,
): ProviderCredential {
  let credential: ProviderCredential;
  try {
    credential = providers.get(providerCredentialId);
  } catch {
    // A 404 from the store: an unknown id, or one deleted since the request was composed. The persisted
    // columns are `ON DELETE SET NULL`, so this only ever reaches us from a request body or a JSON blob
    // no FK protects (`hub_missions.plan_json`, `hub_crews.members_json`).
    throw httpError(
      409,
      `The provider credential "${providerCredentialId}" pinned for model "${modelId}" no longer ` +
        "exists. Pick the model again (or clear the pin) — the Assistant will not silently run it on a " +
        "different credential.",
    );
  }
  if (!isHubModelKind(credential.kind)) {
    throw httpError(
      409,
      `Provider credential ${describeHubCredential(credential)} cannot run Assistant model ` +
        `"${modelId}" — it is not an Assistant-eligible provider. Pick a credential of kind ` +
        `${orList(HUB_MODEL_KINDS.map((kind) => providerKindLabel(kind)))}.`,
    );
  }
  if (credential.authBroken === true) {
    throw httpError(
      409,
      `Provider credential ${describeHubCredential(credential)} is pinned to model "${modelId}" but its ` +
        "authentication is broken — sign in again (or repair the credential) in Settings, or pick a " +
        "different one. The Assistant will not silently run this turn on another credential.",
    );
  }
  return credential;
}

/** The model a crew member's pin was chosen FOR, purely so the 409 can name it. A member may override
 *  the model, inherit the referenced role's `defaultModel`, or (a nested `crewId` member) name none at
 *  all. A role that has since been deleted is not an error *here* — `instantiateCrewPlan` already skips
 *  deleted-role members — so the label degrades rather than throwing a misleading 404. */
function crewMemberModelLabel(hub: HubRepository, member: HubCrewMember): string {
  const own = member.model?.trim();
  if (own) return own;
  if (member.agentId) {
    try {
      return hub.getAgentRole(member.agentId).defaultModel;
    } catch {
      /* deleted role — fall through to the placeholder */
    }
  }
  return "(this crew member's model)";
}

/**
 * model-identity WP6.1 (F5) — validate every crew member's `providerCredentialId` before the crew is
 * written, closing the fifth write binding WP2.2's sweep missed.
 *
 * Absent pins are skipped (the documented legacy path). A `crewId` (nested-crew) member carries no
 * model of its own but may still carry a pin, so it is checked too — a pin is a pin.
 */
export function assertCrewMemberCredentials(
  providers: ProviderRepository,
  hub: HubRepository,
  members: readonly HubCrewMember[] | undefined,
): void {
  if (!members) return;
  for (const member of members) {
    if (member.providerCredentialId === undefined) continue;
    resolveExplicitHubCredential(
      providers,
      member.providerCredentialId,
      crewMemberModelLabel(hub, member),
    );
  }
}
