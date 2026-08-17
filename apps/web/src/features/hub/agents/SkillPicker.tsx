import { useEffect, useState } from "react";
import type { Skill } from "@mcp-token-footprint/shared";
import { Checkbox, Label, Spinner, Text } from "@elabs-ai/components-ui";
import { SearchInput } from "@elabs-ai/components-data";
import { listSkills } from "../../../lib/api";
import { getErrorMessage } from "../../../lib/errors";

/**
 * Assistant Hub (WP2.1, D-AH7 "skills") — a compact multi-select over the Skills registry
 * (`GET /api/skills`, the same list the Skills view itself renders). Skills attached to a role are
 * exposed to that role's agent sessions read-only and metered, never executed (the repo-wide
 * invariant) — this picker only records `skillIds`; materialization is WP2.4's job.
 */
export function SkillPicker({
  idPrefix,
  value,
  onChange,
  disabled,
}: {
  idPrefix: string;
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const list = await listSkills();
        if (!cancelled) setSkills(list);
      } catch (err) {
        if (!cancelled) setError(getErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = (skillId: string, checked: boolean): void => {
    onChange(checked ? [...new Set([...value, skillId])] : value.filter((id) => id !== skillId));
  };

  const filtered = skills.filter((skill) =>
    `${skill.displayName} ${skill.name}`.toLowerCase().includes(query.trim().toLowerCase()),
  );

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-body text-muted-foreground">
        <Spinner className="size-4" aria-hidden />
        <span>Loading skills…</span>
      </div>
    );
  }

  if (error) {
    return (
      <Text variant="meta" className="text-destructive" role="alert">
        Couldn’t load skills: {error}
      </Text>
    );
  }

  if (skills.length === 0) {
    return (
      <Text variant="caption" tone="muted">
        No skills are registered yet. Register one from the Skills view to attach it here.
      </Text>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <SearchInput
        value={query}
        onValueChange={setQuery}
        label="Filter skills"
        placeholder="Filter skills…"
      />
      <div className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-md border border-border p-2">
        {filtered.length === 0 ? (
          <Text variant="caption" tone="muted" className="p-1">
            No skills match “{query}”.
          </Text>
        ) : (
          filtered.map((skill) => {
            const fieldId = `${idPrefix}-skill-${skill.id}`;
            const checked = value.includes(skill.id);
            return (
              <Label
                key={skill.id}
                htmlFor={fieldId}
                className="flex min-w-0 cursor-pointer items-center gap-2 rounded-sm px-1.5 py-1 font-normal hover:bg-muted"
              >
                <Checkbox
                  id={fieldId}
                  checked={checked}
                  disabled={disabled}
                  onCheckedChange={(next) => toggle(skill.id, next === true)}
                />
                <span className="min-w-0 truncate">{skill.displayName}</span>
              </Label>
            );
          })
        )}
      </div>
      {value.length > 0 ? (
        <Text variant="caption" tone="muted" className="tabular-nums">
          {value.length} skill{value.length === 1 ? "" : "s"} attached
        </Text>
      ) : null}
    </div>
  );
}
