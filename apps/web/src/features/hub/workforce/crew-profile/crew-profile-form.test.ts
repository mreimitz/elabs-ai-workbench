import type { HubCrew, HubCrewMember } from "@mcp-token-footprint/shared";
import { HUB_MISSION_MAX_DEPTH } from "@mcp-token-footprint/shared";
import { describe, expect, test } from "vitest";
import {
  crewAncestorDepth,
  crewProfileFormFromCrew,
  crewProfileFormToPatch,
  crewReachable,
  crewSubtreeDepth,
  evaluateCrewNesting,
  memberKind,
  moveMember,
  validateCrewProfileForm,
} from "./crew-profile-form";

function member(agentId: string): HubCrewMember {
  return { agentId };
}

function crewMember(crewId: string): HubCrewMember {
  return { crewId };
}

function makeCrew(id: string, overrides: Partial<HubCrew> = {}): HubCrew {
  return {
    id,
    name: overrides.name ?? id,
    topology: "parallel",
    members: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const BASE_CREW: HubCrew = {
  id: "crew-1",
  name: "Research Team",
  description: "Digs through scan results.",
  color: "chart-2",
  topology: "pipeline",
  members: [member("role-a"), member("role-b")],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("crewProfileFormFromCrew", () => {
  test("maps every crew field, defaulting an absent description/color", () => {
    expect(crewProfileFormFromCrew(BASE_CREW)).toEqual({
      name: "Research Team",
      description: "Digs through scan results.",
      color: "chart-2",
      icon: "",
      topology: "pipeline",
      members: [member("role-a"), member("role-b")],
    });

    const bare = crewProfileFormFromCrew({ ...BASE_CREW, description: undefined, color: undefined });
    expect(bare.description).toBe("");
    expect(bare.color).toBeNull();
    expect(bare.icon).toBe("");
    expect(crewProfileFormFromCrew({ ...BASE_CREW, icon: "lucide:brain" }).icon).toBe("lucide:brain");
  });
});

describe("validateCrewProfileForm", () => {
  const valid = crewProfileFormFromCrew(BASE_CREW);

  test("passes a valid form with no errors", () => {
    expect(validateCrewProfileForm(valid)).toEqual({});
  });

  test("requires a non-blank name", () => {
    expect(validateCrewProfileForm({ ...valid, name: "   " }).name).toBe("Name is required.");
  });

  test("rejects a name past the max length", () => {
    const tooLong = "x".repeat(300);
    expect(validateCrewProfileForm({ ...valid, name: tooLong }).name).toMatch(/or fewer/);
  });

  test("requires at least one member", () => {
    expect(validateCrewProfileForm({ ...valid, members: [] }).members).toBe(
      "Add at least one role.",
    );
  });

  test("without a context, a crewId member passes with no nesting error", () => {
    const withSubCrew = { ...valid, members: [...valid.members, crewMember("some-crew")] };
    expect(validateCrewProfileForm(withSubCrew)).toEqual({});
  });

  test("with a context, rejects a member that would create a crew-nesting cycle", () => {
    // "root" already nests "mid" — nesting "root" itself back into "mid" would close the loop.
    const root = makeCrew("root", { name: "Root Team", members: [crewMember("mid")] });
    const mid = makeCrew("mid", { name: "Mid Team" });
    const form = { ...valid, members: [...valid.members, crewMember("root")] };
    const errors = validateCrewProfileForm(form, { crewId: "mid", crews: [root, mid] });
    expect(errors.members).toBe("“Root Team” would create a circular crew reference — remove it.");
  });

  test("with a context, rejects a member that would breach the max nesting depth", () => {
    const deepCandidate = makeCrew("deep-candidate", {
      name: "Deep Candidate",
      members: [crewMember("deep-child")],
    });
    const deepChild = makeCrew("deep-child", { name: "Deep Child" });
    const host = makeCrew("host", { name: "Host Team" });
    const form = { ...valid, members: [...valid.members, crewMember("deep-candidate")] };
    const errors = validateCrewProfileForm(form, {
      crewId: "host",
      crews: [host, deepCandidate, deepChild],
    });
    expect(errors.members).toBe(
      `“Deep Candidate” exceeds the maximum crew nesting depth (${HUB_MISSION_MAX_DEPTH}).`,
    );
  });

  test("with a context, passes a member that is neither a cycle nor over-depth", () => {
    const host = makeCrew("host", { name: "Host Team" });
    const leaf = makeCrew("leaf", { name: "Leaf Team" });
    const form = { ...valid, members: [...valid.members, crewMember("leaf")] };
    const errors = validateCrewProfileForm(form, { crewId: "host", crews: [host, leaf] });
    expect(errors.members).toBeUndefined();
  });
});

describe("crew nesting graph helpers (WP4.1, D-CN4/D-CN5)", () => {
  test("memberKind distinguishes a role member from a nested-crew member", () => {
    expect(memberKind(member("role-a"))).toBe("agent");
    expect(memberKind(crewMember("crew-a"))).toBe("crew");
  });

  describe("crewReachable", () => {
    test("a crew trivially reaches itself (the direct self-reference case)", () => {
      const leaf = makeCrew("leaf");
      expect(crewReachable([leaf], "leaf", "leaf")).toBe(true);
    });

    test("catches a multi-hop reachability chain (A→B→C)", () => {
      const a = makeCrew("a", { members: [crewMember("b")] });
      const b = makeCrew("b", { members: [crewMember("c")] });
      const c = makeCrew("c");
      expect(crewReachable([a, b, c], "a", "c")).toBe(true);
    });

    test("returns false when there is no path, without looping on an unrelated cycle", () => {
      // "x" <-> "y" is a pre-existing cycle UNRELATED to the "a"/"target" question below.
      const x = makeCrew("x", { members: [crewMember("y")] });
      const y = makeCrew("y", { members: [crewMember("x")] });
      const crews = [x, y];
      expect(crewReachable(crews, "x", "not-in-graph")).toBe(false);
      expect(crewReachable(crews, "y", "not-in-graph")).toBe(false);
    });
  });

  describe("crewSubtreeDepth / crewAncestorDepth — cycle safety", () => {
    test("terminate with a bounded, finite answer against a pre-existing unrelated cycle", () => {
      const x = makeCrew("x", { members: [crewMember("y")] });
      const y = makeCrew("y", { members: [crewMember("x")] });
      const crews = [x, y];
      // Both must return a finite number (never loop/stack-overflow), and stop re-entering a
      // crew already on the CURRENT path — so the reported depth reflects one full pass, not an
      // artificially truncated 0/0.
      expect(crewSubtreeDepth(crews, "x")).toBe(2);
      expect(crewAncestorDepth(crews, "x")).toBe(2);
    });

    test("crewSubtreeDepth is 0 for a leaf crew with no nested members", () => {
      const leaf = makeCrew("leaf");
      expect(crewSubtreeDepth([leaf], "leaf")).toBe(0);
    });

    test("crewAncestorDepth is 0 for a crew nested inside nothing today", () => {
      const root = makeCrew("root");
      expect(crewAncestorDepth([root], "root")).toBe(0);
    });
  });

  describe("evaluateCrewNesting", () => {
    test("flags a direct self-nest as a cycle", () => {
      const solo = makeCrew("solo");
      expect(evaluateCrewNesting([solo], "solo", "solo")).toEqual({ cycle: true, overDepth: false });
    });

    test("flags a multi-hop A→B→C→A cycle (nesting A back into C)", () => {
      const a = makeCrew("a", { members: [crewMember("b")] });
      const b = makeCrew("b", { members: [crewMember("c")] });
      const c = makeCrew("c");
      // Nesting "a" as a new member of "c" would close a→b→c→a.
      expect(evaluateCrewNesting([a, b, c], "c", "a")).toEqual({ cycle: true, overDepth: false });
    });

    test("does not misfire a cycle against a pre-existing unrelated cycle elsewhere in the graph", () => {
      const x = makeCrew("x", { members: [crewMember("y")] });
      const y = makeCrew("y", { members: [crewMember("x")] });
      const host = makeCrew("host");
      const leaf = makeCrew("leaf");
      const crews = [x, y, host, leaf];
      expect(evaluateCrewNesting(crews, "host", "leaf")).toEqual({ cycle: false, overDepth: false });
    });

    test("flags a depth-cap breach: nesting a crew that itself already nests one level deep", () => {
      const host = makeCrew("host");
      const candidate = makeCrew("candidate", { members: [crewMember("candidate-child")] });
      const candidateChild = makeCrew("candidate-child");
      const crews = [host, candidate, candidateChild];
      expect(evaluateCrewNesting(crews, "host", "candidate")).toEqual({
        cycle: false,
        overDepth: true,
      });
    });

    test("allows a leaf candidate into a root host at the default max depth", () => {
      const host = makeCrew("host");
      const leaf = makeCrew("leaf");
      expect(evaluateCrewNesting([host, leaf], "host", "leaf")).toEqual({
        cycle: false,
        overDepth: false,
      });
    });

    test("a host already nested one level deep rejects ANY further candidate (would breach depth)", () => {
      const root = makeCrew("root", { members: [crewMember("host")] });
      const host = makeCrew("host");
      const leaf = makeCrew("leaf");
      const crews = [root, host, leaf];
      expect(evaluateCrewNesting(crews, "host", "leaf")).toEqual({ cycle: false, overDepth: true });
    });

    test("honors an explicit maxDepth override", () => {
      const host = makeCrew("host");
      const leaf = makeCrew("leaf");
      // maxDepth: 1 is the D-CN10 off-switch — even a leaf candidate into a root host is over-depth.
      expect(evaluateCrewNesting([host, leaf], "host", "leaf", 1)).toEqual({
        cycle: false,
        overDepth: true,
      });
    });
  });
});

describe("crewProfileFormToPatch", () => {
  test("trims name, clears an empty description/icon to null, passes color through", () => {
    const patch = crewProfileFormToPatch({
      name: "  Research Team  ",
      description: "   ",
      color: "chart-4",
      icon: "   ",
      topology: "debate",
      members: [member("role-a")],
    });
    expect(patch).toEqual({
      name: "Research Team",
      description: null,
      color: "chart-4",
      icon: null,
      topology: "debate",
      members: [member("role-a")],
    });
  });

  test("a null color explicitly clears the accent on the patch", () => {
    const patch = crewProfileFormToPatch({ ...crewProfileFormFromCrew(BASE_CREW), color: null });
    expect(patch.color).toBeNull();
  });

  test("passes a set icon through and trims it", () => {
    const patch = crewProfileFormToPatch({
      ...crewProfileFormFromCrew(BASE_CREW),
      icon: "  lucide:brain  ",
    });
    expect(patch.icon).toBe("lucide:brain");
  });
});

describe("moveMember", () => {
  const members = [member("a"), member("b"), member("c")];

  test("moves a member up one slot", () => {
    expect(moveMember(members, 1, -1)).toEqual([member("b"), member("a"), member("c")]);
  });

  test("moves a member down one slot", () => {
    expect(moveMember(members, 1, 1)).toEqual([member("a"), member("c"), member("b")]);
  });

  test("moving the first member up is a no-op (returns the SAME reference)", () => {
    expect(moveMember(members, 0, -1)).toBe(members);
  });

  test("moving the last member down is a no-op (returns the SAME reference)", () => {
    expect(moveMember(members, members.length - 1, 1)).toBe(members);
  });

  test("does not mutate the input array", () => {
    const copy = [...members];
    moveMember(members, 1, -1);
    expect(members).toEqual(copy);
  });
});
