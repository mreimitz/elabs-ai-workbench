import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { Skill, SkillVersion } from "@mcp-token-footprint/shared";
import { Button, StatePanel } from "@elabs-ai/components-ui";
import { getErrorMessage } from "../../../lib/errors";
import { getSkill, listSkillVersions } from "../skills-inspector-api";
import { formatVersionLabel } from "../SkillInspector";
import { StudioShell } from "./StudioShell";

// ── Skill Studio (RM-30 WP 7.1) — the route ───────────────────────────────────────────────────────
// `/skills/:skillId/studio` — a full-viewport authoring workbench for ONE skill. It is a route, not a
// dialog (D-TB10): an author bookmarks it, shares it, and reloads it, and everything that decides
// what it is showing rides in the query string (`file` · `rail` · `sel` — see `studio-url.ts`).
//
// It always authors the skill's CURRENT version: a save produces a new immutable version and the
// route re-points onto it. Older versions are read at `/skills/:skillId` (the inspector), which is
// also where Exit lands.

export function SkillStudioView() {
  const { skillId } = useParams<{ skillId: string }>();
  const navigate = useNavigate();

  const [skill, setSkill] = useState<Skill | null>(null);
  const [versions, setVersions] = useState<SkillVersion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null);

  const load = useCallback(async (id: string) => {
    const [loadedSkill, loadedVersions] = await Promise.all([getSkill(id), listSkillVersions(id)]);
    const sorted = [...loadedVersions].sort((a, b) => b.seq - a.seq);
    setSkill(loadedSkill);
    setVersions(sorted);
    return { loadedSkill, sorted };
  }, []);

  useEffect(() => {
    if (!skillId) return;
    let cancelled = false;
    setSkill(null);
    setVersions([]);
    setError(null);
    setActiveVersionId(null);
    load(skillId)
      .then(({ loadedSkill, sorted }) => {
        if (cancelled) return;
        setActiveVersionId(loadedSkill.currentVersionId ?? sorted[0]?.id ?? null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [skillId, load]);

  // A save (or a bind/unbind) landed a NEW immutable version: refetch the skill + version list and
  // author the new head, exactly as the inspector's own refresh-and-select does.
  const handleVersionSaved = useCallback(
    (newVersionId: string) => {
      setActiveVersionId(newVersionId);
      if (skillId) void load(skillId).catch(() => undefined);
    },
    [skillId, load],
  );

  const activeVersion = useMemo(
    () => versions.find((version) => version.id === activeVersionId) ?? null,
    [versions, activeVersionId],
  );

  if (!skillId) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="w-full max-w-md">
          <StatePanel
            kind="error"
            title="No skill named"
            description="This address doesn’t name a skill to author."
            actions={<Button onClick={() => navigate("/skills")}>All skills</Button>}
          />
        </div>
      </div>
    );
  }

  if (error !== null) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="w-full max-w-md">
          <StatePanel
            kind="error"
            title="Couldn’t open the studio"
            description={error}
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" onClick={() => navigate("/skills")}>
                  All skills
                </Button>
                <Button onClick={() => navigate(`/skills/${skillId}`)}>Open the skill</Button>
              </div>
            }
          />
        </div>
      </div>
    );
  }

  if (!skill || !activeVersionId || !activeVersion) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <StatePanel kind="loading" title="Loading skill…" loadingLabel="Loading skill…" />
      </div>
    );
  }

  return (
    <StudioShell
      key={`${skill.id}:${activeVersionId}`}
      skillId={skill.id}
      skillName={skill.displayName}
      versionId={activeVersionId}
      isHeadVersion={skill.currentVersionId === activeVersionId}
      versionLabel={formatVersionLabel(activeVersion)}
      // What a save creates. The API always appends (`seq + 1`), so this is the version the toolbar's
      // one save action can name — never a guess at which version is "next" in some other sense.
      nextVersionLabel={`v${activeVersion.seq + 1}`}
      onVersionSaved={handleVersionSaved}
      exitTo={`/skills/${skill.id}`}
    />
  );
}
