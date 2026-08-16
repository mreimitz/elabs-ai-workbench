import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

// Assistant Hub (roadmap/assistant-hub/, WP4.4) — a tiny, deterministic OpenAI-COMPATIBLE chat
// endpoint that stands in for a real LLM in the e2e smoke walk. The app's `openai_compatible`
// provider kind (`apps/api/src/providers/registry.ts`) just needs a base URL — no real network call
// is ever made, so this in-process HTTP server lets the smoke test drive the REAL hub engine
// (turn-engine's `streamText` tool loop, the mission planner/agent-runner/synthesizer's
// `generateObject`/`generateText` calls) end-to-end with a fully scripted, deterministic model.
//
// Discrimination strategy (no schema is sent on the wire — see below, so we can't just read the
// requested shape off the request): the app's own `@ai-sdk/openai-compatible` provider is
// constructed with no `supportsStructuredOutputs` flag (registry.ts), so the AI SDK falls back to
// `response_format: { type: "json_object" }` with NO embedded JSON schema for ANY `generateObject`
// call (mission planner, agent runner) — see the AI SDK's `getArgs()`: structured outputs only ship
// the schema on the wire when the provider opts in. So instead of reading a schema off the request,
// this server plants a stable MARKER STRING in the text IT authors as each stubbed model turn:
//   - the e2e test's own mission-ask message carries `MISSION_ASK_MARKER` (harmless prose in the
//     user's ask — the planner call's prompt is that exact text);
//   - this server's OWN canned mission plan embeds `AGENT_BRIEF_MARKER` in the one planned agent's
//     `brief` (the orchestrator passes that exact brief back as the agent-runner's prompt).
// A structured-output request whose text carries `AGENT_BRIEF_MARKER` is therefore unambiguously the
// per-agent report call; everything else structured is the mission-plan call. This is robust to the
// prompt-architecture wording changing over time (WP0.3's authored system-prompt text is NOT the
// discriminator) because both markers are authored by the test/this server itself.
//
// hub-fixes WP2.1 (RC2): the SESSION agent runner (the default) no longer produces the per-agent report
// from a single `generateObject` over the brief — it runs the agent as a REAL child turn (a streaming
// `streamText` call that may call a granted MCP tool) and then EXTRACTS the report from the transcript via
// a separate `generateObject` whose system prompt carries `HUB_AGENT_REPORT_EXTRACTION_MARKER`. So a
// structured request carrying EITHER `AGENT_BRIEF_MARKER` (old one-shot runner) OR the extraction marker
// (session runner) is the report call; else it is the mission-plan call. And a streaming turn whose
// `tools` include the read-only `read_echo` tool (`HUB_E2E_READONLY_TOOL_NAME`) is a granted mission
// agent's turn — this server drives it to call that tool so the child log gets a real tool_call/result.
//
// hub-fixes WP3.2 (RC4, D-HF4): the mission SYNTHESIS now runs as a REAL streaming turn of the parent
// session with the GenUI `present` tool granted (default `HUB_SYNTHESIS_MODE=turn`), so it is a
// `streamText` call — NOT the plain `generateText` branch anymore. It is told apart from the other
// streaming turns (chat / mission agent) by the `AGENT_REPORT.summary`'s `HUB_E2E_SYNTHESIS_MARKER`,
// which flows verbatim into the synthesizer's reports digest (buildReportsDigest → the system prompt).
// This server drives that turn to CALL `present` (a valid StatGroup) then answer with the synthesis text,
// so the settled synthesis message carries a rendered-eligible genui part PLUS prose (the WP3.2 target).
// The plain `generateText` branch below is kept for the `HUB_SYNTHESIS_MODE=text` fallback.
//
// Regular (non-structured) turn-engine `streamText` calls are told apart by `body.stream === true`;
// the plain, non-streaming `generateText` call (the `text`-mode mission synthesizer) has neither
// `stream` nor a `response_format` set.

export type HubStubLlmServer = {
  /** The `openai_compatible` provider `baseUrl` to register (`POST /api/providers`). */
  url: string;
  close(): Promise<void>;
};

/** Embedded verbatim in the mission-ask text the e2e test sends — see the module doc above. */
export const HUB_E2E_MISSION_ASK_MARKER = "[[e2e-mission-ask]]";
/** Embedded verbatim in the one planned agent's `brief` this server authors — see the module doc. */
const AGENT_BRIEF_MARKER = "[[e2e-agent-brief]]";
/** hub-fixes WP2.1 (RC2) — the marker the SESSION agent runner plants in its report-EXTRACTION
 *  `generateObject` system prompt (a verbatim copy of `HUB_AGENT_REPORT_EXTRACTION_MARKER` in
 *  `apps/api/src/hub/missions/orchestrator.ts` — kept in sync by this comment). Under the session runner
 *  the per-agent report comes from an extraction call over the child transcript (NOT the agent's own
 *  turn), so this — not `AGENT_BRIEF_MARKER` — is how the structured report call is told from the plan
 *  call (the crew-driven mission e2e has no planner model call at all). */
const HUB_AGENT_REPORT_EXTRACTION_MARKER = "[[hub-agent-report-extraction]]";
/** Embedded verbatim in the chat message the e2e test sends to trigger the `artifacts.create` tool call. */
export const HUB_E2E_ARTIFACT_TRIGGER = "[[e2e-create-artifact]]";
/** hub-fixes WP2.1 — the read-only MCP tool name the `readonly-echo-mcp-server.mjs` fixture exposes; the
 *  mission agent (granted that server) calls it, and this stub calls it back when it sees it in `tools`. */
export const HUB_E2E_READONLY_TOOL_NAME = "read_echo";
/** hub-fixes WP2.1 — planted in the mission-MCP e2e's ASK (→ the granted agent's brief), so this stub
 *  only drives the `read_echo` MCP call for THAT agent's turn. Without this guard the stub would call
 *  `read_echo` on any chat turn where the tool happens to be granted (the auto-scope default grants every
 *  scanned server) — an approval-gated MCP call with no operator, which would hang unrelated chat tests. */
export const HUB_E2E_MCP_AGENT_MARKER = "[[e2e-mcp-agent]]";
/** hub-fixes WP3.2 (RC4, D-HF4) — embedded verbatim in `AGENT_REPORT.summary`, so it flows into the
 *  synthesizer's reports digest (→ the synthesis turn's system prompt). A STREAMING turn whose text
 *  carries this marker is UNAMBIGUOUSLY the mission synthesis (no other model call receives the reports as
 *  input), robust for BOTH the plan-driven and crew-driven mission flows. */
const HUB_E2E_SYNTHESIS_MARKER = "[[e2e-synthesis]]";
/** hub-fixes WP3.2 — the `present` GenUI tool name the granted synthesis turn calls (provider-safe, no
 *  dot, so the hub passes it through unsanitized). */
const HUB_E2E_PRESENT_TOOL_NAME = "present";
/** hub-fixes WP3.2 — a distinctive StatGroup tile label the synthesis `present` widget renders, so the
 *  smoke test can assert the GenUI part actually rendered (via `@brand/ui` MetricCard). */
export const HUB_E2E_SYNTHESIS_STAT_LABEL = "Agents reporting";

// hub-fixes WP6.1 (RC7) — `auto`-mode routing markers. An `auto` session runs a NORMAL chat turn per
// message and the MODEL routes: a trivial ask answers directly (no marker → the default text branch,
// no tool call), a mission-shaped ask calls the `mission.propose_plan` builtin (provider-safe name
// `mission_propose_plan`), and an ambiguous ask calls `prompt_user` (a GenUI clarify card). The
// session-service post-turn bridge turns a `mission.propose_plan` call into a REAL `proposePlan` (the
// planner then returns `MISSION_PLAN` via the structured `else` branch, exactly like mission mode).
const HUB_E2E_AUTO_MISSION_MARKER = "[[e2e-auto-mission]]";
const HUB_E2E_AUTO_AMBIGUOUS_MARKER = "[[e2e-auto-ambiguous]]";
/** The provider-safe form of the internal `mission.propose_plan` builtin (dot → underscore) — the name
 *  the `auto` session's routing turn actually sees in `body.tools` and calls back with. */
const MISSION_PROPOSE_PROVIDER_NAME = "mission_propose_plan";
/** The GenUI `prompt_user` tool name (no dot → passed through unsanitized). */
const HUB_E2E_PROMPT_USER_TOOL_NAME = "prompt_user";

export const HUB_E2E_STUB_MODEL_ID = "stub-model";
export const HUB_E2E_MISSION_ASK = `Investigate the assistant hub's mission flow for this e2e smoke test and report back. ${HUB_E2E_MISSION_ASK_MARKER}`;
/** hub-fixes WP6.1 — a TRIVIAL `auto` ask: no markers, so the stub answers with `HUB_E2E_CHAT_REPLY`
 *  and calls no tool — the routing turn produces a plain answer and the bridge proposes nothing. */
export const HUB_E2E_AUTO_TRIVIAL_ASK = "What is two plus two? Answer in one short sentence.";
/** hub-fixes WP6.1 — a MISSION-SHAPED `auto` ask: drives the routing turn to call `mission.propose_plan`
 *  → the bridge proposes a real plan (`plan_proposed`). */
export const HUB_E2E_AUTO_MISSION_ASK = `Compare three MCP servers across several angles in parallel and reconcile the findings. ${HUB_E2E_AUTO_MISSION_MARKER}`;
/** hub-fixes WP6.1 — an AMBIGUOUS `auto` ask: drives the routing turn to call `prompt_user` (the clarify
 *  card) instead of answering or proposing. */
export const HUB_E2E_AUTO_AMBIGUOUS_ASK = `Look into our data quality — I'm not sure how deep this needs to go. ${HUB_E2E_AUTO_AMBIGUOUS_MARKER}`;
/** hub-fixes WP6.1 — the "Run a mission" choice text a user sends after the clarify card. Carries the
 *  mission marker so the follow-up routing turn proposes (proving the clarify choice leads to a mission). */
export const HUB_E2E_AUTO_MISSION_CHOICE = `Run a mission. ${HUB_E2E_AUTO_MISSION_MARKER}`;
export const HUB_E2E_ARTIFACT_MESSAGE = `Please create a short artifact summarizing this smoke test. ${HUB_E2E_ARTIFACT_TRIGGER}`;
export const HUB_E2E_ARTIFACT_TITLE = "E2E Stub Artifact";
export const HUB_E2E_ARTIFACT_REPLY = "Done — I created the artifact you asked for.";
export const HUB_E2E_CHAT_REPLY = "Hello! This is a stubbed reply from the assistant-hub e2e smoke test.";
export const HUB_E2E_SYNTHESIS_TEXT =
  "Stubbed synthesis: the agent confirmed the mission flow ran end-to-end for this e2e smoke test.";

/**
 * The provider tool-name contract every name on the wire must satisfy — mirrors Anthropic's
 * `^[a-zA-Z0-9_-]{1,128}$` (the constraint whose violation is the P0 bug this stub now guards). The hub
 * sanitizes its DOTTED internal keys (`artifacts.create`, `files.write`, …) to provider-safe names
 * BEFORE the model call; if that sanitizer regresses, a raw dotted name reaches here and the stub fails
 * the request (below), so the hub e2e smoke fails loudly instead of silently passing on a lenient model.
 */
const PROVIDER_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

/** The provider-safe form of the internal `artifacts.create` built-in (dot -> underscore) — i.e. the
 *  name this stubbed model actually sees in `body.tools` and must call back with after sanitization. */
const ARTIFACTS_CREATE_PROVIDER_NAME = "artifacts_create";

/** The first tool name in a request's `tools` array that violates the provider contract, or `null` when
 *  they all pass (or there are no tools) — the P0 regression tripwire. */
function firstInvalidToolName(tools: unknown): string | null {
  if (!Array.isArray(tools)) return null;
  for (const entry of tools) {
    const fn = (entry as { function?: { name?: unknown } })?.function;
    const name = typeof fn?.name === "string" ? fn.name : undefined;
    if (name === undefined) continue;
    if (!PROVIDER_TOOL_NAME_PATTERN.test(name)) return name;
  }
  return null;
}

type ChatMessage = { role?: string; content?: unknown; [key: string]: unknown };

// A single planned agent — matches `hubPlannedAgentSchema` (packages/shared/src/schemas.ts) exactly
// (every REQUIRED field present; optional fields included where they help the plan-card render).
const MISSION_PLAN = {
  topology: "parallel",
  autonomy: "always_ask",
  rationale:
    "A single-agent parallel plan proves propose -> approve -> run -> synthesize deterministically for this e2e smoke test.",
  estimatedCostUsd: 0.01,
  agents: [
    {
      key: "e2e-agent",
      name: "E2E Stub Agent",
      systemPrompt: "You are a careful assistant helping verify an end-to-end smoke test.",
      model: HUB_E2E_STUB_MODEL_ID,
      toolGrants: { servers: {}, builtins: [] },
      skillIds: [],
      brief: `${AGENT_BRIEF_MARKER} Report two short findings confirming the mission flow ran end-to-end.`,
      target: "Confirm the mission flow completes end-to-end for the smoke test.",
      expectedOutcome: "A short structured report with 1-2 findings and no open questions.",
      rationale: "One agent is enough to exercise propose -> approve -> run -> synthesize.",
    },
  ],
};

// Matches `hubAgentReportSchema` exactly (every required field present). hub-fixes WP3.2: the
// `HUB_E2E_SYNTHESIS_MARKER` in the summary flows into the synthesizer's reports digest, so this server can
// tell the (streaming) synthesis turn apart from every other streaming turn.
const AGENT_REPORT = {
  summary: `Completed the e2e smoke check. ${HUB_E2E_SYNTHESIS_MARKER}`,
  findings: [{ summary: "The mission flow ran end-to-end via the stubbed model.", confidence: "high" }],
  citations: [],
  artifacts: [],
  confidence: "high",
  openQuestions: [],
};

// hub-fixes WP6.1 — a valid GenUI `prompt_user` root the routing turn emits for an ambiguous ask: a
// clarify Card with two send-Buttons ("Quick answer" / "Run a mission …"), matching `HUB_GENUI_CATALOG`
// (Card container → Stack → Button leaves; each Button has the required `label` + `action`). Its
// distinctive Card title lets a browser walk assert the clarify card rendered.
export const HUB_E2E_CLARIFY_CARD_TITLE = "How should I handle this?";
const CLARIFY_PROMPT_USER_ARGS = {
  root: {
    $type: "Card",
    props: {
      title: HUB_E2E_CLARIFY_CARD_TITLE,
      description: "This could be a quick answer, or a full mission with its own team.",
    },
    children: [
      {
        $type: "Stack",
        $key: "choices",
        props: { direction: "horizontal", gap: "sm" },
        children: [
          {
            $type: "Button",
            $key: "quick",
            props: { label: "Quick answer", action: "send", message: "Quick answer" },
          },
          {
            $type: "Button",
            $key: "mission",
            props: {
              label: "Run a mission (est. $0.01, 1 agent)",
              action: "send",
              message: HUB_E2E_AUTO_MISSION_CHOICE,
            },
          },
        ],
      },
    ],
  },
};

// hub-fixes WP3.2 — a valid GenUI `present` root the synthesis turn emits: a compact StatGroup (the nudge's
// preferred shape for a comparison), matching `HUB_GENUI_CATALOG`'s StatGroup schema exactly.
const SYNTHESIS_PRESENT_ARGS = {
  root: {
    $type: "StatGroup",
    props: {
      stats: [
        { label: HUB_E2E_SYNTHESIS_STAT_LABEL, value: "1" },
        { label: "Confidence", value: "High" },
      ],
    },
  },
};

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** Flatten an OpenAI-chat-style `content` field (a plain string OR an array of `{type,text}` parts). */
function flattenText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === "object" && "text" in (part as Record<string, unknown>)
          ? String((part as { text?: unknown }).text ?? "")
          : "",
      )
      .join(" ");
  }
  return "";
}

function allMessageText(messages: ChatMessage[]): string {
  return messages.map((m) => flattenText(m.content)).join("\n");
}

function sse(res: ServerResponse, payload: unknown): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function sendJson(res: ServerResponse, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(200, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");

  // `GET /v1/models` — the app's model-catalog probe (`GET /api/providers/:id/models`) and the hub's
  // `NewSessionDialog` roster both resolve through this (`parseOpenAiModels`, `filterChat: false`).
  if (req.method === "GET" && url.pathname === "/v1/models") {
    sendJson(res, { data: [{ id: HUB_E2E_STUB_MODEL_ID }] });
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
    const raw = await readBody(req);
    const body: Record<string, unknown> = raw ? JSON.parse(raw) : {};
    const messages: ChatMessage[] = Array.isArray(body.messages) ? (body.messages as ChatMessage[]) : [];
    const text = allMessageText(messages);

    // ── P0 guard: a provider rejects any tool name that isn't `^[a-zA-Z0-9_-]{1,128}$`. Fail the
    //    request the way a real provider would if the hub's sanitizer ever regressed to raw dotted names.
    const badToolName = firstInvalidToolName(body.tools);
    if (badToolName !== null) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: {
            message: `tools.0.custom.name: String should match pattern '^[a-zA-Z0-9_-]{1,128}$' — got "${badToolName}"`,
            type: "invalid_request_error",
          },
        }),
      );
      return;
    }

    // ── Structured output (`generateObject` — the mission planner / agent-report extraction) ────────
    const responseFormat = body.response_format as { type?: string } | undefined;
    if (responseFormat?.type === "json_object" || responseFormat?.type === "json_schema") {
      // hub-fixes WP2.1: the SESSION runner's report EXTRACTION carries its own system marker; the OLD
      // structured runner's per-agent call carries the brief marker. Either ⇒ a report; else ⇒ the plan.
      const isReportCall =
        text.includes(AGENT_BRIEF_MARKER) || text.includes(HUB_AGENT_REPORT_EXTRACTION_MARKER);
      const object = isReportCall ? AGENT_REPORT : MISSION_PLAN;
      sendJson(res, {
        id: "hub-e2e-structured",
        created: Math.floor(Date.now() / 1000),
        model: body.model ?? HUB_E2E_STUB_MODEL_ID,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: JSON.stringify(object) },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 20, total_tokens: 40 },
      });
      return;
    }

    // ── Streaming chat turn (`streamText` — the turn engine's own tool-calling loop) ─────────────
    if (body.stream === true) {
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });

      const hasToolResult = messages.some((m) => m.role === "tool");
      const tools = Array.isArray(body.tools) ? (body.tools as Array<Record<string, unknown>>) : [];
      const hasArtifactTool = tools.some((t) => {
        const fn = t.function as { name?: string } | undefined;
        // The hub sanitizes the internal `artifacts.create` key to `artifacts_create` before the wire.
        return fn?.name === ARTIFACTS_CREATE_PROVIDER_NAME;
      });
      // hub-fixes WP2.1: the read-only MCP tool a granted MISSION AGENT is expected to call. Its name has
      // no dot, so the hub passes it through unsanitized — matched verbatim here.
      const hasReadOnlyTool = tools.some(
        (t) => (t.function as { name?: string } | undefined)?.name === HUB_E2E_READONLY_TOOL_NAME,
      );
      // hub-fixes WP3.2: the GenUI `present` tool the granted synthesis turn calls.
      const hasPresentTool = tools.some(
        (t) => (t.function as { name?: string } | undefined)?.name === HUB_E2E_PRESENT_TOOL_NAME,
      );
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      const wantsArtifact =
        !hasToolResult && hasArtifactTool && flattenText(lastUser?.content).includes(HUB_E2E_ARTIFACT_TRIGGER);
      // A granted mission agent's FIRST step calls the read-only tool — but ONLY when its brief carries the
      // mission-agent marker, so this stub never hijacks an unrelated chat turn that merely has the tool
      // granted (that call would be approval-gated with no operator and hang).
      const wantsReadOnly =
        !hasToolResult && !wantsArtifact && hasReadOnlyTool && text.includes(HUB_E2E_MCP_AGENT_MARKER);
      // hub-fixes WP3.2: THE synthesis turn — the reports digest carries the synthesis marker. Its FIRST
      // step calls `present` (a valid StatGroup); the follow-up (after the tool result) answers with the
      // synthesis text. Checked FIRST — the marker is unique to the synthesis turn.
      const isSynthesis = text.includes(HUB_E2E_SYNTHESIS_MARKER);
      const wantsPresent = isSynthesis && !hasToolResult && hasPresentTool;
      // hub-fixes WP6.1 (RC7): an `auto` session's routing turn. `mission_propose_plan` granted +
      // the mission marker ⇒ SIGNAL a mission (the bridge then runs the real planner). `prompt_user`
      // granted + the ambiguous marker ⇒ render the clarify card. Distinct markers, so no collision
      // with the other flows. The follow-up step (after the tool result) closes the turn with a line.
      const hasMissionProposeTool = tools.some(
        (t) => (t.function as { name?: string } | undefined)?.name === MISSION_PROPOSE_PROVIDER_NAME,
      );
      const hasPromptUserTool = tools.some(
        (t) => (t.function as { name?: string } | undefined)?.name === HUB_E2E_PROMPT_USER_TOOL_NAME,
      );
      const wantsAutoMission =
        !hasToolResult && hasMissionProposeTool && text.includes(HUB_E2E_AUTO_MISSION_MARKER);
      const wantsAutoClarify =
        !hasToolResult && hasPromptUserTool && text.includes(HUB_E2E_AUTO_AMBIGUOUS_MARKER);
      const isAutoMissionFollowup = hasToolResult && text.includes(HUB_E2E_AUTO_MISSION_MARKER);
      const isAutoClarifyFollowup = hasToolResult && text.includes(HUB_E2E_AUTO_AMBIGUOUS_MARKER);

      if (wantsAutoMission) {
        sse(res, { id: "hub-e2e-auto-mission", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] });
        sse(res, {
          id: "hub-e2e-auto-mission",
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  { index: 0, id: "call_e2e_propose", function: { name: MISSION_PROPOSE_PROVIDER_NAME, arguments: "" } },
                ],
              },
              finish_reason: null,
            },
          ],
        });
        sse(res, {
          id: "hub-e2e-auto-mission",
          choices: [
            { index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(MISSION_PLAN) } }] }, finish_reason: null },
          ],
        });
        sse(res, { id: "hub-e2e-auto-mission", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
      } else if (wantsAutoClarify) {
        sse(res, { id: "hub-e2e-auto-clarify", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] });
        sse(res, {
          id: "hub-e2e-auto-clarify",
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  { index: 0, id: "call_e2e_clarify", function: { name: HUB_E2E_PROMPT_USER_TOOL_NAME, arguments: "" } },
                ],
              },
              finish_reason: null,
            },
          ],
        });
        sse(res, {
          id: "hub-e2e-auto-clarify",
          choices: [
            { index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(CLARIFY_PROMPT_USER_ARGS) } }] }, finish_reason: null },
          ],
        });
        sse(res, { id: "hub-e2e-auto-clarify", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
      } else if (isAutoMissionFollowup) {
        // The `mission.propose_plan` result came back — close the routing turn; the bridge proposes next.
        sse(res, {
          id: "hub-e2e-auto-mission-text",
          choices: [{ index: 0, delta: { role: "assistant", content: "Setting up a mission for this." }, finish_reason: null }],
        });
        sse(res, { id: "hub-e2e-auto-mission-text", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
      } else if (isAutoClarifyFollowup) {
        // The `prompt_user` card was emitted — close the turn; the user's choice arrives as a new message.
        sse(res, {
          id: "hub-e2e-auto-clarify-text",
          choices: [{ index: 0, delta: { role: "assistant", content: "Which would you prefer?" }, finish_reason: null }],
        });
        sse(res, { id: "hub-e2e-auto-clarify-text", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
      } else if (wantsPresent) {
        sse(res, { id: "hub-e2e-synth-genui", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] });
        sse(res, {
          id: "hub-e2e-synth-genui",
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  { index: 0, id: "call_e2e_present", function: { name: HUB_E2E_PRESENT_TOOL_NAME, arguments: "" } },
                ],
              },
              finish_reason: null,
            },
          ],
        });
        sse(res, {
          id: "hub-e2e-synth-genui",
          choices: [
            {
              index: 0,
              delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(SYNTHESIS_PRESENT_ARGS) } }] },
              finish_reason: null,
            },
          ],
        });
        sse(res, { id: "hub-e2e-synth-genui", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
      } else if (isSynthesis) {
        // The synthesis follow-up step (the `present` result came back) — answer with the synthesis prose.
        sse(res, {
          id: "hub-e2e-synth-text",
          choices: [{ index: 0, delta: { role: "assistant", content: HUB_E2E_SYNTHESIS_TEXT }, finish_reason: null }],
        });
        sse(res, { id: "hub-e2e-synth-text", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
      } else if (wantsReadOnly) {
        const args = JSON.stringify({ query: "e2e mission probe" });
        sse(res, { id: "hub-e2e-mcp", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] });
        sse(res, {
          id: "hub-e2e-mcp",
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  { index: 0, id: "call_e2e_read_echo", function: { name: HUB_E2E_READONLY_TOOL_NAME, arguments: "" } },
                ],
              },
              finish_reason: null,
            },
          ],
        });
        sse(res, {
          id: "hub-e2e-mcp",
          choices: [
            { index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: args } }] }, finish_reason: null },
          ],
        });
        sse(res, { id: "hub-e2e-mcp", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
      } else if (wantsArtifact) {
        const args = JSON.stringify({
          kind: "markdown",
          title: HUB_E2E_ARTIFACT_TITLE,
          content: "# E2E stub artifact\n\nCreated by the assistant-hub e2e smoke test's stubbed model.",
        });
        sse(res, { id: "hub-e2e-tool", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] });
        sse(res, {
          id: "hub-e2e-tool",
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_e2e_artifact",
                    function: { name: ARTIFACTS_CREATE_PROVIDER_NAME, arguments: "" },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        });
        sse(res, {
          id: "hub-e2e-tool",
          choices: [
            { index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: args } }] }, finish_reason: null },
          ],
        });
        sse(res, { id: "hub-e2e-tool", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
      } else {
        const replyText = hasToolResult ? HUB_E2E_ARTIFACT_REPLY : HUB_E2E_CHAT_REPLY;
        sse(res, {
          id: "hub-e2e-text",
          choices: [{ index: 0, delta: { role: "assistant", content: replyText }, finish_reason: null }],
        });
        sse(res, { id: "hub-e2e-text", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
      }
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    // ── Plain non-streaming text (`generateText` — the mission synthesizer) ──────────────────────
    sendJson(res, {
      id: "hub-e2e-synth",
      created: Math.floor(Date.now() / 1000),
      model: body.model ?? HUB_E2E_STUB_MODEL_ID,
      choices: [
        { index: 0, message: { role: "assistant", content: HUB_E2E_SYNTHESIS_TEXT }, finish_reason: "stop" },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    });
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: { message: "not found" } }));
}

/** Start the stub server on a free loopback port; resolves once it's listening. */
export function startHubStubLlmServer(): Promise<HubStubLlmServer> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      void handleRequest(req, res).catch((error: unknown) => {
        if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: error instanceof Error ? error.message : String(error) } }));
      });
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${address.port}/v1`,
        close: () => new Promise((res) => server.close(() => res())),
      });
    });
  });
}
