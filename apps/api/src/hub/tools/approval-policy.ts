// Assistant Hub (WP0.5, §1.6, R-MCP3 — POLICY CORE) — annotation-informed approval defaults.
//
// SCOPE (per the requirements annex's WP-impact map, which tags R-MCP3 "(policy core)" for WP0.5):
// this module is the PURE DECISION FUNCTION only. It deliberately does NOT decide which MCP servers
// are "owner-trusted" — no such flag exists anywhere in this app today (grep confirms: no
// `mcp_servers.trusted` column, no Settings toggle). That's a real gap this WP can't close without
// touching `packages/shared`/the DB, which is out of scope (WP0.1/0.2 own those). So `serverTrusted`
// is an EXPLICIT input the caller (a later WP — e.g. a Settings-level per-server trust toggle, or a
// heuristic) supplies; this module only guarantees the DEFAULTS are correct given that input:
//   - built-ins/skills (first-party, no external side effect) are always auto-eligible;
//   - an MCP tool needs BOTH `readOnlyHint: true` AND an owner-trusted server to auto-run;
//   - `destructiveHint: true` always asks, regardless of trust;
//   - an UNTRUSTED server's own self-reported annotations can only make the policy STRICTER, never
//     LOOSER — an untrusted server claiming `readOnlyHint: true` does NOT unlock auto-run by itself.
import type {
  HubApprovalOptionKind,
  HubApprovalResolution,
  HubAutonomyLevel,
  HubToolAnnotations,
  HubToolSource,
} from "@mcp-token-footprint/shared";
import type { HubApprovalGateDecision, HubApprovalMeta } from "../hitl.js";
import type { HubResolvedToolset, HubTurnHitl } from "../turn-engine.js";

export type HubApprovalPolicyInput = {
  source: HubToolSource;
  annotations?: HubToolAnnotations;
  /** Caller-supplied trust signal for the tool's origin server (irrelevant for non-`"mcp"` sources).
   *  Source of truth: TBD by a later WP — see the module doc. */
  serverTrusted?: boolean;
};

export type HubApprovalPolicyDecision = {
  /** May run without an approval card (still subject to whatever the session's autonomy dial layers
   *  on top — that's a later WP's concern; this is the ANNOTATION-informed floor). */
  autoEligible: boolean;
  requiresApproval: boolean;
  reason: string;
};

export function resolveApprovalPolicy(input: HubApprovalPolicyInput): HubApprovalPolicyDecision {
  if (input.source !== "mcp") {
    return {
      autoEligible: true,
      requiresApproval: false,
      reason: "First-party tool (builtin/skill/genui) — no external side effect.",
    };
  }

  const destructive = input.annotations?.destructiveHint === true;
  if (destructive) {
    return {
      autoEligible: false,
      requiresApproval: true,
      reason: "Marked destructiveHint — destructive calls always ask (D-AS4 posture).",
    };
  }

  const readOnly = input.annotations?.readOnlyHint === true;
  const trusted = input.serverTrusted === true;

  if (readOnly && trusted) {
    return {
      autoEligible: true,
      requiresApproval: false,
      reason: "readOnlyHint is set on an owner-trusted server.",
    };
  }

  if (readOnly && !trusted) {
    return {
      autoEligible: false,
      requiresApproval: true,
      reason:
        "readOnlyHint is set, but the server is not owner-trusted — annotations from an untrusted server can only make policy stricter, never looser.",
    };
  }

  return {
    autoEligible: false,
    requiresApproval: true,
    reason: input.annotations
      ? "Neither readOnlyHint nor an owner-trusted server — the safe default is to ask."
      : "No annotations declared — the safe default is to ask.",
  };
}

// ── Mission HITL (owner decision — feat/hub-free-run-tools-roster) ────────────────────────────────────
//
// Per-tool approval was REMOVED from the Hub entirely. A mission agent runs its granted MCP tools with
// no per-call approval — a grant is authorization enough (there is no supervised opt-in). The mission
// autonomy dial governs ONLY plan-LAUNCH approval (see `orchestrator.shouldAutoApprove` — you still
// approve a proposed team once), never an individual tool call. `resolveMissionApprovalGate` therefore
// always returns `gated: false`; because nothing is gated, `buildMissionAgentHitl`'s `waitForApproval`
// auto-decline path (below) is never reached — granted tools RUN, they are never auto-declined.
// Annotations (`destructive`) are kept on the returned decision only as inert card context.

/** The mission-agent WRAP decision for one exposed tool. The Hub never gates a tool call (owner
 *  decision) — this always returns `gated: false`. `_autonomy` is retained for signature parity with
 *  {@link resolveApprovalGate}; it governs plan-launch approval elsewhere, not per-call gating. */
export function resolveMissionApprovalGate(
  meta: HubApprovalMeta,
  _autonomy: HubAutonomyLevel,
): HubApprovalGateDecision {
  if (meta.source !== "mcp") {
    return { gated: false, destructive: false, source: meta.source, options: ["allow-once"] };
  }
  const destructive = meta.annotations?.destructiveHint === true;
  const options: HubApprovalOptionKind[] = destructive ? ["allow-once"] : ["allow-once", "always"];
  return {
    source: "mcp",
    gated: false,
    destructive,
    options,
    ...(meta.serverId ? { serverId: meta.serverId } : {}),
    ...(meta.annotations ? { annotations: meta.annotations } : {}),
  };
}

/** An injectable one-shot timer (tests pin it deterministic); defaults to `setTimeout`. */
export type MissionApprovalTimer = (fn: () => void, ms: number) => { cancel(): void };

const defaultMissionApprovalTimer: MissionApprovalTimer = (fn, ms) => {
  const handle = setTimeout(fn, ms);
  return { cancel: () => clearTimeout(handle) };
};

/**
 * Race a pending operator decision against the approval timeout. `timedOut` is true iff the timer won
 * (an auto-deny — the mission cannot stall on a never-answered card). A resolved decision cancels the
 * timer. A ≤0/absent timeout waits indefinitely (only safe with a real operator in the loop).
 */
async function raceApprovalTimeout(
  decision: Promise<HubApprovalResolution>,
  timeoutMs: number | undefined,
  timer: MissionApprovalTimer,
): Promise<{ value: HubApprovalResolution; timedOut: boolean }> {
  if (!timeoutMs || timeoutMs <= 0) {
    return { value: await decision, timedOut: false };
  }
  return new Promise((resolve) => {
    let settled = false;
    const handle = timer(() => {
      if (settled) return;
      settled = true;
      resolve({ value: "deny", timedOut: true });
    }, timeoutMs);
    decision.then(
      (value) => {
        if (settled) return;
        settled = true;
        handle.cancel();
        resolve({ value, timedOut: false });
      },
      () => {
        // A rejected decision promise (the coordinator resolves, never rejects — defensive) → deny.
        if (settled) return;
        settled = true;
        handle.cancel();
        resolve({ value: "deny", timedOut: false });
      },
    );
  });
}

/** The dependencies the mission-agent HITL needs. The coordinator interactions are injected as closures
 *  (child-session-scoped) so this stays a pure, testable policy module — no `HubHitlCoordinator` or
 *  repository import. */
export type MissionAgentHitlInput = {
  toolset: HubResolvedToolset;
  autonomy: HubAutonomyLevel;
  /** `always_ask` only: await a REAL operator decision (the shared coordinator; the board's
   *  per-child-session `/approvals` route resolves it). Absent ⇒ no operator path (an `always_ask`
   *  build without it degrades to the safe immediate auto-deny). */
  waitForOperatorDecision?: (toolCallId: string) => Promise<HubApprovalResolution>;
  /** `always_ask` timeout (ms). >0 ⇒ a pending board decision auto-denies after it elapses. ≤0/absent ⇒
   *  wait indefinitely (only safe with an operator). */
  approvalTimeoutMs?: number;
  /** `always_ask`: session-scoped "always allow" (the shared coordinator, child-session-scoped). */
  hasAlways?: (toolName: string) => boolean;
  recordAlways?: (toolName: string) => void;
  /** Tear-down on turn end (settle dangling coordinator decisions for the child — cancels a pending
   *  timeout race via the mailbox resolving to `deny`). */
  release?: () => void;
  /** The toolCallIds the timeout auto-denied are added here — the orchestrator's board-mirror sink reads
   *  it to stamp the `agent_approval_responded` `reason: "timeout"` (populated BEFORE the turn engine
   *  emits the child's `approval_responded`, so the mirror always sees it). */
  timedOut?: Set<string>;
  /** Injectable timer (tests). Defaults to `setTimeout`. */
  timer?: MissionApprovalTimer;
};

export type MissionAgentHitl = {
  hitl: HubTurnHitl;
  /** Gated calls this turn that ended DENIED (auto-declined under auto/threshold, or operator-denied /
   *  timed-out under always_ask) — the runner notes them on the report's open questions. */
  deniedCount: () => number;
  /** The subset of `deniedCount` that were auto-denied by the approval TIMEOUT (a distinct report note). */
  timedOutCount: () => number;
};

/**
 * hub-fixes WP2.5 (D-HF6) — build the mission-agent {@link HubTurnHitl} seam. Replaces WP2.1's minimal
 * `session-service.buildMissionAgentHitl`. First-party tools never gate; the MCP-tool gate + the
 * approval behavior follow {@link resolveMissionApprovalGate} + the injected coordinator closures. See
 * the section doc above for the full policy.
 */
export function buildMissionAgentHitl(input: MissionAgentHitlInput): MissionAgentHitl {
  const { toolset, autonomy } = input;
  const approvalMeta = toolset.approvalMeta ?? {};
  const sources = toolset.sources ?? {};
  const timer = input.timer ?? defaultMissionApprovalTimer;
  let denied = 0;
  let timedOut = 0;

  const metaFor = (toolName: string): HubApprovalMeta =>
    approvalMeta[toolName] ?? { source: sources[toolName] ?? "builtin" };

  const gate = (toolName: string): HubApprovalGateDecision =>
    resolveMissionApprovalGate(metaFor(toolName), autonomy);

  const waitForApproval = async (toolCallId: string): Promise<HubApprovalResolution> => {
    // auto/threshold: a gated call (destructive/unannotated) has no operator in the loop → auto-decline
    // (byte-compatible with WP2.1). always_ask: queue to the board (a real operator decision), bounded
    // by the approval timeout so a mission can never stall on a never-answered card.
    if (autonomy !== "always_ask" || !input.waitForOperatorDecision) {
      denied += 1;
      return "deny";
    }
    const outcome = await raceApprovalTimeout(
      input.waitForOperatorDecision(toolCallId),
      input.approvalTimeoutMs,
      timer,
    );
    if (outcome.timedOut) {
      timedOut += 1;
      input.timedOut?.add(toolCallId);
    }
    if (outcome.value === "deny") denied += 1;
    return outcome.value;
  };

  return {
    hitl: {
      autonomy,
      gate,
      waitForApproval,
      hasAlways: (toolName) => input.hasAlways?.(toolName) ?? false,
      recordAlways: (toolName) => input.recordAlways?.(toolName),
      bindElicitationResponder: () => undefined,
      // Missions never surface an MCP elicitation to an operator (no per-agent elicitation UI) — the safe
      // default is to decline, still visible as an event (WP2.1 behavior, preserved).
      waitForElicitation: async () => ({ action: "decline" }),
      // Mission agents run with `askUser:false` (no operator per child agent), so the engine never injects
      // the `ask_user` tool and this is never called; a `null` stub keeps the seam type-complete + safe.
      waitForQuestion: async () => null,
      release: () => input.release?.(),
    },
    deniedCount: () => denied,
    timedOutCount: () => timedOut,
  };
}
