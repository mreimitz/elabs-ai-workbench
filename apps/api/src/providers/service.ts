import type {
  AvailableModel,
  ProviderCredential,
  ProviderCredentialInput,
  ProviderCredentialUpdate,
} from "@mcp-token-footprint/shared";
import type { LanguageModel } from "ai";
import { listAvailableModels } from "./model-catalog.js";
import { modelFor } from "./registry.js";
import type { ProviderRepository } from "./repository.js";
import type { SubscriptionModelSource } from "./subscription-models.js";

// Provider model rosters change rarely; cache per credential for a few minutes so re-opening the
// scenario editor doesn't re-hit the provider each time. Invalidated when the credential changes.
const MODEL_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Thin orchestration over the provider repository + model registry. Routes call this;
 * the repository owns SQL/encryption, the registry owns AI SDK wiring.
 */
export class ProviderService {
  private readonly modelCache = new Map<string, { models: AvailableModel[]; expiresAt: number }>();

  constructor(private readonly repository: ProviderRepository) {}

  list(): ProviderCredential[] {
    return this.repository.list();
  }

  get(id: string): ProviderCredential {
    return this.repository.get(id);
  }

  create(input: ProviderCredentialInput): ProviderCredential {
    return this.repository.create(input);
  }

  update(id: string, update: ProviderCredentialUpdate): ProviderCredential {
    this.modelCache.delete(id);
    return this.repository.update(id, update);
  }

  delete(id: string): void {
    this.modelCache.delete(id);
    this.repository.delete(id);
  }

  // Decrypts the key in-process (runtime boundary) and asks the provider's API for its live model
  // roster — the list that drives the scenario model picker. Only non-secret ids/labels are
  // returned. Cached for MODEL_CACHE_TTL_MS per credential. Throws a 404 for an unknown id (via
  // get/getDecrypted) and a 4xx/5xx httpError when the provider can't be reached.
  //
  // `subscriptionModels` (planning/Roadmap/RM-09-claude-subscription/ follow-up) is the LIVE Claude-subscription roster
  // resolver, threaded from the route. A `claude_subscription` credential carries NO key to decrypt —
  // `getDecrypted` THROWS `brokenSubscriptionAuthError` when signed out — so its roster is resolved via
  // the resolver directly (which independently resolves the sign-in and falls back to the static roster),
  // and its `get(id).kind` is read WITHOUT decrypting. Every other kind decrypts as before.
  async listModels(
    id: string,
    subscriptionModels?: SubscriptionModelSource,
  ): Promise<AvailableModel[]> {
    const cached = this.modelCache.get(id);
    if (cached && cached.expiresAt > Date.now()) return cached.models;

    const kind = this.repository.get(id).kind;
    const models =
      kind === "claude_subscription"
        ? await listAvailableModels({ kind: "claude_subscription" }, subscriptionModels)
        : await listAvailableModels(this.repository.getDecrypted(id), subscriptionModels);
    this.modelCache.set(id, { models, expiresAt: Date.now() + MODEL_CACHE_TTL_MS });
    return models;
  }

  // INTERNAL ONLY — decrypts the key and builds an AI SDK model. Used by the run engine
  // (WP 1.3+), never exposed over HTTP.
  modelFor(id: string, model: string): LanguageModel {
    return modelFor(this.repository.getDecrypted(id), model);
  }
}
