import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { RUN_OUTCOMES, RUN_STATUSES } from "@mcp-token-footprint/shared";
import { CountBadge, StatusBadge } from "./StatusBadge";
import { type StatusView, countChipTone, deriveStatusView } from "../lib/status";

// Behaviour lock for the app-wide status vocabulary (audit §S3, conventions §3). If the table drifts
// these break — that is the point: one concept, one rendering, forever.

function asChip(v: StatusView) {
  if (v.kind !== "chip") throw new Error(`expected chip, got ${v.kind}`);
  return v;
}

describe("deriveStatusView — the full conventions §3 table", () => {
  test("success / completed / complete / ok → Completed, green outline (no spinner)", () => {
    for (const raw of ["success", "completed", "complete", "ok", "Completed", "OK"]) {
      const v = asChip(deriveStatusView(raw));
      expect(v).toMatchObject({
        label: "Completed",
        tone: "success",
        spinner: false,
        dashed: false,
      });
    }
  });

  test("failed / error → Failed, red filled", () => {
    for (const raw of ["failed", "error", "Failed", "Error"]) {
      expect(asChip(deriveStatusView(raw))).toMatchObject({ label: "Failed", tone: "danger" });
    }
  });

  test("aborted → Aborted, gray outline", () => {
    expect(asChip(deriveStatusView("aborted"))).toMatchObject({
      label: "Aborted",
      tone: "neutral",
      dashed: false,
    });
  });

  test("stopped_guardrail → Stopped (guardrail), amber outline (exact label)", () => {
    expect(asChip(deriveStatusView("stopped_guardrail"))).toMatchObject({
      label: "Stopped (guardrail)",
      tone: "warning",
    });
  });

  test("running / streaming → Running, blue outline + spinner", () => {
    for (const raw of ["running", "streaming"]) {
      expect(asChip(deriveStatusView(raw))).toMatchObject({
        label: "Running",
        tone: "info",
        spinner: true,
      });
    }
  });

  test("reviewing → Reviewing…, blue outline + spinner (AR11 — terminal run, unsettled rating)", () => {
    expect(asChip(deriveStatusView("reviewing"))).toMatchObject({
      label: "Reviewing…",
      tone: "info",
      spinner: true,
      dashed: false,
    });
  });

  test("unscanned / pending → Pending, gray dashed", () => {
    for (const raw of ["unscanned", "pending"]) {
      expect(asChip(deriveStatusView(raw))).toMatchObject({
        label: "Pending",
        tone: "pending",
        dashed: true,
      });
    }
  });

  test("N/A family → plain text, NO chip", () => {
    for (const raw of ["na", "n/a", "N/A", "none", "", "   "]) {
      expect(deriveStatusView(raw)).toEqual({ kind: "none", label: "—" });
    }
    expect(deriveStatusView(null)).toEqual({ kind: "none", label: "—" });
    expect(deriveStatusView(undefined)).toEqual({ kind: "none", label: "—" });
  });
});

describe("deriveStatusView — DEFENSIVE unknown-value fallback (no crash, never undefined)", () => {
  test("an unknown/malformed value returns a neutral gray chip, sentence-cased", () => {
    const v = asChip(deriveStatusView("totally_bogus_value"));
    expect(v.tone).toBe("neutral");
    expect(v.label).toBe("Totally bogus value"); // humanized — no raw snake_case leaks
    expect(v.spinner).toBe(false);
  });

  test("weird inputs never throw and always return a defined view", () => {
    for (const raw of ["???", "  Stopped  ", "CONTEXT_OVERFLOW", "assertions_failed", "🙂"]) {
      const v = deriveStatusView(raw);
      expect(v).toBeDefined();
      expect(v.kind === "chip" || v.kind === "none").toBe(true);
    }
  });

  test("every shipped RUN_STATUS / RUN_OUTCOME / scan status maps to a defined, non-undefined view", () => {
    for (const raw of [...RUN_STATUSES, ...RUN_OUTCOMES, "success", "failed", "running"]) {
      const v = deriveStatusView(raw);
      expect(v).toBeDefined();
      if (v.kind === "chip") expect(v.label.length).toBeGreaterThan(0);
    }
  });
});

describe("countChipTone — value-aware colouring (zero = neutral)", () => {
  test("zero collapses to neutral regardless of requested tone", () => {
    expect(countChipTone(0, "danger")).toBe("neutral");
    expect(countChipTone(0, "success")).toBe("neutral");
    expect(countChipTone(0)).toBe("neutral");
  });

  test("non-zero keeps its tone", () => {
    expect(countChipTone(3, "danger")).toBe("danger");
    expect(countChipTone(1, "success")).toBe("success");
    expect(countChipTone(7)).toBe("neutral");
  });
});

describe("StatusBadge / CountBadge rendering", () => {
  test("renders the mapped label for a known status", () => {
    render(<StatusBadge status="success" />);
    expect(screen.getByText("Completed")).toBeInTheDocument();
  });

  test("renders the exact stopped_guardrail label", () => {
    render(<StatusBadge status="stopped_guardrail" />);
    expect(screen.getByText("Stopped (guardrail)")).toBeInTheDocument();
  });

  test("N/A renders an em dash and no chip element", () => {
    const { container } = render(<StatusBadge status={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
    // no Badge pill: the tone data-attr the chip branch stamps must be absent
    expect(container.querySelector("[data-status]")).toBeNull();
  });

  test("an unknown status still renders (no crash)", () => {
    render(<StatusBadge status="mystery_state" />);
    expect(screen.getByText("Mystery state")).toBeInTheDocument();
  });

  test("CountBadge renders 0 as neutral", () => {
    const { container } = render(<CountBadge value={0} tone="danger" />);
    expect(container.querySelector('[data-count-tone="neutral"]')).not.toBeNull();
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  test("CountBadge keeps tone for a non-zero value", () => {
    const { container } = render(<CountBadge value={4} tone="danger" />);
    expect(container.querySelector('[data-count-tone="danger"]')).not.toBeNull();
  });

  // Unified Sessions (WP3.1) — `view` lets a caller with a richer derivation (e.g. `lib/status.ts`
  // `deriveRunStatusView`, which needs more than one raw string) bypass `deriveStatusView` entirely.
  // This keeps `StatusBadge` the ONE renderer app-wide instead of a second component reimplementing
  // the same chip markup for the run/session locked table.
  test("a precomputed `view` renders directly, bypassing deriveStatusView", () => {
    render(
      <StatusBadge
        view={{ kind: "chip", label: "Stopped — time limit", tone: "warning", spinner: false, dashed: false }}
      />,
    );
    expect(screen.getByText("Stopped — time limit")).toBeInTheDocument();
  });

  test("`view` takes precedence over `status` when both are given", () => {
    render(
      <StatusBadge
        status="running"
        view={{ kind: "chip", label: "Waiting for you", tone: "info", spinner: false, dashed: false }}
      />,
    );
    expect(screen.getByText("Waiting for you")).toBeInTheDocument();
    expect(screen.queryByText("Running")).toBeNull();
  });

  test("a `view` with spinner renders the spinner glyph", () => {
    const { container } = render(
      <StatusBadge view={{ kind: "chip", label: "Stopping…", tone: "neutral", spinner: true, dashed: false }} />,
    );
    expect(container.querySelector("svg")).not.toBeNull();
  });
});

// D-TB11 (audit D-3): `quiet` is a density variant, not a second component — a dense list (e.g. the
// Dashboard's recent-scan-activity table) still routes success through StatusBadge, it just renders
// as muted text instead of the tone-filled chip. Every other tone stays a chip even when `quiet` is
// set, so a failure/warning/pending row never goes quiet in a dense list.
describe("StatusBadge `quiet` (D-TB11 density variant)", () => {
  test("quiet success renders as muted text with NO chip (D4's dense-list look)", () => {
    const { container } = render(<StatusBadge status="success" quiet />);
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(container.querySelector("[data-status]")).toBeNull();
  });

  test("quiet non-success (failed) still renders the tone-filled chip", () => {
    const { container } = render(<StatusBadge status="failed" quiet />);
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(container.querySelector('[data-status="danger"]')).not.toBeNull();
  });

  test("quiet pending/running/aborted all still render their chip (only success goes quiet)", () => {
    for (const [raw, tone] of [
      ["pending", "pending"],
      ["running", "info"],
      ["aborted", "neutral"],
      ["stopped_guardrail", "warning"],
    ] as const) {
      const { container, unmount } = render(<StatusBadge status={raw} quiet />);
      expect(container.querySelector(`[data-status="${tone}"]`)).not.toBeNull();
      unmount();
    }
  });

  test("quiet has no effect on N/A — still plain text, no chip, unchanged", () => {
    const { container } = render(<StatusBadge status={null} quiet />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(container.querySelector("[data-status]")).toBeNull();
  });

  test("without `quiet`, success still renders as the tone-filled chip (default unchanged)", () => {
    const { container } = render(<StatusBadge status="success" />);
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(container.querySelector('[data-status="success"]')).not.toBeNull();
  });

  test("quiet with a precomputed success `view` also goes quiet", () => {
    const { container } = render(
      <StatusBadge
        quiet
        view={{ kind: "chip", label: "Completed", tone: "success", spinner: false, dashed: false }}
      />,
    );
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(container.querySelector("[data-status]")).toBeNull();
  });
});
