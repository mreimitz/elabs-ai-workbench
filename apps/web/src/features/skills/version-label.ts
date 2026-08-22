import type { SkillVersion } from "@mcp-token-footprint/shared";

// ── One way to name a skill version, everywhere it is named ───────────────────────────────────────
// The API derives a fallback `versionLabel` of exactly `v{seq}` for an editor save (no manifest
// version, no git ref). A surface that composes its own label out of `seq` + `versionLabel` therefore
// renders the duplicated "v5 · v5" for every version the Studio has ever produced. Skill IDE SI13
// fixed that once — and then `SkillDiffView`'s A/B pickers went on building their label by hand and
// showing "v5 · v5" anyway, which is exactly the drift a shared helper exists to stop.
//
// RM-30 WP 7.9 moved this out of `SkillInspector.tsx` so `SkillDiffView` can call it WITHOUT
// importing the inspector that renders it — the inspector imports the diff view, so the other
// direction would close an import cycle. `SkillInspector` re-exports it, so every existing caller is
// unchanged.

/**
 * One version's display label: `v{seq}`, plus the human `versionLabel` when it actually adds
 * information. An identical (case- and whitespace-insensitive) or blank label is dropped.
 */
export function formatVersionLabel(version: Pick<SkillVersion, "seq" | "versionLabel">): string {
  const seqLabel = `v${version.seq}`;
  const label = version.versionLabel?.trim();
  if (!label || label.toLowerCase() === seqLabel.toLowerCase()) return seqLabel;
  return `${seqLabel} · ${label}`;
}
