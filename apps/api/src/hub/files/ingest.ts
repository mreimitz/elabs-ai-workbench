// Assistant Hub — v1-fixes (attachment ingestion, roadmap/assistant-hub/mission-session-analysis-2026-07-20.md
// "make attachments readable to every model") — file → markdown conversion for chat attachments.
//
// Pre-fix behavior: only text-like MIME types were inlined; everything else (pdf/docx/xlsx/pptx) rode
// as a raw multimodal `file` part — readable ONLY by the few models that accept file parts (and for
// office formats, by none at all). This module converts the common document formats to markdown
// in-process so EVERY model kind can read what the user attached. The stack is the JS-native one the
// local-first peers (LobeChat, AnythingLLM) ship, chosen over a Python markitdown sidecar after
// research (zero install friction; docx parity by construction — markitdown's own docx engine IS
// mammoth):
//
//   pdf   → unpdf (pdf.js text extraction)
//   docx  → mammoth → HTML → turndown (+ GFM tables)
//   xlsx  → SheetJS → per-sheet markdown pipe tables (row/col-capped, honestly truncated)
//   pptx  → officeparser AST → text
//   html  → turndown (+ GFM)
//
// Conversions are cached by content hash (a session's turns re-reconstruct history every dispatch; the
// file bytes never change), capped on input size, and NEVER throw — an unconvertible file simply keeps
// its pre-fix raw-part behavior. Converted text is UNTRUSTED user/file content, folded as data.

import { createHash } from "node:crypto";

export type HubAttachmentConverter = "pdf" | "docx" | "xlsx" | "pptx" | "html";

export type HubAttachmentConversion = {
  markdown: string;
  converter: HubAttachmentConverter;
};

/** Input-size guard: past this we don't attempt conversion (the raw-part path still applies). */
const INGEST_MAX_INPUT_BYTES = 15 * 1024 * 1024;

const XLSX_MAX_SHEETS = 10;
const XLSX_MAX_ROWS_PER_SHEET = 200;
const XLSX_MAX_COLS = 40;

const CACHE_MAX_ENTRIES = 50;
/** content-hash → conversion (null = attempted and failed; don't retry every turn). */
const conversionCache = new Map<string, HubAttachmentConversion | null>();

function fileExtension(filename?: string): string | undefined {
  return filename?.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
}

/** Which converter (if any) applies to an attachment. Mime wins; the filename extension backstops
 *  generic mimes (`application/octet-stream` uploads are common). */
export function converterFor(mime: string, filename?: string): HubAttachmentConverter | undefined {
  const m = mime.toLowerCase();
  const ext = fileExtension(filename);
  if (m === "application/pdf" || ext === "pdf") return "pdf";
  if (m.includes("wordprocessingml.document") || ext === "docx") return "docx";
  if (m.includes("spreadsheetml.sheet") || m === "application/vnd.ms-excel" || ext === "xlsx" || ext === "xls") {
    return "xlsx";
  }
  if (m.includes("presentationml.presentation") || ext === "pptx") return "pptx";
  if (m === "text/html" || m === "application/xhtml+xml" || ext === "html" || ext === "htm") return "html";
  return undefined;
}

async function htmlToMarkdown(html: string): Promise<string> {
  const TurndownService = (await import("turndown")).default;
  const { gfm } = await import("@joplin/turndown-plugin-gfm");
  const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
  turndown.use(gfm);
  return turndown.turndown(html);
}

async function convertPdf(content: Buffer): Promise<string> {
  const { extractText } = await import("unpdf");
  const { text } = await extractText(new Uint8Array(content), { mergePages: true });
  return Array.isArray(text) ? (text as string[]).join("\n\n") : text;
}

async function convertDocx(content: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const { value: html } = await mammoth.convertToHtml({ buffer: content });
  return htmlToMarkdown(html);
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

async function convertXlsx(content: Buffer): Promise<string> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(content, { type: "buffer" });
  const parts: string[] = [];
  const sheetNames = workbook.SheetNames.slice(0, XLSX_MAX_SHEETS);
  for (const name of sheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "" });
    if (rows.length === 0) {
      parts.push(`## Sheet: ${name}\n\n(empty)`);
      continue;
    }
    const shown = rows.slice(0, XLSX_MAX_ROWS_PER_SHEET);
    const width = Math.min(Math.max(...shown.map((r) => r.length), 1), XLSX_MAX_COLS);
    const line = (row: unknown[]): string =>
      `| ${Array.from({ length: width }, (_, i) => cellText(row[i])).join(" | ")} |`;
    const header = shown[0] ?? [];
    const body = shown.slice(1);
    const table = [
      line(header),
      `| ${Array.from({ length: width }, () => "---").join(" | ")} |`,
      ...body.map(line),
    ].join("\n");
    const truncated =
      rows.length > XLSX_MAX_ROWS_PER_SHEET
        ? `\n\n_(+${rows.length - XLSX_MAX_ROWS_PER_SHEET} more rows not shown)_`
        : "";
    parts.push(`## Sheet: ${name}\n\n${table}${truncated}`);
  }
  if (workbook.SheetNames.length > sheetNames.length) {
    parts.push(`_(+${workbook.SheetNames.length - sheetNames.length} more sheets not shown)_`);
  }
  return parts.join("\n\n");
}

async function convertPptx(content: Buffer): Promise<string> {
  const { parseOffice } = await import("officeparser");
  const ast = await parseOffice(content, { fileType: "pptx" } as never);
  const text =
    ast && typeof (ast as { toText?: () => string }).toText === "function"
      ? (ast as { toText: () => string }).toText()
      : "";
  return text;
}

/**
 * Convert an attachment's bytes to model-readable markdown, or `undefined` when no converter applies /
 * the conversion fails / the input is oversized. Cached by content hash; never throws.
 */
export async function convertAttachmentToMarkdown(file: {
  filename?: string;
  mime: string;
  content: Buffer;
}): Promise<HubAttachmentConversion | undefined> {
  const converter = converterFor(file.mime, file.filename);
  if (!converter) return undefined;
  if (file.content.length > INGEST_MAX_INPUT_BYTES) return undefined;

  const key = `${converter}:${createHash("sha1").update(file.content).digest("hex")}`;
  const cached = conversionCache.get(key);
  if (cached !== undefined) return cached ?? undefined;

  let markdown: string | undefined;
  try {
    switch (converter) {
      case "pdf":
        markdown = await convertPdf(file.content);
        break;
      case "docx":
        markdown = await convertDocx(file.content);
        break;
      case "xlsx":
        markdown = await convertXlsx(file.content);
        break;
      case "pptx":
        markdown = await convertPptx(file.content);
        break;
      case "html":
        markdown = await htmlToMarkdown(file.content.toString("utf8"));
        break;
    }
  } catch {
    markdown = undefined;
  }

  const trimmed = markdown?.trim();
  const result: HubAttachmentConversion | null = trimmed ? { markdown: trimmed, converter } : null;
  if (conversionCache.size >= CACHE_MAX_ENTRIES) {
    const oldest = conversionCache.keys().next().value;
    if (oldest !== undefined) conversionCache.delete(oldest);
  }
  conversionCache.set(key, result);
  return result ?? undefined;
}
