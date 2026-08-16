import { useEffect, useState } from "react";
import type {
  Skill,
  SkillGraphResponse,
  TestAssertions,
  TestSkillGate,
  TestSkillRoute,
} from "@mcp-token-footprint/shared";
import { Button, Label, Switch, Text } from "@brand/ui";
import { Plug, Plus, X } from "lucide-react";
import { IconButton } from "../../components/IconButton";
import { SelectField } from "../../components/SelectField";
import { listSkills } from "../../lib/api";
import { getSkillGraph } from "../skills/skills-inspector-api";
import { getErrorMessage } from "../../lib/errors";

/** A skill's current-version graph, lazily fetched + cached: `loading`, an error string, or the graph. */
type GraphEntry = { state: "loading" } | { state: "error"; message: string } | SkillGraphResponse;

/**
 * WP 5.1 — the compact validation-gate assertions editor on the test form. Authors the reserved
 * `tests.assertions_json` payload: per-node gate expectations (`skillGates`), gatekeeper route
 * expectations (`skillRoutes`), and the run-wide `noFractures` switch. Pickers are populated from the
 * skill registry + each skill's CURRENT-version graph (`getSkillGraph`) — the graph nodes/edges the
 * server evaluates against at run time. (A Test isn't bound to a scenario, so the skill picker lists
 * all registered skills rather than one scenario's attachments; a stale id still surfaces as an
 * `unevaluable` result at run time, never a silent pass/fail.)
 */
export function AssertionsEditor(props: {
  value: TestAssertions;
  onChange: (next: TestAssertions) => void;
}) {
  const { value, onChange } = props;
  const [skills, setSkills] = useState<Skill[]>([]);
  const [graphs, setGraphs] = useState<Record<string, GraphEntry>>({});

  // Load the registry once. Only skills with a current version can be graphed/asserted against.
  useEffect(() => {
    let cancelled = false;
    void listSkills()
      .then((list) => {
        if (!cancelled) setSkills(list.filter((skill) => skill.currentVersionId));
      })
      .catch(() => {
        if (!cancelled) setSkills([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Lazily fetch (and cache) the graph for every skill referenced by a row.
  useEffect(() => {
    const referenced = new Set<string>();
    for (const gate of value.skillGates ?? []) if (gate.skillId) referenced.add(gate.skillId);
    for (const route of value.skillRoutes ?? []) if (route.skillId) referenced.add(route.skillId);

    for (const skillId of referenced) {
      if (graphs[skillId]) continue;
      const skill = skills.find((s) => s.id === skillId);
      if (!skill?.currentVersionId) continue;
      const versionId = skill.currentVersionId;
      setGraphs((current) => ({ ...current, [skillId]: { state: "loading" } }));
      void getSkillGraph(skillId, versionId)
        .then((response) => setGraphs((current) => ({ ...current, [skillId]: response })))
        .catch((error) =>
          setGraphs((current) => ({
            ...current,
            [skillId]: { state: "error", message: getErrorMessage(error) },
          })),
        );
    }
  }, [value.skillGates, value.skillRoutes, skills, graphs]);

  const skillOptions = skills.map((skill) => ({ value: skill.id, label: skill.name }));

  function nodeOptions(skillId: string, onlyGatekeepers: boolean) {
    const entry = graphs[skillId];
    if (!entry || !("graph" in entry)) return [];
    return entry.graph.nodes
      .filter((node) => (onlyGatekeepers ? node.kind === "gatekeeper" : true))
      .map((node) => ({ value: node.id, label: `${node.label} · ${node.kind}` }));
  }

  function edgeOptions(skillId: string, gatekeeperId: string) {
    const entry = graphs[skillId];
    if (!entry || !("graph" in entry) || !gatekeeperId) return [];
    return entry.graph.edges
      .filter((edge) => edge.from === gatekeeperId)
      .map((edge) => ({
        value: edge.id,
        label: edge.condition ? `${edge.id} · ${edge.condition}` : edge.id,
      }));
  }

  // ── skillGates ──────────────────────────────────────────────────────────────────────────────
  const gates = value.skillGates ?? [];
  function patchGate(index: number, patch: Partial<TestSkillGate>) {
    const next = gates.map((gate, i) => (i === index ? { ...gate, ...patch } : gate));
    onChange({ ...value, skillGates: next });
  }
  function addGate() {
    onChange({ ...value, skillGates: [...gates, { skillId: "", nodeId: "", expect: "pass" }] });
  }
  function removeGate(index: number) {
    const next = gates.filter((_, i) => i !== index);
    onChange({ ...value, skillGates: next.length > 0 ? next : undefined });
  }

  // ── skillRoutes ─────────────────────────────────────────────────────────────────────────────
  const routes = value.skillRoutes ?? [];
  function patchRoute(index: number, patch: Partial<TestSkillRoute>) {
    const next = routes.map((route, i) => (i === index ? { ...route, ...patch } : route));
    onChange({ ...value, skillRoutes: next });
  }
  function addRoute() {
    onChange({
      ...value,
      skillRoutes: [...routes, { skillId: "", gatekeeperId: "", expectedEdgeId: "" }],
    });
  }
  function removeRoute(index: number) {
    const next = routes.filter((_, i) => i !== index);
    onChange({ ...value, skillRoutes: next.length > 0 ? next : undefined });
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Label>Gate assertions</Label>
        <Text variant="meta" tone="muted">
          Expectations checked headlessly from the run's trace alignment — the app never executes
          the skill. Evaluated on completion; results show on the run console.
        </Text>
      </div>

      {/* noFractures — run-wide switch. */}
      <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2">
        <div className="flex min-w-0 flex-col">
          <Label htmlFor="assert-no-fractures">No loop / gate fractures</Label>
          <Text variant="meta" tone="muted">
            Fail if any attached skill's alignment reports a fracture (failed gate, misroute, loop).
          </Text>
        </div>
        <Switch
          id="assert-no-fractures"
          checked={value.noFractures === true}
          onCheckedChange={(checked) =>
            onChange({ ...value, noFractures: checked ? true : undefined })
          }
        />
      </div>

      {/* skillGates rows. */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <Label>Node gates</Label>
          <Button type="button" variant="outline" size="sm" onClick={addGate}>
            <Plus aria-hidden />
            <span>Add gate</span>
          </Button>
        </div>
        {gates.length === 0 ? (
          <Text variant="meta" tone="muted">
            No node gates. A gate asserts a skill node was reached (`visited`) or executed as
            designed (`pass`).
          </Text>
        ) : (
          <ul className="flex flex-col gap-2">
            {gates.map((gate, index) => (
              <li
                key={index}
                className="grid grid-cols-1 items-end gap-2 rounded-md border border-border p-2 sm:grid-cols-[1fr_1fr_auto_auto]"
              >
                <SelectField
                  id={`gate-skill-${index}`}
                  label="Skill"
                  value={gate.skillId}
                  placeholder="Pick a skill…"
                  options={skillOptions}
                  onChange={(skillId) => patchGate(index, { skillId, nodeId: "" })}
                />
                <SelectField
                  id={`gate-node-${index}`}
                  label="Node"
                  value={gate.nodeId}
                  placeholder={gate.skillId ? "Pick a node…" : "Pick a skill first…"}
                  options={nodeOptions(gate.skillId, false)}
                  disabled={!gate.skillId}
                  onChange={(nodeId) => patchGate(index, { nodeId })}
                />
                <SelectField
                  id={`gate-expect-${index}`}
                  label="Expect"
                  value={gate.expect}
                  options={[
                    { value: "pass", label: "pass" },
                    { value: "visited", label: "visited" },
                  ]}
                  onChange={(expect) =>
                    patchGate(index, { expect: expect as TestSkillGate["expect"] })
                  }
                />
                <IconButton
                  type="button"
                  variant="ghost"
                  size="icon"
                  label={`Remove gate ${index + 1}`}
                  onClick={() => removeGate(index)}
                >
                  <X aria-hidden />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* skillRoutes rows. */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <Label>Gatekeeper routes</Label>
          <Button type="button" variant="outline" size="sm" onClick={addRoute}>
            <Plug aria-hidden />
            <span>Add route</span>
          </Button>
        </div>
        {routes.length === 0 ? (
          <Text variant="meta" tone="muted">
            No route assertions. A route asserts a gatekeeper took a specific outgoing edge.
          </Text>
        ) : (
          <ul className="flex flex-col gap-2">
            {routes.map((route, index) => (
              <li
                key={index}
                className="grid grid-cols-1 items-end gap-2 rounded-md border border-border p-2 sm:grid-cols-[1fr_1fr_1fr_auto]"
              >
                <SelectField
                  id={`route-skill-${index}`}
                  label="Skill"
                  value={route.skillId}
                  placeholder="Pick a skill…"
                  options={skillOptions}
                  onChange={(skillId) =>
                    patchRoute(index, { skillId, gatekeeperId: "", expectedEdgeId: "" })
                  }
                />
                <SelectField
                  id={`route-gate-${index}`}
                  label="Gatekeeper"
                  value={route.gatekeeperId}
                  placeholder={route.skillId ? "Pick a gatekeeper…" : "Pick a skill first…"}
                  options={nodeOptions(route.skillId, true)}
                  disabled={!route.skillId}
                  onChange={(gatekeeperId) =>
                    patchRoute(index, { gatekeeperId, expectedEdgeId: "" })
                  }
                />
                <SelectField
                  id={`route-edge-${index}`}
                  label="Expected edge"
                  value={route.expectedEdgeId}
                  placeholder={route.gatekeeperId ? "Pick an edge…" : "Pick a gatekeeper first…"}
                  options={edgeOptions(route.skillId, route.gatekeeperId)}
                  disabled={!route.gatekeeperId}
                  onChange={(expectedEdgeId) => patchRoute(index, { expectedEdgeId })}
                />
                <IconButton
                  type="button"
                  variant="ghost"
                  size="icon"
                  label={`Remove route ${index + 1}`}
                  onClick={() => removeRoute(index)}
                >
                  <X aria-hidden />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
