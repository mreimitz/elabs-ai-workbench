import { describe, expect, test } from "vitest";
import {
  buildHubModelGroups,
  defaultHubModelOption,
  hubModelKeywords,
  hubModelTriggerLabel,
  sortHubModelIssues,
} from "./hub-model-picker";
import type { HubModelOption } from "./use-hub-models";

/**
 * `HubModelPicker`'s pure data layer (D-MI7, model-identity WP 4.1). These lock the two properties
 * the palette's correctness rests on: a deterministic grouping/order that does NOT depend on the
 * credential list's `updated_at DESC` arrival order, and a row identity (`value` + `keywords`) that
 * makes two colliding twins independently findable without ever carrying the credential nanoid.
 */

const SUB_SONNET: HubModelOption = {
  modelId: "claude-sonnet-5",
  kind: "claude_subscription",
  credentialId: "c-sub",
  credentialLabel: "My Max plan",
  displayName: "Sonnet",
};
const API_SONNET: HubModelOption = {
  modelId: "claude-sonnet-5",
  kind: "anthropic",
  credentialId: "c-api",
  credentialLabel: "Work key",
  displayName: "Claude Sonnet 5",
};
const GPT: HubModelOption = {
  modelId: "gpt-5",
  kind: "openai",
  credentialId: "c-openai",
  credentialLabel: "OpenAI",
};

describe("buildHubModelGroups — grouping", () => {
  test("one credential per kind ⇒ one group PER KIND, headed by the registry label", () => {
    const groups = buildHubModelGroups([API_SONNET, GPT, SUB_SONNET]);
    expect(groups.map((g) => g.heading)).toEqual(["Anthropic", "OpenAI", "Anthropic CLI"]);
    // D-MI5/D-MI6 — the subscription reads "Anthropic CLI", from the ONE shared registry.
    expect(groups.at(-1)?.kind).toBe("claude_subscription");
  });

  test("several credentials of ONE kind ⇒ a group PER CREDENTIAL, named by its label", () => {
    const work = { ...API_SONNET, credentialId: "c-work", credentialLabel: "Work key" };
    const personal = {
      ...API_SONNET,
      credentialId: "c-personal",
      credentialLabel: "Personal key",
    };
    const groups = buildHubModelGroups([work, personal]);
    expect(groups.map((g) => g.heading)).toEqual([
      "Anthropic · Personal key",
      "Anthropic · Work key",
    ]);
  });

  test("the credential chip appears ONLY when its kind has more than one credential (D-MI7)", () => {
    const single = buildHubModelGroups([API_SONNET, SUB_SONNET]);
    expect(single.flatMap((g) => g.rows).every((row) => row.credentialLabel === undefined)).toBe(
      true,
    );

    const twoOfAKind = buildHubModelGroups([
      API_SONNET,
      { ...API_SONNET, credentialId: "c-2", credentialLabel: "Second key" },
    ]);
    expect(twoOfAKind.flatMap((g) => g.rows).map((row) => row.credentialLabel)).toEqual([
      "Second key",
      "Work key",
    ]);
  });

  test("a row with no credentialLabel falls back to its kind's label rather than rendering blank", () => {
    const groups = buildHubModelGroups([
      { modelId: "a", kind: "anthropic", credentialId: "c1" },
      { modelId: "b", kind: "anthropic", credentialId: "c2" },
    ]);
    expect(groups.map((g) => g.heading)).toEqual(["Anthropic · Anthropic", "Anthropic · Anthropic"]);
  });
});

describe("buildHubModelGroups — deterministic order (never `updated_at DESC`)", () => {
  test("group order is identical for every permutation of the roster", () => {
    const rosters = [
      [API_SONNET, GPT, SUB_SONNET],
      [SUB_SONNET, API_SONNET, GPT],
      [GPT, SUB_SONNET, API_SONNET],
    ];
    const headings = rosters.map((roster) =>
      buildHubModelGroups(roster).map((group) => group.heading),
    );
    expect(headings[1]).toEqual(headings[0]);
    expect(headings[2]).toEqual(headings[0]);
  });

  test("same-kind credentials sort by LABEL, not by arrival order", () => {
    const zebra = { ...API_SONNET, credentialId: "c-z", credentialLabel: "Zebra" };
    const alpha = { ...API_SONNET, credentialId: "c-a", credentialLabel: "Alpha" };
    expect(buildHubModelGroups([zebra, alpha]).map((g) => g.heading)).toEqual([
      "Anthropic · Alpha",
      "Anthropic · Zebra",
    ]);
    expect(buildHubModelGroups([alpha, zebra]).map((g) => g.heading)).toEqual([
      "Anthropic · Alpha",
      "Anthropic · Zebra",
    ]);
  });

  test("two identically-labelled credentials of one kind still get a total, stable order", () => {
    const a = { ...API_SONNET, credentialId: "c-a", credentialLabel: "Key" };
    const b = { ...API_SONNET, credentialId: "c-b", credentialLabel: "Key" };
    expect(buildHubModelGroups([b, a]).map((g) => g.id)).toEqual([
      "credential:c-a",
      "credential:c-b",
    ]);
  });

  test("defaultHubModelOption is the deterministic first row, not `models[0]`", () => {
    // `models[0]` here is the OpenAI row (it arrived first, as the most recently edited credential
    // would); the deterministic default is the Anthropic one.
    expect(defaultHubModelOption([GPT, API_SONNET])?.credentialId).toBe("c-api");
    expect(defaultHubModelOption([API_SONNET, GPT])?.credentialId).toBe("c-api");
    expect(defaultHubModelOption([])).toBeUndefined();
  });
});

describe("row identity — cmdk `value` + `keywords` (D-MI7)", () => {
  test("colliding twins get DIFFERENT values, so cmdk's keyboard can reach both", () => {
    const rows = buildHubModelGroups([API_SONNET, SUB_SONNET]).flatMap((g) => g.rows);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.value).not.toBe(rows[1]?.value);
  });

  test("two credentials of one kind sharing a model id AND a display name still differ", () => {
    const rows = buildHubModelGroups([
      { ...API_SONNET, credentialId: "c-1", credentialLabel: "Work key" },
      { ...API_SONNET, credentialId: "c-2", credentialLabel: "Personal key" },
    ]).flatMap((g) => g.rows);
    expect(new Set(rows.map((row) => row.value)).size).toBe(2);
  });

  test("even two credentials with the SAME label are disambiguated — by an ordinal, not a nanoid", () => {
    const rows = buildHubModelGroups([
      { ...API_SONNET, credentialId: "c-1", credentialLabel: "Key" },
      { ...API_SONNET, credentialId: "c-2", credentialLabel: "Key" },
    ]).flatMap((g) => g.rows);
    expect(new Set(rows.map((row) => row.value)).size).toBe(2);
    expect(rows[1]?.value).toMatch(/\(2\)$/);
  });

  test("the credential NANOID never reaches `value` or `keywords` (cmdk fuzzy-scores both)", () => {
    const rows = buildHubModelGroups([
      API_SONNET,
      SUB_SONNET,
      { ...API_SONNET, credentialId: "c-second", credentialLabel: "Second" },
    ]).flatMap((g) => g.rows);
    for (const row of rows) {
      const haystack = [row.value, ...row.keywords].join(" ");
      expect(haystack).not.toContain(row.option.credentialId);
      // ...and the local composite key is not in there either.
      expect(haystack).not.toContain("::");
    }
  });

  test("keywords make a row findable by provider, credential and billing basis", () => {
    const keywords = hubModelKeywords(SUB_SONNET, "My Max plan");
    expect(keywords).toContain("Anthropic CLI"); // D-MI5 label
    expect(keywords).toContain("My Max plan"); // the credential
    expect(keywords).toContain("Subscription"); // the billing basis
    expect(keywords).toContain("claude_subscription"); // the raw wire kind
    expect(keywords).toContain("claude-sonnet-5");
  });

  test("keywords are de-duplicated and never blank", () => {
    const keywords = hubModelKeywords({ modelId: "", kind: "openai", credentialId: "c" }, "OpenAI");
    expect(keywords).toEqual([...new Set(keywords)]);
    expect(keywords.every((term) => term.trim() !== "")).toBe(true);
  });
});

describe("row presentation", () => {
  test("the billing badge comes from the registry, per kind", () => {
    const rows = buildHubModelGroups([API_SONNET, SUB_SONNET, GPT]).flatMap((g) => g.rows);
    expect(rows.find((r) => r.option.kind === "anthropic")?.billingLabel).toBe("Metered");
    expect(rows.find((r) => r.option.kind === "claude_subscription")?.billingLabel).toBe(
      "Subscription",
    );
  });

  test("displayName falls back to the raw id, and the id line is dropped when they are equal", () => {
    const [row] = buildHubModelGroups([GPT]).flatMap((g) => g.rows);
    expect(row?.displayName).toBe("gpt-5");
    expect(row?.modelId).toBe("gpt-5");
  });

  test("hubModelTriggerLabel names the model AND its raw id when they differ", () => {
    expect(hubModelTriggerLabel(SUB_SONNET)).toBe("Sonnet (claude-sonnet-5)");
    expect(hubModelTriggerLabel(GPT)).toBe("gpt-5");
  });
});

describe("sortHubModelIssues", () => {
  test("unavailable credentials share the groups' deterministic order", () => {
    const issues = [
      { credentialId: "c2", kind: "openai" as const, label: "B", reason: "x" },
      { credentialId: "c1", kind: "anthropic" as const, label: "A", reason: "y" },
    ];
    expect(sortHubModelIssues(issues).map((i) => i.credentialId)).toEqual(["c1", "c2"]);
    expect(sortHubModelIssues([...issues].reverse()).map((i) => i.credentialId)).toEqual([
      "c1",
      "c2",
    ]);
  });
});
