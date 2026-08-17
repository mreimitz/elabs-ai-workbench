import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

// REAL cmdk (via @elabs-ai/components-ui's Command*), with only @elabs-ai/components-ai's Dialog chrome stubbed — see the
// module's docblock for why the general-purpose mock cannot answer these questions.
vi.mock("@elabs-ai/components-ai", () => import("./test-support/brand-ai-cmdk-mock"));

import { HubModelPicker } from "./HubModelPicker";
import type { HubModelOption } from "./use-hub-models";

/**
 * The WP-3.1 carry-forward finding, closed against the REAL library (model-identity WP 4.1, D-MI7).
 *
 * WP 3.1 kept `value={model.modelId}` on `ModelSelectorItem` because D-MI7 forbids the credential
 * nanoid in `value` (cmdk fuzzy-scores it). The consequence it flagged: two colliding twins render
 * as two items sharing ONE cmdk `value`, and cmdk's keyboard highlight + Enter resolve the selected
 * item by `querySelector('[cmdk-item][aria-selected="true"]')` — always the FIRST match. The second
 * twin was unreachable without a mouse.
 *
 * `keywords` alone CANNOT fix that: cmdk writes only `value` into `data-value`; keywords feed
 * `commandScore` (filtering) and nothing else. The picker therefore makes `value` unique with the
 * CREDENTIAL LABEL — a human word the operator typed, not the nanoid — which fixes the keyboard
 * without polluting search ranking with an opaque id. `keywords` still does its own job: making a
 * row findable by provider / credential / billing.
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

function openPalette(models: HubModelOption[]) {
  const onChange = vi.fn();
  render(<HubModelPicker models={models} value={null} onChange={onChange} />);
  fireEvent.click(screen.getByRole("button", { name: /^Model:/ }));
  const content = screen.getByTestId("model-selector-content");
  return { onChange, content, palette: within(content), input: within(content).getByRole("combobox") };
}

/** cmdk marks the keyboard-highlighted option with `aria-selected="true"`. */
function highlighted(content: HTMLElement): HTMLElement | null {
  return content.querySelector<HTMLElement>('[cmdk-item=""][aria-selected="true"]');
}

describe("HubModelPicker + real cmdk — colliding twins are independently reachable", () => {
  test("each rendered row carries a DISTINCT cmdk data-value", () => {
    const { content } = openPalette([WORK_SONNET, PERSONAL_SONNET]);
    const values = [...content.querySelectorAll('[cmdk-item=""]')].map((node) =>
      node.getAttribute("data-value"),
    );
    expect(values).toHaveLength(2);
    expect(new Set(values).size).toBe(2);
    // …and neither leaks the credential nanoid into the fuzzy-scored value.
    for (const value of values) {
      expect(value).not.toContain("c-work");
      expect(value).not.toContain("c-personal");
    }
  });

  test("ArrowDown moves the highlight from the first twin to the SECOND (it used to get stuck)", () => {
    const { content, input } = openPalette([WORK_SONNET, PERSONAL_SONNET]);
    const first = highlighted(content);
    expect(first).not.toBeNull();

    fireEvent.keyDown(input, { key: "ArrowDown" });
    const second = highlighted(content);
    expect(second).not.toBeNull();
    // The load-bearing assertion: with one shared `value` these were the SAME element forever.
    expect(second).not.toBe(first);
  });

  test("Enter on the second twin selects ITS credential, not the first one's", () => {
    const { content, input, onChange } = openPalette([WORK_SONNET, PERSONAL_SONNET]);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const target = highlighted(content);
    expect(target?.textContent).toContain("Work key"); // "Personal key" sorts first (deterministic order)

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0]).toEqual(WORK_SONNET);
  });

  test("a twin split across two KINDS is reachable by keyboard too", () => {
    const { content, input, onChange } = openPalette([WORK_SONNET, SUB_SONNET]);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(highlighted(content)?.textContent).toContain("Sonnet");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange.mock.calls[0]?.[0]).toEqual(SUB_SONNET);
  });
});

describe("HubModelPicker + real cmdk — keywords drive the real commandScore filter", () => {
  test("typing a PROVIDER name keeps only that provider's rows", () => {
    const { content, input } = openPalette([WORK_SONNET, SUB_SONNET]);
    fireEvent.change(input, { target: { value: "Anthropic CLI" } });

    const visible = [...content.querySelectorAll('[cmdk-item=""]')].map(
      (node) => node.textContent ?? "",
    );
    expect(visible).toHaveLength(1);
    expect(visible[0]).toContain("Sonnet");
  });

  test("typing a CREDENTIAL label reaches the right twin, then Enter selects it", () => {
    const { content, input, onChange } = openPalette([WORK_SONNET, PERSONAL_SONNET]);
    fireEvent.change(input, { target: { value: "Personal key" } });

    expect(content.querySelectorAll('[cmdk-item=""]')).toHaveLength(1);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange.mock.calls[0]?.[0]).toEqual(PERSONAL_SONNET);
  });

  test("a broken credential's row is aria-disabled, so cmdk's keyboard skips over it", () => {
    const onChange = vi.fn();
    render(
      <HubModelPicker
        models={[WORK_SONNET]}
        value={null}
        onChange={onChange}
        unavailable={[
          {
            credentialId: "c-broken",
            kind: "claude_subscription",
            label: "Expired plan",
            reason: "This credential's authentication is broken — reconnect it in Settings.",
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Model:/ }));
    const content = screen.getByTestId("model-selector-content");

    // Visible (D-MI7: never hidden) …
    const broken = within(content).getByText("Expired plan").closest('[cmdk-item=""]');
    expect(broken).toHaveAttribute("aria-disabled", "true");

    // …but cmdk's navigable set excludes `aria-disabled` items, so Enter can never land on it.
    const input = within(content).getByRole("combobox");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0]).toEqual(WORK_SONNET);
  });
});
