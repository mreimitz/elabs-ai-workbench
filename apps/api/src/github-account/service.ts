import { nanoid } from "nanoid";
import type {
  GithubAccountStatus,
  GithubDevicePoll,
  GithubDeviceStart,
} from "@mcp-token-footprint/shared";
import type { AppSettingsRepository } from "../grading/app-settings-repository.js";
import type { SecretStore } from "../secrets/secret-store.js";
import { httpError } from "../utils/errors.js";

/** The `app_settings` key the account record lives under (KV — no schema migration needed). */
export const GITHUB_ACCOUNT_SETTING_KEY = "github_account";

/** OAuth scope requested by the device flow: full repo access (pull/push/PR on private repos). */
const DEVICE_FLOW_SCOPE = "repo";

/**
 * The persisted account record. `tokenEncrypted` is a SecretStore blob (`enc:v1:…`) — the plaintext
 * token exists only in-process; the API never returns it (the redacted view is
 * {@link GithubAccountStatus}). `clientId` is public OAuth App configuration, not a secret.
 */
type StoredAccount = {
  clientId?: string;
  tokenEncrypted?: string;
  login?: string;
  name?: string;
  avatarUrl?: string;
  scopes?: string[];
  connectedAt?: string;
};

/** One in-flight device flow. The GitHub `device_code` NEVER leaves the process — the client only
 *  ever sees the opaque `flowId` handle (and the human `user_code` it must type on github.com). */
type DeviceFlow = {
  deviceCode: string;
  clientId: string;
  interval: number; // seconds; GitHub may bump it via `slow_down`
  expiresAt: number; // epoch ms
};

export type GithubAccountServiceOptions = {
  /** HTTP implementation — INJECTED so tests never touch github.com. Defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
};

/**
 * The app-wide GitHub identity (Settings → "GitHub account"): a real "sign in with GitHub" via the
 * OAuth 2.0 DEVICE FLOW (RFC 8628) against an owner-registered GitHub OAuth App. No client secret is
 * involved (the device flow doesn't use one) and no browser callback route is needed — the user
 * confirms a short code on github.com/login/device, we poll for the token, validate it against
 * `GET /user`, and store it ENCRYPTED in the `app_settings` KV. Skill GitHub operations use it as
 * the LAST fallback: explicit dialog token → the skill's stored PAT → this account.
 */
export class GithubAccountService {
  private readonly fetchImpl: typeof fetch;
  private readonly flows = new Map<string, DeviceFlow>();

  constructor(
    private readonly settings: AppSettingsRepository,
    private readonly secrets: SecretStore,
    options: GithubAccountServiceOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** The redacted account state (never the token). */
  status(): GithubAccountStatus {
    const stored = this.read();
    return {
      connected: Boolean(stored.tokenEncrypted),
      clientIdConfigured: Boolean(stored.clientId),
      ...(stored.clientId ? { clientId: stored.clientId } : {}),
      ...(stored.login ? { login: stored.login } : {}),
      ...(stored.name ? { name: stored.name } : {}),
      ...(stored.avatarUrl ? { avatarUrl: stored.avatarUrl } : {}),
      ...(stored.scopes ? { scopes: stored.scopes } : {}),
      ...(stored.connectedAt ? { connectedAt: stored.connectedAt } : {}),
    };
  }

  /** Set/replace the OAuth App client id (public config). Keeps an existing sign-in untouched. */
  setClientId(clientId: string): GithubAccountStatus {
    this.write({ ...this.read(), clientId });
    return this.status();
  }

  /** Sign out: drop the token + identity (the client id is kept — it's configuration). */
  disconnect(): GithubAccountStatus {
    const stored = this.read();
    this.write({ clientId: stored.clientId });
    return this.status();
  }

  /**
   * The DECRYPTED account token, or `undefined` when not signed in. In-process use only (git argv /
   * REST Authorization header) — callers must never persist, return, or log it.
   */
  token(): string | undefined {
    const stored = this.read();
    if (!stored.tokenEncrypted) return undefined;
    try {
      return this.secrets.decryptText(stored.tokenEncrypted);
    } catch {
      // An undecryptable blob (rotated/lost key) is an honest "not signed in", not a crash.
      return undefined;
    }
  }

  /** Start a device flow: `POST github.com/login/device/code` → show code + link, poll by flowId. */
  async startDeviceFlow(): Promise<GithubDeviceStart> {
    const stored = this.read();
    if (!stored.clientId) {
      throw httpError(
        400,
        "No GitHub OAuth App client id is configured — set one in Settings first.",
      );
    }

    const body = await this.githubJson("https://github.com/login/device/code", {
      client_id: stored.clientId,
      scope: DEVICE_FLOW_SCOPE,
    });
    const deviceCode = str(body.device_code);
    const userCode = str(body.user_code);
    const verificationUri = str(body.verification_uri) || "https://github.com/login/device";
    if (!deviceCode || !userCode) {
      throw httpError(502, "GitHub returned an unexpected device-flow response.");
    }
    const expiresIn = num(body.expires_in) ?? 900;
    const interval = num(body.interval) ?? 5;

    const flowId = nanoid();
    this.flows.set(flowId, {
      deviceCode,
      clientId: stored.clientId,
      interval,
      expiresAt: Date.now() + expiresIn * 1000,
    });
    this.sweepFlows();

    return { flowId, userCode, verificationUri, expiresIn, interval };
  }

  /**
   * One poll of an in-flight device flow (the CLIENT drives the cadence, waiting the returned
   * `interval` between calls; a GitHub `slow_down` bumps it). Terminal failures (expired / denied /
   * unknown flow) throw a 4xx whose message the Settings card shows inline.
   */
  async pollDeviceFlow(flowId: string): Promise<GithubDevicePoll> {
    const flow = this.flows.get(flowId);
    if (!flow) {
      throw httpError(404, "Unknown or finished sign-in attempt — start again.");
    }
    if (Date.now() > flow.expiresAt) {
      this.flows.delete(flowId);
      throw httpError(400, "The sign-in code expired — start again.");
    }

    const body = await this.githubJson("https://github.com/login/oauth/access_token", {
      client_id: flow.clientId,
      device_code: flow.deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    });

    const error = str(body.error);
    if (error === "authorization_pending") {
      return { status: "pending", interval: flow.interval };
    }
    if (error === "slow_down") {
      flow.interval = num(body.interval) ?? flow.interval + 5;
      return { status: "pending", interval: flow.interval };
    }
    if (error === "expired_token") {
      this.flows.delete(flowId);
      throw httpError(400, "The sign-in code expired — start again.");
    }
    if (error === "access_denied") {
      this.flows.delete(flowId);
      throw httpError(400, "The sign-in was declined on GitHub.");
    }
    if (error) {
      this.flows.delete(flowId);
      throw httpError(502, `GitHub sign-in failed: ${str(body.error_description) || error}`);
    }

    const token = str(body.access_token);
    if (!token) {
      throw httpError(502, "GitHub returned an unexpected token response.");
    }
    this.flows.delete(flowId);

    // Validate the token + resolve the identity we now operate as (GET /user).
    const identity = await this.fetchIdentity(token);
    this.write({
      clientId: flow.clientId,
      tokenEncrypted: this.secrets.encryptText(token),
      ...identity,
      connectedAt: new Date().toISOString(),
    });
    return { status: "connected", account: this.status() };
  }

  // --- Internals ----------------------------------------------------------------------------------

  private async fetchIdentity(
    token: string,
  ): Promise<Pick<StoredAccount, "login" | "name" | "avatarUrl" | "scopes">> {
    let res: Response;
    try {
      res = await this.fetchImpl("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "mcp-token-footprint",
        },
      });
    } catch (err) {
      throw httpError(502, `Could not verify the GitHub sign-in: ${errMessage(err)}`);
    }
    if (!res.ok) {
      throw httpError(502, `GitHub rejected the new token (${res.status}).`);
    }
    const body = (await res.json()) as { login?: string; name?: string; avatar_url?: string };
    const scopesHeader = res.headers.get("x-oauth-scopes") ?? "";
    const scopes = scopesHeader
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return {
      ...(body.login ? { login: body.login } : {}),
      ...(body.name ? { name: body.name } : {}),
      ...(body.avatar_url ? { avatarUrl: body.avatar_url } : {}),
      ...(scopes.length > 0 ? { scopes } : {}),
    };
  }

  /** POST a form-shaped OAuth request with `Accept: application/json`; parse the JSON body. */
  private async githubJson(
    url: string,
    params: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": "mcp-token-footprint",
        },
        body: JSON.stringify(params),
      });
    } catch (err) {
      throw httpError(502, `Could not reach GitHub: ${errMessage(err)}`);
    }
    // The OAuth endpoints report flow errors INSIDE a 200 JSON body; a non-2xx is a real failure.
    if (!res.ok) {
      throw httpError(502, `GitHub sign-in request failed (${res.status}).`);
    }
    try {
      return (await res.json()) as Record<string, unknown>;
    } catch {
      throw httpError(502, "GitHub returned an unexpected (non-JSON) sign-in response.");
    }
  }

  private read(): StoredAccount {
    const raw = this.settings.get(GITHUB_ACCOUNT_SETTING_KEY);
    return raw && typeof raw === "object" ? (raw as StoredAccount) : {};
  }

  private write(record: StoredAccount): void {
    this.settings.put(GITHUB_ACCOUNT_SETTING_KEY, record);
  }

  /** Drop expired flows so an abandoned sign-in can't accumulate handles forever. */
  private sweepFlows(): void {
    const now = Date.now();
    for (const [id, flow] of this.flows) {
      if (now > flow.expiresAt) this.flows.delete(id);
    }
  }
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
