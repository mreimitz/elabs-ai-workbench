import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { SkillUsage } from "@mcp-token-footprint/shared";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  StatePanel,
  Text,
} from "@brand/ui";
import { type ColumnDef, DataTable } from "@brand/data";
import { ExternalLink, PlayCircle, Server } from "lucide-react";
import { getSkillUsage } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import { formatDateTime, formatNumber } from "../../lib/format";
import { actionsCol, col } from "../../lib/table";
import { StatusBadge } from "../../components/StatusBadge";
import { runStatusBadgeView } from "../testing/RunBar";
import { RunLauncher, type RunLauncherIntent } from "../testing/run-launcher/RunLauncher";

export type SkillUsageTabProps = {
  skillId: string;
};

/** One run row for the usage runs table (denormalized from `SkillUsage.runs`). */
type UsageRunRow = SkillUsage["runs"][number];

/**
 * Usage tab (owner finding #4) — the dedicated home for where a skill lives in the app: the
 * environments it is attached to and every run that resolved it. Split out of the Overview tab (WP
 * 3.3 seeded the panel there) so Overview leads with the skill's own content (footprint + SKILL.md +
 * frontmatter/security) and usage gets room to list the full run history.
 *
 * Usage is a skill-level projection (not version-scoped), so it loads on `skillId` alone via the
 * read-only `GET /api/skills/:id/usage` route. "Test this skill…" opens the run launcher pre-seeded
 * with the attached environments.
 */
export function SkillUsageTab({ skillId }: SkillUsageTabProps) {
  const [usage, setUsage] = useState<SkillUsage | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [launcherOpen, setLauncherOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setUsage(null);
    setUsageError(null);
    getSkillUsage(skillId)
      .then((loaded) => {
        if (!cancelled) setUsage(loaded);
      })
      .catch((error: unknown) => {
        if (!cancelled) setUsageError(getErrorMessage(error, "Couldn’t load usage"));
      });
    return () => {
      cancelled = true;
    };
  }, [skillId]);

  // The intent that pre-selects every environment this skill is attached to (the user then picks tests).
  const launcherIntent = useMemo<RunLauncherIntent>(
    () => ({
      kind: "environments",
      scenarioIds: usage?.environments.map((env) => env.scenarioId) ?? [],
    }),
    [usage],
  );

  const latestRun = usage?.runs[0];

  const runColumns = useMemo<ColumnDef<UsageRunRow>[]>(
    () => [
      col<UsageRunRow>({
        id: "status",
        header: "Status",
        // NOTE: `SkillUsageRun` is a wire projection that carries no `ratingState`/`stopReasonCode`/
        // `phase` (unlike `RunSummary`), so this surface can't show "Reviewing…" or the guardrail-
        // specific labels (Expired / Stopped — time limit / …) — it renders the locked table's
        // status-only rows (e.g. still correctly distinguishes "Ended" from "Completed").
        value: (run) => {
          const view = runStatusBadgeView(run.status, run.outcome);
          return view.kind === "chip" ? view.label : "—";
        },
        cell: (run) => <StatusBadge view={runStatusBadgeView(run.status, run.outcome)} />,
      }),
      col<UsageRunRow>({
        id: "started",
        header: "Started",
        value: (run) => run.startedAt,
        cell: (run) => <span className="tabular-nums">{formatDateTime(run.startedAt)}</span>,
      }),
      col<UsageRunRow>({
        id: "environment",
        header: "Environment",
        value: (run) => run.scenarioName ?? run.scenarioId,
        cell: (run) => (
          <span className="min-w-0 truncate">{run.scenarioName ?? run.scenarioId}</span>
        ),
      }),
      col<UsageRunRow>({
        id: "version",
        header: "Version",
        value: (run) => run.versionLabel,
        cell: (run) => (
          <Badge variant="secondary" className="font-normal">
            {run.versionLabel}
          </Badge>
        ),
      }),
      actionsCol<UsageRunRow>({
        header: "Open run",
        pin: true,
        cell: (run) => (
          <Button asChild variant="link" size="sm" className="h-auto gap-1.5 px-0">
            <Link to={`/testing/runs/${run.runId}`}>
              <span>View run</span>
              <ExternalLink aria-hidden className="size-3.5 shrink-0" />
            </Link>
          </Button>
        ),
      }),
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>Where this skill is used</CardTitle>
          {usage && usage.environments.length > 0 ? (
            <Button size="sm" onClick={() => setLauncherOpen(true)}>
              <PlayCircle aria-hidden />
              <span>Test this skill…</span>
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {usageError ? (
            <StatePanel
              kind="error"
              title="Couldn’t load usage — refresh the page to try again."
              description={usageError}
            />
          ) : usage === null ? (
            <StatePanel kind="loading" title="Loading usage…" loadingLabel="Loading usage…" />
          ) : usage.environments.length === 0 ? (
            // Honest zero state — never a broken/blank panel — with the path to attach it.
            <div className="flex flex-col items-start gap-3">
              <Text tone="muted" className="text-pretty">
                Not attached to any environment yet. Attach this skill to an environment, then run a
                test to trace how it behaves.
              </Text>
              <Button asChild variant="outline" size="sm">
                <Link to="/testing/environments">
                  <Server aria-hidden /> Attach to an environment
                </Link>
              </Button>
            </div>
          ) : (
            <>
              {/* One-line roll-up: "Used by N environments · last run …". */}
              <Text className="text-pretty tabular-nums">
                Used by{" "}
                <span className="font-medium">{formatNumber(usage.environments.length)}</span>{" "}
                environment{usage.environments.length === 1 ? "" : "s"}
                {latestRun ? (
                  <>
                    {" · "}last run{" "}
                    <span className="font-medium">{formatDateTime(latestRun.startedAt)}</span>
                  </>
                ) : (
                  " · no runs yet"
                )}
              </Text>

              {/* Attached environments — each links to the environments screen where it's attached. */}
              <section aria-label="Attached environments" className="flex flex-col gap-1.5">
                <Text variant="meta" tone="muted">
                  Environments
                </Text>
                <ul className="flex flex-wrap gap-1.5">
                  {usage.environments.map((env) => (
                    <li key={env.scenarioId} className="min-w-0">
                      <Button asChild variant="outline" size="sm" className="max-w-full">
                        <Link to="/testing/environments">
                          <Server aria-hidden className="size-3.5 shrink-0" />
                          <span className="min-w-0 truncate">{env.name}</span>
                          <Badge variant="secondary" className="shrink-0 font-normal">
                            {env.versionMode === "pinned" ? "pinned" : "latest"}
                          </Badge>
                        </Link>
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}
        </CardContent>
      </Card>

      {/* Runs that used this skill — the full run history, each linking to its run console. */}
      <Card>
        <CardHeader>
          <CardTitle>Runs</CardTitle>
        </CardHeader>
        <CardContent>
          {usageError ? (
            <StatePanel
              kind="error"
              title="Couldn’t load runs — refresh the page to try again."
              description={usageError}
            />
          ) : usage === null ? (
            <StatePanel kind="loading" title="Loading runs…" loadingLabel="Loading runs…" />
          ) : (
            <DataTable
              data={usage.runs}
              columns={runColumns}
              initialView={{ sorting: [{ id: "started", desc: true }] }}
              emptyMessage={
                usage.environments.length === 0
                  ? "No runs yet — attach this skill to an environment and run a test."
                  : "No test runs yet — use “Test this skill…” to launch one."
              }
            />
          )}
        </CardContent>
      </Card>

      {/* The run launcher, pre-seeded with this skill's attached environments. */}
      <RunLauncher open={launcherOpen} onOpenChange={setLauncherOpen} intent={launcherIntent} />
    </div>
  );
}
