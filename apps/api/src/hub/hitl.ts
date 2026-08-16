// Assistant Hub (roadmap/assistant-hub/, WP2.3 — the OWNER-FOLDED GAP-A/GAP-B live HITL seam) —
// the coordinator that bridges a RUNNING turn's tool wrapper (which awaits a decision *inside*
// `streamText`) and the decision routes (which resolve it), plus the MCP `elicitation/create`
// responder routing.
//
// SEPARATION OF CONCERNS (the reason this is its own module, not turn-engine logic): the turn engine
// OWNS emitting events + the SessionClock `waiting_input` pause (it has `persist`/`clock`); this
// module is a PURE registry — pending-promise mailboxes, the session-scoped "always allow" set,
// credential-shaped-field refusal (R-MCP4/R-MCP12), and the `serverId → active session` routing an
// MCP elicitation handler needs (MCP connections are pooled per server, process-wide — see
// `index.ts`'s `getHubMcpSession`, so the elicitation that arrives on a connection is routed to
// whichever hub session's turn is currently driving that server). Everything here is trivially
// unit-testable without a live model or a real MCP server (the stub-proven half of the WP; the live
// round-trip against a real eliciting server is owner-acceptance).
import type {
  HubApprovalOptionKind,
  HubApprovalResolution,
  HubAutonomyLevel,
  HubElicitationAction,
  HubElicitationMode,
  HubToolAnnotations,
  HubToolSource,
} from "@mcp-token-footprint/shared";

// ── Approval gating resolution ──────────────────────────────────────────────────────────────────────

/** Per-exposed-tool metadata the turn resolves an approval decision against (R-MCP3). */
export type HubApprovalMeta = {
  source: HubToolSource;
  serverId?: string;
  annotations?: HubToolAnnotations;
  /** Owner-trust signal for the origin server (see `approval-policy.ts` — no trust store exists yet,
   *  so this is caller-supplied; absent ⇒ untrusted, the strict default). */
  serverTrusted?: boolean;
};

/** The wrap decision for one tool: whether the turn must gate it, plus the card context (R-MCP3/R-UX1). */
export type HubApprovalGateDecision = {
  /** true → the turn wraps this tool's `execute` with an approval card (it MAY ask at call time). false
   *  → the turn leaves the tool untouched — the auto-run path stays byte-identical. */
  gated: boolean;
  /** Destructive tools ALWAYS ask (never satisfiable by a session-scoped "always") and never offer
   *  `always` as an option (D-AS4 posture / R-MCP3). */
  destructive: boolean;
  source: HubToolSource;
  serverId?: string;
  annotations?: HubToolAnnotations;
  /** The affirmative option kinds the card offers (deny is always available, never enumerated). */
  options: HubApprovalOptionKind[];
};

/**
 * Resolve the WRAP decision for one tool. Owner decision (feat/hub-free-run-tools-roster): the Hub
 * NEVER gates an individual tool call — a granted tool/server/skill is authorization enough, so an
 * agent runs ALL of them with no per-call approval. Per-tool approval was removed entirely (there is
 * no supervised opt-in). This therefore always returns `gated: false`, and the turn leaves every
 * tool's `execute` untouched (the auto-run path in `gateTools`).
 *
 * The autonomy dial (`_autonomy`, retained for signature/event parity) now governs ONLY mission
 * plan-LAUNCH approval (`orchestrator.shouldAutoApprove` — you still approve a proposed team once),
 * not per-call gating. Elicitation + `ask_user` (the tool/agent asking the *user* for input) are NOT
 * permission gates and are unaffected. `destructive`/`options`/`annotations` remain on the decision
 * only as (now-inert) card context.
 */
export function resolveApprovalGate(
  meta: HubApprovalMeta,
  _autonomy: HubAutonomyLevel,
): HubApprovalGateDecision {
  const destructive = meta.annotations?.destructiveHint === true;
  const options: HubApprovalOptionKind[] = destructive ? ["allow-once"] : ["allow-once", "always"];
  return {
    gated: false,
    destructive,
    source: meta.source,
    options,
    ...(meta.annotations ? { annotations: meta.annotations } : {}),
    ...(meta.serverId ? { serverId: meta.serverId } : {}),
  };
}

// ── Elicitation (R-MCP4) ────────────────────────────────────────────────────────────────────────────

/** The primitive content an operator submits for a `form`-mode elicitation (MCP `ElicitResult.content`). */
export type HubElicitationContent = Record<string, string | number | boolean | string[]>;

/** The terminal decision on an elicitation (structurally the MCP `ElicitResult`). */
export type HubElicitationDecision = {
  action: HubElicitationAction;
  content?: HubElicitationContent;
};

/** A hub-normalized MCP `elicitation/create` request (form or URL mode). */
export type NormalizedElicitationRequest = {
  mode: HubElicitationMode;
  message: string;
  serverId?: string;
  serverName?: string;
  toolCallId?: string;
  requestedSchema?: unknown;
  url?: string;
};

/** The per-turn responder the turn engine binds (it owns emitting events + the wait). Called by
 *  {@link HubHitlCoordinator.handleElicitation} when an MCP server elicits on this session's turn. */
export type HubTurnElicitationResponder = (
  request: NormalizedElicitationRequest,
) => Promise<HubElicitationDecision>;

const CREDENTIAL_FIELD_RE =
  /(pass(word|phrase)?|secret|token|api[_-]?key|apikey|credential|private[_-]?key|client[_-]?secret)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * R-MCP4 / R-MCP12 — return the first credential-shaped field name a form-mode elicitation requests, or
 * undefined when it asks for nothing secret. A match on the property NAME (password/secret/token/api
 * key/…) OR a `format: "password"` hint refuses the whole elicitation: the hub never collects a secret
 * through an elicitation, so a request that asks for one is auto-declined (still visible as an event).
 */
export function credentialFieldName(requestedSchema: unknown): string | undefined {
  if (!isRecord(requestedSchema)) return undefined;
  const properties = requestedSchema.properties;
  if (!isRecord(properties)) return undefined;
  for (const [name, def] of Object.entries(properties)) {
    if (CREDENTIAL_FIELD_RE.test(name)) return name;
    if (isRecord(def) && typeof def.format === "string" && /password|secret/i.test(def.format)) {
      return name;
    }
  }
  return undefined;
}

/**
 * Normalize a raw MCP `elicitation/create` request's params (the SDK's `ElicitRequest.params` — form:
 * `{ mode?: "form", message, requestedSchema }`; URL: `{ mode: "url", message, url, elicitationId }`)
 * into the hub shape. Defensive: reads field-by-field, never trusting the wire.
 */
export function normalizeElicitationRequest(
  params: unknown,
  context?: { serverId?: string; serverName?: string },
): NormalizedElicitationRequest {
  const raw = isRecord(params) ? params : {};
  const message = typeof raw.message === "string" ? raw.message : "The tool needs more information.";
  const urlMode = raw.mode === "url" && typeof raw.url === "string";
  const base = {
    message,
    ...(context?.serverId ? { serverId: context.serverId } : {}),
    ...(context?.serverName ? { serverName: context.serverName } : {}),
  };
  if (urlMode) {
    return { ...base, mode: "url", url: raw.url as string };
  }
  return {
    ...base,
    mode: "form",
    ...(raw.requestedSchema !== undefined ? { requestedSchema: raw.requestedSchema } : {}),
  };
}

// ── The coordinator (pure registry) ─────────────────────────────────────────────────────────────────

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };

function defer<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function approvalKey(sessionId: string, toolCallId: string): string {
  return `${sessionId}::${toolCallId}`;
}
function elicitationKey(sessionId: string, elicitationId: string): string {
  return `${sessionId}::${elicitationId}`;
}
function questionKey(sessionId: string, questionId: string): string {
  return `${sessionId}::${questionId}`;
}

/**
 * The process-wide HITL coordinator. Holds NO turn machinery — the turn owns `persist`/the SessionClock;
 * this is the async bridge (pending mailboxes) + the session-scoped "always" set + the `serverId →
 * active session` routing for MCP elicitation. One instance is shared by the session-service (which
 * builds the per-turn seam around it) and the decision routes (which resolve the mailboxes).
 */
export class HubHitlCoordinator {
  private readonly approvals = new Map<string, Deferred<HubApprovalResolution>>();
  private readonly elicitations = new Map<string, Deferred<HubElicitationDecision>>();
  /** Pending agent-initiated `ask_user` questions. Resolves with the operator's answer text, or `null`
   *  when the session is stopped/aborted before answering (the "stopped without answering" signal). */
  private readonly questions = new Map<string, Deferred<string | null>>();
  private readonly alwaysBySession = new Map<string, Set<string>>();
  private readonly respondersBySession = new Map<string, HubTurnElicitationResponder>();
  private readonly sessionByServer = new Map<string, string>();

  // ── Approvals (R-MCP3 / R-UX1) ──────────────────────────────────────────────────────────────────

  /** Register a pending approval and return the promise the turn's wrapper awaits. */
  waitForApproval(sessionId: string, toolCallId: string): Promise<HubApprovalResolution> {
    const key = approvalKey(sessionId, toolCallId);
    const existing = this.approvals.get(key);
    if (existing) return existing.promise;
    const deferred = defer<HubApprovalResolution>();
    this.approvals.set(key, deferred);
    return deferred.promise;
  }

  /** Resolve a pending approval (a decision route). Returns false if no such approval is pending. */
  resolveApproval(
    sessionId: string,
    toolCallId: string,
    resolution: HubApprovalResolution,
  ): boolean {
    const key = approvalKey(sessionId, toolCallId);
    const deferred = this.approvals.get(key);
    if (!deferred) return false;
    this.approvals.delete(key);
    deferred.resolve(resolution);
    return true;
  }

  /** True when a decision is currently awaited for this tool call (the route's precondition). */
  hasPendingApproval(sessionId: string, toolCallId: string): boolean {
    return this.approvals.has(approvalKey(sessionId, toolCallId));
  }

  // ── Session-scoped "don't ask again" (R-MCP3) ───────────────────────────────────────────────────

  recordAlways(sessionId: string, toolName: string): void {
    let set = this.alwaysBySession.get(sessionId);
    if (!set) {
      set = new Set();
      this.alwaysBySession.set(sessionId, set);
    }
    set.add(toolName);
  }

  hasAlways(sessionId: string, toolName: string): boolean {
    return this.alwaysBySession.get(sessionId)?.has(toolName) === true;
  }

  // ── Elicitation (R-MCP4) ────────────────────────────────────────────────────────────────────────

  /** Register a pending elicitation and return the promise the turn's responder awaits. */
  waitForElicitation(sessionId: string, elicitationId: string): Promise<HubElicitationDecision> {
    const key = elicitationKey(sessionId, elicitationId);
    const existing = this.elicitations.get(key);
    if (existing) return existing.promise;
    const deferred = defer<HubElicitationDecision>();
    this.elicitations.set(key, deferred);
    return deferred.promise;
  }

  /** Resolve a pending elicitation (a decision route). Returns false if no such elicitation is pending. */
  resolveElicitation(
    sessionId: string,
    elicitationId: string,
    decision: HubElicitationDecision,
  ): boolean {
    const key = elicitationKey(sessionId, elicitationId);
    const deferred = this.elicitations.get(key);
    if (!deferred) return false;
    this.elicitations.delete(key);
    deferred.resolve(decision);
    return true;
  }

  hasPendingElicitation(sessionId: string, elicitationId: string): boolean {
    return this.elicitations.has(elicitationKey(sessionId, elicitationId));
  }

  // ── Interactive questions (`ask_user`) ────────────────────────────────────────────────────────────

  /** Register a pending question and return the promise the turn's `ask_user` tool awaits. Resolves with
   *  the operator's answer, or `null` when the session is stopped/aborted before an answer. */
  waitForQuestion(sessionId: string, questionId: string): Promise<string | null> {
    const key = questionKey(sessionId, questionId);
    const existing = this.questions.get(key);
    if (existing) return existing.promise;
    const deferred = defer<string | null>();
    this.questions.set(key, deferred);
    return deferred.promise;
  }

  /** Resolve a pending question with the operator's answer (the `POST …/answers` route). Returns false if
   *  no such question is pending (the route's 409 precondition). */
  resolveQuestion(sessionId: string, questionId: string, answer: string): boolean {
    const key = questionKey(sessionId, questionId);
    const deferred = this.questions.get(key);
    if (!deferred) return false;
    this.questions.delete(key);
    deferred.resolve(answer);
    return true;
  }

  hasPendingQuestion(sessionId: string, questionId: string): boolean {
    return this.questions.has(questionKey(sessionId, questionId));
  }

  /** Bind the turn's elicitation responder + declare which servers this session's turn is driving, so a
   *  pooled MCP connection's `elicitation/create` routes to the right session. */
  bindElicitationResponder(
    sessionId: string,
    responder: HubTurnElicitationResponder,
    serverIds: readonly string[] = [],
  ): void {
    this.respondersBySession.set(sessionId, responder);
    for (const serverId of serverIds) this.sessionByServer.set(serverId, sessionId);
  }

  /** Tear down a turn's HITL state: unbind the responder, drop its server routing, and settle any
   *  dangling pending decisions (an approval → deny, an elicitation → cancel) so a lingering awaiter
   *  never hangs after the turn ends (Stop / clock fire / normal completion). */
  releaseTurn(sessionId: string): void {
    this.respondersBySession.delete(sessionId);
    for (const [serverId, boundSession] of this.sessionByServer) {
      if (boundSession === sessionId) this.sessionByServer.delete(serverId);
    }
    const approvalPrefix = `${sessionId}::`;
    for (const [key, deferred] of this.approvals) {
      if (key.startsWith(approvalPrefix)) {
        this.approvals.delete(key);
        deferred.resolve("deny");
      }
    }
    for (const [key, deferred] of this.elicitations) {
      if (key.startsWith(approvalPrefix)) {
        this.elicitations.delete(key);
        deferred.resolve({ action: "cancel" });
      }
    }
    for (const [key, deferred] of this.questions) {
      if (key.startsWith(approvalPrefix)) {
        this.questions.delete(key);
        deferred.resolve(null); // stopped/aborted before answering
      }
    }
  }

  /**
   * Route an MCP server's `elicitation/create` to the hub session whose turn is currently driving that
   * server (the MCP client's registered handler calls this — `index.ts` wiring). Declines when no turn
   * is driving the server (nothing safe to route to) — never blocks a pooled connection indefinitely.
   */
  async handleElicitation(
    serverId: string,
    request: NormalizedElicitationRequest,
  ): Promise<HubElicitationDecision> {
    const sessionId = this.sessionByServer.get(serverId);
    const responder = sessionId ? this.respondersBySession.get(sessionId) : undefined;
    if (!responder) return { action: "decline" };
    return responder(request);
  }
}
