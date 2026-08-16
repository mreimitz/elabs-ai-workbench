import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type {
  Scenario,
  Skill,
  SkillVersion,
  Suite,
  SuiteInput,
  Test,
} from "@mcp-token-footprint/shared";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  StatePanel,
  Text,
  toast,
} from "@brand/ui";
import { Layers, Pencil, PlayCircle, Plus, Trash2 } from "lucide-react";
import {
  createSuite,
  deleteSuite,
  listScenarios,
  listSkills,
  listSuites,
  listTests,
  updateSuite,
} from "../../../lib/api";
import { listSkillVersions } from "../../skills/skills-inspector-api";
import { IconButton } from "../../../components/IconButton";
import { getErrorMessage } from "../../../lib/errors";
import { formatCostUsd } from "../../../lib/format";
import { RunLauncher } from "../run-launcher/RunLauncher";
import { SuiteEditor } from "../suites/SuiteEditor";
import { notifyError } from "../../../lib/notify";

/**
 * Suites, scoped to a collection (WP 3.1; made a full manager in D-T7) — the create/edit/delete home for
 * the suites whose `collectionId` points here. Mirrors the shared SuitesView authoring flow (New / Edit /
 * Delete via `SuiteEditor`) but stays scoped to THIS collection: created suites land here, edits keep them
 * here, and the collection reassignment picker is deliberately omitted. Fetches all suites and filters
 * client-side; Run opens the run launcher, Open deep-links to the suite detail. Real empty state (with a
 * "New suite" CTA) for a collection with none.
 */
export function CollectionSuites({ collectionId }: { collectionId: string }) {
  const navigate = useNavigate();
  const [suites, setSuites] = useState<Suite[]>([]);
  const [tests, setTests] = useState<Test[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  // WP 5.1 — registered skills + versions, so the editor's variant pickers can attach/pin/detach. Loaded
  // best-effort (like SuitesView); a registry failure leaves the pickers empty but never blocks authoring.
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillVersions, setSkillVersions] = useState<Map<string, SkillVersion[]>>(new Map());
  const [loading, setLoading] = useState(true);
  // The run launcher (WP 3.3) — a row's "Run" opens it prefilled with that suite.
  const [runSuiteId, setRunSuiteId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Suite | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Suite | null>(null);

  const refresh = useCallback(async (isActive: () => boolean = () => true) => {
    setLoading(true);
    try {
      const [suiteList, testList, scenarioList] = await Promise.all([
        listSuites(),
        listTests(),
        listScenarios(),
      ]);
      if (!isActive()) return;
      setSuites(suiteList);
      setTests(testList);
      setScenarios(scenarioList);

      // Skills registry (WP 5.1) — best-effort so the variant pickers work; a failure just leaves them
      // empty (a non-variant suite is unaffected) and never blocks the suites list.
      try {
        const skillList = await listSkills();
        if (!isActive()) return;
        setSkills(skillList);
        const versionEntries = await Promise.all(
          skillList.map(async (skill) => {
            try {
              return [skill.id, await listSkillVersions(skill.id)] as const;
            } catch {
              return null;
            }
          }),
        );
        if (!isActive()) return;
        setSkillVersions(
          new Map(
            versionEntries.filter(
              (entry): entry is readonly [string, SkillVersion[]] => entry !== null,
            ),
          ),
        );
      } catch {
        if (isActive()) {
          setSkills([]);
          setSkillVersions(new Map());
        }
      }
    } catch (error) {
      if (isActive()) {
        notifyError("Couldn’t load suites.", {
          description: `${getErrorMessage(error)} Try again.`,
        });
      }
    } finally {
      if (isActive()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void refresh(() => active);
    return () => {
      active = false;
    };
  }, [refresh]);

  const scoped = useMemo(
    () => suites.filter((s) => s.collectionId === collectionId),
    [suites, collectionId],
  );

  const openCreate = useCallback(() => {
    setEditing(null);
    setEditorOpen(true);
  }, []);

  const handleEditorOpenChange = useCallback((open: boolean) => {
    setEditorOpen(open);
    if (!open) setEditing(null);
  }, []);

  const handleSubmit = useCallback(
    async (input: SuiteInput) => {
      // Scope to THIS collection: a create lands it here, an edit keeps it here (both pass collectionId,
      // never the reassign picker — that stays on the shared Suites surface).
      if (editing) {
        await updateSuite(editing.id, { ...input, collectionId });
        toast.success("Suite updated");
      } else {
        await createSuite({ ...input, collectionId });
        toast.success("Suite created");
      }
      await refresh();
    },
    [editing, collectionId, refresh],
  );

  const performDelete = useCallback(async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    try {
      await deleteSuite(target.id);
      toast.success("Suite deleted");
      await refresh();
    } catch (error) {
      notifyError("Couldn’t delete the suite.", {
        description: `${getErrorMessage(error)} Try again.`,
      });
    }
  }, [pendingDelete, refresh]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-end">
        <Button size="sm" onClick={openCreate}>
          <Plus aria-hidden />
          <span>New suite</span>
        </Button>
      </div>

      {loading ? (
        <StatePanel kind="loading" title="Loading suites…" loadingLabel="Loading suites…" />
      ) : scoped.length === 0 ? (
        <EmptyState
          icon={<Layers aria-hidden />}
          title="No suites in this collection yet"
          description="A suite bundles ordered tests and an environment set into a repeatable matrix run. Create one to start benchmarking this collection."
          actions={
            <Button onClick={openCreate}>
              <Plus aria-hidden />
              <span>New suite</span>
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {scoped.map((suite) => (
            <li key={suite.id}>
              <SuiteRow
                suite={suite}
                onRun={() => setRunSuiteId(suite.id)}
                onOpen={() => navigate(`/testing/suites/${suite.id}`)}
                onEdit={() => {
                  setEditing(suite);
                  setEditorOpen(true);
                }}
                onDelete={() => setPendingDelete(suite)}
              />
            </li>
          ))}
        </ul>
      )}

      <RunLauncher
        open={runSuiteId !== null}
        onOpenChange={(next) => !next && setRunSuiteId(null)}
        intent={{ kind: "suite", suiteId: runSuiteId ?? "" }}
      />

      <SuiteEditor
        open={editorOpen}
        suite={editing}
        tests={tests}
        scenarios={scenarios}
        skills={skills}
        skillVersions={skillVersions}
        onOpenChange={handleEditorOpenChange}
        onSubmit={handleSubmit}
      />

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {pendingDelete?.name ?? "suite"}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the suite. Suite runs already produced from it are kept. This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button variant="destructive" onClick={() => void performDelete()}>
                Delete suite
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SuiteRow({
  suite,
  onRun,
  onOpen,
  onEdit,
  onDelete,
}: {
  suite: Suite;
  onRun: () => void;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { config } = suite;
  // A variant suite's matrix axis is its variants (each names its own environment), not the default set.
  const variantCount = config.variants?.length ?? 0;
  const axisCount = variantCount > 0 ? variantCount : suite.scenarioIds.length;
  const cells = suite.testIds.length * axisCount * config.repetitions;
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 py-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Text className="min-w-0 truncate font-medium">{suite.name}</Text>
            <Badge variant="secondary" className="tabular-nums">
              {suite.testIds.length} tests
            </Badge>
            {variantCount > 0 ? (
              <Badge variant="secondary" className="tabular-nums">
                {variantCount} variants
              </Badge>
            ) : (
              <Badge variant="secondary" className="tabular-nums">
                {suite.scenarioIds.length} environment{suite.scenarioIds.length === 1 ? "" : "s"}
              </Badge>
            )}
          </div>
          <Text variant="meta" tone="muted" className="tabular-nums">
            {config.repetitions}× reps · {config.maxConcurrency} parallel ·{" "}
            {config.aggregateCostCapUsd
              ? `${formatCostUsd(config.aggregateCostCapUsd)} cap`
              : "no cap"}{" "}
            · {cells} cells
          </Text>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Button size="sm" disabled={cells === 0} onClick={onRun}>
            <PlayCircle aria-hidden />
            <span>Run</span>
          </Button>
          <Button variant="outline" size="sm" onClick={onOpen}>
            Open
          </Button>
          <IconButton variant="ghost" size="sm" label={`Edit ${suite.name}`} onClick={onEdit}>
            <Pencil aria-hidden />
          </IconButton>
          <IconButton variant="ghost" size="sm" label={`Delete ${suite.name}`} onClick={onDelete}>
            <Trash2 aria-hidden />
          </IconButton>
        </div>
      </CardContent>
    </Card>
  );
}
