// Assistant Hub (planning/Roadmap/RM-03-assistant-hub/, WP3.4, D-AH12) — the upload size-cap guard. Mirrors
// `apps/api/src/skills/caps.ts`'s zip-bomb-guard PATTERN (a per-file byte cap, one clear 400 on
// breach) rather than importing it directly: uploads and skill trees are different domains with
// different defaults (a hub upload is a single file per request, not a whole tree), so this stays a
// small, hub-scoped module — the shape is reused, not the code.
import { HUB_FILE_MAX_BYTES } from "@mcp-token-footprint/shared";
import { httpError } from "../../utils/errors.js";

export type HubFileCaps = { maxBytes: number };

export const DEFAULT_HUB_FILE_CAPS: HubFileCaps = { maxBytes: HUB_FILE_MAX_BYTES };

/** A single-upload size-cap breach → clear 400 (the zip-bomb guard's one-file-request analogue). */
export function assertHubUploadCap(bytes: number, caps: HubFileCaps): void {
  if (bytes > caps.maxBytes) {
    throw httpError(
      400,
      `The upload exceeds the ${caps.maxBytes}-byte per-file limit (zip-bomb guard).`,
    );
  }
}
