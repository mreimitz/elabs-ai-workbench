import { describe, expect, test } from "vitest";
import { getErrorMessage, humanizeErrorMessage, isNetworkFetchFailure } from "./errors";

// T7 — the browser's `fetch()` rejects a network-layer failure as an opaque `TypeError` ("Failed to
// fetch" / "Load failed" / "NetworkError…") that tells an operator nothing. `getErrorMessage` now
// maps those to one actionable line; every other message passes through verbatim.
describe("getErrorMessage / humanizeErrorMessage (T7)", () => {
  test("maps the browser's opaque 'Failed to fetch' TypeError to an actionable message", () => {
    const message = getErrorMessage(new TypeError("Failed to fetch"));
    expect(message).toMatch(/couldn.t reach the server/i);
    expect(message).not.toMatch(/failed to fetch/i);
  });

  test("maps WebKit 'Load failed', undici 'fetch failed', and Firefox NetworkError too", () => {
    for (const raw of [
      "Load failed",
      "fetch failed",
      "NetworkError when attempting to fetch resource.",
    ]) {
      expect(isNetworkFetchFailure(raw)).toBe(true);
      expect(humanizeErrorMessage(raw)).toMatch(/couldn.t reach the server/i);
    }
  });

  test("a real error message passes through verbatim", () => {
    expect(getErrorMessage(new Error("Server responded 500"))).toBe("Server responded 500");
    expect(isNetworkFetchFailure("Server responded 500")).toBe(false);
  });

  test("a non-Error value uses the fallback", () => {
    expect(getErrorMessage("boom", "Custom fallback")).toBe("Custom fallback");
    expect(getErrorMessage(undefined)).toBe("Unknown error");
  });
});
