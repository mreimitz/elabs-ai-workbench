// Assistant Hub — the provider tool-name boundary (P0 fix). Providers (notably Anthropic) validate the
// tool NAME against `^[a-zA-Z0-9_-]{1,128}$` and reject anything else with
// `tools.0.custom.name: String should match pattern ...`. But the hub's INTERNAL tool keys are
// deliberately DOTTED (`files.list`, `artifacts.create`, `memory.propose_save`, `tasks.update`, …) and
// bridged MCP tools can carry dots/colons/other separators or exceed 128 chars. Those dotted names are
// the PERSISTED grant identifiers (`hub_agents.tool_grants_json`) referenced by grants, prompt text, the
// UI, and tests — so they must NOT be renamed at the source.
//
// This module is the translation seam at the model boundary: it re-keys the toolset by a provider-SAFE
// name just before `streamText`, and hands back a reverse mapping so every settled `tool-call`/
// `tool-result`/`tool-error` the stream emits is translated BACK to the internal dotted name the rest of
// the engine (sources, serverIds, persistence, UI) reads. Pure + deterministic (same input map → same
// output) so it is trivially unit-testable and never depends on iteration timing.
import type { Tool } from "ai";

/** The provider name contract every emitted tool name must satisfy (Anthropic + the general MCP rule). */
export const PROVIDER_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

/** The hard provider cap on a tool name's length. */
const MAX_LEN = 128;

/**
 * Collapse one internal tool name to a provider-safe BASE matching {@link PROVIDER_TOOL_NAME_PATTERN}
 * (before any collision disambiguation): every maximal run of disallowed characters becomes a single
 * `_`, leading/trailing `_` are trimmed, an empty result falls back to `"tool"`, and the whole thing is
 * capped at {@link MAX_LEN} characters.
 */
function toSafeBase(name: string): string {
  let safe = name.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  if (safe === "") safe = "tool";
  if (safe.length > MAX_LEN) safe = safe.slice(0, MAX_LEN);
  return safe;
}

/**
 * Re-key a turn's toolset by provider-safe names, preserving a BIJECTION so no tool is ever lost or two
 * internal names ever collapse onto one provider name.
 *
 * For each internal key (iterated in the map's insertion order, which is deterministic) a safe base is
 * computed via {@link toSafeBase}. When that base (or a truncation) is already claimed by an earlier
 * entry, it is disambiguated deterministically by appending `_2`, `_3`, … (truncating the base so the
 * suffixed name still fits {@link MAX_LEN}) until a free name is found — so the mapping is total and
 * one-to-one, and identical input maps always produce identical output.
 *
 * @returns `providerTools` — the SAME {@link Tool} values re-keyed by their safe names (hand this to
 *   `streamText`); and `toInternalName` — reverses a provider name back to its internal key (identity
 *   for any name it never issued, so an unexpected/passthrough name is safe).
 */
export function sanitizeToolNamesForProvider(tools: Record<string, Tool>): {
  providerTools: Record<string, Tool>;
  toInternalName: (providerName: string) => string;
} {
  const providerTools: Record<string, Tool> = {};
  const providerToInternal = new Map<string, string>();
  const used = new Set<string>();

  for (const [internal, toolValue] of Object.entries(tools)) {
    const base = toSafeBase(internal);
    let candidate = base;
    let n = 2;
    while (used.has(candidate)) {
      const suffix = `_${n}`;
      const room = Math.max(1, MAX_LEN - suffix.length);
      candidate = `${base.slice(0, room)}${suffix}`;
      n += 1;
    }
    used.add(candidate);
    providerToInternal.set(candidate, internal);
    providerTools[candidate] = toolValue;
  }

  const toInternalName = (providerName: string): string =>
    providerToInternal.get(providerName) ?? providerName;

  return { providerTools, toInternalName };
}
