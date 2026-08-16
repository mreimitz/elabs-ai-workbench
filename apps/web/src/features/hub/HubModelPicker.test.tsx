import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

// The repaired shared stub (model-identity WP 4.1): its `ModelSelectorItem` now filters on
// `value` + `keywords` and honours `disabled`, so search/filter/disabled behaviour is actually
// observable here. Real cmdk keyboard semantics are locked separately in `HubModelPicker.cmdk.test.tsx`.
vi.mock("@brand/ai", () => import("./test-support/brand-ai-mock"));

import { HubModelPicker } from "./HubModelPicker";
import type { HubModelCredentialIssue, HubModelOption } from "./use-hub-models";

/**
 * `HubModelPicker` (D-MI7) — the ONE model picker. These lock the behaviours the owner's defect
 * report turned into requirements: two credentials of the same kind must be distinguishable, a
 * colliding model id must not swallow its twin, the palette must be searchable by provider AND
 * credential, and a broken credential must be visible-but-disabled with a reachable reason.
 */

const WORK_SONNET: HubModelOption = {
  modelId: "claude-sonnet-5",
  kind: "anthropic",
  credentialId: "c-work",
  credentialLabel: "Work key",
  displayName: "Claude Sonnet 5",
};
const PERSONAL_SONNET: HubModelOption = {
  ...WORK_SONNET,
  credentialId: "c-personal",
  credentialLabel: "Personal key",
};
const SUB_SONNET: HubModelOption = {
  modelId: "claude-sonnet-5",
  kind: "claude_subscription",
  credentialId: "c-sub",
  credentialLabel: "My Max plan",
  displayName: "Sonnet",
};
const GPT: HubModelOption = {
  modelId: "gpt-5",
  kind: "openai",
  credentialId: "c-openai",
  credentialLabel: "OpenAI",
};

function openPicker(props: Partial<Parameters<typeof HubModelPicker>[0]> = {}) {
  const onChange = vi.fn();
  render(
    <HubModelPicker
      models={[WORK_SONNET, GPT]}
      value={null}
      onChange={onChange}
      {...props}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /^Model:/ }));
  return { onChange, palette: within(screen.getByTestId("model-selector-content")) };
}

describe("HubModelPicker — two credentials of the same kind", () => {
  test("both render, told apart by their credential label, and each selects its OWN credential", () => {
    const { onChange, palette } = openPicker({ models: [WORK_SONNET, PERSONAL_SONNET] });

    // Two rows for ONE model id, on ONE kind — the case every previous picker collapsed.
    const work = palette.getByRole("button", { name: /Claude Sonnet 5.*Work key/ });
    const personal = palette.getByRole("button", { name: /Claude Sonnet 5.*Personal key/ });
    expect(work).not.toBe(personal);

    fireEvent.click(personal);
    expect(onChange).toHaveBeenCalledWith(PERSONAL_SONNET);
  });

  test("a colliding model id across DIFFERENT kinds keeps both, under their own provider groups", () => {
    const { onChange, palette } = openPicker({ models: [WORK_SONNET, SUB_SONNET] });
    expect(palette.getByText("Anthropic")).toBeInTheDocument();
    // D-MI5 — the subscription reads "Anthropic CLI" here exactly as it does in Settings.
    expect(palette.getByText("Anthropic CLI")).toBeInTheDocument();

    fireEvent.click(palette.getByRole("button", { name: /^Sonnet claude-sonnet-5/ }));
    expect(onChange).toHaveBeenCalledWith(SUB_SONNET);
  });

  test("the credential chip is NOT shown when a kind has only one credential (no noise)", () => {
    const { palette } = openPicker({ models: [WORK_SONNET, GPT] });
    expect(palette.queryByText("Work key")).not.toBeInTheDocument();
    expect(palette.queryByText("OpenAI")).toBeInTheDocument(); // …the GROUP heading, not a chip
  });
});

describe("HubModelPicker — search (the D-MI7 `keywords` fix)", () => {
  function search(palette: ReturnType<typeof within>, query: string) {
    fireEvent.change(palette.getByRole("textbox", { name: /search models/i }), {
      target: { value: query },
    });
  }

  test("by PROVIDER name — the case that matched nothing before, because no keywords were passed", () => {
    const { palette } = openPicker({ models: [WORK_SONNET, GPT] });
    search(palette, "openai");
    expect(palette.getByRole("button", { name: /^gpt-5/ })).toBeVisible();
    expect(palette.queryByRole("button", { name: /^Claude Sonnet 5/ })).not.toBeInTheDocument();
  });

  test("by CREDENTIAL label", () => {
    const { palette } = openPicker({ models: [WORK_SONNET, PERSONAL_SONNET] });
    search(palette, "personal");
    expect(palette.getByRole("button", { name: /Personal key/ })).toBeVisible();
    expect(palette.queryByRole("button", { name: /Work key/ })).not.toBeInTheDocument();
  });

  test("by billing basis, and by the raw wire kind", () => {
    const { palette } = openPicker({ models: [WORK_SONNET, SUB_SONNET] });
    search(palette, "subscription");
    expect(palette.getByRole("button", { name: /^Sonnet/ })).toBeVisible();
    expect(palette.queryByRole("button", { name: /^Claude Sonnet 5/ })).not.toBeInTheDocument();

    search(palette, "claude_subscription");
    expect(palette.getByRole("button", { name: /^Sonnet/ })).toBeVisible();
  });

  test("by model id still works", () => {
    const { palette } = openPicker({ models: [WORK_SONNET, GPT] });
    search(palette, "gpt-5");
    expect(palette.getByRole("button", { name: /^gpt-5/ })).toBeVisible();
  });

  test("no match ⇒ the empty state, not a silently blank list", () => {
    const { palette } = openPicker();
    search(palette, "zzzz-nothing");
    expect(palette.getByText("No models match your search.")).toBeInTheDocument();
  });
});

describe("HubModelPicker — a broken credential is disabled-and-VISIBLE (D-MI7)", () => {
  const BROKEN: HubModelCredentialIssue = {
    credentialId: "c-broken",
    kind: "claude_subscription",
    label: "Expired plan",
    reason: "This credential's authentication is broken — reconnect it in Settings.",
  };

  test("it renders, cannot be selected, and its reason is wired to aria-describedby", () => {
    const { onChange, palette } = openPicker({ unavailable: [BROKEN] });

    const row = palette.getByRole("button", { name: /Expired plan/ });
    // Visible: hiding it is what makes "why did it use the other one?" unanswerable.
    expect(row).toBeVisible();
    expect(row).toBeDisabled();
    expect(row).toHaveAttribute("aria-disabled", "true");

    // The reason reaches assistive tech without a tooltip having to open (icon-affordances posture).
    const describedBy = row.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)?.textContent).toContain(
      "authentication is broken",
    );

    fireEvent.click(row);
    expect(onChange).not.toHaveBeenCalled();
  });

  test("it is listed even when the roster itself is empty — never silently dropped", () => {
    const { palette } = openPicker({ models: [], unavailable: [BROKEN] });
    expect(palette.getByRole("button", { name: /Expired plan/ })).toBeVisible();
  });
});

describe("HubModelPicker — selection, defaults and off-roster values", () => {
  test("the trigger names the picked model (and its raw id when they differ)", () => {
    render(<HubModelPicker models={[SUB_SONNET]} value={SUB_SONNET} onChange={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: "Model: Sonnet (claude-sonnet-5)" }),
    ).toBeInTheDocument();
  });

  test("an off-roster model id stays visible and says so, with NO credential invented for it", () => {
    const { palette } = openPicker({ fallbackModelId: "some-retired-model" });
    expect(palette.getByText("Current selection")).toBeInTheDocument();
    expect(palette.getByText(/no provider is pinned to it/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Model: some-retired-model" }),
    ).toBeInTheDocument();
  });

  test("a clearOption offers an explicit 'use the default' row", () => {
    const onClear = vi.fn();
    const { palette } = openPicker({
      clearOption: { label: "Use this session's default", hint: "claude-sonnet-5", onClear },
    });
    fireEvent.click(palette.getByRole("button", { name: /Use this session's default/ }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  test("an empty roster surfaces an honest message instead of an empty palette", () => {
    const { palette } = openPicker({ models: [] });
    expect(palette.getByText(/no provider credential has a usable model roster/i)).toBeVisible();
  });

  test("group order does not depend on the roster's arrival order (never `updated_at DESC`)", () => {
    const headingsFor = (models: HubModelOption[]) => {
      const { unmount } = render(
        <HubModelPicker models={models} value={null} onChange={vi.fn()} />,
      );
      fireEvent.click(screen.getByRole("button", { name: /^Model:/ }));
      const text = screen.getByTestId("model-selector-content").textContent ?? "";
      const order = ["Anthropic CLI", "Anthropic", "OpenAI"]
        .map((label) => [label, text.indexOf(label)] as const)
        .filter(([, index]) => index >= 0);
      unmount();
      return order.sort((a, b) => a[1] - b[1]).map(([label]) => label);
    };
    expect(headingsFor([SUB_SONNET, GPT, WORK_SONNET])).toEqual(headingsFor([WORK_SONNET, GPT, SUB_SONNET]));
    expect(headingsFor([GPT, SUB_SONNET, WORK_SONNET])).toEqual(headingsFor([WORK_SONNET, GPT, SUB_SONNET]));
  });

  test("a disabled picker cannot be opened", () => {
    render(<HubModelPicker models={[GPT]} value={null} onChange={vi.fn()} disabled />);
    fireEvent.click(screen.getByRole("button", { name: /^Model:/ }));
    expect(screen.queryByTestId("model-selector-content")).not.toBeInTheDocument();
  });
});
