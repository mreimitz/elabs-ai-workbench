import type { Collection, CollectionInput } from "@mcp-token-footprint/shared";
import { collectionInputSchema } from "@mcp-token-footprint/shared";
import type { CollectionRepository } from "./repository.js";

/**
 * Thin orchestration over {@link CollectionRepository} (mirrors {@link SuiteService}). Routes call this;
 * the repository owns SQL + the PAT/membership discipline. Input is validated against
 * `collectionInputSchema` before it reaches the repository; a missing id 404s from the repository. The
 * git sync engine (clone/commit/fetch/merge) is WP 4.2 and is NOT wired here.
 */
export class CollectionService {
  constructor(private readonly collections: CollectionRepository) {}

  list(): Collection[] {
    return this.collections.list();
  }

  get(id: string): Collection {
    return this.collections.get(id);
  }

  create(input: CollectionInput): Collection {
    return this.collections.create(collectionInputSchema.parse(input));
  }

  update(id: string, input: CollectionInput): Collection {
    return this.collections.update(id, collectionInputSchema.parse(input));
  }

  delete(id: string): void {
    this.collections.delete(id);
  }

  /** Attach a test and return the (redacted) collection so the caller sees the fresh membership. */
  assignTest(collectionId: string, testId: string): Collection {
    this.collections.assignTest(collectionId, testId);
    return this.collections.get(collectionId);
  }

  removeTest(testId: string): void {
    this.collections.removeTest(testId);
  }

  assignSuite(collectionId: string, suiteId: string): Collection {
    this.collections.assignSuite(collectionId, suiteId);
    return this.collections.get(collectionId);
  }

  removeSuite(suiteId: string): void {
    this.collections.removeSuite(suiteId);
  }
}
