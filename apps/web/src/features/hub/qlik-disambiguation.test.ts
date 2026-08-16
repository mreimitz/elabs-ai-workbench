import { describe, expect, test } from "vitest";
import { parseQlikDisambiguation } from "./qlik-disambiguation";

// The exact prose the Qlik Answers facade returns when a question maps to more than one app/assistant.
const REAL = `Your question could be answered by more than one app or assistant. Reply with the number — or the name — to choose:

1. Claims Analysis — ZRH - DEMO - ANALYTICS: Indexed Qlik app.
2. Claims Intelligence (assistant) — ZRH - DEMO - ANALYTICS: Indexed Qlik assistant.
3. Sales Analytics (assistant) — HSBC: Indexed Qlik assistant.
4. MCP Sales (assistant) — MCP Demo: Indexed Qlik assistant.`;

describe("parseQlikDisambiguation", () => {
  test("parses the real Qlik disambiguation into clickable choices (name = text before the em dash)", () => {
    const result = parseQlikDisambiguation(REAL);
    expect(result).not.toBeNull();
    expect(result?.options).toHaveLength(4);
    // The NAME is what gets submitted — exactly what the operator would type.
    expect(result?.options.map((o) => o.name)).toEqual([
      "Claims Analysis",
      "Claims Intelligence (assistant)",
      "Sales Analytics (assistant)",
      "MCP Sales (assistant)",
    ]);
    // The context after the em dash becomes the muted detail.
    expect(result?.options[3]?.detail).toBe("MCP Demo: Indexed Qlik assistant.");
    expect(result?.options[0]?.index).toBe(1);
    expect(result?.prompt).toMatch(/more than one app or assistant/);
  });

  test("does NOT fire on an ordinary numbered list (no sentinel)", () => {
    expect(
      parseQlikDisambiguation("Here are the steps:\n1. First do this\n2. Then do that"),
    ).toBeNull();
  });

  test("returns null on empty / non-disambiguation text", () => {
    expect(parseQlikDisambiguation("")).toBeNull();
    expect(parseQlikDisambiguation(null)).toBeNull();
    expect(parseQlikDisambiguation(undefined)).toBeNull();
    expect(parseQlikDisambiguation("A normal assistant answer with no choices.")).toBeNull();
  });

  test("requires at least two choices", () => {
    const oneOnly = "Reply with the number — or the name — to choose:\n\n1. Only Option — the only one.";
    expect(parseQlikDisambiguation(oneOnly)).toBeNull();
  });

  test("falls back to the whole line as the name when there is no em-dash separator", () => {
    const text = "Reply with the number — or the name — to choose:\n\n1. Alpha\n2. Beta";
    const result = parseQlikDisambiguation(text);
    expect(result?.options.map((o) => o.name)).toEqual(["Alpha", "Beta"]);
    expect(result?.options[0]?.detail).toBeUndefined();
  });
});
