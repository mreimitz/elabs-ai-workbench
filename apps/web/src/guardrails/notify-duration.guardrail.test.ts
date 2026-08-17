/**
 * notify-duration.guardrail.test.ts — interface-craft WP 4.1 guardrail (D-IC7).
 *
 * The CI guardrail that keeps `notifyError` from ever letting a FINITE duration reach `toast.error`.
 * An error toast must stay on screen until the operator dismisses it — a 4-second error is unreadable
 * for many users and unreachable by keyboard. `notifyError` is the single choke point; this guardrail
 * proves the choke point holds even when a caller tries to sneak a finite `duration` through.
 *
 * Additive to `apps/web/src/lib/notify.test.ts` (the WP 3.1 phase deliverable this WP may not edit).
 * Paired with the `.claude/hooks/no-bare-toast-error.mjs` static guard, which stops a NEW call site
 * from bypassing `notifyError` entirely by calling `toast.error(` directly.
 */
import { toast } from "@elabs-ai/components-ui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { notifyError } from "../lib/notify";

describe("GUARDRAIL D-IC7 — notifyError never passes a finite duration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("forces duration: Infinity when the caller passes nothing", () => {
    const errorSpy = vi.spyOn(toast, "error").mockImplementation(() => "" as never);
    notifyError("Couldn’t reach the server.");
    const [, opts] = errorSpy.mock.calls[0] ?? [];
    expect(opts?.duration).toBe(Number.POSITIVE_INFINITY);
    expect(Number.isFinite(opts?.duration as number)).toBe(false);
  });

  it("overrides a finite duration a caller tries to supply (Infinity wins, last-applied)", () => {
    const errorSpy = vi.spyOn(toast, "error").mockImplementation(() => "" as never);
    notifyError("Couldn’t save.", { duration: 4000 });
    const [, opts] = errorSpy.mock.calls[0] ?? [];
    expect(opts?.duration).not.toBe(4000);
    expect(Number.isFinite(opts?.duration as number)).toBe(false);
  });

  it("keeps description/action while still forcing an infinite duration", () => {
    const errorSpy = vi.spyOn(toast, "error").mockImplementation(() => "" as never);
    const onClick = vi.fn();
    notifyError("Couldn’t load the run.", {
      description: "network down",
      action: { label: "Retry", onClick },
    });
    const [, opts] = errorSpy.mock.calls[0] ?? [];
    expect(opts).toMatchObject({ description: "network down", action: { label: "Retry", onClick } });
    expect(Number.isFinite(opts?.duration as number)).toBe(false);
  });
});
