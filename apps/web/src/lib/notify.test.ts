import { toast } from "@brand/ui";
import { afterEach, describe, expect, test, vi } from "vitest";
import { notifyError } from "./notify";

// WP 3.1 (finding 5, D-IC7) — `notifyError` is the single authority for error-toast timing. These
// tests lock the one behavior that matters: it NEVER lets a finite duration reach `toast.error`,
// regardless of what the caller passes (or doesn't).

describe("notifyError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("forces duration: Infinity when the caller passes no options", () => {
    const errorSpy = vi.spyOn(toast, "error").mockImplementation(() => "" as never);

    notifyError("Couldn’t save the thing");

    expect(errorSpy).toHaveBeenCalledWith("Couldn’t save the thing", { duration: Infinity });
  });

  test("forwards description/action while still forcing duration: Infinity", () => {
    const errorSpy = vi.spyOn(toast, "error").mockImplementation(() => "" as never);
    const onClick = vi.fn();

    notifyError("Couldn’t load the thing", {
      description: "network down",
      action: { label: "Retry", onClick },
    });

    expect(errorSpy).toHaveBeenCalledWith("Couldn’t load the thing", {
      description: "network down",
      action: { label: "Retry", onClick },
      duration: Infinity,
    });
  });

  test("never passes a finite duration through — even one the caller supplies is overridden", () => {
    const errorSpy = vi.spyOn(toast, "error").mockImplementation(() => "" as never);

    // Prove the wrapper wins even if a call site tried to sneak a finite duration through.
    notifyError("Couldn’t save the thing", { duration: 4000 });

    const [, passedOptions] = errorSpy.mock.calls[0] ?? [];
    expect(passedOptions).toMatchObject({ duration: Infinity });
    expect(passedOptions?.duration).not.toBe(4000);
  });

  test("returns whatever toast.error returns (the toast id)", () => {
    vi.spyOn(toast, "error").mockReturnValue("toast-id-123");

    expect(notifyError("Couldn’t save the thing")).toBe("toast-id-123");
  });
});
