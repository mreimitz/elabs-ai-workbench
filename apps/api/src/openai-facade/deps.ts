/**
 * WP5.1 (unified-sessions, D-US12) — the ONE place the OpenAI-compat facade's REAL dependencies are
 * wired from the app's provider layer. `apps/api/src/index.ts` mounts the facade with
 * `registerOpenAiFacade(server, buildFacadeDeps(...))`; the boot test calls this SAME factory over a
 * scratch DB so the mount is exercised against the real key-minter + the real `qlik_answers`
 * credential resolution (never a hand-rolled stub of those two).
 *
 * The three real deps, and why each reuses an existing helper (no new decryption / no new roster path):
 *   - `facadeKey`    → {@link loadOrMintFacadeKey} (the mcp-secret 0600-file pattern, `DATA_DIR/openai-facade.key`).
 *   - `listModels`   → {@link ProviderService.listModels} per configured `qlik_answers` credential
 *     (which calls {@link import("./model-catalog.js").listAvailableModels}, cached), aggregated + deduped.
 *   - `resolveModel` → the SAME `{ apiKey, baseUrl }` the executor uses via
 *     {@link ProviderRepository.getDecrypted} (mirrors `RunService.resolveAnswers`), for the
 *     `qlik_answers` credential whose roster lists the requested model. The stored credential is
 *     NEVER re-exposed to the client — only the resolved tenant auth is handed to the tenant call.
 *
 * `fetchImpl` / `tokenProfile` / `cache` / `now` are intentionally omitted so the facade keeps its
 * documented defaults (global fetch, `generic_o200k`, default cache tuning, `Date.now`).
 */

import path from "node:path";
import type { AvailableModel } from "@mcp-token-footprint/shared";
import type { ProviderRepository } from "../providers/repository.js";
import type { ProviderService } from "../providers/service.js";
import { loadOrMintFacadeKey } from "./auth.js";
import type { OpenAiFacadeDeps, QlikAnswersAuth } from "./types.js";

export type BuildFacadeDepsOptions = {
  /** Owns SQL/encryption — its `getDecrypted` yields the executor's `{ apiKey, baseUrl }` tenant auth. */
  providerRepository: ProviderRepository;
  /** The cached roster helper (`listModels(credId)` → `listAvailableModels`); resolves the model list. */
  providers: ProviderService;
  /** `DATA_DIR` — the facade key file lives beside the DB + mcp-secret.key at `<dataDirectory>/openai-facade.key`. */
  dataDirectory: string;
  /** An explicit facade key (from `OPENAI_FACADE_KEY`); when unset the key is minted + persisted 0600. */
  explicitKey?: string;
};

/**
 * Build the real {@link OpenAiFacadeDeps} from the app's provider layer. Called once at mount time in
 * `index.ts`; the boot test calls it over a scratch DB.
 */
export function buildFacadeDeps(opts: BuildFacadeDepsOptions): OpenAiFacadeDeps {
  const { providerRepository, providers, dataDirectory } = opts;

  const facadeKey = loadOrMintFacadeKey({
    explicitKey: opts.explicitKey,
    keyPath: path.join(dataDirectory, "openai-facade.key"),
  });

  /** The ids of every configured `qlik_answers` credential (redacted list read — no secret touched). */
  const qlikCredentialIds = (): string[] =>
    providerRepository
      .list()
      .filter((cred) => cred.kind === "qlik_answers")
      .map((cred) => cred.id);

  const resolveModel = async (model: string): Promise<QlikAnswersAuth | undefined> => {
    for (const id of qlikCredentialIds()) {
      let roster: AvailableModel[];
      try {
        roster = await providers.listModels(id);
      } catch {
        // A broken link / unreachable tenant for this credential — try the next one, don't fail.
        continue;
      }
      if (!roster.some((entry) => entry.id === model)) continue;
      try {
        const cred = providerRepository.getDecrypted(id);
        if (cred.apiKey && cred.baseUrl) return { apiKey: cred.apiKey, baseUrl: cred.baseUrl };
      } catch {
        // Decryption / linked-auth resolution failed at call time — treat the model as unresolvable.
      }
    }
    return undefined;
  };

  const listModels = async (): Promise<AvailableModel[]> => {
    const byId = new Map<string, AvailableModel>();
    for (const id of qlikCredentialIds()) {
      try {
        for (const entry of await providers.listModels(id)) {
          if (!byId.has(entry.id)) byId.set(entry.id, entry);
        }
      } catch {
        // Skip a credential whose roster can't be listed (auth broken / tenant down) — never throw.
      }
    }
    return [...byId.values()];
  };

  return { facadeKey, resolveModel, listModels };
}
