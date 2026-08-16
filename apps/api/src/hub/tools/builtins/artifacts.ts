// Assistant Hub (WP0.5, §1.6) — the `artifacts.{create,update}` built-ins, persisted through the
// WP0.2 `HubRepository` (`hub_artifacts` / `hub_artifact_versions`). The model never chooses
// `sessionId`/`authorKind` — those come from the execution context, never the input schema.
//
// WP1.6 addition: each call also appends the discrete `artifact_created`/`artifact_updated` event
// (§1.3) to the session's log via `ctx.repository.appendEvent` — durable + replayable (R-SES1) so a
// reconnecting client (or the WP1.6 `ArtifactCanvas`) learns about the change without parsing this
// tool's `modelContent`/`artifact` result shape. NOTE: because `HubToolExecutionContext` carries no
// live-forward `sink` (that stays the turn engine's concern), this event reaches an ALREADY-OPEN SSE
// connection only once the session's next settled event (typically `turn_done`) is forwarded live —
// callers refresh on `turn_done` too, not on this event alone, for a live (not just replay) update.
import { HUB_ARTIFACT_TITLE_MAX_LENGTH, hubArtifactKindSchema } from "@mcp-token-footprint/shared";
import { z } from "zod";
import type { HubBuiltinTool } from "../types.js";

const createInput = z
  .object({
    kind: hubArtifactKindSchema,
    title: z.string().trim().min(1).max(HUB_ARTIFACT_TITLE_MAX_LENGTH),
    content: z.string(),
    note: z.string().optional(),
  })
  .strict();

const updateInput = z
  .object({
    artifactId: z.string().min(1),
    content: z.string(),
    note: z.string().optional(),
  })
  .strict();

export const artifactsCreate: HubBuiltinTool = {
  name: "artifacts.create",
  source: "builtin",
  description:
    "Create a new versioned artifact (markdown/code/html/table/json) in the session's canvas — for a real deliverable, not a scratch note.",
  inputSchema: createInput,
  annotations: { readOnlyHint: false, destructiveHint: false },
  async execute(input, ctx) {
    const { kind, title, content, note } = createInput.parse(input);
    const artifact = ctx.repository.createArtifact({
      sessionId: ctx.sessionId,
      kind,
      title,
      content,
      note,
      authorKind: "assistant",
    });
    // Append the discrete `artifact_created` event (§1.3) so the canvas (WP1.6) — and anything else
    // reconstructing this session purely from `hub_events`, R-SES1 — learns about the new artifact
    // without special-casing this tool's `modelContent` shape. `currentVersionId` is always set by
    // `createArtifact` in the same transaction; the guard is just defensive typing, never expected false.
    if (artifact.currentVersionId) {
      ctx.repository.appendEvent(ctx.sessionId, {
        type: "artifact_created",
        artifactId: artifact.id,
        kind: artifact.kind,
        title: artifact.title,
        versionId: artifact.currentVersionId,
        version: artifact.latestVersion,
      });
    }
    return {
      modelContent: {
        artifactId: artifact.id,
        kind: artifact.kind,
        title: artifact.title,
        version: artifact.latestVersion,
      },
      artifact: { kind: "hub_artifact", data: artifact },
    };
  },
};

export const artifactsUpdate: HubBuiltinTool = {
  name: "artifacts.update",
  source: "builtin",
  description: "Append a new IMMUTABLE version to an existing artifact (the prior version is preserved).",
  inputSchema: updateInput,
  annotations: { readOnlyHint: false, destructiveHint: false },
  async execute(input, ctx) {
    const { artifactId, content, note } = updateInput.parse(input);
    const version = ctx.repository.addArtifactVersion(artifactId, {
      content,
      note,
      authorKind: "assistant",
    });
    // Mirrors `artifacts.create` above — the `artifact_updated` event (§1.3) so a version appended by
    // the model is replayable/visible the same way a version appended via the REST "user path"
    // (WP1.6 `hub/routes.ts`) is.
    ctx.repository.appendEvent(ctx.sessionId, {
      type: "artifact_updated",
      artifactId: version.artifactId,
      versionId: version.id,
      version: version.version,
      ...(version.note ? { note: version.note } : {}),
    });
    return {
      modelContent: { artifactId: version.artifactId, version: version.version },
      artifact: { kind: "hub_artifact", data: version },
    };
  },
};

// ── assistant-hub v1-fixes (F3) — the READ side ───────────────────────────────────────────────────
// Root cause: cross-turn tool history is not re-seeded into model context, and artifacts had no read
// tool — so a later turn could not re-open the artifact it wrote one turn earlier (the observed
// "enhanced report" was regenerated from chat prose instead of from report v1). `artifacts.read`
// closes that: no args → this session's artifact list; with an id → the current version's content.

const readInput = z
  .object({
    artifactId: z.string().min(1).optional(),
  })
  .strict();

export const artifactsRead: HubBuiltinTool = {
  name: "artifacts.read",
  source: "builtin",
  description:
    "Read a session artifact's CURRENT content by artifactId — or call with no arguments to list this " +
    "session's artifacts (id, kind, title, version). Read-only.",
  inputSchema: readInput,
  annotations: { readOnlyHint: true },
  async execute(input, ctx) {
    const { artifactId } = readInput.parse(input ?? {});
    if (!artifactId) {
      const artifacts = ctx.repository.listArtifacts({ sessionId: ctx.sessionId });
      return {
        modelContent: artifacts.map((a) => ({
          artifactId: a.id,
          kind: a.kind,
          title: a.title,
          version: a.latestVersion,
          updatedAt: a.updatedAt,
        })),
      };
    }
    const artifact = ctx.repository.getArtifact(artifactId); // 404 → safeExecuteBuiltin isError
    if (artifact.sessionId && artifact.sessionId !== ctx.sessionId) {
      return {
        modelContent: null,
        isError: true,
        errorText: "That artifact belongs to a different session.",
      };
    }
    const version = artifact.currentVersionId
      ? ctx.repository.getArtifactVersion(artifact.currentVersionId)
      : undefined;
    return {
      modelContent: {
        artifactId: artifact.id,
        kind: artifact.kind,
        title: artifact.title,
        version: artifact.latestVersion,
        content: version?.content ?? "",
      },
    };
  },
};

export const ARTIFACT_BUILTINS: HubBuiltinTool[] = [artifactsCreate, artifactsRead, artifactsUpdate];
