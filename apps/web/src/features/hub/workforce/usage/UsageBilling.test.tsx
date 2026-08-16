import type { HubUsageProviderCredentialBucket } from "@mcp-token-footprint/shared";
import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { UsageBilling } from "./UsageBilling";

/**
 * model-identity WP3.3 (D-MI10) — the Usage tab's "Billed to" panel.
 *
 * The headline lock is acceptance item 5: subscription spend renders as **"Anthropic CLI"**, never as
 * "Anthropic". Asserted with an EXACT text match (`{ exact: true }` is testing-library's default for a
 * string matcher, and it matches the full normalized text of an element) — a substring assertion would
 * pass on "Anthropic CLI" and prove nothing.
 */

function bucket(
  over: Partial<HubUsageProviderCredentialBucket> = {},
): HubUsageProviderCredentialBucket {
  return {
    key: "credential:cred_1",
    label: "Work key",
    providerKind: "anthropic",
    credentialId: "cred_1",
    billing: "metered_api_key",
    unpinned: false,
    sessions: 2,
    costUsd: 4,
    tokensIn: 100,
    tokensOut: 40,
    ...over,
  };
}

describe("UsageBilling (model-identity WP3.3, D-MI10)", () => {
  test("a claude_subscription bucket reads 'Anthropic CLI' — never 'Anthropic'", () => {
    render(
      <UsageBilling
        buckets={[
          bucket({
            key: "credential:cred_sub",
            label: "Claude Max",
            providerKind: "claude_subscription",
            credentialId: "cred_sub",
            billing: "subscription",
          }),
        ]}
      />,
    );

    expect(screen.getByText("Claude Max")).toBeInTheDocument();
    expect(screen.getByText("Anthropic CLI")).toBeInTheDocument();
    // The defect this WP fixes: the same spend used to render under the metered Anthropic API name.
    expect(screen.queryByText("Anthropic")).not.toBeInTheDocument();
    expect(screen.getByText("Subscription")).toBeInTheDocument();
  });

  test("two credentials of the SAME kind render as two distinguishable rows", () => {
    render(
      <UsageBilling
        buckets={[
          bucket({ key: "credential:a", label: "Work key", credentialId: "a", costUsd: 6 }),
          bucket({ key: "credential:b", label: "Personal key", credentialId: "b", costUsd: 2 }),
        ]}
      />,
    );

    expect(screen.getByText("Work key")).toBeInTheDocument();
    expect(screen.getByText("Personal key")).toBeInTheDocument();
    // Both are the same kind, so the kind caption appears twice — the credential label is what
    // distinguishes them (the whole point of the per-credential split).
    expect(screen.getAllByText("Anthropic")).toHaveLength(2);
    expect(screen.queryByText("Not pinned")).not.toBeInTheDocument();
  });

  test("an unpinned (heuristic) bucket is marked as inferred, not blended in as a measured one", () => {
    render(
      <UsageBilling
        buckets={[
          bucket({
            key: "unpinned:anthropic",
            label: "Anthropic (not pinned)",
            credentialId: null,
            unpinned: true,
          }),
        ]}
      />,
    );

    expect(screen.getByText("Not pinned")).toBeInTheDocument();
    expect(
      screen.getByText("Anthropic — inferred from the model name; no credential recorded"),
    ).toBeInTheDocument();
  });

  test("an unresolvable provider carries no billing claim", () => {
    render(
      <UsageBilling
        buckets={[
          bucket({
            key: "unpinned:other",
            label: "Other (not pinned)",
            providerKind: null,
            credentialId: null,
            billing: null,
            unpinned: true,
          }),
        ]}
      />,
    );

    expect(screen.getByText("Other (not pinned)")).toBeInTheDocument();
    expect(screen.queryByText("Metered")).not.toBeInTheDocument();
    expect(screen.queryByText("Subscription")).not.toBeInTheDocument();
  });

  test("shows a real empty state rather than a blank table", () => {
    render(<UsageBilling buckets={[]} />);
    expect(screen.getByText("No spend in this window")).toBeInTheDocument();
  });
});
