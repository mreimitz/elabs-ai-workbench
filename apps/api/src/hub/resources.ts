// Assistant Hub (roadmap/assistant-hub/, WP3.4, R-MCP9) — MCP resource attachment. Event-sourced (no
// new table, per §1.3's "Workspace (not a table)" precedent extended to resources): a session's
// currently-attached resource set is reconstructed by replaying its `resource_attached`/
// `resource_removed` events, exactly the idiom `turn-engine.ts`'s `HubSteeringQueue.reconstructPending`
// already uses for the steering queue (R-SES1 — full state from `hub_events` alone).
//
// Attaching NEVER auto-injects the resource into the model's context (R-MCP9: "auto-inclusion off by
// default") — this module only makes a resource a visible, METERED candidate; nothing here wires it
// into `reconstructMessages`/the prompt. A future WP can add an explicit "reference this attachment"
// affordance without touching this module's contract.
import type { HubEvent, HubResourceAttachment } from "@mcp-token-footprint/shared";

/** Replay a session's event log into its currently-attached resource list, newest-attached first. */
export function reconstructAttachedResources(events: HubEvent[]): HubResourceAttachment[] {
  const byId = new Map<string, HubResourceAttachment>();
  for (const event of events) {
    if (event.type === "resource_attached") {
      byId.set(event.id, {
        id: event.id,
        serverId: event.serverId,
        ...(event.serverName ? { serverName: event.serverName } : {}),
        uri: event.uri,
        name: event.name,
        ...(event.title ? { title: event.title } : {}),
        ...(event.description ? { description: event.description } : {}),
        ...(event.mimeType ? { mimeType: event.mimeType } : {}),
        ...(event.audience ? { audience: event.audience } : {}),
        ...(event.priority !== undefined ? { priority: event.priority } : {}),
        ...(event.lastModified ? { lastModified: event.lastModified } : {}),
        ...(event.tokens !== undefined ? { tokens: event.tokens } : {}),
        attachedAt: event.at ?? new Date(0).toISOString(),
      });
    } else if (event.type === "resource_removed") {
      byId.delete(event.id);
    }
  }
  return [...byId.values()].sort((a, b) => b.attachedAt.localeCompare(a.attachedAt));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Extracted `title` + `annotations.{audience,priority,lastModified}` a scanned MCP resource declared,
 *  read defensively from `ResourceScan.rawResource` (`unknown` on the wire) — mirrors
 *  `hub/tools/mcp-bridge.ts`'s `extractToolAnnotations` for the same MCP-annotation shape on tools. */
export type HubResourceAnnotations = {
  title?: string;
  audience?: string[];
  priority?: number;
  lastModified?: string;
};

export function extractResourceAnnotations(rawResource: unknown): HubResourceAnnotations {
  const raw = isRecord(rawResource) ? rawResource : undefined;
  const out: HubResourceAnnotations = {};
  if (raw && typeof raw.title === "string") out.title = raw.title;
  const annotations = raw && isRecord(raw.annotations) ? raw.annotations : undefined;
  if (!annotations) return out;
  if (
    Array.isArray(annotations.audience) &&
    annotations.audience.every((a) => typeof a === "string")
  ) {
    out.audience = annotations.audience as string[];
  }
  if (typeof annotations.priority === "number") out.priority = annotations.priority;
  if (typeof annotations.lastModified === "string") out.lastModified = annotations.lastModified;
  return out;
}
