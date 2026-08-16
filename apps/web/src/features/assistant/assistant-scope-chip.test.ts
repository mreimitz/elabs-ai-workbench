import { describe, expect, test } from "vitest";
import type { AssistantContextEnvelope } from "@mcp-token-footprint/shared";
import { SCOPE_CHIP_READ_ONLY_COPY, scopeChipCopy } from "./assistant-scope-chip";

// WP R1.5 (D-AS23) — pure, no React (mirrors `deriveAssistantEnvelope`'s own test style in
// `assistant-context.test.tsx`).

describe("scopeChipCopy", () => {
  test("an envelope with no entity pin is unscoped -> the D-AS23 read-only copy", () => {
    const envelope: AssistantContextEnvelope = { route: "/dashboard" };
    expect(scopeChipCopy(envelope)).toEqual({ scoped: false, text: SCOPE_CHIP_READ_ONLY_COPY });
  });

  test("a route tab with no entity pin is still unscoped (compare, e.g.)", () => {
    const envelope: AssistantContextEnvelope = { route: "/compare/scans" };
    expect(scopeChipCopy(envelope)).toEqual({ scoped: false, text: SCOPE_CHIP_READ_ONLY_COPY });
  });

  test("`undefined` (no envelope at all) is unscoped", () => {
    expect(scopeChipCopy(undefined)).toEqual({ scoped: false, text: SCOPE_CHIP_READ_ONLY_COPY });
  });

  test.each([
    ["server", "server-1", "Scope: Server server-1"],
    ["skill", "skill-1", "Scope: Skill skill-1"],
    ["scan", "scan-1", "Scope: Scan scan-1"],
    ["collection", "col-1", "Scope: Collection col-1"],
    ["suite_run", "sr-1", "Scope: Suite run sr-1"],
    ["run", "run-1", "Scope: Run run-1"],
    ["test", "test-1", "Scope: Test test-1"],
    ["compare", "cmp-1", "Scope: Compare cmp-1"],
  ] as const)("a %s pin renders %s", (kind, id, expected) => {
    const envelope: AssistantContextEnvelope = { route: "/x", entityKind: kind, entityId: id };
    expect(scopeChipCopy(envelope)).toEqual({ scoped: true, text: expected });
  });

  // The one deliberately-renamed noun: `scenario` is the WIRE kind for what the UI calls
  // "Environment" everywhere else (Testing-IA rename, UI-label-only — see CLAUDE.md §1).
  test("a scenario pin renders the 'Environment' UI label, not the wire name", () => {
    const envelope: AssistantContextEnvelope = {
      route: "/testing/environments",
      entityKind: "scenario",
      entityId: "env-1",
    };
    expect(scopeChipCopy(envelope)).toEqual({ scoped: true, text: "Scope: Environment env-1" });
  });

  // A defensive empty-string id (the frozen wire type technically allows one) is treated as
  // unpinned by `deriveAssistantScope` itself — this just confirms the chip inherits that.
  test("an entityKind with an empty-string entityId is treated as unpinned", () => {
    const envelope: AssistantContextEnvelope = { route: "/x", entityKind: "server", entityId: "" };
    expect(scopeChipCopy(envelope)).toEqual({ scoped: false, text: SCOPE_CHIP_READ_ONLY_COPY });
  });
});
