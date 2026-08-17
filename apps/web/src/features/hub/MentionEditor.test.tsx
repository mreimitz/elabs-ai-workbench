import { createRef } from "react";
import type { HubAgentRole } from "@mcp-token-footprint/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

// The mention popup renders `PromptInputCommand*` from `@elabs-ai/components-ai` — stub the heavy surface (same as the
// other hub component tests).
vi.mock("@elabs-ai/components-ai", () => import("./test-support/brand-ai-mock"));

import {
  MentionEditor,
  detectMentionQuery,
  mentionText,
  resolveActiveOptionId,
  serializeMentionEditor,
  type MentionEditorHandle,
} from "./MentionEditor";

const role = (over: Partial<HubAgentRole> & { id: string; name: string }): HubAgentRole => ({
  systemPrompt: "p",
  defaultModel: "gpt-4o",
  toolGrants: { servers: {}, builtins: [] },
  skills: [],
  target: "t",
  expectedOutcome: "o",
  createdAt: "2026-07-20T00:00:00.000Z",
  updatedAt: "2026-07-20T00:00:00.000Z",
  ...over,
});

describe("detectMentionQuery (pure)", () => {
  test("fires on `@` at start or after whitespace; captures the query + `@` index", () => {
    expect(detectMentionQuery("@")).toEqual({ query: "", atIndex: 0 });
    expect(detectMentionQuery("hi @an")).toEqual({ query: "an", atIndex: 3 });
    expect(detectMentionQuery("see you @")).toEqual({ query: "", atIndex: 8 });
    // The LAST `@` at the caret wins.
    expect(detectMentionQuery("@Bob and @Al")).toEqual({ query: "Al", atIndex: 9 });
  });

  test("does NOT fire mid-word, after a completed mention (space), or in an email", () => {
    expect(detectMentionQuery("email a@b")).toBeNull(); // `@` not preceded by start/whitespace
    expect(detectMentionQuery("hi @an bob")).toBeNull(); // a space ended the mention
    expect(detectMentionQuery("no mention here")).toBeNull();
  });
});

describe("serializeMentionEditor (pure DOM walk)", () => {
  test("renders chips inline as @Name, dedupes ids in document order, keeps text", () => {
    const root = document.createElement("div");
    root.appendChild(document.createTextNode("hey "));
    const chip = (id: string, name: string): HTMLElement => {
      const el = document.createElement("span");
      el.dataset.mentionChip = "true";
      el.dataset.agentId = id;
      el.dataset.agentName = name;
      el.textContent = `@${name}`;
      return el;
    };
    root.appendChild(chip("a1", "Analyst"));
    root.appendChild(document.createTextNode(" and "));
    root.appendChild(chip("a2", "Writer"));
    root.appendChild(document.createTextNode(" plus "));
    root.appendChild(chip("a1", "Analyst")); // duplicate id

    const result = serializeMentionEditor(root);
    expect(result.text).toBe("hey @Analyst and @Writer plus @Analyst");
    expect(result.mentionedAgentIds).toEqual(["a1", "a2"]);
  });

  test("empty editor serializes to empty", () => {
    expect(serializeMentionEditor(document.createElement("div"))).toEqual({
      text: "",
      mentionedAgentIds: [],
    });
  });

  test("emits newlines between block wrappers (multi-paragraph paste)", () => {
    const root = document.createElement("div");
    const p1 = document.createElement("div");
    p1.textContent = "Para one";
    const p2 = document.createElement("div");
    p2.textContent = "Para two";
    root.appendChild(p1);
    root.appendChild(p2);
    expect(serializeMentionEditor(root).text).toBe("Para one\nPara two");
  });
});

test("mentionText prefers displayName over name", () => {
  expect(mentionText({ displayName: "Data Analyst", name: "analyst" })).toBe("@Data Analyst");
  expect(mentionText({ name: "analyst" })).toBe("@analyst");
});

/** Place a collapsed caret at `offset` inside `node` (jsdom supports enough of the Selection API). */
function setCaret(node: Node, offset: number): void {
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

describe("MentionEditor (interaction)", () => {
  test("typing `@query` opens the agent popup; selecting inserts a chip and serialize returns the id", () => {
    const ref = createRef<MentionEditorHandle>();
    const onChange = vi.fn();
    render(
      <MentionEditor
        ref={ref}
        onChange={onChange}
        onSubmit={vi.fn()}
        agentsForTest={[role({ id: "a1", name: "Analyst", description: "Digs into data" })]}
      />,
    );
    const editor = screen.getByTestId("mention-editor");

    // Type "@An" and put the caret at the end, then fire input (as the browser would).
    editor.textContent = "@An";
    setCaret(editor.firstChild as Node, 3);
    fireEvent.input(editor);

    // The popup appears with the matching agent.
    expect(screen.getByTestId("mention-popup")).toBeInTheDocument();
    // The popup row is a real listbox `option` (a11y — the combobox contract), not a bare button.
    const row = screen.getByRole("option", { name: /Analyst/i });
    fireEvent.click(row);

    // A chip was inserted (@Name) and serialize reports the id; the `@An` text is gone.
    const chip = editor.querySelector("[data-mention-chip]") as HTMLElement | null;
    expect(chip).not.toBeNull();
    expect(chip?.dataset.agentId).toBe("a1");
    const serialized = ref.current?.serialize();
    expect(serialized?.mentionedAgentIds).toEqual(["a1"]);
    expect(serialized?.text.trim()).toBe("@Analyst");
    // The popup closed after selection.
    expect(screen.queryByTestId("mention-popup")).not.toBeInTheDocument();
  });

  test("appendText appends WITHOUT dropping an existing mention chip (the voice path)", () => {
    const ref = createRef<MentionEditorHandle>();
    render(
      <MentionEditor
        ref={ref}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        agentsForTest={[role({ id: "a1", name: "Analyst" })]}
      />,
    );
    const editor = screen.getByTestId("mention-editor");
    editor.textContent = "@An";
    setCaret(editor.firstChild as Node, 3);
    fireEvent.input(editor);
    fireEvent.click(screen.getByRole("option", { name: /Analyst/i }));

    ref.current?.appendText("review Q3");
    const serialized = ref.current?.serialize();
    expect(serialized?.mentionedAgentIds).toEqual(["a1"]); // chip + id preserved
    expect(serialized?.text).toContain("review Q3");
  });

  test("Enter with the popup open but NO matches falls through to send (not swallowed)", () => {
    const onSubmit = vi.fn();
    render(
      <MentionEditor
        onChange={vi.fn()}
        onSubmit={onSubmit}
        agentsForTest={[role({ id: "a1", name: "Analyst" })]}
      />,
    );
    const editor = screen.getByTestId("mention-editor");
    editor.textContent = "ping @zzz";
    setCaret(editor.firstChild as Node, "ping @zzz".length);
    fireEvent.input(editor);
    expect(screen.getByTestId("mention-popup")).toBeInTheDocument();
    expect(screen.getByText(/no matching agents/i)).toBeInTheDocument();

    fireEvent.keyDown(editor, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  test("setPlainText replaces content (drops chips) and clear empties it", () => {
    const ref = createRef<MentionEditorHandle>();
    render(<MentionEditor ref={ref} onChange={vi.fn()} onSubmit={vi.fn()} agentsForTest={[]} />);
    ref.current?.setPlainText("/graphify ");
    expect(ref.current?.serialize().text).toBe("/graphify ");
    expect(ref.current?.isEmpty()).toBe(false);
    ref.current?.clear();
    expect(ref.current?.serialize().text).toBe("");
    expect(ref.current?.isEmpty()).toBe(true);
  });

  // Regression guard for the "footer clipped" bug: the InputGroup only grows (and shows its footer +
  // focus ring) when the control carries data-slot=input-group-control and takes a full-width row.
  // (The clipping itself is layout — not observable in jsdom — so this asserts the structural hooks.)
  test("is an InputGroup control: data-slot + full-width wrapper (footer/focus-ring hooks)", () => {
    render(<MentionEditor onChange={vi.fn()} onSubmit={vi.fn()} agentsForTest={[]} />);
    const editor = screen.getByTestId("mention-editor");
    expect(editor).toHaveAttribute("data-slot", "input-group-control");
    expect(editor.parentElement).toHaveClass("w-full");
  });
});

// a11y — the full combobox contract (critique 2026-07-25T20-00-10Z, item 1): the `@` popup used to
// open a 4-option `role=listbox` while the editor reported `aria-expanded/aria-controls/
// aria-activedescendant/aria-autocomplete` all null. `data-testid="mention-editor"` must keep working
// unchanged (a committed focus fix, T3, targets it) — every test above still queries by that testid.
describe("MentionEditor — combobox contract (a11y)", () => {
  test('data-testid="mention-editor" is preserved and the field is a combobox at rest', () => {
    render(<MentionEditor onChange={vi.fn()} onSubmit={vi.fn()} agentsForTest={[]} />);
    const editor = screen.getByTestId("mention-editor");
    expect(editor).toBe(screen.getByRole("combobox", { name: "Message" }));
    expect(editor).toHaveAttribute("aria-autocomplete", "list");
    expect(editor).toHaveAttribute("aria-haspopup", "listbox");
    expect(editor).toHaveAttribute("aria-expanded", "false");
    expect(editor).not.toHaveAttribute("aria-controls");
    expect(editor).not.toHaveAttribute("aria-activedescendant");
  });

  test("opening the @ popup wires aria-expanded/aria-controls, and options are real, ided, selectable listbox options", () => {
    render(
      <MentionEditor
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        agentsForTest={[role({ id: "a1", name: "Analyst" }), role({ id: "a2", name: "Writer" })]}
      />,
    );
    const editor = screen.getByTestId("mention-editor");
    editor.textContent = "@";
    setCaret(editor.firstChild as Node, 1);
    fireEvent.input(editor);

    expect(editor).toHaveAttribute("aria-expanded", "true");
    const listboxId = editor.getAttribute("aria-controls");
    expect(listboxId).toBeTruthy();
    expect(document.getElementById(listboxId!)).toBe(screen.getByTestId("mention-popup"));

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options.every((option) => !!option.id)).toBe(true);

    // The first option is highlighted by default — aria-activedescendant + aria-selected agree.
    expect(editor).toHaveAttribute("aria-activedescendant", options[0]!.id);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(options[1]).toHaveAttribute("aria-selected", "false");
  });

  test("aria-activedescendant follows keyboard highlight movement (ArrowDown), not just hover", () => {
    render(
      <MentionEditor
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        agentsForTest={[role({ id: "a1", name: "Analyst" }), role({ id: "a2", name: "Writer" })]}
      />,
    );
    const editor = screen.getByTestId("mention-editor");
    editor.textContent = "@";
    setCaret(editor.firstChild as Node, 1);
    fireEvent.input(editor);
    const options = screen.getAllByRole("option");

    fireEvent.keyDown(editor, { key: "ArrowDown" });
    expect(editor).toHaveAttribute("aria-activedescendant", options[1]!.id);
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    expect(options[0]).toHaveAttribute("aria-selected", "false");
  });

  test("closing the popup (Escape) clears aria-expanded/aria-controls/aria-activedescendant — no dangling refs", () => {
    render(
      <MentionEditor
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        agentsForTest={[role({ id: "a1", name: "Analyst" })]}
      />,
    );
    const editor = screen.getByTestId("mention-editor");
    editor.textContent = "@An";
    setCaret(editor.firstChild as Node, 3);
    fireEvent.input(editor);
    expect(editor).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(editor, { key: "Escape" });
    expect(editor).toHaveAttribute("aria-expanded", "false");
    expect(editor).not.toHaveAttribute("aria-controls");
    expect(editor).not.toHaveAttribute("aria-activedescendant");
  });

  test("aria-expanded also reflects the parent-owned `/` popup (slashOpen) this same field drives", () => {
    render(<MentionEditor onChange={vi.fn()} onSubmit={vi.fn()} agentsForTest={[]} slashOpen />);
    expect(screen.getByTestId("mention-editor")).toHaveAttribute("aria-expanded", "true");
  });
});

describe("resolveActiveOptionId (pure DOM read)", () => {
  test("resolves the Nth [role=option]'s real id, positionally", () => {
    const container = document.createElement("div");
    container.innerHTML = '<div role="option" id="opt-0">A</div><div role="option" id="opt-1">B</div>';
    expect(resolveActiveOptionId(container, 0)).toBe("opt-0");
    expect(resolveActiveOptionId(container, 1)).toBe("opt-1");
  });

  test("returns undefined (never a dangling id) for a missing container / negative / out-of-range index", () => {
    const container = document.createElement("div");
    container.innerHTML = '<div role="option" id="opt-0">A</div>';
    expect(resolveActiveOptionId(null, 0)).toBeUndefined();
    expect(resolveActiveOptionId(container, -1)).toBeUndefined();
    expect(resolveActiveOptionId(container, 5)).toBeUndefined();
  });
});
