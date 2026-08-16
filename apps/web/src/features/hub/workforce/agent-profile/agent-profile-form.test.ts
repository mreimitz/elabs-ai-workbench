import type { HubAgentRole } from "@mcp-token-footprint/shared";
import { describe, expect, test } from "vitest";
import { EMPTY_BUDGETS } from "../../agents/BudgetsFields";
import {
  type AgentProfileFormValue,
  AGENT_SECTION_IDS,
  FIELD_SECTION,
  firstErrorField,
  formFromRole,
  isAgentSectionId,
  isDirty,
  patchFromForm,
  validate,
} from "./agent-profile-form";

function role(overrides: Partial<HubAgentRole> = {}): HubAgentRole {
  return {
    id: "role-1",
    name: "Research Analyst",
    displayName: "Ada",
    description: "Investigates topics",
    icon: "search",
    systemPrompt: "You research topics thoroughly.",
    defaultModel: "claude-sonnet-4-5",
    toolGrants: { servers: { "srv-1": "all" }, builtins: ["files.read"] },
    skills: [
      { skillId: "skill-1", versionMode: "latest", invocationMode: "model_invocable" },
    ] as HubAgentRole["skills"],
    target: "Investigate the assigned topic",
    expectedOutcome: "A structured report",
    budgets: { maxTurns: 8 },
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    archivedAt: null,
    ...overrides,
  };
}

function form(overrides: Partial<AgentProfileFormValue> = {}): AgentProfileFormValue {
  return {
    displayName: "Ada",
    name: "Research Analyst",
    description: "Investigates topics",
    icon: "search",
    systemPrompt: "You research topics thoroughly.",
    defaultModel: "claude-sonnet-4-5",
    providerCredentialId: null,
    toolGrants: { servers: { "srv-1": "all" }, builtins: ["files.read"] },
    skillIds: ["skill-1"],
    target: "Investigate the assigned topic",
    expectedOutcome: "A structured report",
    budgets: EMPTY_BUDGETS,
    ...overrides,
  };
}

describe("agent-profile-form — section identity", () => {
  test("the eight D-HUX6 sections are present, in rail order", () => {
    expect(AGENT_SECTION_IDS).toEqual([
      "profile",
      "instructions",
      "model",
      "access",
      "skills",
      "memory",
      "budgets",
      "usage",
    ]);
  });

  test("isAgentSectionId narrows known ids and rejects the rest", () => {
    expect(isAgentSectionId("access")).toBe(true);
    expect(isAgentSectionId("bogus")).toBe(false);
    expect(isAgentSectionId(null)).toBe(false);
  });
});

describe("agent-profile-form — formFromRole", () => {
  test("maps every editor field, including the D-HUX8 displayName and skill ids", () => {
    const value = formFromRole(role());
    expect(value.displayName).toBe("Ada");
    expect(value.name).toBe("Research Analyst");
    expect(value.skillIds).toEqual(["skill-1"]);
    expect(value.toolGrants).toEqual({ servers: { "srv-1": "all" }, builtins: ["files.read"] });
    expect(value.budgets.maxTurns).toBe(8);
  });

  test("a role with no displayName seeds an empty string (role title is the fallback)", () => {
    const value = formFromRole(role({ displayName: undefined }));
    expect(value.displayName).toBe("");
  });
});

describe("agent-profile-form — validation", () => {
  test("all five required fields flagged when empty", () => {
    const errors = validate(
      form({ name: "", systemPrompt: "", defaultModel: "", target: "", expectedOutcome: "" }),
    );
    expect(Object.keys(errors).sort()).toEqual([
      "defaultModel",
      "expectedOutcome",
      "name",
      "systemPrompt",
      "target",
    ]);
  });

  test("firstErrorField returns the first invalid field in validation order", () => {
    const errors = validate(form({ name: "", systemPrompt: "" }));
    expect(firstErrorField(errors)).toBe("name");
  });

  test("each validated field maps to the section that hosts it (cross-section focus routing)", () => {
    expect(FIELD_SECTION.name).toBe("profile");
    expect(FIELD_SECTION.systemPrompt).toBe("instructions");
    expect(FIELD_SECTION.defaultModel).toBe("model");
    expect(FIELD_SECTION.target).toBe("instructions");
    expect(FIELD_SECTION.expectedOutcome).toBe("instructions");
  });

  test("a valid form has no errors", () => {
    expect(validate(form())).toEqual({});
  });
});

describe("agent-profile-form — patchFromForm (save mapping)", () => {
  test("a cleared displayName/description/icon go over the wire as explicit null, not omitted", () => {
    const patch = patchFromForm(form({ displayName: "  ", description: "", icon: "" }));
    expect(patch.displayName).toBeNull();
    expect(patch.description).toBeNull();
    expect(patch.icon).toBeNull();
  });

  test("a set displayName is trimmed and sent; skills become full attachment inputs", () => {
    const patch = patchFromForm(form({ displayName: "  Ada  ", skillIds: ["s1", "s2"] }));
    expect(patch.displayName).toBe("Ada");
    expect(patch.skills).toEqual([
      { skillId: "s1", versionMode: "latest", invocationMode: "model_invocable" },
      { skillId: "s2", versionMode: "latest", invocationMode: "model_invocable" },
    ]);
  });

  test("no budgets set clears budgets to null (not left unchanged)", () => {
    const patch = patchFromForm(form({ budgets: EMPTY_BUDGETS }));
    expect(patch.budgets).toBeNull();
  });

  test("a budget field set survives to the wire", () => {
    const patch = patchFromForm(form({ budgets: { ...EMPTY_BUDGETS, maxTokens: 5000 } }));
    expect(patch.budgets).toEqual({ maxTokens: 5000 });
  });
});

describe("agent-profile-form — isDirty", () => {
  test("equal values are not dirty; a single changed field is dirty", () => {
    const a = form();
    expect(isDirty(a, form())).toBe(false);
    expect(isDirty(form({ displayName: "Grace" }), a)).toBe(true);
    expect(isDirty(form({ toolGrants: { servers: {}, builtins: [] } }), a)).toBe(true);
  });
});
