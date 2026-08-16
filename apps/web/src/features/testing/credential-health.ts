// Provider-credential HEALTH — "is this API key actually usable?" — surfaced honestly BEFORE a paid
// run dies on a bad key (T7 / audit finding: "'loading strategy' gets a column, 'is the API key
// valid' does not; the first signal is a paid run dying").
//
// There is no dedicated backend verify endpoint. The closest REAL provider-credential check we have
// is `GET /api/providers/:id/models` — it makes one live call to the provider's own API and REJECTS
// when the provider can't be reached / the key is bad (see `lib/api.ts` `listProviderModels`). We
// reuse exactly that as the connection test, and record the outcome per credential so the
// Environments table, the editor, and the run launcher can all read one honest state.
//
// The record is client-side (localStorage). It NEVER fabricates a "Verified" — the resting state is
// "unknown" (rendered as "Never tested"), and a record is invalidated the moment the credential
// changes (its `updatedAt` moves), so an edited-but-not-retested key drops back to "Never tested"
// rather than showing a stale green.

import type { ProviderCredential } from "@mcp-token-footprint/shared";
import { listProviderModels } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import type { StatusView } from "../../lib/status";

export type CredentialHealthState = "unknown" | "verified" | "failed";

/** The health of one credential as the UI should render it. `checkedAt` is an ISO timestamp. */
export type CredentialHealth = {
  state: CredentialHealthState;
  checkedAt?: string;
  error?: string;
};

/** The persisted shape — `sig` (the credential's `updatedAt`) invalidates a record on any edit. */
type StoredHealth = {
  state: "verified" | "failed";
  checkedAt: string;
  error?: string;
  sig: string;
};

const STORAGE_KEY = "mcp-token-footprint.credential-health";

const UNKNOWN: CredentialHealth = { state: "unknown" };

function readMap(): Record<string, StoredHealth> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    return parsed && typeof parsed === "object" ? (parsed as Record<string, StoredHealth>) : {};
  } catch {
    return {};
  }
}

function writeMap(map: Record<string, StoredHealth>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // localStorage unavailable — the worst case is the credential reads "Never tested" next time.
  }
}

/**
 * The recorded health of a credential, or `unknown` when it was never tested OR the credential has
 * changed since the last test (its `updatedAt` no longer matches the recorded `sig`). A missing
 * credential (`provider` is undefined) also reads `unknown` — nothing to test.
 */
export function getCredentialHealth(provider: ProviderCredential | undefined): CredentialHealth {
  if (!provider) return UNKNOWN;
  const entry = readMap()[provider.id];
  if (!entry || entry.sig !== provider.updatedAt) return UNKNOWN;
  return { state: entry.state, checkedAt: entry.checkedAt, error: entry.error };
}

/** Persist a check outcome against the credential's current `updatedAt` and return the new health. */
export function recordCredentialHealth(
  provider: ProviderCredential,
  result: { ok: true } | { ok: false; error: string },
): CredentialHealth {
  const map = readMap();
  const checkedAt = new Date().toISOString();
  map[provider.id] = result.ok
    ? { state: "verified", checkedAt, sig: provider.updatedAt }
    : { state: "failed", checkedAt, error: result.error, sig: provider.updatedAt };
  writeMap(map);
  return getCredentialHealth(provider);
}

/**
 * Run the real credential check (`GET /api/providers/:id/models`) and record the outcome. Resolves
 * with the resulting health (never rejects — a failure is a recorded `failed`, not a thrown error).
 */
export async function testCredential(provider: ProviderCredential): Promise<CredentialHealth> {
  try {
    await listProviderModels(provider.id);
    return recordCredentialHealth(provider, { ok: true });
  } catch (error) {
    return recordCredentialHealth(provider, {
      ok: false,
      error: getErrorMessage(error, "Couldn’t reach the provider."),
    });
  }
}

/** "Verified" is the only state that clears a run to proceed without a warning. */
export function isCredentialUnverified(provider: ProviderCredential | undefined): boolean {
  return getCredentialHealth(provider).state !== "verified";
}

/** The short label for the credential's state (shared by the table chip + the launcher warning). */
export function credentialHealthLabel(state: CredentialHealthState): string {
  switch (state) {
    case "verified":
      return "Verified";
    case "failed":
      return "Failed";
    default:
      return "Never tested";
  }
}

/**
 * The credential's health as a canonical {@link StatusView} chip — rendered through the ONE
 * `StatusBadge` so both the Environments table and the editor read identically. "Never tested" is a
 * dashed neutral chip: the honest resting state, NEVER a green "Verified".
 */
export function credentialHealthView(state: CredentialHealthState): StatusView {
  switch (state) {
    case "verified":
      return { kind: "chip", label: "Verified", tone: "success", spinner: false, dashed: false };
    case "failed":
      return { kind: "chip", label: "Failed", tone: "danger", spinner: false, dashed: false };
    default:
      return { kind: "chip", label: "Never tested", tone: "neutral", spinner: false, dashed: true };
  }
}
