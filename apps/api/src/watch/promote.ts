// Observability — the `promote_to_test` action's draft-test builder (roadmap/observability/, WP4.1).
//
// Creates a DRAFT {@link Test} from a terminal run so a good/bad run can be promoted into a reusable
// regression test. The mapping is DOCUMENTED + deterministic (asserted by the watch tests):
//   - name              = "[Draft] <source test name>" (CLEARLY marked as a draft)
//   - userPrompt        = the run's first user prompt (== the source test's prompt — the opener the
//                         run executor sent as the first user message)
//   - systemPromptOverride / addedProfiles = carried from the source test (the environment-shaping
//                         config so the draft runs the same way when a user later launches it)
//   - expectations      = carried from the source test WHERE PRESENT (the run's expected-answer block)
//   - category/difficulty/tags = carried; a `"draft"` tag is added
//   - collectionId      = the action's target collection
//   - draft             = true
//   - attachments       = copied from the source test (best-effort; a missing blob is skipped)
//
// A promoted test is a DRAFT and NEVER auto-runs — nothing here (or anywhere in the watch pipeline)
// invokes the run engine. It is a plain persisted test the user can review, edit, and launch by hand.

import fs from "node:fs";
import type { TestInput } from "@mcp-token-footprint/shared";
import type { RunRepository } from "../testing/run-repository.js";
import type { TestRepository } from "../testing/test-repository.js";
import type { TestService } from "../testing/test-service.js";

export interface PromoteDeps {
  runs: RunRepository;
  tests: TestService;
  /** Read-only access to the source test's attachment blob records (paths) for the carry-over. */
  testRepo: TestRepository;
}

/**
 * Build + persist the draft test for a `promote_to_test` action. Returns the new test's id. Throws
 * only on a genuinely unrecoverable input (missing run/test) — the caller (the action executor) turns
 * that into an audited failure, isolated from every other action + the run pipeline.
 */
export function promoteRunToTest(deps: PromoteDeps, runId: string, collectionId: string): string {
  const run = deps.runs.getSummary(runId); // 404 if the run is gone
  const source = deps.tests.get(run.testId); // 404 if the source test is gone

  const tags = source.tags.includes("draft") ? source.tags : [...source.tags, "draft"];
  const input: TestInput = {
    name: `[Draft] ${source.name}`,
    userPrompt: source.userPrompt,
    ...(source.systemPromptOverride !== undefined
      ? { systemPromptOverride: source.systemPromptOverride }
      : {}),
    addedProfiles: source.addedProfiles,
    ...(source.expectations !== undefined ? { expectations: source.expectations } : {}),
    ...(source.assertions !== undefined ? { assertions: source.assertions } : {}),
    ...(source.category !== undefined ? { category: source.category } : {}),
    ...(source.difficulty !== undefined ? { difficulty: source.difficulty } : {}),
    tags,
    collectionId,
    draft: true,
  };

  const draft = deps.tests.create(input);

  // Carry attachments over (best-effort — a draft is still valid if a blob went missing). Each blob is
  // re-read and re-added through the normal attachment path so the draft owns its own copies.
  for (const record of deps.testRepo.listAttachmentRecords(source.id)) {
    try {
      const content = fs.readFileSync(record.path);
      deps.tests.addAttachment(draft.id, {
        kind: record.kind,
        name: record.name,
        contentBase64: content.toString("base64"),
      });
    } catch {
      // A missing/unreadable source blob must not block promoting the run — skip it.
    }
  }

  return draft.id;
}
