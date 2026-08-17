import { TooltipProvider } from "@elabs-ai/components-ui";
import { act, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

// M3 — the model-column-selection persistence effect called `window.localStorage.setItem(...)`
// unguarded. A throw inside a `useEffect` body propagates out and (absent a boundary) unmounts the
// view via the error boundary. The paired read (`readStoredModels`) was already guarded; this locks
// the matching guard on the write.

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    getCompatibilityModels: vi.fn().mockResolvedValue({ models: [] }),
  };
});

import { CompatibilityView } from "./CompatibilityView";

describe("CompatibilityView — model-selection localStorage guard (M3)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not throw/crash when localStorage.setItem throws while persisting the selection", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    expect(() =>
      render(
        <MemoryRouter>
          <TooltipProvider>
            <CompatibilityView scans={[]} />
          </TooltipProvider>
        </MemoryRouter>,
      ),
    ).not.toThrow();

    // Let the (mocked) getCompatibilityModels() effect's promise settle inside act() so the resulting
    // state update doesn't escape it (would otherwise print an "not wrapped in act" warning).
    await act(async () => {
      await Promise.resolve();
    });
  });
});
