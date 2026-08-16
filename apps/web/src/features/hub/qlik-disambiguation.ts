// Assistant Hub — a precise, client-side detector for the Qlik-Answers "pick an app/assistant"
// disambiguation. When a question could be answered by more than one Qlik app/assistant, the Qlik
// Answers backend (reached through the OpenAI-compatible facade on the hub's AI-SDK path) returns the
// choice list as PLAIN assistant TEXT — there is no tool call for the UI to turn into buttons, and the
// operator otherwise has to re-type the choice by hand. This parser recognizes exactly that prose (a
// tight sentinel, never an ordinary numbered list) so `ConversationPane` can render the choices as
// one-click buttons that submit the picked NAME as the next message — the same thing the operator would
// type. Deliberately hub-only + heuristic; a deeper fix (the facade emitting a structured question) is a
// separate concern in the facade repo.

/** One parsed choice. `name` is the exact text to submit (what the operator would type — the Qlik
 *  backend accepts the name); `detail` is the trailing context shown muted next to it. */
export type QlikDisambiguationChoice = {
  index: number;
  name: string;
  detail?: string;
};

export type QlikDisambiguation = {
  /** The lead-in text before the numbered choices (the question being disambiguated). */
  prompt: string;
  options: QlikDisambiguationChoice[];
};

// The tight sentinel — the exact instruction the Qlik Answers facade emits ("Reply with the number — or
// the name — to choose:"). `[\s\S]*?` spans the "— or the name —" clause; the `i` flag tolerates casing.
// Requiring BOTH "reply with the number" and "to choose" keeps this from firing on an ordinary list.
const SENTINEL = /reply with the number[\s\S]*?to choose/i;

const OPTION_LINE = /^\s*(\d+)\.\s+(.+?)\s*$/;
// The Qlik format separates the choice NAME from its context with a spaced em dash: "Name — context".
const NAME_SEPARATOR = " — ";

/**
 * Parse a Qlik-Answers disambiguation out of an assistant message's text, or return `null` when the
 * text isn't one (the common case — this must be precise). Requires the sentinel AND at least two
 * numbered choices.
 */
export function parseQlikDisambiguation(
  text: string | null | undefined,
): QlikDisambiguation | null {
  if (!text || !SENTINEL.test(text)) return null;
  const lines = text.split(/\r?\n/);
  const options: QlikDisambiguationChoice[] = [];
  let firstOptionLine = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const match = OPTION_LINE.exec(lines[i] ?? "");
    if (!match) continue;
    if (firstOptionLine === -1) firstOptionLine = i;
    const index = Number(match[1]);
    const body = (match[2] ?? "").trim();
    const dash = body.indexOf(NAME_SEPARATOR);
    const name = (dash >= 0 ? body.slice(0, dash) : body).trim();
    if (name.length === 0) continue;
    const detail = dash >= 0 ? body.slice(dash + NAME_SEPARATOR.length).trim() : "";
    options.push({ index, name, ...(detail ? { detail } : {}) });
  }
  if (options.length < 2) return null; // a disambiguation offers at least two choices
  const prompt =
    firstOptionLine > 0 ? lines.slice(0, firstOptionLine).join("\n").trim() : "Choose one to continue:";
  return { prompt: prompt || "Choose one to continue:", options };
}
