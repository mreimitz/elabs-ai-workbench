import { useEffect, useState } from "react";
import {
  EMPTY_RUN_FILTER_OPTIONS,
  type RunFilterOptionData,
} from "../testing/runs/RunFilterBar";
import { listScenarios, listServers, listSkills, listSuites } from "../../lib/api";

/**
 * A light-weight, self-contained resolver for {@link RunFilterOptionData} — the same dynamic
 * (id-valued) option lists `RunsView` builds from its own bigger data loader, reproduced here so the
 * rule editor can reuse `RunFilterBar` (WP2.3) without depending on that feature's internals. Every
 * fetch is best-effort (mirrors `RunsView`'s own servers/skills loader) — a failure just leaves that
 * dimension's options empty, never blocks the editor.
 */
export function useRunFilterOptions(active: boolean): RunFilterOptionData {
  const [options, setOptions] = useState<RunFilterOptionData>(EMPTY_RUN_FILTER_OPTIONS);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    Promise.all([listScenarios(), listSuites(), listServers(), listSkills()])
      .then(([scenarios, suites, servers, skills]) => {
        if (!alive) return;
        const environments = scenarios
          .map((s) => ({ value: s.id, label: s.name }))
          .sort((a, b) => a.label.localeCompare(b.label));
        const models = [...new Set(scenarios.map((s) => s.model).filter((m): m is string => Boolean(m)))]
          .sort((a, b) => a.localeCompare(b))
          .map((m) => ({ value: m, label: m }));
        setOptions({
          environments,
          models,
          servers: servers.map((s) => ({ value: s.id, label: s.name })),
          suites: suites.map((s) => ({ value: s.id, label: s.name })),
          skills: skills.map((s) => ({ value: s.id, label: s.displayName || s.name })),
        });
      })
      .catch(() => {
        // Best-effort — the filter bar just shows fewer options for the dynamic fields.
      });
    return () => {
      alive = false;
    };
  }, [active]);

  return options;
}
