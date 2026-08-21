// ── Calibration set → Markdown (Benchmarks Phase 6, WP 6.1) ─────────────────────────────────────
// The Markdown twin of a {@link CalibrationSet}, following the house pattern (`fleet-report.ts` +
// `fleet-report-markdown.ts`, `digest.ts` + `digest-markdown.ts`): a PURE function over the
// ALREADY-composed JSON, so both export formats are the same document rendered twice and there is
// no second data path to drift.
//
// It renders the grader's score and the human's verdict as SEPARATE COLUMNS, side by side and
// separately headed. It never combines them into a "corrected" figure and never computes an
// agreement rate here — that is WP 6.2's job, and doing it in a renderer would put a trust metric
// somewhere nobody could version (AR6).
//
// The document carries no secrets: it renders only what `CalibrationSet` carries, which is ids,
// grader/judge names, numbers, timestamps and the human's own note.

import type { CalibrationGrade, CalibrationRun, CalibrationSet } from "@mcp-token-footprint/shared";
import { escapeMarkdownTable, escapeText } from "../reports/reports.js";

/** A grade in [0,1] as a whole percent, or an em dash when the grade carries no score. */
function score(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

const VERDICT_LABELS: Record<CalibrationGrade["latestVerdict"], string> = {
  agree: "Agree",
  disagree: "Disagree",
};

export function createCalibrationMarkdown(set: CalibrationSet): string {
  const lines: string[] = [];
  lines.push("# Calibration set", "");
  lines.push(`_Generated ${set.generatedAt}._`, "");
  lines.push(
    "The graded runs a human has passed judgement on. Each row shows the grader's own score",
    "next to the human's verdict on that score — the two are reported separately and are never",
    "combined: human feedback is a calibration signal, never a grade, and it changes no score,",
    "aggregate or metric anywhere in the app.",
    "",
  );

  lines.push("## Totals", "");
  lines.push("| Measure | Value |", "| --- | ---: |");
  lines.push(`| Runs | ${set.totals.runs} |`);
  lines.push(`| Grades with feedback | ${set.totals.gradesWithFeedback} |`);
  lines.push(`| Verdicts recorded | ${set.totals.verdicts} |`);
  lines.push(`| Latest verdict: agree | ${set.totals.agree} |`);
  lines.push(`| Latest verdict: disagree | ${set.totals.disagree} |`);
  lines.push(`| Verdicts carrying a note | ${set.totals.notes} |`);
  lines.push("");

  if (set.gradingVersions.length === 0) {
    lines.push("_No grading versions — the set is empty._", "");
  } else if (set.gradingVersions.length === 1) {
    lines.push(`Grading version: **${set.gradingVersions[0]}**.`, "");
  } else {
    lines.push(
      `**This set spans ${set.gradingVersions.length} grading versions** (${set.gradingVersions.join(", ")}).`,
      "Scores produced under different grading versions are not comparable — do not aggregate them",
      "into one agreement rate without saying so.",
      "",
    );
  }

  lines.push("## Runs", "");
  if (set.runs.length === 0) {
    lines.push(
      "_Empty. No grade has been given a human verdict yet — thumb a grade in the run console's",
      "Grade panel or a suite matrix cell and it will appear here._",
      "",
    );
    return `${lines.join("\n")}\n`;
  }

  for (const run of set.runs) {
    renderRun(lines, run);
  }
  return `${lines.join("\n")}\n`;
}

function renderRun(lines: string[], run: CalibrationRun): void {
  const title = run.testName ?? run.runId;
  lines.push(`### ${escapeText(title)}`, "");
  lines.push(`- Run: \`${run.runId}\` · status **${escapeText(run.status)}**`);
  lines.push(`- Started: ${run.startedAt ?? "—"}`);
  lines.push(
    `- Environment: ${run.scenarioName === null ? "—" : escapeText(run.scenarioName)}` +
      `${run.model === null ? "" : ` · model \`${run.model}\``}`,
  );
  lines.push("");

  lines.push(
    "| Grader | Status | Score | Method | Judge model | Grading v | Human verdict | Verdicts |",
    "| --- | --- | ---: | --- | --- | ---: | --- | ---: |",
  );
  for (const grade of run.grades) {
    lines.push(
      `| ${escapeMarkdownTable(grade.graderId)} | ${escapeMarkdownTable(grade.status)} | ` +
        `${score(grade.score)} | ${escapeMarkdownTable(grade.method)} | ` +
        `${grade.judgeModel === null ? "—" : escapeMarkdownTable(grade.judgeModel)} | ` +
        `${grade.gradingVersion} | ${VERDICT_LABELS[grade.latestVerdict]} | ${grade.feedback.length} |`,
    );
  }
  lines.push("");

  // Notes are the reviewer's own words and the most valuable part of a calibration set — rendered in
  // full, oldest first, with the superseded verdicts kept (the history IS the provenance).
  const withNotes = run.grades.filter((grade) =>
    grade.feedback.some((entry) => entry.note !== undefined),
  );
  if (withNotes.length === 0) return;
  lines.push("#### Notes", "");
  for (const grade of withNotes) {
    for (const entry of grade.feedback) {
      if (entry.note === undefined) continue;
      lines.push(
        `- **${escapeText(grade.graderId)}** · ${VERDICT_LABELS[entry.verdict]} · ${entry.createdAt}`,
      );
      lines.push(`  > ${escapeText(entry.note)}`);
    }
  }
  lines.push("");
}
