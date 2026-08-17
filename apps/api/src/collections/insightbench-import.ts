import crypto from "node:crypto";
import type {
  Difficulty,
  Suite,
  Test,
  TestExpectations,
  TestInput,
} from "@mcp-token-footprint/shared";
import { SUITE_DEFAULT_CONCURRENCY, SUITE_DEFAULT_REPETITIONS } from "@mcp-token-footprint/shared";
import type { SuiteRepository } from "../suites/repository.js";
import type { TestRepository } from "../testing/test-repository.js";
import { httpError } from "../utils/errors.js";
import { stableStringify } from "../utils/json.js";
import type { CollectionRepository } from "./repository.js";

/**
 * One-way InsightBench importer (Benchmarks WP 4.4, B13). Converts a colleague's `questions.json`
 * (grouped: app → questions with ground-truth insight/value/code) into this app's own graded tests
 * plus ONE suite, optionally assigned to a collection.
 *
 * IMPORT IS ONE-WAY. There is deliberately NO exporter here — we NEVER write his format back. The
 * mapping (difficulty band, unanswerable-insight detection) is ported faithfully from the staged
 * `convert_to_benchmarks.py` prototype. Imported tests are created as READ-ONLY DATA — never executed.
 *
 * Idempotence: a question is skipped when a test with the SAME content hash already exists (in the DB
 * or earlier in the same import). The hash is taken over the STABLE-serialized mapped test payload
 * (see {@link contentHash}) so re-importing the same file creates 0 new tests and reuses the existing
 * suite (matched by the same content-hash basis over its ordered membership).
 */

/**
 * InsightBench difficulty level (1–4) → this app's {@link Difficulty} band. Ported from the prototype's
 * intent (1–2 → easy, 3 → medium, 4 → hard). An out-of-range/absent level maps to `undefined` (no band).
 */
export const DIFF_LEVEL_MAP: Readonly<Record<number, Difficulty>> = {
  1: "easy",
  2: "easy",
  3: "medium",
  4: "hard",
};

export function mapDifficultyLevel(level: unknown): Difficulty | undefined {
  return typeof level === "number" ? DIFF_LEVEL_MAP[level] : undefined;
}

/**
 * Ported FAITHFULLY from the prototype's `_UNANSWERABLE_INSIGHT_PATTERNS` (Python VERBOSE/IGNORECASE).
 * A ground-truth insight that says the required column is absent / the analysis could not be done (the
 * original notebook raised a KeyError) marks the question as `answerable: false`, so the runner scores
 * the agent on recognising the data is missing rather than judging a fabricated answer.
 */
export const UNANSWERABLE_INSIGHT_PATTERN =
  /no\s+columns?\b|to\s+conduct\s+any\s+analysis|could\s+not\s+be\s+(?:completed|performed)|missing\s+'[^']+'\s+column|required\s+'[^']+'\s+column\s+is\s+missing|'[^']+'\s+column\s+is\s+missing|\bKeyError\b/i;

/** True when a source insight states the analysis could not be done for lack of data. */
export function isUnanswerableInsight(insight: string | undefined | null): boolean {
  return Boolean(insight && UNANSWERABLE_INSIGHT_PATTERN.test(insight));
}

// The colleague's on-disk shape (grouped by app). Every field is defensively optional — the file is
// external, so the importer validates/normalizes rather than trusting a strict schema.
type RawQuestion = {
  question?: unknown;
  question_type?: unknown;
  gt_insight?: unknown;
  gt_insight_value?: unknown;
  gt_code?: unknown;
  gt_action?: unknown;
};

type RawGroup = {
  app?: unknown;
  category?: unknown;
  difficulty_level?: unknown;
  difficulty_description?: unknown;
  questions?: unknown;
};

export type InsightBenchImportInput = {
  collectionId?: string;
  questions: unknown; // the parsed questions.json content (array of app groups, or a single group)
};

export type InsightBenchImportResult = {
  suiteId: string;
  testIds: string[]; // ids of the tests CREATED by this import (empty on a fully-deduped re-import)
  created: number;
  skipped: number;
};

const MAX_NAME_LENGTH = 200;

export class InsightBenchImporter {
  constructor(
    private readonly tests: TestRepository,
    private readonly suites: SuiteRepository,
    private readonly collections: CollectionRepository,
  ) {}

  /**
   * Import a parsed `questions.json` into tests + one suite, ordered by app then question. Optionally
   * assigns the newly-created tests + suite to a collection. Idempotent: an identical re-import creates
   * 0 tests and returns the existing suite id.
   */
  importQuestions(input: InsightBenchImportInput): InsightBenchImportResult {
    const collectionId = input.collectionId?.trim() || undefined;
    if (collectionId) {
      this.collections.get(collectionId); // 404 up-front if the collection is unknown (no partial writes)
    }

    const groups = normalizeGroups(input.questions);

    // Snapshot the existing tests once → the content-hash dedup index (hash → id). The suite dedup
    // needs id → hash too, so keep both directions.
    const hashToId = new Map<string, string>();
    const idToHash = new Map<string, string>();
    for (const existing of this.tests.list()) {
      const hash = contentHash(existing);
      idToHash.set(existing.id, hash);
      if (!hashToId.has(hash)) hashToId.set(hash, existing.id);
    }
    const preexisting = new Set(hashToId.keys());

    const usedNames = new Map<string, number>();
    const createdTestIds: string[] = [];
    let created = 0;
    let skipped = 0;

    // Ordered, de-duplicated suite membership (distinct member ids + their content hashes, in order).
    const memberSeen = new Set<string>();
    const memberIds: string[] = [];
    const memberHashes: string[] = [];

    for (const group of groups) {
      for (const question of groupQuestions(group)) {
        const payload = mapQuestion(group, question, usedNames);
        if (!payload) continue; // question with no prompt → not importable (dropped, not counted)

        const hash = contentHash(payload);
        let testId = hashToId.get(hash);
        if (testId) {
          skipped += 1;
        } else {
          const test = this.tests.create(payload);
          testId = test.id;
          hashToId.set(hash, testId);
          idToHash.set(testId, hash);
          createdTestIds.push(testId);
          created += 1;
        }

        if (!memberSeen.has(hash)) {
          memberSeen.add(hash);
          memberIds.push(testId);
          memberHashes.push(hash);
        }
      }
    }

    if (memberIds.length === 0) {
      throw httpError(400, "InsightBench import: no questions found");
    }

    // ONE suite per import. Name/description/config are DETERMINISTIC (no timestamp) so the suite's
    // content hash is stable across re-imports and an identical re-import reuses the existing suite.
    const appCount = countApps(groups);
    const suiteName = "InsightBench import";
    const suiteDescription = `Imported from InsightBench questions.json: ${memberIds.length} tests across ${appCount} apps.`;
    const suiteConfig = {
      repetitions: SUITE_DEFAULT_REPETITIONS,
      maxConcurrency: SUITE_DEFAULT_CONCURRENCY,
    };
    const suiteHash = suiteContentHash(suiteName, suiteDescription, suiteConfig, memberHashes);

    const existingSuiteId = this.findExistingSuite(suiteHash, idToHash);
    let suiteId: string;
    let suiteCreated: boolean;
    if (existingSuiteId) {
      suiteId = existingSuiteId;
      suiteCreated = false;
    } else {
      const suite = this.suites.create({
        name: suiteName,
        description: suiteDescription,
        config: suiteConfig,
        testIds: memberIds,
        scenarioIds: [],
      });
      suiteId = suite.id;
      suiteCreated = true;
    }

    if (collectionId) {
      // Assign only the NEWLY-created members + a newly-created suite. Re-assigning re-keys the
      // cross-system external_key, so a fully-deduped re-import leaves prior membership untouched.
      for (const id of createdTestIds) this.collections.assignTest(collectionId, id);
      if (suiteCreated) this.collections.assignSuite(collectionId, suiteId);
    }

    return { suiteId, testIds: createdTestIds, created, skipped };
  }

  /** Find an existing suite whose deterministic content hash matches (idempotent re-import). */
  private findExistingSuite(suiteHash: string, idToHash: Map<string, string>): string | undefined {
    for (const suite of this.suites.list()) {
      const hashes = suite.testIds.map((id) => idToHash.get(id));
      if (hashes.some((h) => h === undefined)) continue; // a member is not (or no longer) hashable → skip
      const candidate = suiteContentHash(
        suite.name,
        suite.description ?? undefined,
        suite.config,
        hashes as string[],
      );
      if (candidate === suiteHash) return suite.id;
    }
    return undefined;
  }
}

// --- mapping -----------------------------------------------------------------------------------

/** Map one InsightBench question (within its app group) to a {@link TestInput}, or null if unusable. */
function mapQuestion(
  group: RawGroup,
  question: RawQuestion,
  usedNames: Map<string, number>,
): TestInput | null {
  const promptText = str(question.question);
  const userPrompt = promptText.trim();
  if (!userPrompt) return null;

  const app = str(group.app).trim();
  const questionType = str(question.question_type).trim();
  const groupCategory = str(group.category).trim();
  const category = questionType || groupCategory || undefined;
  const difficulty = mapDifficultyLevel(group.difficulty_level);

  const payload: TestInput = {
    name: deriveName(userPrompt, usedNames),
    userPrompt,
    addedProfiles: [],
    expectations: buildExpectations(question),
    tags: app ? [app] : [],
  };
  if (category) payload.category = category;
  if (difficulty) payload.difficulty = difficulty;
  return payload;
}

function buildExpectations(question: RawQuestion): TestExpectations {
  const expectations: TestExpectations = {};
  const insight = str(question.gt_insight).trim();
  if (insight) expectations.expectedInsight = insight;
  if (hasValue(question.gt_insight_value)) expectations.expectedValue = question.gt_insight_value;
  const code = str(question.gt_code);
  if (code.trim()) expectations.referenceLogic = { kind: "code", language: "python", body: code };
  // answerable is set EXPLICITLY (faithful to the prototype): false when the GT insight trips the
  // unanswerable regex, true otherwise.
  expectations.answerable = !isUnanswerableInsight(insight);
  return expectations;
}

/** Derive a clean, deterministic display name from the prompt (whitespace-collapsed, capped, deduped). */
function deriveName(text: string, usedNames: Map<string, number>): string {
  let base = text.replace(/\s+/g, " ").trim();
  if (base.length > MAX_NAME_LENGTH) base = base.slice(0, MAX_NAME_LENGTH).trim();
  if (!base) base = "InsightBench question";
  const seen = usedNames.get(base) ?? 0;
  usedNames.set(base, seen + 1);
  return seen === 0 ? base : `${base} (${seen + 1})`;
}

// --- content hashing (dedup basis) -------------------------------------------------------------

// The canonical identity of a test for dedup purposes. Uses `?? null` (never undefined) so a mapped
// payload and a hydrated Test that carry the same information serialize identically. addedProfiles is
// always [] for imports; assertions/collection membership are deliberately NOT part of identity.
function canonicalContent(test: {
  name: string;
  userPrompt: string;
  systemPromptOverride?: string;
  addedProfiles?: unknown[];
  expectations?: TestExpectations;
  category?: string;
  difficulty?: Difficulty;
  tags?: string[];
}): unknown {
  return {
    name: test.name,
    userPrompt: test.userPrompt,
    systemPromptOverride: test.systemPromptOverride ?? null,
    addedProfiles: test.addedProfiles ?? [],
    expectations: test.expectations ?? null,
    category: test.category ?? null,
    difficulty: test.difficulty ?? null,
    tags: test.tags ?? [],
  };
}

/** SHA-256 over the STABLE-serialized canonical test content (the documented dedup basis). */
function contentHash(test: TestInput | Test): string {
  return crypto
    .createHash("sha256")
    .update(stableStringify(canonicalContent(test)))
    .digest("hex");
}

function suiteContentHash(
  name: string,
  description: string | undefined,
  config: { repetitions: number; maxConcurrency: number },
  memberHashes: string[],
): string {
  const canonical = {
    name,
    description: description ?? null,
    config: { repetitions: config.repetitions, maxConcurrency: config.maxConcurrency },
    testHashes: memberHashes,
  };
  return crypto.createHash("sha256").update(stableStringify(canonical)).digest("hex");
}

// --- normalization helpers ---------------------------------------------------------------------

function normalizeGroups(raw: unknown): RawGroup[] {
  if (Array.isArray(raw)) return raw.filter(isRecord) as RawGroup[];
  if (isRecord(raw)) {
    if (Array.isArray(raw.apps)) return raw.apps.filter(isRecord) as RawGroup[];
    if (Array.isArray(raw.groups)) return raw.groups.filter(isRecord) as RawGroup[];
    if (Array.isArray(raw.questions)) return [raw as RawGroup]; // a single app group
  }
  throw httpError(400, "InsightBench import: expected an array of app groups");
}

function groupQuestions(group: RawGroup): RawQuestion[] {
  return Array.isArray(group.questions) ? (group.questions.filter(isRecord) as RawQuestion[]) : [];
}

function countApps(groups: RawGroup[]): number {
  const apps = new Set<string>();
  for (const group of groups) {
    const app = str(group.app).trim();
    if (app) apps.add(app);
  }
  return apps.size;
}

function hasValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as object).length > 0;
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}
