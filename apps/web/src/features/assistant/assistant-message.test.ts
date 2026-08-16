import { describe, expect, test } from "vitest";
import { assistantMessageCopyText, parseAssistantMessage } from "./assistant-message";

// Assistant gen-UI — the pure parser for the `followups` / `metrics` structured blocks the system
// prompt teaches the model to emit. Pure unit tests, no DOM.

describe("parseAssistantMessage — followups", () => {
  test("extracts a JSON-array followups fence and strips it from the prose", () => {
    const text = 'The run cost $0.31.\n\n```followups\n["Compare with the previous run", "Show the token breakdown"]\n```';
    const parsed = parseAssistantMessage(text, false);
    expect(parsed.followups).toEqual(["Compare with the previous run", "Show the token breakdown"]);
    expect(parsed.segments).toHaveLength(1);
    expect(parsed.segments[0]).toMatchObject({ kind: "markdown", text: "The run cost $0.31." });
  });

  test("tolerates a bulleted plain-line body instead of JSON", () => {
    const text = "Done.\n\n```followups\n- Compare with run 12\n- Why did turn 3 fail?\n```";
    const parsed = parseAssistantMessage(text, false);
    expect(parsed.followups).toEqual(["Compare with run 12", "Why did turn 3 fail?"]);
  });

  test("caps at 3, dedupes, and drops empty entries", () => {
    const text = '```followups\n["A", "A", "B", "", "C", "D"]\n```';
    const parsed = parseAssistantMessage(text, false);
    expect(parsed.followups).toEqual(["A", "B", "C"]);
    expect(parsed.segments).toHaveLength(0);
  });

  test("an UNTERMINATED followups fence mid-stream is swallowed silently (never raw JSON flash)", () => {
    const text = 'Answer first.\n\n```followups\n["Compa';
    const parsed = parseAssistantMessage(text, true);
    expect(parsed.followups).toEqual([]);
    expect(parsed.segments).toHaveLength(1);
    expect(parsed.segments[0]).toMatchObject({ text: "Answer first." });
  });

  test("an unterminated fence on a SETTLED turn stays visible as plain markdown (fail open)", () => {
    const text = 'Answer.\n```followups\n["lost"';
    const parsed = parseAssistantMessage(text, false);
    const joined = parsed.segments.map((s) => (s.kind === "markdown" ? s.text : "")).join("\n");
    expect(joined).toContain('["lost"');
  });

  test("a ```followups line INSIDE an ordinary code fence is NOT a structured block", () => {
    const text = "```\n```followups\n[\"not real\"]\n```\nafter";
    const parsed = parseAssistantMessage(text, false);
    expect(parsed.followups).toEqual([]);
  });
});

describe("parseAssistantMessage — metrics", () => {
  test("parses a metrics fence into a metrics segment between markdown segments", () => {
    const text =
      'Headline numbers:\n\n```metrics\n[{"label":"Tokens","value":"266,305"},{"label":"Cost","value":"$0.31","delta":"−14%"}]\n```\n\nDetail below.';
    const parsed = parseAssistantMessage(text, false);
    expect(parsed.segments.map((s) => s.kind)).toEqual(["markdown", "metrics", "markdown"]);
    const metrics = parsed.segments[1];
    if (metrics?.kind !== "metrics") throw new Error("expected metrics segment");
    expect(metrics.metrics).toHaveLength(2);
    expect(metrics.metrics[1]).toMatchObject({ label: "Cost", value: "$0.31", delta: "−14%", deltaDirection: "down" });
  });

  test("derives deltaDirection from the sign; an explicit direction wins", () => {
    const text =
      '```metrics\n[{"label":"A","value":"1","delta":"+5%"},{"label":"B","value":"2","delta":"-3%","deltaDirection":"neutral"}]\n```';
    const parsed = parseAssistantMessage(text, false);
    const seg = parsed.segments[0];
    if (seg?.kind !== "metrics") throw new Error("expected metrics segment");
    expect(seg.metrics[0]?.deltaDirection).toBe("up");
    expect(seg.metrics[1]?.deltaDirection).toBe("neutral");
  });

  test("numbers are accepted as values; junk rows are skipped; >6 metrics are capped", () => {
    const rows = Array.from({ length: 9 }, (_, n) => `{"label":"M${n}","value":${n}}`).join(",");
    const text = `\`\`\`metrics\n[${rows},{"nope":true}]\n\`\`\``;
    const parsed = parseAssistantMessage(text, false);
    const seg = parsed.segments[0];
    if (seg?.kind !== "metrics") throw new Error("expected metrics segment");
    expect(seg.metrics).toHaveLength(6);
    expect(seg.metrics[0]).toMatchObject({ label: "M0", value: "0" });
  });

  test("an unparseable metrics body fails open as a visible json code block", () => {
    const text = "```metrics\nnot json at all\n```";
    const parsed = parseAssistantMessage(text, false);
    expect(parsed.segments).toHaveLength(1);
    expect(parsed.segments[0]).toMatchObject({ kind: "markdown" });
    const seg = parsed.segments[0];
    if (seg?.kind !== "markdown") throw new Error("expected markdown segment");
    expect(seg.text).toContain("```json");
    expect(seg.text).toContain("not json at all");
  });
});

describe("assistantMessageCopyText", () => {
  test("joins markdown verbatim and metric tiles as label/value lines, without followups", () => {
    const text =
      'Summary.\n\n```metrics\n[{"label":"Cost","value":"$0.31","delta":"−14%"}]\n```\n\n```followups\n["Next?"]\n```';
    const parsed = parseAssistantMessage(text, false);
    expect(assistantMessageCopyText(parsed)).toBe("Summary.\n\nCost: $0.31 (−14%)");
  });
});
