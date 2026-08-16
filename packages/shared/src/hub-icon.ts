/**
 * Assistant Hub — the agent/crew avatar ICON contract (owner request: "real icons for my agents").
 *
 * The existing `icon?: string` field on {@link HubAgentRole}/{@link HubCrew} is reused as-is (no wire
 * shape change) — this module is the single, framework-free interpreter both ends share so the web
 * avatar renderer and any server-side reader agree on what a stored value means. Three encodings:
 *
 *   • `data:…`         → an uploaded, client-downscaled image (an inline data-URI, capped below).
 *   • `lucide:<name>`  → a named glyph from the curated web icon library.
 *   • a bare token     → LEGACY free-text (the old plain-text field, e.g. `"search"`); treated as a
 *                        lucide name best-effort so pre-existing values that happen to match light up,
 *                        and ones that don't (e.g. `"data"`) fall through to the model-image fallback.
 *   • empty / absent   → no explicit icon → the renderer falls back to the model provider logo, then
 *                        to the deterministic `Persona` glyph.
 *
 * Uploads are stored INLINE (not as a `hub_files` blob) on purpose: hub retention unconditionally GCs
 * any blob with zero links and the link table has no `agent`/`crew` target — an inline data-URI needs
 * no backend lifecycle, survives naturally, and travels with role export/import. {@link HUB_ICON_MAX_LENGTH}
 * (enforced by the shared zod schemas) caps the field so a runaway data-URI can't bloat the wire.
 */

/** Prefix marking a curated-library glyph reference, e.g. `lucide:database`. */
export const HUB_ICON_LUCIDE_PREFIX = "lucide:";

/**
 * Max characters for an `icon` value. A ~128×128 downscaled PNG data-URI is well under this; the
 * bound exists so an oversized paste/upload is rejected at the wire (schema) boundary rather than
 * persisted. ~200k chars ≈ a ~150 KB image once base64-encoded.
 */
export const HUB_ICON_MAX_LENGTH = 200_000;

export type ParsedHubIcon =
  | { kind: "image"; src: string }
  | { kind: "lucide"; name: string }
  | { kind: "none" };

/** Interpret a stored `icon` value. Never throws; unknowable/empty input yields `{ kind: "none" }`. */
export function parseHubIcon(icon?: string | null): ParsedHubIcon {
  const raw = (icon ?? "").trim();
  if (raw === "") return { kind: "none" };
  if (raw.startsWith("data:")) return { kind: "image", src: raw };
  if (raw.startsWith(HUB_ICON_LUCIDE_PREFIX)) {
    const name = raw.slice(HUB_ICON_LUCIDE_PREFIX.length).trim();
    return name === "" ? { kind: "none" } : { kind: "lucide", name };
  }
  // Legacy bare token — interpret as a lucide name; the renderer degrades to the fallback if unknown.
  return { kind: "lucide", name: raw };
}

/** Build the stored value for a picked library glyph. */
export function hubLucideIconValue(name: string): string {
  return `${HUB_ICON_LUCIDE_PREFIX}${name}`;
}
