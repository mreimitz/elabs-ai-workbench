import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import type {
  Test,
  TestAttachment,
  TestAttachmentInput,
  TestInput,
} from "@mcp-token-footprint/shared";
import { testAttachmentInputSchema } from "@mcp-token-footprint/shared";
import { config } from "../config/env.js";
import { httpError } from "../utils/errors.js";
import type { TestRepository } from "./test-repository.js";

export class TestService {
  constructor(
    private readonly tests: TestRepository,
    private readonly attachmentsDir: string = config.attachmentsDir,
  ) {}

  list(): Test[] {
    return this.tests.list();
  }

  get(id: string): Test {
    return this.tests.get(id);
  }

  /**
   * Testing IA (WP 2.2) — the ids of every test currently in `collectionId` (creation order). The run-plan
   * launcher resolves a `source:'collection'` plan through this, so the matrix reflects the collection's
   * CURRENT membership at launch time.
   */
  listIdsByCollection(collectionId: string): string[] {
    return this.tests.listIdsByCollection(collectionId);
  }

  create(input: TestInput): Test {
    return this.tests.create(input);
  }

  update(id: string, input: TestInput): Test {
    return this.tests.update(id, input);
  }

  delete(id: string): void {
    // Remove the blob files first (the rows cascade when the test row is deleted).
    for (const record of this.tests.listAttachmentRecords(id)) {
      removeFileQuietly(record.path);
    }
    this.tests.delete(id);
  }

  /**
   * Attachment upload — v1 no-new-dep path (per WP 2.1): accept a JSON body with base64-encoded
   * content instead of multipart/@fastify/multipart (owner-gated dependency). Decode, store the
   * blob at ATTACHMENTS_DIR/<attachmentId>, and insert the test_attachments row.
   */
  addAttachment(testId: string, input: TestAttachmentInput): TestAttachment {
    const parsed = testAttachmentInputSchema.parse(input);
    if (!this.tests.exists(testId)) {
      throw httpError(404, "Test not found");
    }

    const buffer = decodeBase64(parsed.contentBase64);
    const id = nanoid();
    fs.mkdirSync(this.attachmentsDir, { recursive: true });
    const blobPath = path.join(this.attachmentsDir, id);
    fs.writeFileSync(blobPath, buffer);

    return this.tests.insertAttachment({
      id,
      testId,
      kind: parsed.kind,
      name: parsed.name,
      path: blobPath,
      bytes: buffer.byteLength,
    });
  }
}

function decodeBase64(value: string): Buffer {
  const buffer = Buffer.from(value, "base64");
  // Reject input that is not valid base64 (Buffer.from silently drops invalid chars, so re-encode
  // and compare to catch a malformed payload).
  if (buffer.length === 0 || buffer.toString("base64") !== normalizeBase64(value)) {
    throw httpError(400, "Attachment content must be valid base64");
  }
  return buffer;
}

function normalizeBase64(value: string): string {
  // Strip whitespace and re-pad so the round-trip comparison is robust to formatting differences.
  const compact = value.replace(/\s+/g, "");
  const padded = compact.padEnd(Math.ceil(compact.length / 4) * 4, "=");
  return padded;
}

function removeFileQuietly(filePath: string): void {
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    // Best-effort cleanup; a missing blob must not block deleting the test.
  }
}
