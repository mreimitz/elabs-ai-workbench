import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { AssistantTimelinePermission } from "./use-assistant-stream";

// `@brand/ai`'s ToolInput pulls in shiki/mermaid — far too heavy for jsdom and irrelevant here. Stub
// it to a plain JSON preview so this test exercises the CARD's own logic (allow/deny, diff, inert
// replay), not the vendored JSON renderer. Same "mock heavy @brand modules" posture as the smoke tests.
vi.mock("@brand/ai", () => ({
  ToolInput: ({ input }: { input: unknown }) => (
    <pre data-testid="tool-input">{JSON.stringify(input)}</pre>
  ),
  // CodeSnippet (the diff preview) is now @brand/ai's CodeBlock — same heavy-module posture (shiki).
  CodeBlock: ({ code }: { code: string }) => <pre>{code}</pre>,
}));

import { AssistantPermissionCard } from "./AssistantPermissionCard";

function pending(
  overrides: Partial<AssistantTimelinePermission> = {},
): AssistantTimelinePermission {
  return {
    id: "req-1",
    toolName: "skills_commit_workspace",
    input: { skillId: "s1" },
    ...overrides,
  };
}

describe("AssistantPermissionCard", () => {
  test("a pending request renders the tool name, arg summary, and Allow/Deny — and fires onDecide", () => {
    const onDecide = vi.fn();
    render(<AssistantPermissionCard permission={pending()} onDecide={onDecide} deciding={false} />);

    expect(screen.getByText("skills_commit_workspace")).toBeInTheDocument();
    expect(screen.getByTestId("tool-input")).toHaveTextContent('{"skillId":"s1"}');

    const allow = screen.getByRole("button", { name: /allow/i });
    const deny = screen.getByRole("button", { name: /deny/i });
    expect(allow).toBeEnabled();
    expect(deny).toBeEnabled();

    fireEvent.click(allow);
    expect(onDecide).toHaveBeenCalledWith("req-1", "allow");

    fireEvent.click(deny);
    expect(onDecide).toHaveBeenCalledWith("req-1", "deny");
  });

  test("a diff preview is shown when the request carries one", () => {
    render(
      <AssistantPermissionCard
        permission={pending({ diffPreview: "- old line\n+ new line" })}
        onDecide={vi.fn()}
        deciding={false}
      />,
    );
    expect(screen.getByText(/old line/)).toBeInTheDocument();
    expect(screen.getByText(/new line/)).toBeInTheDocument();
  });

  test("no diff preview element when the request has none", () => {
    render(<AssistantPermissionCard permission={pending()} onDecide={vi.fn()} deciding={false} />);
    expect(screen.queryByText("Proposed change")).not.toBeInTheDocument();
  });

  test("while the decision POST is in flight both buttons are disabled (no double-send)", () => {
    render(<AssistantPermissionCard permission={pending()} onDecide={vi.fn()} deciding />);
    expect(screen.getByRole("button", { name: /allow/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /deny/i })).toBeDisabled();
  });

  test("a SETTLED allow decision renders inert (no buttons, shows Allowed) — the replayed state", () => {
    render(
      <AssistantPermissionCard
        permission={pending({ decision: { behavior: "allow" } })}
        onDecide={vi.fn()}
        deciding={false}
      />,
    );
    expect(screen.getByText("Allowed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /allow/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /deny/i })).not.toBeInTheDocument();
  });

  test("a SETTLED deny decision renders inert (no buttons, shows Denied)", () => {
    render(
      <AssistantPermissionCard
        permission={pending({ decision: { behavior: "deny" } })}
        onDecide={vi.fn()}
        deciding={false}
      />,
    );
    expect(screen.getByText("Denied")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /allow/i })).not.toBeInTheDocument();
  });

  /**
   * Approval gates are visually neutral (design-remediation T11, P1) — Allow used to render
   * `variant="default"` (solid/primary) next to an `outline` Deny, so "yes" visually dominated the
   * exact moment the system should stay neutral. Both are now `outline`; this locks that neither
   * button carries the primary/solid treatment and that they are equally weighted.
   */
  test("Allow and Deny are visually balanced — neither renders the solid/primary treatment", () => {
    render(<AssistantPermissionCard permission={pending()} onDecide={vi.fn()} deciding={false} />);
    const allow = screen.getByRole("button", { name: /allow/i });
    const deny = screen.getByRole("button", { name: /deny/i });

    // The vendored Button's solid/primary variant paints `bg-primary`; neither gate button may.
    expect(allow.className).not.toMatch(/\bbg-primary\b/);
    expect(deny.className).not.toMatch(/\bbg-primary\b/);
    // Same size + variant, no extra per-button className — their class lists match exactly, proving
    // equal visual weight rather than "close enough".
    expect(allow.className).toBe(deny.className);
  });
});
