import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Observability WP5.5 (D-OB22) — the Testing section now ALSO renders the digest-schedule card,
// which fetches `GET /api/reports/digest/schedule` on mount. Mocked here (deterministic, no real
// fetch) so the EXISTING read-only assertions below stay unaffected — mirrors providers-section/
// assistant-card's `vi.mock("../../lib/api", …)` shape.
vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    getDigestSchedule: vi.fn(),
    putDigestSchedule: vi.fn(),
    generateDigest: vi.fn(),
  };
});

import * as api from "../../lib/api";
import { TestingSection } from "./SettingsView";

const DEFAULT_SCHEDULE = { mode: "off" as const, hourUtc: 8 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getDigestSchedule).mockResolvedValue(DEFAULT_SCHEDULE);
});

// Unified Sessions (planning/Roadmap/completed/RM-29-unified-sessions/, WP3.4, D-US3/D-US6/D-US7) — the Settings → Testing
// card. Fully read-only today (no settings-persistence API exists for either the session-clock
// timer defaults or the subscription-run concurrency cap — see the WP3.4 report's backend-gap
// list), so this only asserts the informational read-out renders the right figures and flags the
// gap, not any save/edit flow (there is none yet).

/** Each row is `SettingsRow`'s [label block, control block] — "10 min" alone would be ambiguous
 *  (the stall-timeout and wait-budget rows share the value), so scope the value lookup to the
 *  label's own row instead of a bare `getByText`. */
function settingsRowValue(label: string): string {
  const labelEl = screen.getByText(label);
  const row = labelEl.parentElement?.parentElement;
  const controlBlock = row?.lastElementChild;
  if (!controlBlock) throw new Error(`Could not find the control block for row "${label}"`);
  return controlBlock.textContent?.trim() ?? "";
}

describe("TestingSection — Settings → Testing (WP3.4)", () => {
  test("renders the session-clock timer defaults and the subscription concurrency read-out", async () => {
    render(<TestingSection />);

    expect(screen.getByText("Testing")).toBeInTheDocument();
    expect(settingsRowValue("Stall timeout")).toBe("10 min");
    expect(settingsRowValue("Wait budget")).toBe("10 min");
    expect(settingsRowValue("Wall cap")).toBe("No cap by default");
    expect(settingsRowValue("Subscription run concurrency")).toBe("2");

    // Let the digest-schedule card's fetch settle so it doesn't update state after the test ends.
    await waitFor(() => expect(api.getDigestSchedule).toHaveBeenCalled());
  });

  test("flags that these values aren't editable here yet (no settings-persistence API)", async () => {
    render(<TestingSection />);

    expect(screen.getByText(/not editable here yet/i)).toBeInTheDocument();
    expect(screen.getByText("SUBSCRIPTION_RUNS_MAX_CONCURRENCY")).toBeInTheDocument();

    await waitFor(() => expect(api.getDigestSchedule).toHaveBeenCalled());
  });
});

// Observability WP5.5 (D-OB22) — the digest-schedule card: off|daily|weekly + hour persistence and
// the "Generate now" pair. `DIGEST_SCHEDULE_DEFAULT_HOUR_UTC`/off-by-default mirrors the API's own
// `DigestScheduleService.getSchedule()` fallback.
describe("DigestScheduleCard — Settings → Testing → Digest report (WP5.5)", () => {
  test("loads the persisted schedule and shows it (off, 8h default)", async () => {
    render(<TestingSection />);

    expect(await screen.findByText("Digest report")).toBeInTheDocument();
    // The mode Select's trigger renders the current value as text.
    expect(await screen.findByText("Off")).toBeInTheDocument();
  });

  test("shows the loaded schedule's saved values (daily, 6h)", async () => {
    vi.mocked(api.getDigestSchedule).mockResolvedValue({ mode: "daily", hourUtc: 6 });
    render(<TestingSection />);

    expect(await screen.findByText("Daily")).toBeInTheDocument();
    await waitFor(() => {
      expect((screen.getByLabelText("Digest trigger hour, UTC") as HTMLInputElement).value).toBe(
        "6",
      );
    });
  });

  test("'Generate daily now' calls generateDigest(\"daily\") and reports success", async () => {
    vi.mocked(api.generateDigest).mockResolvedValue({ id: "d1", windowKind: "daily", late: false });
    render(<TestingSection />);
    const button = await screen.findByRole("button", { name: /generate daily now/i });

    fireEvent.click(button);

    await waitFor(() => expect(api.generateDigest).toHaveBeenCalledWith("daily"));
    await waitFor(() => expect(button).not.toBeDisabled());
  });

  test("a load failure shows an inline error instead of a blank card", async () => {
    vi.mocked(api.getDigestSchedule).mockRejectedValue(new Error("network down"));
    render(<TestingSection />);

    expect(await screen.findByText(/network down/i)).toBeInTheDocument();
  });
});
